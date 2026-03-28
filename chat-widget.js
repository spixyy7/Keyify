/**
 * Keyify Live Chat Widget
 * Floating chat button + window with email capture & real-time polling.
 * Add <script src="chat-widget.js"></script> before </body> on any public page.
 */
(function () {
  'use strict';

  // Don't init on admin panel
  if (window.location.pathname.includes('admin')) return;

  const API = () => {
    // Ako postoji custom config, koristi njega
    if (window.KEYIFY_CONFIG?.API_BASE) return window.KEYIFY_CONFIG.API_BASE;

    // Ako si na svom kompjuteru (localhost), gađaj port 3001
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3001/api';
    }

    // Za Railway i pravi domen, koristi relativnu putanju
    return '/api';
  };

  const STORAGE = {
    getSessionId: () => sessionStorage.getItem('kfy_chat_sid'),
    setSessionId: (id) => sessionStorage.setItem('kfy_chat_sid', id),
    clearSession: () => sessionStorage.removeItem('kfy_chat_sid'),
    getEmail: () => {
      try {
        const raw = localStorage.getItem('kfy_chat_email');
        if (!raw) return null;
        const { email, ts } = JSON.parse(raw);
        // Expire after 10 minutes
        if (Date.now() - ts > 10 * 60 * 1000) {
          localStorage.removeItem('kfy_chat_email');
          return null;
        }
        return email;
      } catch {
        // Legacy plain-string value — treat as expired, clear it
        localStorage.removeItem('kfy_chat_email');
        return null;
      }
    },
    setEmail: (e) => localStorage.setItem(
      'kfy_chat_email',
      JSON.stringify({ email: e, ts: Date.now() })
    ),
    getAnonId: () => sessionStorage.getItem('kfy_chat_anon'),
    setAnonId: (id) => sessionStorage.setItem('kfy_chat_anon', id),
    getToken:  () => localStorage.getItem('keyify_token') || sessionStorage.getItem('keyify_token'),
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
      width:368px !important;
      max-height:540px !important;
      border-radius:22px !important;
      overflow:hidden !important;
      box-shadow:0 32px 80px rgba(0,0,0,.32),0 8px 24px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.05) !important;
      display:flex !important;
      flex-direction:column !important;
      opacity:0 !important;
      pointer-events:none !important;
      transform:translateY(16px) scale(.96) !important;
      transition:transform .28s cubic-bezier(.34,1.56,.64,1),
                 opacity .22s cubic-bezier(.4,0,.2,1) !important;
      font-family:'Inter','Segoe UI',system-ui,sans-serif !important;
    }
    #kfy-chat-win.kfy-visible {
      opacity:1 !important;
      pointer-events:all !important;
      transform:translateY(0) scale(1) !important;
    }

    /* ── Guest email gate (full-screen inside chat window) ── */
    #kfy-guest-gate {
      position:absolute !important;
      inset:0 !important;
      z-index:10 !important;
      display:flex !important;
      flex-direction:column !important;
      align-items:center !important;
      justify-content:center !important;
      padding:28px 24px !important;
      background:var(--kfy-header-bg,#fff) !important;
      text-align:center !important;
      transition:background .25s ease !important;
    }
    #kfy-guest-gate.kfy-gate-hidden { display:none !important; }
    .kfy-gate-icon {
      width:56px;height:56px;border-radius:16px;margin-bottom:16px;
      background:linear-gradient(135deg,#3b82f6,#60a5fa);
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      box-shadow:0 8px 24px rgba(59,130,246,0.35);
    }
    .kfy-gate-title {
      font-size:17px;font-weight:700;margin-bottom:6px;
      color:var(--kfy-agent-title,#111827);line-height:1.3;
    }
    .kfy-gate-sub {
      font-size:12px;color:var(--kfy-inp-ph,#9ca3af);margin-bottom:20px;line-height:1.5;
    }
    .kfy-gate-input {
      width:100%;padding:11px 14px;border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:12px;font-size:13px;outline:none;box-sizing:border-box;
      color:var(--kfy-inp-color,#111827);background:var(--kfy-inp-bg,#f9fafb);
      font-family:inherit;transition:border-color .15s,box-shadow .15s;
      margin-bottom:10px;
    }
    .kfy-gate-input::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-gate-input:focus { border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.12);background:var(--kfy-inp-focus-bg,#fff); }
    .kfy-gate-btn {
      width:100%;padding:12px;border:none;border-radius:12px;
      background:linear-gradient(135deg,#3b82f6,#60a5fa);color:#fff;
      font-size:14px;font-weight:700;cursor:pointer;
      box-shadow:0 4px 14px rgba(59,130,246,0.40);
      transition:opacity .15s,transform .1s;letter-spacing:.01em;
    }
    .kfy-gate-btn:hover   { opacity:.9;transform:translateY(-1px); }
    .kfy-gate-btn:active  { transform:translateY(0); }
    .kfy-gate-btn:disabled { opacity:.45;cursor:not-allowed;transform:none; }
    .kfy-gate-err { font-size:11px;color:#ef4444;margin-top:6px;text-align:left;display:none; }
    .kfy-gate-skip {
      margin-top:12px;font-size:11px;color:var(--kfy-inp-ph,#9ca3af);
      cursor:pointer;text-decoration:underline;background:none;border:none;
      font-family:inherit;
    }
    .kfy-gate-skip:hover { color:#3b82f6; }

    /* ── Header (theme-aware via CSS variables) ── */
    .kfy-header {
      background:var(--kfy-header-bg,#fff);
      padding:14px 16px 0;
      border-bottom:1px solid var(--kfy-header-border,rgba(0,0,0,0.07));
      flex-shrink:0;
      transition:background .25s ease,border-color .25s ease;
    }
    .kfy-tabs { display:flex; gap:2px; margin-bottom:-1px; }
    .kfy-tab {
      padding:8px 16px;font-size:13px;font-weight:600;
      border:none;background:none;cursor:pointer;
      color:var(--kfy-tab-color,#9ca3af);border-bottom:2px solid transparent;
      border-radius:6px 6px 0 0;
      transition:color .15s,background .15s;
    }
    .kfy-tab.active { color:var(--kfy-tab-active,#1D6AFF); border-bottom-color:var(--kfy-tab-active,#1D6AFF); background:rgba(29,106,255,.06); }
    .kfy-tab:hover:not(.active) { color:var(--kfy-tab-hover,#374151); }

    /* ── Agent row ── */
    .kfy-agent-row {
      background:var(--kfy-agent-bg,#fff);
      padding:12px 16px;
      display:flex;align-items:center;gap:10px;
      border-bottom:1px solid var(--kfy-agent-border,#f3f4f6);
      flex-shrink:0;
      transition:background .25s ease;
    }
    .kfy-avatars { display:flex; }
    .kfy-avatar {
      width:30px;height:30px;border-radius:50%;
      border:2px solid var(--kfy-avatar-border,#fff);
      background:linear-gradient(135deg,#1D6AFF,#A259FF);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#fff;margin-left:-7px;
    }
    .kfy-avatars .kfy-avatar:first-child { margin-left:0; }
    .kfy-agent-info { flex:1;min-width:0; }
    .kfy-agent-title { font-size:12px;font-weight:600;color:var(--kfy-agent-title,#111827);line-height:1.3; }
    .kfy-status { display:flex;align-items:center;gap:5px;margin-top:2px; }
    .kfy-dot { width:7px;height:7px;border-radius:50%;background:#10b981;flex-shrink:0;box-shadow:0 0 5px #10b981; }
    .kfy-status-text { font-size:11px;color:#6b7280; }

    /* ── Message body ── */
    .kfy-body {
      flex:1;overflow-y:auto;
      background:var(--kfy-body-bg,#f9fafb);
      padding:14px;display:flex;flex-direction:column;
      gap:8px;min-height:160px;max-height:276px;
      transition:background .25s ease;
    }
    .kfy-body::-webkit-scrollbar { width:4px; }
    .kfy-body::-webkit-scrollbar-track { background:transparent; }
    .kfy-body::-webkit-scrollbar-thumb { background:var(--kfy-scrollbar,#d1d5db);border-radius:4px; }

    /* ── Bubbles ── */
    .kfy-bubble {
      max-width:82%;padding:9px 13px;border-radius:14px;
      font-size:13px;line-height:1.5;word-break:break-word;
      transition:background .25s ease,color .25s ease;
    }
    .kfy-bubble.bot,.kfy-bubble.admin {
      background:var(--kfy-bubble-bot-bg,#fff);
      color:var(--kfy-bubble-bot-color,#111827);
      align-self:flex-start;
      border-bottom-left-radius:4px;
      border:1px solid var(--kfy-bubble-bot-bdr,transparent);
      box-shadow:var(--kfy-bubble-bot-shad,0 1px 4px rgba(0,0,0,.07));
    }
    .kfy-bubble.user {
      background:linear-gradient(135deg,#3b82f6,#60a5fa);color:#fff;
      align-self:flex-end;border-bottom-right-radius:4px;
      box-shadow:0 4px 12px rgba(59,130,246,0.35);
    }

    /* ── System card (ask_email, confirmations) ── */
    .kfy-system-card {
      background:var(--kfy-email-card-bg,#fff);
      border-radius:12px;padding:12px 14px;margin-top:4px;
      border:1px solid rgba(59,130,246,0.25);
      box-shadow:0 1px 6px rgba(59,130,246,.10);
      transition:background .25s ease;
    }

    /* ── Email capture card ── */
    .kfy-email-card {
      background:var(--kfy-email-card-bg,#fff);
      border-radius:14px;padding:16px;margin-top:4px;
      border:1px solid var(--kfy-email-card-bdr,transparent);
      box-shadow:var(--kfy-email-card-shad,0 1px 4px rgba(0,0,0,.07));
      transition:background .25s ease;
    }
    .kfy-email-card h4 { font-size:13px;font-weight:700;color:var(--kfy-email-h4,#111827);margin:0 0 4px; }
    .kfy-email-card p  { font-size:12px;color:var(--kfy-email-p,#6b7280);margin:0 0 12px;line-height:1.45; }
    .kfy-email-input {
      width:100%;padding:9px 12px;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:10px;font-size:13px;outline:none;
      transition:border-color .15s,box-shadow .15s,background .25s;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      display:block;box-sizing:border-box;
    }
    .kfy-email-input::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-email-input:focus { border-color:#1D6AFF;background:var(--kfy-inp-focus-bg,#fff);box-shadow:0 0 0 3px rgba(29,106,255,0.1); }
    .kfy-email-btn {
      width:100%;margin-top:10px;padding:11px;border:none;border-radius:10px;
      background:linear-gradient(135deg,#3b82f6,#60a5fa);color:#fff;
      font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s,transform .1s;
      display:block;box-sizing:border-box;box-shadow:0 4px 14px rgba(59,130,246,0.35);
      letter-spacing:.01em;
    }
    .kfy-email-btn:hover   { opacity:.88;transform:translateY(-1px); }
    .kfy-email-btn:active  { transform:translateY(0); }
    .kfy-email-btn:disabled { opacity:.45;cursor:not-allowed;transform:none; }
    .kfy-email-err { font-size:11px;color:#ef4444;margin-top:6px;display:none; }

    /* ── Message input row ── */
    .kfy-input-row {
      display:flex;align-items:center;gap:8px;padding:10px 12px;
      background:var(--kfy-row-bg,#fff);
      border-top:1px solid var(--kfy-row-border,#f0f0f0);
      flex-shrink:0;
      transition:background .25s ease;
    }
    .kfy-msg-input {
      flex:1;padding:9px 12px;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:22px;font-size:13px;outline:none;resize:none;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      transition:border-color .15s,box-shadow .15s,background .25s;
      max-height:80px;overflow-y:auto;font-family:inherit;
    }
    .kfy-msg-input::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-msg-input:focus { border-color:#1D6AFF;background:var(--kfy-inp-focus-bg,#fff);box-shadow:0 0 0 3px rgba(29,106,255,0.08); }
    .kfy-send-btn {
      width:36px;height:36px;min-width:36px;flex-shrink:0;
      border:none;border-radius:50%;cursor:pointer;
      background:linear-gradient(135deg,#3b82f6,#60a5fa);
      display:flex;align-items:center;justify-content:center;
      transition:opacity .15s,transform .15s;padding:0;
      box-shadow:0 2px 8px rgba(59,130,246,0.35);
    }
    .kfy-send-btn:hover   { opacity:.85;transform:scale(1.08); }
    .kfy-send-btn:active  { transform:scale(.93); }
    .kfy-send-btn:disabled { opacity:.45;cursor:not-allowed; }

    /* ── Misc ── */
    .kfy-closed-notice {
      padding:16px 14px;background:var(--kfy-closed-bg,#fef3c7);font-size:12px;color:var(--kfy-closed-color,#92400e);
      text-align:center;border-top:1px solid var(--kfy-closed-bdr,#fde68a);flex-shrink:0;
    }
    .kfy-closed-notice .kfy-new-session-btn {
      display:inline-block;margin-top:8px;padding:8px 20px;border:none;border-radius:8px;
      background:#1D6AFF;color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s;
    }
    .kfy-closed-notice .kfy-new-session-btn:hover { opacity:.85; }
    .kfy-closed-notice .kfy-new-choice { display:flex;gap:8px;justify-content:center;margin-top:10px; }
    .kfy-closed-notice .kfy-choice-btn {
      padding:7px 14px;border:1px solid var(--kfy-closed-bdr,#fde68a);border-radius:8px;
      background:transparent;color:var(--kfy-closed-color,#92400e);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;
    }
    .kfy-closed-notice .kfy-choice-btn:hover { background:rgba(29,106,255,0.1);border-color:#1D6AFF;color:#1D6AFF; }
    .kfy-closed-notice .kfy-guest-email-row {
      display:flex;gap:6px;margin-top:10px;justify-content:center;
    }
    .kfy-closed-notice .kfy-guest-email-row input {
      padding:6px 10px;border:1px solid var(--kfy-closed-bdr,#fde68a);border-radius:6px;
      font-size:11px;width:180px;outline:none;background:var(--kfy-inp-bg,#fff);color:var(--kfy-inp-color,#111);
    }
    .kfy-closed-notice .kfy-guest-email-row input:focus { border-color:#1D6AFF; }
    .kfy-closed-notice .kfy-guest-email-row button {
      padding:6px 12px;border:none;border-radius:6px;background:#1D6AFF;color:#fff;font-size:11px;font-weight:600;cursor:pointer;
    }
    .kfy-closed-err { color:#ef4444;font-size:11px;margin-top:6px; }
    .kfy-articles-tab { padding:24px;font-size:13px;color:var(--kfy-articles-color,#9ca3af);text-align:center;background:var(--kfy-articles-bg,#f9fafb); }

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

      <!-- Guest Email Gate (covers window until email submitted) -->
      <div id="kfy-guest-gate" class="kfy-gate-hidden">
        <div class="kfy-gate-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="kfy-gate-title">Počnite razgovor</div>
        <div class="kfy-gate-sub">Unesite email kako bismo vam mogli odgovoriti i čuvali historiju razgovora.</div>
        <input type="email" id="kfy-gate-inp" class="kfy-gate-input"
               placeholder="vas@email.com" autocomplete="email"/>
        <div class="kfy-gate-err" id="kfy-gate-err"></div>
        <button class="kfy-gate-btn" id="kfy-gate-btn" type="button"
                onclick="window._kfyGateSubmit()">
          Počni razgovor →
        </button>
        <button class="kfy-gate-skip" type="button" onclick="window._kfyGateSkip()">
          Nastavi bez email-a
        </button>
      </div>

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
        <div class="kfy-closed-notice" id="kfy-closed-notice" style="display:none;"></div>
      </div>

      <!-- ── ARTICLES PANEL (placeholder) ── -->
      <div id="kfy-panel-articles" style="display:none;flex:1;overflow-y:auto;background:var(--kfy-articles-bg,#f9fafb);">
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
     GUEST GATE (full-screen email entry before chat opens)
  ───────────────────────────────────────────────────────────── */
  const guestGate    = document.getElementById('kfy-guest-gate');
  const gateInp      = document.getElementById('kfy-gate-inp');
  const gateBtn      = document.getElementById('kfy-gate-btn');
  const gateErr      = document.getElementById('kfy-gate-err');

  function _clearGateErr() {
    if (gateErr) { gateErr.textContent = ''; gateErr.style.display = 'none'; }
  }

  function _showGate() {
    _clearGateErr();
    guestGate.classList.remove('kfy-gate-hidden');
    setTimeout(() => gateInp && gateInp.focus(), 220);
  }

  function _hideGate() {
    _clearGateErr();
    guestGate.classList.add('kfy-gate-hidden');
  }

  window._kfyGateSubmit = async function () {
    const val = (gateInp.value || '').trim();
    if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      gateErr.textContent   = 'Unesite ispravnu email adresu.';
      gateErr.style.display = 'block';
      return;
    }
    _clearGateErr();
    gateBtn.disabled      = true;
    gateBtn.textContent   = 'Pokretanje...';
    STORAGE.setEmail(val);
    await _startSession(val);
    gateBtn.disabled    = false;
    gateBtn.textContent = 'Počni razgovor →';
  };

  window._kfyGateSkip = async function () {
    _clearGateErr();
    _hideGate();
    await _startSession(null);
  };

  gateInp && gateInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window._kfyGateSubmit(); }
  });

  /* ─────────────────────────────────────────────────────────────
     INIT STATE (called when window opens)
  ───────────────────────────────────────────────────────────── */
  function _initState() {
    const sid   = STORAGE.getSessionId();
    const email = STORAGE.getEmail();
    const token = STORAGE.getToken();

    if (sid) {
      // Resume existing session
      _hideGate();
      _activateChat();
      _loadMessages(sid);
      _startPoll(sid);
    } else if (email) {
      // Previously entered email – auto-start session with it
      _hideGate();
      _startSession(email);
    } else if (token) {
      // Logged-in user (no email needed – backend reads JWT)
      _hideGate();
      _startSession(null);
    } else {
      // Guest – show the full-screen gate first
      _showGate();
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
      if (data.anon_id) STORAGE.setAnonId(data.anon_id);
      _activateChat();
      _startPoll(data.session_id);
    } catch (err) {
      // Show gate with server error message
      _showGate();
      const msg = err.message || 'Greška servera. Pokušajte ponovo.';
      if (gateErr) {
        gateErr.textContent   = msg;
        gateErr.style.display = 'block';
      }
      _showEmailErr(msg);
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
      // ── System: ask_email → inline email form ──
      if (m.sender === 'system' && m.message === '__ask_email__') {
        const alreadyProvided = STORAGE.getEmail();
        const wrap = document.createElement('div');
        wrap.dataset.kfyMsg = '1';
        wrap.className = 'kfy-system-card';
        wrap.innerHTML = alreadyProvided
          ? '<div style="font-size:12px;color:#10b981;font-weight:600;">✓ Email već poslan</div>'
          : `<div style="font-size:12px;font-weight:600;color:var(--kfy-email-h4,#111827);margin-bottom:6px;">
               📧 Agent traži vašu email adresu
             </div>
             <div style="display:flex;gap:6px;">
               <input type="email" id="kfy-inline-email" class="kfy-email-input"
                      placeholder="vas@email.com" style="flex:1;font-size:12px;padding:7px 10px;"/>
               <button onclick="window._kfyInlineEmailSubmit()" class="kfy-email-btn"
                       style="width:auto;margin:0;padding:7px 14px;font-size:11px;">Pošalji</button>
             </div>
             <div id="kfy-inline-email-err" style="font-size:11px;color:#ef4444;margin-top:4px;display:none;"></div>`;
        body.appendChild(wrap);
        return;
      }
      // ── System: email_received → confirmation ──
      if (m.sender === 'system' && m.message.startsWith('__email_received__')) {
        const receivedEmail = m.message.replace('__email_received__', '');
        const wrap = document.createElement('div');
        wrap.dataset.kfyMsg = '1';
        wrap.className = 'kfy-system-card';
        wrap.innerHTML = `<div style="font-size:12px;color:#10b981;font-weight:600;">✓ Email poslan: ${receivedEmail}</div>`;
        body.appendChild(wrap);
        return;
      }

      const div = document.createElement('div');
      div.className       = `kfy-bubble ${m.sender === 'admin' ? 'admin' : 'user'}`;
      div.textContent     = m.message;
      div.dataset.kfyMsg  = '1';
      body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
  }

  // Inline email submit (when admin requests email)
  window._kfyInlineEmailSubmit = async function () {
    const inp = document.getElementById('kfy-inline-email');
    const errEl = document.getElementById('kfy-inline-email-err');
    if (!inp) return;
    const val = inp.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      if (errEl) { errEl.textContent = 'Unesite ispravnu email adresu.'; errEl.style.display = 'block'; }
      return;
    }
    const sid = STORAGE.getSessionId();
    if (!sid) return;
    try {
      const res = await fetch(`${API()}/chat/sessions/${sid}/guest-email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: val }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      STORAGE.setEmail(val);
      // Force re-render to show confirmation
      _lastMsgCount = 0;
      await _loadMessages(sid);
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Greška.'; errEl.style.display = 'block'; }
    }
  };

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

    const isLoggedIn = !!STORAGE.getToken();

    if (isLoggedIn) {
      // Logged-in user: just show "open new session" button
      closedNotice.innerHTML = `
        <div>Ova chat sesija je zatvorena.</div>
        <button class="kfy-new-session-btn" id="kfy-new-session-btn">Otvori novu sesiju</button>`;
      closedNotice.querySelector('#kfy-new-session-btn').addEventListener('click', () => {
        closedNotice.style.display = 'none';
        _startSession(null);
      });
    } else {
      // Guest: show choice — email or guest
      closedNotice.innerHTML = `
        <div>Ova chat sesija je zatvorena.</div>
        <div style="font-weight:600;margin-top:8px">Otvori novu sesiju:</div>
        <div class="kfy-new-choice">
          <button class="kfy-choice-btn" id="kfy-closed-email-btn">Unesi email</button>
          <button class="kfy-choice-btn" id="kfy-closed-guest-btn">Nastavi kao gost</button>
        </div>
        <div id="kfy-closed-email-form" style="display:none">
          <div class="kfy-guest-email-row">
            <input type="email" id="kfy-closed-email-inp" placeholder="vas@email.com">
            <button id="kfy-closed-email-send">Pošalji</button>
          </div>
          <div class="kfy-closed-err" id="kfy-closed-err"></div>
        </div>`;

      closedNotice.querySelector('#kfy-closed-guest-btn').addEventListener('click', () => {
        closedNotice.style.display = 'none';
        _startSession(null);
      });

      closedNotice.querySelector('#kfy-closed-email-btn').addEventListener('click', () => {
        closedNotice.querySelector('#kfy-closed-email-form').style.display = 'block';
        closedNotice.querySelector('#kfy-closed-email-inp').focus();
      });

      const sendEmail = () => {
        const inp = closedNotice.querySelector('#kfy-closed-email-inp');
        const err = closedNotice.querySelector('#kfy-closed-err');
        const val = inp.value.trim();
        if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          err.textContent = 'Unesite ispravnu email adresu.';
          return;
        }
        err.textContent = '';
        STORAGE.setEmail(val);
        closedNotice.style.display = 'none';
        _startSession(val);
      };

      closedNotice.querySelector('#kfy-closed-email-send').addEventListener('click', sendEmail);
      closedNotice.querySelector('#kfy-closed-email-inp').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sendEmail(); }
      });
    }
  }

})();
