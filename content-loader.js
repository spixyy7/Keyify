/**
 * content-loader.js — Keyify CMS content loader
 *
 * Fetches all site_content key/value pairs from the API and applies them
 * to any element with a data-ck="key" attribute.
 *
 * Include AFTER config.js on every page that has data-ck elements.
 */
(async function () {
  const API = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
  try {
    const res = await fetch(`${API}/content`);
    if (!res.ok) return;
    const map = await res.json();
    window.__KEYIFY_CONTENT = map;
    document.querySelectorAll('[data-ck]').forEach(function (el) {
      var val = map[el.dataset.ck];
      if (val !== undefined && val !== null && val !== '') {
        el.textContent = val;
      }
    });
  } catch (e) {
    // Fail silently — static HTML fallback stays visible
  }
})();
