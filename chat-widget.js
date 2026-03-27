/**
 * Keyify Live Chat Widget
 * Floating chat button + window with email capture & real-time polling.
 * Add <script src="chat-widget.js"></script> before </body> on any public page.
 */
(function () {
  'use strict';

  // Don't init on admin panel
  if (window.location.pathname.includes('admin')) return;

  const API = () => window.KEYIFY_CONFIG?.API_BASE || 'http://localhost:3001/api';

  const STORAGE = {
    getSessionId: () => sessionStorage.getItem('kfy_chat_sid'),
    setSessionId: (id) => sessionStorage.setItem('kfy_chat_sid', id),
    clearSession: () => sessionStorage.removeItem('kfy_chat_sid'),
    getEmail:     () => localStorage.getItem('kfy_chat_email'),
    setEmail:     (e) => localStorage.setItem('kfy_chat_email', e),
    getToken:     () => localStorage.getItem('kfy_token') || sessionStorage.getItem('kfy_token'),
  };

  let _pollInterval = null;
  let _lastMsgCount = 0;
  let _open         = false;

  /* ─────────────────────────────────────────────────────────────
     INJECT STYLES
     All critical FAB rules use !important to override Tailwind
     preflight (which resets button padding, border, display, etc.)
  ───────────────────────────────────────────────────────────── */
  const css = `
    /* ── Keyframes ── */
    @keyframes kfyBounceIn {
      0%   { transform:scale(0) rotate(-15deg); opacity:0; }
      55%  { transform:scale(1.12) rotate(4deg); opacity:1; }
      100% { transform:scale(1) rotate(0deg); opacity:1; }
    }
    @keyframes kfyPulseRing {
      0%   { transform:scale(1); opacity:.55; }
      100% { transform:scale(1.75); opacity:0; }
    }
    @keyframes kfyFadeSlideUp {
      from { transform:translateY(10px) scale(.97); opacity:0; }
      to   { transform:translateY(0) scale(1); opacity:1; }
    }

    /* ── FAB – all !important to beat Tailwind preflight ── */
    #kfy-fab {
      position:fixed !important;
      bottom:24px !important;
      right:24px !important;
      z-index:99999 !important;
      width:56px !important;
      height:56px !important;
      min-width:56px !important;
      min-height:56px !important;
      border-radius:50% !important;
      border:none !important;
      padding:0 !important;
      margin:0 !important;
      outline:none !important;
      cursor:pointer !important;
      background:linear-gradient(135deg,#1D6AFF 0%,#A259FF 100%) !important;
      box-shadow:0 4px 24px rgba(29,106,255,.5),0 2px 8px rgba(0,0,0,.25) !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      overflow:visible !important;
      flex-shrink:0 !important;
      animation:kfyBounceIn .65s cubic-bezier(.34,1.56,.64,1) both !important;
      transition:transform .28s cubic-bezier(.34,1.56,.64,1),
                 box-shadow .28s ease !important;
    }
    #kfy-fab:hover {
      transform:scale(1.1) !important;
      box-shadow:0 8px 32px rgba(29,106,255,.65),0 4px 12px rgba(0,0,0,.3) !important;
    }
    #kfy-fab:active { transform:scale(.95) !important; }

    /* Pulse ring (appears after 1.5s, repeats every 3s) */
    #kfy-fab::after {
      content:'' !important;
      position:absolute !important;
      inset:-2px !important;
      border-radius:50% !important;
      background:rgba(29,106,255,.4) !important;
      animation:kfyPulseRing 2.4s ease-out 1.5s infinite !important;
      pointer-events:none !important;
      z-index:-1 !important;
    }

    /* ── Icon wrapper & transition ── */
    #kfy-fab-icons {
      position:relative !important;
      width:24px !important;
      height:24px !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      pointer-events:none !important;
    }
    #kfy-icon-chat,
    #kfy-icon-close {
      position:absolute !important;
      display:block !important;
      transition:opacity .22s ease, transform .22s cubic-bezier(.34,1.56,.64,1) !important;
      pointer-events:none !important;
    }
    #kfy-icon-chat  { opacity:1 !important; transform:scale(1) rotate(0deg) !important; }
    #kfy-icon-close { opacity:0 !important; transform:scale(.5) rotate(-45deg) !important; }

    #kfy-fab.kfy-open #kfy-icon-chat  { opacity:0 !important; transform:scale(.5) rotate(45deg) !important; }
    #kfy-fab.kfy-open #kfy-icon-close { opacity:1 !important; transform:scale(1) rotate(0deg) !important; }

    /* ── Chat window ── */
    #kfy-chat-win {
      position:fixed !important;
      bottom:92px !important;
      right:24px !important;
      z-index:99998 !important;
      width:360px !important;
      max-height:520px !important;
      border-radius:20px !important;
      overflow:hidden !important;
      box-shadow:0 24px 64px rgba(0,0,0,.38),0 4px 20px rgba(0,0,0,.2) !important;
      display:flex !important;
      flex-direction:column !important;
      opacity:0 !important;
      pointer-events:none !important;
      transform:translateY(14px) scale(.97) !important;
      transition:transform .24s cubic-bezier(.4,0,.2,1),
                 opacity .24s cubic-bezier(.4,0,.2,1) !important;
      font-family:'Inter','Segoe UI',system-ui,sans-serif !important;
    }
    #kfy-chat-win.kfy-visible {
      opacity:1 !important;
      pointer-events:all !important;
      transform:translateY(0) scale(1) !important;
    }

    /* ── Header ── */
    .kfy-header {
      background:#fff;
      padding:14px 16px 0;
      border-bottom:1px solid #f0f0f0;
      flex-shrink:0;
    }
    .kfy-tabs { display:flex; gap:2px; margin-bottom:-1px; }
    .kfy-tab {
      padding:8px 16px;font-size:13px;font-weight:600;
      border:none;background:none;cursor:pointer;
      color:#9ca3af;border-bottom:2px solid transparent;
      border-radius:6px 6px 0 0;
      transition:color .15s,background .15s;
    }
    .kfy-tab.active { color:#1D6AFF; border-bottom-color:#1D6AFF; background:rgba(29,106,255,.05); }

    /* ── Agent row ── */
    .kfy-agent-row {
      background:#fff;padding:12px 16px;
      display:flex;align-items:center;gap:10px;
      border-bottom:1px solid #f3f4f6;flex-shrink:0;
    }
    .kfy-avatars { display:flex; }
    .kfy-avatar {
      width:30px;height:30px;border-radius:50%;border:2px solid #fff;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#fff;margin-left:-7px;
    }
    .kfy-avatars .kfy-avatar:first-child { margin-left:0; }
    .kfy-agent-info { flex:1;min-width:0; }
    .kfy-agent-title { font-size:12px;font-weight:600;color:#111827;line-height:1.3; }
    .kfy-status { display:flex;align-items:center;gap:5px;margin-top:2px; }
    .kfy-dot { width:7px;height:7px;border-radius:50%;background:#10b981;flex-shrink:0; }
    .kfy-status-text { font-size:11px;color:#6b7280; }

    /* ── Message body ── */
    .kfy-body {
      flex:1;overflow-y:auto;background:#f9fafb;
      padding:14px;display:flex;flex-direction:column;
      gap:8px;min-height:160px;max-height:276px;
    }
    .kfy-body::-webkit-scrollbar { width:4px; }
    .kfy-body::-webkit-scrollbar-track { background:transparent; }
    .kfy-body::-webkit-scrollbar-thumb { background:#d1d5db;border-radius:4px; }

    /* ── Bubbles ── */
    .kfy-bubble {
      max-width:82%;padding:9px 13px;border-radius:14px;
      font-size:13px;line-height:1.5;word-break:break-word;
    }
    .kfy-bubble.bot,.kfy-bubble.admin {
      background:#fff;color:#111827;align-self:flex-start;
      border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.07);
    }
    .kfy-bubble.user {
      background:linear-gradient(135deg,#1D6AFF,#4f8fff);color:#fff;
      align-self:flex-end;border-bottom-right-radius:4px;
    }

    /* ── Email capture card ── */
    .kfy-email-card {
      background:#fff;border-radius:14px;padding:16px;margin-top:4px;
      box-shadow:0 1px 4px rgba(0,0,0,.07);
    }
    .kfy-email-card h4 { font-size:13px;font-weight:700;color:#111827;margin:0 0 4px; }
    .kfy-email-card p  { font-size:12px;color:#6b7280;margin:0 0 12px;line-height:1.45; }
    .kfy-email-input {
      width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:10px;
      font-size:13px;outline:none;transition:border-color .15s;
      color:#111827;background:#f9fafb;
      display:block;box-sizing:border-box;
    }
    .kfy-email-input:focus { border-color:#1D6AFF;background:#fff; }
    .kfy-email-btn {
      width:100%;margin-top:10px;padding:10px;border:none;border-radius:10px;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;
      font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;
      display:block;box-sizing:border-box;
    }
    .kfy-email-btn:hover   { opacity:.88; }
    .kfy-email-btn:disabled { opacity:.55;cursor:not-allowed; }
    .kfy-email-err { font-size:11px;color:#ef4444;margin-top:6px;display:none; }

    /* ── Message input row ── */
    .kfy-input-row {
      display:flex;align-items:center;gap:8px;padding:10px 12px;
      background:#fff;border-top:1px solid #f0f0f0;flex-shrink:0;
    }
    .kfy-msg-input {
      flex:1;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:22px;
      font-size:13px;outline:none;resize:none;color:#111827;background:#f9fafb;
      transition:border-color .15s;max-height:80px;overflow-y:auto;
      font-family:inherit;
    }
    .kfy-msg-input:focus { border-color:#1D6AFF;background:#fff; }
    .kfy-send-btn {
      width:36px;height:36px;min-width:36px;flex-shrink:0;
      border:none;border-radius:50%;cursor:pointer;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);
      display:flex;align-items:center;justify-content:center;
      transition:opacity .15s,transform .15s;padding:0;
    }
    .kfy-send-btn:hover   { opacity:.85;transform:scale(1.08); }
    .kfy-send-btn:active  { transform:scale(.93); }
    .kfy-send-btn:disabled { opacity:.45;cursor:not-allowed; }

    /* ── Misc ── */
    .kfy-closed-notice {
      padding:10px 14px;background:#fef3c7;font-size:12px;color:#92400e;
      text-align:center;border-top:1px solid #fde68a;flex-shrink:0;
    }
    .kfy-articles-tab { padding:24px;font-size:13px;color:#9ca3af;text-align:center; }

    @media (max-width:420px) {
      #kfy-chat-win { width:calc(100vw - 20px) !important; right:10px !important; bottom:84px !important; }
      #kfy-fab      { right:14px !important; bottom:16px !important; }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ─────────────────────────────────────────────────────────────
     BUILD DOM
  ───────────────────────────────────────────────────────────── */
  const root = document.createElement('div');
  root.setAttribute('id', 'kfy-widget-root');

  root.innerHTML = `
    <!-- ── Floating action button ── -->
    <button id="kfy-fab" aria-label="Otvori chat podršku" type="button">
      <span id="kfy-fab-icons">
        <!-- Chat icon (default) -->
        <svg id="kfy-icon-chat" width="24" height="24" viewBox="0 0 24 24"
             fill="none" stroke="#ffffff" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <!-- Close icon (shown when open) -->
        <svg id="kfy-icon-close" width="22" height="22" viewBox="0 0 24 24"
             fill="none" stroke="#ffffff" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6"  y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    </button>

    <!-- ── Chat window ── -->
    <div id="kfy-chat-win" role="dialog" aria-modal="true" aria-label="Live chat podrška">

      <!-- Header tabs -->
      <div class="kfy-header">
        <div class="kfy-tabs">
          <button class="kfy-tab active" id="kfy-tab-chat"     type="button" onclick="window._kfyTab('chat')">Razgovor</button>
          <button class="kfy-tab"        id="kfy-tab-articles" type="button" onclick="window._kfyTab('articles')">Članci</button>
        </div>
      </div>

      <!-- Agent row -->
      <div class="kfy-agent-row">
        <div class="kfy-avatars">
          <div class="kfy-avatar" style="background:linear-gradient(135deg,#1D6AFF,#A259FF)">K</div>
          <div class="kfy-avatar" style="background:linear-gradient(135deg,#A259FF,#ff6b9d)">S</div>
        </div>
        <div class="kfy-agent-info">
          <div class="kfy-agent-title">Imate pitanja? Dopisujte se sa nama!</div>
          <div class="kfy-status">
            <span class="kfy-dot"></span>
            <span class="kfy-status-text">Obično odgovorimo za manje od sat vremena</span>
          </div>
        </div>
      </div>

      <!-- ── CHAT PANEL ── -->
      <div id="kfy-panel-chat" style="display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;">

        <!-- Scrollable message area -->
        <div class="kfy-body" id="kfy-body">
          <!-- Welcome bubble (static, never removed) -->
          <div class="kfy-bubble bot">Kako Vam možemo pomoći sa Keyify? 👋</div>

          <!-- Email capture card -->
          <div class="kfy-email-card" id="kfy-email-card">
            <h4>Koja je Vaša imejl adresa?</h4>
            <p>Unesite email kako bismo Vam mogli odgovoriti ako napustite stranicu.</p>
            <input type="email" class="kfy-email-input" id="kfy-email-input"
                   placeholder="vas@email.com" autocomplete="email"/>
            <div class="kfy-email-err" id="kfy-email-err"></div>
            <button class="kfy-email-btn" id="kfy-email-btn" type="button"
                    onclick="window._kfySubmitEmail()">
              Postavi moju imejl adresu
            </button>
          </div>
        </div>

        <!-- Message input (hidden until chat is active) -->
        <div class="kfy-input-row" id="kfy-input-row" style="display:none;">
          <textarea class="kfy-msg-input" id="kfy-msg-input" rows="1"
                    placeholder="Napišite poruku..."></textarea>
          <button class="kfy-send-btn" id="kfy-send-btn" type="button"
                  onclick="window._kfySend()" aria-label="Pošalji poruku">
            <svg width="15" height="15" viewBox="0 0 24 24"
                 fill="none" stroke="#ffffff" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>

        <!-- Closed session notice -->
        <div class="kfy-closed-notice" id="kfy-closed-notice" style="display:none;">
          Ova chat sesija je zatvorena. Osvježite stranicu za novu sesiju.
        </div>
      </div>

      <!-- ── ARTICLES PANEL (placeholder) ── -->
      <div id="kfy-panel-articles" style="display:none;flex:1;overflow-y:auto;background:#f9fafb;">
        <div class="kfy-articles-tab">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
               stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"
               style="display:block;margin:0 auto 10px">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p>Baza znanja — uskoro.</p>
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(root);

  /* ─────────────────────────────────────────────────────────────
     ELEMENT REFERENCES
  ───────────────────────────────────────────────────────────── */
  const fab          = document.getElementById('kfy-fab');
  const win          = document.getElementById('kfy-chat-win');
  const body         = document.getElementById('kfy-body');
  const emailCard    = document.getElementById('kfy-email-card');
  const emailInp     = document.getElementById('kfy-email-input');
  const emailErr     = document.getElementById('kfy-email-err');
  const emailBtn     = document.getElementById('kfy-email-btn');
  const inputRow     = document.getElementById('kfy-input-row');
  const msgInput     = document.getElementById('kfy-msg-input');
  const sendBtn      = document.getElementById('kfy-send-btn');
  const closedNotice = document.getElementById('kfy-closed-notice');

  /* ─────────────────────────────────────────────────────────────
     TOGGLE OPEN / CLOSE
  ───────────────────────────────────────────────────────────── */
  fab.addEventListener('click', () => {
    _open = !_open;
    fab.classList.toggle('kfy-open', _open);
    win.classList.toggle('kfy-visible', _open);
    fab.setAttribute('aria-expanded', String(_open));

    if (_open) {
      _initState();
    } else {
      _stopPoll();
    }
  });

  /* ─────────────────────────────────────────────────────────────
     TAB SWITCHER
  ───────────────────────────────────────────────────────────── */
  window._kfyTab = function (tab) {
    const isChat = tab === 'chat';
    document.getElementById('kfy-panel-chat').style.display     = isChat  ? 'flex' : 'none';
    document.getElementById('kfy-panel-articles').style.display = !isChat ? 'flex' : 'none';
    document.getElementById('kfy-tab-chat').classList.toggle('active', isChat);
    document.getElementById('kfy-tab-articles').classList.toggle('active', !isChat);
  };

  /* ─────────────────────────────────────────────────────────────
     INIT STATE (called when window opens)
  ───────────────────────────────────────────────────────────── */
  function _initState() {
    const sid   = STORAGE.getSessionId();
    const email = STORAGE.getEmail();
    const token = STORAGE.getToken();

    if (sid) {
      // Resume existing session
      _activateChat();
      _loadMessages(sid);
      _startPoll(sid);
    } else if (email) {
      // Previously entered email – auto-start session with it
      _startSession(email);
    } else if (token) {
      // Logged-in user (no email needed – backend reads JWT)
      _startSession(null);
    } else {
      // Guest – show email capture form
      setTimeout(() => emailInp && emailInp.focus(), 220);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     EMAIL CAPTURE
  ───────────────────────────────────────────────────────────── */
  window._kfySubmitEmail = async function () {
    const val = emailInp.value.trim();
    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      _showEmailErr('Unesite ispravnu email adresu.');
      return;
    }
    _showEmailErr('');
    emailBtn.disabled    = true;
    emailBtn.textContent = 'Pokretanje...';
    STORAGE.setEmail(val);
    await _startSession(val);
    emailBtn.disabled    = false;
    emailBtn.textContent = 'Postavi moju imejl adresu';
  };

  emailInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); window._kfySubmitEmail(); }
  });

  function _showEmailErr(msg) {
    emailErr.textContent    = msg;
    emailErr.style.display  = msg ? 'block' : 'none';
  }

  /* ─────────────────────────────────────────────────────────────
     START SESSION
  ───────────────────────────────────────────────────────────── */
  async function _startSession(guestEmail) {
    try {
      const token   = STORAGE.getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res  = await fetch(`${API()}/chat/start`, {
        method: 'POST', headers,
        body: JSON.stringify({ guest_email: guestEmail || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      STORAGE.setSessionId(data.session_id);
      _activateChat();
      _startPoll(data.session_id);
    } catch (err) {
      // If auto-started from token (no email provided) and it failed,
      // silently fall back to email capture form instead of showing an error
      if (!guestEmail) {
        emailCard.style.display = 'block';
        setTimeout(() => emailInp && emailInp.focus(), 50);
        return;
      }
      _showEmailErr(err.message || 'Greška servera. Pokušajte ponovo.');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     ACTIVATE CHAT UI (hide email card, show input row)
  ───────────────────────────────────────────────────────────── */
  function _activateChat() {
    emailCard.style.display = 'none';
    inputRow.style.display  = 'flex';
    setTimeout(() => msgInput && msgInput.focus(), 50);
  }

  /* ─────────────────────────────────────────────────────────────
     SEND MESSAGE
  ───────────────────────────────────────────────────────────── */
  window._kfySend = async function () {
    const sid  = STORAGE.getSessionId();
    const text = msgInput.value.trim();
    if (!sid || !text) return;

    sendBtn.disabled = true;
    msgInput.value   = '';

    _appendBubble('user', text);   // optimistic

    try {
      const res = await fetch(`${API()}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: text }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error?.includes('zatvorena')) _showClosed();
      }
    } catch { /* silent – bubble already shown */ }

    sendBtn.disabled = false;
    msgInput.focus();
  };

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window._kfySend(); }
  });

  /* ─────────────────────────────────────────────────────────────
     POLLING
  ───────────────────────────────────────────────────────────── */
  function _startPoll(sid) {
    _stopPoll();
    _pollInterval = setInterval(() => _loadMessages(sid), 3000);
  }

  function _stopPoll() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  async function _loadMessages(sid) {
    try {
      const res = await fetch(`${API()}/chat/messages/${sid}`);
      if (!res.ok) return;
      const { messages, session_status } = await res.json();

      if (session_status === 'closed') { _showClosed(); _stopPoll(); return; }
      if (messages.length !== _lastMsgCount) {
        _lastMsgCount = messages.length;
        _renderMessages(messages);
      }
    } catch { /* ignore network errors */ }
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER MESSAGES
     Uses data-kfy-msg to distinguish dynamic from static DOM.
  ───────────────────────────────────────────────────────────── */
  function _renderMessages(messages) {
    body.querySelectorAll('[data-kfy-msg]').forEach(el => el.remove());
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className       = `kfy-bubble ${m.sender === 'admin' ? 'admin' : 'user'}`;
      div.textContent     = m.message;
      div.dataset.kfyMsg  = '1';
      body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
  }

  function _appendBubble(sender, text) {
    const div = document.createElement('div');
    div.className      = `kfy-bubble ${sender}`;
    div.textContent    = text;
    div.dataset.kfyMsg = '1';
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function _showClosed() {
    inputRow.style.display     = 'none';
    closedNotice.style.display = 'block';
    STORAGE.clearSession();
    _stopPoll();
  }

})();
