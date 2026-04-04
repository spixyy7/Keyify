(function () {
  'use strict';

  if (window.__KEYIFY_LIVE_EDITOR_ALIAS__) return;
  window.__KEYIFY_LIVE_EDITOR_ALIAS__ = true;

  const alreadyLoaded = Array.from(document.scripts || []).some((script) => {
    const source = script.getAttribute('src') || '';
    return /(?:^|\/)visual-editor\.js(?:\?|$)/i.test(source);
  });

  if (alreadyLoaded) return;

  const loader = document.createElement('script');
  loader.src = 'visual-editor.js';
  loader.defer = true;
  document.head.appendChild(loader);
})();
