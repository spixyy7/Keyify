/**
 * config.js — Keyify Frontend Configuration
 *
 * DEPLOYMENT: Change KEYIFY_API_URL to your Railway backend URL.
 * This is the ONLY file you need to edit when switching environments.
 *
 * Include this FIRST on every page, before translations.js and keyify.js:
 *   <script src="config.js"></script>
 *   <script src="translations.js"></script>
 *   <script src="keyify.js"></script>
 */

window.KEYIFY_CONFIG = {
  // ── Change this to your Railway URL after deployment ──────────────────
  API_URL: 'https://keyify-api.up.railway.app/api',
  // ─────────────────────────────────────────────────────────────────────

  // Falls back to localhost in development automatically
  get API_BASE() {
    const isLocal = location.hostname === 'localhost'
      || location.hostname === '127.0.0.1'
      || location.protocol === 'file:';
    return isLocal ? 'http://localhost:3001/api' : this.API_URL;
  },
};
