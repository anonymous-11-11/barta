// ==================== INIT ====================
const ME = sessionStorage.getItem('username');
if (!ME) window.location.href = '/';

const socket = io({ reconnection: true, reconnectionAttempts: 10 });

const msgsDiv = document.getElementById('msgs');
const msgIn = document.getElementById('msgIn');

let curRoom = 'general';
let ctxId = null, ctxData = null;
let replyTo = null;
let dmTo = null;
let myRole = 'user';
let isDark = true;
let profiles = {};
let curSide = null;
let amIPremium = false;

// WebRTC
let pc = null, localStream = null, callTo = null;
let pendCaller = null, pendSig = null, pendType = null;
let isMuted = false, isCamOff = false;
let screenStream = null, screenPc = null;
let gifTimer = null;

// Call Timer
let callTimerInterval = null;
let callStartTime = null;

document.getElementById('myName').textContent = '@' + ME;

// ==================== PREMIUM CHECK ====================
function isPrem() {
    return amIPremium || myRole === 'admin' || myRole === 'mod' || myRole === 'premium';
}

function premBlock(feature) {
    alert('⭐ "' + feature + '" is a Premium feature!\n\nAsk admin for premium access.');
    return false;
}

function updateUIForRole() {
    const prem = isPrem();

    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) {
        voiceBtn.style.opacity = prem ? '1' : '0.3';
        voiceBtn.title = prem ? 'Voice Message' : '⭐ Premium Only';
    }

    document.querySelectorAll('.tbtn.hide-m').forEach(btn => {
        const t = btn.textContent.trim();
        if (t === '✨' || t === '📁') {
            btn.style.opacity = prem ? '1' : '0.3';
            btn.title = prem ? '' : '⭐ Premium Only';
        }
    });

    document.querySelectorAll('#dmPanel .dm-head .tbtn').forEach(btn => {
        const t = btn.textContent.trim();
        if (t === '📞' || t === '📹') {
            btn.style.opacity = prem ? '1' : '0.3';
            btn.title = prem ? '' : '⭐ Premium Only';
        }
    });

    document.querySelectorAll('.lbar-item').forEach(item => {
        if (item.textContent.includes('🖥️')) {
            item.style.opacity = prem ? '1' : '0.3';
        }
    });

    const privBtn = document.querySelector('[onclick="newPrivRoom()"]');
    if (privBtn) privBtn.style.opacity = prem ? '1' : '0.3';
}

// ==================== CALL TIMER ====================
function startCallTimer() {
    callStartTime = Date.now();
    const timerEl = document.getElementById('callTimer');
    const videoTimerEl = document.getElementById('videoTimer');

    if (timerEl) { timerEl.style.display = 'block'; timerEl.textContent = '00:00'; }
    if (videoTimerEl) videoTimerEl.textContent = '00:00';

    callTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const time = mins + ':' + secs;

        if (timerEl) timerEl.textContent = time;
        if (videoTimerEl) videoTimerEl.textContent = time;
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStartTime = null;
    const timerEl = document.getElementById('callTimer');
    if (timerEl) timerEl.style.display = 'none';
}

// ==================== SOCKET ====================
socket.emit('join', { username: ME, room: curRoom });

socket.on('userJoined', d => {
    sysMsg(`${d.username} joined`);
    document.getElementById('onlineBadge').textContent = d.onlineCount + ' online';
    buildUserList(d.users, d.premiumUsers || [], d.userRoles || {});
    beep();
});

socket.on('userLeft', d => {
    sysMsg(`${d.username} left`);
    document.getElementById('onlineBadge').textContent = d.onlineCount + ' online';
    buildUserList(d.users, [], {});
});

socket.on('newMessage', d => {
    addMsg(d);
    if (d.username !== ME) { beep(); notify(d.username, d.message || '📎'); }
    if (d.username !== ME) socket.emit('messageSeen', { messageId: d.id });
});

socket.on('allProfiles', p => {
    Object.assign(profiles, p);
    if (profiles[ME]) document.getElementById('profBtn').innerHTML = `<img src="${profiles[ME]}">`;
});

socket.on('profileUpdate', d => {
    profiles[d.username] = d.image;
    if (d.username === ME) document.getElementById('profBtn').innerHTML = `<img src="${d.image}">`;
    refreshAvatars();
});

socket.on('isPremium', v => {
    amIPremium = v;
    if (v) document.getElementById('premTag').style.display = 'inline';
    updateUIForRole();
});

socket.on('myRole', r => {
    myRole = r;
    amIPremium = ['premium', 'admin', 'mod'].includes(r);
    document.getElementById('adminTag').style.display = r === 'admin' ? 'inline' : 'none';
    document.getElementById('modTag').style.display = r === 'mod' ? 'inline' : 'none';
    document.getElementById('premTag').style.display = amIPremium ? 'inline' : 'none';
    updateUIForRole();
});

socket.on('roleUpdate', d => {
    if (d.username !== ME) return;
    myRole = d.role;
    amIPremium = ['premium', 'admin', 'mod'].includes(d.role);
    document.getElementById('adminTag').style.display = d.role === 'admin' ? 'inline' : 'none';
    document.getElementById('modTag').style.display = d.role === 'mod' ? 'inline' : 'none';
    document.getElementById('premTag').style.display = amIPremium ? 'inline' : 'none';
    updateUIForRole();
});

socket.on('userTyping', u => { document.getElementById('typingBar').textContent = u + ' is typing...'; });
socket.on('userStopTyping', () => { document.getElementById('typingBar').textContent = ''; });

socket.on('messageDeleted', d => {
    const el = document.getElementById('m' + d.id);
    if (!el) return;
    el.classList.add('deleting');
    setTimeout(() => el && el.remove(), 500);
    closePopups();
});

socket.on('reactionUpdate', d => updateReacts(d.messageId, d.reactions));
socket.on('messageDelivered', d => { const s = document.querySelector('#m' + d.id + ' .stat'); if (s) s.textContent = '✓'; });
socket.on('messageSeenUpdate', d => { const s = document.querySelector('#m' + d.messageId + ' .stat'); if (s) s.textContent = '✓✓'; });
socket.on('messagesCleanup', () => sysMsg('🗑️ Auto-destroyed'));
socket.on('duplicateUsername', () => { alert('Username taken!'); sessionStorage.clear(); window.location.href = '/'; });
socket.on('roomFull', () => { alert('Room full!'); window.location.href = '/'; });
socket.on('kicked', d => { alert('❌ ' + d.reason); sessionStorage.clear(); window.location.href = '/'; });

socket.on('newDM', d => {
    const other = d.from === ME ? d.to : d.from;
    if (!document.getElementById('dmPanel').classList.contains('on') || dmTo !== other) openDM(other);
    addDMMsg(d);
    if (d.from !== ME) { beep(); notify('DM: ' + d.from, d.message || '📷'); }
});

socket.on('roomsList', rooms => buildRooms(rooms));
socket.on('privateRoomsList', rooms => buildPrivRooms(rooms));
socket.on('privateRoomInvite', d => { sysMsg('🔒 Invited: ' + d.name); socket.emit('getRooms'); });
socket.on('roomChanged', d => { document.getElementById('roomBadge').textContent = '💬 ' + d.room; });

// ==================== WebRTC ====================
const ICE = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
]};

socket.on('incomingCall', d => {
    pendCaller = d.from; pendSig = d.signal; pendType = d.callType;
    document.getElementById('callerName').textContent = '@' + d.from;
    document.getElementById('callTypeLabel').textContent = d.callType === 'video' ? '📹 Video Call' : '📞 Voice Call';
    document.getElementById('incCall').classList.add('on');
    beep();
});

socket.on('callAccepted', async d => {
    document.getElementById('callStat').textContent = 'Connected ✓';
    startCallTimer();
    try { await pc.setRemoteDescription(new RTCSessionDescription(d.signal)); } catch(e) { console.error(e); }
});

socket.on('callRejected', () => {
    document.getElementById('callStat').textContent = 'Rejected';
    setTimeout(closeCall, 1500);
});

socket.on('callEnded', () => { sysMsg('📵 Call ended'); closeCall(); });

socket.on('iceCandidate', async d => {
    try { if (pc && d.candidate) await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch(e) {}
});

socket.on('screenShareStarted', async d => {
    sysMsg('🖥️ ' + d.from + ' sharing');
    try {
        screenPc = new RTCPeerConnection(ICE);
        await screenPc.setRemoteDescription(new RTCSessionDescription(d.signal));
        const ans = await screenPc.createAnswer(); await screenPc.setLocalDescription(ans);
        socket.emit('screenShareAnswer', { to: d.from, signal: ans });
        screenPc.ontrack = e => {
            document.getElementById('screenVid').srcObject = e.streams[0];
            document.getElementById('screenView').classList.add('on');
        };
    } catch(e) {}
});

socket.on('screenShareStopped', () => {
    document.getElementById('screenView').classList.remove('on');
    if (screenPc) { screenPc.close(); screenPc = null; }
});

socket.on('screenShareAnswer', async d => {
    try { if (screenPc) await screenPc.setRemoteDescription(new RTCSessionDescription(d.signal)); } catch(e) {}
});

// ==================== CALL - VIDEO FIX + TIMER ====================
async function startCall(target, type) {
    if (!isPrem()) return premBlock(type === 'video' ? 'Video Call' : 'Voice Call');
    if (!target) return;
    callTo = target;

    try {
        const constraints = {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        };

        if (type === 'video') {
            constraints.video = {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            };
        }

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('📹 Tracks:', localStream.getTracks().map(t => t.kind + ':' + t.enabled));
    } catch(e) {
        alert('Camera/Microphone access denied!\n\nPlease allow in browser settings.');
        console.error(e);
        return;
    }

    // Show correct UI
    document.getElementById('callOver').classList.add('on');

    if (type === 'video') {
        document.getElementById('audioUI').style.display = 'none';
        document.getElementById('videoUI').style.display = 'block';
        document.getElementById('localVideo').srcObject = localStream;
    } else {
        document.getElementById('audioUI').style.display = 'block';
        document.getElementById('videoUI').style.display = 'none';
    }

    document.getElementById('callName').textContent = '@' + target;
    document.getElementById('callStat').textContent = 'Ringing...';

    // Create peer connection
    pc = new RTCPeerConnection(ICE);

    // Add all tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log('Added track:', track.kind);
    });

    // ICE candidates
    pc.onicecandidate = e => {
        if (e.candidate) socket.emit('iceCandidate', { to: target, candidate: e.candidate });
    };

    // Receive remote tracks
    pc.ontrack = e => {
        console.log('📞 Remote track:', e.track.kind);

        if (type === 'video') {
            const remoteVid = document.getElementById('remoteVideo');
            remoteVid.srcObject = e.streams[0];
            remoteVid.play().catch(err => console.error('Video play error:', err));
        } else {
            const remoteAud = document.getElementById('remoteAudio');
            remoteAud.srcObject = e.streams[0];
            remoteAud.play().catch(err => console.error('Audio play error:', err));
        }

        document.getElementById('callStat').textContent = 'Connected ✓';
        startCallTimer();
    };

    pc.onconnectionstatechange = () => {
        console.log('Connection:', pc.connectionState);
    };

    // Create offer
    const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
    });
    await pc.setLocalDescription(offer);
    socket.emit('callUser', { to: target, signal: offer, callType: type });
}

async function acceptCall() {
    document.getElementById('incCall').classList.remove('on');
    callTo = pendCaller;

    try {
        const constraints = {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        };

        if (pendType === 'video') {
            constraints.video = {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            };
        }

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(e) {
        alert('Camera/Microphone access denied!');
        return;
    }

    document.getElementById('callOver').classList.add('on');

    if (pendType === 'video') {
        document.getElementById('audioUI').style.display = 'none';
        document.getElementById('videoUI').style.display = 'block';
        document.getElementById('localVideo').srcObject = localStream;
    } else {
        document.getElementById('audioUI').style.display = 'block';
        document.getElementById('videoUI').style.display = 'none';
    }

    document.getElementById('callName').textContent = '@' + pendCaller;
    document.getElementById('callStat').textContent = 'Connecting...';

    pc = new RTCPeerConnection(ICE);

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    pc.onicecandidate = e => {
        if (e.candidate) socket.emit('iceCandidate', { to: pendCaller, candidate: e.candidate });
    };

    pc.ontrack = e => {
        console.log('📞 Remote track:', e.track.kind);

        if (pendType === 'video') {
            const remoteVid = document.getElementById('remoteVideo');
            remoteVid.srcObject = e.streams[0];
            remoteVid.play().catch(err => console.error('Video play error:', err));
        } else {
            const remoteAud = document.getElementById('remoteAudio');
            remoteAud.srcObject = e.streams[0];
            remoteAud.play().catch(err => console.error('Audio play error:', err));
        }

        document.getElementById('callStat').textContent = 'Connected ✓';
        startCallTimer();
    };

    await pc.setRemoteDescription(new RTCSessionDescription(pendSig));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit('answerCall', { to: pendCaller, signal: ans });
}

function rejectCall() {
    socket.emit('rejectCall', { to: pendCaller });
    document.getElementById('incCall').classList.remove('on');
    pendCaller = pendSig = pendType = null;
}

function endCall() {
    socket.emit('endCall', { to: callTo });
    closeCall();
}

function closeCall() {
    // Stop timer
    stopCallTimer();

    // Stop all tracks
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (pc) { pc.close(); pc = null; }

    // Clear audio
    const remoteAud = document.getElementById('remoteAudio');
    if (remoteAud) remoteAud.srcObject = null;

    // Clear video
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;
    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = null;

    // Hide overlay
    document.getElementById('callOver').classList.remove('on');

    // Reset UI
    document.getElementById('audioUI').style.display = 'block';
    document.getElementById('videoUI').style.display = 'none';

    callTo = null;
    isMuted = false;
    isCamOff = false;

    // Reset buttons
    const mb = document.getElementById('muteBtn');
    const mb2 = document.getElementById('muteBtn2');
    const cb = document.getElementById('camBtn');
    if (mb) mb.textContent = '🎤';
    if (mb2) mb2.textContent = '🎤';
    if (cb) cb.textContent = '📹';
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    const icon = isMuted ? '🔇' : '🎤';
    const mb = document.getElementById('muteBtn');
    const mb2 = document.getElementById('muteBtn2');
    if (mb) mb.textContent = icon;
    if (mb2) mb2.textContent = icon;
}

function toggleCam() {
    if (!localStream) return;
    isCamOff = !isCamOff;
    localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
    const cb = document.getElementById('camBtn');
    if (cb) cb.textContent = isCamOff ? '📵' : '📹';
}

// SCREEN SHARE - PREMIUM ONLY
async function startScreenShare() {
    if (!isPrem()) return premBlock('Screen Share');
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        document.getElementById('screenVid').srcObject = screenStream;
        document.getElementById('screenView').classList.add('on');
        document.getElementById('screenInfo').textContent = '🖥️ You are sharing';
        screenPc = new RTCPeerConnection(ICE);
        screenStream.getTracks().forEach(t => screenPc.addTrack(t, screenStream));
        const offer = await screenPc.createOffer(); await screenPc.setLocalDescription(offer);
        socket.emit('startScreenShare', { signal: offer });
        screenStream.getVideoTracks()[0].onended = () => stopScreen();
    } catch(e) {}
}

function stopScreen() {
    if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
    if (screenPc) { screenPc.close(); screenPc = null; }
    document.getElementById('screenView').classList.remove('on');
    socket.emit('stopScreenShare');
}

// ==================== TYPING ====================
let typTimer;
msgIn.addEventListener('input', () => {
    socket.emit('typing');
    clearTimeout(typTimer);
    typTimer = setTimeout(() => socket.emit('stopTyping'), 1000);
});
msgIn.addEventListener('keypress', e => { if (e.key === 'Enter') sendMsg(); });

// ==================== SEND TEXT ====================
function sendMsg() {
    const m = msgIn.value.trim();
    if (!m) return;
    socket.emit('sendMessage', { message: m, room: curRoom, replyTo });
    msgIn.value = '';
    cancelReply();
    socket.emit('stopTyping');
}

// ==================== IMAGE UPLOAD ====================
document.getElementById('imgIn').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    sysMsg('📸 Uploading...');
    try {
        const compressed = await compressImg(file);
        const fd = new FormData(); fd.append('chatImage', compressed);
        const res = await fetch('/upload-image', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success && data.image) socket.emit('sendImage', { image: data.image, room: curRoom });
        else sysMsg('❌ Upload failed');
    } catch(err) { sysMsg('❌ Error'); }
});

function compressImg(file) {
    return new Promise(resolve => {
        if (file.size < 200 * 1024) { resolve(file); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                const MAX = 1200;
                let w = img.width, h = img.height;
                if (w > MAX) { h = h * MAX / w; w = MAX; }
                if (h > MAX) { w = w * MAX / h; h = MAX; }
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                c.toBlob(b => resolve(b ? new File([b], 'img.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.75);
            };
            img.onerror = () => resolve(file);
            img.src = ev.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

// FILE - PREMIUM
document.getElementById('fileIn').addEventListener('change', async e => {
    if (!isPrem()) { e.target.value = ''; return premBlock('File Share'); }
    const file = e.target.files[0]; if (!file) return; e.target.value = '';
    const fd = new FormData(); fd.append('chatFile', file);
    try { const r = await fetch('/upload-file', { method: 'POST', body: fd }); const d = await r.json(); if (d.success) socket.emit('sendFile', { file: d.file, fileName: d.fileName, fileSize: d.fileSize, room: curRoom }); } catch(e) {}
});

// VOICE - PREMIUM
let recorder, chunks = [], recOn = false;
async function startRec(e) {
    if (!isPrem()) return premBlock('Voice Message');
    if (e) e.preventDefault();
    try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
        recorder = new MediaRecorder(s); chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => {
            const b = new Blob(chunks, { type: 'audio/webm' });
            const fd = new FormData(); fd.append('voiceMessage', b, 'v.webm');
            try { const r = await fetch('/upload-voice', { method: 'POST', body: fd }); const d = await r.json(); if (d.success) socket.emit('sendVoice', { audio: d.audio, room: curRoom }); } catch(e) {}
            s.getTracks().forEach(t => t.stop());
        };
        recorder.start(); recOn = true;
        document.getElementById('voiceBtn').classList.add('rec');
        document.getElementById('voiceBtn').textContent = '⏺';
    } catch(e) { alert('Mic denied!'); }
}

function stopRec() {
    if (recorder && recOn) {
        recorder.stop(); recOn = false;
        document.getElementById('voiceBtn').classList.remove('rec');
        document.getElementById('voiceBtn').textContent = '🎙️';
    }
}

// GIF - PREMIUM
function toggleGif() {
    if (!isPrem()) return premBlock('GIF');
    document.getElementById('gifPick').classList.toggle('on');
    document.getElementById('emojiPick').classList.remove('on');
}

document.getElementById('gifQ').addEventListener('input', e => {
    clearTimeout(gifTimer);
    gifTimer = setTimeout(() => searchGif(e.target.value), 500);
});

async function searchGif(q) {
    const g = document.getElementById('gifGrid');
    if (!q) { g.innerHTML = '<p style="color:#444;font-size:10px;grid-column:1/-1">Type to search...</p>'; return; }
    g.innerHTML = '<p style="color:#444;font-size:10px;grid-column:1/-1">Searching...</p>';
    try {
        const r = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCyk&limit=12&media_filter=gif`);
        const d = await r.json();
        if (!d.results?.length) { g.innerHTML = '<p style="color:#444;font-size:10px;grid-column:1/-1">No results</p>'; return; }
        g.innerHTML = '';
        d.results.forEach(gi => {
            const url = gi.media_formats?.tinygif?.url; if (!url) return;
            const div = document.createElement('div'); div.className = 'gif-item';
            div.innerHTML = `<img src="${url}" loading="lazy">`;
            div.onclick = () => { socket.emit('sendGif', { gifUrl: url, room: curRoom }); document.getElementById('gifPick').classList.remove('on'); document.getElementById('gifQ').value = ''; };
            g.appendChild(div);
        });
    } catch(e) { g.innerHTML = '<p style="color:#ff4757;font-size:10px;grid-column:1/-1">Failed</p>'; }
}

// ==================== ADD MESSAGE ====================
function addMsg(data) {
    const isMe = data.username === ME;
    const div = document.createElement('div');
    div.className = 'msg ' + (isMe ? 'me' : 'them');
    div.id = 'm' + data.id;

    let tag = '';
    if (data.role === 'admin') tag = '<span class="rtag admin">ADMIN</span>';
    else if (data.role === 'mod') tag = '<span class="rtag mod">MOD</span>';
    else if (data.isPremium) tag = '<span class="rtag prem">⭐</span>';

    let h = '';
    if (!isMe) h += `<div class="msg-user">@${data.username} ${tag}</div>`;
    else h += `<div class="msg-user">${tag} @${data.username}</div>`;

    if (data.replyTo) h += `<div class="reply-prev">↩️ @${data.replyTo.username}: ${esc(data.replyTo.message || '[file]').substring(0,40)}</div>`;

    if (data.type === 'image' && data.image) h += `<div class="bubble" style="padding:3px"><img class="msg-img" src="${data.image}" onclick="viewImg(this)" loading="lazy"></div>`;
    else if (data.type === 'gif') h += `<div class="bubble" style="padding:3px"><img class="msg-gif" src="${data.gifUrl}" loading="lazy"></div>`;
    else if (data.type === 'voice') h += `<div class="bubble"><div class="voice-box">🎙️<audio controls src="${data.audio}"></audio></div></div>`;
    else if (data.type === 'file') { const kb = (data.fileSize/1024).toFixed(1); h += `<div class="bubble"><div class="file-box" onclick="dlFile('${data.file}','${esc(data.fileName)}')">📄<div><div style="font-size:11px;color:#a29bfe">${esc(data.fileName)}</div><div style="font-size:9px;color:#555">${kb}KB</div></div></div></div>`; }
    else h += `<div class="bubble">${linkify(esc(data.message))}</div>`;

    h += `<div class="msg-meta"><span>${data.time}</span>`;
    if (isMe) h += `<span class="stat">○</span>`;
    h += `</div><div class="react-row" id="r${data.id}"></div>`;

    div.innerHTML = h;
    setupLongPress(div, data);
    msgsDiv.appendChild(div);
    msgsDiv.scrollTop = msgsDiv.scrollHeight;
}

function viewImg(el) { document.getElementById('imgView').src = el.src; document.getElementById('imgModal').classList.add('on'); }
function sysMsg(t) { const d = document.createElement('div'); d.className = 'sys'; d.innerHTML = `<span>${t}</span>`; msgsDiv.appendChild(d); msgsDiv.scrollTop = msgsDiv.scrollHeight; }

// ==================== LONG PRESS ====================
const delPopup = document.createElement('div');
delPopup.className = 'del-popup'; delPopup.id = 'delPopup';
delPopup.innerHTML = `
    <div class="del-item" onclick="doReply()">↩️ Reply</div>
    <div class="del-item" onclick="doCopy()">📋 Copy</div>
    <div class="del-item" onclick="doReact('👍')">👍</div>
    <div class="del-item" onclick="doReact('❤️')">❤️</div>
    <div class="del-item" onclick="doReact('😂')">😂</div>
    <div class="del-item" onclick="doReact('🔥')">🔥</div>
    <div class="del-item danger" onclick="doDelete()">🗑️ Delete</div>
`;
document.body.appendChild(delPopup);

function setupLongPress(el, data) {
    let t = null, on = false;
    const down = () => { on = true; el.classList.add('pressing'); ctxId = data.id; ctxData = data;
        t = setTimeout(() => { if (!on) return; el.classList.remove('pressing');
            const r = el.getBoundingClientRect(); const p = document.getElementById('delPopup');
            p.querySelector('.danger').style.display = (data.username===ME||myRole==='admin'||myRole==='mod') ? 'flex' : 'none';
            let left = Math.min(r.left, window.innerWidth-190), top = r.top-10;
            if (top<10) top=r.bottom+5; if (top+220>window.innerHeight) top=window.innerHeight-230;
            p.style.left=left+'px'; p.style.top=top+'px'; p.classList.add('on');
            if (navigator.vibrate) navigator.vibrate(25);
        }, 500);
    };
    const up = () => { on=false; el.classList.remove('pressing'); if(t)clearTimeout(t); };
    el.addEventListener('mousedown',down); el.addEventListener('mouseup',up); el.addEventListener('mouseleave',up);
    el.addEventListener('touchstart',down,{passive:true}); el.addEventListener('touchend',up); el.addEventListener('touchcancel',up); el.addEventListener('touchmove',up);
    el.addEventListener('contextmenu',e=>{e.preventDefault();down();setTimeout(up,10);});
}

function closePopups() { document.getElementById('delPopup').classList.remove('on'); document.getElementById('ctxMenu').classList.remove('on'); ctxId=null;ctxData=null; }

document.addEventListener('click', e => {
    if (!e.target.closest('.del-popup')&&!e.target.closest('.msg')) document.getElementById('delPopup').classList.remove('on');
    if (!e.target.closest('.ctx')) document.getElementById('ctxMenu').classList.remove('on');
});

function doReply() { if(!ctxData)return; replyTo=ctxData; document.getElementById('replyTxt').textContent=`↩️ @${ctxData.username}: ${(ctxData.message||'file').substring(0,40)}`; document.getElementById('replyBar').classList.add('on'); msgIn.focus(); closePopups(); }
function cancelReply() { replyTo=null; document.getElementById('replyBar').classList.remove('on'); }
function doCopy() { if(ctxData?.message) navigator.clipboard.writeText(ctxData.message); closePopups(); }
function doDelete() { if(!ctxData)return; if(ctxData.username===ME||myRole==='admin'||myRole==='mod') socket.emit('deleteMessage',{id:ctxId}); closePopups(); }
function doReact(emoji) { if(!ctxId)return; socket.emit('addReaction',{messageId:ctxId,emoji}); closePopups(); }

function updateReacts(id, reacts) { const c=document.getElementById('r'+id); if(!c)return; c.innerHTML=''; Object.keys(reacts).forEach(e=>{if(!reacts[e].length)return; const s=document.createElement('span'); s.className='react-chip'+(reacts[e].includes(ME)?' mine':''); s.textContent=`${e} ${reacts[e].length}`; s.title=reacts[e].join(', '); s.onclick=()=>socket.emit('addReaction',{messageId:id,emoji:e}); c.appendChild(s);}); }

// ==================== DM ====================
function openDM(u) { dmTo=u; document.getElementById('dmTitle').textContent='DM → @'+u; document.getElementById('dmMsgs').innerHTML=''; document.getElementById('dmPanel').classList.add('on'); }
function closeDM() { document.getElementById('dmPanel').classList.remove('on'); dmTo=null; }
function sendDM() { const m=document.getElementById('dmIn').value.trim(); if(!m||!dmTo)return; socket.emit('sendDM',{to:dmTo,message:m}); document.getElementById('dmIn').value=''; }

async function dmImage() { if(!dmTo)return; const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
    inp.onchange=async e=>{const f=e.target.files[0]; if(!f)return; const c=await compressImg(f); const fd=new FormData(); fd.append('chatImage',c);
    try{const r=await fetch('/upload-image',{method:'POST',body:fd}); const d=await r.json(); if(d.success) socket.emit('sendDM',{to:dmTo,image:d.image});}catch(e){}}; inp.click(); }
// DM File Share
async function dmFile() {
    if (!dmTo) return;
    if (!isPrem()) return premBlock('File Share');

    const inp = document.createElement('input');
    inp.type = 'file';
    inp.onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;

        const fd = new FormData();
        fd.append('chatFile', f);

        try {
            const r = await fetch('/upload-file', { method: 'POST', body: fd });
            const d = await r.json();

            if (d.success) {
                socket.emit('sendDM', {
                    to: dmTo,
                    message: '📄 ' + d.fileName + ' (' + (d.fileSize / 1024).toFixed(1) + 'KB)',
                    file: d.file,
                    fileName: d.fileName,
                    fileSize: d.fileSize,
                    type: 'file'
                });
            }
        } catch(err) {
            console.error(err);
        }
    };
    inp.click();
}
function addDMMsg(d) {
    const isMe = d.from === ME;
    const div = document.createElement('div');
    div.className = 'msg ' + (isMe ? 'me' : 'them');
    div.style.maxWidth = '90%';

    let h = `<div class="msg-user">@${d.from}</div>`;

    if (d.type === 'image' && d.image) {
        h += `<div class="bubble" style="padding:3px"><img class="msg-img" src="${d.image}" onclick="viewImg(this)" style="max-width:180px"></div>`;
    } else if (d.type === 'file' && d.file) {
        const kb = d.fileSize ? (d.fileSize / 1024).toFixed(1) : '?';
        h += `<div class="bubble"><div class="file-box" onclick="dlFile('${d.file}','${esc(d.fileName || 'file')}')">📄 <div><div style="font-size:11px;color:#a29bfe">${esc(d.fileName || 'File')}</div><div style="font-size:9px;color:#555">${kb} KB</div></div></div></div>`;
    } else {
        h += `<div class="bubble">${esc(d.message || '')}</div>`;
    }

    h += `<div class="msg-meta"><span>${d.time}</span></div>`;
    div.innerHTML = h;

    const m = document.getElementById('dmMsgs');
    m.appendChild(div);
    m.scrollTop = m.scrollHeight;
}

// ==================== ROOMS ====================
function switchRoom(r) { socket.emit('joinRoom',{currentRoom:curRoom,newRoom:r}); curRoom=r; msgsDiv.innerHTML=''; sysMsg('Joined #'+r); document.getElementById('roomBadge').textContent='💬 '+r; socket.emit('getRooms'); }
function newRoom() { const n=prompt('Room name:'); if(n?.trim()){socket.emit('createRoom',{name:n.trim()});setTimeout(()=>switchRoom(n.trim().toLowerCase().replace(/\s/g,'-')),300);} }

function newPrivRoom() { if(!isPrem()) return premBlock('Private Room');
    const ol=[]; document.querySelectorAll('.uitem').forEach(el=>{const n=el.querySelector('.uname')?.textContent?.replace(/[🛡️⚔️⭐\s@]/g,'').trim(); if(n&&n!==ME)ol.push(n);});
    if(!ol.length){alert('No users!');return;}
    let m=document.getElementById('privModal'); if(m)m.remove();
    m=document.createElement('div'); m.id='privModal'; m.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:2000;display:flex;justify-content:center;align-items:center';
    const uh=ol.map(u=>`<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;background:rgba(255,255,255,0.03);margin-bottom:3px"><input type="checkbox" value="${u}" style="accent-color:#6c63ff"><span style="color:#ccc;font-size:12px">@${u}</span></label>`).join('');
    m.innerHTML=`<div style="background:#141424;border-radius:14px;padding:22px;width:300px;max-width:90%;border:1px solid rgba(255,255,255,0.06)"><h3 style="color:#6c63ff;margin-bottom:12px;font-size:15px">🔒 Private Room</h3><input type="text" id="privName" placeholder="Room name..." style="width:100%;padding:9px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:7px;color:#fff;font-size:12px;outline:none;margin-bottom:10px"><div style="max-height:180px;overflow-y:auto;margin-bottom:12px">${uh}</div><div style="display:flex;gap:8px"><button onclick="submitPriv()" style="flex:1;padding:9px;background:linear-gradient(135deg,#6c63ff,#4834d4);border:none;border-radius:7px;color:#fff;font-size:12px;cursor:pointer">Create</button><button onclick="document.getElementById('privModal').remove()" style="flex:1;padding:9px;background:rgba(255,255,255,0.06);border:none;border-radius:7px;color:#aaa;font-size:12px;cursor:pointer">Cancel</button></div></div>`;
    document.body.appendChild(m);
}

function submitPriv() { const name=document.getElementById('privName')?.value?.trim()||'Private'; const sel=[]; document.querySelectorAll('#privModal input[type=checkbox]:checked').forEach(cb=>sel.push(cb.value)); if(!sel.length){alert('Select users!');return;} socket.emit('createPrivateRoom',{name,members:sel}); document.getElementById('privModal')?.remove(); sysMsg('🔒 '+name+' created'); }

function buildRooms(rooms) { const l=document.getElementById('roomList'); l.innerHTML=''; Object.keys(rooms).forEach(k=>{const d=document.createElement('div'); d.className='room-item'+(k===curRoom?' on':''); d.textContent='💬 '+rooms[k].name; d.onclick=()=>switchRoom(k); l.appendChild(d);}); }
function buildPrivRooms(rooms) { const l=document.getElementById('privRoomList'); l.innerHTML=''; Object.keys(rooms).forEach(k=>{const d=document.createElement('div'); d.className='room-item'+(k===curRoom?' on':''); d.textContent='🔒 '+rooms[k].name; d.onclick=()=>switchRoom(k); l.appendChild(d);}); }

// ==================== USERS ====================
function buildUserList(users,prems,roles) { const l=document.getElementById('userList'); l.innerHTML=''; users.forEach(u=>{if(!u)return; const role=roles[u]||'user'; const d=document.createElement('div'); d.className='uitem'; d.onclick=()=>{if(u!==ME)openDM(u);}; let ic=''; if(role==='admin')ic='🛡️'; else if(role==='mod')ic='⚔️'; else if(prems.includes(u))ic='⭐'; const av=profiles[u]; d.innerHTML=`<div class="uav">${av?`<img src="${av}">`:'👤'}</div><span class="uname">${ic} @${u}</span><div class="udot"></div>`; l.appendChild(d);}); }

function refreshAvatars() { document.querySelectorAll('.uitem').forEach(el=>{const n=el.querySelector('.uname'); if(!n)return; const u=n.textContent.replace(/[🛡️⚔️⭐\s@]/g,'').trim(); if(profiles[u]) el.querySelector('.uav').innerHTML=`<img src="${profiles[u]}">`;}); }

// ==================== SIDEBAR ====================
function toggleSide(type) { const panel=document.getElementById('sidePanel'); document.querySelectorAll('.lbar-item').forEach(i=>i.classList.remove('on'));
    if(curSide===type){closeSide();return;} curSide=type;
    document.getElementById('secRooms').style.display='none'; document.getElementById('secUsers').style.display='none';
    if(type==='all'||type==='rooms'){document.getElementById('sideTitle').textContent='Rooms & Users'; document.getElementById('secRooms').style.display='block'; document.getElementById('secUsers').style.display='block'; document.getElementById(type==='all'?'lb1':'lb2').classList.add('on');}
    else if(type==='users'){document.getElementById('sideTitle').textContent='Online Users'; document.getElementById('secUsers').style.display='block'; document.getElementById('lb3').classList.add('on');}
    panel.classList.add('open'); socket.emit('getRooms');
}
function closeSide() { document.getElementById('sidePanel').classList.remove('open'); document.querySelectorAll('.lbar-item').forEach(i=>i.classList.remove('on')); curSide=null; }

// ==================== EMOJI ====================
const EMOJIS=['😀','😂','😍','🥰','😎','🤔','😢','😡','👍','👎','❤️','🔥','💯','🎉','👻','💀','🙄','😏','🤣','😭','😤','🥺','✨','💪','🙏','👀','🤝','💕','😊','🤗','😈','💩','🫡','🤡','👽','💫','⭐','🌙','🌈','🎵','🎮','🍕','🍦','☕','🌹','🦋','🐱','🌊','🎭'];
const eg=document.getElementById('emojiGrid');
EMOJIS.forEach(e=>{const s=document.createElement('span');s.className='ej';s.textContent=e;s.onclick=()=>{msgIn.value+=e;msgIn.focus();};eg.appendChild(s);});
function toggleEmoji(){document.getElementById('emojiPick').classList.toggle('on');document.getElementById('gifPick').classList.remove('on');}

// ==================== THEME ====================
function toggleTheme(){isDark=!isDark;document.body.classList.toggle('light');document.getElementById('themeBtn').textContent=isDark?'🌙':'☀️';}

// ==================== LOGOUT ====================
function showLogout(){document.getElementById('logoutModal').classList.add('on');}
function doLogout(){sessionStorage.clear();socket.disconnect();window.location.href='/';}

// ==================== PROFILE ====================
let profFile=null;
function openProfile(){document.getElementById('profModal').classList.add('on');if(profiles[ME])document.getElementById('profPrev').innerHTML=`<img src="${profiles[ME]}">`;}
function closeProfile(){document.getElementById('profModal').classList.remove('on');profFile=null;document.getElementById('profSave').style.display='none';}
document.getElementById('profIn').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;profFile=f;const r=new FileReader();r.onload=ev=>{document.getElementById('profPrev').innerHTML=`<img src="${ev.target.result}">`;document.getElementById('profSave').style.display='inline';};r.readAsDataURL(f);});
async function saveProf(){if(!profFile)return;const fd=new FormData();fd.append('profilePic',profFile);fd.append('username',ME);try{const r=await fetch('/upload-profile',{method:'POST',body:fd});const d=await r.json();if(d.success)closeProfile();}catch(e){}}

// ==================== QR ====================
async function toggleQR(){const m=document.getElementById('qrModal');if(m.classList.contains('on')){m.classList.remove('on');return;}const url=window.location.origin;document.getElementById('qrUrl').textContent=url;try{const r=await fetch('/api/qr?url='+encodeURIComponent(url));const d=await r.json();document.getElementById('qrImg').src=d.qr;m.classList.add('on');}catch(e){}}
function dlQR(){const a=document.createElement('a');a.href=document.getElementById('qrImg').src;a.download='df404-qr.png';a.click();}

// ==================== HELPERS ====================
function esc(t){if(!t)return'';const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function linkify(t){return t.replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" style="color:#a29bfe">$1</a>');}
function dlFile(b,n){const a=document.createElement('a');a.href=b;a.download=n;a.click();}
function beep(){try{const ac=new AudioContext(),o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=880;g.gain.setValueAtTime(0.08,ac.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.15);o.start();o.stop(ac.currentTime+0.15);}catch(e){}}
function notify(title,body){if(Notification.permission==='granted')new Notification('DF404 - '+title,{body:(body||'').substring(0,60)});}
if('Notification' in window&&Notification.permission==='default')Notification.requestPermission();

// ==================== EVENTS ====================
document.addEventListener('click',e=>{if(!e.target.closest('.picker')&&!e.target.closest('.tbtn')){document.getElementById('emojiPick').classList.remove('on');document.getElementById('gifPick').classList.remove('on');}});
document.addEventListener('click',e=>{if(window.innerWidth<=768&&curSide&&!e.target.closest('.side')&&!e.target.closest('.lbar'))closeSide();});
window.addEventListener('resize',()=>{msgsDiv.scrollTop=msgsDiv.scrollHeight;});
window.addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='';});

setTimeout(updateUIForRole,1000);
