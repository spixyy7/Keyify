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
  API_URL: 'https://keyify-production.up.railway.app/api',
  PREFER_LOCAL_API: false,
  // ─────────────────────────────────────────────────────────────────────

  get IS_LOCAL_ENV() {
    return location.hostname === 'localhost'
      || location.hostname === '127.0.0.1'
      || location.protocol === 'file:';
  },

  get API_CANDIDATES() {
    const candidates = [];
    if (this.IS_LOCAL_ENV && this.PREFER_LOCAL_API) candidates.push('http://localhost:3001/api');
    if (this.API_URL) candidates.push(this.API_URL);
    if (this.IS_LOCAL_ENV && !this.PREFER_LOCAL_API) candidates.push('http://localhost:3001/api');
    return [...new Set(candidates.filter(Boolean))];
  },

  // Uses Railway by default, with localhost available as manual fallback
  get API_BASE() {
    return this.API_CANDIDATES[0] || this.API_URL;
  },
};

// ── Stripe Publishable Key ───────────────────────────────────────────────
// Set this to your Stripe pk_live_... or pk_test_... key.
// Only the publishable key is safe to expose in frontend code.
// Leave as null to hide card payment option.
window.KEYIFY_STRIPE_PK = null; // e.g. 'pk_live_...' or 'pk_test_...'
