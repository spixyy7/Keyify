/**
 * Keyify Live Chat Widget — Premium Redesign
 * Floating chat button + window with email capture & real-time polling.
 * Add <script src="chat-widget.js"></script> before </body> on any public page.
 */
(function () {
  'use strict';

  // Don't init on admin panel
  if (window.location.pathname.includes('admin')) return;

  const API = () => {
    if (window.KEYIFY_CONFIG?.API_BASE) return window.KEYIFY_CONFIG.API_BASE;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3001/api';
    }
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
        if (Date.now() - ts > 10 * 60 * 1000) {
          localStorage.removeItem('kfy_chat_email');
          return null;
        }
        return email;
      } catch {
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

  let _pollInterval  = null;
  let _queuePoll     = null;
  let _lastMsgCount  = 0;
  let _open          = false;
  let _adminInfo     = null;
  const _autoOpenChat = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('open_chat') === '1' || sessionStorage.getItem('kfy_open_chat_on_load') === '1';
    } catch {
      return false;
    }
  })();

  /* ─────────────────────────────────────────────────────────────
     INJECT STYLES — Premium Redesign
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
      from { transform:translateY(12px); opacity:0; }
      to   { transform:translateY(0); opacity:1; }
    }
    @keyframes kfyFadeIn {
      from { opacity:0; }
      to   { opacity:1; }
    }
    @keyframes kfyShimmer {
      0%   { background-position:-200% 0; }
      100% { background-position:200% 0; }
    }
    @keyframes kfyTypingDot {
      0%,80%,100% { transform:scale(0.6); opacity:0.3; }
      40%         { transform:scale(1); opacity:1; }
    }
    @keyframes kfyQueuePulse {
      0%,100% { opacity:1; }
      50%     { opacity:.65; }
    }

    /* ── FAB ── */
    #kfy-fab {
      position:fixed !important;
      bottom:24px !important;
      right:24px !important;
      z-index:1000001 !important;
      width:58px !important;
      height:58px !important;
      min-width:58px !important;
      min-height:58px !important;
      border-radius:50% !important;
      border:none !important;
      padding:0 !important;
      margin:0 !important;
      outline:none !important;
      cursor:pointer !important;
      background:linear-gradient(135deg,#1D6AFF 0%,#7C3AED 50%,#A259FF 100%) !important;
      box-shadow:0 6px 28px rgba(29,106,255,.45),0 2px 10px rgba(124,58,237,.2) !important;
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
      box-shadow:0 10px 36px rgba(29,106,255,.55),0 4px 16px rgba(124,58,237,.25) !important;
    }
    #kfy-fab:active { transform:scale(.93) !important; }

    #kfy-fab::after {
      content:'' !important;
      position:absolute !important;
      inset:-2px !important;
      border-radius:50% !important;
      background:rgba(29,106,255,.35) !important;
      animation:kfyPulseRing 2.4s ease-out 1.5s infinite !important;
      pointer-events:none !important;
      z-index:-1 !important;
    }

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
      z-index:1000000 !important;
      width:380px !important;
      height:min(84vh, 700px) !important;
      max-height:min(84vh, 700px) !important;
      border-radius:20px !important;
      overflow:hidden !important;
      box-shadow:0 32px 80px rgba(0,0,0,.22),0 12px 32px rgba(0,0,0,.12),0 0 0 1px var(--kfy-win-ring,rgba(0,0,0,.06)) !important;
      display:flex !important;
      flex-direction:column !important;
      opacity:0 !important;
      pointer-events:none !important;
      transform:translateY(16px) scale(.96) !important;
      transition:transform .32s cubic-bezier(.34,1.56,.64,1),
                 opacity .24s cubic-bezier(.4,0,.2,1) !important;
      font-family:'DM Sans','Outfit','Segoe UI',system-ui,sans-serif !important;
      background:var(--kfy-body-bg,#f4f5f7) !important;
    }
    #kfy-chat-win.kfy-visible {
      opacity:1 !important;
      pointer-events:all !important;
      transform:translateY(0) scale(1) !important;
    }

    /* ── Guest Gate (welcome/email/choice/feedback) ── */
    #kfy-guest-gate {
      position:absolute !important;
      inset:0 !important;
      z-index:10 !important;
      display:flex !important;
      flex-direction:column !important;
      align-items:center !important;
      justify-content:center !important;
      overflow-y:auto !important;
      padding:32px 28px !important;
      background:var(--kfy-header-bg,#fff) !important;
      text-align:center !important;
      transition:background .3s ease !important;
    }
    #kfy-guest-gate.kfy-gate-hidden { display:none !important; }

    .kfy-gate-title,
    .kfy-gate-sub,
    .kfy-gate-step {
      width:100%;
      max-width:310px;
    }

    /* Gate icon */
    .kfy-gate-icon {
      width:64px;height:64px;border-radius:18px;margin-bottom:20px;
      background:linear-gradient(135deg,#1D6AFF 0%,#7C3AED 50%,#A259FF 100%);
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      box-shadow:0 10px 32px rgba(29,106,255,0.3),0 4px 12px rgba(124,58,237,0.15);
      position:relative;
    }
    .kfy-gate-icon::after {
      content:'';position:absolute;inset:0;border-radius:18px;
      background:linear-gradient(180deg,rgba(255,255,255,0.15) 0%,transparent 60%);
      pointer-events:none;
    }

    .kfy-gate-title {
      font-size:20px;font-weight:800;margin-bottom:6px;
      color:var(--kfy-agent-title,#111827);line-height:1.25;
      letter-spacing:-0.02em;
    }
    .kfy-gate-sub {
      font-size:13px;color:var(--kfy-inp-ph,#9ca3af);margin-bottom:24px;line-height:1.55;
    }

    /* Gate input */
    .kfy-gate-input {
      width:100%;padding:13px 16px;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:14px;font-size:14px;outline:none;box-sizing:border-box;
      color:var(--kfy-inp-color,#111827);background:var(--kfy-inp-bg,#f9fafb);
      font-family:inherit;
      transition:border-color .2s,box-shadow .2s,background .2s;
      margin-bottom:12px;
    }
    .kfy-gate-input::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-gate-input:focus {
      border-color:#1D6AFF;
      box-shadow:0 0 0 4px rgba(29,106,255,0.1);
      background:var(--kfy-inp-focus-bg,#fff);
    }

    /* Gate CTA button */
    .kfy-gate-btn {
      width:100%;padding:13px;border:none;border-radius:14px;
      background:linear-gradient(135deg,#1D6AFF 0%,#7C3AED 100%);color:#fff;
      font-size:14px;font-weight:700;cursor:pointer;
      box-shadow:0 6px 20px rgba(29,106,255,0.35);
      transition:all .2s ease;letter-spacing:.01em;
      position:relative;overflow:hidden;
    }
    .kfy-gate-btn::after {
      content:'';position:absolute;inset:0;
      background:linear-gradient(180deg,rgba(255,255,255,0.12) 0%,transparent 50%);
      pointer-events:none;
    }
    .kfy-gate-btn:hover { transform:translateY(-1px);box-shadow:0 8px 28px rgba(29,106,255,0.45); }
    .kfy-gate-btn:active { transform:translateY(0);box-shadow:0 4px 14px rgba(29,106,255,0.3); }
    .kfy-gate-btn:disabled { opacity:.45;cursor:not-allowed;transform:none;box-shadow:none; }

    .kfy-gate-err { font-size:12px;color:#ef4444;margin-top:8px;text-align:left;display:none; }

    /* Gate skip/back link */
    .kfy-gate-skip {
      margin-top:16px;font-size:12px;color:var(--kfy-inp-ph,#9ca3af);
      cursor:pointer;background:none;border:none;
      font-family:inherit;font-weight:500;
      transition:color .15s;
      display:inline-flex;align-items:center;gap:4px;
    }
    .kfy-gate-skip:hover { color:#1D6AFF; }
    .kfy-gate-skip svg { transition:transform .15s; }
    .kfy-gate-skip:hover svg { transform:translateX(-2px); }

    .kfy-gate-step { width:100%; flex-shrink:0; }

    /* Choice grid */
    .kfy-gate-choice-grid {
      width:100%;
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:12px;
      margin-top:4px;
    }

    /* Premium action cards */
    .kfy-gate-card {
      text-align:left;
      border:1.5px solid var(--kfy-gate-card-border,rgba(148,163,184,0.18));
      border-radius:16px;
      padding:18px 16px 16px;
      background:var(--kfy-gate-card-bg,linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.9)));
      color:var(--kfy-gate-card-title,#0f172a);
      cursor:pointer;
      transition:all .25s cubic-bezier(.4,0,.2,1);
      box-shadow:var(--kfy-gate-card-shadow,0 4px 16px rgba(15,23,42,0.05));
      position:relative;overflow:hidden;
    }
    .kfy-gate-card::before {
      content:'';position:absolute;top:0;left:0;right:0;height:3px;
      background:linear-gradient(90deg,#1D6AFF,#7C3AED);
      opacity:0;transition:opacity .25s;border-radius:16px 16px 0 0;
    }
    .kfy-gate-card:hover {
      transform:translateY(-3px);
      border-color:var(--kfy-gate-card-hover-border,rgba(29,106,255,0.35));
      box-shadow:var(--kfy-gate-card-hover-shadow,0 12px 32px rgba(29,106,255,0.14));
    }
    .kfy-gate-card:hover::before { opacity:1; }
    .kfy-gate-card:active { transform:translateY(-1px); }

    .kfy-gate-card-icon {
      width:36px;height:36px;border-radius:10px;margin-bottom:10px;
      display:flex;align-items:center;justify-content:center;
      font-size:18px;
    }
    .kfy-gate-card-icon.kfy-icon-support {
      background:linear-gradient(135deg,rgba(29,106,255,0.12),rgba(124,58,237,0.08));
      color:#1D6AFF;
    }
    .kfy-gate-card-icon.kfy-icon-feedback {
      background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(52,211,153,0.08));
      color:#10b981;
    }

    .kfy-gate-card-title {
      font-size:13px;
      font-weight:700;
      margin-bottom:4px;
      color:var(--kfy-gate-card-title,#0f172a);
      letter-spacing:-0.01em;
    }
    .kfy-gate-card-sub {
      font-size:11.5px;
      line-height:1.5;
      color:var(--kfy-gate-card-sub,#64748b);
    }

    /* ── Feedback flow ── */
    .kfy-gate-label {
      display:block;
      text-align:left;
      font-size:11px;
      font-weight:700;
      color:var(--kfy-gate-label-color,#64748b);
      margin-top:16px;
      margin-bottom:6px;
      text-transform:uppercase;
      letter-spacing:.07em;
      transition:color .25s ease;
    }

    /* Custom select wrapper */
    .kfy-select-wrap {
      position:relative;width:100%;
    }
    .kfy-gate-select {
      width:100%;box-sizing:border-box;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:14px;font-size:14px;outline:none;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      font-family:inherit;
      transition:border-color .2s,box-shadow .2s,background .2s;
      padding:13px 42px 13px 16px;
      appearance:none;-webkit-appearance:none;-moz-appearance:none;
      cursor:pointer;
    }
    .kfy-select-wrap::after {
      content:'';position:absolute;right:16px;top:50%;transform:translateY(-50%);
      width:0;height:0;
      border-left:5px solid transparent;border-right:5px solid transparent;
      border-top:5px solid var(--kfy-inp-ph,#9ca3af);
      pointer-events:none;transition:border-color .2s;
    }
    .kfy-gate-select:focus {
      border-color:#1D6AFF;
      box-shadow:0 0 0 4px rgba(29,106,255,0.1);
      background:var(--kfy-inp-focus-bg,#fff);
    }
    .kfy-gate-select:focus + .kfy-select-wrap::after,
    .kfy-select-wrap:focus-within::after {
      border-top-color:#1D6AFF;
    }

    .kfy-gate-textarea {
      width:100%;box-sizing:border-box;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:14px;font-size:14px;outline:none;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      font-family:inherit;
      transition:border-color .2s,box-shadow .2s,background .2s;
      padding:13px 16px;
      min-height:110px;
      resize:vertical;
      line-height:1.5;
    }
    .kfy-gate-textarea:focus {
      border-color:#1D6AFF;
      box-shadow:0 0 0 4px rgba(29,106,255,0.1);
      background:var(--kfy-inp-focus-bg,#fff);
    }

    /* ── Header ── */
    .kfy-header {
      background:var(--kfy-header-bg,#fff);
      padding:0;
      border-bottom:1px solid var(--kfy-header-border,rgba(0,0,0,0.06));
      flex-shrink:0;
      transition:background .3s ease,border-color .3s ease;
    }
    .kfy-header-top {
      display:flex;align-items:center;justify-content:space-between;
      padding:14px 16px 0;
    }
    .kfy-header-brand {
      display:flex;align-items:center;gap:10px;
    }
    .kfy-header-logo {
      width:32px;height:32px;border-radius:10px;
      background:linear-gradient(135deg,#1D6AFF,#7C3AED);
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 10px rgba(29,106,255,0.25);
      flex-shrink:0;
    }
    .kfy-header-title {
      font-size:14px;font-weight:700;color:var(--kfy-agent-title,#111827);
      letter-spacing:-0.01em;line-height:1.2;
    }
    .kfy-header-subtitle {
      font-size:11px;color:var(--kfy-status-text,#6b7280);
      display:flex;align-items:center;gap:5px;margin-top:1px;
    }
    .kfy-header-dot {
      width:6px;height:6px;border-radius:50%;background:#10b981;
      box-shadow:0 0 6px rgba(16,185,129,0.5);flex-shrink:0;
    }
    .kfy-close-btn {
      width:32px;height:32px;border-radius:10px;border:none;
      background:var(--kfy-close-bg,rgba(0,0,0,0.04));
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:all .15s;padding:0;flex-shrink:0;color:var(--kfy-close-color,#9ca3af);
    }
    .kfy-close-btn:hover {
      background:var(--kfy-close-hover-bg,rgba(0,0,0,0.08));
      color:var(--kfy-close-hover-color,#374151);
    }

    /* Segmented tabs */
    .kfy-tabs-wrap {
      padding:10px 16px 12px;
    }
    .kfy-tabs {
      display:flex;gap:4px;
      background:var(--kfy-tab-bg,rgba(0,0,0,0.04));
      border-radius:12px;padding:3px;
    }
    .kfy-tab {
      flex:1;padding:8px 12px;font-size:12.5px;font-weight:600;
      border:none;background:none;cursor:pointer;
      color:var(--kfy-tab-color,#6b7280);
      border-radius:9px;
      transition:all .2s cubic-bezier(.4,0,.2,1);
      display:flex;align-items:center;justify-content:center;gap:6px;
      position:relative;
      letter-spacing:0.01em;
    }
    .kfy-tab.active {
      color:var(--kfy-tab-active-color,#111827);
      background:var(--kfy-tab-active-bg,#fff);
      box-shadow:0 1px 4px rgba(0,0,0,0.08),0 0 0 1px rgba(0,0,0,0.04);
      font-weight:700;
    }
    .kfy-tab:hover:not(.active) { color:var(--kfy-tab-hover,#374151); }
    .kfy-tab svg { flex-shrink:0; }

    /* Exit button */
    .kfy-exit-btn {
      padding:6px 12px;font-size:11px;font-weight:600;
      border:1.5px solid rgba(239,68,68,0.25);border-radius:8px;background:transparent;
      color:#ef4444;cursor:pointer;transition:all .2s;display:none;
      letter-spacing:0.01em;white-space:nowrap;
    }
    .kfy-exit-btn:hover { background:rgba(239,68,68,0.06);border-color:rgba(239,68,68,0.5); }

    /* ── Agent row (shown during active chat) ── */
    .kfy-agent-row {
      background:var(--kfy-agent-bg,#fff);
      padding:12px 16px;
      display:flex;align-items:center;gap:10px;
      border-bottom:1px solid var(--kfy-agent-border,rgba(0,0,0,0.05));
      flex-shrink:0;
      transition:background .3s ease;
    }
    .kfy-avatars { display:flex; }
    .kfy-avatar {
      width:30px;height:30px;border-radius:50%;
      border:2px solid var(--kfy-avatar-border,#fff);
      background:linear-gradient(135deg,#1D6AFF,#7C3AED);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#fff;margin-left:-7px;
    }
    .kfy-avatars .kfy-avatar:first-child { margin-left:0; }
    .kfy-agent-info { flex:1;min-width:0; }
    .kfy-agent-title { font-size:12.5px;font-weight:600;color:var(--kfy-agent-title,#111827);line-height:1.3; }
    .kfy-status { display:flex;align-items:center;gap:5px;margin-top:2px; }
    .kfy-dot { width:6px;height:6px;border-radius:50%;background:#10b981;flex-shrink:0;box-shadow:0 0 6px rgba(16,185,129,0.5); }
    .kfy-status-text { font-size:11px;color:var(--kfy-status-text,#6b7280); }

    #kfy-panel-chat {
      background:var(--kfy-body-bg,#f4f5f7) !important;
      min-height:0 !important;
    }

    /* ── Message body ── */
    .kfy-body {
      flex:1 1 auto;overflow-y:auto;
      background:var(--kfy-body-bg,#f4f5f7);
      padding:16px;display:flex;flex-direction:column;
      gap:6px;min-height:0;max-height:none;
      transition:background .3s ease;
    }
    .kfy-body::-webkit-scrollbar { width:5px; }
    .kfy-body::-webkit-scrollbar-track { background:transparent; }
    .kfy-body::-webkit-scrollbar-thumb { background:var(--kfy-scrollbar,rgba(0,0,0,0.1));border-radius:10px; }
    .kfy-body::-webkit-scrollbar-thumb:hover { background:var(--kfy-scrollbar-hover,rgba(0,0,0,0.18)); }

    /* ── Message rows ── */
    .kfy-msg-row {
      display:flex;align-items:flex-end;gap:8px;
      animation:kfyFadeSlideUp .25s ease both;
    }
    .kfy-msg-row.user-row {
      flex-direction:row-reverse;
    }
    .kfy-msg-avatar {
      width:28px;height:28px;min-width:28px;border-radius:50%;
      object-fit:cover;flex-shrink:0;
      border:1.5px solid var(--kfy-avatar-bdr,rgba(0,0,0,0.05));
    }
    .kfy-msg-avatar.kfy-logo-avatar {
      background:linear-gradient(135deg,#1D6AFF,#7C3AED);
      display:flex;align-items:center;justify-content:center;
      border:none;
    }

    /* ── Bubbles ── */
    .kfy-bubble {
      max-width:80%;padding:10px 14px;border-radius:16px;
      font-size:13.5px;line-height:1.55;word-break:break-word;
      transition:background .3s ease,color .3s ease;
    }
    .kfy-bubble.bot,.kfy-bubble.admin {
      background:var(--kfy-bubble-bot-bg,#fff);
      color:var(--kfy-bubble-bot-color,#1e293b);
      align-self:flex-start;
      border-bottom-left-radius:4px;
      border:1px solid var(--kfy-bubble-bot-bdr,rgba(0,0,0,0.05));
      box-shadow:var(--kfy-bubble-bot-shad,0 1px 3px rgba(0,0,0,.04));
    }
    .kfy-bubble.user {
      background:linear-gradient(135deg,#1D6AFF 0%,#4F46E5 100%);
      color:#fff;
      align-self:flex-end;
      border-bottom-right-radius:4px;
      box-shadow:0 4px 14px rgba(29,106,255,0.28);
    }

    /* ── System cards ── */
    .kfy-system-card {
      background:var(--kfy-system-card-bg,rgba(29,106,255,0.04));
      border-radius:14px;padding:12px 16px;margin-top:4px;
      border:1px solid var(--kfy-system-card-bdr,rgba(29,106,255,0.12));
      transition:background .3s ease;
      animation:kfyFadeIn .3s ease;
    }

    /* ── Email capture card ── */
    .kfy-email-card {
      background:var(--kfy-email-card-bg,#fff);
      border-radius:16px;padding:18px;margin-top:4px;
      border:1px solid var(--kfy-email-card-bdr,rgba(0,0,0,0.06));
      box-shadow:var(--kfy-email-card-shad,0 2px 8px rgba(0,0,0,.04));
      transition:background .3s ease;
    }
    .kfy-email-card h4 { font-size:13.5px;font-weight:700;color:var(--kfy-email-h4,#111827);margin:0 0 4px;letter-spacing:-0.01em; }
    .kfy-email-card p  { font-size:12.5px;color:var(--kfy-email-p,#6b7280);margin:0 0 14px;line-height:1.5; }
    .kfy-email-input {
      width:100%;padding:12px 14px;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:12px;font-size:13.5px;outline:none;
      transition:border-color .2s,box-shadow .2s,background .3s;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      display:block;box-sizing:border-box;font-family:inherit;
    }
    .kfy-email-input::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-email-input:focus { border-color:#1D6AFF;background:var(--kfy-inp-focus-bg,#fff);box-shadow:0 0 0 4px rgba(29,106,255,0.08); }
    .kfy-email-btn {
      width:100%;margin-top:12px;padding:12px;border:none;border-radius:12px;
      background:linear-gradient(135deg,#1D6AFF,#4F46E5);color:#fff;
      font-size:13.5px;font-weight:700;cursor:pointer;
      transition:all .2s;display:block;box-sizing:border-box;
      box-shadow:0 4px 16px rgba(29,106,255,0.3);
      letter-spacing:.01em;font-family:inherit;
    }
    .kfy-email-btn:hover   { transform:translateY(-1px);box-shadow:0 6px 22px rgba(29,106,255,0.4); }
    .kfy-email-btn:active  { transform:translateY(0); }
    .kfy-email-btn:disabled { opacity:.45;cursor:not-allowed;transform:none;box-shadow:none; }
    .kfy-email-err { font-size:11.5px;color:#ef4444;margin-top:6px;display:none; }

    /* ── Composer ── */
    .kfy-input-row {
      display:flex;align-items:flex-end;gap:8px;padding:12px 14px;
      background:var(--kfy-row-bg,#fff);
      border-top:1px solid var(--kfy-row-border,rgba(0,0,0,0.05));
      flex-shrink:0;
      transition:background .3s ease;
    }
    .kfy-msg-input {
      flex:1;padding:10px 16px;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:22px;font-size:13.5px;outline:none;resize:none;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      transition:border-color .2s,box-shadow .2s,background .3s;
      max-height:80px;overflow-y:auto;font-family:inherit;
      line-height:1.45;
    }
    .kfy-msg-input::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-msg-input:focus {
      border-color:#1D6AFF;
      background:var(--kfy-inp-focus-bg,#fff);
      box-shadow:0 0 0 3px rgba(29,106,255,0.08);
    }
    .kfy-send-btn {
      width:38px;height:38px;min-width:38px;flex-shrink:0;
      border:none;border-radius:12px;cursor:pointer;
      background:linear-gradient(135deg,#1D6AFF,#4F46E5);
      display:flex;align-items:center;justify-content:center;
      transition:all .2s;padding:0;
      box-shadow:0 3px 12px rgba(29,106,255,0.3);
    }
    .kfy-send-btn:hover   { transform:translateY(-1px);box-shadow:0 5px 18px rgba(29,106,255,0.4); }
    .kfy-send-btn:active  { transform:translateY(0) scale(.95); }
    .kfy-send-btn:disabled { opacity:.35;cursor:not-allowed;transform:none;box-shadow:none; }

    /* ── Queue indicator ── */
    .kfy-queue-indicator {
      display:flex;align-items:center;gap:10px;
      padding:10px 16px;margin:0;
      background:var(--kfy-queue-bg,linear-gradient(135deg,rgba(245,158,11,0.08),rgba(251,191,36,0.05)));
      border-bottom:1px solid var(--kfy-queue-bdr,rgba(245,158,11,0.12));
      font-size:12.5px;color:var(--kfy-queue-color,#d97706);font-weight:600;
      animation:kfyQueuePulse 2.4s ease-in-out infinite;
      flex-shrink:0;
    }
    .kfy-queue-indicator .kfy-queue-dot {
      width:8px;height:8px;border-radius:50%;background:#f59e0b;
      box-shadow:0 0 8px rgba(245,158,11,0.5);flex-shrink:0;
    }

    /* ── Closed notice ── */
    .kfy-closed-notice {
      padding:20px 16px;background:var(--kfy-closed-bg,rgba(245,158,11,0.06));
      font-size:13px;color:var(--kfy-closed-color,#92400e);
      text-align:center;border-top:1px solid var(--kfy-closed-bdr,rgba(245,158,11,0.12));flex-shrink:0;
      line-height:1.5;
    }
    .kfy-closed-notice .kfy-new-session-btn {
      display:inline-block;margin-top:10px;padding:10px 24px;border:none;border-radius:12px;
      background:linear-gradient(135deg,#1D6AFF,#4F46E5);color:#fff;
      font-size:12.5px;font-weight:600;cursor:pointer;
      transition:all .2s;box-shadow:0 4px 14px rgba(29,106,255,0.25);
      font-family:inherit;
    }
    .kfy-closed-notice .kfy-new-session-btn:hover { transform:translateY(-1px);box-shadow:0 6px 20px rgba(29,106,255,0.35); }
    .kfy-closed-notice .kfy-new-choice { display:flex;gap:8px;justify-content:center;margin-top:12px; }
    .kfy-closed-notice .kfy-choice-btn {
      padding:8px 16px;border:1.5px solid var(--kfy-closed-bdr,rgba(245,158,11,0.2));border-radius:10px;
      background:transparent;color:var(--kfy-closed-color,#92400e);
      font-size:11.5px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit;
    }
    .kfy-closed-notice .kfy-choice-btn:hover { background:rgba(29,106,255,0.06);border-color:#1D6AFF;color:#1D6AFF; }
    .kfy-closed-notice .kfy-guest-email-row {
      display:flex;gap:6px;margin-top:10px;justify-content:center;
    }
    .kfy-closed-notice .kfy-guest-email-row input {
      padding:8px 12px;border:1.5px solid var(--kfy-inp-border,#e5e7eb);border-radius:10px;
      font-size:12px;width:180px;outline:none;background:var(--kfy-inp-bg,#fff);
      color:var(--kfy-inp-color,#111);font-family:inherit;transition:border-color .2s;
    }
    .kfy-closed-notice .kfy-guest-email-row input:focus { border-color:#1D6AFF;box-shadow:0 0 0 3px rgba(29,106,255,0.08); }
    .kfy-closed-notice .kfy-guest-email-row button {
      padding:8px 14px;border:none;border-radius:10px;
      background:linear-gradient(135deg,#1D6AFF,#4F46E5);color:#fff;
      font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;
      transition:all .2s;
    }
    .kfy-closed-notice .kfy-guest-email-row button:hover { transform:translateY(-1px); }
    .kfy-closed-err { color:#ef4444;font-size:11.5px;margin-top:6px; }

    /* ── Articles / Knowledge base ── */
    .kfy-kb-panel {
      display:flex;flex-direction:column;flex:1;overflow:hidden;
      background:var(--kfy-articles-bg,#f4f5f7);
    }
    .kfy-kb-header {
      padding:14px 16px 12px;flex-shrink:0;
      background:var(--kfy-header-bg,#fff);
      border-bottom:1px solid var(--kfy-header-border,rgba(0,0,0,0.06));
    }
    .kfy-kb-search-wrap {
      position:relative;
    }
    .kfy-kb-search {
      width:100%;padding:10px 14px 10px 36px;box-sizing:border-box;
      border:1.5px solid var(--kfy-inp-border,#e5e7eb);
      border-radius:12px;font-size:13px;outline:none;
      color:var(--kfy-inp-color,#111827);
      background:var(--kfy-inp-bg,#f9fafb);
      font-family:inherit;transition:border-color .2s,box-shadow .2s,background .2s;
    }
    .kfy-kb-search::placeholder { color:var(--kfy-inp-ph,#9ca3af); }
    .kfy-kb-search:focus {
      border-color:#1D6AFF;box-shadow:0 0 0 3px rgba(29,106,255,0.08);
      background:var(--kfy-inp-focus-bg,#fff);
    }
    .kfy-kb-search-icon {
      position:absolute;left:12px;top:50%;transform:translateY(-50%);
      pointer-events:none;color:var(--kfy-inp-ph,#9ca3af);
    }
    .kfy-kb-cats {
      display:flex;gap:6px;padding:10px 16px 2px;flex-shrink:0;
      overflow-x:auto;scrollbar-width:none;
    }
    .kfy-kb-cats::-webkit-scrollbar { display:none; }
    .kfy-kb-cat {
      padding:5px 12px;border-radius:20px;font-size:11.5px;font-weight:600;
      white-space:nowrap;cursor:pointer;border:none;
      background:var(--kfy-kb-cat-bg,rgba(0,0,0,0.04));
      color:var(--kfy-kb-cat-color,#6b7280);
      transition:all .2s;font-family:inherit;
    }
    .kfy-kb-cat:hover { color:var(--kfy-kb-cat-hover,#374151); }
    .kfy-kb-cat.active {
      background:var(--kfy-kb-cat-active-bg,rgba(29,106,255,0.1));
      color:var(--kfy-kb-cat-active-color,#1D6AFF);
    }

    /* Scrollable article list */
    .kfy-kb-body {
      flex:1;overflow-y:auto;padding:12px 16px 16px;
      display:flex;flex-direction:column;gap:8px;
    }
    .kfy-kb-body::-webkit-scrollbar { width:5px; }
    .kfy-kb-body::-webkit-scrollbar-track { background:transparent; }
    .kfy-kb-body::-webkit-scrollbar-thumb { background:var(--kfy-scrollbar,rgba(0,0,0,0.1));border-radius:10px; }

    /* Section label */
    .kfy-kb-section-label {
      font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
      color:var(--kfy-inp-ph,#9ca3af);padding:6px 0 2px;
    }

    /* Article card */
    .kfy-kb-card {
      background:var(--kfy-kb-card-bg,#fff);
      border:1px solid var(--kfy-kb-card-bdr,rgba(0,0,0,0.05));
      border-radius:14px;padding:14px 16px;cursor:pointer;
      transition:all .2s cubic-bezier(.4,0,.2,1);
      box-shadow:var(--kfy-kb-card-shad,0 1px 3px rgba(0,0,0,.03));
    }
    .kfy-kb-card:hover {
      border-color:var(--kfy-kb-card-hover-bdr,rgba(29,106,255,0.25));
      box-shadow:0 4px 14px rgba(29,106,255,0.08);
      transform:translateY(-1px);
    }
    .kfy-kb-card-title {
      font-size:13.5px;font-weight:700;color:var(--kfy-agent-title,#111827);
      line-height:1.35;margin-bottom:4px;letter-spacing:-0.01em;
      display:flex;align-items:flex-start;gap:6px;
    }
    .kfy-kb-card-title .kfy-kb-featured-badge {
      flex-shrink:0;font-size:10px;padding:2px 6px;border-radius:6px;
      background:rgba(245,158,11,0.1);color:#d97706;font-weight:700;
      letter-spacing:0;
    }
    .kfy-kb-card-excerpt {
      font-size:12px;color:var(--kfy-kb-card-excerpt,#6b7280);
      line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;
      -webkit-box-orient:vertical;overflow:hidden;
    }
    .kfy-kb-card-meta {
      display:flex;align-items:center;gap:8px;margin-top:8px;
      font-size:11px;color:var(--kfy-inp-ph,#9ca3af);
    }
    .kfy-kb-card-cat {
      padding:2px 8px;border-radius:6px;font-weight:600;font-size:10.5px;
      background:var(--kfy-kb-tag-bg,rgba(29,106,255,0.06));
      color:var(--kfy-kb-tag-color,#1D6AFF);
    }

    /* Article detail view */
    .kfy-kb-detail {
      display:flex;flex-direction:column;flex:1;overflow:hidden;
      background:var(--kfy-articles-bg,#f4f5f7);
    }
    .kfy-kb-detail-header {
      padding:14px 16px;flex-shrink:0;
      background:var(--kfy-header-bg,#fff);
      border-bottom:1px solid var(--kfy-header-border,rgba(0,0,0,0.06));
      display:flex;align-items:center;gap:10px;
    }
    .kfy-kb-back-btn {
      width:32px;height:32px;border-radius:10px;border:none;
      background:var(--kfy-close-bg,rgba(0,0,0,0.04));
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:all .15s;padding:0;flex-shrink:0;
      color:var(--kfy-close-color,#9ca3af);
    }
    .kfy-kb-back-btn:hover {
      background:var(--kfy-close-hover-bg,rgba(0,0,0,0.08));
      color:var(--kfy-close-hover-color,#374151);
    }
    .kfy-kb-detail-title {
      font-size:14px;font-weight:700;color:var(--kfy-agent-title,#111827);
      letter-spacing:-0.01em;line-height:1.3;flex:1;min-width:0;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    .kfy-kb-detail-body {
      flex:1;overflow-y:auto;padding:20px 18px 24px;
    }
    .kfy-kb-detail-body::-webkit-scrollbar { width:5px; }
    .kfy-kb-detail-body::-webkit-scrollbar-track { background:transparent; }
    .kfy-kb-detail-body::-webkit-scrollbar-thumb { background:var(--kfy-scrollbar,rgba(0,0,0,0.1));border-radius:10px; }

    .kfy-kb-detail-meta {
      display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;
    }
    .kfy-kb-detail-cat {
      padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;
      background:var(--kfy-kb-tag-bg,rgba(29,106,255,0.06));
      color:var(--kfy-kb-tag-color,#1D6AFF);
    }
    .kfy-kb-detail-date {
      font-size:11px;color:var(--kfy-inp-ph,#9ca3af);
    }
    .kfy-kb-detail-content {
      font-size:13.5px;line-height:1.7;color:var(--kfy-bubble-bot-color,#1e293b);
    }
    .kfy-kb-detail-content p { margin:0 0 12px; }
    .kfy-kb-detail-content strong { font-weight:700;color:var(--kfy-agent-title,#111827); }
    .kfy-kb-detail-content ul,
    .kfy-kb-detail-content ol { margin:0 0 12px;padding-left:20px; }
    .kfy-kb-detail-content li { margin-bottom:4px; }
    .kfy-kb-detail-content h2,
    .kfy-kb-detail-content h3 {
      font-size:14px;font-weight:700;color:var(--kfy-agent-title,#111827);
      margin:16px 0 8px;letter-spacing:-0.01em;
    }
    .kfy-kb-detail-content a {
      color:#1D6AFF;text-decoration:underline;text-underline-offset:2px;
    }
    .kfy-kb-detail-content hr {
      border:none;border-top:1px solid var(--kfy-header-border,rgba(0,0,0,0.06));
      margin:16px 0;
    }

    /* Empty state */
    .kfy-kb-empty {
      padding:40px 24px;text-align:center;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      flex:1;
    }
    .kfy-kb-empty-icon {
      width:56px;height:56px;border-radius:16px;margin-bottom:14px;
      background:var(--kfy-articles-icon-bg,rgba(0,0,0,0.04));
      display:flex;align-items:center;justify-content:center;
    }
    .kfy-kb-empty-title {
      font-size:14px;font-weight:700;color:var(--kfy-agent-title,#111827);
      margin-bottom:4px;
    }
    .kfy-kb-empty-desc {
      font-size:12.5px;color:var(--kfy-articles-color,#9ca3af);line-height:1.55;
      max-width:220px;
    }

    /* Loading skeleton */
    .kfy-kb-skeleton {
      background:var(--kfy-kb-card-bg,#fff);border-radius:14px;padding:16px;
      border:1px solid var(--kfy-kb-card-bdr,rgba(0,0,0,0.05));
    }
    .kfy-kb-skeleton-line {
      height:12px;border-radius:6px;
      background:linear-gradient(90deg,var(--kfy-kb-skel-from,rgba(0,0,0,0.06)) 25%,var(--kfy-kb-skel-to,rgba(0,0,0,0.02)) 50%,var(--kfy-kb-skel-from,rgba(0,0,0,0.06)) 75%);
      background-size:200% 100%;
      animation:kfyShimmer 1.5s infinite;
    }
    .kfy-kb-skeleton-line.w60 { width:60%; }
    .kfy-kb-skeleton-line.w80 { width:80%;margin-top:8px; }
    .kfy-kb-skeleton-line.w40 { width:40%;margin-top:8px; }

    /* ── Responsive ── */
    @media (max-width:420px) {
      #kfy-chat-win {
        width:calc(100vw - 16px) !important;
        right:8px !important;
        bottom:84px !important;
        height:calc(100dvh - 108px) !important;
        max-height:calc(100dvh - 108px) !important;
        border-radius:18px !important;
      }
      #kfy-fab { right:14px !important; bottom:16px !important; }
      #kfy-guest-gate { padding:24px 20px !important; }
      .kfy-gate-choice-grid { gap:10px; }
      .kfy-gate-card { padding:14px 12px 12px; }
      .kfy-gate-title { font-size:18px; }
    }
    @media (max-height:700px) {
      #kfy-chat-win { height:calc(100dvh - 120px) !important; max-height:calc(100dvh - 120px) !important; }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ─────────────────────────────────────────────────────────────
     BUILD DOM — Premium Layout
  ───────────────────────────────────────────────────────────── */
  const root = document.createElement('div');
  root.setAttribute('id', 'kfy-widget-root');

  root.innerHTML = `
    <!-- FAB -->
    <button id="kfy-fab" aria-label="Otvori chat podršku" type="button">
      <span id="kfy-fab-icons">
        <svg id="kfy-icon-chat" width="24" height="24" viewBox="0 0 24 24"
             fill="none" stroke="#ffffff" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <svg id="kfy-icon-close" width="22" height="22" viewBox="0 0 24 24"
             fill="none" stroke="#ffffff" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6"  y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    </button>

    <!-- Chat window -->
    <div id="kfy-chat-win" role="dialog" aria-modal="true" aria-label="Live chat podrška">

      <!-- Guest Gate -->
      <div id="kfy-guest-gate" class="kfy-gate-hidden">
        <div class="kfy-gate-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="kfy-gate-title">Kako vam možemo pomoći?</div>
        <div class="kfy-gate-sub">Unesite email pa izaberite da li želite podršku uživo ili da ostavite feedback.</div>

        <!-- Step: Email -->
        <div id="kfy-gate-step-email" class="kfy-gate-step">
          <input type="email" id="kfy-gate-inp" class="kfy-gate-input"
                 placeholder="vas@email.com" autocomplete="email"/>
          <div class="kfy-gate-err" id="kfy-gate-err"></div>
          <button class="kfy-gate-btn" id="kfy-gate-btn" type="button"
                  onclick="window._kfyGateSubmit()">
            Nastavi
          </button>
        </div>

        <!-- Step: Choice -->
        <div id="kfy-gate-step-choice" class="kfy-gate-step" style="display:none">
          <div class="kfy-gate-choice-grid">
            <button type="button" class="kfy-gate-card" onclick="window._kfyChooseGateMode('support')">
              <div class="kfy-gate-card-icon kfy-icon-support">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div class="kfy-gate-card-title">Podrška uživo</div>
              <div class="kfy-gate-card-sub">Povežite se sa agentom u realnom vremenu.</div>
            </button>
            <button type="button" class="kfy-gate-card" onclick="window._kfyChooseGateMode('feedback')">
              <div class="kfy-gate-card-icon kfy-icon-feedback">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </div>
              <div class="kfy-gate-card-title">Ostavi feedback</div>
              <div class="kfy-gate-card-sub">Komentar, predlog ili žalba bez chata.</div>
            </button>
          </div>
          <button class="kfy-gate-skip" type="button" onclick="window._kfyGateBackToEmail()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Nazad
          </button>
        </div>

        <!-- Step: Feedback -->
        <div id="kfy-gate-step-feedback" class="kfy-gate-step" style="display:none">
          <label class="kfy-gate-label" for="kfy-feedback-category">Kategorija</label>
          <div class="kfy-select-wrap">
            <select id="kfy-feedback-category" class="kfy-gate-select">
              <option value="">Izaberite kategoriju...</option>
              <option value="nalog">Nalog</option>
              <option value="rad_sajta">Rad sajta</option>
              <option value="predlog">Predlog</option>
              <option value="zalba">Žalba</option>
            </select>
          </div>
          <label class="kfy-gate-label" for="kfy-feedback-text">Poruka</label>
          <textarea id="kfy-feedback-text" class="kfy-gate-textarea" placeholder="Opišite detaljno..."></textarea>
          <div class="kfy-gate-err" id="kfy-feedback-err"></div>
          <button class="kfy-gate-btn" id="kfy-feedback-btn" type="button" onclick="window._kfySubmitFeedback()">Pošalji feedback</button>
          <button class="kfy-gate-skip" type="button" onclick="window._kfyChooseGateMode('choice')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Nazad na izbor
          </button>
        </div>
      </div>

      <!-- Header -->
      <div class="kfy-header">
        <div class="kfy-header-top">
          <div class="kfy-header-brand">
            <div class="kfy-header-logo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
            </div>
            <div>
              <div class="kfy-header-title">Keyify podrška</div>
              <div class="kfy-header-subtitle">
                <span class="kfy-header-dot"></span>
                Odgovaramo za manje od sat vremena
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="kfy-exit-btn" id="kfy-exit-btn" type="button" onclick="window._kfyExitSession()">Izađi</button>
            <button class="kfy-close-btn" type="button" onclick="document.getElementById('kfy-fab').click()" aria-label="Zatvori">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="kfy-tabs-wrap">
          <div class="kfy-tabs">
            <button class="kfy-tab active" id="kfy-tab-chat" type="button" onclick="window._kfyTab('chat')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Razgovor
            </button>
            <button class="kfy-tab" id="kfy-tab-articles" type="button" onclick="window._kfyTab('articles')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              Članci
            </button>
          </div>
        </div>
      </div>

      <!-- Agent row -->
      <div class="kfy-agent-row">
        <div class="kfy-avatars">
          <div class="kfy-avatar" style="background:linear-gradient(135deg,#1D6AFF,#7C3AED)">K</div>
          <div class="kfy-avatar" style="background:linear-gradient(135deg,#7C3AED,#EC4899)">S</div>
        </div>
        <div class="kfy-agent-info">
          <div class="kfy-agent-title">Imate pitanja? Dopisujte se sa nama!</div>
          <div class="kfy-status">
            <span class="kfy-dot"></span>
            <span class="kfy-status-text">Obično odgovorimo za manje od sat vremena</span>
          </div>
        </div>
      </div>

      <!-- CHAT PANEL -->
      <div id="kfy-panel-chat" style="display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;">

        <!-- Queue indicator -->
        <div class="kfy-queue-indicator" id="kfy-queue-indicator" style="display:none;">
          <span class="kfy-queue-dot"></span>
          <span id="kfy-queue-text">Trenutno ste 1. u redu čekanja.</span>
        </div>

        <!-- Message area -->
        <div class="kfy-body" id="kfy-body">
          <div class="kfy-msg-row">
            <div class="kfy-msg-avatar kfy-logo-avatar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            </div>
            <div class="kfy-bubble bot">Kako Vam možemo pomoći sa Keyify? 👋</div>
          </div>

          <div class="kfy-email-card" id="kfy-email-card" style="display:none">
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

        <!-- Composer -->
        <div class="kfy-input-row" id="kfy-input-row" style="display:none;">
          <textarea class="kfy-msg-input" id="kfy-msg-input" rows="1"
                    placeholder="Napišite poruku..."></textarea>
          <button class="kfy-send-btn" id="kfy-send-btn" type="button"
                  onclick="window._kfySend()" aria-label="Pošalji poruku">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 2L11 13"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
            </svg>
          </button>
        </div>

        <!-- Closed notice -->
        <div class="kfy-closed-notice" id="kfy-closed-notice" style="display:none;"></div>
      </div>

      <!-- ARTICLES PANEL -->
      <div id="kfy-panel-articles" style="display:none;flex:1;overflow:hidden;">

        <!-- Article list view -->
        <div id="kfy-kb-list-view" class="kfy-kb-panel">
          <div class="kfy-kb-header">
            <div class="kfy-kb-search-wrap">
              <svg class="kfy-kb-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" class="kfy-kb-search" id="kfy-kb-search" placeholder="Pretražite članke..." autocomplete="off"/>
            </div>
          </div>
          <div class="kfy-kb-cats" id="kfy-kb-cats">
            <button class="kfy-kb-cat active" type="button" data-cat="">Sve</button>
          </div>
          <div class="kfy-kb-body" id="kfy-kb-body">
            <!-- Loading skeletons -->
            <div class="kfy-kb-skeleton"><div class="kfy-kb-skeleton-line w60"></div><div class="kfy-kb-skeleton-line w80"></div><div class="kfy-kb-skeleton-line w40"></div></div>
            <div class="kfy-kb-skeleton"><div class="kfy-kb-skeleton-line w80"></div><div class="kfy-kb-skeleton-line w60"></div><div class="kfy-kb-skeleton-line w40"></div></div>
            <div class="kfy-kb-skeleton"><div class="kfy-kb-skeleton-line w60"></div><div class="kfy-kb-skeleton-line w80"></div><div class="kfy-kb-skeleton-line w40"></div></div>
          </div>
        </div>

        <!-- Article detail view -->
        <div id="kfy-kb-detail-view" class="kfy-kb-detail" style="display:none;">
          <div class="kfy-kb-detail-header">
            <button class="kfy-kb-back-btn" type="button" id="kfy-kb-back-btn" aria-label="Nazad">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="kfy-kb-detail-title" id="kfy-kb-detail-title"></div>
          </div>
          <div class="kfy-kb-detail-body" id="kfy-kb-detail-body"></div>
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
  function _setOpenState(nextOpen) {
    _open = !!nextOpen;
    fab.classList.toggle('kfy-open', _open);
    win.classList.toggle('kfy-visible', _open);
    fab.setAttribute('aria-expanded', String(_open));

    if (_open) {
      _initState();
    } else {
      _stopPoll();
    }
  }

  fab.addEventListener('click', () => {
    _setOpenState(!_open);
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
    if (!isChat && !_kbLoaded) _kbInit();
  };

  /* ─────────────────────────────────────────────────────────────
     KNOWLEDGE BASE (Articles Tab)
  ───────────────────────────────────────────────────────────── */
  let _kbLoaded = false;
  let _kbArticles = [];
  let _kbCategories = {};
  let _kbActiveCategory = '';
  let _kbSearchQuery = '';

  const _kbCatLabels = {
    opste: 'Opšte', kupovina: 'Kupovina', aktivacija: 'Aktivacija',
    licence: 'Licence', podrska: 'Podrška', garancija: 'Garancija',
    'ai-alati': 'AI alati', streaming: 'Streaming', software: 'Software',
  };

  async function _kbInit() {
    _kbLoaded = true;
    try {
      const [artRes, catRes] = await Promise.all([
        fetch(`${API()}/kb/articles`),
        fetch(`${API()}/kb/categories`),
      ]);
      _kbArticles = await artRes.json();
      _kbCategories = await catRes.json();
      if (!Array.isArray(_kbArticles)) _kbArticles = [];
    } catch {
      _kbArticles = [];
      _kbCategories = {};
    }
    _kbRenderCategories();
    _kbRenderList();
    _kbBindEvents();
  }

  function _kbRenderCategories() {
    const wrap = document.getElementById('kfy-kb-cats');
    if (!wrap) return;
    let html = '<button class="kfy-kb-cat active" type="button" data-cat="">Sve</button>';
    const cats = Object.keys(_kbCategories).sort();
    cats.forEach(cat => {
      const label = _kbCatLabels[cat] || cat;
      const count = _kbCategories[cat] || 0;
      html += `<button class="kfy-kb-cat" type="button" data-cat="${cat}">${label} (${count})</button>`;
    });
    wrap.innerHTML = html;

    wrap.querySelectorAll('.kfy-kb-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('.kfy-kb-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _kbActiveCategory = btn.dataset.cat;
        _kbRenderList();
      });
    });
  }

  function _kbFilterArticles() {
    let list = _kbArticles;
    if (_kbActiveCategory) {
      list = list.filter(a => a.category === _kbActiveCategory);
    }
    if (_kbSearchQuery) {
      const q = _kbSearchQuery.toLowerCase();
      list = list.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.excerpt || '').toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }

  function _kbRenderList() {
    const container = document.getElementById('kfy-kb-body');
    if (!container) return;

    const filtered = _kbFilterArticles();
    const featured = filtered.filter(a => a.featured);
    const rest = filtered.filter(a => !a.featured);

    if (!filtered.length) {
      container.innerHTML = `
        <div class="kfy-kb-empty">
          <div class="kfy-kb-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--kfy-articles-icon-color,#9ca3af)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div class="kfy-kb-empty-title">${_kbSearchQuery ? 'Nema rezultata' : 'Nema članaka'}</div>
          <div class="kfy-kb-empty-desc">${_kbSearchQuery ? 'Pokušajte sa drugim pojmom za pretragu.' : 'Članci će uskoro biti dostupni.'}</div>
        </div>`;
      return;
    }

    let html = '';

    if (featured.length && !_kbSearchQuery) {
      html += '<div class="kfy-kb-section-label">Istaknuti članci</div>';
      featured.forEach(a => { html += _kbCardHtml(a); });
    }

    if (rest.length) {
      if (featured.length && !_kbSearchQuery) {
        html += '<div class="kfy-kb-section-label" style="margin-top:6px">Svi članci</div>';
      }
      rest.forEach(a => { html += _kbCardHtml(a); });
    }

    // If only featured and no "rest" visible
    if (featured.length && !rest.length && _kbSearchQuery) {
      featured.forEach(a => { html += _kbCardHtml(a); });
    }

    container.innerHTML = html;

    container.querySelectorAll('.kfy-kb-card').forEach(card => {
      card.addEventListener('click', () => {
        const slug = card.dataset.slug;
        if (slug) _kbOpenArticle(slug);
      });
    });
  }

  function _kbCardHtml(article) {
    const catLabel = _kbCatLabels[article.category] || article.category;
    const excerpt = article.excerpt || '';
    const featuredBadge = article.featured ? '<span class="kfy-kb-featured-badge">Istaknuto</span>' : '';
    return `
      <div class="kfy-kb-card" data-slug="${article.slug}">
        <div class="kfy-kb-card-title">
          <span>${_escHtml(article.title)}</span>
          ${featuredBadge}
        </div>
        ${excerpt ? `<div class="kfy-kb-card-excerpt">${_escHtml(excerpt)}</div>` : ''}
        <div class="kfy-kb-card-meta">
          <span class="kfy-kb-card-cat">${_escHtml(catLabel)}</span>
          <span>${article.view_count || 0} pregleda</span>
        </div>
      </div>`;
  }

  async function _kbOpenArticle(slug) {
    const listView = document.getElementById('kfy-kb-list-view');
    const detailView = document.getElementById('kfy-kb-detail-view');
    const titleEl = document.getElementById('kfy-kb-detail-title');
    const bodyEl = document.getElementById('kfy-kb-detail-body');

    listView.style.display = 'none';
    detailView.style.display = 'flex';
    titleEl.textContent = 'Učitavanje...';
    bodyEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--kfy-inp-ph,#9ca3af);font-size:13px;">Učitavanje članka...</div>';

    try {
      const res = await fetch(`${API()}/kb/articles/${slug}`);
      if (!res.ok) throw new Error('Članak nije pronađen');
      const article = await res.json();

      titleEl.textContent = article.title;
      const catLabel = _kbCatLabels[article.category] || article.category;
      const dateStr = article.created_at ? new Date(article.created_at).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

      bodyEl.innerHTML = `
        <div class="kfy-kb-detail-meta">
          <span class="kfy-kb-detail-cat">${_escHtml(catLabel)}</span>
          ${dateStr ? `<span class="kfy-kb-detail-date">${dateStr}</span>` : ''}
          <span class="kfy-kb-detail-date">${article.view_count || 0} pregleda</span>
        </div>
        <div class="kfy-kb-detail-content">${_kbMarkdown(article.content || '')}</div>`;
    } catch (err) {
      titleEl.textContent = 'Greška';
      bodyEl.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444;font-size:13px;">${err.message}</div>`;
    }
  }

  function _kbBackToList() {
    document.getElementById('kfy-kb-list-view').style.display = 'flex';
    document.getElementById('kfy-kb-detail-view').style.display = 'none';
  }

  function _kbBindEvents() {
    const searchEl = document.getElementById('kfy-kb-search');
    if (searchEl) {
      let debounce;
      searchEl.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          _kbSearchQuery = searchEl.value.trim();
          _kbRenderList();
        }, 200);
      });
    }
    const backBtn = document.getElementById('kfy-kb-back-btn');
    if (backBtn) backBtn.addEventListener('click', _kbBackToList);
  }

  // Simple markdown to HTML
  function _kbMarkdown(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/(<li>.*<\/li>)/gs, (match) => {
        if (!match.startsWith('<ul>') && !match.startsWith('<ol>')) {
          return '<ul>' + match + '</ul>';
        }
        return match;
      })
      .replace(/<\/ul>\s*<ul>/g, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^---$/gm, '<hr>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
      .replace(/<p><(h[23]|ul|ol|hr|li)/g, '<$1')
      .replace(/<\/(h[23]|ul|ol|hr|li)><\/p>/g, '</$1>')
      .replace(/<p><\/p>/g, '');
  }

  function _escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  /* ─────────────────────────────────────────────────────────────
     GUEST GATE
  ───────────────────────────────────────────────────────────── */
  const guestGate    = document.getElementById('kfy-guest-gate');
  const gateInp      = document.getElementById('kfy-gate-inp');
  const gateBtn      = document.getElementById('kfy-gate-btn');
  const gateErr      = document.getElementById('kfy-gate-err');
  const gateTitle    = guestGate?.querySelector('.kfy-gate-title');
  const gateSub      = guestGate?.querySelector('.kfy-gate-sub');
  const gateStepEmail = document.getElementById('kfy-gate-step-email');
  const gateStepChoice = document.getElementById('kfy-gate-step-choice');
  const gateStepFeedback = document.getElementById('kfy-gate-step-feedback');
  const gateBackToEmailBtn = gateStepChoice?.querySelector('.kfy-gate-skip');
  const feedbackCategory = document.getElementById('kfy-feedback-category');
  const feedbackTextLabel = document.querySelector('label[for="kfy-feedback-text"]');
  const feedbackText = document.getElementById('kfy-feedback-text');
  const feedbackBtn = document.getElementById('kfy-feedback-btn');
  const feedbackErr = document.getElementById('kfy-feedback-err');

  function _isLoggedInUser() {
    return !!STORAGE.getToken();
  }

  function _getKnownEmail() {
    return (
      STORAGE.getEmail()
      || localStorage.getItem('keyify_email')
      || sessionStorage.getItem('keyify_email')
      || localStorage.getItem('email')
      || null
    );
  }

  function _resetChatUiForGate() {
    STORAGE.clearSession();
    _stopPoll();
    _stopQueuePoll();
    _adminInfo = null;
    _lastMsgCount = 0;

    const qi = document.getElementById('kfy-queue-indicator');
    if (qi) qi.style.display = 'none';

    inputRow.style.display = 'none';
    closedNotice.style.display = 'none';
    if (exitBtn) exitBtn.style.display = 'none';
    emailCard.style.display = 'none';
    body.querySelectorAll('[data-kfy-msg]').forEach((el) => el.remove());
  }

  function _resolveGateStartStep(preferredStep) {
    if (preferredStep) return preferredStep;
    if (_isLoggedInUser()) return 'choice';
    return _getKnownEmail() ? 'choice' : 'email';
  }

  function _configureGateUi(step) {
    const loggedIn = _isLoggedInUser();

    if (gateTitle) {
      gateTitle.textContent = loggedIn ? 'Izaberite opciju' : 'Kako vam možemo pomoći?';
    }
    if (gateSub) {
      gateSub.textContent = loggedIn
        ? 'Izaberite da li želite podršku uživo ili da ostavite feedback.'
        : 'Unesite email pa izaberite da li želite podršku uživo ili da ostavite feedback.';
    }
    if (gateBackToEmailBtn) {
      gateBackToEmailBtn.style.display = loggedIn ? 'none' : '';
    }
    if (!loggedIn && step === 'email' && gateInp) {
      gateInp.value = _getKnownEmail() || '';
    }
  }

  function _clearGateErr() {
    if (gateErr) { gateErr.textContent = ''; gateErr.style.display = 'none'; }
    if (feedbackErr) {
      feedbackErr.textContent = '';
      feedbackErr.style.display = 'none';
      feedbackErr.style.color = '#ef4444';
    }
  }

  function _setGateStep(step) {
    [[gateStepEmail, 'email'], [gateStepChoice, 'choice'], [gateStepFeedback, 'feedback']].forEach(([node, key]) => {
      if (!node) return;
      node.style.display = key === step ? '' : 'none';
    });
    if (guestGate) {
      guestGate.style.justifyContent = step === 'feedback' ? 'flex-start' : 'center';
      guestGate.style.padding = step === 'feedback' ? '28px 28px 32px' : '32px 28px';
      guestGate.scrollTop = 0;
    }
  }

  function _syncFeedbackFlow() {
    const showDetails = !!String(feedbackCategory?.value || '').trim();
    if (feedbackTextLabel) feedbackTextLabel.style.display = showDetails ? '' : 'none';
    if (feedbackText) feedbackText.style.display = showDetails ? '' : 'none';
    if (feedbackBtn) feedbackBtn.style.display = showDetails ? '' : 'none';
    if (!showDetails) {
      if (feedbackText) feedbackText.value = '';
      if (feedbackErr) {
        feedbackErr.textContent = '';
        feedbackErr.style.display = 'none';
      }
    }
  }

  function _showGate(preferredStep) {
    _clearGateErr();
    const nextStep = _resolveGateStartStep(preferredStep);
    if (gateBtn) {
      gateBtn.disabled = false;
      gateBtn.textContent = 'Nastavi';
    }
    if (feedbackCategory) feedbackCategory.disabled = false;
    if (feedbackText) feedbackText.disabled = false;
    if (feedbackBtn) {
      feedbackBtn.disabled = false;
      feedbackBtn.textContent = 'Pošalji feedback';
    }
    _syncFeedbackFlow();
    _configureGateUi(nextStep);
    _setGateStep(nextStep);
    guestGate.classList.remove('kfy-gate-hidden');
    setTimeout(() => {
      if (nextStep === 'choice') {
        gateStepChoice?.querySelector('.kfy-gate-card')?.focus?.();
      } else if (nextStep === 'feedback') {
        feedbackCategory && feedbackCategory.focus();
      } else {
        gateInp && gateInp.focus();
      }
    }, 220);
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
    gateBtn.disabled = true;
    gateBtn.textContent = 'Nastavljam...';
    STORAGE.setEmail(val);
    _setGateStep('choice');
    gateBtn.disabled = false;
    gateBtn.textContent = 'Nastavi';
  };

  window._kfyGateBackToEmail = function () {
    if (_isLoggedInUser()) {
      _setGateStep('choice');
      setTimeout(() => gateStepChoice?.querySelector('.kfy-gate-card')?.focus?.(), 60);
      return;
    }
    _clearGateErr();
    if (gateBtn) {
      gateBtn.disabled = false;
      gateBtn.textContent = 'Nastavi';
    }
    _setGateStep('email');
    setTimeout(() => gateInp && gateInp.focus(), 60);
  };

  window._kfyChooseGateMode = async function (mode) {
    _clearGateErr();
    if (mode === 'choice') {
      _setGateStep(_resolveGateStartStep('choice'));
      return;
    }
    if (mode === 'feedback') {
      _setGateStep('feedback');
      _syncFeedbackFlow();
      setTimeout(() => feedbackCategory && feedbackCategory.focus(), 60);
      return;
    }

    const email = _isLoggedInUser()
      ? null
      : (_getKnownEmail() || (gateInp?.value || '').trim() || null);
    _hideGate();
    emailCard.style.display = 'none';
    await _startSession(email);
  };

  window._kfySubmitFeedback = async function () {
    const email = _getKnownEmail() || (gateInp?.value || '').trim();
    const category = String(feedbackCategory?.value || '').trim();
    const message = String(feedbackText?.value || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      feedbackErr.textContent = 'Email nije ispravan.';
      feedbackErr.style.display = 'block';
      return;
    }
    if (!category) {
      feedbackErr.textContent = 'Izaberite kategoriju feedbacka.';
      feedbackErr.style.display = 'block';
      return;
    }
    if (message.length < 8) {
      feedbackErr.textContent = 'Unesite makar kratko objašnjenje feedbacka.';
      feedbackErr.style.display = 'block';
      return;
    }

    _clearGateErr();
    feedbackBtn.disabled = true;
    feedbackBtn.textContent = 'Slanje...';

    try {
      const res = await fetch(`${API()}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          category,
          message,
          page_url: window.location.href,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Greška pri slanju feedbacka.');

      if (feedbackCategory) feedbackCategory.disabled = true;
      if (feedbackText) feedbackText.disabled = true;
      feedbackErr.textContent = 'Feedback je poslat. Hvala na povratnoj informaciji.';
      feedbackErr.style.display = 'block';
      feedbackErr.style.color = '#10b981';
      feedbackBtn.textContent = 'Poslato';
    } catch (error) {
      feedbackErr.textContent = error.message || 'Greška pri slanju feedbacka.';
      feedbackErr.style.display = 'block';
      feedbackErr.style.color = '#ef4444';
      feedbackBtn.disabled = false;
      feedbackBtn.textContent = 'Pošalji feedback';
    }
  };

  window._kfyGateSkip = async function () {
    _clearGateErr();
    _hideGate();
    emailCard.style.display = 'none';
    await _startSession(null);
  };

  gateInp && gateInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window._kfyGateSubmit(); }
  });
  feedbackCategory && feedbackCategory.addEventListener('change', () => {
    _syncFeedbackFlow();
    if (String(feedbackCategory.value || '').trim()) {
      setTimeout(() => feedbackText && feedbackText.focus(), 40);
    }
  });

  async function _resumeExistingSession(sid) {
    try {
      const res = await fetch(`${API()}/chat/messages/${sid}`);
      if (!res.ok) {
        _resetChatUiForGate();
        _showGate();
        return;
      }

      const payload = await res.json().catch(() => ({}));
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const sessionStatus = String(payload?.session_status || '').trim().toLowerCase();
      const hasRealConversation = messages.some((m) => ['user', 'admin'].includes(m?.sender));

      if (payload?.admin_info) _adminInfo = payload.admin_info;

      if (sessionStatus === 'closed') {
        _showClosed();
        return;
      }

      if (_isLoggedInUser() && sessionStatus === 'pending' && !hasRealConversation) {
        _resetChatUiForGate();
        _showGate('choice');
        return;
      }

      _activateChat();
      _renderMessages(messages);
      _lastMsgCount = messages.length;

      const qi = document.getElementById('kfy-queue-indicator');
      if (qi) qi.style.display = sessionStatus === 'pending' ? 'flex' : 'none';
      if (sessionStatus === 'pending') _startQueuePoll(sid);
      else _stopQueuePoll();

      _startPoll(sid);
    } catch {
      _activateChat();
      _loadMessages(sid);
      _startPoll(sid);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     INIT STATE
  ───────────────────────────────────────────────────────────── */
  function _initState() {
    if (_starting) return;
    const sid   = STORAGE.getSessionId();

    if (sid) {
      _resumeExistingSession(sid);
    } else {
      _showGate();
    }
  }

  if (_autoOpenChat) {
    sessionStorage.removeItem('kfy_open_chat_on_load');
    setTimeout(() => _setOpenState(true), 260);
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
  let _starting = false;
  async function _startSession(guestEmail) {
    if (_starting) return;
    _starting = true;
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
      const qi = document.getElementById('kfy-queue-indicator');
      if (qi) qi.style.display = 'flex';
      _startQueuePoll(data.session_id);
    } catch (err) {
      const msg = err.message || 'Greška servera. Pokušajte ponovo.';
      if (inputRow.style.display !== 'flex') {
        _showGate();
        if (gateErr) { gateErr.textContent = msg; gateErr.style.display = 'block'; }
      }
    } finally {
      _starting = false;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     ACTIVATE CHAT UI
  ───────────────────────────────────────────────────────────── */
  const exitBtn = document.getElementById('kfy-exit-btn');

  function _activateChat() {
    _hideGate();
    emailCard.style.display = 'none';
    inputRow.style.display  = 'flex';
    closedNotice.style.display = 'none';
    if (exitBtn) exitBtn.style.display = 'block';
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

    _appendBubble('user', text);

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
    } catch { /* silent */ }

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

  function _startQueuePoll(sid) {
    _stopQueuePoll();
    _fetchQueuePosition(sid);
    _queuePoll = setInterval(() => _fetchQueuePosition(sid), 4000);
  }

  function _stopQueuePoll() {
    if (_queuePoll) { clearInterval(_queuePoll); _queuePoll = null; }
  }

  async function _fetchQueuePosition(sid) {
    try {
      const res = await fetch(`${API()}/chat/queue-position/${sid}`);
      if (!res.ok) return;
      const { position, status } = await res.json();
      const qi = document.getElementById('kfy-queue-indicator');
      const qt = document.getElementById('kfy-queue-text');
      if (!qi || !qt) return;

      if (status !== 'pending') {
        qi.style.display = 'none';
        _stopQueuePoll();
        return;
      }
      qi.style.display = 'flex';
      qt.textContent = `Trenutno ste ${position}. u redu čekanja.`;
    } catch {}
  }

  async function _loadMessages(sid) {
    try {
      const res = await fetch(`${API()}/chat/messages/${sid}`);
      if (!res.ok) return;
      const { messages, session_status, admin_info } = await res.json();

      if (admin_info) _adminInfo = admin_info;

      if (session_status === 'closed') { _showClosed(); _stopPoll(); _stopQueuePoll(); return; }

      const qi = document.getElementById('kfy-queue-indicator');
      if (session_status === 'active' && qi) {
        qi.style.display = 'none';
        _stopQueuePoll();
      } else if (session_status === 'pending' && qi && qi.style.display === 'none') {
        qi.style.display = 'flex';
        _startQueuePoll(sid);
      }

      if (messages.length !== _lastMsgCount) {
        _lastMsgCount = messages.length;
        _renderMessages(messages);
      }
    } catch { /* ignore */ }
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER MESSAGES
  ───────────────────────────────────────────────────────────── */
  function _makeAvatar(sender) {
    if (sender === 'admin' && _adminInfo?.avatar_url) {
      const img = document.createElement('img');
      img.className = 'kfy-msg-avatar';
      img.src = _adminInfo.avatar_url;
      img.alt = _adminInfo.name || 'Agent';
      return img;
    }
    const div = document.createElement('div');
    div.className = 'kfy-msg-avatar kfy-logo-avatar';
    div.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
    return div;
  }

  function _renderMessages(messages) {
    body.querySelectorAll('[data-kfy-msg]').forEach(el => el.remove());
    messages.forEach(m => {
      if (m.sender === 'system' && m.message.startsWith('__agent_joined__')) {
        const agentName = m.message.replace('__agent_joined__', '');
        const wrap = document.createElement('div');
        wrap.dataset.kfyMsg = '1';
        wrap.className = 'kfy-system-card';
        wrap.innerHTML = `<div style="font-size:12.5px;color:#10b981;font-weight:600;display:flex;align-items:center;gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ${agentName} se pridružio/la razgovoru
        </div>`;
        body.appendChild(wrap);
        const qi = document.getElementById('kfy-queue-indicator');
        if (qi) qi.style.display = 'none';
        return;
      }
      if (m.sender === 'system' && m.message === '__chat_declined__') {
        const wrap = document.createElement('div');
        wrap.dataset.kfyMsg = '1';
        wrap.className = 'kfy-system-card';
        wrap.style.borderColor = 'rgba(239,68,68,0.15)';
        wrap.style.background = 'var(--kfy-declined-bg,rgba(239,68,68,0.04))';
        wrap.innerHTML = '<div style="font-size:12.5px;color:#ef4444;font-weight:600;">Sesija je odbijena. Pokušajte ponovo kasnije.</div>';
        body.appendChild(wrap);
        return;
      }
      if (m.sender === 'system' && m.message === '__ask_email__') {
        const alreadyProvided = STORAGE.getEmail();
        const wrap = document.createElement('div');
        wrap.dataset.kfyMsg = '1';
        wrap.className = 'kfy-system-card';
        wrap.innerHTML = alreadyProvided
          ? `<div style="font-size:12.5px;color:#10b981;font-weight:600;display:flex;align-items:center;gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Email već poslan
            </div>`
          : `<div style="font-size:12.5px;font-weight:600;color:var(--kfy-email-h4,#111827);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
               Agent traži vašu email adresu
             </div>
             <div style="display:flex;gap:6px;">
               <input type="email" id="kfy-inline-email" class="kfy-email-input"
                      placeholder="vas@email.com" style="flex:1;font-size:12.5px;padding:9px 12px;"/>
               <button onclick="window._kfyInlineEmailSubmit()" class="kfy-email-btn"
                       style="width:auto;margin:0;padding:9px 16px;font-size:12px;border-radius:10px;">Pošalji</button>
             </div>
             <div id="kfy-inline-email-err" style="font-size:11.5px;color:#ef4444;margin-top:4px;display:none;"></div>`;
        body.appendChild(wrap);
        return;
      }
      if (m.sender === 'system' && m.message.startsWith('__email_received__')) {
        const receivedEmail = m.message.replace('__email_received__', '');
        const wrap = document.createElement('div');
        wrap.dataset.kfyMsg = '1';
        wrap.className = 'kfy-system-card';
        wrap.innerHTML = `<div style="font-size:12.5px;color:#10b981;font-weight:600;display:flex;align-items:center;gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Email poslan: ${receivedEmail}
        </div>`;
        body.appendChild(wrap);
        return;
      }
      if (m.sender === 'system' && m.message === '__user_left__') return;

      const row = document.createElement('div');
      row.className = `kfy-msg-row ${m.sender === 'user' ? 'user-row' : ''}`;
      row.dataset.kfyMsg = '1';

      const avatar = _makeAvatar(m.sender === 'admin' ? 'admin' : 'bot');
      const bubble = document.createElement('div');
      bubble.className = `kfy-bubble ${m.sender === 'admin' ? 'admin' : 'user'}`;
      bubble.textContent = m.message;

      row.appendChild(avatar);
      row.appendChild(bubble);
      body.appendChild(row);
    });
    body.scrollTop = body.scrollHeight;
  }

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
      _lastMsgCount = 0;
      await _loadMessages(sid);
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Greška.'; errEl.style.display = 'block'; }
    }
  };

  function _appendBubble(sender, text) {
    const row = document.createElement('div');
    row.className = `kfy-msg-row ${sender === 'user' ? 'user-row' : ''}`;
    row.dataset.kfyMsg = '1';

    const avatar = _makeAvatar(sender === 'admin' ? 'admin' : sender === 'user' ? 'bot' : 'bot');
    const bubble = document.createElement('div');
    bubble.className = `kfy-bubble ${sender}`;
    bubble.textContent = text;

    row.appendChild(avatar);
    row.appendChild(bubble);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  window._kfyExitSession = async function () {
    const sid = STORAGE.getSessionId();
    if (sid) {
      try {
        await fetch(`${API()}/chat/sessions/${sid}/leave`, { method: 'POST' });
      } catch {}
    }
    STORAGE.clearSession();
    localStorage.removeItem('kfy_chat_email');
    sessionStorage.removeItem('kfy_chat_anon');
    _stopPoll();
    _stopQueuePoll();
    _adminInfo = null;
    const qi = document.getElementById('kfy-queue-indicator');
    if (qi) qi.style.display = 'none';
    inputRow.style.display     = 'none';
    closedNotice.style.display = 'none';
    if (exitBtn) exitBtn.style.display = 'none';
    const body = document.getElementById('kfy-body');
    body.querySelectorAll('.kfy-bubble:not(:first-child), .kfy-system-card').forEach(el => el.remove());
    emailCard.style.display = 'none';
    _showGate();
  };

  function _showClosed() {
    inputRow.style.display     = 'none';
    closedNotice.style.display = 'block';
    if (exitBtn) exitBtn.style.display = 'none';
    STORAGE.clearSession();
    _stopPoll();
    _stopQueuePoll();
    _adminInfo = null;
    const qi = document.getElementById('kfy-queue-indicator');
    if (qi) qi.style.display = 'none';

    const isLoggedIn = _isLoggedInUser();

    if (isLoggedIn) {
      closedNotice.innerHTML = `
        <div>Ova chat sesija je zatvorena.</div>
        <button class="kfy-new-session-btn" id="kfy-new-session-btn">Otvori novu sesiju</button>`;
      closedNotice.querySelector('#kfy-new-session-btn').addEventListener('click', () => {
        _resetChatUiForGate();
        _showGate('choice');
      });
    } else {
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
        _resetChatUiForGate();
        _showGate('email');
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
