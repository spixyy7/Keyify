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
    ['keyify_token','keyify_name','keyify_role','keyify_email','keyify_id','keyify_permissions'].forEach(k => localStorage.removeItem(k));
    window.location.href = 'index.html';
  }

  function _updateAccountNavbar() {
    const token = localStorage.getItem('keyify_token');
    const name  = localStorage.getItem('keyify_name');
    const email = localStorage.getItem('keyify_email') || '';
    const role  = localStorage.getItem('keyify_role');

    const accountLink = document.querySelector('header a[href="login.html"]');
    if (!accountLink || !token || !name) return;

    const API_BASE  = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
    const firstName = escHtml(name.split(' ')[0]);
    const initials  = name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

    /* ── Inject one-time styles ── */
    if (!document.getElementById('kf-dd-style')) {
      const st = document.createElement('style');
      st.id = 'kf-dd-style';
      st.textContent = `
        @keyframes kf-dd-in{from{opacity:0;transform:translateY(-10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        #kf-dd-trigger:hover{background:rgba(29,106,255,0.15)!important;border-color:rgba(29,106,255,0.5)!important;box-shadow:0 0 0 3px rgba(29,106,255,0.1)!important}
        #kf-dd-panel .kf-item{border-radius:10px;transition:background .15s ease,transform .12s ease!important}
        #kf-dd-panel a.kf-item:hover,#kf-dd-panel button.kf-item:hover{background:rgba(99,102,241,0.15)!important;transform:translateX(3px)!important}
        #kf-dd-panel .kf-item-danger:hover{background:rgba(239,68,68,0.12)!important;transform:translateX(3px)!important}
        #kf-dd-panel::-webkit-scrollbar{width:3px}
        #kf-dd-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}`;
      document.head.appendChild(st);
    }

    /* ── Wrapper ── */
    const wrapper = document.createElement('div');
    wrapper.id = 'keyify-user-menu';
    wrapper.style.cssText = 'position:relative;display:inline-flex;align-items:center;';

    /* ── Trigger button ── */
    const btn = document.createElement('button');
    btn.id = 'kf-dd-trigger';
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:4px 10px 4px 4px;border:1px solid rgba(29,106,255,0.2);border-radius:12px;background:rgba(29,106,255,0.05);cursor:pointer;font-family:inherit;transition:all .15s;';
    const avatarBadge = isSupportAgent
      ? `<span id="kf-nav-dot" style="display:none;position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;background:#ef4444;color:#fff;font-size:8px;font-weight:700;align-items:center;justify-content:center;border:2px solid #fff;z-index:1"></span>`
      : '';
    btn.innerHTML = `
      <span style="position:relative;display:inline-flex;flex-shrink:0">
        <span style="width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;background:linear-gradient(135deg,#1D6AFF,#A259FF)">${initials}</span>
        ${avatarBadge}
      </span>
      <span style="font-size:13px;font-weight:600;color:#1D6AFF;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${firstName}</span>
      <svg id="kf-dd-chevron" style="width:11px;height:11px;color:#1D6AFF;transition:transform .2s;flex-shrink:0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
      </svg>`;

    /* ── Dropdown panel ── */
    const panel = document.createElement('div');
    panel.id = 'kf-dd-panel';
    panel.style.cssText = 'display:none;position:absolute;top:calc(100% + 10px);right:0;width:248px;background:rgba(8,10,24,0.97);border:1px solid rgba(255,255,255,0.09);border-radius:18px;box-shadow:0 28px 70px rgba(0,0,0,0.65),0 0 0 1px rgba(255,255,255,0.04),inset 0 1px 0 rgba(255,255,255,0.06);z-index:9999;overflow:hidden;animation:kf-dd-in .2s cubic-bezier(.34,1.56,.64,1);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);';

    const perms = JSON.parse(localStorage.getItem('keyify_permissions') || '{}');
    const isSuperAdmin   = role === 'admin' && Object.keys(perms).length === 0;
    const isSupportAgent = role === 'admin' && (isSuperAdmin || perms.can_manage_support === true);
    const canSQL         = role === 'admin' && (isSuperAdmin || perms.can_execute_sql === true);

    const sqlItem = canSQL ? `
      <a href="admin.html" onclick="localStorage.setItem('kf_admin_goto','sql')" class="kf-item" style="display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13px;font-weight:600;color:#a78bfa;text-decoration:none;">
        <span style="font-size:16px;line-height:1;flex-shrink:0">🗄️</span>SQL Editor
      </a>` : '';

    const adminItem = role === 'admin' ? `
      <div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0"></div>
      <a href="admin.html" class="kf-item" style="display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13px;font-weight:700;color:#60a5fa;text-decoration:none;">
        <span style="font-size:16px;line-height:1;flex-shrink:0">💻</span>Admin Panel
      </a>
      ${sqlItem}` : '';

    const inboxItem = isSupportAgent ? `
      <a href="support-inbox.html" class="kf-item" style="display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13px;font-weight:600;color:#34d399;text-decoration:none;">
        <span style="font-size:16px;line-height:1;flex-shrink:0">💬</span>Support Inbox
        <span id="kf-inbox-count" style="display:none;margin-left:auto;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center;padding:0 4px"></span>
      </a>` : '';

    panel.innerHTML = `
      <div style="padding:14px 15px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.025)">
        <div style="font-size:13px;font-weight:700;color:#f0f0ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</div>
        <div style="font-size:11px;color:#6366f1;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(email)}</div>
        ${role === 'admin' ? '<div style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:2px 8px;border-radius:6px;background:rgba(162,89,255,0.15);border:1px solid rgba(162,89,255,0.3);font-size:10px;font-weight:700;color:#c084fc;text-transform:uppercase;letter-spacing:.05em">⚡ Admin</div>' : ''}
      </div>
      <div style="padding:5px">
        <button class="kf-item" id="kf-orders-btn" style="display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13px;font-weight:500;color:#c0c0e0;background:transparent;border:none;width:100%;cursor:pointer;border-radius:10px;text-align:left;">
          <span style="font-size:16px;line-height:1;flex-shrink:0">📦</span>Narudžbe
        </button>
        <a href="profile.html" class="kf-item" style="display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13px;font-weight:500;color:#c0c0e0;text-decoration:none;border-radius:10px;">
          <span style="font-size:16px;line-height:1;flex-shrink:0">👤</span>Moj profil
        </a>
        ${adminItem}
        ${inboxItem}
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.07);padding:5px">
        <button class="kf-item kf-item-danger" id="kf-logout-btn" style="display:flex;align-items:center;gap:10px;padding:10px 13px;font-size:13px;font-weight:500;color:#f87171;background:transparent;border:none;width:100%;cursor:pointer;border-radius:10px;text-align:left;">
          <span style="font-size:16px;line-height:1;flex-shrink:0">🚪</span>Odjava
        </button>
      </div>`;

    /* ── Toggle logic ── */
    let _open = false;
    function _openDD()  { _open = true;  panel.style.display = 'block'; document.getElementById('kf-dd-chevron').style.transform = 'rotate(180deg)'; }
    function _closeDD() { _open = false; panel.style.display = 'none';  const ch = document.getElementById('kf-dd-chevron'); if (ch) ch.style.transform = ''; }
    btn.addEventListener('click', e => { e.stopPropagation(); _open ? _closeDD() : _openDD(); });
    document.addEventListener('click', () => { if (_open) _closeDD(); });
    panel.addEventListener('click', e => e.stopPropagation());

    /* ── Orders button ── */
    panel.querySelector('#kf-orders-btn').addEventListener('click', () => {
      _closeDD();
      _openOrdersModal(token, API_BASE);
    });

    /* ── Logout button ── */
    panel.querySelector('#kf-logout-btn').addEventListener('click', () => _logout());

    wrapper.appendChild(btn);
    wrapper.appendChild(panel);
    accountLink.replaceWith(wrapper);

    // Async: fetch new-chat count for support agents and update badges
    if (isSupportAgent) {
      (async () => {
        try {
          const r = await fetch(`${API_BASE}/admin/chat/sessions/new-count`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!r.ok) return;
          const { count } = await r.json();
          if (count > 0) {
            const dot = document.getElementById('kf-nav-dot');
            const cnt = document.getElementById('kf-inbox-count');
            if (dot) { dot.textContent = count > 9 ? '9+' : count; dot.style.display = 'inline-flex'; }
            if (cnt) { cnt.textContent = count; cnt.style.display = 'inline-flex'; }
          }
        } catch {}
      })();
    }
  }

  /* ── Purchases modal (lazy-created) ── */
  function _openOrdersModal(token, API_BASE) {
    let overlay = document.getElementById('kf-orders-modal');
    if (overlay) { overlay.style.display = 'flex'; _fetchOrders(token, API_BASE); return; }

    overlay = document.createElement('div');
    overlay.id = 'kf-orders-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);animation:kf-dd-in .15s ease';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:26px 28px;width:100%;max-width:580px;max-height:82vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.25)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h3 style="font-family:'Poppins',sans-serif;font-size:16px;font-weight:700;color:#111;margin:0">📦 Moje narudžbe</h3>
          <button id="kf-orders-close" style="width:30px;height:30px;border:none;background:#f3f4f6;border-radius:8px;cursor:pointer;font-size:15px;color:#6b7280;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div id="kf-orders-body" style="min-height:60px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:14px">Učitavanje...</div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    overlay.querySelector('#kf-orders-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    _fetchOrders(token, API_BASE);
  }

  async function _fetchOrders(token, API_BASE) {
    const body = document.getElementById('kf-orders-body');
    if (!body) return;
    body.innerHTML = '<span style="color:#9ca3af;font-size:14px">Učitavanje...</span>';
    try {
      const res  = await fetch(`${API_BASE}/user/purchases`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška');
      if (!data.length) {
        body.innerHTML = '<div style="text-align:center;padding:24px;color:#9ca3af;font-size:14px">Nema narudžbi za prikaz.</div>';
        return;
      }
      body.style.display = 'block';
      body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #f3f4f6">
          <th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Proizvod</th>
          <th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Iznos</th>
          <th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Status</th>
          <th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Datum</th>
        </tr></thead>
        <tbody>${data.map(t => `<tr style="border-bottom:1px solid #f9fafb">
          <td style="padding:10px;font-weight:500;color:#111">${escHtml(t.product_name || '–')}</td>
          <td style="padding:10px;color:#1D6AFF;font-weight:600">€ ${parseFloat(t.amount || 0).toFixed(2)}</td>
          <td style="padding:10px">${t.status === 'completed'
            ? '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:9px;font-size:11px;font-weight:600">Plaćeno</span>'
            : '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9px;font-size:11px;font-weight:600">Na čekanju</span>'}</td>
          <td style="padding:10px;color:#6b7280;font-size:12px">${t.created_at ? new Date(t.created_at).toLocaleDateString('sr-RS') : '–'}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch (err) {
      body.innerHTML = `<div style="text-align:center;padding:24px;color:#ef4444;font-size:13px">Greška: ${escHtml(err.message)}</div>`;
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
