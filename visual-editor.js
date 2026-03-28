/**
 * visual-editor.js  –  Keyify Global Page Builder v2
 *
 * Activates when EITHER:
 *   • URL contains ?mode=edit  AND  user is admin (JWT in localStorage)
 *   • localStorage['keyify_editor_active'] === 'true'  AND  user is admin
 *
 * Include on every page:  <script src="visual-editor.js"></script>
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
     1. ACTIVATION GUARD
     Check URL param OR localStorage for persistent state.
  ──────────────────────────────────────────────────────────────────── */
  const params  = new URLSearchParams(window.location.search);
  const urlMode = params.get('mode') === 'edit';
  const lsMode  = localStorage.getItem('keyify_editor_active') === 'true';

  if (!urlMode && !lsMode) return;

  const token = localStorage.getItem('keyify_token');
  const role  = localStorage.getItem('keyify_role');
  if (!token || role !== 'admin') {
    console.warn('[KVE] Editor mode requires admin login.');
    localStorage.removeItem('keyify_editor_active');
    return;
  }

  // Persist editor state across page navigations
  if (urlMode) localStorage.setItem('keyify_editor_active', 'true');

  const API  = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
  const lang = localStorage.getItem('keyify_lang') || 'sr';

  /* ─────────────────────────────────────────────────────────────────
     2. STATE
  ──────────────────────────────────────────────────────────────────── */
  const pendingLayout = new Map();   // productId → { grid_order?, card_size? }
  let   dragSrc       = null;

  /* ─────────────────────────────────────────────────────────────────
     HELPERS
  ──────────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function makeStarsSVG(n) {
    const filled = Math.min(5, Math.max(0, parseInt(n) || 5));
    const sf = '<svg class="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    const se = '<svg class="w-3.5 h-3.5 text-gray-300" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    return Array.from({ length: 5 }, (_, i) => i < filled ? sf : se).join('');
  }

  /** Derive current page slug from pathname: "about.html" → "about", "/" → "index" */
  function getPageSlug() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/i, '') || 'index';
  }

  const CATEGORIES = [
    { value: 'ai',        label: '🤖 AI Alati'           },
    { value: 'design',    label: '🎨 Design & Creativity' },
    { value: 'business',  label: '💼 Business Software'   },
    { value: 'windows',   label: '🪟 Windows & Office'    },
    { value: 'music',     label: '🎵 Music Streaming'     },
    { value: 'streaming', label: '📺 TV/Video Streaming'  },
  ];

  /* ─────────────────────────────────────────────────────────────────
     3. BOOT
  ──────────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    injectStyles();
    injectToolbar();
    watchGrid();
    initContentEditor();        // existing: [data-ck] key/value text fields
    initSmartEngine();          // Universal click delegator (replaces initGlobalTextEditing)
    initSectionHoverControls(); // Floating toolbar on section/header/article hover
    injectAddSectionBtn();      // NEW: + Dodaj novu sekciju button
  }

  /* ─────────────────────────────────────────────────────────────────
     4. STYLES
  ──────────────────────────────────────────────────────────────────── */
  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'kve-styles';
    s.textContent = `
      /* ── Toolbar ──────────────────────────────── */
      #kve-toolbar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: linear-gradient(90deg, #1254D4 0%, #1D6AFF 40%, #A259FF 100%);
        color: #fff; display: flex; align-items: center; gap: 8px;
        padding: 8px 16px; font-family: 'Inter', sans-serif;
        font-size: 12px; font-weight: 600;
        box-shadow: 0 4px 24px rgba(29,106,255,0.45);
        flex-wrap: wrap;
      }
      #kve-toolbar .kve-pill {
        background: rgba(255,255,255,0.18); border-radius: 20px;
        padding: 3px 10px; font-size: 11px; letter-spacing: .05em; white-space: nowrap;
      }
      #kve-toolbar .kve-hint {
        flex: 1; color: rgba(255,255,255,0.72); font-weight: 400; font-size: 11px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #kve-toolbar button {
        background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.28);
        color: #fff; border-radius: 8px; padding: 5px 13px; font-size: 12px;
        font-weight: 700; cursor: pointer; white-space: nowrap;
        transition: background .15s;
      }
      #kve-toolbar button:hover { background: rgba(255,255,255,0.28); }
      #kve-toolbar .kve-save-btn {
        background: rgba(255,255,255,0.92); color: #1D6AFF; border-color: transparent;
      }
      #kve-toolbar .kve-save-btn:hover { background: #fff; }
      #kve-toolbar .kve-page-btn {
        background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.5);
      }
      body.kve-active { padding-top: 48px !important; }

      /* ── Product card wrapper ──────────────────── */
      .kve-wrap { position: relative; padding-top: 50px; margin-top: -50px; }
      .kve-wrap._kve-hover > .product-card {
        box-shadow: 0 0 0 2px #1D6AFF, 0 8px 32px rgba(29,106,255,0.2) !important;
      }
      .kve-wrap[draggable="true"] { cursor: grab; }
      .kve-wrap[draggable="true"]:active { cursor: grabbing; }
      .kve-wrap .kve-card-bar { cursor: default !important; }
      .kve-wrap.kve-dragging { opacity: .35; transform: scale(.96); transition: .2s; }
      .kve-wrap.kve-drag-over::after {
        content: ''; position: absolute; inset: -4px; border-radius: 20px;
        border: 2.5px dashed #1D6AFF; background: rgba(29,106,255,0.07);
        pointer-events: none; z-index: 5;
      }
      .kve-wrap.kve-lg { grid-column: span 2 !important; }

      /* ── Per-card toolbar ──────────────────────── */
      .kve-card-bar {
        position: absolute; top: 16px; right: 16px; z-index: 20;
        display: flex; gap: 4px; opacity: 0;
        transition: opacity .18s; pointer-events: none;
      }
      .kve-wrap._kve-hover .kve-card-bar { opacity: 1; pointer-events: auto; }
      .kve-card-bar button {
        width: 30px; height: 30px; border-radius: 9px; border: none;
        font-size: 14px; cursor: pointer !important; display: flex; align-items: center;
        justify-content: center; transition: filter .15s, box-shadow .15s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      }
      .kve-card-bar button:hover { brightness: 1.3; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
      .kve-btn-img   { background: #1D6AFF; }
      .kve-btn-price { background: #059669; }
      .kve-btn-size  { background: #7C3AED; }
      .kve-btn-cat   { background: #D97706; }
      .kve-btn-del   { background: #dc2626; }

      /* ── Contenteditable: product fields ──────── */
      [data-kve-field][contenteditable="true"] {
        outline: none; cursor: text; border-radius: 3px;
        transition: background .15s, box-shadow .15s;
      }
      [data-kve-field][contenteditable="true"]:hover {
        background: rgba(29,106,255,0.06);
        box-shadow: 0 0 0 1px rgba(29,106,255,0.3);
      }
      [data-kve-field][contenteditable="true"]:focus {
        background: rgba(29,106,255,0.08); box-shadow: 0 0 0 2px #1D6AFF;
      }

      /* ── Contenteditable: global text (h1/h2/h3/p) ── */
      .kve-text-editable {
        border-radius: 4px; cursor: text;
        transition: background .15s, box-shadow .15s;
        min-width: 1em;
      }
      .kve-text-editable:hover {
        background: rgba(29,106,255,0.06);
        box-shadow: 0 0 0 1.5px rgba(29,106,255,0.35);
      }
      .kve-text-editable[contenteditable="true"] {
        background: rgba(29,106,255,0.09);
        box-shadow: 0 0 0 2.5px #1D6AFF;
        outline: none;
      }

      /* ── "Saved" flash badge (per product card) ── */
      .kve-saved {
        position: absolute; bottom: 12px; left: 12px; z-index: 30;
        background: #10b981; color: #fff; font-size: 10px; font-weight: 700;
        padding: 3px 9px; border-radius: 999px; pointer-events: none;
        opacity: 0; transform: translateY(4px);
        transition: opacity .25s, transform .25s;
      }
      .kve-saved.show { opacity: 1; transform: translateY(0); }
      .kve-saved.error { background: #ef4444; }

      /* ── Section hover outline ─────────────────── */
      body.kve-active section,
      body.kve-active header,
      body.kve-active article {
        position: relative;
        outline: 1px dashed transparent;
        transition: outline-color .18s;
      }
      body.kve-active section:hover,
      body.kve-active header:hover,
      body.kve-active article:hover {
        outline-color: rgba(29,106,255,0.4);
      }

      /* ── Section floating toolbar ──────────────── */
      .kve-section-bar {
        position: absolute; top: 8px; right: 8px; z-index: 9998;
        display: flex; gap: 5px; flex-wrap: wrap; max-width: calc(100% - 16px);
        opacity: 0; pointer-events: none;
        transition: opacity .18s;
      }
      section:hover > .kve-section-bar,
      header:hover  > .kve-section-bar,
      article:hover > .kve-section-bar,
      .kve-section-bar:hover {
        opacity: 1; pointer-events: auto;
      }
      .kve-section-bar button {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 5px 10px; border: none; border-radius: 8px;
        font-size: 11px; font-weight: 700; cursor: pointer;
        font-family: 'Inter', sans-serif;
        box-shadow: 0 3px 12px rgba(0,0,0,0.3);
        transition: transform .12s, box-shadow .12s;
        white-space: nowrap;
      }
      .kve-section-bar button:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(0,0,0,0.38);
      }
      .kve-sec-delete    { background: #ef4444; color: #fff; }
      .kve-sec-style     { background: #1D6AFF; color: #fff; }
      .kve-sec-move-up   { background: #7C3AED; color: #fff; }
      .kve-sec-move-down { background: #059669; color: #fff; }

      /* ── + Add Section button ──────────────────── */
      #kve-add-section-btn {
        display: block; width: calc(100% - 48px); max-width: 560px;
        margin: 28px auto 52px; padding: 18px 24px;
        border: 2.5px dashed rgba(29,106,255,0.42);
        background: rgba(29,106,255,0.04); border-radius: 16px;
        cursor: pointer; text-align: center;
        font-family: 'Inter', sans-serif; font-size: 14px;
        font-weight: 700; color: #1D6AFF;
        transition: border-color .2s, background .2s, transform .15s;
        user-select: none;
      }
      #kve-add-section-btn:hover {
        border-color: #1D6AFF; background: rgba(29,106,255,0.1);
        transform: scale(1.01);
      }

      /* ── Block Library Modal ───────────────────── */
      #kve-block-library {
        position: fixed; inset: 0; background: rgba(0,0,0,0.65);
        z-index: 999999; display: flex; align-items: center; justify-content: center;
        animation: kveFadeIn .15s ease;
      }
      .kve-bl-panel {
        background: #0f0f1e; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 20px; padding: 28px 24px;
        width: 720px; max-width: calc(100vw - 24px);
        max-height: 88vh; overflow-y: auto;
        font-family: 'Inter', sans-serif; color: #e2e2f0;
        box-shadow: 0 36px 90px rgba(0,0,0,0.75);
        animation: kveSlideUp .22s ease;
      }
      .kve-bl-panel::-webkit-scrollbar { width: 5px; }
      .kve-bl-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      .kve-bl-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 6px;
      }
      .kve-bl-header h3 {
        font-family: 'Poppins', sans-serif; font-size: 17px;
        font-weight: 700; color: #fff; margin: 0;
      }
      .kve-bl-close {
        width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
        background: rgba(255,255,255,0.07); border: none;
        color: #9090b8; font-size: 16px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      .kve-bl-close:hover { background: rgba(255,255,255,0.15); color: #fff; }
      .kve-bl-subtitle { font-size: 12px; color: #5050a0; margin: 0 0 20px; }
      .kve-bl-grid {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;
      }
      @media (max-width: 540px) { .kve-bl-grid { grid-template-columns: 1fr; } }
      .kve-bl-card {
        border: 1px solid rgba(255,255,255,0.08); border-radius: 14px;
        overflow: hidden; cursor: pointer;
        transition: border-color .15s, transform .15s, box-shadow .15s;
      }
      .kve-bl-card:hover {
        border-color: #1D6AFF; transform: translateY(-3px);
        box-shadow: 0 10px 36px rgba(29,106,255,0.28);
      }
      .kve-bl-card:focus-visible {
        outline: 2px solid #1D6AFF; outline-offset: 2px;
      }
      .kve-bl-preview {
        background: #1a1a2e; height: 110px;
        display: flex; align-items: center; justify-content: center;
        padding: 14px; overflow: hidden; pointer-events: none;
      }
      .kve-bl-info { padding: 12px 14px; }
      .kve-bl-name { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 3px; }
      .kve-bl-desc { font-size: 11px; color: #5050a0; }

      /* ── Inline modal ──────────────────────────── */
      .kve-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        z-index: 999999; display: flex; align-items: center; justify-content: center;
        animation: kveFadeIn .15s ease;
      }
      @keyframes kveFadeIn { from { opacity: 0 } to { opacity: 1 } }
      .kve-modal {
        background: #13132a; border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px; padding: 26px; width: 380px; max-width: calc(100vw - 32px);
        font-family: 'Inter', sans-serif; color: #e2e2f0;
        box-shadow: 0 24px 64px rgba(0,0,0,0.65);
        animation: kveSlideUp .2s ease;
      }
      @keyframes kveSlideUp {
        from { transform: translateY(14px); opacity: 0 }
        to   { transform: translateY(0);    opacity: 1 }
      }
      .kve-modal h4 {
        font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 700;
        color: #fff; margin: 0 0 18px;
      }
      .kve-modal label {
        display: block; font-size: 10px; font-weight: 700; color: #5050a0;
        text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px;
      }
      .kve-modal label + label { margin-top: 14px; }
      .kve-modal input, .kve-modal select {
        width: 100%; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 9px;
        padding: 9px 12px; font-size: 13px; color: #e2e2f0;
        font-family: inherit;
      }
      .kve-modal input:focus, .kve-modal select:focus {
        outline: none; border-color: #1D6AFF;
        box-shadow: 0 0 0 3px rgba(29,106,255,0.15);
      }
      .kve-modal select option { background: #13132a; }
      .kve-modal-actions { display: flex; gap: 8px; margin-top: 20px; }
      .kve-modal-actions button {
        flex: 1; padding: 10px; border-radius: 9px; font-size: 13px;
        font-weight: 700; cursor: pointer; border: none; font-family: inherit;
        transition: opacity .15s;
      }
      .kve-modal-actions button:hover { opacity: .85; }
      .kve-btn-cancel { background: rgba(255,255,255,0.07); color: #9090b8; }
      .kve-btn-ok     { background: linear-gradient(135deg, #1D6AFF, #A259FF); color: #fff; }

      /* ── Colour swatches (section style modal) ─── */
      .kve-swatch-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .kve-swatch {
        width: 28px; height: 28px; border-radius: 7px; cursor: pointer;
        border: 2.5px solid transparent;
        transition: transform .12s, border-color .12s;
      }
      .kve-swatch:hover { transform: scale(1.18); }
      .kve-swatch.active { border-color: #fff; }

      /* ── Context menu ──────────────────────────── */
      #kve-ctx {
        position: fixed; z-index: 999998;
        background: #13132a; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px; padding: 5px; min-width: 190px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.55);
        font-family: 'Inter', sans-serif; font-size: 13px;
        animation: kveFadeIn .12s ease;
      }
      #kve-ctx .kve-ctx-header {
        font-size: 10px; font-weight: 700; color: #5050a0;
        text-transform: uppercase; letter-spacing: .08em;
        padding: 6px 12px 4px; cursor: default;
      }
      #kve-ctx .kve-ctx-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 4px 0; }
      #kve-ctx .kve-ctx-item {
        padding: 8px 12px; color: #c0c0d8; border-radius: 7px;
        cursor: pointer; transition: background .12s;
      }
      #kve-ctx .kve-ctx-item:hover { background: rgba(29,106,255,0.22); color: #fff; }

      /* ── Add product card ──────────────────────── */
      .kve-add-card-wrap {
        cursor: pointer; border-radius: 20px;
        border: 2.5px dashed rgba(29,106,255,0.4);
        background: rgba(29,106,255,0.04);
        min-height: 200px; display: flex; align-items: center;
        justify-content: center; flex-direction: column; gap: 10px;
        transition: border-color .2s, background .2s, transform .15s;
        user-select: none;
      }
      .kve-add-card-wrap:hover {
        border-color: #1D6AFF; background: rgba(29,106,255,0.1);
        transform: scale(1.02);
      }
      .kve-add-icon {
        width: 52px; height: 52px; border-radius: 50%;
        background: rgba(29,106,255,0.15); border: 2px dashed #1D6AFF;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; color: #1D6AFF; font-weight: 300;
        transition: background .2s;
      }
      .kve-add-card-wrap:hover .kve-add-icon { background: rgba(29,106,255,0.28); }
      .kve-add-label {
        font-family: 'Inter', sans-serif; font-size: 13px;
        font-weight: 600; color: #1D6AFF; opacity: .85;
      }

      /* ── Empty-state placeholder ───────────────── */
      .kve-empty-placeholder {
        grid-column: 1 / -1; cursor: pointer; border-radius: 24px;
        border: 2.5px dashed rgba(29,106,255,0.35);
        background: rgba(29,106,255,0.03); min-height: 320px;
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 16px;
        transition: border-color .2s, background .2s, transform .15s;
        user-select: none;
      }
      .kve-empty-placeholder:hover {
        border-color: #1D6AFF; background: rgba(29,106,255,0.08);
        transform: scale(1.005);
      }
      .kve-empty-placeholder .kve-add-icon { width: 72px; height: 72px; font-size: 36px; }
      .kve-empty-placeholder .kve-add-label { font-size: 16px; }
      .kve-empty-subtitle {
        font-family: 'Inter', sans-serif; font-size: 12px;
        color: rgba(255,255,255,0.3); margin-top: -8px;
      }

      /* ── Draft card (inline product creation) ──── */
      .kve-draft-wrap {
        border-radius: 20px; border: 2px solid #1D6AFF;
        background: rgba(19,19,42,0.95); backdrop-filter: blur(8px);
        padding: 18px; display: flex; flex-direction: column; gap: 12px;
        box-shadow: 0 0 0 4px rgba(29,106,255,0.15), 0 12px 40px rgba(0,0,0,0.4);
        animation: kveSlideUp .2s ease;
      }
      .kve-draft-wrap input, .kve-draft-wrap select {
        width: 100%; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 9px;
        padding: 9px 12px; font-size: 13px; color: #e2e2f0;
        font-family: 'Inter', sans-serif; box-sizing: border-box;
      }
      .kve-draft-wrap input:focus, .kve-draft-wrap select:focus {
        outline: none; border-color: #1D6AFF;
        box-shadow: 0 0 0 3px rgba(29,106,255,0.15);
      }
      .kve-draft-wrap select option { background: #13132a; }
      .kve-draft-name[contenteditable], .kve-draft-desc[contenteditable] {
        outline: none; border-radius: 9px; padding: 9px 12px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        color: #e2e2f0; font-family: 'Inter', sans-serif; min-height: 36px;
      }
      .kve-draft-name[contenteditable] { font-size: 14px; font-weight: 700; }
      .kve-draft-desc[contenteditable] { font-size: 13px; min-height: 54px; }
      .kve-draft-name:empty::before, .kve-draft-desc:empty::before {
        content: attr(data-placeholder); color: rgba(255,255,255,0.25); pointer-events: none;
      }
      .kve-draft-name:focus, .kve-draft-desc:focus {
        border-color: #1D6AFF; box-shadow: 0 0 0 3px rgba(29,106,255,0.15);
      }
      .kve-draft-row { display: flex; gap: 8px; }
      .kve-draft-row input { flex: 1; }
      .kve-draft-row select { flex: 1.4; }
      .kve-draft-actions { display: flex; gap: 8px; margin-top: 4px; }
      .kve-draft-save, .kve-draft-cancel {
        flex: 1; padding: 10px; border-radius: 9px; font-size: 13px;
        font-weight: 700; cursor: pointer; border: none;
        font-family: 'Inter', sans-serif; transition: opacity .15s;
      }
      .kve-draft-save   { background: linear-gradient(135deg,#1D6AFF,#A259FF); color: #fff; }
      .kve-draft-cancel { background: rgba(255,255,255,0.07); color: #9090b8; }
      .kve-draft-save:hover, .kve-draft-cancel:hover { opacity: .82; }
      .kve-draft-save:disabled { opacity: .5; cursor: not-allowed; }
      .kve-draft-img-zone { display: flex; flex-direction: column; gap: 6px; }
      .kve-draft-img-row { display: flex; gap: 6px; align-items: center; }
      .kve-draft-img-row input[type="url"] { flex: 1; }
      .kve-draft-img-upload-btn {
        padding: 8px 12px; border-radius: 9px; font-size: 12px; font-weight: 600;
        cursor: pointer; border: 1px solid rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.06); color: #9090b8;
        font-family: 'Inter', sans-serif; transition: all .15s; white-space: nowrap;
      }
      .kve-draft-img-upload-btn:hover { background: rgba(29,106,255,0.15); border-color: #1D6AFF; color: #fff; }
      .kve-draft-img-upload-btn.uploading { opacity: .6; cursor: not-allowed; }
      .kve-draft-img-thumb {
        width: 100%; height: 80px; border-radius: 9px; object-fit: cover;
        border: 1px solid rgba(255,255,255,0.1); display: none;
      }

      /* ── [data-ck] content fields ──────────────── */
      [data-ck] {
        outline: 2px dashed rgba(29,106,255,0.35); border-radius: 4px;
        padding: 1px 3px; cursor: text; min-width: 1em;
        display: inline-block; position: relative;
        transition: outline-color .15s, background .15s;
      }
      [data-ck]:hover { outline-color: rgba(29,106,255,0.75); }
      [data-ck]:focus { outline: 2px solid #1D6AFF; background: rgba(29,106,255,0.05); }
      [data-ck]::before {
        content: attr(data-ck); position: absolute; top: -18px; left: 0;
        font-size: 9px; font-weight: 700; letter-spacing: .04em;
        color: #1D6AFF; background: rgba(29,106,255,0.1);
        padding: 1px 5px; border-radius: 3px; pointer-events: none;
        white-space: nowrap; opacity: 0; transition: opacity .15s;
        font-family: 'Inter', monospace;
      }
      [data-ck]:hover::before { opacity: 1; }

      /* ── Toast notification ────────────────────── */
      #kve-toast {
        position: fixed; bottom: 24px; right: 24px; z-index: 100000;
        padding: 10px 18px; border-radius: 10px;
        font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; color: #fff;
        pointer-events: none; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        transition: opacity .3s ease;
      }

      /* ── Universal Smart Engine ────────────────── */
      #kve-smart-toolbar {
        position: fixed; z-index: 999997;
        display: none; gap: 4px; align-items: center;
        background: #13132a; border: 1px solid rgba(255,255,255,0.13);
        border-radius: 10px; padding: 5px 7px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.55);
        font-family: 'Inter', sans-serif;
        pointer-events: auto;
      }
      #kve-smart-toolbar.kve-st-visible {
        display: flex;
        animation: kveFadeIn .12s ease;
      }
      #kve-smart-toolbar button {
        display: inline-flex; align-items: center; gap: 3px;
        padding: 5px 9px; border: none; border-radius: 7px;
        font-size: 11px; font-weight: 700; cursor: pointer;
        font-family: inherit; white-space: nowrap;
        background: rgba(255,255,255,0.08); color: #c0c0d8;
        transition: background .12s, color .12s;
      }
      #kve-smart-toolbar button:hover { background: rgba(29,106,255,0.3); color: #fff; }
      #kve-smart-toolbar .kve-st-label {
        font-size: 10px; font-weight: 700; color: #5050a0;
        text-transform: uppercase; letter-spacing: .07em;
        padding: 0 4px 0 2px; white-space: nowrap; user-select: none;
      }
      #kve-smart-toolbar .kve-st-sep {
        width: 1px; height: 16px; background: rgba(255,255,255,0.1);
        margin: 0 2px; flex-shrink: 0;
      }
      /* Smart element hover ring */
      body.kve-active [data-kve-smart] {
        outline: 1px dashed transparent;
        transition: outline-color .15s;
      }
      body.kve-active [data-kve-smart]:hover {
        outline: 1.5px dashed rgba(29,106,255,0.5) !important;
        border-radius: 3px; cursor: pointer;
      }
      body.kve-active [data-kve-smart].kve-smart-editing,
      body.kve-active [data-kve-smart][contenteditable="true"] {
        outline: 2px solid #1D6AFF !important;
        background: rgba(29,106,255,0.05) !important;
        border-radius: 3px;
      }
      /* Prevent native focus on form fields in edit mode */
      body.kve-active input[data-kve-smart],
      body.kve-active textarea[data-kve-smart],
      body.kve-active select[data-kve-smart] {
        cursor: pointer !important;
      }
      /* Nav-specific element highlights */
      body.kve-active [data-kve-smart="navlink"]:hover {
        outline: 1.5px dashed rgba(162,89,255,0.6) !important;
        background: rgba(162,89,255,0.06) !important;
        border-radius: 4px; cursor: pointer;
      }
      body.kve-active [data-kve-smart="navlist"]:hover {
        outline: 1.5px dashed rgba(162,89,255,0.35) !important;
        border-radius: 4px; cursor: pointer;
      }
      body.kve-active [data-kve-smart="sociallink"]:hover {
        outline: 1.5px dashed rgba(16,185,129,0.6) !important;
        background: rgba(16,185,129,0.06) !important;
        border-radius: 4px; cursor: pointer;
      }
      /* Button style picker swatches inside modal */
      .kve-btn-swatch-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .kve-btn-swatch {
        width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
        border: 2.5px solid transparent; transition: transform .12s, border-color .12s;
        flex-shrink: 0;
      }
      .kve-btn-swatch:hover  { transform: scale(1.2); }
      .kve-btn-swatch.active { border-color: #fff; }
      /* Textarea inside KVE modal */
      .kve-modal textarea {
        width: 100%; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 9px;
        padding: 9px 12px; font-size: 12px; color: #e2e2f0;
        font-family: monospace; resize: vertical; box-sizing: border-box;
      }
      .kve-modal textarea:focus {
        outline: none; border-color: #1D6AFF;
        box-shadow: 0 0 0 3px rgba(29,106,255,0.15);
      }

      /* ── Hybrid Media Modal ──────────────────────── */
      .kve-hm-tabs {
        display: flex; gap: 8px; margin-bottom: 18px;
      }
      .kve-hm-tab {
        flex: 1; padding: 8px 6px; border-radius: 9px;
        border: 1.5px solid rgba(255,255,255,0.1);
        background: transparent; color: #9090b8;
        font-size: 11px; font-weight: 700; cursor: pointer;
        transition: all .15s; font-family: inherit; text-align: center;
      }
      .kve-hm-tab:hover { border-color: rgba(255,255,255,0.22); color: #c0c0e0; }
      .kve-hm-tab.active { background: rgba(29,106,255,0.22); border-color: #1D6AFF; color: #fff; }
      .kve-hm-drop {
        border: 2px dashed rgba(255,255,255,0.15); border-radius: 12px;
        padding: 22px 14px; text-align: center; cursor: pointer;
        transition: border-color .2s, background .2s; margin-bottom: 10px;
        user-select: none;
      }
      .kve-hm-drop:hover, .kve-hm-drop.kve-drag-over {
        border-color: #1D6AFF; background: rgba(29,106,255,0.08);
      }
      .kve-hm-drop-icon { font-size: 24px; line-height: 1; margin-bottom: 6px; }
      .kve-hm-drop-text { font-size: 12px; color: #c0c0e0; font-weight: 600; }
      .kve-hm-drop-sub  { font-size: 10px; color: #5050a0; margin-top: 4px; }
      .kve-hm-preview-wrap { min-height: 56px; margin: 10px 0 4px; text-align: center; }
      .kve-hm-preview {
        display: inline-block; max-height: 88px; max-width: 100%;
        object-fit: contain; border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .kve-hm-preview-empty {
        height: 56px; background: rgba(255,255,255,0.03);
        border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; color: #5050a0;
      }
      .kve-hm-filename { font-size: 11px; color: #22c55e; text-align: center; margin-top: 4px; }
      .kve-hm-panel.hidden { display: none; }
      .kve-hm-spinner { text-align: center; font-size: 12px; color: #9090b8; padding: 6px 0; }
      /* Transform tools */
      .kve-hm-transform {
        display: flex; gap: 10px; margin-top: 14px; align-items: flex-end;
      }
      .kve-hm-transform label { font-size: 10px; font-weight: 700; color: #7070a0; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; display: block; }
      .kve-hm-transform .kve-tf-group { flex: 1; }
      .kve-hm-transform input[type=number] {
        width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px; padding: 7px 10px; font-size: 12px; color: #e2e2f0;
        font-family: inherit; box-sizing: border-box;
      }
      .kve-hm-transform input[type=number]:focus { outline: none; border-color: #1D6AFF; }
      /* Sync bar inside modal */
      .kve-hm-sync-row {
        margin-top: 14px; padding: 10px 14px; background: rgba(29,106,255,0.10);
        border: 1px solid rgba(29,106,255,0.25); border-radius: 10px;
        display: flex; align-items: center; gap: 10px; cursor: pointer;
      }
      .kve-hm-sync-row input[type=checkbox] { cursor: pointer; accent-color: #1D6AFF; }
      .kve-hm-sync-row span { font-size: 12px; color: #a0b0ff; font-weight: 600; }
    `;
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────────
     5. TOOLBAR
  ──────────────────────────────────────────────────────────────────── */
  function injectToolbar() {
    const bar = document.createElement('div');
    bar.id = 'kve-toolbar';
    bar.setAttribute('data-kve-editor', '1');
    bar.innerHTML = `
      <span class="kve-pill">✏️ PAGE BUILDER</span>
      <span class="kve-hint">Klikni bilo koji element → kontekstualni alati. Hover sekciju → strukturni toolbar. Drag karte → redosljed.</span>
      <button id="kve-exit-btn">✕ Izađi</button>
      <button id="kve-save-page-btn" class="kve-page-btn">🌐 Sačuvaj stranicu</button>
      <button class="kve-save-btn" id="kve-save-btn">💾 Sačuvaj raspored</button>
    `;
    document.body.prepend(bar);
    document.body.classList.add('kve-active');

    // ── Exit: clear localStorage + remove URL param, then clean reload
    document.getElementById('kve-exit-btn').addEventListener('click', () => {
      localStorage.removeItem('keyify_editor_active');
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      window.location.href = url.toString();
    });

    document.getElementById('kve-save-btn').addEventListener('click', saveLayout);
    document.getElementById('kve-save-page-btn').addEventListener('click', savePageHTML);
  }

  /* ─────────────────────────────────────────────────────────────────
     6. WATCH PRODUCT GRID
  ──────────────────────────────────────────────────────────────────── */
  function watchGrid() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    enhanceNewCards(grid);
    injectAddCard(grid);
    const obs = new MutationObserver(() => {
      enhanceNewCards(grid);
      if (!grid.querySelector('.kve-add-card-wrap') && !grid.querySelector('.kve-empty-placeholder')) {
        injectAddCard(grid);
      }
    });
    obs.observe(grid, { childList: true });
  }

  function enhanceNewCards(grid) {
    grid.querySelectorAll('.product-card:not([data-kve])').forEach(card => {
      card.setAttribute('data-kve', '1');
      initCard(card);
    });
  }

  function getCurrentPageCategory() {
    const match = window.location.pathname.match(/\/(ai|design|business|windows|music|streaming)\.html/i);
    return match ? match[1].toLowerCase() : 'ai';
  }

  /* ─────────────────────────────────────────────────────────────────
     6b. ADD PRODUCT CARD (empty-state & trailing)
  ──────────────────────────────────────────────────────────────────── */
  function injectAddCard(grid) {
    if (!grid) return;
    grid.querySelector('.kve-add-card-wrap')?.remove();
    grid.querySelector('.kve-empty-placeholder')?.remove();

    if (!grid.querySelector('.kve-wrap')) {
      const ph = document.createElement('div');
      ph.className = 'kve-empty-placeholder';
      ph.innerHTML = `
        <div class="kve-add-icon">+</div>
        <div class="kve-add-label">+ Dodaj proizvod</div>
        <div class="kve-empty-subtitle">Ova kategorija nema proizvoda. Klikni da dodaš prvi.</div>
      `;
      ph.addEventListener('click', () => {
        ph.remove();
        const addWrap = document.createElement('div');
        addWrap.className = 'kve-add-card-wrap';
        addWrap.innerHTML = `<div class="kve-add-icon">+</div><div class="kve-add-label">Dodaj proizvod</div>`;
        grid.appendChild(addWrap);
        spawnDraftCard(grid, addWrap);
      });
      grid.appendChild(ph);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'kve-add-card-wrap';
      wrap.innerHTML = `<div class="kve-add-icon">+</div><div class="kve-add-label">Dodaj proizvod</div>`;
      wrap.addEventListener('click', () => spawnDraftCard(grid, wrap));
      grid.appendChild(wrap);
    }
  }

  function spawnDraftCard(grid, addWrap) {
    if (grid.querySelector('.kve-draft-wrap')) return;
    const currentCat = getCurrentPageCategory();
    const wrap = document.createElement('div');
    wrap.className = 'kve-draft-wrap';
    wrap.innerHTML = `
      <div contenteditable="true" class="kve-draft-name" data-placeholder="Naziv proizvoda *"></div>
      <div contenteditable="true" class="kve-draft-desc" data-placeholder="Opis (opciono)"></div>
      <div class="kve-draft-row">
        <input type="number" class="kve-draft-price" placeholder="Cijena €" min="0.01" step="0.01"/>
        <select class="kve-draft-cat">
          ${CATEGORIES.map(c => `<option value="${esc(c.value)}"${c.value === currentCat ? ' selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="kve-draft-img-zone">
        <div class="kve-draft-img-row">
          <input type="url" class="kve-draft-img" placeholder="URL slike (opciono)"/>
          <button type="button" class="kve-draft-img-upload-btn">📁 Upload</button>
          <input type="file" class="kve-draft-img-file" accept="image/*" style="display:none">
        </div>
        <img class="kve-draft-img-thumb" alt="preview"/>
      </div>
      <div class="kve-draft-actions">
        <button class="kve-draft-save">✓ Sačuvaj</button>
        <button class="kve-draft-cancel">✕ Otkaži</button>
      </div>
    `;
    grid.insertBefore(wrap, addWrap);
    wrap.querySelector('.kve-draft-save').addEventListener('click', () => submitDraftCard(wrap));
    wrap.querySelector('.kve-draft-cancel').addEventListener('click', () => wrap.remove());

    /* ── Image upload wiring ── */
    const uploadBtn  = wrap.querySelector('.kve-draft-img-upload-btn');
    const fileInput  = wrap.querySelector('.kve-draft-img-file');
    const urlInput   = wrap.querySelector('.kve-draft-img');
    const thumb      = wrap.querySelector('.kve-draft-img-thumb');

    uploadBtn.addEventListener('click', () => fileInput.click());

    /* Show preview when URL is typed */
    urlInput.addEventListener('input', () => {
      const v = urlInput.value.trim();
      if (v) { thumb.src = v; thumb.style.display = 'block'; }
      else    { thumb.style.display = 'none'; }
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadBtn.textContent = '⏳'; uploadBtn.classList.add('uploading'); uploadBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API}/admin/upload-asset`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Upload greška');
        const { url } = await res.json();
        urlInput.value = url;
        thumb.src = url; thumb.style.display = 'block';
        uploadBtn.textContent = '✓';
        setTimeout(() => { uploadBtn.textContent = '📁 Upload'; }, 2000);
      } catch (err) {
        uploadBtn.textContent = '✗ Greška';
        setTimeout(() => { uploadBtn.textContent = '📁 Upload'; }, 2500);
      } finally {
        uploadBtn.classList.remove('uploading'); uploadBtn.disabled = false;
      }
    });

    setTimeout(() => wrap.querySelector('.kve-draft-name').focus(), 50);
  }

  async function submitDraftCard(wrap) {
    const name  = wrap.querySelector('.kve-draft-name').textContent.trim();
    const desc  = wrap.querySelector('.kve-draft-desc').textContent.trim();
    const price = parseFloat(wrap.querySelector('.kve-draft-price').value);
    const cat   = wrap.querySelector('.kve-draft-cat').value;
    const img   = wrap.querySelector('.kve-draft-img').value.trim();

    if (!name) {
      wrap.querySelector('.kve-draft-name').focus();
      wrap.querySelector('.kve-draft-name').style.borderColor = '#ef4444';
      return;
    }
    if (!price || price <= 0) {
      wrap.querySelector('.kve-draft-price').focus();
      wrap.querySelector('.kve-draft-price').style.borderColor = '#ef4444';
      return;
    }

    const saveBtn = wrap.querySelector('.kve-draft-save');
    saveBtn.textContent = '⏳ Čuvanje…'; saveBtn.disabled = true;

    const l    = localStorage.getItem('keyify_lang') || 'sr';
    const body = {
      name_sr: name, name_en: name,
      description_sr: desc, description_en: desc,
      price, category: cat, image_url: img || null,
    };
    if (l === 'en') { body.name_en = name; body.description_en = desc; }
    else            { body.name_sr = name; body.description_sr = desc; }

    try {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Greška');
      wrap.remove();
      if (window.KEYIFY && typeof window.KEYIFY.loadProducts === 'function') {
        window.KEYIFY.loadProducts();
      } else {
        window.location.reload();
      }
    } catch (err) {
      saveBtn.textContent = `✗ ${err.message}`; saveBtn.disabled = false;
      setTimeout(() => { saveBtn.textContent = '✓ Sačuvaj'; }, 3000);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     7. INIT SINGLE PRODUCT CARD
  ──────────────────────────────────────────────────────────────────── */
  function initCard(card) {
    const cartBtn = card.querySelector('[data-product]');
    if (!cartBtn) return;
    let p;
    try { p = JSON.parse(cartBtn.getAttribute('data-product')); } catch { return; }
    const id = String(p.id);

    // Wrap in draggable container
    const wrap = document.createElement('div');
    wrap.className = 'kve-wrap';
    wrap.dataset.kveId = id;
    card.parentNode.insertBefore(wrap, card);
    wrap.appendChild(card);

    const saved = pendingLayout.get(id);
    if (saved?.card_size === 'lg') wrap.classList.add('kve-lg');

    const savedEl = document.createElement('div');
    savedEl.className = 'kve-saved';
    wrap.appendChild(savedEl);

    const bar = document.createElement('div');
    bar.className = 'kve-card-bar';
    bar.innerHTML = `
      <button class="kve-btn-img"   title="Promijeni sliku">🖼</button>
      <button class="kve-btn-price" title="Uredi cijenu">€</button>
      <button class="kve-btn-size"  title="Promijeni veličinu">⬜</button>
      <button class="kve-btn-cat"   title="Premjesti kategoriju">↗</button>
      <button class="kve-btn-del"   title="Obriši proizvod" style="color:#f87171">🗑️</button>
    `;
    wrap.appendChild(bar);

    bar.querySelector('.kve-btn-img').addEventListener('click',   e => { e.stopPropagation(); openImageModal(p, id, wrap); });
    bar.querySelector('.kve-btn-price').addEventListener('click', e => { e.stopPropagation(); openPriceModal(p, id, wrap); });
    bar.querySelector('.kve-btn-size').addEventListener('click',  e => { e.stopPropagation(); toggleSize(wrap, id); });
    bar.querySelector('.kve-btn-cat').addEventListener('click',   e => { e.stopPropagation(); showCategoryMenu(e, id); });
    bar.querySelector('.kve-btn-del').addEventListener('click',   e => { e.stopPropagation(); deleteProductCard(id, p.name_sr || p.name_en || 'Proizvod', wrap); });

    const nameEl = card.querySelector('.px-4 h3');
    if (nameEl) {
      nameEl.contentEditable = 'true';
      nameEl.dataset.kveField = lang === 'en' ? 'name_en' : 'name_sr';
      nameEl.title = 'Klikni za uređivanje naziva';
      nameEl.addEventListener('blur',    () => saveField(id, nameEl.dataset.kveField, nameEl.textContent.trim(), wrap));
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
    }

    const descEl = card.querySelector('.px-4 p');
    if (descEl) {
      descEl.contentEditable = 'true';
      descEl.dataset.kveField = lang === 'en' ? 'description_en' : 'description_sr';
      descEl.title = 'Klikni za uređivanje opisa';
      descEl.addEventListener('blur',    () => saveField(id, descEl.dataset.kveField, descEl.textContent.trim(), wrap));
      descEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); descEl.blur(); } });
    }

    const starsEl = card.querySelector('.kve-stars');
    if (starsEl) {
      starsEl.style.cursor = 'pointer';
      starsEl.title = 'Klikni za promjenu ocjene (1–5)';
      starsEl.addEventListener('click', e => {
        e.stopPropagation();
        const svgs    = [...starsEl.querySelectorAll('svg')];
        const clicked = e.target.closest('svg');
        const idx     = svgs.indexOf(clicked);
        if (idx === -1) return;
        const newRating = idx + 1;
        starsEl.dataset.stars = newRating;
        starsEl.innerHTML = makeStarsSVG(newRating);
        saveField(id, 'stars', newRating, wrap);
      });
    }

    // Stable hover: only remove hover when mouse truly leaves the wrap
    wrap.addEventListener('mouseenter', () => {
      wrap.classList.add('_kve-hover');
    });
    wrap.addEventListener('mouseleave', (e) => {
      // If mouse moved to a child inside this wrap, keep hover active
      if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
      wrap.classList.remove('_kve-hover');
    });

    wrap.setAttribute('draggable', 'true');
    wrap.addEventListener('dragstart', onDragStart);
    wrap.addEventListener('dragover',  onDragOver);
    wrap.addEventListener('dragleave', onDragLeave);
    wrap.addEventListener('drop',      onDrop);
    wrap.addEventListener('dragend',   onDragEnd);

    [nameEl, descEl].forEach(el => {
      if (el) el.addEventListener('mousedown', e => e.stopPropagation());
    });
    cartBtn.setAttribute('draggable', 'false');

    wrap.addEventListener('contextmenu', e => { e.preventDefault(); showCategoryMenu(e, id); });
  }

  /* ─────────────────────────────────────────────────────────────────
     8. FIELD SAVE (product inline)
  ──────────────────────────────────────────────────────────────────── */
  async function saveField(id, field, value, wrap) {
    if (value === undefined || value === null) return;
    flashSaved(wrap, '⏳');
    try {
      const res = await fetch(`${API}/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      flashSaved(wrap, '✓ Sačuvano');
    } catch {
      flashSaved(wrap, '✗ Greška', true);
    }
  }

  function flashSaved(wrap, msg, isError = false) {
    const el = wrap.querySelector('.kve-saved');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  let _deletingProduct = false;
  async function deleteProductCard(id, name, wrap) {
    if (_deletingProduct) return;
    if (!confirm(`Obrisati "${name}"? Ova akcija je nepovratna.`)) return;
    _deletingProduct = true;
    flashSaved(wrap, '⏳ Brisanje...');
    try {
      const res = await fetch(`${API}/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Greška'); }

      // Capture positions of all sibling cards BEFORE removal
      const grid = wrap.parentElement;
      const siblings = [...grid.querySelectorAll('.kve-wrap, .kve-add-card-wrap')];
      const beforeRects = new Map();
      siblings.forEach(s => { if (s !== wrap) beforeRects.set(s, s.getBoundingClientRect()); });

      // Fade out the deleted card
      wrap.style.transition = 'opacity .25s, transform .25s';
      wrap.style.opacity = '0';
      wrap.style.transform = 'scale(.85)';

      setTimeout(() => {
        wrap.remove();

        // FLIP animation: measure new positions and animate siblings
        beforeRects.forEach((oldRect, sibling) => {
          const newRect = sibling.getBoundingClientRect();
          const dx = oldRect.left - newRect.left;
          const dy = oldRect.top  - newRect.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          sibling.style.transition = 'none';
          sibling.style.transform  = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              sibling.style.transition = 'transform .35s cubic-bezier(.4,.0,.2,1)';
              sibling.style.transform  = '';
            });
          });
        });
      }, 260);

      toastMsg('🗑️ Proizvod obrisan.');
    } catch (err) {
      flashSaved(wrap, '✗ ' + (err.message || 'Greška'), true);
    } finally {
      _deletingProduct = false;
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     9. IMAGE MODAL  (product card – upload or URL)
  ──────────────────────────────────────────────────────────────────── */
  function openImageModal(product, id, wrap) {
    const imgEl = wrap.querySelector('img');
    openHybridMediaModal(imgEl || null, {
      title: '🖼️ Promijeni sliku proizvoda',
      initSrc: product.image_url || '',
      onApply: async (url) => {
        await saveField(id, 'image_url', url, wrap);
        if (imgEl) { imgEl.src = url; imgEl.setAttribute('src', url); }
        else {
          const placeholder = wrap.querySelector('.glass-card div[style]');
          if (placeholder)
            placeholder.outerHTML = `<img src="${esc(url)}" class="max-h-24 w-auto object-contain" alt="product"/>`;
        }
      },
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     10. PRICE MODAL
  ──────────────────────────────────────────────────────────────────── */
  function openPriceModal(product, id, wrap) {
    const modal = createModal('€ Uredi cijenu', `
      <label>Nova cijena (€)</label>
      <input type="number" id="kve-price" min="0.01" step="0.01" value="${esc(parseFloat(product.price || 0).toFixed(2))}"/>
      <label>Stara cijena (€) — ostavite prazno za bez popusta</label>
      <input type="number" id="kve-orig" min="0" step="0.01"
             value="${esc(product.original_price ? parseFloat(product.original_price).toFixed(2) : '')}"/>
    `);
    modal.ok.addEventListener('click', async () => {
      const newPrice = parseFloat(modal.overlay.querySelector('#kve-price').value);
      const origVal  = modal.overlay.querySelector('#kve-orig').value.trim();
      closeModal(modal.overlay);
      if (isNaN(newPrice) || newPrice <= 0) return;
      const body = { price: newPrice, original_price: origVal ? parseFloat(origVal) : null };
      flashSaved(wrap, '⏳');
      try {
        const res = await fetch(`${API}/products/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        const priceSpan = wrap.querySelector('.text-blue-600.font-bold, .font-bold.text-blue-600');
        if (priceSpan) priceSpan.textContent = `€ ${newPrice.toFixed(2)}`;
        const glassPrice = wrap.querySelector('.glass-card .text-white\\/60');
        if (glassPrice) glassPrice.textContent = `€ ${newPrice.toFixed(2)}`;
        product.price = newPrice;
        flashSaved(wrap, '✓ Cijena sačuvana');
      } catch {
        flashSaved(wrap, '✗ Greška', true);
      }
    });
    setTimeout(() => modal.overlay.querySelector('#kve-price').focus(), 60);
  }

  /* ─────────────────────────────────────────────────────────────────
     11. SIZE TOGGLE
  ──────────────────────────────────────────────────────────────────── */
  function toggleSize(wrap, id) {
    const isLg = wrap.classList.toggle('kve-lg');
    const cur  = pendingLayout.get(id) || {};
    pendingLayout.set(id, { ...cur, card_size: isLg ? 'lg' : 'sm' });
    flashSaved(wrap, isLg ? '⬜ Velika kartica' : '▪ Normalna kartica');
  }

  /* ─────────────────────────────────────────────────────────────────
     12. CATEGORY CONTEXT MENU
  ──────────────────────────────────────────────────────────────────── */
  function showCategoryMenu(e, id) {
    removeContextMenu();
    const cardWrap = document.querySelector(`.kve-wrap[data-kve-id="${id}"]`);
    const hasSale  = !!cardWrap?.querySelector('.kve-badge-wrap');

    const menu = document.createElement('div');
    menu.id = 'kve-ctx';
    menu.setAttribute('data-kve-editor', '1');
    menu.innerHTML = `
      <div class="kve-ctx-header">Akcije</div>
      <div class="kve-ctx-item kve-ctx-sale">${hasSale ? '✕ Ukloni SALE badge' : '🏷 Dodaj SALE badge'}</div>
      <div class="kve-ctx-sep"></div>
      <div class="kve-ctx-header">Premjesti u kategoriju</div>
      <div class="kve-ctx-sep"></div>
      ${CATEGORIES.map(c => `<div class="kve-ctx-item" data-cat="${c.value}">${c.label}</div>`).join('')}
    `;
    const x = Math.min(e.clientX + 4, window.innerWidth  - 210);
    const y = Math.min(e.clientY + 4, window.innerHeight - 320);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    document.body.appendChild(menu);

    menu.querySelector('.kve-ctx-sale').addEventListener('click', () => {
      toggleSaleBadge(id, hasSale, cardWrap); removeContextMenu();
    });
    menu.querySelectorAll('.kve-ctx-item[data-cat]').forEach(item => {
      item.addEventListener('click', () => { moveToCategory(id, item.dataset.cat); removeContextMenu(); });
    });
    setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 0);
  }

  async function toggleSaleBadge(id, hasSale, wrap) {
    const newBadge = hasSale ? null : 'SALE';
    try {
      const res = await fetch(`${API}/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ badge: newBadge }),
      });
      if (!res.ok) throw new Error();
      const card      = wrap?.querySelector('.product-card');
      const imageArea = card?.querySelector('.relative.rounded-2xl.m-3');
      const badgeWrap = wrap?.querySelector('.kve-badge-wrap');
      if (newBadge) {
        if (badgeWrap) {
          badgeWrap.querySelector('span').textContent = 'SALE';
          badgeWrap.querySelector('span').className   = 'bg-red-500 text-white text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full shadow';
        } else if (imageArea) {
          const div = document.createElement('div');
          div.className = 'absolute top-3 left-3 z-20 kve-badge-wrap';
          div.innerHTML = '<span class="bg-red-500 text-white text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full shadow">SALE</span>';
          imageArea.prepend(div);
        }
      } else {
        badgeWrap?.remove();
      }
      if (wrap) flashSaved(wrap, newBadge ? '🏷 SALE' : '✕ Badge uklonjen');
    } catch {
      if (wrap) flashSaved(wrap, '✗ Greška', true);
    }
  }

  function removeContextMenu() { document.getElementById('kve-ctx')?.remove(); }

  async function moveToCategory(id, newCat) {
    const wrap = document.querySelector(`.kve-wrap[data-kve-id="${id}"]`);
    try {
      const res = await fetch(`${API}/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ category: newCat }),
      });
      if (!res.ok) throw new Error();
      if (wrap) {
        flashSaved(wrap, `→ ${newCat}`);
        setTimeout(() => {
          wrap.style.transition = 'opacity .4s, transform .4s';
          wrap.style.opacity    = '0';
          wrap.style.transform  = 'scale(.85)';
          setTimeout(() => wrap.remove(), 420);
        }, 900);
      }
    } catch {
      if (wrap) flashSaved(wrap, '✗ Greška', true);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     13. DRAG & DROP
  ──────────────────────────────────────────────────────────────────── */
  function onDragStart(e) {
    dragSrc = this; this.classList.add('kve-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.kveId);
  }
  function onDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (this !== dragSrc) this.classList.add('kve-drag-over');
  }
  function onDragLeave() { this.classList.remove('kve-drag-over'); }
  function onDrop(e) {
    e.preventDefault(); this.classList.remove('kve-drag-over');
    if (!dragSrc || this === dragSrc) return;
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    const all    = [...grid.children];
    const srcIdx = all.indexOf(dragSrc);
    const tgtIdx = all.indexOf(this);
    grid.insertBefore(dragSrc, srcIdx < tgtIdx ? this.nextSibling : this);
    syncGridOrders();
  }
  function onDragEnd() {
    if (dragSrc) { dragSrc.classList.remove('kve-dragging'); dragSrc = null; }
    document.querySelectorAll('.kve-drag-over').forEach(el => el.classList.remove('kve-drag-over'));
  }

  function syncGridOrders() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    [...grid.children].forEach((wrap, idx) => {
      const id = wrap.dataset?.kveId;
      if (!id) return;
      const cur = pendingLayout.get(id) || {};
      pendingLayout.set(id, { ...cur, grid_order: idx });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     14. SAVE LAYOUT (product grid order/sizes)
  ──────────────────────────────────────────────────────────────────── */
  async function saveLayout() {
    syncGridOrders();
    if (pendingLayout.size === 0) {
      toastMsg('Nema izmjena rasporeda za čuvanje.');
      return;
    }
    const saveBtn = document.getElementById('kve-save-btn');
    if (saveBtn) { saveBtn.textContent = '⏳ Čuvanje…'; saveBtn.disabled = true; }

    const items = [...pendingLayout.entries()].map(([id, data]) => ({ id, ...data }));
    try {
      const res = await fetch(`${API}/products/layout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error();
      pendingLayout.clear();
      if (saveBtn) saveBtn.textContent = '✓ Sačuvano!';
      setTimeout(() => {
        if (saveBtn) { saveBtn.textContent = '💾 Sačuvaj raspored'; saveBtn.disabled = false; }
      }, 2400);
    } catch {
      if (saveBtn) { saveBtn.textContent = '✗ Greška!'; saveBtn.disabled = false; }
      setTimeout(() => { if (saveBtn) saveBtn.textContent = '💾 Sačuvaj raspored'; }, 2400);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     14b. SAVE PAGE HTML
     Clones <main> (or <body>), strips all editor UI, posts to backend.
  ──────────────────────────────────────────────────────────────────── */
  async function savePageHTML() {
    const btn = document.getElementById('kve-save-page-btn');
    if (btn) { btn.textContent = '⏳ Čuvanje…'; btn.disabled = true; }

    // Clone target — prefer <main>, fall back to <body>
    const target = document.querySelector('main') || document.body;
    const clone  = target.cloneNode(true);

    // Strip every piece of editor UI injected at runtime
    const editorSelectors = [
      '[data-kve-editor]',
      '.kve-section-bar',
      '.kve-card-bar',
      '.kve-saved',
      '.kve-draft-wrap',
      '.kve-add-card-wrap',
      '.kve-empty-placeholder',
      '#kve-add-section-btn',
      '#kve-toast',
    ];
    clone.querySelectorAll(editorSelectors.join(', ')).forEach(el => el.remove());

    // Remove runtime attributes injected by editor
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-original-text]').forEach(el => el.removeAttribute('data-original-text'));
    clone.querySelectorAll('[data-kve-bg-class]').forEach(el => el.removeAttribute('data-kve-bg-class'));
    clone.querySelectorAll('[data-kve-smart]').forEach(el => el.removeAttribute('data-kve-smart'));
    clone.querySelectorAll('.kve-text-editable').forEach(el => el.classList.remove('kve-text-editable'));
    clone.querySelectorAll('.kve-smart-editing').forEach(el => el.classList.remove('kve-smart-editing'));

    const html = clone.innerHTML;
    const slug = getPageSlug();

    try {
      const res = await fetch(`${API}/pages/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug, html }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Server greška');
      toastMsg(`🌐 Stranica "${slug}" sačuvana!`);
      if (btn) btn.textContent = '✓ Sačuvano';
      setTimeout(() => { if (btn) { btn.textContent = '🌐 Sačuvaj stranicu'; btn.disabled = false; } }, 2600);
    } catch (err) {
      toastMsg(`✗ ${err.message}`, true);
      if (btn) { btn.textContent = '✗ Greška'; btn.disabled = false; }
      setTimeout(() => { if (btn) btn.textContent = '🌐 Sačuvaj stranicu'; }, 2600);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     15. MODAL HELPER
  ──────────────────────────────────────────────────────────────────── */
  function createModal(title, bodyHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'kve-overlay';
    overlay.setAttribute('data-kve-editor', '1');
    overlay.innerHTML = `
      <div class="kve-modal">
        <h4>${title}</h4>
        ${bodyHtml}
        <div class="kve-modal-actions">
          <button class="kve-btn-cancel">Otkaži</button>
          <button class="kve-btn-ok">Sačuvaj</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const ok     = overlay.querySelector('.kve-btn-ok');
    const cancel = overlay.querySelector('.kve-btn-cancel');
    cancel.addEventListener('click', () => closeModal(overlay));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { closeModal(overlay); document.removeEventListener('keydown', escHandler); }
    });
    return { overlay, ok, cancel };
  }

  function closeModal(overlay) { overlay?.remove(); }

  /* ─────────────────────────────────────────────────────────────────
     16. DATA-CK PAGE CONTENT EDITOR (existing key/value system)
  ──────────────────────────────────────────────────────────────────── */
  function initContentEditor() {
    document.querySelectorAll('[data-ck]').forEach(el => {
      el.contentEditable = 'true';
      el.dataset.ckOriginal = el.textContent.trim();

      el.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') { el.textContent = el.dataset.ckOriginal; el.blur(); }
      });

      el.addEventListener('blur', async () => {
        const newVal = el.textContent.trim();
        if (newVal === el.dataset.ckOriginal) return;
        try {
          const res = await fetch(`${API}/content/${encodeURIComponent(el.dataset.ck)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ value: newVal }),
          });
          if (!res.ok) throw new Error();
          el.dataset.ckOriginal = newVal;
          toastMsg('✓ Sačuvano');
        } catch {
          el.textContent = el.dataset.ckOriginal;
          toastMsg('✗ Greška pri čuvanju', true);
        }
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     17. UNIVERSAL SMART ENGINE
     Single capture-phase listener handles ALL element types.
     No per-element wiring — pure event delegation.
  ──────────────────────────────────────────────────────────────────── */

  let _smartEl   = null;   // currently active element
  let _smartType = null;   // its type string
  let _stToolbar = null;   // #kve-smart-toolbar DOM ref

  /** Containers/ancestors that the engine must never intercept */
  const _SKIP_PARENTS = [
    '[data-kve-editor]', '[data-kve-field]', '[data-ck]',
    'footer', '.kve-draft-wrap', '.product-card', '.kve-overlay',
    '#modal-overlay', '#user-detail-overlay', '#create-user-overlay',
    '#guest-info-overlay', '.toast',
    // NOTE: 'nav' intentionally omitted — nav links/lists are handled as navlink/navlist types
  ];

  function initSmartEngine() {
    _stToolbar = document.createElement('div');
    _stToolbar.id = 'kve-smart-toolbar';
    _stToolbar.setAttribute('data-kve-editor', '1');
    document.body.appendChild(_stToolbar);

    /* Mark eligible elements in the initial DOM */
    _scanAndMarkElements(document.body);

    /* Capture-phase: fires before native browser focus/navigation */
    document.addEventListener('click', _onSmartClick, true);

    /* Dismiss when clicking outside any smart-marked element or the toolbar */
    document.addEventListener('click', e => {
      if (e.target.closest('#kve-smart-toolbar')) return;
      if (!e.target.closest('[data-kve-smart]')) _deactivateSmart();
    }, false);

    /* Right-click: nav links and social icons open the toolbar too */
    document.addEventListener('contextmenu', e => {
      const navLink    = e.target.closest('[data-kve-smart="navlink"]');
      const socialLink = e.target.closest('[data-kve-smart="sociallink"]');
      const target     = navLink || socialLink;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      _smartEl   = target;
      _smartType = target.dataset.kveSmart;
      _showSmartToolbar(target, _smartType);
    }, true);

    /* Escape: cancel editing / close toolbar */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !_smartEl) return;
      if (_smartEl.contentEditable === 'true') {
        if (_smartEl.dataset.originalText !== undefined) {
          _smartEl.innerHTML = _smartEl.dataset.originalText;
        }
        _smartEl.contentEditable = 'false';
        _smartEl.classList.remove('kve-smart-editing');
      }
      _deactivateSmart();
    });
  }

  /** Add data-kve-smart="type" to all eligible descendants of root */
  function _scanAndMarkElements(root) {
    root.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,span,a,button,input,textarea,select,img,nav,ul,ol,li'
    ).forEach(el => {
      if (_shouldSkipEl(el)) return;
      const type = _detectSmartType(el);
      if (type) el.setAttribute('data-kve-smart', type);
    });
  }

  function _shouldSkipEl(el) {
    return _SKIP_PARENTS.some(sel => {
      try { return el.matches(sel) || !!el.closest(sel); } catch { return false; }
    });
  }

  function _detectSmartType(el) {
    const tag    = el.tagName;
    const inNav  = !!el.closest('nav, [role="navigation"]');

    /* ── Nav-specific types (checked before generic) ── */
    if (tag === 'NAV' || tag === '[role="navigation"]') return 'navlist';
    if (tag === 'UL' && inNav)  return 'navlist';
    if (tag === 'OL' && inNav)  return 'navlist';
    if (inNav && tag === 'LI')  return 'navlink';
    if (inNav && tag === 'A')   return 'navlink';

    /* ── Social link: <a> whose only/primary child is an icon (svg or <i>) ── */
    if (tag === 'A' && !inNav && (el.querySelector('svg, i'))) return 'sociallink';

    /* ── Skip text-type elements inside footer ── */
    if (el.closest('footer') && ['H1','H2','H3','H4','H5','H6','P','SPAN'].includes(tag)) return null;

    /* ── Generic content types ── */
    if (['H1','H2','H3','H4','H5','H6'].includes(tag)) return 'heading';
    if (tag === 'P') return 'text';
    if (tag === 'SPAN' && el.textContent.trim().length > 0) return 'text';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A') return 'link';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return 'input';
    if (tag === 'SELECT') return 'select';
    if (tag === 'IMG') return 'image';
    return null;
  }

  function _onSmartClick(e) {
    const el = e.target;

    /* Never intercept editor-owned UI or admin modals */
    if (el.closest('[data-kve-editor]')) return;
    if (el.closest('.kve-overlay, #kve-block-library')) return;
    if (el.closest('nav') || el.closest('footer')) return;
    if (el.closest('[data-kve-field], [data-ck]')) return;
    if (el.closest('.kve-draft-wrap')) return;
    if (el.closest('#modal-overlay, #user-detail-overlay, #create-user-overlay, #guest-info-overlay')) return;
    if (el.closest('.kve-card-bar, .kve-wrap, .kve-add-card-wrap, .kve-empty-placeholder')) return;

    const type = el.dataset.kveSmart || _detectSmartType(el);
    if (!type) return;

    /* Suppress native behavior for interactive elements */
    if (['link','button','input','select','image','navlink','sociallink'].includes(type)) {
      e.preventDefault();
      e.stopPropagation();
    }

    /* Deactivate previous selection if switching elements */
    if (_smartEl && _smartEl !== el) {
      if (_smartEl.contentEditable === 'true') {
        _smartEl.contentEditable = 'false';
        _smartEl.classList.remove('kve-smart-editing');
        toastMsg('✏️ Izmjena unijeta — klikni "Sačuvaj stranicu" da sačuvaš.');
      }
    }

    _smartEl   = el;
    _smartType = type;

    /* Inline editing for text/heading */
    if ((type === 'text' || type === 'heading') && el.contentEditable !== 'true') {
      if (!el.dataset.originalText) el.dataset.originalText = el.innerHTML;
      el.contentEditable = 'true';
      el.classList.add('kve-smart-editing');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    _showSmartToolbar(el, type);
  }

  function _showSmartToolbar(el, type) {
    const tb = document.getElementById('kve-smart-toolbar');
    if (!tb) return;

    const labels = {
      heading: 'Naslov', text: 'Tekst', button: 'Dugme',
      link: 'Link', input: 'Input', select: 'Dropdown', image: 'Slika',
    };

    let btns = `<span class="kve-st-label">✦ ${labels[type] || type}</span><div class="kve-st-sep"></div>`;

    if (type === 'heading' || type === 'text') {
      btns += `
        <button data-kve-action="text-reset">↩ Reset</button>
        <button data-kve-action="text-done">✓ Gotovo</button>
      `;
    }
    if (type === 'button') {
      btns += `
        <button data-kve-action="btn-text">✏️ Tekst</button>
        <button data-kve-action="btn-href">🔗 Link</button>
        <button data-kve-action="btn-style">🎨 Boja & Forma</button>
      `;
    }
    if (type === 'link') {
      btns += `
        <button data-kve-action="link-text">✏️ Tekst</button>
        <button data-kve-action="link-href">🔗 href</button>
      `;
    }
    if (type === 'input') {
      btns += `
        <button data-kve-action="input-placeholder">📝 Placeholder</button>
        <button data-kve-action="input-label">🏷 Label</button>
      `;
    }
    if (type === 'select') {
      btns += `<button data-kve-action="select-options">📋 Opcije</button>`;
    }
    if (type === 'image') {
      btns += `<button data-kve-action="img-media">🖼 Media Editor</button>`;
    }
    if (type === 'navlink') {
      btns += `
        <button data-kve-action="navlink-text">✏️ Tekst</button>
        <button data-kve-action="navlink-href">🔗 href</button>
        <button data-kve-action="navlink-delete" style="color:#f87171">🗑️ Obriši</button>
      `;
    }
    if (type === 'navlist') {
      btns += `<button data-kve-action="navlist-add">＋ Dodaj link</button>`;
    }
    if (type === 'sociallink') {
      btns += `
        <button data-kve-action="social-media">📁 Upload ikone</button>
        <button data-kve-action="social-edit">✏️ href & SVG</button>
      `;
    }

    btns += `<div class="kve-st-sep"></div><button data-kve-action="deselect">✕</button>`;
    tb.innerHTML = btns;

    tb.querySelectorAll('[data-kve-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _handleSmartAction(btn.dataset.kveAction, _smartEl);
      });
    });

    _positionSmartToolbar(el);
    tb.classList.add('kve-st-visible');
  }

  function _positionSmartToolbar(el) {
    const tb = document.getElementById('kve-smart-toolbar');
    if (!tb) return;
    const rect = el.getBoundingClientRect();
    const tbH  = 42;
    let top  = rect.top - tbH - 6;
    let left = rect.left;
    if (top < 56) top = rect.bottom + 6;   // 56px = main editor toolbar
    if (left + 320 > window.innerWidth - 8) left = window.innerWidth - 328;
    if (left < 8) left = 8;
    tb.style.top  = top + 'px';
    tb.style.left = left + 'px';
  }

  function _hideSmartToolbar() {
    document.getElementById('kve-smart-toolbar')?.classList.remove('kve-st-visible');
  }

  function _deactivateSmart() {
    if (_smartEl) {
      if (_smartEl.contentEditable === 'true') {
        _smartEl.contentEditable = 'false';
        _smartEl.classList.remove('kve-smart-editing');
        _smartEl.setAttribute('data-original-text', _smartEl.innerHTML);
      }
      _smartEl   = null;
      _smartType = null;
    }
    _hideSmartToolbar();
  }

  function _handleSmartAction(action, el) {
    if (!el) return;

    switch (action) {
      case 'text-done':
        el.contentEditable = 'false';
        el.classList.remove('kve-smart-editing');
        el.setAttribute('data-original-text', el.innerHTML);
        _hideSmartToolbar();
        toastMsg('✏️ Izmjena unijeta — klikni "Sačuvaj stranicu" da sačuvaš.');
        break;

      case 'text-reset':
        el.innerHTML = el.dataset.originalText || '';
        el.contentEditable = 'false';
        el.classList.remove('kve-smart-editing');
        _hideSmartToolbar();
        toastMsg('↩ Tekst vraćen na original.');
        break;

      case 'btn-text':
      case 'link-text': {
        const m = createModal('✏️ Uredi tekst', `
          <label>Tekst</label>
          <input type="text" id="kve-st-text-inp" value="${esc(el.textContent.trim())}"/>
        `);
        m.ok.addEventListener('click', () => {
          const v = m.overlay.querySelector('#kve-st-text-inp').value.trim();
          closeModal(m.overlay);
          if (v) { el.textContent = v; toastMsg('✏️ Tekst izmijenjen.'); }
        });
        setTimeout(() => m.overlay.querySelector('#kve-st-text-inp').select(), 60);
        break;
      }

      case 'btn-href':
      case 'link-href':
        _openHrefModal(el);
        break;

      case 'btn-style':
        _openButtonStyleModal(el);
        break;

      case 'input-placeholder':
        _openPlaceholderModal(el);
        break;

      case 'input-label':
        _openLabelModal(el);
        break;

      case 'select-options':
        _openDropdownManager(el);
        break;

      case 'img-src':
        _openSrcModal(el);
        break;

      case 'img-media':
        _openMediaEditorModal(el);
        break;

      case 'img-alt': {
        const m = createModal('📝 Alt tekst slike', `
          <label>Alt tekst</label>
          <input type="text" id="kve-st-alt-inp" value="${esc(el.alt || '')}"/>
        `);
        m.ok.addEventListener('click', () => {
          el.alt = m.overlay.querySelector('#kve-st-alt-inp').value;
          closeModal(m.overlay);
          toastMsg('📝 Alt tekst izmijenjen.');
        });
        setTimeout(() => m.overlay.querySelector('#kve-st-alt-inp').focus(), 60);
        break;
      }

      case 'navlink-text': {
        const aEl = el.tagName === 'A' ? el : el.querySelector('a');
        const target = aEl || el;
        const m = createModal('✏️ Uredi nav link', `
          <label>Tekst</label>
          <input type="text" id="kve-nl-text" value="${esc(target.textContent.trim())}"/>
        `);
        m.ok.addEventListener('click', () => {
          const v = m.overlay.querySelector('#kve-nl-text').value.trim();
          closeModal(m.overlay);
          if (v) { target.textContent = v; toastMsg('✏️ Nav link izmijenjen.'); }
        });
        setTimeout(() => m.overlay.querySelector('#kve-nl-text').select(), 60);
        break;
      }

      case 'navlink-href': {
        const aEl = el.tagName === 'A' ? el : el.querySelector('a');
        if (aEl) _openHrefModal(aEl);
        break;
      }

      case 'navlink-delete': {
        const li = el.closest('li') || el;
        if (!confirm('Obrisati ovaj nav link?')) break;
        li.style.transition = 'opacity .25s, transform .25s';
        li.style.opacity    = '0';
        li.style.transform  = 'scale(.9)';
        setTimeout(() => li.remove(), 260);
        _deactivateSmart();
        toastMsg('🗑️ Nav link obrisan — klikni "Sačuvaj stranicu" za čuvanje.');
        break;
      }

      case 'navlist-add':
        _openAddNavItemModal(el);
        break;

      case 'social-media':
        openHybridMediaModal(el, { isIcon: true });
        break;

      case 'social-edit':
        _openSocialLinkModal(el);
        break;

      case 'deselect':
        _deactivateSmart();
        break;
    }
  }

  /* ── Smart Engine Modals ── */

  function _openHrefModal(el) {
    const curHref   = el.getAttribute('href') || '';
    const curTarget = el.getAttribute('target') || '_self';
    const m = createModal('🔗 Uredi link', `
      <label>URL (href)</label>
      <input type="url" id="kve-href-inp" placeholder="https://…" value="${esc(curHref)}"/>
      <label style="margin-top:14px">Otvori u</label>
      <select id="kve-href-target">
        <option value="_self"  ${curTarget === '_self'  ? 'selected' : ''}>Isti tab</option>
        <option value="_blank" ${curTarget === '_blank' ? 'selected' : ''}>Novi tab</option>
      </select>
    `);
    m.ok.addEventListener('click', () => {
      const href   = m.overlay.querySelector('#kve-href-inp').value.trim();
      const target = m.overlay.querySelector('#kve-href-target').value;
      closeModal(m.overlay);
      if (href) el.setAttribute('href', href);
      el.setAttribute('target', target);
      toastMsg('🔗 Link izmijenjen.');
    });
    setTimeout(() => m.overlay.querySelector('#kve-href-inp').select(), 60);
  }

  function _openPlaceholderModal(el) {
    let labelEl = null;
    if (el.id) {
      try { labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); } catch { /* noop */ }
    }
    if (!labelEl) labelEl = el.closest('label') || el.parentElement?.querySelector('label');

    const m = createModal('📝 Uredi input', `
      <label>Placeholder tekst</label>
      <input type="text" id="kve-ph-inp" value="${esc(el.placeholder || '')}" placeholder="npr. Vaše ime"/>
      ${labelEl ? `
        <label style="margin-top:14px">Label tekst</label>
        <input type="text" id="kve-lbl-inp" value="${esc(labelEl.textContent.trim())}"/>
      ` : ''}
    `);
    m.ok.addEventListener('click', () => {
      const ph = m.overlay.querySelector('#kve-ph-inp').value;
      const lblInp = m.overlay.querySelector('#kve-lbl-inp');
      closeModal(m.overlay);
      el.placeholder = ph;
      el.setAttribute('placeholder', ph);
      if (lblInp && labelEl) labelEl.textContent = lblInp.value;
      toastMsg('📝 Input izmijenjen.');
    });
    setTimeout(() => m.overlay.querySelector('#kve-ph-inp').select(), 60);
  }

  function _openLabelModal(el) {
    let labelEl = null;
    if (el.id) {
      try { labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); } catch { /* noop */ }
    }
    if (!labelEl) labelEl = el.closest('label') || el.parentElement?.querySelector('label');
    if (!labelEl) { toastMsg('Label nije pronađen.', true); return; }

    const m = createModal('🏷 Uredi label', `
      <label>Label tekst</label>
      <input type="text" id="kve-lbl2-inp" value="${esc(labelEl.textContent.trim())}"/>
    `);
    m.ok.addEventListener('click', () => {
      const v = m.overlay.querySelector('#kve-lbl2-inp').value;
      closeModal(m.overlay);
      labelEl.textContent = v;
      toastMsg('🏷 Label izmijenjen.');
    });
    setTimeout(() => m.overlay.querySelector('#kve-lbl2-inp').select(), 60);
  }

  function _openDropdownManager(el) {
    const options = Array.from(el.options).map(o => ({ text: o.text, value: o.value, selected: o.selected }));

    const renderList = () => options.map((o, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:7px">
        <input type="text" class="kve-dm-opt" data-idx="${i}" value="${esc(o.text)}"
               style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
                      border-radius:7px;padding:7px 10px;font-size:12px;color:#e2e2f0;
                      font-family:Inter,sans-serif"/>
        <button class="kve-dm-del" data-idx="${i}"
                style="width:28px;height:28px;background:#ef4444;border:none;border-radius:7px;
                       color:#fff;cursor:pointer;font-size:13px;flex-shrink:0">✕</button>
      </div>
    `).join('');

    const m = createModal('📋 Dropdown opcije', `
      <div id="kve-dm-list">${renderList()}</div>
      <button id="kve-dm-add"
              style="width:100%;margin-top:8px;padding:8px;
                     background:rgba(29,106,255,.15);border:1px dashed rgba(29,106,255,.5);
                     border-radius:7px;color:#1D6AFF;font-size:12px;font-weight:700;
                     cursor:pointer;font-family:Inter,sans-serif">
        + Dodaj opciju
      </button>
    `);

    const wireDelBtns = () => {
      m.overlay.querySelectorAll('.kve-dm-del').forEach(btn => {
        btn.addEventListener('click', () => {
          options.splice(parseInt(btn.dataset.idx), 1);
          m.overlay.querySelector('#kve-dm-list').innerHTML = renderList();
          wireDelBtns();
        });
      });
    };
    wireDelBtns();

    m.overlay.querySelector('#kve-dm-add').addEventListener('click', () => {
      /* Read current text values before re-rendering */
      m.overlay.querySelectorAll('.kve-dm-opt').forEach((inp, i) => {
        if (options[i]) options[i].text = inp.value;
      });
      options.push({ text: 'Nova opcija', value: 'nova' });
      m.overlay.querySelector('#kve-dm-list').innerHTML = renderList();
      wireDelBtns();
    });

    m.ok.addEventListener('click', () => {
      m.overlay.querySelectorAll('.kve-dm-opt').forEach((inp, i) => {
        if (options[i]) options[i].text = inp.value;
      });
      el.innerHTML = '';
      options.forEach(o => {
        const opt = document.createElement('option');
        opt.text  = o.text;
        opt.value = o.value || o.text.toLowerCase().replace(/\s+/g, '-');
        if (o.selected) opt.selected = true;
        el.appendChild(opt);
      });
      closeModal(m.overlay);
      toastMsg('📋 Dropdown ažuriran.');
    });
  }

  function _openSrcModal(el) { openHybridMediaModal(el); }

  function _openMediaEditorModal(el) { openHybridMediaModal(el); }

  /* ─────────────────────────────────────────────────────────────────
     HYBRID MEDIA MODAL
     Universal modal: Upload file (PNG/JPG/SVG) OR paste URL.
     Works for <img> tags and icon containers (social links).

     opts = {
       title   : string              — override modal title
       initSrc : string              — initial preview src (used when el is null)
       onApply : (url, alt) => void  — custom apply callback (skips default DOM update)
       isIcon  : bool                — true = icon container mode (no alt field)
     }
  ──────────────────────────────────────────────────────────────────── */
  function openHybridMediaModal(el, opts = {}) {
    const isImg    = el && el.tagName === 'IMG';
    const isIcon   = opts.isIcon || false;
    const showAlt  = isImg && !isIcon;
    const curSrc   = opts.initSrc ?? (el ? (el.getAttribute('src') || '') : '');
    const curAlt   = isImg ? (el.alt || '') : '';
    const title    = opts.title || (isIcon ? '🎨 Uredi ikonu' : '🖼 Media Editor');

    const previewHtml = curSrc
      ? `<img class="kve-hm-preview" src="${esc(curSrc)}" alt="preview"/>`
      : `<div class="kve-hm-preview-empty">Pregled će se pojaviti ovdje</div>`;

    const m = createModal(title, `
      <div class="kve-hm-tabs">
        <button class="kve-hm-tab active" data-tab="upload">📁 Upload fajla</button>
        <button class="kve-hm-tab"        data-tab="url">🔗 URL slike</button>
      </div>

      <div class="kve-hm-panel" id="kve-hm-upload-panel">
        <div class="kve-hm-drop" id="kve-hm-dropzone">
          <div class="kve-hm-drop-icon">📁</div>
          <div class="kve-hm-drop-text">Prevuci fajl ovdje ili klikni za odabir</div>
          <div class="kve-hm-drop-sub">PNG · JPG · SVG &nbsp;·&nbsp; Max 5 MB</div>
          <input type="file" id="kve-hm-file" accept=".png,.jpg,.jpeg,.svg,image/*" style="display:none"/>
        </div>
        <div id="kve-hm-filename" class="kve-hm-filename" style="display:none"></div>
      </div>

      <div class="kve-hm-panel hidden" id="kve-hm-url-panel">
        <label>URL slike</label>
        <input type="url" id="kve-hm-url-inp" placeholder="https://…" value="${esc(curSrc)}"/>
      </div>

      <div class="kve-hm-preview-wrap" id="kve-hm-pw">${previewHtml}</div>

      ${showAlt ? `
        <label style="margin-top:10px">Alt tekst (SEO)</label>
        <input type="text" id="kve-hm-alt" placeholder="Opis slike" value="${esc(curAlt)}"/>
      ` : ''}

      <!-- Transformation tools -->
      <div class="kve-hm-transform">
        <div class="kve-tf-group">
          <label>Širina (px / %)</label>
          <input type="number" id="kve-hm-width" placeholder="auto" min="1"
                 value="${el && el.style.width ? parseInt(el.style.width) || '' : ''}"/>
        </div>
        <div class="kve-tf-group">
          <label>Visina (px / %)</label>
          <input type="number" id="kve-hm-height" placeholder="auto" min="1"
                 value="${el && el.style.height ? parseInt(el.style.height) || '' : ''}"/>
        </div>
      </div>

      <!-- Global sync option -->
      <label class="kve-hm-sync-row" id="kve-hm-sync-row">
        <input type="checkbox" id="kve-hm-sync-chk"/>
        <span>🔄 Primijeni na sve slične elemente (isti tag + klase)</span>
      </label>
    `);

    let activeTab    = 'upload';
    let selectedFile = null;

    /* ── Tab switching ── */
    m.overlay.querySelectorAll('.kve-hm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        m.overlay.querySelectorAll('.kve-hm-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.tab;
        m.overlay.querySelector('#kve-hm-upload-panel').classList.toggle('hidden', activeTab !== 'upload');
        m.overlay.querySelector('#kve-hm-url-panel').classList.toggle('hidden', activeTab !== 'url');
        if (activeTab === 'url') setTimeout(() => m.overlay.querySelector('#kve-hm-url-inp')?.select(), 40);
      });
    });

    /* ── Dropzone ── */
    const dropzone = m.overlay.querySelector('#kve-hm-dropzone');
    const fileInp  = m.overlay.querySelector('#kve-hm-file');

    dropzone.addEventListener('click', () => fileInp.click());
    dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('kve-drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('kve-drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('kve-drag-over');
      const f = e.dataTransfer.files[0];
      if (f) _hmHandleFile(f, m.overlay);
    });
    fileInp.addEventListener('change', () => {
      if (fileInp.files[0]) _hmHandleFile(fileInp.files[0], m.overlay);
    });

    /* ── Live URL preview ── */
    const urlInp = m.overlay.querySelector('#kve-hm-url-inp');
    urlInp.addEventListener('input', () => _hmUpdatePreview(m.overlay, urlInp.value.trim()));

    function _hmHandleFile(file, overlay) {
      selectedFile = file;
      const nameEl = overlay.querySelector('#kve-hm-filename');
      nameEl.textContent = `✓ ${file.name}`;
      nameEl.style.display = 'block';
      _hmUpdatePreview(overlay, URL.createObjectURL(file));
    }

    function _hmUpdatePreview(overlay, src) {
      const wrap = overlay.querySelector('#kve-hm-pw');
      if (!wrap) return;
      wrap.innerHTML = src
        ? `<img class="kve-hm-preview" src="${esc(src)}" alt="preview"/>`
        : `<div class="kve-hm-preview-empty">Pregled će se pojaviti ovdje</div>`;
    }

    /* ── OK / Apply ── */
    m.ok.addEventListener('click', async () => {
      const altText  = m.overlay.querySelector('#kve-hm-alt')?.value || '';
      const wVal     = parseInt(m.overlay.querySelector('#kve-hm-width')?.value)  || 0;
      const hVal     = parseInt(m.overlay.querySelector('#kve-hm-height')?.value) || 0;
      const doSync   = m.overlay.querySelector('#kve-hm-sync-chk')?.checked || false;
      const dims     = { w: wVal, h: hVal };

      if (activeTab === 'upload') {
        if (!selectedFile) { toastMsg('Odaberi fajl ili prebaci na URL tab.', true); return; }
        m.ok.textContent = '⏳ Upload…';
        m.ok.disabled    = true;
        try {
          const fd = new FormData();
          fd.append('file', selectedFile);
          const res = await fetch(`${API}/admin/upload-asset`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}` },
            body:    fd,
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Upload greška');
          const { url } = await res.json();
          closeModal(m.overlay);
          _hmApply(el, url, altText, isIcon, isImg, opts.onApply, dims, doSync);
        } catch (err) {
          m.ok.textContent = 'Sačuvaj';
          m.ok.disabled    = false;
          toastMsg(`✗ ${err.message}`, true);
        }
      } else {
        const url = urlInp.value.trim();
        closeModal(m.overlay);
        if (url) _hmApply(el, url, altText, isIcon, isImg, opts.onApply, dims, doSync);
      }
    });
  }

  /**
   * Apply media to element(s).
   * dims = { w: number, h: number }  — 0 = skip
   * doSync = bool — if true, find all elements with same tag+classes and apply
   */
  function _hmApply(el, url, altText, isIcon, isImg, customOnApply, dims = {}, doSync = false) {
    if (typeof customOnApply === 'function') {
      customOnApply(url, altText);
      return;
    }

    function _applyToOne(target) {
      if (isIcon && target) {
        target.querySelectorAll('svg, i, img').forEach(c => c.remove());
        const img      = document.createElement('img');
        img.src        = url;
        img.alt        = altText || 'icon';
        img.style.cssText = `object-fit:contain;vertical-align:middle;${dims.w ? `width:${dims.w}px;` : 'width:1.4em;'}${dims.h ? `height:${dims.h}px;` : 'height:1.4em;'}`;
        target.prepend(img);
      } else if (isImg && target) {
        target.src = url;
        target.setAttribute('src', url);
        if (altText !== undefined) target.alt = altText;
        if (dims.w) target.style.width  = dims.w + 'px';
        if (dims.h) target.style.height = dims.h + 'px';
      }
    }

    _applyToOne(el);

    if (doSync && el) {
      const tag      = el.tagName.toLowerCase();
      const classes  = Array.from(el.classList).join('.');
      const selector = classes ? `${tag}.${classes}` : tag;
      let count = 0;
      try {
        document.querySelectorAll(selector).forEach(similar => {
          if (similar !== el) { _applyToOne(similar); count++; }
        });
      } catch {}
      toastMsg(`${isIcon ? '🎨 Ikona' : '🖼 Slika'} izmijenjena na ${1 + count} element${count ? 'a' : 'u'} — klikni "Sačuvaj stranicu".`);
    } else {
      toastMsg(`${isIcon ? '🎨 Ikona' : '🖼 Slika'} izmijenjena — klikni "Sačuvaj stranicu".`);
    }
  }

  /* ── Button style modal: Tailwind colour swatches + border-radius shape ── */
  function _openButtonStyleModal(el) {
    const BG_COLORS = [
      { cls: 'bg-[#1D6AFF]',  hex: '#1D6AFF', label: 'Brand plava'  },
      { cls: 'bg-blue-600',   hex: '#2563eb', label: 'Plava'        },
      { cls: 'bg-indigo-600', hex: '#4f46e5', label: 'Indigo'       },
      { cls: 'bg-purple-600', hex: '#9333ea', label: 'Ljubičasta'   },
      { cls: 'bg-green-600',  hex: '#16a34a', label: 'Zelena'       },
      { cls: 'bg-emerald-500',hex: '#10b981', label: 'Emerald'      },
      { cls: 'bg-red-500',    hex: '#ef4444', label: 'Crvena'       },
      { cls: 'bg-orange-500', hex: '#f97316', label: 'Narandžasta'  },
      { cls: 'bg-yellow-400', hex: '#facc15', label: 'Žuta'         },
      { cls: 'bg-gray-800',   hex: '#1f2937', label: 'Tamno siva'   },
      { cls: 'bg-gray-100',   hex: '#f3f4f6', label: 'Svijetla'     },
      { cls: 'bg-white',      hex: '#ffffff', label: 'Bijela'       },
    ];
    const SHAPES = [
      { cls: 'rounded-none', label: '▬ Kvadratno'      },
      { cls: 'rounded-md',   label: '▢ Blago zaobljeno'},
      { cls: 'rounded-xl',   label: '▣ Zaobljeno'      },
      { cls: 'rounded-2xl',  label: '▤ Više zaobljeno' },
      { cls: 'rounded-full', label: '⬭ Pill'           },
    ];
    const elCls = Array.from(el.classList);
    const curBgCls    = elCls.find(c => c.startsWith('bg-')) || '';
    const curShapeCls = elCls.find(c => c.startsWith('rounded')) || 'rounded-xl';

    const swatchHTML = BG_COLORS.map(c => `
      <div class="kve-btn-swatch ${curBgCls === c.cls ? 'active' : ''}"
           data-bg="${esc(c.cls)}" title="${esc(c.label)}"
           style="background:${c.hex};${c.hex === '#ffffff' ? 'border-color:rgba(255,255,255,0.3);' : ''}">
      </div>
    `).join('');

    const shapeOpts = SHAPES.map(s =>
      `<option value="${esc(s.cls)}" ${curShapeCls === s.cls ? 'selected' : ''}>${esc(s.label)}</option>`
    ).join('');

    const m = createModal('🎨 Stil dugmeta', `
      <label>Boja pozadine</label>
      <div class="kve-btn-swatch-row" id="kve-bsw-row">${swatchHTML}</div>
      <input type="hidden" id="kve-bsw-val" value="${esc(curBgCls)}"/>
      <label style="margin-top:16px">Oblik (border radius)</label>
      <select id="kve-bsh-sel">${shapeOpts}</select>
      <label style="margin-top:14px">Prilagođena inline boja (opciono)</label>
      <input type="color" id="kve-bsw-custom" value="${esc(el.style.backgroundColor || '#1D6AFF')}"/>
    `);

    m.overlay.querySelectorAll('.kve-btn-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        m.overlay.querySelectorAll('.kve-btn-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        m.overlay.querySelector('#kve-bsw-val').value = sw.dataset.bg;
        m.overlay.querySelector('#kve-bsw-custom').value = '#1D6AFF'; // reset custom
      });
    });

    m.ok.addEventListener('click', () => {
      const newBgCls = m.overlay.querySelector('#kve-bsw-val').value;
      const newShape = m.overlay.querySelector('#kve-bsh-sel').value;
      const customClr = m.overlay.querySelector('#kve-bsw-custom').value;
      closeModal(m.overlay);

      // Remove old bg-* classes and apply new Tailwind class
      Array.from(el.classList).filter(c => c.startsWith('bg-')).forEach(c => el.classList.remove(c));
      if (newBgCls) newBgCls.split(/\s+/).forEach(c => c && el.classList.add(c));
      else if (customClr) el.style.backgroundColor = customClr;

      // Remove old rounded-* and apply shape
      Array.from(el.classList).filter(c => c.startsWith('rounded')).forEach(c => el.classList.remove(c));
      if (newShape) el.classList.add(newShape);

      toastMsg('🎨 Stil dugmeta izmijenjen — klikni "Sačuvaj stranicu".');
    });
  }

  /* ── Add nav item modal ── */
  function _openAddNavItemModal(navEl) {
    // Find the UL within the nav (or use navEl directly if it is the UL)
    const ul = navEl.tagName === 'UL' ? navEl
             : navEl.tagName === 'OL' ? navEl
             : navEl.querySelector('ul, ol') || navEl;

    // Clone classes from an existing <a> in the nav for visual consistency
    const sampleLi = ul.querySelector('li');
    const sampleA  = sampleLi?.querySelector('a');
    const liCls    = sampleLi?.className  || '';
    const aCls     = sampleA?.className   || 'text-sm font-medium transition-colors hover:text-[#1D6AFF]';

    const m = createModal('＋ Dodaj nav link', `
      <label>Tekst linka</label>
      <input type="text" id="kve-nav-txt" placeholder="npr. Kontakt"/>
      <label style="margin-top:14px">URL</label>
      <input type="text" id="kve-nav-url" placeholder="contact.html ili https://…"/>
      <label style="margin-top:14px">Otvori u</label>
      <select id="kve-nav-tgt">
        <option value="_self">Isti tab</option>
        <option value="_blank">Novi tab</option>
      </select>
    `);
    m.ok.addEventListener('click', () => {
      const txt  = m.overlay.querySelector('#kve-nav-txt').value.trim();
      const url  = m.overlay.querySelector('#kve-nav-url').value.trim();
      const tgt  = m.overlay.querySelector('#kve-nav-tgt').value;
      closeModal(m.overlay);
      if (!txt || !url) { toastMsg('Tekst i URL su obavezni.', true); return; }

      const li = document.createElement('li');
      if (liCls) li.className = liCls;
      const a = document.createElement('a');
      a.href        = url;
      a.target      = tgt;
      a.textContent = txt;
      a.className   = aCls;
      a.setAttribute('data-kve-smart', 'navlink');
      li.setAttribute('data-kve-smart', 'navlink');
      li.appendChild(a);
      ul.appendChild(li);

      // Animate in
      li.style.opacity   = '0';
      li.style.transform = 'translateX(8px)';
      li.style.transition = 'opacity .25s, transform .25s';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        li.style.opacity   = '1';
        li.style.transform = 'none';
      }));

      toastMsg(`＋ Nav link "${txt}" dodan — klikni "Sačuvaj stranicu".`);
    });
    setTimeout(() => m.overlay.querySelector('#kve-nav-txt').focus(), 60);
  }

  /* ── Social link editor (href + SVG/icon replacement) ── */
  function _openSocialLinkModal(el) {
    const curHref = el.getAttribute('href') || '';
    const curIcon = el.querySelector('svg')?.outerHTML || el.querySelector('i')?.outerHTML || '';

    const m = createModal('🔗 Uredi social link', `
      <label>URL (href)</label>
      <input type="url" id="kve-soc-href" value="${esc(curHref)}" placeholder="https://instagram.com/…"/>
      <label style="margin-top:14px">Otvori u</label>
      <select id="kve-soc-tgt">
        <option value="_blank" ${(el.target||'_blank') === '_blank' ? 'selected' : ''}>Novi tab</option>
        <option value="_self"  ${el.target === '_self'             ? 'selected' : ''}>Isti tab</option>
      </select>
      <label style="margin-top:14px">SVG / Icon kod <span style="color:#5050a0;font-weight:400">(opciono — zalijepite novi SVG)</span></label>
      <textarea id="kve-soc-svg" rows="5" placeholder="&lt;svg …&gt;…&lt;/svg&gt;">${esc(curIcon)}</textarea>
    `);
    m.ok.addEventListener('click', () => {
      const href    = m.overlay.querySelector('#kve-soc-href').value.trim();
      const tgt     = m.overlay.querySelector('#kve-soc-tgt').value;
      const svgCode = m.overlay.querySelector('#kve-soc-svg').value.trim();
      closeModal(m.overlay);

      if (href) el.setAttribute('href', href);
      el.setAttribute('target', tgt);

      if (svgCode) {
        const existing = el.querySelector('svg, i');
        if (existing) existing.remove();
        const tmp = document.createElement('div');
        tmp.innerHTML = svgCode;
        const newIcon = tmp.firstElementChild;
        if (newIcon) el.prepend(newIcon);
      }
      toastMsg('🔗 Social link izmijenjen — klikni "Sačuvaj stranicu".');
    });
    setTimeout(() => m.overlay.querySelector('#kve-soc-href').select(), 60);
  }

  /* ─────────────────────────────────────────────────────────────────
     18. SECTION HOVER CONTROLS  (NEW)
     Injects a floating toolbar into every section/header/article.
     Buttons: Move Up ▲ | Move Down ▼ | ⚙️ Stil | 🗑️ Obriši
  ──────────────────────────────────────────────────────────────────── */
  function initSectionHoverControls() {
    document.querySelectorAll('section, header, article').forEach(sec => {
      if (sec.closest('[data-kve-editor]')) return;
      _wireSectionToolbar(sec);
    });
  }

  function _wireSectionToolbar(sec) {
    if (sec.querySelector(':scope > .kve-section-bar')) return; // guard double-init

    // Ensure relative positioning so the absolute toolbar stays inside
    if (window.getComputedStyle(sec).position === 'static') sec.style.position = 'relative';

    const isHeader = sec.tagName === 'HEADER';

    const bar = document.createElement('div');
    bar.className = 'kve-section-bar';
    bar.setAttribute('data-kve-editor', '1');
    bar.innerHTML = `
      ${isHeader ? `<button class="kve-sec-header-edit" title="Uredi header (visina, pozadina, blur)">📐 Header</button>` : ''}
      <button class="kve-sec-move-up"   title="Pomjeri sekciju gore">▲ Gore</button>
      <button class="kve-sec-move-down" title="Pomjeri sekciju dolje">▼ Dolje</button>
      <button class="kve-sec-style"     title="Uredi pozadinu / stil">⚙️ Stil</button>
      ${!isHeader ? `<button class="kve-sec-delete" title="Obriši sekciju">🗑️ Obriši</button>` : ''}
    `;
    sec.appendChild(bar);

    bar.querySelector('.kve-sec-delete')?.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Obrisati ovu sekciju? Ova radnja se ne može poništiti bez ponovnog učitavanja.')) return;
      sec.style.transition = 'opacity .3s, transform .3s';
      sec.style.opacity    = '0';
      sec.style.transform  = 'scale(.98)';
      setTimeout(() => sec.remove(), 320);
      toastMsg('🗑️ Sekcija obrisana — klikni "Sačuvaj stranicu" za trajno čuvanje.');
    });

    bar.querySelector('.kve-sec-style').addEventListener('click', e => {
      e.stopPropagation();
      openSectionStyleModal(sec);
    });

    bar.querySelector('.kve-sec-header-edit')?.addEventListener('click', e => {
      e.stopPropagation();
      openHeaderEditModal(sec);
    });

    bar.querySelector('.kve-sec-move-up').addEventListener('click', e => {
      e.stopPropagation();
      const prev = sec.previousElementSibling;
      if (prev && !prev.hasAttribute('data-kve-editor') && prev.id !== 'kve-toolbar') {
        sec.parentNode.insertBefore(sec, prev);
        toastMsg('▲ Sekcija pomjerena gore');
      }
    });

    bar.querySelector('.kve-sec-move-down').addEventListener('click', e => {
      e.stopPropagation();
      const next = sec.nextElementSibling;
      if (next && !next.hasAttribute('data-kve-editor') && next.id !== 'kve-add-section-btn') {
        sec.parentNode.insertBefore(next, sec);
        toastMsg('▼ Sekcija pomjerena dolje');
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     HEADER EDIT MODAL
     Professional controls for the site <header>:
     height presets, background style, blur toggle, sticky toggle.
  ──────────────────────────────────────────────────────────────────── */
  function openHeaderEditModal(headerEl) {
    /* Find the inner flex row that controls height */
    const innerRow = headerEl.querySelector('.flex.items-center.justify-between');

    /* Detect current height class */
    const HEIGHTS = ['h-14','h-16','h-18','h-20','h-24'];
    const curH = HEIGHTS.find(h => innerRow?.classList.contains(h)) || 'h-20';

    /* Detect current background style */
    const hasDarkBg  = headerEl.style.background?.includes('rgba(6') ||
                       headerEl.style.background?.includes('rgba(8') ||
                       headerEl.classList.contains('bg-gray-900');
    const hasGlass   = headerEl.style.background?.includes('0.6') ||
                       headerEl.style.background?.includes('0.5');
    const isTrans    = headerEl.style.background === 'transparent' ||
                       headerEl.classList.contains('bg-transparent');
    const curBg      = hasDarkBg ? 'dark' : hasGlass ? 'glass' : isTrans ? 'transparent' : 'white';
    const hasBlur    = headerEl.classList.contains('navbar-blur');
    const isSticky   = headerEl.classList.contains('sticky');

    const hTabsHtml = [
      { h: 'h-14', label: 'Kompaktno', px: '56px' },
      { h: 'h-16', label: 'Normalno',  px: '64px' },
      { h: 'h-20', label: 'Prostrano', px: '80px' },
      { h: 'h-24', label: 'Veliko',    px: '96px' },
    ].map(o => `
      <button class="kve-hm-tab ${curH === o.h ? 'active' : ''}" data-hh="${o.h}">
        ${o.label}<br/><span style="font-size:9px;opacity:.65;font-weight:400">${o.px}</span>
      </button>`).join('');

    const bgTabsHtml = [
      { id: 'white',       label: '⬜ Bijela'    },
      { id: 'glass',       label: '🔲 Glass'     },
      { id: 'dark',        label: '⬛ Tamna'     },
      { id: 'transparent', label: '◻ Providna'  },
    ].map(o => `
      <button class="kve-hm-tab ${curBg === o.id ? 'active' : ''}" data-hbg="${o.id}">
        ${o.label}
      </button>`).join('');

    const m = createModal('📐 Header Editor', `
      <label>Visina navigacije</label>
      <div class="kve-hm-tabs" style="margin-bottom:18px">${hTabsHtml}</div>

      <label>Pozadina</label>
      <div class="kve-hm-tabs" style="margin-bottom:18px">${bgTabsHtml}</div>

      <label>Opcije</label>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12px; color:#c0c0e0; font-weight:400">
          <input type="checkbox" id="kve-hdr-blur"   ${hasBlur  ? 'checked' : ''}/>
          Blur efekt pozadine (glassmorphism)
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12px; color:#c0c0e0; font-weight:400">
          <input type="checkbox" id="kve-hdr-sticky" ${isSticky ? 'checked' : ''}/>
          Sticky (ostaje na vrhu pri skrolovanju)
        </label>
      </div>
    `);

    /* Tab interactions */
    let selH  = curH;
    let selBg = curBg;

    m.overlay.querySelectorAll('[data-hh]').forEach(btn => {
      btn.addEventListener('click', () => {
        m.overlay.querySelectorAll('[data-hh]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selH = btn.dataset.hh;
      });
    });

    m.overlay.querySelectorAll('[data-hbg]').forEach(btn => {
      btn.addEventListener('click', () => {
        m.overlay.querySelectorAll('[data-hbg]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selBg = btn.dataset.hbg;
      });
    });

    m.ok.addEventListener('click', () => {
      const doBlur   = m.overlay.querySelector('#kve-hdr-blur')?.checked;
      const doSticky = m.overlay.querySelector('#kve-hdr-sticky')?.checked;
      closeModal(m.overlay);

      /* ── Apply height ── */
      if (innerRow) {
        HEIGHTS.forEach(h => innerRow.classList.remove(h));
        innerRow.classList.add(selH);
      }

      /* ── Apply background ── */
      ['bg-white/90','bg-white','bg-transparent','bg-gray-900','navbar-glass-dark'].forEach(c =>
        headerEl.classList.remove(c)
      );
      headerEl.style.background = '';
      if (selBg === 'white') {
        headerEl.classList.add('bg-white/90');
      } else if (selBg === 'glass') {
        headerEl.style.background = 'rgba(255,255,255,0.55)';
      } else if (selBg === 'dark') {
        headerEl.style.background = 'rgba(6,8,22,0.96)';
      } else if (selBg === 'transparent') {
        headerEl.style.background = 'transparent';
      }

      /* ── Blur toggle ── */
      headerEl.classList.toggle('navbar-blur', !!doBlur);

      /* ── Sticky toggle ── */
      if (doSticky) {
        headerEl.classList.add('sticky');
        headerEl.classList.remove('relative');
      } else {
        headerEl.classList.remove('sticky');
        headerEl.classList.add('relative');
      }

      toastMsg('📐 Header izmijenjen — klikni "Sačuvaj stranicu".');
    });
  }

  /* ── Background colour/class presets ── */
  const BG_PRESETS = [
    { label: 'Bijela',          cls: 'bg-white',        hex: '#ffffff'    },
    { label: 'Siva 50',         cls: 'bg-gray-50',      hex: '#f9fafb'    },
    { label: 'Siva 100',        cls: 'bg-gray-100',     hex: '#f3f4f6'    },
    { label: 'Plava 50',        cls: 'bg-blue-50',      hex: '#eff6ff'    },
    { label: 'Brand plava',     cls: 'bg-[#1D6AFF]',    hex: '#1D6AFF'    },
    { label: 'Indigo 600',      cls: 'bg-indigo-600',   hex: '#4f46e5'    },
    { label: 'Ljubičasta',      cls: 'bg-purple-700',   hex: '#7e22ce'    },
    { label: 'Zelena',          cls: 'bg-emerald-500',  hex: '#10b981'    },
    { label: 'Tamna',           cls: 'bg-gray-900',     hex: '#111827'    },
    { label: 'Crna',            cls: 'bg-black',        hex: '#000000'    },
    { label: 'Hero gradient',   cls: 'hero-gradient',   hex: null         },
    { label: 'Bez pozadine',    cls: '',                hex: 'transparent'},
  ];

  function openSectionStyleModal(sec) {
    const currentCls = (sec.dataset.kveBgClass || '').trim();

    const swatchHTML = BG_PRESETS.map(p => `
      <div class="kve-swatch ${currentCls === p.cls ? 'active' : ''}"
           data-cls="${esc(p.cls)}" title="${esc(p.label)}"
           style="background:${p.hex ? p.hex : 'linear-gradient(135deg,#FFF5EC 0%,#EDE9FD 100%)'};">
      </div>
    `).join('');

    const modal = createModal('⚙️ Uredi stil sekcije', `
      <label>Tailwind klasa pozadine (ručno)</label>
      <input type="text" id="kve-bg-cls"
             placeholder="npr. bg-gray-100  ili  bg-[#ff6600]"
             value="${esc(currentCls)}"/>
      <label style="margin-top:14px">Brzi odabir</label>
      <div class="kve-swatch-row">${swatchHTML}</div>
    `);

    const input = modal.overlay.querySelector('#kve-bg-cls');

    modal.overlay.querySelectorAll('.kve-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        modal.overlay.querySelectorAll('.kve-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        input.value = sw.dataset.cls;
      });
    });

    modal.ok.addEventListener('click', () => {
      const newCls = input.value.trim();
      closeModal(modal.overlay);
      _applyBgClass(sec, newCls);
    });

    setTimeout(() => input.focus(), 60);
  }

  function _applyBgClass(sec, newCls) {
    const oldCls = (sec.dataset.kveBgClass || '').trim();
    if (oldCls) oldCls.split(/\s+/).forEach(c => c && sec.classList.remove(c));
    if (newCls) newCls.split(/\s+/).forEach(c => c && sec.classList.add(c));
    sec.dataset.kveBgClass = newCls;
    toastMsg('🎨 Stil primijenjen — klikni "Sačuvaj stranicu" za čuvanje.');
  }

  /* ─────────────────────────────────────────────────────────────────
     19. ADD SECTION BUTTON  (NEW)
  ──────────────────────────────────────────────────────────────────── */
  function injectAddSectionBtn() {
    const btn = document.createElement('button');
    btn.id = 'kve-add-section-btn';
    btn.setAttribute('data-kve-editor', '1');
    btn.innerHTML = `<span style="font-size:22px;display:block;margin-bottom:5px">＋</span>Dodaj novu sekciju`;
    btn.addEventListener('click', openBlockLibrary);

    const main = document.querySelector('main');
    if (main) main.appendChild(btn);
    else document.body.appendChild(btn);
  }

  /* ─────────────────────────────────────────────────────────────────
     20. BLOCK LIBRARY MODAL  (NEW)
  ──────────────────────────────────────────────────────────────────── */
  const BLOCKS = [
    {
      id:   'hero',
      name: 'Hero Sekcija',
      desc: 'Veliki naslov, podnaslov i CTA dugme',
      preview: `
        <div style="text-align:center;padding:6px">
          <div style="height:14px;width:60%;background:linear-gradient(90deg,#1D6AFF,#A259FF);border-radius:4px;margin:0 auto 8px"></div>
          <div style="height:8px;width:40%;background:rgba(255,255,255,.2);border-radius:3px;margin:0 auto 12px"></div>
          <div style="display:inline-block;padding:5px 16px;background:#1D6AFF;border-radius:6px;font-size:10px;color:#fff;font-family:Inter,sans-serif">Početak →</div>
        </div>`,
      html: `
<section class="py-20 px-6 text-center hero-gradient" data-kve-block="hero">
  <div class="max-w-3xl mx-auto">
    <h1 class="font-display text-5xl font-bold text-gray-900 mb-5 leading-tight">Vaš naslov ovdje</h1>
    <p class="text-lg text-gray-600 mb-8 max-w-xl mx-auto leading-relaxed">
      Dodajte podnaslov koji objašnjava vrijednost vaše ponude korisnicima.
    </p>
    <a href="#" class="inline-block bg-[#1D6AFF] text-white font-bold px-8 py-4 rounded-2xl text-base shadow-lg hover:bg-[#1254D4] transition-colors">
      Početak →
    </a>
  </div>
</section>`,
    },
    {
      id:   'text',
      name: 'Tekstualni Blok',
      desc: 'Naslov + jedan ili više paragrafa',
      preview: `
        <div style="padding:6px 14px">
          <div style="height:10px;width:50%;background:rgba(255,255,255,.5);border-radius:3px;margin-bottom:8px"></div>
          <div style="height:6px;width:90%;background:rgba(255,255,255,.2);border-radius:3px;margin-bottom:5px"></div>
          <div style="height:6px;width:80%;background:rgba(255,255,255,.2);border-radius:3px;margin-bottom:5px"></div>
          <div style="height:6px;width:85%;background:rgba(255,255,255,.2);border-radius:3px"></div>
        </div>`,
      html: `
<section class="py-16 px-6 bg-white" data-kve-block="text">
  <div class="max-w-2xl mx-auto">
    <h2 class="font-display text-3xl font-bold text-gray-900 mb-6">Naslov sekcije</h2>
    <p class="text-gray-600 leading-relaxed mb-4">
      Ovdje upišite vaš sadržaj. Ovaj blok je idealan za opisne tekstove, politiku privatnosti ili bilo koji narativni sadržaj.
    </p>
    <p class="text-gray-600 leading-relaxed">
      Drugi paragraf — kliknite na tekst da ga uredite direktno u editoru.
    </p>
  </div>
</section>`,
    },
    {
      id:   'product-grid',
      name: 'Grid Proizvoda',
      desc: 'Mreža za prikaz proizvoda iz baze',
      preview: `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:10px">
          ${[1,2,3].map(() => `<div style="height:42px;background:rgba(29,106,255,.28);border-radius:7px"></div>`).join('')}
        </div>`,
      html: `
<section class="py-16 px-6 bg-gray-50" data-kve-block="product-grid">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-display text-3xl font-bold text-gray-900 mb-2 text-center">Naši Proizvodi</h2>
    <p class="text-gray-500 text-center mb-10">Izaberite iz naše kolekcije premium digitalnih licenci.</p>
    <div id="product-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      <!-- Proizvodi se učitavaju automatski -->
    </div>
  </div>
</section>`,
    },
    {
      id:   'features',
      name: 'Feature Grid',
      desc: 'Tri kolone s ikonama i opisima prednosti',
      preview: `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:10px">
          ${[1,2,3].map(() => `<div style="height:52px;background:rgba(162,89,255,.28);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:20px">✦</div>`).join('')}
        </div>`,
      html: `
<section class="py-16 px-6 bg-gray-50" data-kve-block="features">
  <div class="max-w-5xl mx-auto">
    <h2 class="font-display text-3xl font-bold text-gray-900 mb-12 text-center">Zašto Keyify?</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div class="bg-white rounded-2xl p-7 shadow-sm border border-gray-100 text-center">
        <div class="text-4xl mb-4">⚡</div>
        <h3 class="font-display font-bold text-lg text-gray-900 mb-2">Trenutna isporuka</h3>
        <p class="text-gray-500 text-sm leading-relaxed">Vaša licenca stiže u inbox za manje od minute.</p>
      </div>
      <div class="bg-white rounded-2xl p-7 shadow-sm border border-gray-100 text-center">
        <div class="text-4xl mb-4">🔒</div>
        <h3 class="font-display font-bold text-lg text-gray-900 mb-2">100% Sigurno</h3>
        <p class="text-gray-500 text-sm leading-relaxed">Plaćanje zaštićeno SSL enkripcijom i verifikacijom.</p>
      </div>
      <div class="bg-white rounded-2xl p-7 shadow-sm border border-gray-100 text-center">
        <div class="text-4xl mb-4">💬</div>
        <h3 class="font-display font-bold text-lg text-gray-900 mb-2">Podrška 24/7</h3>
        <p class="text-gray-500 text-sm leading-relaxed">Naš tim je tu za vas u svakom trenutku.</p>
      </div>
    </div>
  </div>
</section>`,
    },
    {
      id:   'contact-form',
      name: 'Kontakt Forma',
      desc: 'Naslov + kompletna forma za slanje poruke',
      preview: `
        <div style="padding:8px 14px">
          <div style="height:16px;background:rgba(255,255,255,.15);border-radius:5px;margin-bottom:7px"></div>
          <div style="height:16px;background:rgba(255,255,255,.15);border-radius:5px;margin-bottom:7px"></div>
          <div style="height:30px;background:rgba(255,255,255,.12);border-radius:5px;margin-bottom:7px"></div>
          <div style="height:22px;background:#1D6AFF;border-radius:5px"></div>
        </div>`,
      html: `
<section class="py-16 px-6 bg-white" data-kve-block="contact-form">
  <div class="max-w-xl mx-auto">
    <h2 class="font-display text-3xl font-bold text-gray-900 mb-3 text-center">Kontaktirajte nas</h2>
    <p class="text-gray-500 text-center mb-10">Imate pitanje? Pošaljite nam poruku i odgovorićemo u roku od 24h.</p>
    <form class="space-y-5" onsubmit="return false">
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Ime i prezime</label>
        <input type="text" placeholder="Vaše ime" class="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1D6AFF] focus:ring-2 focus:ring-blue-100"/>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Email adresa</label>
        <input type="email" placeholder="vasa@email.com" class="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1D6AFF] focus:ring-2 focus:ring-blue-100"/>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Poruka</label>
        <textarea rows="4" placeholder="Vaša poruka…" class="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1D6AFF] focus:ring-2 focus:ring-blue-100 resize-none"></textarea>
      </div>
      <button type="submit" class="w-full bg-[#1D6AFF] text-white font-bold py-3.5 rounded-xl hover:bg-[#1254D4] transition-colors">
        Pošalji poruku →
      </button>
    </form>
  </div>
</section>`,
    },
    {
      id:   'cta-banner',
      name: 'CTA Banner',
      desc: 'Horizontalni poziv na akciju s dugmetom',
      preview: `
        <div style="background:linear-gradient(90deg,#1D6AFF,#A259FF);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-radius:7px">
          <div>
            <div style="height:8px;width:110px;background:rgba(255,255,255,.7);border-radius:3px;margin-bottom:5px"></div>
            <div style="height:6px;width:75px;background:rgba(255,255,255,.4);border-radius:3px"></div>
          </div>
          <div style="width:52px;height:22px;background:#fff;border-radius:5px"></div>
        </div>`,
      html: `
<section class="py-14 px-6 bg-gradient-to-r from-[#1D6AFF] to-purple-600" data-kve-block="cta-banner">
  <div class="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
    <div class="text-center md:text-left">
      <h2 class="font-display text-2xl font-bold text-white mb-1">Spremi za kupovinu?</h2>
      <p class="text-blue-100 text-sm">Hiljade zadovoljnih korisnika već koristi naše licence.</p>
    </div>
    <a href="#" class="shrink-0 bg-white text-[#1D6AFF] font-bold px-8 py-3.5 rounded-xl shadow-lg hover:bg-blue-50 transition-colors whitespace-nowrap">
      Kupuj sada →
    </a>
  </div>
</section>`,
    },
  ];

  function openBlockLibrary() {
    document.getElementById('kve-block-library')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'kve-block-library';
    overlay.setAttribute('data-kve-editor', '1');

    const cards = BLOCKS.map(b => `
      <div class="kve-bl-card" data-block-id="${b.id}" role="button" tabindex="0" title="Dodaj: ${esc(b.name)}">
        <div class="kve-bl-preview">${b.preview}</div>
        <div class="kve-bl-info">
          <div class="kve-bl-name">${esc(b.name)}</div>
          <div class="kve-bl-desc">${esc(b.desc)}</div>
        </div>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="kve-bl-panel">
        <div class="kve-bl-header">
          <h3>📦 Biblioteka Blokova</h3>
          <button class="kve-bl-close" id="kve-bl-close">✕</button>
        </div>
        <p class="kve-bl-subtitle">Klikni blok da ga dodaš. Možeš ga odmah uređivati inline.</p>
        <div class="kve-bl-grid">${cards}</div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#kve-bl-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function blEsc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', blEsc); }
    });

    overlay.querySelectorAll('.kve-bl-card').forEach(card => {
      const inject = () => {
        const block = BLOCKS.find(b => b.id === card.dataset.blockId);
        if (block) { injectBlock(block); overlay.remove(); }
      };
      card.addEventListener('click', inject);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') inject(); });
    });
  }

  function injectBlock(block) {
    const tpl = document.createElement('template');
    tpl.innerHTML = block.html.trim();
    const newSection = tpl.content.firstElementChild;
    if (!newSection) return;

    // Insert before the "+ Add Section" button
    const addBtn = document.getElementById('kve-add-section-btn');
    const main   = document.querySelector('main');

    if (addBtn?.parentNode) {
      addBtn.parentNode.insertBefore(newSection, addBtn);
    } else if (main) {
      main.appendChild(newSection);
    } else {
      document.body.appendChild(newSection);
    }

    // Animate in
    newSection.style.opacity   = '0';
    newSection.style.transform = 'translateY(18px)';
    newSection.style.transition = 'opacity .35s ease, transform .35s ease';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      newSection.style.opacity   = '1';
      newSection.style.transform = 'translateY(0)';
    }));

    // Wire section toolbar
    _wireSectionToolbar(newSection);

    // Mark all eligible elements for the smart engine
    _scanAndMarkElements(newSection);

    setTimeout(() => newSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    toastMsg(`📦 Blok "${block.name}" dodan!`);
  }

  /* ─────────────────────────────────────────────────────────────────
     22. ELEMENT-LEVEL HOVER CONTROLS
     Hovering over any non-editor element shows 🗑️ Delete + ⚙️ Edit
     floating buttons. Right-click opens a Contextual Property Menu
     to edit href, src, or add/remove Tailwind utility classes.
  ──────────────────────────────────────────────────────────────────── */

  (function initElementHoverControls() {
    // Inject styles once
    if (!document.getElementById('kve-elem-style')) {
      const s = document.createElement('style');
      s.id = 'kve-elem-style';
      s.textContent = `
        .kve-elem-wrap   { position:relative; outline:2px dashed transparent; transition:outline-color .12s; }
        .kve-elem-wrap:hover { outline-color:rgba(29,106,255,0.55); }
        .kve-elem-btns   { display:none;position:absolute;top:-14px;right:0;z-index:99999;
                           gap:3px;align-items:center;pointer-events:all; }
        .kve-elem-wrap:hover .kve-elem-btns { display:flex; }
        .kve-elem-btn    { padding:2px 7px;font-size:11px;font-weight:700;border:none;border-radius:5px;
                           cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
                           box-shadow:0 2px 8px rgba(0,0,0,.35);line-height:1.6; }
        .kve-elem-del    { background:rgba(239,68,68,0.88);color:#fff; }
        .kve-elem-del:hover  { background:#ef4444; }
        .kve-elem-edit   { background:rgba(29,106,255,0.88);color:#fff; }
        .kve-elem-edit:hover { background:#1D6AFF; }
        /* Right-click context menu */
        #kve-ctx-menu    { position:fixed;z-index:999999;background:rgba(8,10,24,0.97);
                           border:1px solid rgba(255,255,255,0.1);border-radius:12px;
                           box-shadow:0 20px 50px rgba(0,0,0,.6);padding:5px;min-width:200px;
                           backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
                           animation:kve-ctx-in .14s cubic-bezier(.34,1.56,.64,1); }
        @keyframes kve-ctx-in { from{opacity:0;transform:scale(.94)} to{opacity:1;transform:scale(1)} }
        #kve-ctx-menu .kve-ctx-item { display:flex;align-items:center;gap:9px;padding:8px 12px;
                           font-size:12px;font-weight:600;color:#c0c0e0;border-radius:8px;
                           cursor:pointer;transition:background .12s; }
        #kve-ctx-menu .kve-ctx-item:hover { background:rgba(29,106,255,0.18);color:#fff; }
        #kve-ctx-menu .kve-ctx-sep  { height:1px;background:rgba(255,255,255,0.07);margin:3px 0; }
        #kve-ctx-menu .kve-ctx-label { font-size:9px;font-weight:700;color:#4040a0;text-transform:uppercase;
                           letter-spacing:.08em;padding:6px 12px 2px; }
        /* Sync banner */
        #kve-sync-bar    { position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:999998;
                           background:rgba(8,10,24,0.97);border:1px solid rgba(162,89,255,0.35);
                           border-radius:12px;padding:10px 16px;display:flex;align-items:center;gap:10px;
                           font-size:12px;font-weight:600;color:#c0c0e0;
                           box-shadow:0 8px 30px rgba(162,89,255,0.2);
                           backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px); }
        #kve-sync-bar button { padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;
                           border:none;cursor:pointer;transition:all .15s; }
        #kve-sync-apply  { background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff; }
        #kve-sync-apply:hover { opacity:.85; }
        #kve-sync-dismiss { background:rgba(255,255,255,0.07);color:#9090b8; }
        #kve-sync-dismiss:hover { background:rgba(255,255,255,0.12); }`;
      document.head.appendChild(s);
    }

    // Wrap editable elements on demand (hover)
    const SKIP_TAGS = new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','META','LINK','TITLE','NOSCRIPT']);
    const SKIP_ATTRS = ['data-kve-editor','id'];

    function shouldSkip(el) {
      if (!el || el.nodeType !== 1) return true;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.hasAttribute('data-kve-editor')) return true;
      if (el.closest('[data-kve-editor]')) return true;
      if (el.classList.contains('kve-elem-wrap')) return true;
      // Product cards, add-card box, and empty placeholder have their own controls
      if (el.closest('.kve-wrap, .kve-card-bar, .kve-add-card-wrap, .kve-empty-placeholder')) return true;
      return false;
    }

    // Floating btn overlay attached to hovered element
    let _activeWrap = null;

    document.addEventListener('mouseover', e => {
      const el = e.target;
      if (shouldSkip(el)) return;
      if (el.classList.contains('kve-elem-btns') || el.closest('.kve-elem-btns')) return;
      if (_activeWrap && _activeWrap !== el) {
        _activeWrap.classList.remove('kve-elem-wrap');
        const oldBtns = _activeWrap.querySelector(':scope > .kve-elem-btns');
        if (oldBtns) oldBtns.remove();
      }
      if (!el.querySelector(':scope > .kve-elem-btns')) {
        el.classList.add('kve-elem-wrap');
        const btnWrap = document.createElement('div');
        btnWrap.className = 'kve-elem-btns';
        btnWrap.setAttribute('data-kve-editor', '1');
        btnWrap.innerHTML = `<button class="kve-elem-btn kve-elem-del" title="Obriši element">🗑️</button><button class="kve-elem-btn kve-elem-edit" title="Uredi element">⚙️</button>`;
        el.style.position = el.style.position || (window.getComputedStyle(el).position === 'static' ? 'relative' : '');
        el.appendChild(btnWrap);
        btnWrap.querySelector('.kve-elem-del').addEventListener('click', ev => {
          ev.stopPropagation();
          if (!confirm('Obrisati ovaj element?')) return;
          el.style.transition = 'opacity .25s,transform .25s';
          el.style.opacity = '0'; el.style.transform = 'scale(.95)';
          setTimeout(() => el.remove(), 260);
          toastMsg('🗑️ Element obrisan');
        });
        btnWrap.querySelector('.kve-elem-edit').addEventListener('click', ev => {
          ev.stopPropagation();
          openElementEditModal(el);
        });
      }
      _activeWrap = el;
    }, true);

    // ── Right-click contextual menu ──────────────────────────────
    let _ctxTarget = null;

    document.addEventListener('contextmenu', e => {
      if (shouldSkip(e.target)) return;
      if (e.target.closest('[data-kve-editor]')) return;
      e.preventDefault();
      _ctxTarget = e.target;
      _showCtxMenu(e.clientX, e.clientY, e.target);
    }, true);

    document.addEventListener('click', () => _hideCtxMenu(), true);
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') _hideCtxMenu(); });

    function _hideCtxMenu() {
      document.getElementById('kve-ctx-menu')?.remove();
    }

    function _showCtxMenu(x, y, el) {
      _hideCtxMenu();
      const menu = document.createElement('div');
      menu.id = 'kve-ctx-menu';
      menu.setAttribute('data-kve-editor', '1');

      const hasHref = el.hasAttribute('href') || el.closest('a');
      const hasSrc  = el.hasAttribute('src')  || el.tagName === 'IMG';
      const target  = hasHref ? (el.closest('a') || el) : el;

      const items = [
        { icon:'🎨', label:'Edituraj Tailwind klase', action: () => openClassEditor(el) },
        hasHref ? { icon:'🔗', label:'Promijeni href link', action: () => openAttrEditor(target, 'href') } : null,
        hasSrc  ? { icon:'🖼️', label:'Promijeni src sliku',  action: () => openAttrEditor(el.tagName==='IMG'?el:el.querySelector('img')||el, 'src') } : null,
        { icon:'📋', label:'Kopiraj HTML element', action: () => { navigator.clipboard?.writeText(el.outerHTML); toastMsg('📋 Kopirano!'); } },
        'sep',
        { icon:'🗑️', label:'Obriši element', action: () => {
          if (!confirm('Obrisati?')) return;
          el.style.transition='opacity .25s'; el.style.opacity='0';
          setTimeout(() => el.remove(), 260); toastMsg('🗑️ Obrisano');
        }, danger: true },
      ].filter(Boolean);

      menu.innerHTML = `<div class="kve-ctx-label">${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}</div>`;
      items.forEach(item => {
        if (item === 'sep') { menu.innerHTML += '<div class="kve-ctx-sep"></div>'; return; }
        const div = document.createElement('div');
        div.className = 'kve-ctx-item';
        if (item.danger) div.style.color = '#f87171';
        div.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
        div.addEventListener('click', e => { e.stopPropagation(); _hideCtxMenu(); item.action(); });
        menu.appendChild(div);
      });

      document.body.appendChild(menu);
      // Clamp to viewport
      const rect = menu.getBoundingClientRect();
      if (x + rect.width  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 8) + 'px'; else menu.style.left = x + 'px';
      if (y + rect.height > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 8) + 'px'; else menu.style.top  = y + 'px';
    }

    // ── Tailwind class editor ──
    function openClassEditor(el) {
      const modal = createModal('🎨 Tailwind klase', `
        <label>Trenutne klase (uredi direktno)</label>
        <textarea id="kve-cls-input" rows="4" style="font-family:monospace;font-size:12px">${esc(el.className)}</textarea>
        <label style="margin-top:10px">Dodaj klase</label>
        <input type="text" id="kve-cls-add" placeholder="npr. rounded-xl shadow-lg text-blue-500"/>
        <div id="kve-sync-cls-notice" style="margin-top:10px;font-size:11px;color:#9090b8;display:none">
          💡 <strong style="color:#c084fc">Sync tip:</strong> Ova izmjena može se primijeniti na sve <code>&lt;${el.tagName.toLowerCase()}&gt;</code> elemente.
        </div>`);

      const txtarea = modal.overlay.querySelector('#kve-cls-input');
      const addInp  = modal.overlay.querySelector('#kve-cls-add');
      const notice  = modal.overlay.querySelector('#kve-sync-cls-notice');

      txtarea.addEventListener('input', () => notice.style.display = 'block');

      modal.ok.addEventListener('click', () => {
        const combined = ((txtarea.value || '') + ' ' + (addInp.value || '')).trim().replace(/\s+/g,' ');
        closeModal(modal.overlay);
        el.className = combined;
        toastMsg('✓ Klase ažurirane');
        _offerSync(el, combined);
      });
    }

    // ── href / src editor ──
    function openAttrEditor(el, attr) {
      if (!el) return;
      const modal = createModal(`🔗 Uredi ${attr}`, `
        <label>Trenutna vrijednost</label>
        <input type="text" id="kve-attr-val" value="${esc(el.getAttribute(attr)||'')}" placeholder="${attr==='href'?'https://...':'https://images.../slika.jpg'}"/>`);
      modal.ok.addEventListener('click', () => {
        const v = modal.overlay.querySelector('#kve-attr-val').value.trim();
        closeModal(modal.overlay);
        if (v) el.setAttribute(attr, v);
        else el.removeAttribute(attr);
        toastMsg(`✓ ${attr} ažuriran`);
      });
    }

    // ── Element edit modal (full) ──
    function openElementEditModal(el) {
      const modal = createModal(`⚙️ Uredi &lt;${el.tagName.toLowerCase()}&gt;`, `
        <label>Tekst / Sadržaj</label>
        <textarea id="kve-el-text" rows="3">${esc(el.innerText||'')}</textarea>
        <label style="margin-top:10px">CSS klase</label>
        <input type="text" id="kve-el-cls" value="${esc(el.className)}"/>
        ${el.hasAttribute('href') ? `<label style="margin-top:10px">href link</label><input type="text" id="kve-el-href" value="${esc(el.getAttribute('href')||'')}"/>` : ''}
        ${el.tagName === 'IMG' ? `<label style="margin-top:10px">src (URL slika)</label><input type="text" id="kve-el-src" value="${esc(el.getAttribute('src')||'')}"/>` : ''}`);

      modal.ok.addEventListener('click', () => {
        const txt  = modal.overlay.querySelector('#kve-el-text')?.value;
        const cls  = modal.overlay.querySelector('#kve-el-cls')?.value;
        const href = modal.overlay.querySelector('#kve-el-href')?.value;
        const src  = modal.overlay.querySelector('#kve-el-src')?.value;
        closeModal(modal.overlay);
        if (txt  !== undefined && el.tagName !== 'IMG') el.innerText = txt;
        if (cls  !== undefined) el.className = cls;
        if (href !== undefined) el.setAttribute('href', href);
        if (src  !== undefined) el.setAttribute('src', src);
        toastMsg('✓ Element ažuriran');
        _offerSync(el, cls);
      });
    }

    // ── "Sync all similar elements" banner ──
    function _offerSync(el, newClasses) {
      document.getElementById('kve-sync-bar')?.remove();
      const tag      = el.tagName;
      const similar  = [...document.querySelectorAll(tag)].filter(x => x !== el && !x.closest('[data-kve-editor]'));
      if (!similar.length) return;

      const bar = document.createElement('div');
      bar.id = 'kve-sync-bar';
      bar.setAttribute('data-kve-editor', '1');
      bar.innerHTML = `
        <span>🔄 Sinkronizovati klase na svih <strong>${similar.length}</strong> &lt;${tag.toLowerCase()}&gt; elemenata?</span>
        <button id="kve-sync-apply">✓ Primijeni</button>
        <button id="kve-sync-dismiss">Zanemari</button>`;
      document.body.appendChild(bar);

      bar.querySelector('#kve-sync-apply').addEventListener('click', () => {
        similar.forEach(s => { s.className = newClasses; });
        bar.remove();
        toastMsg(`✓ Klase sinkronizovane na ${similar.length} elemenata!`);
      });
      bar.querySelector('#kve-sync-dismiss').addEventListener('click', () => bar.remove());
      setTimeout(() => { bar?.remove(); }, 9000);
    }
  })();

  /* ─────────────────────────────────────────────────────────────────
     21. TOAST
  ──────────────────────────────────────────────────────────────────── */
  function toastMsg(text, isError = false) {
    document.getElementById('kve-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'kve-toast';
    t.setAttribute('data-kve-editor', '1');
    t.textContent = text;
    t.style.background = isError ? '#ef4444' : '#22c55e';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 2800);
  }

})();
