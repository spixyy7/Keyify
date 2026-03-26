/**
 * visual-editor.js  –  Keyify Live Visual Editor
 *
 * Activates when: URL contains ?mode=edit  AND  user is admin (JWT in localStorage).
 * Add  <script src="visual-editor.js"></script>  to every shop page (after keyify.js).
 */
(function () {
  'use strict';

  /* ── 1. ACTIVATION GUARD ─────────────────────────────── */
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') !== 'edit') return;

  const token = localStorage.getItem('keyify_token');
  const role  = localStorage.getItem('keyify_role');
  if (!token || role !== 'admin') {
    console.warn('[KVE] Editor mode requires admin login.');
    return;
  }

  const API  = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
  const lang = localStorage.getItem('keyify_lang') || 'sr';

  /* ── 2. STATE ────────────────────────────────────────── */
  const pendingLayout = new Map(); // id → { grid_order?, card_size? }
  let   dragSrc       = null;

  const CATEGORIES = [
    { value: 'ai',        label: '🤖 AI Alati'           },
    { value: 'design',    label: '🎨 Design & Creativity' },
    { value: 'business',  label: '💼 Business Software'   },
    { value: 'windows',   label: '🪟 Windows & Office'    },
    { value: 'music',     label: '🎵 Music Streaming'     },
    { value: 'streaming', label: '📺 TV/Video Streaming'  },
  ];

  /* ── 3. BOOT ─────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    injectStyles();
    injectToolbar();
    watchGrid();
  }

  /* ── 4. STYLES ───────────────────────────────────────── */
  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'kve-styles';
    s.textContent = `
      /* ─ Toolbar ─ */
      #kve-toolbar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: linear-gradient(90deg, #1254D4 0%, #1D6AFF 40%, #A259FF 100%);
        color: #fff; display: flex; align-items: center; gap: 10px;
        padding: 9px 18px; font-family: 'Inter', sans-serif;
        font-size: 12px; font-weight: 600;
        box-shadow: 0 4px 24px rgba(29,106,255,0.45);
      }
      #kve-toolbar .kve-pill {
        background: rgba(255,255,255,0.18); border-radius: 20px;
        padding: 3px 10px; font-size: 11px; letter-spacing: .05em; white-space: nowrap;
      }
      #kve-toolbar .kve-hint {
        flex: 1; color: rgba(255,255,255,0.75); font-weight: 400; font-size: 12px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #kve-toolbar button {
        background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3);
        color: #fff; border-radius: 8px; padding: 5px 14px; font-size: 12px;
        font-weight: 700; cursor: pointer; white-space: nowrap;
        transition: background .15s;
      }
      #kve-toolbar button:hover { background: rgba(255,255,255,0.28); }
      #kve-toolbar .kve-save-btn {
        background: rgba(255,255,255,0.92); color: #1D6AFF;
        border-color: transparent;
      }
      #kve-toolbar .kve-save-btn:hover { background: #fff; }
      body.kve-active { padding-top: 48px !important; }

      /* ─ Card wrapper ─ */
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

      /* ─ Card toolbar ─ */
      .kve-card-bar {
        position: absolute; top: 16px; right: 16px; z-index: 20;
        display: flex; gap: 4px;
        opacity: 0; pointer-events: none;
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

      /* ─ Contenteditable ─ */
      [data-kve-field][contenteditable="true"] {
        outline: none; cursor: text;
        border-radius: 3px;
        transition: background .15s, box-shadow .15s;
      }
      [data-kve-field][contenteditable="true"]:hover {
        background: rgba(29,106,255,0.06);
        box-shadow: 0 0 0 1px rgba(29,106,255,0.3);
      }
      [data-kve-field][contenteditable="true"]:focus {
        background: rgba(29,106,255,0.08);
        box-shadow: 0 0 0 2px #1D6AFF;
      }

      /* ─ Saved indicator ─ */
      .kve-saved {
        position: absolute; bottom: 12px; left: 12px; z-index: 30;
        background: #10b981; color: #fff; font-size: 10px; font-weight: 700;
        padding: 3px 9px; border-radius: 999px; pointer-events: none;
        opacity: 0; transform: translateY(4px);
        transition: opacity .25s, transform .25s;
      }
      .kve-saved.show { opacity: 1; transform: translateY(0); }
      .kve-saved.error { background: #ef4444; }

      /* ─ Inline modal ─ */
      .kve-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        z-index: 999999; display: flex; align-items: center; justify-content: center;
        animation: kveFadeIn .15s ease;
      }
      @keyframes kveFadeIn { from { opacity:0 } to { opacity:1 } }
      .kve-modal {
        background: #13132a; border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px; padding: 26px; width: 360px; max-width: calc(100vw - 32px);
        font-family: 'Inter', sans-serif; color: #e2e2f0;
        box-shadow: 0 24px 64px rgba(0,0,0,0.6);
        animation: kveSlideUp .2s ease;
      }
      @keyframes kveSlideUp { from { transform:translateY(12px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      .kve-modal h4 {
        font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 700;
        color: #fff; margin: 0 0 18px;
      }
      .kve-modal label {
        display: block; font-size: 10px; font-weight: 700; color: #5050a0;
        text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px;
      }
      .kve-modal label + label { margin-top: 12px; }
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
      .kve-btn-ok { background: linear-gradient(135deg,#1D6AFF,#A259FF); color: #fff; }

      /* ─ Context menu ─ */
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
    `;
    document.head.appendChild(s);
  }

  /* ── 5. TOOLBAR ──────────────────────────────────────── */
  function injectToolbar() {
    const bar = document.createElement('div');
    bar.id = 'kve-toolbar';
    bar.innerHTML = `
      <span class="kve-pill">✏️ EDITOR MODE</span>
      <span class="kve-hint">Hover → edit. Drag to reorder. Right-click → premjesti kategoriju.</span>
      <button id="kve-exit-btn">✕ Izađi</button>
      <button class="kve-save-btn" id="kve-save-btn">💾 Sačuvaj raspored</button>
    `;
    document.body.prepend(bar);
    document.body.classList.add('kve-active');

    document.getElementById('kve-exit-btn').addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      window.location.href = url.toString();
    });
    document.getElementById('kve-save-btn').addEventListener('click', saveLayout);
  }

  /* ── 6. WATCH GRID ───────────────────────────────────── */
  function watchGrid() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    // Enhance cards already in DOM
    enhanceNewCards(grid);
    // Watch for dynamically injected cards
    const obs = new MutationObserver(() => enhanceNewCards(grid));
    obs.observe(grid, { childList: true });
  }

  function enhanceNewCards(grid) {
    grid.querySelectorAll('.product-card:not([data-kve])').forEach(card => {
      card.setAttribute('data-kve', '1');
      initCard(card);
    });
  }

  /* ── 7. INIT SINGLE CARD ─────────────────────────────── */
  function initCard(card) {
    // ① Get product data from the add-to-cart button
    const cartBtn = card.querySelector('[data-product]');
    if (!cartBtn) return;
    let p;
    try { p = JSON.parse(cartBtn.getAttribute('data-product')); } catch { return; }
    const id = String(p.id);

    // ② Wrap in draggable container
    const wrap = document.createElement('div');
    wrap.className = 'kve-wrap';
    wrap.dataset.kveId = id;
    card.parentNode.insertBefore(wrap, card);
    wrap.appendChild(card);

    // Restore pending size
    const saved = pendingLayout.get(id);
    if (saved?.card_size === 'lg') wrap.classList.add('kve-lg');

    // ③ "Saved" flash badge
    const savedEl = document.createElement('div');
    savedEl.className = 'kve-saved';
    wrap.appendChild(savedEl);

    // ④ Per-card toolbar
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

    // ⑤ Contenteditable: name
    const nameEl = card.querySelector('.px-4 h3');
    if (nameEl) {
      nameEl.contentEditable = 'true';
      nameEl.dataset.kveField = lang === 'en' ? 'name_en' : 'name_sr';
      nameEl.title = 'Klikni za uređivanje naziva';
      nameEl.addEventListener('blur',    () => saveField(id, nameEl.dataset.kveField, nameEl.textContent.trim(), wrap));
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
    }

    // ⑥ Contenteditable: description
    const descEl = card.querySelector('.px-4 p');
    if (descEl) {
      descEl.contentEditable = 'true';
      descEl.dataset.kveField = lang === 'en' ? 'description_en' : 'description_sr';
      descEl.title = 'Klikni za uređivanje opisa';
      descEl.addEventListener('blur',    () => saveField(id, descEl.dataset.kveField, descEl.textContent.trim(), wrap));
      descEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); descEl.blur(); } });
    }

    // ⑦ Drag & drop
    wrap.setAttribute('draggable', 'true');
    wrap.addEventListener('dragstart', onDragStart);
    wrap.addEventListener('dragover',  onDragOver);
    wrap.addEventListener('dragleave', onDragLeave);
    wrap.addEventListener('drop',      onDrop);
    wrap.addEventListener('dragend',   onDragEnd);

    // Prevent default drag on contenteditable children
    [nameEl, descEl].forEach(el => {
      if (!el) return;
      el.addEventListener('mousedown', e => e.stopPropagation());
    });
    cartBtn.setAttribute('draggable', 'false');

    // ⑧ Right-click context menu
    wrap.addEventListener('contextmenu', e => { e.preventDefault(); showCategoryMenu(e, id); });
  }

  /* ── 8. FIELD SAVE (inline) ──────────────────────────── */
  async function saveField(id, field, value, wrap) {
    if (value === undefined || value === null) return;
    flashSaved(wrap, '⏳');
    try {
      const res = await fetch(`${API}/products/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ [field]: value }),
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

  /* ── 9. IMAGE MODAL ──────────────────────────────────── */
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
      // Live update image in DOM
      const img = wrap.querySelector('img');
      if (img) { img.src = newUrl; }
      else {
        const imgBox = wrap.querySelector('.glass-card');
        if (imgBox) {
          const placeholder = imgBox.querySelector('div[style]');
          if (placeholder) {
            placeholder.outerHTML = `<img src="${esc(newUrl)}" class="max-h-24 w-auto object-contain" alt="product"/>`;
          }
        }
      }
    });
    setTimeout(() => modal.overlay.querySelector('#kve-img-url').focus(), 60);
  }

  /* ── 10. PRICE MODAL ─────────────────────────────────── */
  function openPriceModal(product, id, wrap) {
    const modal = createModal('€ Uredi cijenu', `
      <label>Nova cijena (€)</label>
      <input type="number" id="kve-price" min="0.01" step="0.01" value="${esc(parseFloat(product.price || 0).toFixed(2))}"/>
      <label>Stara cijena (€) — ostavite prazno bez popusta</label>
      <input type="number" id="kve-orig"  min="0" step="0.01"
             value="${esc(product.original_price ? parseFloat(product.original_price).toFixed(2) : '')}"/>
    `);

    modal.ok.addEventListener('click', async () => {
      const newPrice = parseFloat(modal.overlay.querySelector('#kve-price').value);
      const origVal  = modal.overlay.querySelector('#kve-orig').value.trim();
      closeModal(modal.overlay);
      if (isNaN(newPrice) || newPrice <= 0) return;
      const body = {
        price:          newPrice,
        original_price: origVal ? parseFloat(origVal) : null,
      };
      flashSaved(wrap, '⏳');
      try {
        const res = await fetch(`${API}/products/${id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        // Live update visible price
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

  /* ── 11. SIZE TOGGLE ─────────────────────────────────── */
  function toggleSize(wrap, id) {
    const isLg = wrap.classList.toggle('kve-lg');
    const cur  = pendingLayout.get(id) || {};
    pendingLayout.set(id, { ...cur, card_size: isLg ? 'lg' : 'sm' });
    flashSaved(wrap, isLg ? '⬜ Velika kartica' : '▪ Normalna kartica');
  }

  /* ── 12. CATEGORY CONTEXT MENU ───────────────────────── */
  function showCategoryMenu(e, id) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'kve-ctx';
    menu.innerHTML = `
      <div class="kve-ctx-header">Premjesti u kategoriju</div>
      <div class="kve-ctx-sep"></div>
      ${CATEGORIES.map(c => `<div class="kve-ctx-item" data-cat="${c.value}">${c.label}</div>`).join('')}
    `;
    const x = Math.min(e.clientX + 4, window.innerWidth  - 210);
    const y = Math.min(e.clientY + 4, window.innerHeight - 300);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    document.body.appendChild(menu);

    menu.querySelectorAll('.kve-ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        moveToCategory(id, item.dataset.cat);
        removeContextMenu();
      });
    });
    setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 0);
  }

  function removeContextMenu() { document.getElementById('kve-ctx')?.remove(); }

  async function moveToCategory(id, newCat) {
    const wrap = document.querySelector(`.kve-wrap[data-kve-id="${id}"]`);
    try {
      const res = await fetch(`${API}/products/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ category: newCat }),
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

  /* ── 13. DRAG & DROP ─────────────────────────────────── */
  function onDragStart(e) {
    dragSrc = this;
    this.classList.add('kve-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.kveId);
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== dragSrc) this.classList.add('kve-drag-over');
  }
  function onDragLeave() { this.classList.remove('kve-drag-over'); }
  function onDrop(e) {
    e.preventDefault();
    this.classList.remove('kve-drag-over');
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
      const id = wrap.dataset && wrap.dataset.kveId;
      if (!id) return;
      const cur = pendingLayout.get(id) || {};
      pendingLayout.set(id, { ...cur, grid_order: idx });
    });
  }

  /* ── 14. SAVE LAYOUT ─────────────────────────────────── */
  async function saveLayout() {
    syncGridOrders();
    if (pendingLayout.size === 0) {
      alert('Nema izmjena rasporeda za čuvanje.');
      return;
    }
    const saveBtn = document.getElementById('kve-save-btn');
    if (saveBtn) { saveBtn.textContent = '⏳ Čuvanje…'; saveBtn.disabled = true; }

    const items = [...pendingLayout.entries()].map(([id, data]) => ({ id, ...data }));
    try {
      const res = await fetch(`${API}/products/layout`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error();
      pendingLayout.clear();
      if (saveBtn) { saveBtn.textContent = '✓ Sačuvano!'; }
      setTimeout(() => { if (saveBtn) { saveBtn.textContent = '💾 Sačuvaj raspored'; saveBtn.disabled = false; } }, 2400);
    } catch {
      if (saveBtn) { saveBtn.textContent = '✗ Greška!'; saveBtn.disabled = false; }
      setTimeout(() => { if (saveBtn) saveBtn.textContent = '💾 Sačuvaj raspored'; }, 2400);
    }
  }

  /* ── 15. MODAL HELPER ────────────────────────────────── */
  function createModal(title, bodyHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'kve-overlay';
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

  /* ── 16. UTIL ────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
