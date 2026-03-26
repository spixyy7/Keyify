/**
 * keyify.js — Global Engine
 * Handles: Language switching · Shopping Cart · Navbar enhancement
 *
 * REQUIRES: translations.js loaded BEFORE this file.
 *
 * Add to every page, just before </body>:
 *   <script src="translations.js"></script>
 *   <script src="keyify.js"></script>
 *
 * To mark any element for automatic translation, add:
 *   data-i18n="nav.home"   ← translates textContent
 *   data-i18n-placeholder="nav.searchPlaceholder"  ← translates placeholder
 */

/* ─────────────────────────────────────────────────────────────
   KEYIFY NAMESPACE
───────────────────────────────────────────────────────────── */
const KEYIFY = (() => {

  /* ── internal state ── */
  let _lang = localStorage.getItem('keyify_lang') || 'sr';

  /* ─────────────────────────────────────────────────────────
     LANGUAGE MODULE
  ───────────────────────────────────────────────────────── */
  const LANG = {

    get current() { return _lang; },

    /** Switch language and persist */
    set(lang) {
      if (!TRANSLATIONS[lang]) return;
      _lang = lang;
      localStorage.setItem('keyify_lang', lang);
      this.apply();
      CART.updateNavbarText();
    },

    /** Apply current language to the whole page */
    apply() {
      /* 1. Elements with data-i18n="key" */
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key  = el.getAttribute('data-i18n');
        const text = t(key, _lang);
        if (text !== key) el.textContent = text;
      });

      /* 2. Elements with data-i18n-placeholder="key" */
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key  = el.getAttribute('data-i18n-placeholder');
        const text = t(key, _lang);
        if (text !== key) el.placeholder = text;
      });

      /* 3. Nav links — matched by href */
      const navMap = {
        'index.html':    t('nav.home',       _lang),
        'ai.html':       t('nav.shopAI',     _lang),
        'design.html':   t('nav.design',     _lang),
        'business.html': t('nav.business',   _lang),
        'windows.html':  t('nav.windows',    _lang),
        'music.html':    t('nav.music',      _lang),
        'streaming.html':t('nav.streaming',  _lang),
        'about.html':    t('nav.aboutUs',    _lang),
        'contact.html':  t('nav.contact',    _lang),
        'login.html':    t('nav.login',      _lang),
      };
      document.querySelectorAll('header nav a[href], #mobile-menu a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (navMap[href]) a.textContent = navMap[href];
      });

      /* 4. Dropdown button labels (Shop Software / Shop Streaming) */
      document.querySelectorAll('header nav button').forEach(btn => {
        const txt = btn.textContent.trim();
        if (txt.startsWith('Shop Software') || txt.startsWith('Shop Software'))
          btn.firstChild.textContent = t('nav.shopSoftware', _lang) + ' ';
        if (txt.startsWith('Shop Streaming'))
          btn.firstChild.textContent = t('nav.shopStreaming', _lang) + ' ';
      });

      /* 5. "Dodaj u korpu" / "Add to Cart" buttons */
      document.querySelectorAll('button[data-add-to-cart]').forEach(btn => {
        if (!btn._loading) {
          const svgHTML = btn.querySelector('svg')?.outerHTML || '';
          btn.innerHTML = `${svgHTML} ${t('btn.addToCart', _lang)}`;
        }
      });

      /* 6. Language switcher button highlight */
      document.querySelectorAll('.kf-lang-btn').forEach(b => {
        const isActive = b.dataset.lang === _lang;
        b.style.background = isActive ? '#1D6AFF'      : 'transparent';
        b.style.color      = isActive ? '#ffffff'      : '#6b7280';
        b.style.fontWeight = isActive ? '700'          : '500';
      });
    },
  };


  /* ─────────────────────────────────────────────────────────
     CART MODULE
  ───────────────────────────────────────────────────────── */
  const CART = {

    /* ── storage ── */
    _load()  { return JSON.parse(localStorage.getItem('keyify_cart') || '[]'); },
    _save(items) { localStorage.setItem('keyify_cart', JSON.stringify(items)); },

    get items() { return this._load(); },

    /* ── operations ── */
    add(product) {
      const items = this._load();
      const idx   = items.findIndex(i => i.id === product.id);
      if (idx >= 0) {
        items[idx].qty = (items[idx].qty || 1) + 1;
      } else {
        items.push({ ...product, qty: 1 });
      }
      this._save(items);
      this.updateNavbarText();
      this._renderDrawerItems();
      this._toast(t('cart.itemAdded', _lang), '✓');
    },

    remove(id) {
      const items = this._load().filter(i => i.id !== id);
      this._save(items);
      this.updateNavbarText();
      this._renderDrawerItems();
    },

    setQty(id, qty) {
      const items = this._load();
      const idx   = items.findIndex(i => i.id === id);
      if (idx < 0) return;
      if (qty <= 0) { this.remove(id); return; }
      items[idx].qty = qty;
      this._save(items);
      this.updateNavbarText();
      this._renderDrawerItems();
    },

    clear() {
      this._save([]);
      this.updateNavbarText();
      this._renderDrawerItems();
    },

    total()  { return this._load().reduce((s, i) => s + i.price * (i.qty || 1), 0); },
    count()  { return this._load().reduce((s, i) => s + (i.qty || 1), 0); },

    /* ── navbar text ── */
    updateNavbarText() {
      const count = this.count();
      const total = this.total();
      const label = count > 0
        ? `${t('cart.title', _lang)} (${count})  €\u202F${total.toFixed(2).replace('.', ',')}`
        : `${t('cart.title', _lang)} €\u202F0,00`;

      document.querySelectorAll('.kf-cart-label').forEach(el => {
        el.textContent = label;
      });
      /* bubble badge */
      document.querySelectorAll('.kf-cart-badge').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? 'flex' : 'none';
      });
    },

    /* ── drawer open / close ── */
    open() {
      this._renderDrawerItems();
      const drawer  = document.getElementById('kf-cart-drawer');
      const overlay = document.getElementById('kf-cart-overlay');
      drawer?.classList.remove('translate-x-full');
      overlay?.classList.remove('opacity-0', 'pointer-events-none');
      overlay?.classList.add('opacity-100');
      document.body.style.overflow = 'hidden';
    },

    close() {
      const drawer  = document.getElementById('kf-cart-drawer');
      const overlay = document.getElementById('kf-cart-overlay');
      drawer?.classList.add('translate-x-full');
      overlay?.classList.remove('opacity-100');
      overlay?.classList.add('opacity-0', 'pointer-events-none');
      document.body.style.overflow = '';
    },

    /* ── render drawer item list ── */
    _renderDrawerItems() {
      const container = document.getElementById('kf-cart-items');
      const footerEl  = document.getElementById('kf-cart-footer');
      if (!container) return;

      const items = this._load();
      const lang  = _lang;

      /* update title count */
      const titleEl = document.getElementById('kf-cart-title');
      if (titleEl) {
        const count = this.count();
        titleEl.textContent = `${t('cart.title', lang)} ${count > 0 ? `(${count})` : ''}`;
      }

      if (!items.length) {
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
            <svg class="w-16 h-16 text-gray-200" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
            </svg>
            <div>
              <p class="font-semibold text-gray-700 text-base">${t('cart.empty', lang)}</p>
              <p class="text-sm text-gray-400 mt-1">${t('cart.emptyHint', lang)}</p>
            </div>
            <button onclick="KEYIFY.CART.close()"
                    class="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
              ${t('cart.continueShopping', lang)} →
            </button>
          </div>`;
        if (footerEl) footerEl.style.display = 'none';
        return;
      }

      if (footerEl) footerEl.style.display = 'flex';

      container.innerHTML = items.map(item => {
        const subtotal = (item.price * (item.qty || 1)).toFixed(2).replace('.', ',');
        const iconBg   = item.color || '#1D6AFF';
        return `
          <div class="flex items-start gap-3 py-4 border-b border-gray-100 last:border-0" data-item-id="${escAttr(item.id)}">
            <!-- Icon / Image -->
            <div class="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center"
                 style="background:${item.imageUrl ? 'transparent' : `linear-gradient(135deg,${iconBg},${iconBg}aa)`}">
              ${item.imageUrl
                ? `<img src="${escAttr(item.imageUrl)}" alt="${escAttr(item.name)}" class="w-14 h-14 object-cover"/>`
                : `<span class="text-white font-bold text-lg font-display">${escHtml(item.name.charAt(0))}</span>`}
            </div>
            <!-- Info -->
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-gray-900 text-sm leading-tight truncate">${escHtml(item.name)}</p>
              ${item.desc ? `<p class="text-xs text-gray-400 mt-0.5 truncate">${escHtml(item.desc)}</p>` : ''}
              <div class="flex items-center gap-2 mt-2">
                <!-- Qty controls -->
                <div class="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                  <button onclick="KEYIFY.CART.setQty('${escAttr(item.id)}', ${(item.qty||1)-1})"
                          class="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors text-sm font-bold">−</button>
                  <span class="w-8 text-center text-sm font-semibold text-gray-800">${item.qty||1}</span>
                  <button onclick="KEYIFY.CART.setQty('${escAttr(item.id)}', ${(item.qty||1)+1})"
                          class="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors text-sm font-bold">+</button>
                </div>
                <span class="text-sm font-bold text-gray-900 ml-auto">€ ${subtotal}</span>
              </div>
            </div>
            <!-- Remove -->
            <button onclick="KEYIFY.CART.remove('${escAttr(item.id)}')"
                    class="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="${t('cart.remove', lang)}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>`;
      }).join('');

      /* update total */
      const totalEl = document.getElementById('kf-cart-total');
      if (totalEl) totalEl.textContent = `€ ${this.total().toFixed(2).replace('.', ',')}`;
    },

    /* ── mini toast notification ── */
    _toast(msg, icon = '✓') {
      let el = document.getElementById('kf-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'kf-toast';
        el.style.cssText = `
          position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px);
          background:linear-gradient(135deg,#1D6AFF,#A259FF);
          color:#fff; font-size:13px; font-weight:600; font-family:'Inter',sans-serif;
          padding:12px 20px; border-radius:999px;
          box-shadow:0 8px 32px rgba(29,106,255,0.35);
          opacity:0; transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);
          pointer-events:none; z-index:9999; white-space:nowrap;`;
        document.body.appendChild(el);
      }
      el.textContent = `${icon} ${msg}`;
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
      clearTimeout(el._timer);
      el._timer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(20px)';
      }, 2400);
    },
  };


  /* ─────────────────────────────────────────────────────────
     DOM HELPERS
  ───────────────────────────────────────────────────────── */
  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escAttr(str) { return escHtml(str); }


  /* ─────────────────────────────────────────────────────────
     NAVBAR INJECTION
  ───────────────────────────────────────────────────────── */
  function _injectNavbarExtras() {
    /* Find the div that holds the cart button (right side of navbar) */
    const cartBtnContainer = document.querySelector('header .flex.items-center.gap-2');
    if (!cartBtnContainer) return;

    /* ── 1. LANGUAGE SWITCHER ── */
    if (!document.getElementById('kf-lang-switch')) {
      const ls = document.createElement('div');
      ls.id = 'kf-lang-switch';
      ls.className = 'hidden sm:flex items-center gap-0.5';
      ls.style.cssText = 'border:1px solid #e5e7eb; border-radius:10px; padding:3px; background:#fff;';
      ls.innerHTML = `
        <button class="kf-lang-btn" data-lang="sr"
                onclick="KEYIFY.LANG.set('sr')"
                style="padding:4px 10px; border-radius:7px; font-size:11px; cursor:pointer; border:none; transition:all 0.2s; background:#1D6AFF; color:#fff; font-weight:700">
          SR
        </button>
        <button class="kf-lang-btn" data-lang="en"
                onclick="KEYIFY.LANG.set('en')"
                style="padding:4px 10px; border-radius:7px; font-size:11px; cursor:pointer; border:none; transition:all 0.2s; background:transparent; color:#6b7280; font-weight:500">
          EN
        </button>`;
      /* insert before the existing cart button */
      const cartBtn = cartBtnContainer.querySelector('button:has(.kf-cart-label), button span');
      if (cartBtn) {
        cartBtnContainer.insertBefore(ls, cartBtn.closest('button') || cartBtn);
      } else {
        cartBtnContainer.prepend(ls);
      }
    }

    /* ── 2. WRAP CART BUTTON SPAN so we can update it ── */
    cartBtnContainer.querySelectorAll('button').forEach(btn => {
      const span = btn.querySelector('span');
      if (span && span.textContent.includes('Korpa') && !span.classList.contains('kf-cart-label')) {
        span.classList.add('kf-cart-label');
        /* also add open-drawer listener */
        btn.addEventListener('click', () => CART.open());
        btn.style.cursor = 'pointer';
      }
    });

    /* ── 3. BADGE OVERLAY on cart button ── */
    cartBtnContainer.querySelectorAll('button').forEach(btn => {
      if (btn.querySelector('.kf-cart-label') && !btn.querySelector('.kf-cart-badge')) {
        btn.style.position = 'relative';
        const badge = document.createElement('span');
        badge.className = 'kf-cart-badge';
        badge.style.cssText = `
          position:absolute; top:-6px; right:-6px;
          background:#ef4444; color:#fff;
          font-size:10px; font-weight:700; min-width:18px; height:18px;
          border-radius:999px; display:none;
          align-items:center; justify-content:center; padding:0 4px;
          border:2px solid #fff; pointer-events:none;`;
        btn.appendChild(badge);
      }
    });
  }


  /* ─────────────────────────────────────────────────────────
     CART DRAWER INJECTION
  ───────────────────────────────────────────────────────── */
  function _injectCartDrawer() {
    if (document.getElementById('kf-cart-drawer')) return;

    const drawerHTML = `
      <!-- Overlay -->
      <div id="kf-cart-overlay"
           class="fixed inset-0 z-[190] opacity-0 pointer-events-none transition-opacity duration-300"
           style="background:rgba(0,0,0,0.45); backdrop-filter:blur(2px);"
           onclick="KEYIFY.CART.close()"></div>

      <!-- Drawer -->
      <div id="kf-cart-drawer"
           class="fixed inset-y-0 right-0 z-[200] flex flex-col bg-white shadow-2xl translate-x-full transition-transform duration-300 ease-in-out"
           style="width:min(420px,100vw); font-family:'Inter',sans-serif;">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id="kf-cart-title" class="font-semibold text-gray-900 text-base" style="font-family:'Poppins',sans-serif;">
            Korpa
          </h2>
          <button onclick="KEYIFY.CART.close()"
                  class="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Item list (scrollable) -->
        <div id="kf-cart-items" class="flex-1 overflow-y-auto px-5 py-2"
             style="scrollbar-width:thin; scrollbar-color:#e5e7eb transparent;">
          <!-- rendered by JS -->
        </div>

        <!-- Footer with total + checkout -->
        <div id="kf-cart-footer"
             class="px-5 py-4 border-t border-gray-100 flex-col gap-3"
             style="display:none; background:#fff;">
          <!-- Subtotal row -->
          <div class="flex items-center justify-between text-sm text-gray-500 mb-1">
            <span data-i18n="cart.subtotal">Međuzbir</span>
            <span id="kf-cart-total" class="font-bold text-gray-900">€ 0,00</span>
          </div>
          <!-- VAT note -->
          <p class="text-xs text-gray-400 mb-3" data-i18n="checkout.vatNote">
            Cijena uključuje sve poreze i naknade.
          </p>
          <!-- Checkout button -->
          <a href="checkout.html"
             class="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-white text-sm font-bold transition-all hover:opacity-90 active:scale-[0.98]"
             style="background:linear-gradient(135deg,#1D6AFF,#A259FF); text-decoration:none;">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" d="M5 13l4 4L19 7"/>
            </svg>
            <span data-i18n="cart.checkout">Naruči</span>
          </a>
          <!-- Continue shopping -->
          <button onclick="KEYIFY.CART.close()"
                  class="w-full py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors mt-1"
                  data-i18n="cart.continueShopping">
            Nastavi kupovinu
          </button>
        </div>
      </div>`;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = drawerHTML;
    document.body.appendChild(wrapper);
  }


  /* ─────────────────────────────────────────────────────────
     WIRE ADD-TO-CART BUTTONS
     Scans for buttons containing "Dodaj u korpu" or "Kupi Sada"
     and attaches cart logic + data-attribute markup.
  ───────────────────────────────────────────────────────── */
  function _wireProductButtons() {
    document.querySelectorAll('button').forEach(btn => {
      /* Skip already-wired buttons and non-cart buttons */
      if (btn.dataset.addToCart !== undefined) return;

      const txt = btn.textContent.trim();
      const isAddBtn = txt === 'Dodaj u korpu'
        || txt === 'Kupi Sada'
        || txt === 'Add to Cart'
        || txt === 'Buy Now'
        || btn.innerHTML.includes('Dodaj u korpu')
        || btn.innerHTML.includes('Kupi Sada');

      if (!isAddBtn) return;

      /* Mark as cart button */
      btn.dataset.addToCart = '1';

      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const product = _extractProduct(btn);
        if (!product) return;

        /* Button feedback */
        const original = btn.innerHTML;
        btn._loading = true;
        btn.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          ${t('btn.added', _lang)}`;
        btn.style.background = '#059669';
        btn.disabled = true;

        setTimeout(() => {
          btn.innerHTML = original;
          btn.style.background = '';
          btn.disabled = false;
          btn._loading = false;
        }, 1800);

        CART.add(product);
      });
    });
  }


  /* ─────────────────────────────────────────────────────────
     EXTRACT PRODUCT DATA FROM A CARD DOM NODE
  ───────────────────────────────────────────────────────── */
  function _extractProduct(btn) {
    /* Walk up to find the product card wrapper */
    const card = btn.closest('.product-card') || btn.closest('[class*="product"]') || btn.parentElement?.parentElement;
    if (!card) return null;

    /* ── name ── */
    const nameEl = card.querySelector('h3');
    const name   = nameEl?.textContent.trim();
    if (!name) return null;

    /* ── price — find "€ XX,XX" or "€ XX.XX" ── */
    const allSpans = card.querySelectorAll('span');
    let price = 0;
    allSpans.forEach(s => {
      if (s.textContent.includes('€') && s.classList.contains('font-bold')) {
        const raw = s.textContent.replace('€','').replace(/\s/g,'').replace(',','.').trim();
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed > 0) price = parsed;
      }
    });
    /* fallback: find by class pattern */
    if (!price) {
      const priceEl = card.querySelector('.text-blue-600.font-bold, .text-base.font-bold');
      if (priceEl) {
        const raw = priceEl.textContent.replace('€','').replace(/\s/g,'').replace(',','.').trim();
        price = parseFloat(raw) || 0;
      }
    }

    /* ── description ── */
    const descEl = card.querySelector('p.text-gray-500, p.text-xs');
    const desc   = descEl?.textContent.trim() || '';

    /* ── accent colour (for icon bg in drawer) ── */
    const colorEl = card.querySelector('[style*="background:linear-gradient"]');
    let color = '#1D6AFF';
    if (colorEl) {
      const m = colorEl.getAttribute('style').match(/#[0-9a-fA-F]{6}/);
      if (m) color = m[0];
    }

    /* ── stable ID from name ── */
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    return { id, name, price, desc, color, imageUrl: null };
  }


  /* ─────────────────────────────────────────────────────────
     ACCOUNT NAVBAR (dynamic after login)
  ───────────────────────────────────────────────────────── */
  function _logout() {
    localStorage.removeItem('keyify_token');
    localStorage.removeItem('keyify_name');
    localStorage.removeItem('keyify_role');
    window.location.href = 'login.html';
  }

  function _updateAccountNavbar() {
    const token = localStorage.getItem('keyify_token');
    const name  = localStorage.getItem('keyify_name');
    const role  = localStorage.getItem('keyify_role');

    const accountLink = document.querySelector('header a[href="login.html"]');
    if (!accountLink) return;

    if (token && name) {
      if (role === 'admin') {
        accountLink.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
          </svg>
          <span style="font-weight:700;color:#A259FF">ADMIN</span>`;
        accountLink.href = 'admin.html';
      } else {
        /* Replace the single link with a user menu wrapper */
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:6px;';
        wrapper.id = 'keyify-user-menu';

        const profileA = document.createElement('a');
        profileA.href = 'profile.html';
        profileA.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:0.875rem;font-weight:700;color:#1D6AFF;text-decoration:none;';
        profileA.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
          </svg>
          <span>${escHtml(name.split(' ')[0])}</span>`;

        const logoutBtn = document.createElement('button');
        logoutBtn.title = 'Logout';
        logoutBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid #fee2e2;background:#fff5f5;color:#ef4444;cursor:pointer;flex-shrink:0;';
        logoutBtn.innerHTML = `<svg style="width:15px;height:15px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>`;
        logoutBtn.addEventListener('click', function(e) { e.preventDefault(); _logout(); });

        wrapper.appendChild(profileA);
        wrapper.appendChild(logoutBtn);
        accountLink.replaceWith(wrapper);
      }
    }
  }


  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */
  function init() {
    _injectCartDrawer();
    _injectNavbarExtras();
    _wireProductButtons();
    _updateAccountNavbar();
    LANG.apply();
    CART.updateNavbarText();
    CART._renderDrawerItems();

    /* Re-wire on any dynamic DOM changes (e.g. API-loaded products) */
    const obs = new MutationObserver(() => _wireProductButtons());
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* Public API */
  return { LANG, CART, lang: _lang, init, escHtml, escAttr, logout: _logout };

})();


/* ─────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KEYIFY.init());
} else {
  KEYIFY.init();
}
