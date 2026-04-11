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
   SESSION EXPIRY INTERCEPTOR
   Wraps fetch to detect 401 on authenticated requests and auto-logout.
───────────────────────────────────────────────────────────── */
(() => {
  const _origFetch = window.fetch;
  let _sessionExpiredShown = false;
  window.fetch = async function (...args) {
    const response = await _origFetch.apply(this, args);
    if (response.status === 401 && !_sessionExpiredShown) {
      const req = args[1] || {};
      const headers = req.headers || {};
      const hasAuth = (typeof headers === 'object' && !Array.isArray(headers))
        ? (headers.Authorization || headers.authorization || (headers instanceof Headers && headers.has('Authorization')))
        : false;
      if (hasAuth && localStorage.getItem('keyify_token')) {
        _sessionExpiredShown = true;
        ['keyify_token','keyify_name','keyify_role','keyify_rank','keyify_email','keyify_id','keyify_permissions','keyify_avatar'].forEach(k => localStorage.removeItem(k));
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px)';
        overlay.innerHTML = `
          <div style="background:rgba(15,17,35,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px 36px;text-align:center;max-width:380px;font-family:'DM Sans',sans-serif">
            <div style="font-size:36px;margin-bottom:12px">\u26A0\uFE0F</div>
            <h3 style="color:#fff;font-size:18px;font-weight:700;margin:0 0 8px">Sesija je istekla</h3>
            <p style="color:#9090b8;font-size:14px;margin:0 0 20px;line-height:1.5">Vaša sesija više nije važeća. Prijavite se ponovo.</p>
            <button onclick="window.location.href='login.html'" style="background:linear-gradient(135deg,#1d6aff,#5b8fff);color:#fff;border:none;border-radius:10px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer">Prijavi se</button>
          </div>`;
        document.body.appendChild(overlay);
      }
    }
    return response;
  };
})();

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

    /** No-op — translations are baked into static HTML */
    apply() {},
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
      // Normalize API fields to cart format
      const p = { ...product };
      if (!p.name) p.name = p.name_sr || p.name_en || 'Proizvod';
      if (!p.imageUrl && p.image_url) p.imageUrl = p.image_url;
      if (typeof p.price === 'string') p.price = parseFloat(p.price) || 0;
      if (!p.product_id) p.product_id = p.id;
      if (!p.cart_key) {
        const variantToken = p.variant_id || p.variant_label || 'base';
        p.cart_key = `${p.product_id || p.id}::${variantToken}`;
      }

      const items = this._load();
      const idx   = items.findIndex(i => (i.cart_key || i.id) === (p.cart_key || p.id));
      if (idx >= 0) {
        items[idx].qty = (items[idx].qty || 1) + 1;
      } else {
        items.push({ ...p, qty: 1 });
      }
      this._save(items);
      this.updateNavbarText();
      this._renderDrawerItems();
      _renderMiniCartItems();
      this._toast(t('cart.itemAdded', _lang), '✓');
    },

    remove(id) {
      const items = this._load().filter(i => (i.cart_key || i.id) !== id);
      this._save(items);
      this.updateNavbarText();
      this._renderDrawerItems();
      _renderMiniCartItems();
    },

    setQty(id, qty) {
      const items = this._load();
      const idx   = items.findIndex(i => (i.cart_key || i.id) === id);
      if (idx < 0) return;
      if (qty <= 0) { this.remove(id); return; }
      items[idx].qty = qty;
      this._save(items);
      this.updateNavbarText();
      this._renderDrawerItems();
      _renderMiniCartItems();
    },

    clear() {
      this._save([]);
      this.updateNavbarText();
      this._renderDrawerItems();
      _renderMiniCartItems();
    },

    total()  { return this._load().reduce((s, i) => s + i.price * (i.qty || 1), 0); },
    count()  { return this._load().reduce((s, i) => s + (i.qty || 1), 0); },

    /* ── navbar text ── */
    updateNavbarText() {
      const count = this.count();
      const total = this.total();
      const label = count > 0
        ? 'Korpa (' + count + ') \u20AC ' + total.toFixed(2).replace('.', ',')
        : 'Korpa \u20AC 0,00';

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
        const itemKey  = item.cart_key || item.id;
        return `
          <div class="flex items-start gap-3 py-4 border-b border-gray-100 last:border-0" data-item-id="${escAttr(itemKey)}">
            <!-- Icon / Image -->
            <div class="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center"
                 style="background:${item.imageUrl ? 'transparent' : `linear-gradient(135deg,${iconBg},${iconBg}aa)`}">
              ${item.imageUrl
                ? `<img src="${escAttr(item.imageUrl)}" alt="${escAttr(item.name)}" class="w-14 h-14 object-cover"/>`
                : `<span class="text-white font-bold text-lg font-display">${escHtml(item.name.charAt(0))}</span>`}
            </div>
            <!-- Info -->
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-gray-900 text-sm leading-tight truncate">${escHtml(item.name)}${item.variant_label ? ` <span class="text-xs font-normal text-gray-400">(${escHtml(item.variant_label)})</span>` : ''}</p>
              ${item.desc ? `<p class="text-xs text-gray-400 mt-0.5 truncate">${escHtml(item.desc)}</p>` : ''}
              <div class="flex items-center gap-2 mt-2">
                <!-- Qty controls -->
                <div class="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                  <button onclick="KEYIFY.CART.setQty('${escAttr(itemKey)}', ${(item.qty||1)-1})"
                          class="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors text-sm font-bold">−</button>
                  <span class="w-8 text-center text-sm font-semibold text-gray-800">${item.qty||1}</span>
                  <button onclick="KEYIFY.CART.setQty('${escAttr(itemKey)}', ${(item.qty||1)+1})"
                          class="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors text-sm font-bold">+</button>
                </div>
                <span class="text-sm font-bold text-gray-900 ml-auto">€ ${subtotal}</span>
              </div>
            </div>
            <!-- Remove -->
            <button onclick="KEYIFY.CART.remove('${escAttr(itemKey)}')"
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
          color:#fff; font-size:13px; font-weight:600; font-family:'DM Sans',sans-serif;
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

  const MOJIBAKE_REPLACEMENTS = [
    ['â€”', '-'],
    ['â€“', '-'],
    ['â€¢', '•'],
    ['â†’', '→'],
    ['â†', '←'],
    ['â‚¬', '€'],
    ['â„¢', '™'],
    ['âš¡', '⚡'],
    ['Â©', '©'],
    ['Â·', '·'],
    ['Â', ''],
    ['č', 'č'],
    ['Ä‡', 'ć'],
    ['š', 'š'],
    ['ž', 'ž'],
    ['Å½', 'Ž'],
    ['Ä‘', 'đ'],
    ['Ä', 'Đ']
  ];
  const PLAIN_TEXT_REPLACEMENTS = [
    ['Pocetna', 'Početna'],
    ['Ucitavanje', 'Učitavanje'],
    ['pronadjen', 'pronađen'],
    ['Moguce', 'Moguće'],
    ['pocetnu', 'početnu'],
    ['kljuc', 'ključ'],
    ['kljucevi', 'ključevi'],
    ['dobicete', 'dobićete'],
    ['vasu', 'vašu'],
    ['podrsku', 'podršku'],
    ['Dobrodosli', 'Dobrodošli'],
    ['nasi', 'naši'],
    ['nasim', 'našim'],
    ['cekanja', 'čekanja'],
    ['slucaju', 'slučaju'],
    ['zadrzana', 'zadržana'],
    ['Posalji', 'Pošalji'],
    ['Napisite', 'Napišite']
  ];

  function repairMojibake(value) {
    let fixed = String(value || '');
    MOJIBAKE_REPLACEMENTS.forEach(([from, to]) => {
      fixed = fixed.split(from).join(to);
    });
    PLAIN_TEXT_REPLACEMENTS.forEach(([from, to]) => {
      fixed = fixed.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    });
    return fixed;
  }

  function repairVisibleText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('script, style, noscript, textarea')) return NodeFilter.FILTER_REJECT;
        const value = node.nodeValue || '';
        return /[ÂÄÅâ]|Pocetna|Ucitavanje|pronadjen|Moguce|kljuc|kljucevi|dobicete|vasu|podrsku|Dobrodosli|nasi|nasim|cekanja|slucaju|zadrzana|Posalji|Napisite/.test(value)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const fixed = repairMojibake(node.nodeValue);
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
    });

    root.querySelectorAll?.('[placeholder],[title],[aria-label],[alt]').forEach(el => {
      ['placeholder', 'title', 'aria-label', 'alt'].forEach(attr => {
        const current = el.getAttribute(attr);
        if (!current) return;
        const fixed = repairMojibake(current);
        if (fixed !== current) el.setAttribute(attr, fixed);
      });
    });

    const fixedTitle = repairMojibake(document.title || '');
    if (fixedTitle && fixedTitle !== document.title) document.title = fixedTitle;
  }


  /* ─────────────────────────────────────────────────────────
     NAVBAR INJECTION
  ───────────────────────────────────────────────────────── */
  function _injectNavbarExtras() {
    const headerEl        = document.querySelector('header');
    const isMinimalHeader = headerEl?.hasAttribute('data-kf-minimal');

    if (!isMinimalHeader) {
      /* Find the right-side controls container — the div wrapping login + cart + hamburger.
         Use ml-auto to distinguish it from the cart button itself (which also has gap-2). */
      const cartBtnContainer =
        document.querySelector('header .flex.items-center.ml-auto') ||
        document.querySelector('header .flex.items-center.gap-2');

      if (cartBtnContainer && cartBtnContainer.tagName !== 'BUTTON') {
        /* ── 1. LANGUAGE SWITCHER (full header only) ── */
        if (!document.getElementById('kf-lang-switch')) {
          const ls = document.createElement('div');
          ls.id = 'kf-lang-switch';
          ls.className = 'hidden sm:flex items-center gap-0.5';
          ls.style.cssText = 'border:1px solid #e5e7eb; border-radius:10px; padding:3px; background:#fff; transition: background .3s, border-color .3s;';

          ['sr', 'en'].forEach(lang => {
            const btn = document.createElement('button');
            btn.className    = 'kf-lang-btn';
            btn.dataset.lang = lang;
            btn.textContent  = lang.toUpperCase();
            const isActive   = lang === _lang;
            btn.style.cssText = `padding:4px 10px; border-radius:7px; font-size:11px; cursor:pointer; border:none;
              transition:all 0.2s; font-family:inherit;
              background:${isActive ? '#1D6AFF' : 'transparent'};
              color:${isActive ? '#fff' : '#6b7280'};
              font-weight:${isActive ? '700' : '500'};`;
            btn.addEventListener('click', () => LANG.set(lang));
            ls.appendChild(btn);
          });

          /* Insert before the cart button */
          const cartRef = document.getElementById('kf-header-cart-btn');
          if (cartRef && cartRef.parentNode === cartBtnContainer) {
            cartBtnContainer.insertBefore(ls, cartRef);
          } else {
            cartBtnContainer.prepend(ls);
          }
        }

        /* ── 2. THEME TOGGLE (full header only) ── */
        _injectThemeToggle(cartBtnContainer);
      }
    }

    /* ── 3. WIRE CART BUTTON by ID (runs on ALL pages) ── */
    const cartBtn = document.getElementById('kf-header-cart-btn');
    if (cartBtn && !cartBtn.classList.contains('kf-cart-btn')) {
      /* Ensure it has a <span> with .kf-cart-label for updateNavbarText() */
      let span = cartBtn.querySelector('span');
      if (!span) {
        span = document.createElement('span');
        span.textContent = 'Korpa € 0,00';
        cartBtn.appendChild(span);
      }
      span.classList.add('kf-cart-label');
      cartBtn.classList.add('kf-cart-btn');
      cartBtn.style.position = 'relative';

      cartBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _toggleMiniCart();
      });

      /* ── 4. BADGE OVERLAY ── */
      if (!cartBtn.querySelector('.kf-cart-badge')) {
        const badge = document.createElement('span');
        badge.className = 'kf-cart-badge';
        badge.style.cssText = `
          position:absolute; top:-6px; right:-6px;
          background:#ef4444; color:#fff;
          font-size:10px; font-weight:700; min-width:18px; height:18px;
          border-radius:999px; display:none;
          align-items:center; justify-content:center; padding:0 4px;
          border:2px solid #fff; pointer-events:none;`;
        cartBtn.appendChild(badge);
      }
    }
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
           style="width:min(420px,100vw); font-family:'DM Sans',sans-serif;">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id="kf-cart-title" class="font-semibold text-gray-900 text-base" style="font-family:'Outfit',sans-serif;">
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
            Cena uključuje sve poreze i naknade.
          </p>
          <!-- Checkout button -->
          <a href="cart.html"
             class="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-white text-sm font-bold transition-all hover:opacity-90 active:scale-[0.98]"
             style="background:linear-gradient(135deg,#1D6AFF,#A259FF); text-decoration:none;">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" d="M5 13l4 4L19 7"/>
            </svg>
            <span data-i18n="cart.checkout">Pregled korpe</span>
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
     MINI CART POPUP
     A lightweight dropdown that appears below the header cart
     button. Shows current items, total, "Idi na korpu",
     "Nastavi kupovinu", and "You may also like" section.
  ───────────────────────────────────────────────────────── */
  let _miniCartOpen = false;

  function _injectMiniCart() {
    if (document.getElementById('kf-minicart')) return;

    const mc = document.createElement('div');
    mc.id = 'kf-minicart';
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    mc.style.cssText = `
      position:fixed; top:70px; right:16px; z-index:9990;
      width:380px; max-width:calc(100vw - 32px);
      background:${isDark ? '#12121f' : '#fff'}; color:${isDark ? '#e2e8f0' : '#111'};
      border-radius:20px;
      border:1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
      box-shadow:0 20px 60px rgba(0,0,0,${isDark ? '0.5' : '0.15'}), 0 4px 16px rgba(0,0,0,${isDark ? '0.3' : '0.08'});
      opacity:0; transform:translateY(-10px) scale(0.97);
      pointer-events:none;
      transition:opacity 0.25s cubic-bezier(.22,.68,0,1), transform 0.25s cubic-bezier(.22,.68,0,1);
      font-family:'DM Sans',sans-serif;
      overflow:hidden;
    `;

    const cBorder = isDark ? 'rgba(255,255,255,0.08)' : '#f3f4f6';
    const cText = isDark ? '#e2e8f0' : '#111';
    const cMuted = isDark ? '#94a3b8' : '#6b7280';
    const cBtnBg = isDark ? 'rgba(255,255,255,0.08)' : '#f3f4f6';
    const cBtnHover = isDark ? 'rgba(255,255,255,0.15)' : '#e5e7eb';

    mc.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid ${cBorder}">
        <h3 id="kf-mc-title" style="font-family:'Outfit',sans-serif;font-size:15px;font-weight:700;color:${cText};margin:0">
          Korpa
        </h3>
        <button id="kf-mc-close" style="width:28px;height:28px;border:none;background:${cBtnBg};border-radius:8px;cursor:pointer;font-size:13px;color:${cMuted};display:flex;align-items:center;justify-content:center;transition:all 0.15s"
                onmouseover="this.style.background='${cBtnHover}'" onmouseout="this.style.background='${cBtnBg}'">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Items list -->
      <div id="kf-mc-items" style="max-height:240px;overflow-y:auto;padding:8px 16px;scrollbar-width:thin;scrollbar-color:${cBorder} transparent"></div>

      <!-- Empty state -->
      <div id="kf-mc-empty" style="display:none;text-align:center;padding:28px 16px">
        <svg style="width:48px;height:48px;color:#d1d5db;margin:0 auto 12px" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
        </svg>
        <p style="font-size:14px;font-weight:600;color:${cMuted};margin:0 0 4px">Korpa je prazna</p>
        <p style="font-size:12px;color:#9ca3af;margin:0">Dodajte proizvode da biste nastavili</p>
      </div>

      <!-- Footer: total + buttons -->
      <div id="kf-mc-footer" style="border-top:1px solid ${cBorder};padding:14px 20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:13px;color:${cMuted};font-weight:500">Ukupno</span>
          <span id="kf-mc-total" style="font-size:16px;font-weight:800;background:linear-gradient(135deg,#1D6AFF,#A259FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent">€ 0,00</span>
        </div>
        <a href="cart.html" id="kf-mc-goto-cart"
           style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border-radius:14px;background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;font-size:13px;font-weight:700;text-decoration:none;transition:opacity 0.15s;box-shadow:0 6px 24px rgba(29,106,255,0.3)"
           onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>
          Idi na korpu
        </a>
        <button id="kf-mc-continue"
                style="width:100%;padding:10px;margin-top:8px;border:none;background:transparent;color:${cMuted};font-size:13px;font-weight:600;cursor:pointer;border-radius:10px;transition:all 0.15s"
                onmouseover="this.style.background='${cBtnBg}';this.style.color='${cText}'" onmouseout="this.style.background='transparent';this.style.color='${cMuted}'">
          Nastavi kupovinu
        </button>
      </div>

      <!-- You may also like -->
      <div id="kf-mc-related" style="display:none;border-top:1px solid ${cBorder};padding:14px 20px">
        <p style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 10px">Mozda vas zanima</p>
        <div id="kf-mc-related-grid" style="display:flex;gap:10px"></div>
      </div>
    `;

    document.body.appendChild(mc);

    /* Close button */
    mc.querySelector('#kf-mc-close').addEventListener('click', (e) => {
      e.stopPropagation();
      _closeMiniCart();
    });

    /* Continue shopping */
    mc.querySelector('#kf-mc-continue').addEventListener('click', (e) => {
      e.stopPropagation();
      _closeMiniCart();
    });

    /* Click outside to close */
    document.addEventListener('click', (e) => {
      if (!_miniCartOpen) return;
      const mc = document.getElementById('kf-minicart');
      const cartBtn = document.querySelector('.kf-cart-btn');
      if (mc && !mc.contains(e.target) && cartBtn && !cartBtn.contains(e.target)) {
        _closeMiniCart();
      }
    });
  }

  function _toggleMiniCart() {
    _miniCartOpen ? _closeMiniCart() : _openMiniCart();
  }

  function _openMiniCart() {
    let mc  = document.getElementById('kf-minicart');
    const btn = document.getElementById('kf-header-cart-btn');

    /* Safety: re-inject if element was removed or never created */
    if (!mc) {
      _injectMiniCart();
      mc = document.getElementById('kf-minicart');
      if (!mc) return;
    }

    /* Position below the cart button */
    if (btn) {
      const rect = btn.getBoundingClientRect();
      mc.style.top   = (rect.bottom + 8) + 'px';
      mc.style.right  = Math.max(8, window.innerWidth - rect.right) + 'px';
      mc.style.left  = 'auto';
    }

    try { _renderMiniCartItems(); } catch (e) { console.warn('[minicart] render error:', e); }
    try { _loadMiniCartRelated(); } catch (e) { /* non-critical */ }
    mc.style.opacity = '1';
    mc.style.transform = 'translateY(0) scale(1)';
    mc.style.pointerEvents = 'auto';
    _miniCartOpen = true;
  }

  function _closeMiniCart() {
    const mc = document.getElementById('kf-minicart');
    if (!mc) return;
    mc.style.opacity = '0';
    mc.style.transform = 'translateY(-10px) scale(0.97)';
    mc.style.pointerEvents = 'none';
    _miniCartOpen = false;
  }

  function _renderMiniCartItems() {
    const items     = CART._load();
    const container = document.getElementById('kf-mc-items');
    const emptyEl   = document.getElementById('kf-mc-empty');
    const footerEl  = document.getElementById('kf-mc-footer');
    const titleEl   = document.getElementById('kf-mc-title');
    if (!container) return;

    const count = CART.count();
    if (titleEl) titleEl.textContent = count > 0 ? `Korpa (${count})` : 'Korpa';

    if (!items.length) {
      container.style.display = 'none';
      emptyEl.style.display = 'block';
      footerEl.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    emptyEl.style.display = 'none';
    footerEl.style.display = 'block';

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const mcText = isDark ? '#e2e8f0' : '#111';
    const mcMuted = isDark ? '#94a3b8' : '#6b7280';
    const mcBorder = isDark ? 'rgba(255,255,255,0.06)' : '#f9fafb';
    const mcQtyBorder = isDark ? 'rgba(255,255,255,0.12)' : '#e5e7eb';
    const mcBtnHover = isDark ? 'rgba(255,255,255,0.08)' : '#f3f4f6';

    container.innerHTML = items.map(item => {
      const qty = item.qty || 1;
      const subtotal = (item.price * qty).toFixed(2).replace('.', ',');
      const iconBg = item.color || '#1D6AFF';
      const itemKey = item.cart_key || item.id;
      const variantTag = item.variant_label ? `<span style="font-size:10px;color:${mcMuted};font-weight:500;margin-left:4px">(${escHtml(item.variant_label)})</span>` : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ${mcBorder}" data-mc-id="${escAttr(itemKey)}">
          <div style="flex-shrink:0;width:44px;height:44px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${item.imageUrl ? 'linear-gradient(145deg,#0f0f1a,#1a1a2e)' : `linear-gradient(135deg,${iconBg},${iconBg}aa)`}">
            ${item.imageUrl
              ? `<img src="${escAttr(item.imageUrl)}" alt="${escAttr(item.name)}" style="width:44px;height:44px;object-fit:cover;border-radius:10px"/>`
              : `<span style="color:#fff;font-weight:700;font-size:16px;font-family:'Outfit',sans-serif">${escHtml(item.name.charAt(0))}</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <p style="font-size:13px;font-weight:600;color:${mcText};margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.name)}${variantTag}</p>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
              <div style="display:inline-flex;align-items:center;border:1px solid ${mcQtyBorder};border-radius:8px;overflow:hidden">
                <button onclick="event.stopPropagation();KEYIFY.CART.setQty('${escAttr(itemKey)}',${qty - 1})"
                        style="width:24px;height:24px;border:none;background:transparent;color:${mcMuted};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;transition:background 0.15s"
                        onmouseover="this.style.background='${mcBtnHover}'" onmouseout="this.style.background='transparent'">−</button>
                <span style="width:26px;text-align:center;font-size:12px;font-weight:600;color:${mcText};user-select:none">${qty}</span>
                <button onclick="event.stopPropagation();KEYIFY.CART.setQty('${escAttr(itemKey)}',${qty + 1})"
                        style="width:24px;height:24px;border:none;background:transparent;color:${mcMuted};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;transition:background 0.15s"
                        onmouseover="this.style.background='${mcBtnHover}'" onmouseout="this.style.background='transparent'">+</button>
              </div>
              <span style="font-size:12px;font-weight:700;color:${mcText}">€ ${subtotal}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;flex-shrink:0">
            <button onclick="event.stopPropagation();KEYIFY.CART.remove('${escAttr(itemKey)}')"
                    style="width:24px;height:24px;border:none;background:transparent;color:#d1d5db;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:all 0.15s"
                    onmouseover="this.style.background='#fef2f2';this.style.color='#ef4444'" onmouseout="this.style.background='transparent';this.style.color='#d1d5db'">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');

    const totalEl = document.getElementById('kf-mc-total');
    if (totalEl) totalEl.textContent = `€ ${CART.total().toFixed(2).replace('.', ',')}`;
  }

  async function _loadMiniCartRelated() {
    const relatedSection = document.getElementById('kf-mc-related');
    const relatedGrid    = document.getElementById('kf-mc-related-grid');
    if (!relatedSection || !relatedGrid) return;

    const API_BASE = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
    try {
      const res = await fetch(`${API_BASE}/products`);
      if (!res.ok) return;
      const products = await res.json();
      const cartIds  = new Set(CART._load().map(i => i.id));

      const related = products.filter(p => {
        const pid = p.id || (p.name_sr || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return !cartIds.has(pid) && !cartIds.has(p.id);
      }).slice(0, 2);

      if (!related.length) { relatedSection.style.display = 'none'; return; }

      relatedSection.style.display = 'block';
      const lang = _lang;
      relatedGrid.innerHTML = related.map(p => {
        const name  = (lang === 'en' && p.name_en) ? p.name_en : (p.name_sr || p.name || '');
        const price = parseFloat(p.price) || 0;
        const color = p.badge_color || '#1D6AFF';
        const dataP = escAttr(JSON.stringify({
          id: p.id, name: name, price: price,
          desc: p.description_sr || p.description || '',
          color: color, imageUrl: p.image_url || null
        }));
        return `
          <div style="flex:1;background:#f9fafb;border-radius:12px;padding:10px;text-align:center;border:1px solid #f0f0f4;transition:all 0.2s;cursor:pointer"
               onmouseover="this.style.borderColor='#1D6AFF';this.style.transform='translateY(-2px)'"
               onmouseout="this.style.borderColor='#f0f0f4';this.style.transform=''">
            <div style="width:40px;height:40px;border-radius:10px;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;background:${p.image_url ? 'linear-gradient(145deg,#0f0f1a,#1a1a2e)' : `linear-gradient(135deg,${color},${color}88)`}">
              ${p.image_url
                ? `<img src="${escAttr(p.image_url)}" alt="${escAttr(name)}" style="width:32px;height:32px;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))"/>`
                : `<span style="color:#fff;font-weight:700;font-size:14px;font-family:'Outfit',sans-serif">${escHtml(name.charAt(0))}</span>`}
            </div>
            <p style="font-size:11px;font-weight:600;color:#374151;margin:0 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</p>
            <p style="font-size:12px;font-weight:700;color:#1D6AFF;margin:0 0 6px">€ ${price.toFixed(2).replace('.', ',')}</p>
            <button onclick="event.stopPropagation();try{KEYIFY.CART.add(JSON.parse(this.dataset.p))}catch(e){}"
                    data-p='${dataP}'
                    style="width:100%;padding:6px;border:none;border-radius:8px;background:#1D6AFF;color:#fff;font-size:10px;font-weight:700;cursor:pointer;transition:opacity 0.15s"
                    onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
              + Dodaj
            </button>
          </div>`;
      }).join('');
    } catch { relatedSection.style.display = 'none'; }
  }


  /* ─────────────────────────────────────────────────────────
     WIRE ADD-TO-CART BUTTONS
     Scans for buttons containing "Dodaj u korpu" or "Kupi Sada"
     and attaches cart logic + data-attribute markup.
  ───────────────────────────────────────────────────────── */
  function _wireProductButtons() {
    document.querySelectorAll('button, a').forEach(btn => {
      /* Skip already-wired buttons and non-cart buttons */
      if (btn.dataset.addToCart !== undefined) return;
      if (btn.dataset.kveButtonFunction === 'hyperlink') return;

      const txt = btn.textContent.trim();
      const isAddBtn = txt === 'Dodaj u korpu'
        || txt === 'Kupi Sada'
        || txt === 'Add to Cart'
        || txt === 'Buy Now'
        || btn.innerHTML.includes('Dodaj u korpu')
        || btn.innerHTML.includes('Kupi Sada')
        || btn.dataset.kfAtc === '1';

      if (!isAddBtn) return;

      /* Mark as cart button */
      btn.dataset.addToCart = '1';

      btn.addEventListener('click', function(e) {
        if (btn.tagName === 'A') e.preventDefault();
        e.stopPropagation();
        const product = _extractProduct(btn);
        if (!product) return;
        if (btn._loading) return;

        /* Save original state */
        const originalHTML = btn.innerHTML;
        const originalCssText = btn.style.cssText;
        btn._loading = true;

        /* Show success feedback */
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg> ${t('btn.added', _lang)}`;
        btn.style.cssText = originalCssText + ';background:#059669 !important;';
        btn.disabled = true;

        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.style.cssText = originalCssText;
          btn.disabled = false;
          btn._loading = false;
        }, 800);

        CART.add(product);
      });
    });
  }


  /* ─────────────────────────────────────────────────────────
     EXTRACT PRODUCT DATA FROM A CARD DOM NODE
  ───────────────────────────────────────────────────────── */
  function _extractProduct(btn) {
    /* ── Try data-product JSON first (set by category page renderers) ── */
    const dp = btn.getAttribute('data-product');
    if (dp) {
      try {
        const obj = JSON.parse(dp.replace(/&#39;/g, "'"));
        if (obj && obj.name && obj.price) {
          return {
            id: obj.id || obj.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
            product_id: obj.product_id || obj.id || null,
            cart_key: obj.cart_key || null,
            name: obj.name,
            price: parseFloat(obj.price),
            desc: obj.desc || '',
            color: obj.color || '#1D6AFF',
            imageUrl: obj.imageUrl || null,
            category: obj.category || null,
            variant_id: obj.variant_id || null,
            variant_label: obj.variant_label || null,
            original_price: obj.original_price ?? null,
          };
        }
      } catch {}
    }

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
    ['keyify_token','keyify_name','keyify_role','keyify_rank','keyify_email','keyify_id','keyify_permissions','keyify_avatar'].forEach(k => localStorage.removeItem(k));
    window.location.href = 'index.html';
  }

  function _updateAccountNavbar() {
    const token = localStorage.getItem('keyify_token');
    const name  = localStorage.getItem('keyify_name');
    const email = localStorage.getItem('keyify_email') || '';
    const role  = localStorage.getItem('keyify_role');
    const rank  = (localStorage.getItem('keyify_rank') || role || 'user').toLowerCase();

    const accountLink = document.querySelector('header a[href="login.html"]');
    if (!accountLink || !token || !name) return;

    const API_BASE  = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
    const firstName = escHtml(name.split(' ')[0]);
    const initials  = name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

    /* ── Permissions (must be defined before use) ── */
    const perms          = JSON.parse(localStorage.getItem('keyify_permissions') || '{}');
    const isSuperAdmin   = role === 'admin' && (rank === 'super_admin' || Object.keys(perms).length === 0);
    const isSupportAgent = role === 'admin' && (isSuperAdmin || rank === 'support' || perms.can_manage_support === true);
    const canSQL         = role === 'admin' && (isSuperAdmin || perms.can_execute_sql === true);
    const canEditor      = role === 'admin' && (isSuperAdmin || perms.can_use_editor === true);
    const rankMeta       = {
      super_admin: { label: 'Super Admin' },
      admin:       { label: 'Admin' },
      moderator:   { label: 'Moderator' },
      support:     { label: 'Podrška' },
      user:        { label: 'Korisnik' },
    };
    const activeRank = rankMeta[rank] || rankMeta.user;

    /* ── Inject one-time styles ── */
    if (!document.getElementById('kf-dd-style')) {
      const st = document.createElement('style');
      st.id = 'kf-dd-style';
      st.textContent = `
        @keyframes kf-dd-in{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
        #kf-dd-trigger{transition:all .2s ease!important}
        #kf-dd-trigger:hover{background:var(--kf-dd-hover)!important;border-color:var(--kf-dd-border)!important;transform:translateY(-1px)!important}
        #kf-dd-trigger:active{transform:scale(.98)!important}
        #kf-dd-panel .kf-item{border-radius:8px;transition:all .15s ease!important;position:relative;overflow:hidden;font-family:'DM Sans','Outfit',system-ui,sans-serif}
        #kf-dd-panel a.kf-item:hover,#kf-dd-panel button.kf-item:hover{background:var(--kf-dd-hover)!important}
        #kf-dd-panel .kf-item .kf-icon-wrap{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s ease;background:transparent}
        #kf-dd-panel .kf-item .kf-icon-wrap svg{width:16px;height:16px;stroke:var(--kf-dd-icon);stroke-width:1.75;fill:none}
        #kf-dd-panel .kf-item:hover .kf-icon-wrap svg{stroke:var(--kf-dd-icon-hover)}
        #kf-dd-panel .kf-item-danger:hover{background:rgba(239,68,68,0.06)!important}
        #kf-dd-panel .kf-item-danger .kf-icon-wrap svg{stroke:#ef4444}
        #kf-dd-panel .kf-item-danger:hover .kf-icon-wrap svg{stroke:#dc2626}
        #kf-dd-panel::-webkit-scrollbar{width:3px}
        #kf-dd-panel::-webkit-scrollbar-thumb{background:var(--kf-dd-border);border-radius:3px}
        .kf-dd-section-label{font-size:11px;font-weight:600;color:var(--kf-dd-label);text-transform:uppercase;letter-spacing:.06em;padding:8px 14px 4px;font-family:'DM Sans','Outfit',system-ui,sans-serif}
        .kf-theme-seg{display:flex;padding:2px;border-radius:8px;background:var(--kf-seg-bg);border:1px solid var(--kf-seg-border)}
        .kf-theme-opt{flex:1;padding:6px 0;border-radius:6px;border:none;background:transparent;font-size:11px;font-weight:500;color:var(--kf-dd-label);cursor:pointer;transition:all .15s ease!important;font-family:'DM Sans','Outfit',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:5px}
        .kf-theme-opt svg{width:13px;height:13px;stroke:currentColor;stroke-width:1.75;fill:none}
        .kf-theme-opt[data-active="true"]{background:var(--kf-seg-active-bg);color:var(--kf-seg-active-color);font-weight:600;box-shadow:var(--kf-seg-active-shadow)}
        .kf-theme-opt:hover:not([data-active="true"]){color:var(--kf-dd-item)}`;
      document.head.appendChild(st);
    }

    /* ── SVG icon helpers (Lucide-style, 24x24 viewBox, stroke-only) ── */
    const _ico = {
      package:  '<svg viewBox="0 0 24 24"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      user:     '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      gift:     '<svg viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5" rx="1"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>',
      tag:      '<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
      layout:   '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
      database: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
      palette:  '<svg viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
      inbox:    '<svg viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>',
      logout:   '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
      sun:      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
      moon:     '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
      monitor:  '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    };

    /* ── Wrapper ── */
    const wrapper = document.createElement('div');
    wrapper.id = 'keyify-user-menu';
    wrapper.style.cssText = 'position:relative;display:inline-flex;align-items:center;';

    /* ── Trigger button ── */
    const btn = document.createElement('button');
    btn.id = 'kf-dd-trigger';
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:5px 10px 5px 5px;border:1px solid var(--kf-dd-border);border-radius:10px;background:transparent;cursor:pointer;font-family:inherit;transition:all .15s;';
    const avatarUrl = localStorage.getItem('keyify_avatar') || '';
    const avatarBadge = isSupportAgent
      ? `<span id="kf-nav-dot" style="display:none;position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;background:#ef4444;color:#fff;font-size:7px;font-weight:700;align-items:center;justify-content:center;border:2px solid var(--kf-dd-bg);z-index:1"></span>`
      : '';
    const avatarContent = avatarUrl
      ? `<img src="${escHtml(avatarUrl)}" alt="" style="width:28px;height:28px;border-radius:8px;object-fit:cover"/>`
      : `<span style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6)">${initials}</span>`;
    btn.innerHTML = `
      <span style="position:relative;display:inline-flex;flex-shrink:0">
        ${avatarContent}
        ${avatarBadge}
      </span>
      <span style="font-size:13px;font-weight:600;color:var(--kf-dd-name);max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${firstName}</span>
      <svg id="kf-dd-chevron" style="width:12px;height:12px;color:var(--kf-dd-label);transition:transform .2s;flex-shrink:0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
      </svg>`;

    /* ── Dropdown panel ── */
    const panel = document.createElement('div');
    panel.id = 'kf-dd-panel';
    panel.style.cssText = 'display:none;position:absolute;top:calc(100% + 8px);right:0;width:260px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);overflow-y:auto;background:var(--kf-dd-bg);border:1px solid var(--kf-dd-border);border-radius:12px;box-shadow:var(--kf-dd-shadow);z-index:9999;animation:kf-dd-in .18s ease-out;backdrop-filter:var(--kf-dd-blur);-webkit-backdrop-filter:var(--kf-dd-blur);';

    /* ── Build menu item helper ── */
    const _menuItem = (icon, label, opts = {}) => {
      const tag = opts.href ? 'a' : 'button';
      const hrefAttr = opts.href ? ` href="${opts.href}"` : '';
      const onclickAttr = opts.onclick ? ` onclick="${opts.onclick}"` : '';
      const idAttr = opts.id ? ` id="${opts.id}"` : '';
      const extraCls = opts.danger ? ' kf-item-danger' : '';
      const colorStyle = opts.danger ? 'color:#ef4444;' : 'color:var(--kf-dd-item);';
      const badgeHtml = opts.badge || '';
      return `<${tag}${hrefAttr}${onclickAttr}${idAttr} class="kf-item${extraCls}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:13px;font-weight:500;${colorStyle}background:transparent;border:none;width:100%;cursor:pointer;border-radius:8px;text-align:left;text-decoration:none;">
        <span class="kf-icon-wrap">${icon}</span><span style="flex:1">${label}</span>${badgeHtml}
      </${tag}>`;
    };

    const sqlItem = canSQL ? _menuItem(_ico.database, 'SQL Editor', { href: 'admin.html', onclick: "localStorage.setItem('kf_admin_goto','sql')" }) : '';
    const editorItem = canEditor ? _menuItem(_ico.palette, 'Live Editor', { href: '#', id: 'kf-editor-toggle' }) : '';

    const adminSection = role === 'admin' ? `
      <div class="kf-dd-section-label">Admin</div>
      <div style="padding:0 6px 4px">
        ${_menuItem(_ico.layout, 'Admin Panel', { href: 'admin.html' })}
        ${sqlItem}
        ${editorItem}
        ${isSupportAgent ? _menuItem(_ico.inbox, 'Support Inbox', { href: 'support-inbox.html', badge: '<span id="kf-inbox-count" style="display:none;margin-left:auto;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center;padding:0 4px"></span>' }) : ''}
      </div>
      <div style="height:1px;background:var(--kf-dd-divider);margin:2px 14px"></div>` : '';

    const _curPref = localStorage.getItem('keyify_theme') || 'light';
    const _segBtn = (theme, icon, label) => {
      const active = theme === _curPref;
      return `<button class="kf-theme-opt" data-theme="${theme}" data-active="${active}">${icon} ${label}</button>`;
    };

    panel.innerHTML = `
      <div style="padding:16px 16px 14px;border-bottom:1px solid var(--kf-dd-divider)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="flex-shrink:0">${avatarContent}</span>
          <div style="min-width:0;flex:1">
            <div style="font-size:13px;font-weight:700;color:var(--kf-dd-name);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'DM Sans','Outfit',sans-serif">${escHtml(name)}</div>
            <div style="font-size:11px;color:var(--kf-dd-label);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(email)}</div>
          </div>
        </div>
        ${(role === 'admin' || rank !== 'user') ? `<div style="display:inline-flex;align-items:center;gap:4px;margin-top:10px;padding:3px 10px;border-radius:6px;background:var(--kf-dd-hover);font-size:10px;font-weight:600;color:var(--kf-dd-label);text-transform:uppercase;letter-spacing:.05em">${escHtml(activeRank.label)}</div>` : ''}
      </div>
      <div style="padding:4px 6px">
        ${_menuItem(_ico.package, 'Narudžbe', { id: 'kf-orders-btn' })}
        ${_menuItem(_ico.user, 'Moj profil', { href: 'profile.html' })}
        ${_menuItem(_ico.gift, 'Referral Program', { href: 'profile.html#referral' })}
        ${_menuItem(_ico.tag, 'Moji kuponi', { href: 'profile.html#coupons' })}
      </div>
      <div style="height:1px;background:var(--kf-dd-divider);margin:2px 14px"></div>
      ${adminSection}
      <div style="padding:6px 14px 8px">
        <div class="kf-dd-section-label" style="padding:2px 0 6px">Tema</div>
        <div class="kf-theme-seg">
          ${_segBtn('light', _ico.sun, 'Light')}
          ${_segBtn('dark', _ico.moon, 'Dark')}
          ${_segBtn('system', _ico.monitor, 'Auto')}
        </div>
      </div>
      <div style="height:1px;background:var(--kf-dd-divider);margin:0 14px"></div>
      <div style="padding:4px 6px 6px">
        ${_menuItem(_ico.logout, 'Odjava', { id: 'kf-logout-btn', danger: true })}
      </div>`;

    /* ── Toggle logic ── */
    let _open = false;
    function _openDD() {
      _open = true;
      panel.style.display = 'block';
      document.getElementById('kf-dd-chevron').style.transform = 'rotate(180deg)';
      /* Auto-reposition if panel overflows viewport */
      requestAnimationFrame(() => {
        const r = panel.getBoundingClientRect();
        if (r.right > window.innerWidth) panel.style.right = '0';
        if (r.left < 0) { panel.style.right = 'auto'; panel.style.left = -wrapper.getBoundingClientRect().left + 12 + 'px'; }
        if (r.bottom > window.innerHeight) panel.style.maxHeight = (window.innerHeight - r.top - 12) + 'px';
      });
    }
    function _closeDD() { _open = false; panel.style.display = 'none'; panel.style.maxHeight = 'calc(100vh - 80px)'; panel.style.left = ''; panel.style.right = '0'; const ch = document.getElementById('kf-dd-chevron'); if (ch) ch.style.transform = ''; }
    btn.addEventListener('click', e => { e.stopPropagation(); _open ? _closeDD() : _openDD(); });
    document.addEventListener('click', () => { if (_open) _closeDD(); });
    panel.addEventListener('click', e => e.stopPropagation());

    /* ── Theme buttons in dropdown ── */
    panel.querySelectorAll('.kf-theme-opt').forEach(b => {
      b.addEventListener('click', () => _applyTheme(b.dataset.theme));
    });

    /* ── Orders button ── */
    panel.querySelector('#kf-orders-btn').addEventListener('click', () => {
      _closeDD();
      _openOrdersModal(token, API_BASE);
    });

    /* ── Live Editor toggle ── */
    const editorBtn = panel.querySelector('#kf-editor-toggle');
    if (editorBtn) {
      const editorActive = localStorage.getItem('keyify_editor_active') === 'true';
      const _editorBadge = '<span style="margin-left:auto;font-size:10px;font-weight:600;color:#10b981;background:rgba(16,185,129,0.1);padding:2px 7px;border-radius:5px">ON</span>';
      if (editorActive) {
        const labelEl = editorBtn.querySelector('span[style*="flex:1"]');
        if (labelEl) labelEl.innerHTML = 'Live Editor ' + _editorBadge;
      }
      editorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isOn = localStorage.getItem('keyify_editor_active') === 'true';
        if (isOn) localStorage.removeItem('keyify_editor_active');
        else localStorage.setItem('keyify_editor_active', 'true');
        _closeDD();
        window.location.reload();
      });
    }

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
          <h3 style="font-family:'Outfit',sans-serif;font-size:16px;font-weight:700;color:#111;margin:0">📦 Moje narudžbe</h3>
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
      const statusBadge = (status) => {
        const s = String(status || '').toLowerCase();
        if (s === 'completed') return '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:9px;font-size:11px;font-weight:600">Plaćeno</span>';
        if (['failed', 'rejected', 'refunded'].includes(s)) return '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:9px;font-size:11px;font-weight:600">Neuspešno</span>';
        return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9px;font-size:11px;font-weight:600">Na čekanju</span>';
      };
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
      Array.from(body.querySelectorAll('tbody tr')).forEach((row, index) => {
        const statusCell = row.children[2];
        if (statusCell) statusCell.innerHTML = statusBadge(data[index]?.status);
      });
    } catch (err) {
      body.innerHTML = `<div style="text-align:center;padding:24px;color:#ef4444;font-size:13px">Greška: ${escHtml(err.message)}</div>`;
    }
  }


  /* ─────────────────────────────────────────────────────────
     DUAL-THEME SYSTEM
     Injects CSS custom properties for Light ↔ Dark mode.
     Controls: data-theme="dark" on <html> + Tailwind .dark class.
     Stored in: localStorage['keyify_theme'] ('light' | 'dark')
  ───────────────────────────────────────────────────────── */
  function _injectThemeVars() {
    if (document.getElementById('kf-theme-vars')) return;
    const s = document.createElement('style');
    s.id = 'kf-theme-vars';
    s.textContent = `
      /* ── LIGHT MODE (default) ── */
      :root {
        /* Chat widget */
        --kfy-win-shadow:      0 32px 80px rgba(0,0,0,.18),0 12px 32px rgba(0,0,0,.1);
        --kfy-win-ring:        rgba(0,0,0,0.06);
        --kfy-header-bg:       #ffffff;
        --kfy-header-border:   rgba(0,0,0,0.06);
        --kfy-tab-bg:          rgba(0,0,0,0.04);
        --kfy-tab-color:       #6b7280;
        --kfy-tab-hover:       #374151;
        --kfy-tab-active-color:#111827;
        --kfy-tab-active-bg:   #ffffff;
        --kfy-agent-bg:        #ffffff;
        --kfy-agent-border:    rgba(0,0,0,0.05);
        --kfy-agent-title:     #111827;
        --kfy-avatar-border:   #ffffff;
        --kfy-status-text:     #6b7280;
        --kfy-close-bg:        rgba(0,0,0,0.04);
        --kfy-close-color:     #9ca3af;
        --kfy-close-hover-bg:  rgba(0,0,0,0.08);
        --kfy-close-hover-color:#374151;
        --kfy-body-bg:         #f4f5f7;
        --kfy-scrollbar:       rgba(0,0,0,0.1);
        --kfy-scrollbar-hover: rgba(0,0,0,0.18);
        --kfy-bubble-bot-bg:   #ffffff;
        --kfy-bubble-bot-color:#1e293b;
        --kfy-bubble-bot-bdr:  rgba(0,0,0,0.05);
        --kfy-bubble-bot-shad: 0 1px 3px rgba(0,0,0,.04);
        --kfy-system-card-bg:  rgba(29,106,255,0.04);
        --kfy-system-card-bdr: rgba(29,106,255,0.12);
        --kfy-declined-bg:     rgba(239,68,68,0.04);
        --kfy-email-card-bg:   #ffffff;
        --kfy-email-card-bdr:  rgba(0,0,0,0.06);
        --kfy-email-card-shad: 0 2px 8px rgba(0,0,0,.04);
        --kfy-email-h4:        #111827;
        --kfy-email-p:         #6b7280;
        --kfy-inp-bg:          #f9fafb;
        --kfy-inp-border:      #e5e7eb;
        --kfy-inp-color:       #111827;
        --kfy-inp-ph:          #9ca3af;
        --kfy-inp-focus-bg:    #ffffff;
        --kfy-row-bg:          #ffffff;
        --kfy-row-border:      rgba(0,0,0,0.05);
        --kfy-closed-bg:       rgba(245,158,11,0.06);
        --kfy-closed-color:    #92400e;
        --kfy-closed-bdr:      rgba(245,158,11,0.15);
        --kfy-articles-bg:     #f4f5f7;
        --kfy-articles-color:  #9ca3af;
        --kfy-articles-icon-bg:rgba(0,0,0,0.04);
        --kfy-articles-icon-color:#9ca3af;
        --kfy-queue-bg:        linear-gradient(135deg,rgba(245,158,11,0.08),rgba(251,191,36,0.05));
        --kfy-queue-bdr:       rgba(245,158,11,0.12);
        --kfy-queue-color:     #d97706;
        /* KB articles */
        --kfy-kb-cat-bg:       rgba(0,0,0,0.04);
        --kfy-kb-cat-color:    #6b7280;
        --kfy-kb-cat-hover:    #374151;
        --kfy-kb-cat-active-bg:rgba(29,106,255,0.1);
        --kfy-kb-cat-active-color:#1D6AFF;
        --kfy-kb-card-bg:      #ffffff;
        --kfy-kb-card-bdr:     rgba(0,0,0,0.05);
        --kfy-kb-card-shad:    0 1px 3px rgba(0,0,0,.03);
        --kfy-kb-card-hover-bdr:rgba(29,106,255,0.25);
        --kfy-kb-card-excerpt: #6b7280;
        --kfy-kb-tag-bg:       rgba(29,106,255,0.06);
        --kfy-kb-tag-color:    #1D6AFF;
        --kfy-kb-skel-from:    rgba(0,0,0,0.06);
        --kfy-kb-skel-to:      rgba(0,0,0,0.02);
        /* Gate cards */
        --kfy-gate-card-bg:    linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.9));
        --kfy-gate-card-border:rgba(148,163,184,0.18);
        --kfy-gate-card-title: #0f172a;
        --kfy-gate-card-sub:   #64748b;
        --kfy-gate-card-shadow:0 4px 16px rgba(15,23,42,0.05);
        --kfy-gate-card-hover-border:rgba(29,106,255,0.35);
        --kfy-gate-card-hover-shadow:0 12px 32px rgba(29,106,255,0.14);
        --kfy-gate-label-color:#64748b;
        --kfy-gate-select-scheme:light;
        /* Dropdown */
        --kf-dd-bg:            #ffffff;
        --kf-dd-border:        rgba(0,0,0,0.08);
        --kf-dd-shadow:        0 4px 6px -1px rgba(0,0,0,0.05),0 10px 30px -5px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.03);
        --kf-dd-blur:          blur(20px);
        --kf-dd-name:          #111827;
        --kf-dd-label:         #9ca3af;
        --kf-dd-item:          #374151;
        --kf-dd-icon:          #9ca3af;
        --kf-dd-icon-hover:    #374151;
        --kf-dd-hover:         #f5f5f5;
        --kf-dd-divider:       rgba(0,0,0,0.06);
        /* Segmented theme control */
        --kf-seg-bg:           #f5f5f5;
        --kf-seg-border:       rgba(0,0,0,0.06);
        --kf-seg-active-bg:    #ffffff;
        --kf-seg-active-color: #111827;
        --kf-seg-active-shadow:0 1px 3px rgba(0,0,0,0.08);
        /* Theme toggle button */
        --kf-theme-btn-bg:     #ffffff;
        --kf-theme-btn-border: #e5e7eb;
        --kf-theme-btn-hover:  #f5f5f5;
      }

      /* ── DARK MODE ── */
      [data-theme="dark"] {
        /* Chat widget */
        --kfy-win-shadow:      0 32px 80px rgba(0,0,0,.55),0 12px 32px rgba(0,0,0,.35);
        --kfy-win-ring:        rgba(255,255,255,0.06);
        --kfy-header-bg:       rgba(10,12,28,0.98);
        --kfy-header-border:   rgba(255,255,255,0.07);
        --kfy-tab-bg:          rgba(255,255,255,0.05);
        --kfy-tab-color:       rgba(255,255,255,0.4);
        --kfy-tab-hover:       rgba(255,255,255,0.65);
        --kfy-tab-active-color:#e0e0f8;
        --kfy-tab-active-bg:   rgba(255,255,255,0.08);
        --kfy-agent-bg:        rgba(10,12,28,0.98);
        --kfy-agent-border:    rgba(255,255,255,0.06);
        --kfy-agent-title:     #e0e0f8;
        --kfy-avatar-border:   rgba(255,255,255,0.1);
        --kfy-status-text:     rgba(255,255,255,0.4);
        --kfy-close-bg:        rgba(255,255,255,0.06);
        --kfy-close-color:     rgba(255,255,255,0.35);
        --kfy-close-hover-bg:  rgba(255,255,255,0.1);
        --kfy-close-hover-color:rgba(255,255,255,0.7);
        --kfy-body-bg:         rgba(6,8,18,0.95);
        --kfy-scrollbar:       rgba(99,102,241,0.2);
        --kfy-scrollbar-hover: rgba(99,102,241,0.35);
        --kfy-bubble-bot-bg:   rgba(25,30,60,0.9);
        --kfy-bubble-bot-color:#d0d0f0;
        --kfy-bubble-bot-bdr:  rgba(99,102,241,0.12);
        --kfy-bubble-bot-shad: 0 2px 8px rgba(0,0,0,.25);
        --kfy-system-card-bg:  rgba(29,106,255,0.08);
        --kfy-system-card-bdr: rgba(29,106,255,0.18);
        --kfy-declined-bg:     rgba(239,68,68,0.08);
        --kfy-email-card-bg:   rgba(20,24,48,0.9);
        --kfy-email-card-bdr:  rgba(99,102,241,0.15);
        --kfy-email-card-shad: 0 4px 20px rgba(0,0,0,0.25);
        --kfy-email-h4:        #e0e0f8;
        --kfy-email-p:         rgba(255,255,255,0.45);
        --kfy-inp-bg:          rgba(255,255,255,0.04);
        --kfy-inp-border:      rgba(99,102,241,0.22);
        --kfy-inp-color:       #e0e0f8;
        --kfy-inp-ph:          rgba(255,255,255,0.25);
        --kfy-inp-focus-bg:    rgba(29,106,255,0.06);
        --kfy-row-bg:          rgba(10,12,28,0.98);
        --kfy-row-border:      rgba(255,255,255,0.06);
        --kfy-closed-bg:       rgba(245,158,11,0.08);
        --kfy-closed-color:    #fbbf24;
        --kfy-closed-bdr:      rgba(245,158,11,0.15);
        --kfy-articles-bg:     rgba(6,8,18,0.95);
        --kfy-articles-color:  rgba(255,255,255,0.3);
        --kfy-articles-icon-bg:rgba(255,255,255,0.05);
        --kfy-articles-icon-color:rgba(255,255,255,0.3);
        --kfy-queue-bg:        linear-gradient(135deg,rgba(245,158,11,0.1),rgba(251,191,36,0.06));
        --kfy-queue-bdr:       rgba(245,158,11,0.15);
        --kfy-queue-color:     #fbbf24;
        /* KB articles */
        --kfy-kb-cat-bg:       rgba(255,255,255,0.06);
        --kfy-kb-cat-color:    rgba(255,255,255,0.45);
        --kfy-kb-cat-hover:    rgba(255,255,255,0.65);
        --kfy-kb-cat-active-bg:rgba(99,102,241,0.15);
        --kfy-kb-cat-active-color:#818cf8;
        --kfy-kb-card-bg:      rgba(20,24,48,0.8);
        --kfy-kb-card-bdr:     rgba(99,102,241,0.1);
        --kfy-kb-card-shad:    0 2px 6px rgba(0,0,0,.15);
        --kfy-kb-card-hover-bdr:rgba(99,102,241,0.35);
        --kfy-kb-card-excerpt: rgba(255,255,255,0.45);
        --kfy-kb-tag-bg:       rgba(99,102,241,0.12);
        --kfy-kb-tag-color:    #818cf8;
        --kfy-kb-skel-from:    rgba(255,255,255,0.06);
        --kfy-kb-skel-to:      rgba(255,255,255,0.02);
        /* Gate cards */
        --kfy-gate-card-bg:    linear-gradient(180deg,rgba(20,24,48,0.9),rgba(15,18,38,0.85));
        --kfy-gate-card-border:rgba(99,102,241,0.18);
        --kfy-gate-card-title: #e0e0f8;
        --kfy-gate-card-sub:   rgba(255,255,255,0.45);
        --kfy-gate-card-shadow:0 4px 16px rgba(0,0,0,0.25);
        --kfy-gate-card-hover-border:rgba(99,102,241,0.45);
        --kfy-gate-card-hover-shadow:0 12px 32px rgba(99,102,241,0.18);
        --kfy-gate-label-color:rgba(255,255,255,0.5);
        --kfy-gate-select-scheme:dark;
        /* Dropdown */
        --kf-dd-bg:            rgba(17,17,21,0.98);
        --kf-dd-border:        rgba(255,255,255,0.08);
        --kf-dd-shadow:        0 4px 6px -1px rgba(0,0,0,0.3),0 16px 48px -8px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.04);
        --kf-dd-blur:          blur(24px);
        --kf-dd-name:          #f0f0f4;
        --kf-dd-label:         #71717a;
        --kf-dd-item:          #a1a1aa;
        --kf-dd-icon:          #71717a;
        --kf-dd-icon-hover:    #d4d4d8;
        --kf-dd-hover:         rgba(255,255,255,0.06);
        --kf-dd-divider:       rgba(255,255,255,0.06);
        /* Segmented theme control */
        --kf-seg-bg:           rgba(255,255,255,0.05);
        --kf-seg-border:       rgba(255,255,255,0.06);
        --kf-seg-active-bg:    rgba(255,255,255,0.1);
        --kf-seg-active-color: #f0f0f4;
        --kf-seg-active-shadow:0 1px 3px rgba(0,0,0,0.3);
        /* Theme toggle button */
        --kf-theme-btn-bg:     rgba(255,255,255,0.06);
        --kf-theme-btn-border: rgba(255,255,255,0.1);
        --kf-theme-btn-hover:  rgba(255,255,255,0.1);
      }

      /* Theme toggle button */
      #kf-theme-toggle {
        display:inline-flex;align-items:center;justify-content:center;
        width:32px;height:32px;border-radius:10px;
        border:1px solid var(--kf-theme-btn-border);
        background:var(--kf-theme-btn-bg);
        cursor:pointer;font-size:15px;transition:all .2s ease;
        flex-shrink:0;
      }
      #kf-theme-toggle:hover {
        border-color:#1D6AFF;
        background:var(--kf-theme-btn-hover);
        transform:scale(1.05);
      }

      /* Smooth page background transitions */
      body, header, nav { transition: background-color .3s ease, border-color .3s ease, color .3s ease; }
      #kf-dd-panel      { transition: background .25s ease, border-color .25s ease, box-shadow .25s ease; }

      /* ── DARK MODE: Site Header & Navigation ────────────────────────── */
      [data-theme="dark"] header {
        background: rgba(6,8,22,0.96) !important;
        border-bottom-color: rgba(255,255,255,0.07) !important;
        box-shadow: 0 1px 28px rgba(0,0,0,0.5) !important;
      }
      [data-theme="dark"] header .text-gray-900 { color: #f0f0ff !important; }
      [data-theme="dark"] header .tracking-tight.font-bold,
      [data-theme="dark"] header .font-display   { color: #f0f0ff !important; }

      [data-theme="dark"] header nav a,
      [data-theme="dark"] header nav button       { color: rgba(200,200,240,0.8) !important; }
      [data-theme="dark"] header nav a:hover,
      [data-theme="dark"] header nav button:hover { color: #ffffff !important; }
      [data-theme="dark"] header nav a.text-blue-600 { color: #60a5fa !important; }

      [data-theme="dark"] header .dropdown-menu {
        background: rgba(8,10,24,0.97) !important;
        border-color: rgba(255,255,255,0.09) !important;
        box-shadow: 0 16px 48px rgba(0,0,0,0.7) !important;
      }
      [data-theme="dark"] header .dropdown-menu a         { color: rgba(200,200,240,0.8) !important; }
      [data-theme="dark"] header .dropdown-menu a:hover   { background: rgba(99,102,241,0.16) !important; color: #fff !important; }

      /* ── Dropdown hover bridge — fills gap between trigger and menu ── */
      @media (min-width: 1024px) {
        .dropdown-menu::before {
          content: '';
          position: absolute;
          top: -10px;
          left: 0;
          width: 100%;
          height: 10px;
        }
      }

      [data-theme="dark"] header button.text-gray-500       { color: rgba(160,160,220,0.65) !important; }
      [data-theme="dark"] header button.text-gray-500:hover { background: rgba(255,255,255,0.07) !important; color: #c0c0ee !important; }
      [data-theme="dark"] header a.text-gray-700            { color: rgba(200,200,240,0.8) !important; }
      [data-theme="dark"] header a.text-gray-700:hover      { color: #fff !important; }

      [data-theme="dark"] #mobile-toggle                   { color: rgba(180,180,220,0.7) !important; }
      [data-theme="dark"] #mobile-toggle:hover             { background: rgba(255,255,255,0.08) !important; }

      [data-theme="dark"] #mobile-menu {
        background: rgba(6,8,22,0.98) !important;
        border-top-color: rgba(255,255,255,0.07) !important;
      }
      [data-theme="dark"] #mobile-menu a              { color: rgba(200,200,240,0.8) !important; }
      [data-theme="dark"] #mobile-menu a:hover        { background: rgba(99,102,241,0.15) !important; color: #fff !important; }
      [data-theme="dark"] #mobile-menu .text-gray-500 { color: rgba(150,150,200,0.55) !important; }
      [data-theme="dark"] #mobile-menu .text-blue-600 { color: #60a5fa !important; }
      [data-theme="dark"] #mobile-menu .bg-blue-50    { background: rgba(29,106,255,0.12) !important; }

      [data-theme="dark"] #kf-lang-switch {
        background: rgba(255,255,255,0.05) !important;
        border-color: rgba(255,255,255,0.12) !important;
      }
      [data-theme="dark"] header .bg-blue-600         { background-color: #1a4fc7 !important; }
      [data-theme="dark"] header .shadow-blue-200      { box-shadow: 0 4px 14px rgba(29,106,255,0.4) !important; }

      /* ── DARK MODE: Font rendering ─────────────────────────────────── */
      [data-theme="dark"] body {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
      [data-theme="dark"] .font-display,
      [data-theme="dark"] h1, [data-theme="dark"] h2, [data-theme="dark"] h3,
      [data-theme="dark"] h4, [data-theme="dark"] h5, [data-theme="dark"] h6 {
        letter-spacing: -0.01em;
      }

      /* ── DARK MODE: Page body & global backgrounds ──────────────────── */
      [data-theme="dark"] body {
        background: #0b0f1a !important;
        color: #e2e8f0 !important;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      [data-theme="dark"] section,
      [data-theme="dark"] main   { background: transparent !important; }

      /* ── DARK MODE: Tailwind background utilities ────────────────────── */
      [data-theme="dark"] .bg-white,
      [data-theme="dark"] .bg-white\/90,
      [data-theme="dark"] .bg-white\/70  { background-color: #111827 !important; }

      [data-theme="dark"] .bg-gray-50    { background-color: #0f172a !important; }
      [data-theme="dark"] .bg-gray-100   { background-color: #1e293b !important; }
      [data-theme="dark"] .bg-gray-200   { background-color: #1e293b !important; }
      [data-theme="dark"] .bg-gray-800   { background-color: #0f172a !important; }
      [data-theme="dark"] .bg-gray-900   { background-color: #020617 !important; }

      [data-theme="dark"] .bg-blue-50    { background-color: rgba(29,106,255,0.10) !important; }
      [data-theme="dark"] .bg-blue-100   { background-color: rgba(29,106,255,0.15) !important; }
      [data-theme="dark"] .bg-blue-600   { background-color: #1a4fc7 !important; }
      [data-theme="dark"] .bg-blue-700   { background-color: #1e40af !important; }

      [data-theme="dark"] .bg-indigo-50  { background-color: rgba(79,70,229,0.10) !important; }
      [data-theme="dark"] .bg-purple-50  { background-color: rgba(124,58,237,0.10) !important; }
      [data-theme="dark"] .bg-green-50   { background-color: rgba(16,185,129,0.10) !important; }
      [data-theme="dark"] .bg-yellow-50  { background-color: rgba(245,158,11,0.10) !important; }
      [data-theme="dark"] .bg-red-50     { background-color: rgba(239,68,68,0.10) !important; }
      [data-theme="dark"] .bg-orange-50  { background-color: rgba(249,115,22,0.10) !important; }

      /* ── DARK MODE: Tailwind text utilities ─────────────────────────── */
      [data-theme="dark"] .text-gray-900 { color: #f1f5f9 !important; }
      [data-theme="dark"] .text-gray-800 { color: #e2e8f0 !important; }
      [data-theme="dark"] .text-gray-700 { color: #cbd5e1 !important; }
      [data-theme="dark"] .text-gray-600 { color: #94a3b8 !important; }
      [data-theme="dark"] .text-gray-500 { color: #94a3b8 !important; }
      [data-theme="dark"] .text-gray-400 { color: #64748b !important; }

      [data-theme="dark"] .text-blue-600  { color: #60a5fa !important; }
      [data-theme="dark"] .text-blue-700  { color: #93c5fd !important; }
      [data-theme="dark"] .text-blue-800  { color: #bfdbfe !important; }
      [data-theme="dark"] .text-indigo-600{ color: #818cf8 !important; }
      [data-theme="dark"] .text-purple-600{ color: #c084fc !important; }
      [data-theme="dark"] .text-green-600 { color: #34d399 !important; }
      [data-theme="dark"] .text-green-700 { color: #6ee7b7 !important; }
      [data-theme="dark"] .text-red-600   { color: #f87171 !important; }
      [data-theme="dark"] .text-yellow-600{ color: #fbbf24 !important; }
      [data-theme="dark"] .text-orange-600{ color: #fb923c !important; }

      /* ── DARK MODE: Tailwind border utilities ────────────────────────── */
      [data-theme="dark"] .border-gray-100 { border-color: rgba(255,255,255,0.07) !important; }
      [data-theme="dark"] .border-gray-200 { border-color: rgba(255,255,255,0.10) !important; }
      [data-theme="dark"] .border-gray-300 { border-color: rgba(255,255,255,0.14) !important; }
      [data-theme="dark"] .border-gray-400 { border-color: rgba(255,255,255,0.20) !important; }
      [data-theme="dark"] .border-blue-100 { border-color: rgba(29,106,255,0.20) !important; }
      [data-theme="dark"] .border-blue-200 { border-color: rgba(29,106,255,0.30) !important; }
      [data-theme="dark"] .divide-gray-100 > * + * { border-color: rgba(255,255,255,0.07) !important; }
      [data-theme="dark"] .divide-gray-200 > * + * { border-color: rgba(255,255,255,0.10) !important; }

      /* ── DARK MODE: Cards & rounded panels ──────────────────────────── */
      [data-theme="dark"] .rounded-xl,
      [data-theme="dark"] .rounded-2xl,
      [data-theme="dark"] .rounded-3xl {
        /* only apply where no explicit bg utility: let bg-* rules do their job */
      }
      /* Cards that have no explicit bg class */
      [data-theme="dark"] .shadow-sm:not([class*="bg-"]),
      [data-theme="dark"] .shadow:not([class*="bg-"]),
      [data-theme="dark"] .shadow-md:not([class*="bg-"]),
      [data-theme="dark"] .shadow-lg:not([class*="bg-"]) {
        background-color: #111827 !important;
      }

      /* ── DARK MODE: Inputs & forms ───────────────────────────────────── */
      [data-theme="dark"] input[type="text"],
      [data-theme="dark"] input[type="email"],
      [data-theme="dark"] input[type="password"],
      [data-theme="dark"] input[type="search"],
      [data-theme="dark"] input[type="number"],
      [data-theme="dark"] input[type="tel"],
      [data-theme="dark"] textarea,
      [data-theme="dark"] select {
        background-color: rgba(255,255,255,0.07) !important;
        border-color: rgba(255,255,255,0.15) !important;
        color: #f1f5f9 !important;
      }
      [data-theme="dark"] input::placeholder,
      [data-theme="dark"] textarea::placeholder { color: rgba(255,255,255,0.38) !important; }
      [data-theme="dark"] select option {
        background: #1e293b !important;
        color: #f1f5f9 !important;
      }
      [data-theme="dark"] input:focus,
      [data-theme="dark"] textarea:focus,
      [data-theme="dark"] select:focus {
        background-color: rgba(29,106,255,0.06) !important;
        border-color: rgba(29,106,255,0.5) !important;
        outline: none;
      }
      [data-theme="dark"] label { color: #94a3b8 !important; }
      [data-theme="dark"] .text-sm.font-medium { color: #cbd5e1 !important; }

      /* ── DARK MODE: Tailwind ring utilities ──────────────────────────── */
      [data-theme="dark"] .ring-gray-100 { --tw-ring-color: rgba(255,255,255,0.07) !important; }
      [data-theme="dark"] .ring-gray-200 { --tw-ring-color: rgba(255,255,255,0.10) !important; }

      /* ── DARK MODE: Common Tailwind shadows ──────────────────────────── */
      [data-theme="dark"] .shadow-sm  { box-shadow: 0 1px 3px rgba(0,0,0,0.5) !important; }
      [data-theme="dark"] .shadow     { box-shadow: 0 2px 6px rgba(0,0,0,0.5) !important; }
      [data-theme="dark"] .shadow-md  { box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important; }
      [data-theme="dark"] .shadow-lg  { box-shadow: 0 8px 28px rgba(0,0,0,0.55) !important; }
      [data-theme="dark"] .shadow-xl  { box-shadow: 0 16px 48px rgba(0,0,0,0.65) !important; }

      /* ── DARK MODE: Prose/typography sections ────────────────────────── */
      [data-theme="dark"] h1, [data-theme="dark"] h2,
      [data-theme="dark"] h3, [data-theme="dark"] h4,
      [data-theme="dark"] h5, [data-theme="dark"] h6 { color: #f1f5f9 !important; }
      [data-theme="dark"] p   { color: #cbd5e1 !important; }
      [data-theme="dark"] a:not(.btn):not([class*="bg-"]):not([class*="text-blue"]):not([class*="text-white"]) {
        color: #93c5fd !important;
      }
      [data-theme="dark"] strong { color: #e2e8f0 !important; }
      [data-theme="dark"] code   {
        background: rgba(255,255,255,0.07) !important;
        color: #a5b4fc !important;
      }

      /* ── DARK MODE: Hero sections ────────────────────────────────────── */
      [data-theme="dark"] .hero-section,
      [data-theme="dark"] [class*="hero"] { background: #0a0f1e !important; }

      /* ── DARK MODE: Footer ───────────────────────────────────────────── */
      [data-theme="dark"] footer {
        background: #020617 !important;
        border-top-color: rgba(255,255,255,0.07) !important;
      }
      [data-theme="dark"] footer .text-gray-400 { color: #475569 !important; }
      [data-theme="dark"] footer .text-gray-500 { color: #64748b !important; }
      [data-theme="dark"] footer .text-gray-600 { color: #94a3b8 !important; }
      [data-theme="dark"] footer .text-gray-700 { color: #cbd5e1 !important; }
      [data-theme="dark"] footer a:hover { color: #93c5fd !important; }

      /* ── DARK MODE: Badges & tags ────────────────────────────────────── */
      [data-theme="dark"] .bg-blue-100.text-blue-800   { background: rgba(29,106,255,0.15) !important; color: #93c5fd !important; }
      [data-theme="dark"] .bg-green-100.text-green-800 { background: rgba(16,185,129,0.15) !important; color: #6ee7b7 !important; }
      [data-theme="dark"] .bg-red-100.text-red-800     { background: rgba(239,68,68,0.15) !important; color: #fca5a5 !important; }
      [data-theme="dark"] .bg-yellow-100.text-yellow-800 { background: rgba(245,158,11,0.15) !important; color: #fde68a !important; }
      [data-theme="dark"] .bg-purple-100.text-purple-800 { background: rgba(124,58,237,0.15) !important; color: #d8b4fe !important; }
      [data-theme="dark"] .bg-orange-100.text-orange-800 { background: rgba(249,115,22,0.15) !important; color: #fdba74 !important; }
      [data-theme="dark"] .bg-indigo-100.text-indigo-800 { background: rgba(79,70,229,0.15) !important; color: #a5b4fc !important; }

      /* ── DARK MODE: Gradient backgrounds ────────────────────────────── */
      [data-theme="dark"] .bg-gradient-to-br.from-blue-50  { background: linear-gradient(135deg,rgba(29,106,255,0.06),rgba(99,102,241,0.06)) !important; }
      [data-theme="dark"] .bg-gradient-to-r.from-blue-600  { /* keep blue gradients mostly as-is, just darken */ }

      /* ── DARK MODE: Price / product cards ────────────────────────────── */
      [data-theme="dark"] .price-card,
      [data-theme="dark"] .product-card,
      [data-theme="dark"] [class*="product-card"],
      [data-theme="dark"] [class*="price-card"] {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .product-card:hover {
        box-shadow: 0 24px 56px rgba(29,106,255,0.12), 0 0 0 1px rgba(29,106,255,0.15) !important;
      }
      [data-theme="dark"] .product-card .card-img-wrap {
        background: linear-gradient(145deg, #0f0f1a, #1a1a2e) !important;
      }

      /* ── DARK MODE: Related product cards ────────────────────────────── */
      [data-theme="dark"] .related-card {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .related-card .rc-img {
        background: linear-gradient(145deg, #0f0f1a, #1a1a2e) !important;
      }

      /* ── DARK MODE: PDP specific ──────────────────────────────────── */
      [data-theme="dark"] .pdp-image-wrap {
        background: linear-gradient(145deg, #0f0f1a, #1a1a2e) !important;
      }
      [data-theme="dark"] .pdp-tabs {
        border-bottom-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .pdp-tab {
        color: #64748b !important;
      }
      [data-theme="dark"] .pdp-tab.active {
        color: #60a5fa !important;
        border-bottom-color: #60a5fa !important;
      }
      [data-theme="dark"] .pdp-tab:hover {
        color: #94a3b8 !important;
      }
      [data-theme="dark"] .pdp-spec-row {
        border-bottom-color: rgba(255,255,255,0.06) !important;
      }
      [data-theme="dark"] .pdp-spec-label {
        color: #64748b !important;
      }
      [data-theme="dark"] .pdp-spec-value {
        color: #f1f5f9 !important;
      }
      [data-theme="dark"] .pdp-badge {
        background: rgba(29,106,255,0.10) !important;
        border-color: rgba(29,106,255,0.20) !important;
        color: #60a5fa !important;
      }
      [data-theme="dark"] .variant-btn {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.10) !important;
      }
      [data-theme="dark"] .variant-btn:hover {
        border-color: rgba(96,165,250,0.4) !important;
      }
      [data-theme="dark"] .variant-btn.active {
        border-color: #3b82f6 !important;
        background: rgba(29,106,255,0.08) !important;
      }
      [data-theme="dark"] .variant-btn .vb-label {
        color: #cbd5e1 !important;
      }
      [data-theme="dark"] .variant-btn .vb-price {
        color: #f1f5f9 !important;
      }
      [data-theme="dark"] .feature-check {
        background: rgba(16,185,129,0.15) !important;
      }

      /* ── DARK MODE: Info cards (contact/about) ───────────────────── */
      [data-theme="dark"] .info-card {
        background: linear-gradient(145deg, #151c2e, #111827) !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .stat-card {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .team-card {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .value-card {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }

      /* ── DARK MODE: Index category cards ─────────────────────────── */
      [data-theme="dark"] .category-card {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .category-card:hover {
        box-shadow: 0 24px 56px rgba(0,0,0,0.4) !important;
      }
      [data-theme="dark"] .category-card .absolute.inset-0 {
        opacity: 0.20 !important;
      }

      /* ── DARK MODE: Category pages ──────────────────────────────── */
      [data-theme="dark"] .toolbar-wrap {
        background: #151c2e !important;
        border-color: rgba(255,255,255,0.08) !important;
      }
      [data-theme="dark"] .filter-pill {
        background: rgba(255,255,255,0.06) !important;
        color: #94a3b8 !important;
        border-color: transparent !important;
      }
      [data-theme="dark"] .filter-pill:hover {
        background: rgba(29,106,255,0.12) !important;
        color: #60a5fa !important;
      }
      [data-theme="dark"] .filter-pill.active {
        background: #1D6AFF !important;
        color: #fff !important;
      }
      [data-theme="dark"] .toolbar-wrap .border-l { border-color: rgba(255,255,255,0.08) !important; }
      [data-theme="dark"] #grid-btn, [data-theme="dark"] #list-btn {
        color: #64748b !important;
      }
      [data-theme="dark"] #grid-btn.bg-blue-50,
      [data-theme="dark"] #grid-btn[style*="background"] {
        background: rgba(29,106,255,0.15) !important; color: #60a5fa !important;
      }
      [data-theme="dark"] #list-btn:hover, [data-theme="dark"] #grid-btn:hover {
        background: rgba(255,255,255,0.06) !important; color: #cbd5e1 !important;
      }

      /* ── Custom Sort Dropdown ───────────────────────────────────── */
      .kf-sort-wrap { position: relative; display: inline-flex; min-width: 180px; }
      .kf-sort-trigger {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 9px 14px; border-radius: 12px; cursor: pointer;
        font-size: 13px; font-weight: 600; white-space: nowrap;
        background: #fff; border: 1.5px solid #e5e7eb; color: #374151;
        transition: all 0.2s ease; user-select: none;
      }
      .kf-sort-trigger:hover { border-color: #d1d5db; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
      .kf-sort-trigger.open { border-color: #1D6AFF; box-shadow: 0 0 0 3px rgba(29,106,255,0.1); }
      .kf-sort-trigger .kf-sort-arrow {
        margin-left: auto; width: 16px; height: 16px; flex-shrink: 0;
        transition: transform 0.2s ease; color: #9ca3af;
      }
      .kf-sort-trigger.open .kf-sort-arrow { transform: rotate(180deg); }
      .kf-sort-panel {
        position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 50;
        background: #fff; border: 1.5px solid #e5e7eb; border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.04);
        padding: 4px; opacity: 0; visibility: hidden;
        transform: translateY(-6px); transition: all 0.18s ease;
        min-width: 200px;
      }
      .kf-sort-panel.open { opacity: 1; visibility: visible; transform: translateY(0); }
      .kf-sort-option {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px; border-radius: 10px; cursor: pointer;
        font-size: 13px; font-weight: 500; color: #4b5563;
        transition: all 0.15s ease; position: relative;
      }
      .kf-sort-option:hover { background: #f3f4f6; color: #111827; }
      .kf-sort-option.active { background: rgba(29,106,255,0.06); color: #1D6AFF; font-weight: 600; }
      .kf-sort-option .kf-sort-check {
        width: 16px; height: 16px; margin-left: auto; opacity: 0;
        color: #1D6AFF; flex-shrink: 0;
      }
      .kf-sort-option.active .kf-sort-check { opacity: 1; }

      /* Dark mode sort dropdown */
      [data-theme="dark"] .kf-sort-trigger {
        background: rgba(255,255,255,0.05) !important;
        border-color: rgba(255,255,255,0.1) !important;
        color: #cbd5e1 !important;
      }
      [data-theme="dark"] .kf-sort-trigger:hover {
        border-color: rgba(255,255,255,0.18) !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      }
      [data-theme="dark"] .kf-sort-trigger.open {
        border-color: rgba(29,106,255,0.5) !important;
        box-shadow: 0 0 0 3px rgba(29,106,255,0.15) !important;
      }
      [data-theme="dark"] .kf-sort-trigger .kf-sort-arrow { color: #64748b !important; }
      [data-theme="dark"] .kf-sort-panel {
        background: #1a2236 !important;
        border-color: rgba(255,255,255,0.1) !important;
        box-shadow: 0 16px 48px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2) !important;
      }
      [data-theme="dark"] .kf-sort-option { color: #94a3b8 !important; }
      [data-theme="dark"] .kf-sort-option:hover {
        background: rgba(255,255,255,0.06) !important;
        color: #e2e8f0 !important;
      }
      [data-theme="dark"] .kf-sort-option.active {
        background: rgba(29,106,255,0.12) !important;
        color: #60a5fa !important;
      }
      [data-theme="dark"] .kf-sort-option .kf-sort-check { color: #60a5fa !important; }

      /* ── DARK MODE: Contact form overrides ───────────────────────── */
      [data-theme="dark"] .kf-input {
        background: rgba(255,255,255,0.07) !important;
        border-color: rgba(255,255,255,0.15) !important;
        color: #f1f5f9 !important;
      }
      [data-theme="dark"] .kf-input::placeholder {
        color: rgba(255,255,255,0.38) !important;
      }
      [data-theme="dark"] .kf-input:focus {
        border-color: rgba(29,106,255,0.6) !important;
        box-shadow: 0 0 0 4px rgba(29,106,255,0.15) !important;
        background: rgba(29,106,255,0.06) !important;
      }

      /* ── DARK MODE: Tables ───────────────────────────────────────────── */
      [data-theme="dark"] table { color: #cbd5e1 !important; }
      [data-theme="dark"] thead { background: #0f172a !important; }
      [data-theme="dark"] thead th { color: #94a3b8 !important; border-color: rgba(255,255,255,0.08) !important; }
      [data-theme="dark"] tbody tr { border-color: rgba(255,255,255,0.06) !important; }
      [data-theme="dark"] tbody tr:nth-child(even) { background: rgba(255,255,255,0.02) !important; }
      [data-theme="dark"] tbody td { color: #cbd5e1 !important; }

      /* ── DARK MODE: Misc interactive states ──────────────────────────── */
      [data-theme="dark"] .hover\:bg-gray-50:hover  { background-color: rgba(255,255,255,0.04) !important; }
      [data-theme="dark"] .hover\:bg-gray-100:hover { background-color: rgba(255,255,255,0.07) !important; }
      [data-theme="dark"] .hover\:bg-blue-50:hover  { background-color: rgba(29,106,255,0.12) !important; }
      [data-theme="dark"] .focus\:ring-blue-200:focus { --tw-ring-color: rgba(29,106,255,0.30) !important; }
    `;
    document.head.insertBefore(s, document.head.firstChild);
  }

  function _applyTheme(preference) {
    const effective = preference === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    const html = document.documentElement;
    if (effective === 'dark') {
      html.setAttribute('data-theme', 'dark');
      html.classList.add('dark');
    } else {
      html.removeAttribute('data-theme');
      html.classList.remove('dark');
    }
    localStorage.setItem('keyify_theme', preference);
    const btn = document.getElementById('kf-theme-toggle');
    if (btn) btn.textContent = preference === 'system' ? '💻' : (effective === 'dark' ? '☀️' : '🌙');
    document.querySelectorAll('.kf-theme-opt').forEach(el => {
      el.dataset.active = String(el.dataset.theme === preference);
    });
  }

  function _initTheme() {
    _injectThemeVars();
    const saved = localStorage.getItem('keyify_theme') || 'light';
    _applyTheme(saved);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (localStorage.getItem('keyify_theme') === 'system') _applyTheme('system');
    });
  }

  function _injectThemeToggle(container) {
    if (document.getElementById('kf-theme-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'kf-theme-toggle';
    btn.title = 'Promeni temu (Light / Dark / System)';
    const pref = localStorage.getItem('keyify_theme') || 'light';
    btn.textContent = pref === 'system' ? '💻' : (pref === 'dark' ? '☀️' : '🌙');
    btn.addEventListener('click', () => {
      const cur = localStorage.getItem('keyify_theme') || 'light';
      const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
      _applyTheme(next);
    });
    container.prepend(btn);
  }

  /* ─────────────────────────────────────────────────────────
     QUICK VIEW MODAL
  ───────────────────────────────────────────────────────── */
  function _initQuickView() {
    document.addEventListener('click', e => {
      const overlay = e.target.closest('.quick-view-overlay');
      if (!overlay) return;
      e.preventDefault();
      e.stopPropagation();
      const card = overlay.closest('.product-card');
      if (!card) return;
      const btn = card.querySelector('[data-product]');
      if (!btn) return;
      let p;
      try { p = JSON.parse(btn.getAttribute('data-product')); } catch { return; }
      if (p.id) {
        window.location.href = 'product.html?id=' + p.id;
      } else {
        _showQuickViewModal(p);
      }
    });
  }

  function _showQuickViewModal(p) {
    document.getElementById('kfy-qv-modal')?.remove();
    const lang = _lang;
    const name = (lang === 'en' && p.name_en) ? p.name_en : (p.name_sr || p.name || '');
    const desc = (lang === 'en' && p.description_en) ? p.description_en : (p.description_sr || '');
    const price = parseFloat(p.price).toFixed(2);
    const origPrice = p.original_price ? parseFloat(p.original_price).toFixed(2) : null;
    const disc = origPrice ? Math.round((1 - p.price / p.original_price) * 100) : 0;
    const imgHtml = p.image_url
      ? `<img src="${escHtml(p.image_url)}" alt="${escAttr(name)}" style="max-height:200px;max-width:85%;object-fit:contain;filter:drop-shadow(0 8px 24px rgba(0,0,0,0.4))">`
      : `<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#1D6AFF,#A259FF);display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:700">${name.charAt(0)}</div>`;
    const reviewCount = Math.max(0, parseInt(p.review_count, 10) || 0);
    const purchaseCount = Math.max(0, parseInt(p.purchase_count, 10) || 0);
    const ratingValue = reviewCount > 0 ? Math.max(0, Math.min(5, Number(p.review_average) || 0)) : 0;
    const stars = Math.round(ratingValue);
    const starSvg = '<svg width="16" height="16" fill="#facc15" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    const emptyStarSvg = '<svg width="16" height="16" fill="#d1d5db" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    const ratingLabel = reviewCount > 0 ? `${ratingValue.toFixed(1)} / 5.0 (${reviewCount})` : (lang === 'en' ? 'No ratings (0)' : 'Nema ocena (0)');
    const purchaseLabel = `${lang === 'en' ? 'Bought' : 'Kupljeno'} (${purchaseCount})`;

    const modal = document.createElement('div');
    modal.id = 'kfy-qv-modal';
    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)this.parentElement.remove()">
        <div style="background:#13132a;border:1px solid rgba(255,255,255,0.1);border-radius:20px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5)">
          <div style="position:relative;background:linear-gradient(145deg,#0f0f1a,#1a1a2e);height:220px;display:flex;align-items:center;justify-content:center">
            <div style="position:absolute;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(29,106,255,0.4),transparent);filter:blur(30px)"></div>
            ${imgHtml}
            <button onclick="this.closest('#kfy-qv-modal').remove()" style="position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)">&times;</button>
            ${p.badge ? `<span style="position:absolute;top:12px;left:12px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px">${escHtml(p.badge)}</span>` : ''}
          </div>
          <div style="padding:24px;text-align:center">
            <div style="display:flex;justify-content:center;gap:2px;margin-bottom:4px">${starSvg.repeat(stars)}${emptyStarSvg.repeat(Math.max(0, 5 - stars))}</div>
            <div style="color:#9ca3af;font-size:12px;font-weight:700;margin-bottom:4px">${escHtml(ratingLabel)}</div>
            <div style="color:#7c7ca8;font-size:12px;margin-bottom:10px">${escHtml(purchaseLabel)}</div>
            <h3 style="color:#fff;font-size:18px;font-weight:700;margin:0 0 6px">${escHtml(name)}</h3>
            ${desc ? `<p style="color:#9090b8;font-size:13px;margin:0 0 16px;line-height:1.5">${escHtml(desc)}</p>` : ''}
            <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px">
              <span style="color:#fff;font-size:22px;font-weight:800">&euro;${price}</span>
              ${origPrice ? `<span style="color:#6060a0;font-size:14px;text-decoration:line-through">&euro;${origPrice}</span>` : ''}
              ${disc > 0 ? `<span style="background:rgba(16,185,129,0.15);color:#10b981;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px">-${disc}%</span>` : ''}
            </div>
            <button onclick="try{KEYIFY.CART.add(JSON.parse(this.dataset.p))}catch{}; this.innerHTML='<svg width=16 height=16 viewBox=&quot;0 0 24 24&quot; fill=none stroke=currentColor stroke-width=3 stroke-linecap=round stroke-linejoin=round style=&quot;vertical-align:middle;margin-right:4px&quot;><polyline points=&quot;20 6 9 17 4 12&quot;/></svg>Dodano!';this.style.background='#10b981';setTimeout(()=>{this.closest('#kfy-qv-modal').remove()},800)"
                    data-p='${escAttr(JSON.stringify(p))}'
                    style="width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#1D6AFF,#A259FF);color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s">
              Dodaj u korpu
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  /* ─────────────────────────────────────────────────────────
     SOCIAL LINKS LOADER
  ───────────────────────────────────────────────────────── */
  async function _loadSocialLinks() {
    const fb = document.getElementById('footer-fb');
    const tw = document.getElementById('footer-tw');
    const ig = document.getElementById('footer-ig');
    if (!fb && !tw && !ig) return;
    try {
      if (!document.getElementById('kf-social-anim-style')) {
        const style = document.createElement('style');
        style.id = 'kf-social-anim-style';
        style.textContent = `
          @keyframes kf-social-pulse { 0% { transform:translateY(0) scale(1); } 50% { transform:translateY(-2px) scale(1.12); } 100% { transform:translateY(0) scale(1); } }
          @keyframes kf-social-bounce { 0%,100% { transform:translateY(0) scale(1); } 40% { transform:translateY(-6px) scale(1.08); } 65% { transform:translateY(0) scale(1.03); } 82% { transform:translateY(-2px) scale(1.05); } }
          @keyframes kf-social-float { 0%,100% { transform:translateY(0) scale(1); } 50% { transform:translateY(-5px) scale(1.08); } }
          .kf-social-link {
            transition: transform .3s ease, box-shadow .3s ease, background-color .3s ease !important;
            will-change: transform;
          }
          .kf-social-link:hover {
            transform: translateY(-4px) scale(1.1) !important;
            box-shadow: 0 14px 28px rgba(15,23,42,0.24) !important;
          }
          .kf-social-link[data-kf-anim="pulse"]:hover { animation: kf-social-pulse .65s ease both; }
          .kf-social-link[data-kf-anim="bounce"]:hover { animation: kf-social-bounce .72s ease both; }
          .kf-social-link[data-kf-anim="float"]:hover { animation: kf-social-float 1.25s ease-in-out infinite; }
        `;
        document.head.appendChild(style);
      }
      const base = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
      const res = await fetch(`${base}/public/social-links`);
      if (!res.ok) return;
      const d = await res.json();
      const applySocialLink = (el, href, animation) => {
        if (!el) return;
        el.classList.add('kf-social-link');
        el.dataset.kfAnim = String(animation || 'float').toLowerCase();
        if (href) {
          el.href = href;
          el.target = '_blank';
          el.rel = 'noopener';
        }
      };
      applySocialLink(fb, d.facebook_url, d.facebook_animation);
      applySocialLink(tw, d.twitter_url, d.twitter_animation);
      applySocialLink(ig, d.instagram_url, d.instagram_animation);
    } catch { /* silent */ }
  }

  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */
  const _SHOP_FILTER_ALIASES = {
    chatbot: ['chatgpt', 'claude', 'gemini', 'copilot'],
    kreativni_ai: ['midjourney', 'firefly', 'dall e', 'dalle', 'runway', 'canva ai'],
    productivity: ['productivity', 'workspace', 'notion', 'office', 'microsoft 365'],
    godisnji_plan: ['godisnji', 'godisnji plan', 'annual', 'year', '12 meseci', '12 mjeseci'],
    '3d_alati': ['3d', 'blender', 'autocad', 'maya', 'sketchup'],
    windows_11: ['windows 11', 'windows'],
    office_2024: ['office 2024', 'office', 'microsoft office'],
  };

  function _normalizeShopFilterText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function _getStorefrontFilterButtons(grid) {
    const scope = grid?.closest('main') || document;
    return Array.from(scope.querySelectorAll('button.text-xs.font-semibold.rounded-full')).filter((btn) => {
      const text = btn.textContent.trim();
      return !!text && !btn.querySelector('svg');
    });
  }

  function _extractStorefrontCardPayload(card) {
    const dataBtn = card.querySelector('[data-product]');
    if (!dataBtn) return null;
    const raw = dataBtn.getAttribute('data-product');
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/&#39;/g, "'"));
    } catch {
      return null;
    }
  }

  function _getStorefrontCardBlob(card) {
    const payload = _extractStorefrontCardPayload(card);
    if (payload) {
      return _normalizeShopFilterText([
        payload.name,
        payload.name_en,
        payload.desc,
        payload.desc_en,
        payload.category,
      ].join(' '));
    }
    return _normalizeShopFilterText(card.textContent || '');
  }

  function _storefrontCardMatchesFilter(card, filterValue) {
    if (!filterValue || filterValue === 'sve' || filterValue === 'all') return true;
    const haystack = _getStorefrontCardBlob(card);
    const terms = [filterValue.replace(/_/g, ' ')].concat(_SHOP_FILTER_ALIASES[filterValue] || []);
    return terms.some((term) => haystack.includes(_normalizeShopFilterText(term)));
  }

  function _readStorefrontCardPrice(card) {
    const payload = _extractStorefrontCardPayload(card);
    if (payload && Number(payload.price) > 0) return Number(payload.price);
    const text = card.textContent || '';
    const matches = [...text.matchAll(/€\s*([0-9]+(?:[.,][0-9]+)?)/g)];
    if (!matches.length) return 0;
    return parseFloat(String(matches[matches.length - 1][1]).replace(',', '.')) || 0;
  }

  function _readStorefrontCardStars(card) {
    return card.querySelectorAll('svg.text-yellow-400').length || 0;
  }

  function _readStorefrontCardDiscount(card) {
    const match = (card.textContent || '').match(/-([0-9]{1,3})%/);
    return match ? parseInt(match[1], 10) || 0 : 0;
  }

  function _sortStorefrontCards(cards, sortValue) {
    const sorted = cards.slice();
    switch (sortValue) {
      case 'price-asc':
        sorted.sort((a, b) => _readStorefrontCardPrice(a) - _readStorefrontCardPrice(b));
        break;
      case 'price-desc':
        sorted.sort((a, b) => _readStorefrontCardPrice(b) - _readStorefrontCardPrice(a));
        break;
      case 'popular':
        sorted.sort((a, b) => _readStorefrontCardStars(b) - _readStorefrontCardStars(a));
        break;
      case 'discount':
        sorted.sort((a, b) => _readStorefrontCardDiscount(b) - _readStorefrontCardDiscount(a));
        break;
      case 'newest':
        sorted.sort((a, b) => Number(b.dataset.kfOriginalIndex || 0) - Number(a.dataset.kfOriginalIndex || 0));
        break;
      default:
        sorted.sort((a, b) => Number(a.dataset.kfOriginalIndex || 0) - Number(b.dataset.kfOriginalIndex || 0));
        break;
    }
    return sorted;
  }

  /* ── Custom Sort Dropdown Upgrade ──────────────────────────────── */
  function _upgradeSortSelect() {
    const sel = document.getElementById('sort-select');
    if (!sel || sel.dataset.kfUpgraded === '1') return;
    sel.dataset.kfUpgraded = '1';

    const options = Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent }));
    const parent = sel.closest('.flex.items-center.gap-2') || sel.parentElement;

    // Build custom dropdown
    const wrap = document.createElement('div');
    wrap.className = 'kf-sort-wrap';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'kf-sort-trigger';
    trigger.innerHTML = `
      <svg class="w-4 h-4 flex-shrink-0" style="color:#9ca3af" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 7h18M6 12h12M9 17h6"/>
      </svg>
      <span class="kf-sort-label">${options[0].label}</span>
      <svg class="kf-sort-arrow" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
      </svg>
    `;

    const panel = document.createElement('div');
    panel.className = 'kf-sort-panel';
    panel.innerHTML = options.map((o, i) =>
      `<div class="kf-sort-option${i === 0 ? ' active' : ''}" data-value="${o.value}">
        <span>${o.label}</span>
        <svg class="kf-sort-check" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
        </svg>
      </div>`
    ).join('');

    wrap.appendChild(trigger);
    wrap.appendChild(panel);

    // Replace the parent container
    parent.replaceWith(wrap);
    // Hide original select but keep it in DOM for JS compatibility
    sel.style.display = 'none';
    wrap.appendChild(sel);

    // Interactions
    let isOpen = false;
    const toggle = () => {
      isOpen = !isOpen;
      trigger.classList.toggle('open', isOpen);
      panel.classList.toggle('open', isOpen);
    };
    const close = () => {
      isOpen = false;
      trigger.classList.remove('open');
      panel.classList.remove('open');
    };

    trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    panel.querySelectorAll('.kf-sort-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const val = opt.dataset.value;
        sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        trigger.querySelector('.kf-sort-label').textContent = opt.querySelector('span').textContent;
        panel.querySelectorAll('.kf-sort-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        close();
      });
    });

    // Keyboard navigation
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!isOpen) toggle(); panel.querySelector('.kf-sort-option')?.focus(); }
    });
    panel.querySelectorAll('.kf-sort-option').forEach((opt, i, all) => {
      opt.tabIndex = 0;
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || all[0]).focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); (all[i - 1] || all[all.length - 1]).focus(); }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opt.click(); }
        if (e.key === 'Escape') { close(); trigger.focus(); }
      });
    });
  }

  function _initStorefrontFilters() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    // Always upgrade the native select — even on inline-managed storefronts
    _upgradeSortSelect();

    if (grid.dataset.kfInlineStorefront === '1') return;

    const sortSelect = document.getElementById('sort-select');
    const state = window.__kfyStorefrontState || { activeFilter: 'sve' };
    window.__kfyStorefrontState = state;

    const syncButtons = () => {
      _getStorefrontFilterButtons(grid).forEach((btn) => {
        const value = _normalizeShopFilterText(btn.dataset.filter || btn.textContent);
        btn.dataset.filter = value;
        btn.classList.remove('bg-blue-600', 'text-white', 'bg-gray-100', 'text-gray-600', 'hover:bg-blue-50', 'hover:text-blue-600');
        if (value === state.activeFilter) {
          btn.classList.add('bg-blue-600', 'text-white');
        } else {
          btn.classList.add('bg-gray-100', 'text-gray-600', 'hover:bg-blue-50', 'hover:text-blue-600');
        }
      });
    };

    const apply = () => {
      const cards = Array.from(grid.querySelectorAll('.product-card'));
      if (!cards.length) return;

      cards.forEach((card, index) => {
        if (!card.dataset.kfOriginalIndex) card.dataset.kfOriginalIndex = String(index);
        if (card.style.display && card.style.display !== 'none') {
          card.dataset.kfOriginalDisplay = card.style.display;
        }
      });

      _sortStorefrontCards(cards, sortSelect?.value || 'default').forEach((card) => {
        const visible = _storefrontCardMatchesFilter(card, state.activeFilter);
        card.style.display = visible ? (card.dataset.kfOriginalDisplay || '') : 'none';
        grid.appendChild(card);
      });
    };

    _getStorefrontFilterButtons(grid).forEach((btn) => {
      if (btn.dataset.kfStorefrontBound === '1') return;
      btn.dataset.kfStorefrontBound = '1';
      btn.dataset.filter = _normalizeShopFilterText(btn.dataset.filter || btn.textContent);
      btn.addEventListener('click', () => {
        state.activeFilter = btn.dataset.filter || 'sve';
        syncButtons();
        apply();
      });
    });

    if (sortSelect && sortSelect.dataset.kfStorefrontBound !== '1') {
      sortSelect.dataset.kfStorefrontBound = '1';
      sortSelect.addEventListener('change', apply);
    }

    syncButtons();
    apply();
  }

  /* ─────────────────────────────────────────────────────────
     STAR RATING RENDERER (reusable)
  ───────────────────────────────────────────────────────── */
  function renderStarRating(rating, maxStars) {
    maxStars = maxStars || 5;
    rating = Math.max(0, Math.min(maxStars, Number(rating) || 0));
    const fullStar = '<svg width="14" height="14" fill="#f59e0b" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    const halfStar = '<svg width="14" height="14" viewBox="0 0 20 20"><defs><linearGradient id="kf-half"><stop offset="50%" stop-color="#f59e0b"/><stop offset="50%" stop-color="#d1d5db"/></linearGradient></defs><path fill="url(#kf-half)" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    const emptyStar = '<svg width="14" height="14" fill="#d1d5db" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';

    let html = '';
    for (let i = 1; i <= maxStars; i++) {
      if (rating >= i) html += fullStar;
      else if (rating >= i - 0.5) html += halfStar;
      else html += emptyStar;
    }
    return html;
  }

  function _initHeroRating() {
    const el = document.querySelector('[data-kve-rating="hero"]');
    if (!el) return;
    const rating = parseFloat(el.dataset.rating) || 0;
    const maxRating = parseInt(el.dataset.ratingMax, 10) || 5;
    const count = parseInt(el.dataset.reviewCount, 10) || 0;
    const title = el.dataset.ratingTitle || '';
    const showStars = el.dataset.showStars !== '0';
    const showCount = el.dataset.showCount !== '0';

    /* Sanitize title: fix mojibake, normalize to ekavica */
    const safeTitle = repairMojibake(title || (_lang === 'en' ? 'Average rating' : 'Prose\u010dna ocena'))
      .replace(/ocjena/gi, 'ocena');

    /* Always rebuild inner content from data attributes to avoid snapshot corruption */
    const iconDiv = el.querySelector('.flex-shrink-0');
    const contentDiv = iconDiv ? iconDiv.nextElementSibling : null;
    if (contentDiv) {
      const starsHtml = showStars ? renderStarRating(rating, maxRating) : '';
      const valueText = rating.toFixed(1) + ' / ' + maxRating + '.0';
      const countText = count + (_lang === 'en' ? ' reviews' : ' recenzija');

      contentDiv.innerHTML =
        '<div class="text-xs text-gray-500 font-medium"></div>' +
        '<div class="font-display font-bold text-gray-900 text-sm flex items-center gap-1.5" id="hero-rating-display">' +
          '<span id="hero-rating-stars" class="flex items-center gap-0.5">' + starsHtml + '</span>' +
          '<span id="hero-rating-value">' + escHtml(valueText) + '</span>' +
        '</div>' +
        '<div class="text-[10px] text-gray-400 font-medium" id="hero-rating-count"' +
          (showCount ? '' : ' style="display:none"') + '>' + escHtml(countText) + '</div>';

      contentDiv.querySelector('.text-xs.text-gray-500').textContent = safeTitle;
    } else {
      /* Fallback: find elements by ID (fresh page without snapshot) */
      const titleEl = el.querySelector('.text-xs.text-gray-500');
      const starsEl = document.getElementById('hero-rating-stars');
      const valueEl = document.getElementById('hero-rating-value');
      const countEl = document.getElementById('hero-rating-count');

      if (titleEl) titleEl.textContent = safeTitle;
      if (starsEl) {
        starsEl.innerHTML = showStars ? renderStarRating(rating, maxRating) : '';
        starsEl.style.display = showStars ? '' : 'none';
      }
      if (valueEl) valueEl.textContent = rating.toFixed(1) + ' / ' + maxRating + '.0';
      if (countEl) {
        countEl.textContent = count + (_lang === 'en' ? ' reviews' : ' recenzija');
        countEl.style.display = showCount ? '' : 'none';
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     HERO FEATURED PRODUCT (auto/manual mode)
  ───────────────────────────────────────────────────────── */
  async function _initHeroFeaturedProduct() {
    const container = document.getElementById('hero-featured-product');
    if (!container) return;

    const API_BASE = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
    const mode = container.dataset.mode || 'auto';
    const manualId = container.dataset.productId || '';

    try {
      let product = null;

      // 1. Manual override
      if (mode === 'manual' && manualId) {
        const res = await fetch(API_BASE + '/products/' + encodeURIComponent(manualId));
        if (res.ok) product = await res.json();
      }

      // 2. Auto: best seller logic with fallback chain
      if (!product) {
        const res = await fetch(API_BASE + '/products');
        if (!res.ok) return;
        const products = await res.json();
        if (!products.length) return;

        // a) Highest purchase_count (best seller)
        var bestSeller = null;
        var bestCount = 0;
        for (var i = 0; i < products.length; i++) {
          var pc = parseInt(products[i].purchase_count, 10) || 0;
          if (pc > bestCount) { bestCount = pc; bestSeller = products[i]; }
        }
        if (bestSeller && bestCount > 0) { product = bestSeller; }

        // b) Manually featured product (badge = 'Bestseller' or 'Featured')
        if (!product) {
          for (var j = 0; j < products.length; j++) {
            var b = (products[j].badge || '').toLowerCase();
            if (b === 'bestseller' || b === 'featured') { product = products[j]; break; }
          }
        }

        // c) First product with hero image
        if (!product) {
          for (var k = 0; k < products.length; k++) {
            if (products[k].homepage_hero_image) { product = products[k]; break; }
          }
        }

        // d) First active product
        if (!product) { product = products[0]; }
      }

      _renderHeroFeaturedProduct(container, product);
    } catch (err) {
      console.warn('[Keyify] Hero featured product load failed:', err.message);
    }
  }

  function _renderHeroFeaturedProduct(container, product) {
    const lang = _lang;
    const name = (lang === 'en' && product.name_en) ? product.name_en : (product.name_sr || product.name || '');
    const desc = (lang === 'en' && product.description_en) ? product.description_en : (product.description_sr || '');
    const price = parseFloat(product.price || 0).toFixed(2);
    const origPrice = product.original_price ? parseFloat(product.original_price).toFixed(2) : null;
    const disc = origPrice ? Math.round((1 - product.price / product.original_price) * 100) : 0;
    const heroImg = product.homepage_hero_image || product.image_url || '';
    const purchaseCount = parseInt(product.purchase_count, 10) || 0;

    const titleEl = document.getElementById('hero-fp-title');
    const descEl = document.getElementById('hero-fp-desc');
    const priceEl = document.getElementById('hero-fp-price');
    const origPriceEl = document.getElementById('hero-fp-original-price');
    const discountEl = document.getElementById('hero-fp-discount');
    const imageWrap = document.getElementById('hero-fp-image-wrap');
    const imageEl = document.getElementById('hero-fp-image');
    const fallbackEl = document.getElementById('hero-fp-fallback');
    const badgeWrap = document.getElementById('hero-fp-badge-wrap');
    const badgeEl = document.getElementById('hero-fp-badge');
    const atcBtn = document.getElementById('hero-fp-atc-btn');

    if (titleEl) titleEl.textContent = name;
    if (descEl) descEl.textContent = desc;
    if (priceEl) priceEl.innerHTML = '&euro; ' + escHtml(price);

    if (origPriceEl && origPrice) {
      origPriceEl.innerHTML = '&euro; ' + escHtml(origPrice);
      origPriceEl.classList.remove('hidden');
    }
    if (discountEl && disc > 0) {
      discountEl.textContent = '-' + disc + '%';
      discountEl.classList.remove('hidden');
    }

    // Badge logic
    if (badgeWrap && badgeEl) {
      var badgeText = '';
      if (purchaseCount > 0) {
        badgeText = lang === 'en' ? 'BEST SELLER' : 'NAJPRODAVANIJE';
      } else if (product.badge) {
        badgeText = product.badge.toUpperCase();
      }
      if (badgeText) {
        badgeEl.innerHTML = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/></svg> ' + escHtml(badgeText);
      } else {
        badgeWrap.style.display = 'none';
      }
    }

    // Hero image
    if (imageWrap && imageEl && heroImg) {
      imageEl.src = heroImg;
      imageEl.alt = name;
      imageEl.onload = function() {
        imageEl.style.opacity = '1';
        if (fallbackEl) fallbackEl.style.display = 'none';
      };
      imageEl.onerror = function() {
        imageEl.style.opacity = '0';
        if (fallbackEl) fallbackEl.style.display = '';
      };
    }

    if (atcBtn) {
      const payload = {
        id: product.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        product_id: product.id,
        name: name,
        price: parseFloat(product.price),
        image: heroImg || null,
      };
      atcBtn.setAttribute('data-product', JSON.stringify(payload));
      atcBtn.dataset.kveProductId = String(product.id || '');
    }

    _wireProductButtons();
  }

  async function _hydratePageSnapshot() {
    /* Skip when visual editor will handle its own hydration */
    const editorActive = localStorage.getItem('keyify_editor_active') === 'true'
      || /[?&]mode=edit\b/.test(window.location.search);
    if (editorActive) return;

    /* Only hydrate pages that have a <main> with editable content */
    if (!document.querySelector('main')) return;

    const file = window.location.pathname.split('/').pop() || 'index.html';
    const slug = file.replace(/\.html$/i, '') || 'index';

    /* Skip non-storefront pages (login, register, admin, etc.) */
    const skipPages = ['login', 'register', 'admin', 'forgot-password', 'reset-password'];
    if (skipPages.includes(slug)) return;

    const API_BASE = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
    try {
      const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(slug)}`);
      if (!res.ok) return;
      const payload = await res.json();
      if (typeof payload.html !== 'string' || !payload.html.trim()) return;
      /* Reject corrupted snapshots that contain full body content */
      if (payload.html.includes('<header') || payload.html.includes('<footer') || payload.html.includes('<script')) return;
      const target = document.querySelector('main');
      if (!target) return;
      const liveGrid = target.querySelector('#product-grid');
      target.innerHTML = payload.html;
      if (liveGrid) {
        const snapshotGrid = target.querySelector('#product-grid');
        if (snapshotGrid) snapshotGrid.replaceWith(liveGrid);
      }
    } catch {}
  }

  async function init() {
    _initTheme();
    _injectCartDrawer();
    _injectMiniCart();
    _injectNavbarExtras();
    _updateAccountNavbar();
    CART.updateNavbarText();
    CART._renderDrawerItems();
    await _hydratePageSnapshot();
    _wireProductButtons();
    _initQuickView();
    _initStorefrontFilters();
    _initHeroRating();
    await _initHeroFeaturedProduct();
    _loadSocialLinks();
    repairVisibleText(document.body);

    /* Re-wire on any dynamic DOM changes (e.g. API-loaded products) */
    let repairQueued = false;
    const scheduleRepair = () => {
      if (repairQueued) return;
      repairQueued = true;
      requestAnimationFrame(() => {
        repairQueued = false;
        _wireProductButtons();
        _initStorefrontFilters();
        repairVisibleText(document.body);
      });
    };
    const obs = new MutationObserver(scheduleRepair);
    obs.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  /* Public API */
  return { LANG, CART, lang: _lang, init, escHtml, escAttr, logout: _logout, setTheme: _applyTheme, renderStarRating, _initHeroRating, _initHeroFeaturedProduct, _wireProductButtons, repairVisibleText, _renderHeroFP: _renderHeroFeaturedProduct };

})();


/* ─────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KEYIFY.init());
} else {
  KEYIFY.init();
}
