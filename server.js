const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const UAParser = require('ua-parser-js');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 50 * 1024 * 1024,
    pingTimeout: 60000
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.set('trust proxy', true);

// ===== CONFIG =====
let CONFIG = {
    ROOM_PASSWORD: 'df',
    ADMIN_KEY: 'admin',
    MAX_USERS: 50,
    AUTO_DESTROY_MINUTES: 30,
    PREMIUM_CODE: 'DF404PREMIUM'
};

// ===== DATA =====
let users = {};
let profilePics = {};
let messages = [];
let bannedIPs = [];
let bannedUsernames = [];
let userDetails = {};
let reactions = {};
let premiumUsers = [];
let userRoles = {};
let allUsersHistory = [];
let rooms = { general: { name: 'General', type: 'public' } };
let privateRooms = {};

// ===== FILES =====
const HISTORY_FILE = path.join(__dirname, 'users-history.json');
const ROLES_FILE = path.join(__dirname, 'user-roles.json');
const PREMIUM_FILE = path.join(__dirname, 'premium-users.json');

function load() {
    try { if (fs.existsSync(HISTORY_FILE)) allUsersHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e) {}
    try { if (fs.existsSync(ROLES_FILE)) userRoles = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8')); } catch(e) {}
    try { if (fs.existsSync(PREMIUM_FILE)) premiumUsers = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8')); } catch(e) {}
}

function saveHistory() { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(allUsersHistory, null, 2)); } catch(e) {} }
function saveRoles() { try { fs.writeFileSync(ROLES_FILE, JSON.stringify(userRoles, null, 2)); } catch(e) {} }
function savePremium() { try { fs.writeFileSync(PREMIUM_FILE, JSON.stringify(premiumUsers, null, 2)); } catch(e) {} }

function addToHistory(info) {
    const exists = allUsersHistory.find(u => u.username === info.username);
    if (exists) {
        exists.lastSeen = new Date().toLocaleString();
        exists.visitCount = (exists.visitCount || 1) + 1;
        exists.ip = info.ip;
        exists.browser = info.browser;
        exists.os = info.os;
        exists.device = info.device;
    } else {
        allUsersHistory.push({
            id: uuidv4(),
            username: info.username,
            ip: info.ip,
            browser: info.browser,
            os: info.os,
            device: info.device,
            firstSeen: new Date().toLocaleString(),
            lastSeen: new Date().toLocaleString(),
            visitCount: 1,
            role: userRoles[info.username] || 'user',
            isPremium: premiumUsers.includes(info.username)
        });
    }
    saveHistory();
}

function getIP(socket) {
    const h = socket.handshake.headers;
    if (h['cf-connecting-ip']) return h['cf-connecting-ip'];
    if (h['x-real-ip']) return h['x-real-ip'];
    if (h['x-forwarded-for']) return h['x-forwarded-for'].split(',')[0].trim();
    return socket.handshake.address.replace('::ffff:', '').replace('::1', '127.0.0.1');
}

load();

// ===== MULTER =====
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ===== AUTO DESTROY =====
setInterval(() => {
    const now = Date.now();
    const limit = CONFIG.AUTO_DESTROY_MINUTES * 60 * 1000;
    const before = messages.length;
    messages = messages.filter(m => (now - m.timestamp) < limit);
    if (messages.length < before) io.emit('messagesCleanup');
}, 30000);

// ===== ROUTES =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/qr', async (req, res) => {
    try {
        const qr = await QRCode.toDataURL(req.query.url || 'http://localhost:3000', { width: 300, color: { dark: '#6c63ff', light: '#0a0a0a' } });
        res.json({ qr });
    } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/validate-password', (req, res) => {
    res.json({ valid: req.body.password === CONFIG.ROOM_PASSWORD });
});

app.post('/api/validate-premium', (req, res) => {
    const { code, username } = req.body;
    if (code === CONFIG.PREMIUM_CODE) {
        if (!premiumUsers.includes(username)) { premiumUsers.push(username); savePremium(); }
        userRoles[username] = 'premium'; saveRoles();
        res.json({ valid: true });
    } else res.json({ valid: false });
});

// ===== IMAGE UPLOAD =====
app.post('/upload-image', upload.single('chatImage'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'No file' });
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    console.log('📸 Image uploaded:', (req.file.size / 1024).toFixed(0), 'KB');
    res.json({ success: true, image: b64 });
});

app.post('/upload-profile', upload.single('profilePic'), (req, res) => {
    if (!req.file) return res.json({ success: false });
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    profilePics[req.body.username] = b64;
    io.emit('profileUpdate', { username: req.body.username, image: b64 });
    res.json({ success: true, image: b64 });
});

app.post('/upload-file', upload.single('chatFile'), (req, res) => {
    if (!req.file) return res.json({ success: false });
    res.json({
        success: true,
        file: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
        fileName: req.file.originalname,
        fileSize: req.file.size
    });
});

app.post('/upload-voice', upload.single('voiceMessage'), (req, res) => {
    if (!req.file) return res.json({ success: false });
    res.json({ success: true, audio: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` });
});

// ===== ADMIN =====
app.post('/api/admin-login', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    res.json({ success: true, users: userDetails, onlineUsers: users, messages, bannedIPs, bannedUsernames, config: CONFIG, userRoles, premiumUsers, allUsersHistory, rooms });
});

app.post('/api/admin/kick', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    const s = io.sockets.sockets.get(req.body.socketId);
    if (s) { s.emit('kicked', { reason: 'Kicked' }); s.disconnect(); }
    res.json({ success: true });
});

app.post('/api/admin/ban', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    if (req.body.ip && !bannedIPs.includes(req.body.ip)) bannedIPs.push(req.body.ip);
    if (req.body.username && !bannedUsernames.includes(req.body.username)) bannedUsernames.push(req.body.username);
    Object.keys(users).forEach(sid => {
        if (users[sid] === req.body.username) {
            const s = io.sockets.sockets.get(sid);
            if (s) { s.emit('kicked', { reason: 'Banned' }); s.disconnect(); }
        }
    });
    res.json({ success: true });
});

app.post('/api/admin/unban', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    bannedIPs = bannedIPs.filter(i => i !== req.body.ip);
    bannedUsernames = bannedUsernames.filter(u => u !== req.body.username);
    res.json({ success: true });
});

app.post('/api/admin/update-config', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    Object.assign(CONFIG, req.body.config);
    res.json({ success: true, config: CONFIG });
});

app.post('/api/admin/set-role', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    const { username, role } = req.body;
    userRoles[username] = role;
    if (['premium', 'admin', 'mod'].includes(role)) {
        if (!premiumUsers.includes(username)) premiumUsers.push(username);
    } else {
        premiumUsers = premiumUsers.filter(u => u !== username);
    }
    saveRoles();
    savePremium();
    const h = allUsersHistory.find(u => u.username === username);
    if (h) { h.role = role; h.isPremium = ['premium', 'admin', 'mod'].includes(role); saveHistory(); }
    io.emit('roleUpdate', { username, role });
    const sid = Object.keys(users).find(s => users[s] === username);
    if (sid) { io.to(sid).emit('myRole', role); io.to(sid).emit('isPremium', ['premium', 'admin', 'mod'].includes(role)); }
    res.json({ success: true });
});

app.post('/api/admin/clear-history', (req, res) => {
    if (req.body.key !== CONFIG.ADMIN_KEY) return res.json({ success: false });
    allUsersHistory = [];
    saveHistory();
    res.json({ success: true });
});

app.get('/api/admin/export-chat', (req, res) => {
    if (req.query.key !== CONFIG.ADMIN_KEY) return res.status(403).send('No');
    res.json({ messages: messages.map(m => ({ username: m.username, type: m.type, message: m.message, time: m.time, room: m.room })) });
});

app.get('/api/admin/export-users', (req, res) => {
    if (req.query.key !== CONFIG.ADMIN_KEY) return res.status(403).send('No');
    res.json({ users: allUsersHistory });
});

// ===== SOCKET =====
io.on('connection', (socket) => {
    const ip = getIP(socket);
    const ua = socket.handshake.headers['user-agent'];
    const parser = new UAParser(ua);

    if (bannedIPs.includes(ip)) { socket.emit('kicked', { reason: 'IP banned' }); socket.disconnect(); return; }

    socket.on('join', (data) => {
        const { username, room } = data;
        if (bannedUsernames.includes(username)) { socket.emit('kicked', { reason: 'Banned' }); socket.disconnect(); return; }
        if (Object.values(users).includes(username)) { socket.emit('duplicateUsername'); return; }
        if (Object.keys(users).length >= CONFIG.MAX_USERS) { socket.emit('roomFull'); return; }

        users[socket.id] = username;
        const r = room || 'general';
        socket.join(r);
        if (!userRoles[username]) userRoles[username] = 'user';

        userDetails[socket.id] = {
            username, ip,
            browser: parser.getBrowser(),
            os: parser.getOS(),
            device: parser.getDevice(),
            connectedAt: new Date().toLocaleString(),
            socketId: socket.id,
            role: userRoles[username],
            room: r
        };

        addToHistory(userDetails[socket.id]);

        socket.emit('allProfiles', profilePics);
        socket.emit('isPremium', premiumUsers.includes(username));
        socket.emit('myRole', userRoles[username]);
        socket.emit('roomsList', rooms);

        io.emit('userJoined', {
            username,
            onlineCount: Object.keys(users).length,
            users: Object.values(users),
            premiumUsers, userRoles
        });

        console.log(`👤 ${username} | ${ip} | ${parser.getBrowser().name || '?'} | ${parser.getOS().name || '?'}`);
    });

    // TEXT
    socket.on('sendMessage', (data) => {
        const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const msg = {
            id: uuidv4(), username: users[socket.id],
            message: data.message, time: t, type: 'text',
            timestamp: Date.now(), room: data.room || 'general',
            replyTo: data.replyTo || null,
            isPremium: premiumUsers.includes(users[socket.id]),
            role: userRoles[users[socket.id]] || 'user'
        };
        messages.push(msg);
        io.to(msg.room).emit('newMessage', msg);
        setTimeout(() => io.emit('messageDelivered', { id: msg.id }), 300);
    });

    // IMAGE
    socket.on('sendImage', (data) => {
        if (!data || !data.image) return;
        const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const msg = {
            id: uuidv4(), username: users[socket.id],
            image: data.image, time: t, type: 'image',
            timestamp: Date.now(), room: data.room || 'general',
            isPremium: premiumUsers.includes(users[socket.id]),
            role: userRoles[users[socket.id]] || 'user'
        };
        messages.push(msg);
        io.to(msg.room).emit('newMessage', msg);
        console.log(`📸 ${users[socket.id]} sent image`);
    });

    // VOICE
    socket.on('sendVoice', (data) => {
        if (!data || !data.audio) return;
        const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const msg = { id: uuidv4(), username: users[socket.id], audio: data.audio, time: t, type: 'voice', timestamp: Date.now(), room: data.room || 'general', isPremium: premiumUsers.includes(users[socket.id]), role: userRoles[users[socket.id]] || 'user' };
        messages.push(msg);
        io.to(msg.room).emit('newMessage', msg);
    });

    // FILE
    socket.on('sendFile', (data) => {
        if (!data || !data.file) return;
        const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const msg = { id: uuidv4(), username: users[socket.id], file: data.file, fileName: data.fileName, fileSize: data.fileSize, time: t, type: 'file', timestamp: Date.now(), room: data.room || 'general', isPremium: premiumUsers.includes(users[socket.id]), role: userRoles[users[socket.id]] || 'user' };
        messages.push(msg);
        io.to(msg.room).emit('newMessage', msg);
    });

    // GIF
    socket.on('sendGif', (data) => {
        if (!data || !data.gifUrl) return;
        const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const msg = { id: uuidv4(), username: users[socket.id], gifUrl: data.gifUrl, time: t, type: 'gif', timestamp: Date.now(), room: data.room || 'general', isPremium: premiumUsers.includes(users[socket.id]), role: userRoles[users[socket.id]] || 'user' };
        messages.push(msg);
        io.to(msg.room).emit('newMessage', msg);
    });

    // DM
    socket.on('sendDM', (data) => {
        const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const dm = { id: uuidv4(), from: users[socket.id], to: data.to, message: data.message || null, image: data.image || null, type: data.image ? 'image' : 'text', time: t, timestamp: Date.now() };
        const sid = Object.keys(users).find(s => users[s] === data.to);
        if (sid) io.to(sid).emit('newDM', dm);
        socket.emit('newDM', dm);
    });

    // DELETE
    socket.on('deleteMessage', (data) => {
        const msg = messages.find(m => m.id === data.id);
        if (!msg) return;
        const role = userRoles[users[socket.id]] || 'user';
        if (msg.username === users[socket.id] || role === 'admin' || role === 'mod') {
            messages = messages.filter(m => m.id !== data.id);
            io.emit('messageDeleted', { id: data.id });
        }
    });

    // REACTIONS
    socket.on('addReaction', (data) => {
        if (!reactions[data.messageId]) reactions[data.messageId] = {};
        if (!reactions[data.messageId][data.emoji]) reactions[data.messageId][data.emoji] = [];
        const u = users[socket.id];
        const i = reactions[data.messageId][data.emoji].indexOf(u);
        if (i > -1) reactions[data.messageId][data.emoji].splice(i, 1);
        else reactions[data.messageId][data.emoji].push(u);
        io.emit('reactionUpdate', { messageId: data.messageId, reactions: reactions[data.messageId] });
    });

    socket.on('messageSeen', (data) => { io.emit('messageSeenUpdate', { messageId: data.messageId, seenBy: users[socket.id] }); });

    // WEBRTC
    socket.on('callUser', (d) => { const t = Object.keys(users).find(s => users[s] === d.to); if (t) io.to(t).emit('incomingCall', { from: users[socket.id], signal: d.signal, callType: d.callType }); });
    socket.on('answerCall', (d) => { const t = Object.keys(users).find(s => users[s] === d.to); if (t) io.to(t).emit('callAccepted', { signal: d.signal }); });
    socket.on('rejectCall', (d) => { const t = Object.keys(users).find(s => users[s] === d.to); if (t) io.to(t).emit('callRejected'); });
    socket.on('endCall', (d) => { const t = Object.keys(users).find(s => users[s] === d.to); if (t) io.to(t).emit('callEnded'); });
    socket.on('iceCandidate', (d) => { const t = Object.keys(users).find(s => users[s] === d.to); if (t) io.to(t).emit('iceCandidate', { candidate: d.candidate }); });

    // ROOMS
    socket.on('createRoom', (d) => { const id = d.name.toLowerCase().replace(/\s/g, '-'); rooms[id] = { name: d.name, type: 'public' }; io.emit('roomsList', rooms); });

    socket.on('createPrivateRoom', (d) => {
        const id = 'priv-' + uuidv4().substring(0, 8);
        const members = d.members || [];
        if (!members.includes(users[socket.id])) members.push(users[socket.id]);
        privateRooms[id] = { name: d.name || 'Private', type: 'private', members, createdBy: users[socket.id] };
        members.forEach(m => {
            const sid = Object.keys(users).find(s => users[s] === m);
            if (sid) { const ms = io.sockets.sockets.get(sid); if (ms) { ms.join(id); ms.emit('privateRoomInvite', { roomId: id, name: d.name, members }); } }
        });
    });

    socket.on('joinRoom', (d) => { socket.leave(d.currentRoom); socket.join(d.newRoom); socket.emit('roomChanged', { room: d.newRoom }); });

    socket.on('getRooms', () => {
        const u = users[socket.id];
        const pr = {};
        Object.entries(privateRooms).forEach(([id, r]) => { if (r.members.includes(u)) pr[id] = r; });
        socket.emit('roomsList', rooms);
        socket.emit('privateRoomsList', pr);
    });

    socket.on('typing', () => socket.broadcast.emit('userTyping', users[socket.id]));
    socket.on('stopTyping', () => socket.broadcast.emit('userStopTyping', users[socket.id]));

    socket.on('disconnect', () => {
        const u = users[socket.id];
        delete users[socket.id];
        delete userDetails[socket.id];
        io.emit('userLeft', { username: u, onlineCount: Object.keys(users).length, users: Object.values(users) });
    });
});

server.listen(3000, () => {
    console.log(`
    ╔════════════════════════════════╗
    ║     DF404 - localhost:3000     ║
    ║     Admin: /admin             ║
    ╚════════════════════════════════╝`);
});

process.on('SIGINT', () => process.exit());