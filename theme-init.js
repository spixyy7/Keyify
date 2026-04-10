/* Instant theme — runs synchronously before first paint to prevent white flash */
(function(){
  var t = localStorage.getItem('keyify_theme');
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
  if (dark) {
    document.documentElement.setAttribute('data-theme','dark');
    document.documentElement.classList.add('dark');
    /* Inject critical dark CSS before any rendering — covers body, header, footer, dropdowns */
    var s = document.createElement('style');
    s.id = 'kf-critical-dark';
    s.textContent =
      '[data-theme="dark"] body{background:#0b0f1a!important;color:#e2e8f0!important}' +
      '[data-theme="dark"] header,.dark header{background:rgba(11,15,26,.95)!important;border-color:rgba(255,255,255,.06)!important}' +
      '[data-theme="dark"] footer,.dark footer{background:#0b0f1a!important;border-color:rgba(255,255,255,.06)!important;color:#64748b!important}' +
      '[data-theme="dark"] .bg-white,.dark .bg-white{background:#111827!important}' +
      '[data-theme="dark"] .bg-gray-50,.dark .bg-gray-50{background:#0f172a!important}' +
      '[data-theme="dark"] .border-gray-200,.dark .border-gray-200{border-color:rgba(255,255,255,.06)!important}' +
      '[data-theme="dark"] .border-gray-100,.dark .border-gray-100{border-color:rgba(255,255,255,.06)!important}' +
      '[data-theme="dark"] .text-gray-900,.dark .text-gray-900{color:#f1f5f9!important}' +
      '[data-theme="dark"] .text-gray-800,.dark .text-gray-800{color:#e2e8f0!important}' +
      '[data-theme="dark"] .text-gray-700,.dark .text-gray-700{color:#cbd5e1!important}' +
      '[data-theme="dark"] .text-gray-600,.dark .text-gray-600{color:#94a3b8!important}' +
      '[data-theme="dark"] .text-gray-500,.dark .text-gray-500{color:#64748b!important}' +
      '[data-theme="dark"] .text-gray-400,.dark .text-gray-400{color:#64748b!important}' +
      '[data-theme="dark"] .bg-gray-50\\/50,.dark .bg-gray-50\\/50{background:#0f172a!important}' +
      '[data-theme="dark"] .bg-white\\/90,.dark .bg-white\\/90{background:rgba(11,15,26,.92)!important}' +
      /* Category / listing page elements */
      '[data-theme="dark"] .product-card{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      '[data-theme="dark"] .toolbar-wrap{background:#111827!important;border-color:rgba(255,255,255,.06)!important;box-shadow:0 1px 3px rgba(0,0,0,.2)!important}' +
      '[data-theme="dark"] .filter-pill{background:rgba(255,255,255,.06)!important;color:#94a3b8!important;border-color:transparent!important}' +
      '[data-theme="dark"] .filter-pill:hover{background:rgba(29,106,255,.12)!important;color:#60a5fa!important;border-color:rgba(29,106,255,.25)!important}' +
      '[data-theme="dark"] .filter-pill.active{background:#1D6AFF!important;color:#fff!important;border-color:#1D6AFF!important}' +
      '[data-theme="dark"] .dropdown-menu{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      '[data-theme="dark"] .dropdown-menu a{color:#94a3b8!important}' +
      '[data-theme="dark"] .dropdown-menu a:hover{background:rgba(29,106,255,.1)!important;color:#60a5fa!important}' +
      '[data-theme="dark"] #mobile-menu{background:#0b0f1a!important;border-color:rgba(255,255,255,.06)!important}' +
      /* Related / content cards with inline bg:white */
      '[data-theme="dark"] .related-card{background:#151c2e!important;border-color:rgba(255,255,255,.06)!important}' +
      '[data-theme="dark"] .variant-btn{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      /* Sort dropdown */
      '[data-theme="dark"] .kf-sort-trigger{background:#111827!important;border-color:rgba(255,255,255,.08)!important;color:#e2e8f0!important}' +
      '[data-theme="dark"] .kf-sort-panel{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      /* Colored bg-*-50 icon backgrounds */
      '[data-theme="dark"] .bg-blue-50{background:rgba(29,106,255,.12)!important}' +
      '[data-theme="dark"] .bg-purple-50{background:rgba(162,89,255,.12)!important}' +
      '[data-theme="dark"] .bg-green-50{background:rgba(16,185,129,.12)!important}' +
      '[data-theme="dark"] .bg-orange-50{background:rgba(245,158,11,.12)!important}' +
      '[data-theme="dark"] .bg-red-50{background:rgba(239,68,68,.12)!important}' +
      '[data-theme="dark"] .bg-pink-50{background:rgba(236,72,153,.12)!important}' +
      '[data-theme="dark"] .bg-indigo-50{background:rgba(99,102,241,.12)!important}' +
      '[data-theme="dark"] .bg-amber-50{background:rgba(245,158,11,.12)!important}' +
      '[data-theme="dark"] .bg-rose-50{background:rgba(244,63,94,.12)!important}' +
      '[data-theme="dark"] .bg-yellow-50{background:rgba(234,179,8,.12)!important}' +
      /* Colored border-*-100 */
      '[data-theme="dark"] .border-blue-100{border-color:rgba(29,106,255,.2)!important}' +
      '[data-theme="dark"] .border-purple-100{border-color:rgba(162,89,255,.2)!important}' +
      '[data-theme="dark"] .border-green-100{border-color:rgba(16,185,129,.2)!important}' +
      '[data-theme="dark"] .border-orange-100{border-color:rgba(245,158,11,.2)!important}' +
      /* Colored text */
      '[data-theme="dark"] .text-blue-600{color:#60a5fa!important}' +
      '[data-theme="dark"] .text-purple-600{color:#c084fc!important}' +
      '[data-theme="dark"] .text-green-600{color:#34d399!important}' +
      '[data-theme="dark"] .text-orange-600{color:#fbbf24!important}' +
      '[data-theme="dark"] .text-blue-500{color:#60a5fa!important}' +
      '[data-theme="dark"] .text-purple-500{color:#c084fc!important}' +
      '[data-theme="dark"] .text-green-500{color:#34d399!important}' +
      '[data-theme="dark"] .text-yellow-600{color:#fbbf24!important}' +
      '[data-theme="dark"] .text-yellow-400{color:#facc15!important}' +
      /* About page specific cards */
      '[data-theme="dark"] .stat-card{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      '[data-theme="dark"] .team-card{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      '[data-theme="dark"] .value-card{background:#151c2e!important;border-color:rgba(255,255,255,.08)!important}' +
      /* Shadow override for cards */
      '[data-theme="dark"] .shadow-lg{box-shadow:0 4px 16px rgba(0,0,0,.3)!important}' +
      '[data-theme="dark"] .shadow-sm{box-shadow:0 1px 4px rgba(0,0,0,.2)!important}' +
      /* bg-blue-50/70 variant */
      '[data-theme="dark"] .bg-blue-50\\/70{background:rgba(29,106,255,.1)!important}';
    document.head.appendChild(s);
  }
})();
