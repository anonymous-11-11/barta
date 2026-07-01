// ==================== DF404 PROTECTION ====================
(function() {
    'use strict';

    // ===== 1. Right Click Block =====
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
    });

    // ===== 2. Keyboard Shortcuts Block =====
    document.addEventListener('keydown', function(e) {
        // F12
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+I (Inspect)
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+J (Console)
        if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+C (Element picker)
        if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+U (View source)
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+S (Save page)
        if (e.ctrlKey && (e.key === 'S' || e.key === 's' || e.keyCode === 83)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+P (Print)
        if (e.ctrlKey && (e.key === 'P' || e.key === 'p' || e.keyCode === 80)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+K (Firefox console)
        if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k' || e.keyCode === 75)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+M (Responsive mode)
        if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm' || e.keyCode === 77)) {
            e.preventDefault();
            return false;
        }

        // F5 allow (refresh)
        // Ctrl+R allow (refresh)
        // But block Ctrl+Shift+R
        if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
            // Allow hard refresh
        }
    });

    // ===== 3. Text Selection Block =====
    document.addEventListener('selectstart', function(e) {
        // Allow input/textarea selection
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return true;
        }
        e.preventDefault();
        return false;
    });

    // ===== 4. Copy Block =====
    document.addEventListener('copy', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return true;
        }
        e.preventDefault();
        return false;
    });

    // ===== 5. Drag Block =====
    document.addEventListener('dragstart', function(e) {
        e.preventDefault();
        return false;
    });

    // ===== 6. DevTools Detection =====
    let devToolsOpen = false;

    // Method 1: Window size check
    function checkDevTools() {
        const widthThreshold = window.outerWidth - window.innerWidth > 160;
        const heightThreshold = window.outerHeight - window.innerHeight > 160;

        if (widthThreshold || heightThreshold) {
            if (!devToolsOpen) {
                devToolsOpen = true;
                onDevToolsOpen();
            }
        } else {
            devToolsOpen = false;
        }
    }

    // Method 2: Console.log detection
    function checkConsole() {
        const el = new Image();
        Object.defineProperty(el, 'id', {
            get: function() {
                devToolsOpen = true;
                onDevToolsOpen();
            }
        });
        console.log('%c', el);
    }

    // Method 3: Debugger detection
    function checkDebugger() {
        const start = performance.now();
        debugger;
        const end = performance.now();
        if (end - start > 100) {
            onDevToolsOpen();
        }
    }

    function onDevToolsOpen() {
        // Option 1: Show warning
        document.body.innerHTML = `
            <div style="
                display:flex;
                justify-content:center;
                align-items:center;
                height:100vh;
                background:#0a0a0a;
                color:#ff4757;
                font-family:'Segoe UI',sans-serif;
                text-align:center;
                flex-direction:column;
                padding:20px;
            ">
                <div style="font-size:60px;margin-bottom:20px">🚫</div>
                <h1 style="font-size:24px;margin-bottom:10px">Access Denied</h1>
                <p style="color:#666;font-size:14px">Developer tools are not allowed.</p>
                <p style="color:#444;font-size:12px;margin-top:20px">Close DevTools and refresh the page.</p>
            </div>
        `;

        // Option 2: Redirect
        // window.location.href = '/';

        // Option 3: Clear page and close
        // window.close();
    }

    // Run checks periodically
    setInterval(checkDevTools, 1000);
    setInterval(checkConsole, 2000);

    // ===== 7. Console Warning =====
    console.log(
        '%c⚠️ STOP!',
        'color:#ff4757;font-size:40px;font-weight:bold;'
    );
    console.log(
        '%cThis is a restricted area. Any unauthorized access will be logged.',
        'color:#666;font-size:14px;'
    );
    console.log(
        '%cDF404 Security System Active',
        'color:#6c63ff;font-size:12px;font-weight:bold;'
    );

    // ===== 8. CSS Protection =====
    const style = document.createElement('style');
    style.textContent = `
        * {
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
        }

        input, textarea {
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
        }

        img {
            -webkit-user-drag: none !important;
            pointer-events: auto !important;
        }
    `;
    document.head.appendChild(style);

    // ===== 9. Disable View Source =====
    document.onkeypress = function(e) {
        if (e.ctrlKey && (e.charCode === 117 || e.charCode === 85)) {
            return false;
        }
    };

    // ===== 10. IFrame Protection =====
    if (window.self !== window.top) {
        window.top.location = window.self.location;
    }

})();