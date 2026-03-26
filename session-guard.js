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

  function injectModal() {
    if (document.getElementById('sg-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'sg-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:99999',
      'display:none;align-items:center;justify-content:center',
      'background:rgba(0,0,0,0.7);backdrop-filter:blur(6px)',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;
                  padding:32px 40px;max-width:400px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
        <div style="font-size:2.5rem;margin-bottom:12px;">⏱️</div>
        <h2 style="color:#f1f5f9;font-size:1.25rem;font-weight:700;margin:0 0 8px;">
          Sesija ističe
        </h2>
        <p style="color:#94a3b8;font-size:0.9rem;margin:0 0 20px;">
          Bit ćete automatski odjavljeni za <strong id="sg-countdown" style="color:#ef4444;">60</strong>s
          zbog neaktivnosti.
        </p>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="sg-stay" style="background:#1d6aff;color:#fff;border:none;border-radius:10px;
                  padding:10px 24px;font-size:0.9rem;font-weight:600;cursor:pointer;">
            Ostani prijavljen
          </button>
          <button id="sg-logout" style="background:rgba(239,68,68,0.15);color:#ef4444;
                  border:1px solid rgba(239,68,68,0.3);border-radius:10px;
                  padding:10px 24px;font-size:0.9rem;font-weight:600;cursor:pointer;">
            Odjavi se
          </button>
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
    if (el) el.style.display = 'flex';
  }

  function hideModal() {
    const el = document.getElementById('sg-modal');
    if (el) el.style.display = 'none';
    clearInterval(countdownInterval);
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

    injectModal();
    watchActivity();
    resetInactivityTimer();

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
