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
    initGlobalTextEditing();    // NEW: h1/h2/h3/p contenteditable on click
    initSectionHoverControls(); // NEW: floating toolbar on section/header/article hover
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
      .kve-wrap { position: relative; }
      .kve-wrap:hover > .product-card {
        box-shadow: 0 0 0 2px #1D6AFF, 0 8px 32px rgba(29,106,255,0.2) !important;
      }
      .kve-wrap[draggable="true"] { cursor: grab; }
      .kve-wrap[draggable="true"]:active { cursor: grabbing; }
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
        display: flex; gap: 4px; opacity: 0; pointer-events: none;
        transition: opacity .18s;
      }
      .kve-wrap:hover .kve-card-bar { opacity: 1; pointer-events: auto; }
      .kve-card-bar button {
        width: 30px; height: 30px; border-radius: 9px; border: none;
        font-size: 14px; cursor: pointer; display: flex; align-items: center;
        justify-content: center; transition: transform .15s, box-shadow .15s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      }
      .kve-card-bar button:hover { transform: scale(1.15); }
      .kve-btn-img   { background: #1D6AFF; }
      .kve-btn-price { background: #059669; }
      .kve-btn-size  { background: #7C3AED; }
      .kve-btn-cat   { background: #D97706; }

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
      <span class="kve-hint">Hover sekciju → toolbar. Klikni tekst → uredi. Drag karte → redosljed.</span>
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
      <input type="url" class="kve-draft-img" placeholder="URL slike (opciono)"/>
      <div class="kve-draft-actions">
        <button class="kve-draft-save">✓ Sačuvaj</button>
        <button class="kve-draft-cancel">✕ Otkaži</button>
      </div>
    `;
    grid.insertBefore(wrap, addWrap);
    wrap.querySelector('.kve-draft-save').addEventListener('click', () => submitDraftCard(wrap));
    wrap.querySelector('.kve-draft-cancel').addEventListener('click', () => wrap.remove());
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
    `;
    wrap.appendChild(bar);

    bar.querySelector('.kve-btn-img').addEventListener('click',   e => { e.stopPropagation(); openImageModal(p, id, wrap); });
    bar.querySelector('.kve-btn-price').addEventListener('click', e => { e.stopPropagation(); openPriceModal(p, id, wrap); });
    bar.querySelector('.kve-btn-size').addEventListener('click',  e => { e.stopPropagation(); toggleSize(wrap, id); });
    bar.querySelector('.kve-btn-cat').addEventListener('click',   e => { e.stopPropagation(); showCategoryMenu(e, id); });

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

  /* ─────────────────────────────────────────────────────────────────
     9. IMAGE MODAL
  ──────────────────────────────────────────────────────────────────── */
  function openImageModal(product, id, wrap) {
    const modal = createModal('🖼️ Promijeni sliku', `
      <label>URL slike</label>
      <input type="url" id="kve-img-url" placeholder="https://…" value="${esc(product.image_url || '')}"/>
    `);
    modal.ok.addEventListener('click', async () => {
      const newUrl = modal.overlay.querySelector('#kve-img-url').value.trim();
      closeModal(modal.overlay);
      if (!newUrl) return;
      await saveField(id, 'image_url', newUrl, wrap);
      const img = wrap.querySelector('img');
      if (img) { img.src = newUrl; }
      else {
        const placeholder = wrap.querySelector('.glass-card div[style]');
        if (placeholder) placeholder.outerHTML = `<img src="${esc(newUrl)}" class="max-h-24 w-auto object-contain" alt="product"/>`;
      }
    });
    setTimeout(() => modal.overlay.querySelector('#kve-img-url').focus(), 60);
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
    clone.querySelectorAll('.kve-text-editable').forEach(el => el.classList.remove('kve-text-editable'));

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
     17. GLOBAL TEXT EDITING  (NEW)
     Every h1/h2/h3/p on static pages becomes click-to-edit.
     Skips: nav, footer, product cards, editor UI elements.
  ──────────────────────────────────────────────────────────────────── */
  function initGlobalTextEditing() {
    const selector =
      'h1:not([data-kve-field]):not([data-ck]),' +
      'h2:not([data-kve-field]):not([data-ck]),' +
      'h3:not([data-kve-field]):not([data-ck]),' +
      'p:not([data-kve-field]):not([data-ck])';

    document.querySelectorAll(selector).forEach(el => {
      // Skip elements inside editor UI, navbars, footers, product cards
      if (el.closest('[data-kve-editor], nav, footer, .product-card, .kve-draft-wrap')) return;
      // Skip empty or trivially short elements
      if (el.textContent.trim().length < 2) return;

      _wireTextEditable(el);
    });
  }

  /** Make a single element click-to-edit (reused for injected blocks) */
  function _wireTextEditable(el) {
    el.classList.add('kve-text-editable');
    el.setAttribute('data-original-text', el.innerHTML);
    el.title = 'Klikni za uređivanje';

    el.addEventListener('click', () => {
      if (el.contentEditable === 'true') return;
      el.contentEditable = 'true';
      el.focus();
      // Move cursor to end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        el.innerHTML = el.dataset.originalText;
        el.contentEditable = 'false';
        el.blur();
      }
      // Enter commits headings, allows newline in <p>
      if (e.key === 'Enter' && el.tagName !== 'P') { e.preventDefault(); el.blur(); }
    });

    el.addEventListener('blur', () => {
      el.contentEditable = 'false';
      el.setAttribute('data-original-text', el.innerHTML);
      toastMsg('✏️ Izmjena unijeta — klikni "Sačuvaj stranicu" da sačuvaš.');
    });
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

    const bar = document.createElement('div');
    bar.className = 'kve-section-bar';
    bar.setAttribute('data-kve-editor', '1');
    bar.innerHTML = `
      <button class="kve-sec-move-up"   title="Pomjeri sekciju gore">▲ Gore</button>
      <button class="kve-sec-move-down" title="Pomjeri sekciju dolje">▼ Dolje</button>
      <button class="kve-sec-style"     title="Uredi pozadinu / stil">⚙️ Stil</button>
      <button class="kve-sec-delete"    title="Obriši sekciju">🗑️ Obriši</button>
    `;
    sec.appendChild(bar);

    bar.querySelector('.kve-sec-delete').addEventListener('click', e => {
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

    // Wire text editing for all headings and paragraphs in the new block
    newSection.querySelectorAll('h1, h2, h3, p').forEach(el => {
      if (el.closest('[data-kve-editor]')) return;
      if (el.textContent.trim().length < 2) return;
      _wireTextEditable(el);
    });

    setTimeout(() => newSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    toastMsg(`📦 Blok "${block.name}" dodan!`);
  }

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
