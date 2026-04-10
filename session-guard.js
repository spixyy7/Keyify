/**
 * Keyify Session Guard
 * ─────────────────────────────────────────
 * Provides two protections:
 *  1. Inactivity auto-logout after 15 minutes of no interaction
 *  2. Absolute session expiry: logs out when JWT `exp` is reached (max 2h from login)
 *
 * Include this script on any authenticated page AFTER keyify.js.
 * It will do nothing if the user is not logged in.
 */
(function () {
  'use strict';

  const TOKEN_KEY   = 'keyify_token';
  const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutes
  const WARN_BEFORE_MS = 60 * 1000;      // show warning 1 minute before logout

  // ── Helpers ──────────────────────────────────────────────

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  /** Decode JWT payload without verifying signature (client-side read only) */
  function parseJWT(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('keyify_name');
    localStorage.removeItem('keyify_role');
    localStorage.removeItem('keyify_rank');
    localStorage.removeItem('keyify_email');
    localStorage.removeItem('keyify_id');
  }

  function redirectToLogin(reason) {
    sessionStorage.setItem('keyify_logout_reason', reason || 'session_expired');
    window.location.href = 'login.html';
  }

  function logout(reason) {
    clearSession();
    redirectToLogin(reason);
  }

  // ── Modal ─────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('sg-styles')) return;
    const style = document.createElement('style');
    style.id = 'sg-styles';
    style.textContent = `
      @keyframes sg-backdrop-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes sg-card-in {
        from { opacity: 0; transform: translateY(20px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0)    scale(1);    }
      }
      @keyframes sg-ring {
        from { stroke-dashoffset: 188; }
        to   { stroke-dashoffset: 0;   }
      }
      #sg-modal.is-visible {
        animation: sg-backdrop-in 0.25s ease both;
      }
      #sg-modal.is-visible #sg-card {
        animation: sg-card-in 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      #sg-ring-track {
        stroke-dasharray: 188;
        stroke-dashoffset: 188;
        transform-origin: center;
        transform: rotate(-90deg);
      }
      #sg-stay:hover  { background: #1254d4 !important; }
      #sg-logout:hover { background: #fef2f2 !important; }
    `;
    document.head.appendChild(style);
  }

  function injectModal() {
    if (document.getElementById('sg-modal')) return;
    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'sg-modal';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;display:none;align-items:center;' +
      'justify-content:center;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);' +
      '-webkit-backdrop-filter:blur(8px);';

    overlay.innerHTML = `
      <div id="sg-card" style="
        background:#fff;
        border:1px solid #e5e7eb;
        border-radius:20px;
        padding:36px 40px 32px;
        max-width:400px;
        width:90%;
        text-align:center;
        box-shadow:0 8px 40px rgba(15,23,42,0.14),0 1px 4px rgba(15,23,42,0.06);
        font-family:'DM Sans',system-ui,sans-serif;
      ">
        <!-- countdown ring -->
        <div style="position:relative;width:72px;height:72px;margin:0 auto 20px;">
          <svg width="72" height="72" viewBox="0 0 72 72" style="position:absolute;inset:0;">
            <circle cx="36" cy="36" r="30" fill="none" stroke="#f1f5f9" stroke-width="5"/>
            <circle id="sg-ring-track" cx="36" cy="36" r="30" fill="none"
                    stroke="#1D6AFF" stroke-width="5" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
            <span id="sg-countdown" style="font-family:'Outfit',sans-serif;font-size:1.2rem;font-weight:700;color:#1D6AFF;line-height:1;">60</span>
          </div>
        </div>

        <h2 style="font-family:'Outfit',sans-serif;font-size:1.2rem;font-weight:700;
                   color:#0f172a;margin:0 0 8px;">Sesija ističe</h2>
        <p style="color:#64748b;font-size:0.875rem;line-height:1.6;margin:0 0 24px;">
          Bićete automatski odjavljeni zbog neaktivnosti.<br>
          Kliknite <strong style="color:#0f172a;">Ostani prijavljen</strong> da nastavite.
        </p>

        <div style="display:flex;gap:10px;justify-content:center;">
          <button id="sg-stay" style="
            background:#1D6AFF;color:#fff;border:none;border-radius:10px;
            padding:11px 26px;font-size:0.875rem;font-weight:600;cursor:pointer;
            transition:background 0.15s;font-family:'DM Sans',sans-serif;
          ">Ostani prijavljen</button>
          <button id="sg-logout" style="
            background:#fff;color:#ef4444;border:1px solid #fecaca;border-radius:10px;
            padding:11px 26px;font-size:0.875rem;font-weight:600;cursor:pointer;
            transition:background 0.15s;font-family:'DM Sans',sans-serif;
          ">Odjavi se</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('sg-stay').addEventListener('click', function () {
      hideModal();
      resetInactivityTimer();
    });
    document.getElementById('sg-logout').addEventListener('click', function () {
      hideModal();
      logout('manual');
    });
  }

  function showModal() {
    const el = document.getElementById('sg-modal');
    if (!el) return;
    el.style.display = 'flex';
    el.classList.add('is-visible');
    // Animate ring over WARN_BEFORE_MS duration
    const ring = document.getElementById('sg-ring-track');
    if (ring) {
      ring.style.transition = `stroke-dashoffset ${WARN_BEFORE_MS / 1000}s linear`;
      // Force reflow before transitioning
      void ring.offsetWidth;
      ring.style.strokeDashoffset = '0';
    }
  }

  function hideModal() {
    const el = document.getElementById('sg-modal');
    if (!el) return;
    el.style.display = 'none';
    el.classList.remove('is-visible');
    clearInterval(countdownInterval);
    // Reset ring
    const ring = document.getElementById('sg-ring-track');
    if (ring) {
      ring.style.transition = 'none';
      ring.style.strokeDashoffset = '188';
    }
  }

  // ── Timers ────────────────────────────────────────────────

  let inactivityTimer    = null;
  let warningTimer       = null;
  let countdownInterval  = null;
  let countdownSeconds   = 60;

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);
    clearInterval(countdownInterval);
    hideModal();

    // Show warning 1 min before logout
    warningTimer = setTimeout(function () {
      countdownSeconds = Math.round(WARN_BEFORE_MS / 1000);
      showModal();

      countdownInterval = setInterval(function () {
        countdownSeconds -= 1;
        const el = document.getElementById('sg-countdown');
        if (el) el.textContent = countdownSeconds;
        if (countdownSeconds <= 0) {
          clearInterval(countdownInterval);
          hideModal();
          logout('inactivity');
        }
      }, 1000);
    }, INACTIVITY_MS - WARN_BEFORE_MS);

    // Hard logout timer
    inactivityTimer = setTimeout(function () {
      hideModal();
      logout('inactivity');
    }, INACTIVITY_MS);
  }

  function watchActivity() {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    let throttle = false;

    events.forEach(function (evt) {
      document.addEventListener(evt, function () {
        if (throttle) return;
        throttle = true;
        setTimeout(function () { throttle = false; }, 1000);
        resetInactivityTimer();
      }, { passive: true });
    });
  }

  // ── Absolute expiry check ─────────────────────────────────

  function scheduleAbsoluteExpiry(exp) {
    const msLeft = exp * 1000 - Date.now();
    if (msLeft <= 0) {
      logout('token_expired');
      return;
    }
    // Schedule logout exactly at token expiry
    setTimeout(function () {
      logout('token_expired');
    }, Math.min(msLeft, 2147483647)); // clamp to max JS timer
  }

  // ── Boot ──────────────────────────────────────────────────

  function boot() {
    const token = getToken();
    if (!token) return; // not logged in, do nothing

    const payload = parseJWT(token);
    if (!payload) {
      clearSession();
      return;
    }

    // If already expired, redirect immediately
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      logout('token_expired');
      return;
    }

    // When the Live Editor is active, skip inactivity tracking so long
    // editing sessions don't cause accidental logouts. Absolute JWT expiry
    // is still enforced.
    const editorActive = localStorage.getItem('keyify_editor_active') === 'true';
    if (!editorActive) {
      injectModal();
      watchActivity();
      resetInactivityTimer();
    }

    // Schedule hard expiry at JWT exp
    if (payload.exp) {
      scheduleAbsoluteExpiry(payload.exp);
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
