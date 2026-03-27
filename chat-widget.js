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
    getEmail: () => localStorage.getItem('kfy_chat_email'),
    setEmail: (e) => localStorage.setItem('kfy_chat_email', e),
    getToken: () => localStorage.getItem('kfy_token') || sessionStorage.getItem('kfy_token'),
  };

  let _pollInterval = null;
  let _lastMsgCount = 0;
  let _open = false;

  /* ── INJECT STYLES ─────────────────────────────────────────── */
  const css = `
    #kfy-fab {
      position:fixed;bottom:24px;right:24px;z-index:9998;
      width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);
      box-shadow:0 4px 20px rgba(29,106,255,0.45);
      display:flex;align-items:center;justify-content:center;
      transition:transform .2s,box-shadow .2s;
    }
    #kfy-fab:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(29,106,255,0.55); }
    #kfy-fab svg { pointer-events:none; transition:opacity .15s; }
    #kfy-chat-win {
      position:fixed;bottom:92px;right:24px;z-index:9997;
      width:360px;max-height:520px;
      border-radius:20px;overflow:hidden;
      box-shadow:0 20px 60px rgba(0,0,0,0.35),0 4px 20px rgba(0,0,0,0.2);
      display:flex;flex-direction:column;
      transform:translateY(12px) scale(0.97);opacity:0;pointer-events:none;
      transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s cubic-bezier(.4,0,.2,1);
      font-family:'Inter','Segoe UI',sans-serif;
    }
    #kfy-chat-win.kfy-visible {
      transform:translateY(0) scale(1);opacity:1;pointer-events:all;
    }
    .kfy-header {
      background:#fff;padding:16px 16px 0;border-bottom:1px solid #f0f0f0;
    }
    .kfy-tabs { display:flex;gap:4px;margin-bottom:-1px; }
    .kfy-tab {
      padding:8px 14px;font-size:13px;font-weight:600;border:none;background:none;
      cursor:pointer;border-radius:8px 8px 0 0;color:#6b7280;transition:color .15s,background .15s;
      border-bottom:2px solid transparent;
    }
    .kfy-tab.active { color:#1D6AFF;border-bottom-color:#1D6AFF;background:rgba(29,106,255,0.05); }
    .kfy-agent-row {
      background:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;
      border-bottom:1px solid #f5f5f5;
    }
    .kfy-avatars { display:flex; }
    .kfy-avatar {
      width:32px;height:32px;border-radius:50%;border:2px solid #fff;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);
      display:flex;align-items:center;justify-content:center;
      font-size:12px;font-weight:700;color:#fff;margin-left:-8px;
    }
    .kfy-avatars .kfy-avatar:first-child { margin-left:0; }
    .kfy-agent-info { flex:1;min-width:0; }
    .kfy-agent-title { font-size:12px;font-weight:600;color:#111827;line-height:1.3; }
    .kfy-status { display:flex;align-items:center;gap:5px;margin-top:2px; }
    .kfy-dot { width:7px;height:7px;border-radius:50%;background:#10b981;flex-shrink:0; }
    .kfy-status-text { font-size:11px;color:#6b7280; }
    .kfy-body {
      flex:1;overflow-y:auto;background:#f9fafb;padding:14px;
      display:flex;flex-direction:column;gap:8px;min-height:160px;max-height:280px;
    }
    .kfy-body::-webkit-scrollbar { width:4px; }
    .kfy-body::-webkit-scrollbar-track { background:transparent; }
    .kfy-body::-webkit-scrollbar-thumb { background:#d1d5db;border-radius:4px; }
    .kfy-bubble {
      max-width:82%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.45;
      word-break:break-word;
    }
    .kfy-bubble.bot, .kfy-bubble.admin {
      background:#fff;color:#111827;align-self:flex-start;
      border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.07);
    }
    .kfy-bubble.user {
      background:linear-gradient(135deg,#1D6AFF,#4f8fff);color:#fff;
      align-self:flex-end;border-bottom-right-radius:4px;
    }
    .kfy-email-card {
      background:#fff;border-radius:14px;padding:16px;margin-top:4px;
      box-shadow:0 1px 4px rgba(0,0,0,0.07);
    }
    .kfy-email-card h4 { font-size:13px;font-weight:700;color:#111827;margin:0 0 4px; }
    .kfy-email-card p { font-size:12px;color:#6b7280;margin:0 0 12px;line-height:1.4; }
    .kfy-email-input {
      width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:10px;
      font-size:13px;outline:none;transition:border-color .15s;color:#111827;
      background:#f9fafb;
    }
    .kfy-email-input:focus { border-color:#1D6AFF;background:#fff; }
    .kfy-email-btn {
      width:100%;margin-top:10px;padding:10px;border:none;border-radius:10px;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;
      font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;
    }
    .kfy-email-btn:hover { opacity:.9; }
    .kfy-email-btn:disabled { opacity:.6;cursor:not-allowed; }
    .kfy-email-err { font-size:11px;color:#ef4444;margin-top:6px;display:none; }
    .kfy-input-row {
      display:flex;align-items:center;gap:8px;padding:10px 12px;
      background:#fff;border-top:1px solid #f0f0f0;
    }
    .kfy-msg-input {
      flex:1;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:22px;
      font-size:13px;outline:none;resize:none;color:#111827;background:#f9fafb;
      transition:border-color .15s;max-height:80px;overflow-y:auto;
    }
    .kfy-msg-input:focus { border-color:#1D6AFF;background:#fff; }
    .kfy-send-btn {
      width:36px;height:36px;flex-shrink:0;border:none;border-radius:50%;cursor:pointer;
      background:linear-gradient(135deg,#1D6AFF,#A259FF);
      display:flex;align-items:center;justify-content:center;transition:opacity .15s;
    }
    .kfy-send-btn:hover { opacity:.85; }
    .kfy-send-btn:disabled { opacity:.5;cursor:not-allowed; }
    .kfy-closed-notice {
      padding:10px 14px;background:#fef3c7;font-size:12px;color:#92400e;
      text-align:center;border-top:1px solid #fde68a;
    }
    .kfy-articles-tab { padding:20px;font-size:13px;color:#6b7280;text-align:center; }
    @media (max-width:400px) {
      #kfy-chat-win { width:calc(100vw - 20px);right:10px;bottom:80px; }
      #kfy-fab { right:10px;bottom:12px; }
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── BUILD DOM ──────────────────────────────────────────────── */
  const root = document.createElement('div');
  root.id = 'kfy-widget-root';
  root.innerHTML = `
    <!-- Floating button -->
    <button id="kfy-fab" aria-label="Otvori chat">
      <svg id="kfy-icon-chat" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.862 9.862 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
      </svg>
      <svg id="kfy-icon-close" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2.5" style="display:none">
        <path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>

    <!-- Chat window -->
    <div id="kfy-chat-win" role="dialog" aria-label="Live chat">

      <!-- Header -->
      <div class="kfy-header">
        <div class="kfy-tabs">
          <button class="kfy-tab active" id="kfy-tab-chat" onclick="window._kfyTab('chat')">Razgovor</button>
          <button class="kfy-tab"        id="kfy-tab-articles" onclick="window._kfyTab('articles')">Članci</button>
        </div>
      </div>

      <!-- Agent row -->
      <div class="kfy-agent-row">
        <div class="kfy-avatars">
          <div class="kfy-avatar">K</div>
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

      <!-- Chat tab content -->
      <div id="kfy-panel-chat" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">

        <!-- Message body -->
        <div class="kfy-body" id="kfy-body">
          <div class="kfy-bubble bot">Kako Vam možemo pomoći sa Keyify? 👋</div>

          <!-- Email capture card (shown until email is set) -->
          <div class="kfy-email-card" id="kfy-email-card">
            <h4>Koja je Vaša imejl adresa?</h4>
            <p>Unesite email kako bismo Vam mogli odgovoriti ako napustite stranicu.</p>
            <input type="email" class="kfy-email-input" id="kfy-email-input"
                   placeholder="vas@email.com" autocomplete="email"/>
            <div class="kfy-email-err" id="kfy-email-err"></div>
            <button class="kfy-email-btn" id="kfy-email-btn" onclick="window._kfySubmitEmail()">
              Postavi moju imejl adresu
            </button>
          </div>
        </div>

        <!-- Message input (hidden until chat is active) -->
        <div class="kfy-input-row" id="kfy-input-row" style="display:none;">
          <textarea class="kfy-msg-input" id="kfy-msg-input" rows="1"
                    placeholder="Napišite poruku..."></textarea>
          <button class="kfy-send-btn" id="kfy-send-btn" onclick="window._kfySend()" aria-label="Pošalji">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
          </button>
        </div>

        <!-- Closed session notice -->
        <div class="kfy-closed-notice" id="kfy-closed-notice" style="display:none;">
          Ova chat sesija je zatvorena. Osvježite stranicu za novu sesiju.
        </div>
      </div>

      <!-- Articles tab content (placeholder) -->
      <div id="kfy-panel-articles" style="display:none;flex:1;">
        <div class="kfy-articles-tab">
          <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#d1d5db" stroke-width="1.5" style="margin:0 auto 10px">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p style="color:#9ca3af;font-size:13px;">Baza znanja uskoro.</p>
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(root);

  /* ── REFERENCES ─────────────────────────────────────────────── */
  const fab       = document.getElementById('kfy-fab');
  const win       = document.getElementById('kfy-chat-win');
  const body      = document.getElementById('kfy-body');
  const emailCard = document.getElementById('kfy-email-card');
  const emailInp  = document.getElementById('kfy-email-input');
  const emailErr  = document.getElementById('kfy-email-err');
  const emailBtn  = document.getElementById('kfy-email-btn');
  const inputRow  = document.getElementById('kfy-input-row');
  const msgInput  = document.getElementById('kfy-msg-input');
  const sendBtn   = document.getElementById('kfy-send-btn');
  const closedNotice = document.getElementById('kfy-closed-notice');

  /* ── TOGGLE ─────────────────────────────────────────────────── */
  fab.addEventListener('click', () => {
    _open = !_open;
    win.classList.toggle('kfy-visible', _open);
    document.getElementById('kfy-icon-chat').style.display  = _open ? 'none'  : '';
    document.getElementById('kfy-icon-close').style.display = _open ? ''      : 'none';
    if (_open) {
      _initState();
      emailInp && emailInp.focus();
    } else {
      _stopPoll();
    }
  });

  /* ── TAB SWITCHER ────────────────────────────────────────────── */
  window._kfyTab = function (tab) {
    document.getElementById('kfy-panel-chat').style.display     = tab === 'chat'     ? 'flex'  : 'none';
    document.getElementById('kfy-panel-articles').style.display = tab === 'articles' ? 'flex'  : 'none';
    document.getElementById('kfy-tab-chat').classList.toggle('active',     tab === 'chat');
    document.getElementById('kfy-tab-articles').classList.toggle('active', tab === 'articles');
  };

  /* ── INIT STATE ─────────────────────────────────────────────── */
  function _initState() {
    const sid   = STORAGE.getSessionId();
    const email = STORAGE.getEmail();
    const token = STORAGE.getToken();

    if (sid) {
      // Resume existing session
      _activateChat();
      _loadMessages(sid);
      _startPoll(sid);
    } else if (token || email) {
      // User is logged in or has provided email before – start session automatically
      _startSession(email);
    }
    // Otherwise: email capture card is already visible (default state)
  }

  /* ── EMAIL SUBMIT ────────────────────────────────────────────── */
  window._kfySubmitEmail = async function () {
    const email = emailInp.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailErr.textContent = 'Unesite ispravnu email adresu.';
      emailErr.style.display = 'block';
      return;
    }
    emailErr.style.display = 'none';
    emailBtn.disabled = true;
    emailBtn.textContent = 'Pokretanje...';
    STORAGE.setEmail(email);
    await _startSession(email);
    emailBtn.disabled = false;
    emailBtn.textContent = 'Postavi moju imejl adresu';
  };

  emailInp && emailInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); window._kfySubmitEmail(); }
  });

  /* ── START SESSION ──────────────────────────────────────────── */
  async function _startSession(guestEmail) {
    try {
      const token = STORAGE.getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API()}/chat/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ guest_email: guestEmail || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      STORAGE.setSessionId(data.session_id);
      _activateChat();
      _startPoll(data.session_id);
    } catch (err) {
      emailErr.textContent = err.message || 'Greška. Pokušajte ponovo.';
      emailErr.style.display = 'block';
    }
  }

  /* ── ACTIVATE CHAT UI ────────────────────────────────────────── */
  function _activateChat() {
    emailCard.style.display = 'none';
    inputRow.style.display  = 'flex';
    msgInput && msgInput.focus();
  }

  /* ── SEND MESSAGE ────────────────────────────────────────────── */
  window._kfySend = async function () {
    const sid = STORAGE.getSessionId();
    const text = msgInput.value.trim();
    if (!sid || !text) return;

    sendBtn.disabled = true;
    msgInput.value   = '';

    // Optimistic bubble
    _appendBubble('user', text);

    try {
      const res = await fetch(`${API()}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: text }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error?.includes('zatvorena')) {
          _showClosed();
        }
      }
    } catch { /* silent – optimistic bubble already shown */ }

    sendBtn.disabled = false;
    msgInput.focus();
  };

  msgInput && msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window._kfySend(); }
  });

  /* ── POLLING ─────────────────────────────────────────────────── */
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

  function _renderMessages(messages) {
    // Remove existing message bubbles (keep welcome bubble)
    const existing = body.querySelectorAll('.kfy-bubble:not(.bot), .kfy-bubble.bot ~ .kfy-bubble');
    existing.forEach(el => el.remove());

    // Re-render all messages
    messages.forEach(m => {
      const isAdmin = m.sender === 'admin';
      const div = document.createElement('div');
      div.className = `kfy-bubble ${isAdmin ? 'admin' : 'user'}`;
      div.textContent = m.message;
      body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
  }

  function _appendBubble(sender, text) {
    const div = document.createElement('div');
    div.className = `kfy-bubble ${sender}`;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function _showClosed() {
    inputRow.style.display        = 'none';
    closedNotice.style.display    = 'block';
    STORAGE.clearSession();
  }

})();
