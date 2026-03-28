/**
 * search-overlay.js — Keyify Global Search
 * Triggered by #kf-search-btn on any page.
 * Fetches /api/products, filters client-side, shows overlay.
 */
(function () {
  'use strict';

  const API_BASE = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';

  /* ── Inject overlay HTML & CSS once ── */
  function _inject() {
    if (document.getElementById('kf-search-overlay')) return;

    const style = document.createElement('style');
    style.textContent = `
      #kf-search-overlay {
        position: fixed; inset: 0; z-index: 999998;
        background: rgba(0,0,0,0.45); backdrop-filter: blur(6px);
        display: flex; align-items: flex-start; justify-content: center;
        padding-top: 80px; padding-left: 16px; padding-right: 16px;
        opacity: 0; pointer-events: none;
        transition: opacity .2s ease;
      }
      #kf-search-overlay.active { opacity: 1; pointer-events: auto; }
      #kf-search-box {
        background: #fff; border-radius: 20px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.22), 0 2px 12px rgba(0,0,0,0.08);
        width: 100%; max-width: 620px;
        overflow: hidden; transform: translateY(-10px);
        transition: transform .2s ease;
      }
      #kf-search-overlay.active #kf-search-box { transform: translateY(0); }
      #kf-search-input-wrap {
        display: flex; align-items: center; gap: 10px;
        padding: 16px 20px; border-bottom: 1px solid #f0f0f4;
      }
      #kf-search-input-wrap svg { flex-shrink: 0; color: #9ca3af; }
      #kf-search-input {
        flex: 1; border: none; outline: none; font-size: 16px;
        font-family: 'Inter', sans-serif; color: #111827;
        background: transparent;
      }
      #kf-search-input::placeholder { color: #9ca3af; }
      #kf-search-close {
        width: 28px; height: 28px; border-radius: 8px; border: none;
        background: #f3f4f6; color: #6b7280; cursor: pointer;
        font-size: 13px; display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      #kf-search-close:hover { background: #e5e7eb; }
      #kf-search-results {
        max-height: 420px; overflow-y: auto; padding: 8px 0;
      }
      #kf-search-results::-webkit-scrollbar { width: 4px; }
      #kf-search-results::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 2px; }
      .kf-sr-item {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 20px; cursor: pointer;
        transition: background .12s;
        text-decoration: none; color: inherit;
      }
      .kf-sr-item:hover { background: #f5f7ff; }
      .kf-sr-thumb {
        width: 42px; height: 42px; border-radius: 10px; object-fit: cover;
        flex-shrink: 0; background: #f3f4f6;
      }
      .kf-sr-thumb-placeholder {
        width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 15px; color: #fff;
      }
      .kf-sr-name { font-size: 14px; font-weight: 600; color: #111827; }
      .kf-sr-meta { font-size: 12px; color: #6b7280; margin-top: 1px; }
      .kf-sr-price { font-size: 13px; font-weight: 700; color: #1D6AFF; margin-left: auto; flex-shrink: 0; }
      #kf-search-empty {
        padding: 32px 20px; text-align: center;
        font-size: 14px; color: #9ca3af;
      }
      #kf-search-hint {
        padding: 10px 20px 14px; font-size: 11px; color: #c0c0cc;
        border-top: 1px solid #f0f0f4; text-align: center;
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'kf-search-overlay';
    overlay.innerHTML = `
      <div id="kf-search-box">
        <div id="kf-search-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input id="kf-search-input" type="text" placeholder="Pretraži proizvode…" autocomplete="off"/>
          <button id="kf-search-close" title="Zatvori (Esc)">✕</button>
        </div>
        <div id="kf-search-results"></div>
        <div id="kf-search-hint">↵ za otvaranje &nbsp;·&nbsp; Esc za zatvaranje</div>
      </div>
    `;
    document.body.appendChild(overlay);

    /* Close on overlay background click */
    overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });
    document.getElementById('kf-search-close').addEventListener('click', _close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _close();
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); _open(); }
    });

    document.getElementById('kf-search-input').addEventListener('input', _onInput);
  }

  let _products = null;
  let _debounce = null;

  async function _loadProducts() {
    if (_products) return _products;
    try {
      const res = await fetch(`${API_BASE}/products`);
      _products = (await res.json()) || [];
    } catch { _products = []; }
    return _products;
  }

  function _open() {
    _inject();
    const overlay = document.getElementById('kf-search-overlay');
    const input   = document.getElementById('kf-search-input');
    overlay.classList.add('active');
    setTimeout(() => input && input.focus(), 60);
    _loadProducts(); // preload
    _render('');
  }

  function _close() {
    document.getElementById('kf-search-overlay')?.classList.remove('active');
  }

  function _onInput(e) {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => _render(e.target.value.trim()), 120);
  }

  const CAT_PAGES = {
    ai:        'ai.html',
    design:    'design.html',
    business:  'business.html',
    windows:   'windows.html',
    music:     'music.html',
    streaming: 'streaming.html',
  };
  const CAT_COLORS = {
    ai: '#6366f1', design: '#ec4899', business: '#0ea5e9',
    windows: '#3b82f6', music: '#f59e0b', streaming: '#10b981',
  };

  function _render(query) {
    const container = document.getElementById('kf-search-results');
    if (!container) return;

    const all = _products || [];
    const q   = query.toLowerCase();
    const filtered = q.length < 1
      ? all.slice(0, 8)
      : all.filter(p =>
          (p.name_sr || p.name || '').toLowerCase().includes(q) ||
          (p.name_en || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
        ).slice(0, 12);

    if (!filtered.length && q.length > 0) {
      container.innerHTML = `<div id="kf-search-empty">Nema rezultata za „${_esc(query)}"</div>`;
      return;
    }

    container.innerHTML = filtered.map(p => {
      const name  = p.name_sr || p.name || 'Proizvod';
      const price = p.price ? `€ ${parseFloat(p.price).toFixed(2).replace('.',',')}` : '';
      const page  = CAT_PAGES[p.category] || 'index.html';
      const color = CAT_COLORS[p.category] || '#1D6AFF';
      const thumb = p.image_url
        ? `<img class="kf-sr-thumb" src="${_esc(p.image_url)}" alt="${_esc(name)}" loading="lazy"/>`
        : `<div class="kf-sr-thumb-placeholder" style="background:${color}">${_esc(name.charAt(0))}</div>`;
      const catLabel = p.category
        ? p.category.charAt(0).toUpperCase() + p.category.slice(1)
        : '';

      return `<a class="kf-sr-item" href="${page}">
        ${thumb}
        <div style="flex:1;min-width:0">
          <div class="kf-sr-name">${_esc(name)}</div>
          ${catLabel ? `<div class="kf-sr-meta">${_esc(catLabel)}</div>` : ''}
        </div>
        ${price ? `<span class="kf-sr-price">${price}</span>` : ''}
      </a>`;
    }).join('');
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Wire search button on any page ── */
  function _wire() {
    document.addEventListener('click', e => {
      if (e.target.closest('#kf-search-btn')) {
        e.preventDefault();
        _inject();
        _open();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }

})();
