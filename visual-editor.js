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
  const perms = JSON.parse(localStorage.getItem('keyify_permissions') || '{}');
  const isSuperAdmin = role === 'admin' && Object.keys(perms).length === 0;
  const canEdit = role === 'admin' && (isSuperAdmin || perms.can_use_editor === true);
  if (!token || !canEdit) {
    console.warn('[KVE] Editor mode requires admin login with editor permission.');
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

  const KVE_ATC_ICON_PRESETS = {
    cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.6"></circle><circle cx="18" cy="20" r="1.6"></circle><path d="M3 4h2l2.4 10.2a1 1 0 0 0 .98.78h8.9a1 1 0 0 0 .97-.76L21 7H7.4"></path></svg>`,
    spotify: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2Zm4.28 13.85a.86.86 0 0 1-1.18.28c-2.54-1.55-5.73-1.9-9.5-1.03a.86.86 0 1 1-.38-1.67c4.22-.96 7.84-.55 10.77 1.24.4.24.52.78.29 1.18Zm1.2-2.67a1.07 1.07 0 0 1-1.46.35c-2.9-1.78-7.31-2.29-10.73-1.23a1.07 1.07 0 0 1-.64-2.04c4.02-1.25 8.97-.67 12.48 1.49.5.31.66.97.35 1.43Zm.14-2.77C14.3 8.7 8.5 8.5 5.34 9.46a1.28 1.28 0 1 1-.75-2.45c3.65-1.12 10.07-.9 14.57 1.77a1.28 1.28 0 0 1-1.34 2.03Z"/></svg>`,
    netflix: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.2 3h3.3l5 11.56V3h3.3v18c-1.14-.2-2.26-.47-3.37-.82L9.5 8.74V20.4A24.7 24.7 0 0 1 6.2 21V3Z"/></svg>`,
    adobe: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.35 3H21v18h-4.2l-2.45-5.88H9.77L7.32 21H3L10.42 3h3.93Zm-1.01 8.83-1.25-3.36-1.32 3.36h2.57Z"/></svg>`,
  };
  const KVE_SOCIAL_ICON_PRESETS = {
    facebook: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.36 21v-7.12h2.4l.36-2.78h-2.76V9.33c0-.8.23-1.34 1.38-1.34H16V5.5c-.3-.04-1.03-.1-1.96-.1-1.93 0-3.25 1.18-3.25 3.35v1.87H8.6v2.78h2.2V21h2.56Z"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.86 3H20l-4.67 5.34L21 21h-4.46l-3.5-4.84L8.8 21H6.64l4.99-5.7L3 3h4.57l3.16 4.42L14.58 3Zm-.78 16.59h1.19L7.02 4.33H5.74l11.34 15.26Z"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2.2A2.8 2.8 0 0 0 4.2 7v10A2.8 2.8 0 0 0 7 19.8h10a2.8 2.8 0 0 0 2.8-2.8V7A2.8 2.8 0 0 0 17 4.2H7Zm10.4 1.65a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2.2A2.8 2.8 0 1 0 12 14.8 2.8 2.8 0 0 0 12 9.2Z"/></svg>`,
  };

  function normalizeKveText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function getKvePresetIcon(key) {
    return KVE_ATC_ICON_PRESETS[key] || KVE_ATC_ICON_PRESETS.cart;
  }

  async function uploadEditorAsset(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API}/admin/upload-asset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `Greška ${res.status}`);
    return payload.url;
  }

  async function fetchEditorProducts() {
    const res = await fetch(`${API}/products`);
    const payload = await res.json().catch(() => []);
    if (!res.ok) throw new Error(payload.error || 'Greška pri učitavanju proizvoda.');
    return Array.isArray(payload) ? payload : [];
  }

  const editorProductDetailCache = new Map();

  async function fetchEditorProductDetails(productId) {
    const id = String(productId || '').trim();
    if (!id) throw new Error('Proizvod nije odabran.');
    if (editorProductDetailCache.has(id)) return editorProductDetailCache.get(id);

    const res = await fetch(`${API}/products/${encodeURIComponent(id)}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || 'Greška pri učitavanju detalja proizvoda.');
    editorProductDetailCache.set(id, payload || {});
    return payload || {};
  }

  function findSectionInsertTarget(sec) {
    return sec.querySelector('.max-w-7xl, .max-w-6xl, .max-w-5xl, .max-w-4xl, .max-w-3xl, .container, .mx-auto') || sec;
  }

  function createEditorButtonWrap() {
    const wrap = document.createElement('div');
    wrap.dataset.kveButtonWrap = '1';
    wrap.style.cssText = 'position:relative;display:block;width:100%;min-height:86px;margin-top:18px;';
    return wrap;
  }

  function getEditorButtonWrap(el) {
    if (!el?.closest) return null;
    const wrap = el.closest('[data-kve-button-wrap="1"]');
    return wrap && wrap.contains(el) ? wrap : null;
  }

  function getEditorRemovalTarget(el) {
    if (!el) return null;
    return isButtonLikeEditableElement(el) ? (getEditorButtonWrap(el) || el) : el;
  }

  function getEditorVariantToken(variant) {
    if (!variant) return '';
    return String(variant.id || variant.variant_id || variant.label || '')
      .trim()
      .toLowerCase();
  }

  function normalizeEditorVariants(product) {
    return (Array.isArray(product?.variants) ? product.variants : [])
      .map((variant, index) => ({
        ...variant,
        _token: getEditorVariantToken(variant) || `variant-${index}`,
      }))
      .filter((variant) => Number.isFinite(parseFloat(variant.price)) && parseFloat(variant.price) > 0);
  }

  function resolveEditorVariant(product, selectedToken) {
    const token = String(selectedToken || '').trim().toLowerCase();
    if (!token) return null;
    return normalizeEditorVariants(product).find((variant) => {
      const labelToken = String(variant.label || '').trim().toLowerCase();
      return variant._token === token || labelToken === token;
    }) || null;
  }

  function buildEditorCartKey(product, variant) {
    const baseId = String(product?.id || product?.product_id || 'product').trim();
    const variantToken = getEditorVariantToken(variant) || 'base';
    return `${baseId}::${variantToken}`;
  }

  function setEditorButtonContent(el, label) {
    const directIconWrap = el.querySelector(':scope > span:first-child svg, :scope > span:first-child img')
      ? el.querySelector(':scope > span:first-child')?.cloneNode(true)
      : null;
    const directIcon = !directIconWrap
      ? el.querySelector(':scope > svg, :scope > img')?.cloneNode(true)
      : null;

    if (!directIconWrap && !directIcon) {
      el.textContent = label;
      return;
    }

    el.innerHTML = '';
    if (!/flex/.test(String(window.getComputedStyle(el).display || ''))) {
      el.style.display = 'inline-flex';
    }
    el.style.alignItems = el.style.alignItems || 'center';
    el.style.gap = el.style.gap || '12px';

    if (directIconWrap) {
      el.appendChild(directIconWrap);
    } else if (directIcon) {
      const iconWrap = document.createElement('span');
      iconWrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;color:currentColor;flex-shrink:0;';
      iconWrap.appendChild(directIcon);
      el.appendChild(iconWrap);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = label;
    el.appendChild(textSpan);
  }

  function buildAtcDataPayload(product, variant) {
    const variantPrice = parseFloat(variant?.price);
    const basePrice = Number.isFinite(variantPrice) && variantPrice > 0
      ? variantPrice
      : parseFloat(product.price || 0);
    const originalPrice = Number.isFinite(parseFloat(variant?.original_price))
      ? parseFloat(variant.original_price)
      : (Number.isFinite(parseFloat(product.original_price)) ? parseFloat(product.original_price) : null);
    return {
      id: product.id,
      product_id: product.id,
      cart_key: buildEditorCartKey(product, variant),
      name: product.name_sr || product.name || 'Proizvod',
      name_en: product.name_en || product.name_sr || product.name || 'Product',
      price: basePrice,
      desc: product.description_sr || '',
      desc_en: product.description_en || '',
      color: '#2563eb',
      category: product.category || product.category_slug || '',
      imageUrl: product.image_url || null,
      variant_id: variant?.id || variant?.variant_id || null,
      variant_label: variant?.label || null,
      original_price: originalPrice,
    };
  }

  function buildAtcButtonNode(product, options) {
    const button = document.createElement('button');
    const iconMarkup = options.customIconUrl
      ? `<img src="${esc(options.customIconUrl)}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:999px" />`
      : getKvePresetIcon(options.iconPreset);
    button.type = 'button';
    button.dataset.kfAtc = '1';
    button.dataset.kveProductId = String(product.id);
    if (options.variant) {
      button.dataset.kveVariantId = String(options.variant.id || options.variant.variant_id || options.variant.label || '');
      button.dataset.kveVariantLabel = String(options.variant.label || '');
    }
    button.setAttribute('data-product', JSON.stringify(buildAtcDataPayload(product, options.variant)));
    button.className = 'kve-inline-atc';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:12px;padding:14px 24px;border:none;border-radius:18px;background:linear-gradient(135deg,#ffffff,#f8fafc);color:#2563eb;font-size:16px;font-weight:700;box-shadow:0 18px 40px rgba(37,99,235,0.18);cursor:pointer;transition:transform .25s ease, box-shadow .25s ease;';
    button.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;color:currentColor">${iconMarkup}</span><span>${esc(options.label || 'Dodaj u korpu')}</span>`;
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-3px) scale(1.01)';
      button.style.boxShadow = '0 22px 48px rgba(37,99,235,0.24)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = '';
      button.style.boxShadow = '0 18px 40px rgba(37,99,235,0.18)';
    });
    return button;
  }

  function buildSocialLinkNode(options) {
    const wrap = document.createElement('a');
    wrap.href = options.href || '#';
    wrap.target = '_blank';
    wrap.rel = 'noopener';
    wrap.className = 'kf-social-link';
    wrap.dataset.kfAnim = options.animation || 'float';
    wrap.dataset.kveSmart = 'sociallink';
    wrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:16px;background:rgba(15,23,42,0.72);color:#f8fafc;text-decoration:none;box-shadow:0 14px 30px rgba(15,23,42,0.18);backdrop-filter:blur(12px);';
    wrap.innerHTML = options.customIconUrl
      ? `<img src="${esc(options.customIconUrl)}" alt="${esc(options.network)}" style="width:22px;height:22px;object-fit:contain" />`
      : (KVE_SOCIAL_ICON_PRESETS[options.network] || KVE_SOCIAL_ICON_PRESETS.facebook);
    return wrap;
  }

  function injectButtonStudioStyles() {
    if (document.getElementById('kve-button-studio-style')) return;
    const style = document.createElement('style');
    style.id = 'kve-button-studio-style';
    style.textContent = `
      #kve-button-studio {
        position: fixed;
        top: 96px;
        right: 20px;
        width: 272px;
        z-index: 99997;
        border-radius: 24px;
        padding: 16px;
        color: #e5eefc;
        background: linear-gradient(180deg, rgba(24,28,42,0.82) 0%, rgba(15,18,31,0.88) 100%);
        border: 1px solid rgba(255,255,255,0.12);
        box-shadow: 0 28px 60px rgba(4,10,24,0.34);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        cursor: grab;
        user-select: none;
      }
      #kve-button-studio.kve-bs-dragging {
        cursor: grabbing;
        box-shadow: 0 34px 76px rgba(4,10,24,0.46);
      }
      #kve-button-studio .kve-bs-kicker {
        font-size: 10px;
        letter-spacing: .18em;
        text-transform: uppercase;
        color: rgba(191,219,254,0.72);
        margin-bottom: 8px;
      }
      #kve-button-studio .kve-bs-title {
        font-family: 'Poppins', sans-serif;
        font-size: 17px;
        font-weight: 700;
        line-height: 1.2;
        color: #fff;
        margin: 0 0 6px;
      }
      #kve-button-studio .kve-bs-copy {
        font-size: 12px;
        line-height: 1.55;
        color: rgba(226,232,240,0.72);
        margin: 0 0 14px;
      }
      #kve-button-studio .kve-bs-list {
        display: grid;
        gap: 10px;
      }
      #kve-button-studio .kve-bs-card {
        display: grid;
        grid-template-columns: 42px 1fr;
        gap: 12px;
        align-items: center;
        padding: 12px 13px;
        border-radius: 18px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        cursor: grab;
        transition: transform .2s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease;
      }
      #kve-button-studio .kve-bs-card:hover {
        transform: translateY(-2px);
        border-color: rgba(96,165,250,0.5);
        background: rgba(255,255,255,0.09);
        box-shadow: 0 18px 35px rgba(29,106,255,0.15);
      }
      #kve-button-studio .kve-bs-card:active { cursor: grabbing; }
      #kve-button-studio .kve-bs-card,
      #kve-button-studio .kve-bs-card * {
        user-select: none;
      }
      #kve-button-studio .kve-bs-icon {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, rgba(37,99,235,0.22), rgba(147,51,234,0.22));
        color: #fff;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
      }
      #kve-button-studio .kve-bs-name {
        display: block;
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 3px;
      }
      #kve-button-studio .kve-bs-meta {
        display: block;
        color: rgba(191,219,254,0.72);
        font-size: 11px;
        line-height: 1.45;
      }
      body.kve-active .kve-button-drop-target {
        transition: box-shadow .2s ease, outline-color .2s ease;
      }
      body.kve-active .kve-button-drop-target.kve-button-drop-active {
        outline: 2px dashed rgba(96,165,250,0.9) !important;
        outline-offset: -4px;
        box-shadow: inset 0 0 0 999px rgba(37,99,235,0.08);
      }
      @media (max-width: 1200px) {
        #kve-button-studio {
          right: 12px;
          width: 244px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getEditorButtonLabel(el) {
    return el.querySelector('span:last-child')?.textContent?.trim()
      || el.textContent.trim()
      || 'Dugme';
  }

  function parseEditorButtonHref(el) {
    const directHref = el.dataset.kveLinkHref || el.getAttribute('href');
    if (directHref) return directHref;
    const onclick = el.getAttribute('onclick') || '';
    const match = onclick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1] : '';
  }

  function extractEditorButtonProduct(el) {
    const raw = el?.getAttribute?.('data-product');
    if (!raw) return null;
    try {
      return JSON.parse(String(raw).replace(/&#39;/g, "'"));
    } catch {
      return null;
    }
  }

  function getEditorButtonMode(el) {
    if (el.dataset.kveButtonFunction) return el.dataset.kveButtonFunction;
    if (el.dataset.kfAtc === '1' || el.getAttribute('data-product')) return 'cart';
    if (parseEditorButtonHref(el)) return 'hyperlink';
    return 'none';
  }

  function isButtonLikeEditableElement(el) {
    if (!el) return false;
    if (el.tagName === 'BUTTON') return true;
    if (el.tagName !== 'A') return false;
    if (el.dataset.kfAtc === '1' || el.hasAttribute('data-product') || el.dataset.kveButtonFunction) return true;
    if (String(el.getAttribute('role') || '').toLowerCase() === 'button') return true;
    const cls = String(el.className || '');
    return /rounded-(full|xl|2xl)|shadow|bg-|inline-flex|justify-center|items-center|font-semibold|font-bold|cta|button|btn/.test(cls);
  }

  function resolveButtonLikeEditableElement(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement || null;
    while (el && el !== document.body) {
      if (el.hasAttribute?.('data-kve-editor') || el.closest?.('[data-kve-editor]')) return null;
      if (isEditorNavigationElement(el)) return null;
      if (isButtonLikeEditableElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function ensureButtonFlexMetrics(el) {
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!el.dataset.kveBaseWidth && rect.width) el.dataset.kveBaseWidth = String(Math.round(rect.width));
    if (!el.dataset.kveBaseFontSize) el.dataset.kveBaseFontSize = String(parseFloat(cs.fontSize) || 16);
    if (!el.dataset.kveBasePadX) {
      const avgPadX = ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) / 2;
      el.dataset.kveBasePadX = String(avgPadX || 20);
    }
    if (!el.dataset.kveBasePadY) {
      const avgPadY = ((parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)) / 2;
      el.dataset.kveBasePadY = String(avgPadY || 12);
    }
  }

  function ensureButtonPositioning(el) {
    if (!el) return;
    const cs = window.getComputedStyle(el);
    if (cs.position === 'static' || !cs.position) {
      el.style.position = 'relative';
    }
    if (cs.display === 'inline') {
      el.style.display = 'inline-flex';
    }
    el.style.touchAction = 'none';
  }

  function applyButtonFlexSize(el, nextWidth) {
    if (!el || !Number.isFinite(nextWidth) || nextWidth <= 0) return;
    ensureButtonFlexMetrics(el);
    const baseWidth = parseFloat(el.dataset.kveBaseWidth) || el.getBoundingClientRect().width || nextWidth;
    const safeWidth = Math.max(96, Math.round(nextWidth));
    const scale = Math.max(0.72, Math.min(1.85, safeWidth / baseWidth));
    const baseFont = parseFloat(el.dataset.kveBaseFontSize) || 16;
    const basePadX = parseFloat(el.dataset.kveBasePadX) || 20;
    const basePadY = parseFloat(el.dataset.kveBasePadY) || 12;

    el.dataset.kveWidth = String(safeWidth);
    el.style.width = `${safeWidth}px`;
    el.style.maxWidth = '100%';
    el.style.fontSize = `${Math.round(baseFont * scale * 100) / 100}px`;
    el.style.paddingLeft = `${Math.round(basePadX * scale)}px`;
    el.style.paddingRight = `${Math.round(basePadX * scale)}px`;
    el.style.paddingTop = `${Math.round(basePadY * scale)}px`;
    el.style.paddingBottom = `${Math.round(basePadY * scale)}px`;
  }

  function applyButtonFlexPlacement(el, left, top) {
    if (!el) return;
    ensureButtonPositioning(el);
    const safeLeft = Math.round(Number(left) || 0);
    const safeTop = Math.round(Number(top) || 0);
    el.dataset.kveOffsetX = String(safeLeft);
    el.dataset.kveOffsetY = String(safeTop);
    el.style.left = `${safeLeft}px`;
    el.style.top = `${safeTop}px`;
  }

  function enableFlexibleEditorButton(el) {
    if (!el) return;
    ensureButtonPositioning(el);
    ensureButtonFlexMetrics(el);
    el.dataset.kveFlexibleButton = '1';

    const savedWidth = parseFloat(el.dataset.kveWidth || '');
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      applyButtonFlexSize(el, savedWidth);
    }

    if (el.dataset.kveOffsetX || el.dataset.kveOffsetY) {
      applyButtonFlexPlacement(el, parseFloat(el.dataset.kveOffsetX || '0'), parseFloat(el.dataset.kveOffsetY || '0'));
    }
  }

  function applyButtonFunctionConfig(el, options) {
    const mode = String(options?.mode || 'none');
    const label = String(options?.label || getEditorButtonLabel(el) || 'Dugme');
    const href = String(options?.href || '').trim();
    const product = options?.product || null;
    const variant = options?.variant || null;

    if (el.tagName !== 'IMG' && !options?.preserveContent) {
      setEditorButtonContent(el, label);
    }

    el.dataset.kveButtonFunction = mode;

    if (mode === 'cart') {
      if (!product) throw new Error('Odaberi proizvod za cart dugme.');
      el.setAttribute('type', 'button');
      el.dataset.kfAtc = '1';
      el.dataset.kveProductId = String(product.id);
      if (variant) {
        el.dataset.kveVariantId = String(variant.id || variant.variant_id || variant.label || '');
        el.dataset.kveVariantLabel = String(variant.label || '');
      } else {
        delete el.dataset.kveVariantId;
        delete el.dataset.kveVariantLabel;
      }
      el.setAttribute('data-product', JSON.stringify(buildAtcDataPayload(product, variant)));
      el.removeAttribute('href');
      el.removeAttribute('target');
      el.removeAttribute('rel');
      el.removeAttribute('onclick');
      delete el.dataset.kveLinkHref;
      enableFlexibleEditorButton(el);
      return;
    }

    delete el.dataset.kfAtc;
    delete el.dataset.kveProductId;
    delete el.dataset.kveVariantId;
    delete el.dataset.kveVariantLabel;
    el.removeAttribute('data-product');

    if (mode === 'hyperlink') {
      if (!href) throw new Error('URL link je obavezan za hyperlink dugme.');
      const target = String(options?.target || '_self');
      el.dataset.kveLinkHref = href;
      if (el.tagName === 'A') {
        el.setAttribute('href', href);
        el.setAttribute('target', target);
        if (target === '_blank') el.setAttribute('rel', 'noopener noreferrer');
        else el.removeAttribute('rel');
      } else {
        el.setAttribute('type', 'button');
        if (target === '_blank') {
          el.setAttribute('onclick', `window.open(${JSON.stringify(href)},'_blank','noopener');`);
        } else {
          el.setAttribute('onclick', `window.location.href=${JSON.stringify(href)};`);
        }
      }
      enableFlexibleEditorButton(el);
      return;
    }

    delete el.dataset.kveLinkHref;
    el.removeAttribute('href');
    el.removeAttribute('target');
    el.removeAttribute('rel');
    el.removeAttribute('onclick');
    enableFlexibleEditorButton(el);
  }

  function buildHyperlinkButtonNode(options) {
    const button = document.createElement('button');
    const iconMarkup = options.customIconUrl
      ? `<img src="${esc(options.customIconUrl)}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:999px" />`
      : getKvePresetIcon(options.iconPreset || 'cart');
    button.type = 'button';
    button.dataset.kveGenerated = '1';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:12px;padding:14px 24px;border:none;border-radius:18px;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#ffffff;font-size:16px;font-weight:700;box-shadow:0 18px 40px rgba(37,99,235,0.24);cursor:pointer;transition:transform .25s ease, box-shadow .25s ease;';
    button.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;color:currentColor">${iconMarkup}</span><span>${esc(options.label || 'Saznaj vise')}</span>`;
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-3px) scale(1.01)';
      button.style.boxShadow = '0 24px 48px rgba(37,99,235,0.28)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = '';
      button.style.boxShadow = '0 18px 40px rgba(37,99,235,0.24)';
    });
    applyButtonFunctionConfig(button, {
      mode: 'hyperlink',
      label: options.label || 'Saznaj vise',
      href: options.href || '#',
      preserveContent: true,
    });
    return button;
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

  function getEditorPageStorageKey() {
    return `keyify_page_override_${getPageSlug()}`;
  }

  function isEditorNavigationElement(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement || null;
    if (!el?.closest) return false;
    return !!el.closest('nav, [role="navigation"], .dropdown-menu, .dropdown-content, .submenu, .menu-items');
  }

  function buildEditorPageSnapshotHtml() {
    const target = document.querySelector('main');
    if (!target) return '';
    const clone = target.cloneNode(true);
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
    clone.querySelectorAll(editorSelectors.join(', ')).forEach((el) => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-original-text]').forEach((el) => el.removeAttribute('data-original-text'));
    clone.querySelectorAll('[data-kve-bg-class]').forEach((el) => el.removeAttribute('data-kve-bg-class'));
    clone.querySelectorAll('[data-kve-smart]').forEach((el) => el.removeAttribute('data-kve-smart'));
    clone.querySelectorAll('.kve-text-editable').forEach((el) => el.classList.remove('kve-text-editable'));
    clone.querySelectorAll('.kve-smart-editing').forEach((el) => el.classList.remove('kve-smart-editing'));
    /* Unwrap .kve-wrap product wrappers and strip data-kve so cards re-init on hydrate */
    clone.querySelectorAll('.kve-wrap').forEach((wrap) => {
      while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });
    clone.querySelectorAll('[data-kve]').forEach((el) => el.removeAttribute('data-kve'));
    /* Strip runtime cart-wiring state so buttons re-initialize on hydrate */
    clone.querySelectorAll('[data-add-to-cart]').forEach((el) => {
      el.removeAttribute('data-add-to-cart');
      el.removeAttribute('disabled');
      el.style.background = '';
      el.style.display = '';
      el.style.alignItems = '';
      el.style.gap = '';
    });
    /* Clear product-grid contents — inline storefront re-renders fresh products */
    const gridClone = clone.querySelector('#product-grid');
    if (gridClone) gridClone.innerHTML = '';
    /* Reset hero featured product title to loading state — keyify.js re-renders on page load */
    const fpTitle = clone.querySelector('#hero-fp-title');
    if (fpTitle) fpTitle.textContent = 'U\u010ditavanje...';
    const fpDesc = clone.querySelector('#hero-fp-desc');
    if (fpDesc) fpDesc.textContent = '';
    const fpPrice = clone.querySelector('#hero-fp-price');
    if (fpPrice) fpPrice.textContent = '';
    return clone.innerHTML;
  }

  function persistEditorPageSnapshotLocally(html) {
    try {
      localStorage.setItem(getEditorPageStorageKey(), html);
    } catch {}
  }

  async function autosaveEditorPageSnapshot(options = {}) {
    const { remote = false, toastOnError = false } = options;
    const html = buildEditorPageSnapshotHtml();
    persistEditorPageSnapshotLocally(html);
    if (!remote) return true;

    try {
      const slug = getPageSlug();
      const res = await fetch(`${API}/pages/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug, html }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Greška pri čuvanju stranice.');
      }
      return true;
    } catch (error) {
      if (toastOnError) toastMsg(`✗ ${error.message || 'Greška pri čuvanju stranice.'}`, true);
      return false;
    }
  }

  async function hydrateEditorPageSnapshot() {
    const target = document.querySelector('main');
    if (!target) return;

    let html = '';
    try {
      html = localStorage.getItem(getEditorPageStorageKey()) || '';
      /* Discard corrupted snapshots that contain full body (header/footer/scripts) */
      if (html && (html.includes('<header') || html.includes('<footer') || html.includes('<script'))) {
        localStorage.removeItem(getEditorPageStorageKey());
        html = '';
      }
    } catch {}

    if (!html) {
      try {
        const res = await fetch(`${API}/pages/${encodeURIComponent(getPageSlug())}`);
        const payload = await res.json().catch(() => ({}));
        if (res.ok && typeof payload.html === 'string' && payload.html.trim()) {
          html = payload.html;
        }
      } catch {}
    }

    /* Discard corrupted snapshots that contain full body content */
    if (html && (html.includes('<header') || html.includes('<footer') || html.includes('<script'))) {
      html = '';
      localStorage.removeItem(getEditorPageStorageKey());
    }

    if (html && html.trim()) {
      /* Preserve live product-grid element so inline storefront scripts keep their reference */
      const liveGrid = target.querySelector('#product-grid');
      target.innerHTML = html;
      if (liveGrid) {
        const snapshotGrid = target.querySelector('#product-grid');
        if (snapshotGrid) snapshotGrid.replaceWith(liveGrid);
      }
    }
  }

  const CATEGORIES = [
    { value: 'ai',        label: 'AI Alati',            page_slug: 'ai' },
    { value: 'design',    label: 'Design & Creativity', page_slug: 'design' },
    { value: 'business',  label: 'Business Software',   page_slug: 'business' },
    { value: 'windows',   label: 'Windows & Office',    page_slug: 'windows' },
    { value: 'music',     label: 'Music Streaming',     page_slug: 'music' },
    { value: 'streaming', label: 'TV/Video Streaming',  page_slug: 'streaming' },
  ];
  let categoryCache = CATEGORIES.slice();
  let categoriesLoadedFromApi = false;
  let categoryRequest = null;

  function normalizeCategoryValue(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[()]/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function mapCategory(category, index) {
    const value = normalizeCategoryValue(category?.slug || category?.value || category?.page_slug || category?.name || category?.label);
    return {
      id: category?.id || null,
      value,
      label: category?.name || category?.label || value || `Kategorija ${index + 1}`,
      page_slug: normalizeCategoryValue(category?.page_slug || category?.slug || category?.value || category?.name || category?.label) || value,
    };
  }

  function getFallbackCategories() {
    return CATEGORIES.map((category, index) => mapCategory(category, index));
  }

  async function getCategories(forceRefresh) {
    if (!forceRefresh && categoriesLoadedFromApi && categoryCache?.length) return categoryCache;
    if (!forceRefresh && categoryRequest) return categoryRequest;

    categoryRequest = fetch(`${API}/categories`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Greška ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload) || !payload.length) {
          return getFallbackCategories();
        }
        return payload.map(mapCategory).filter((category) => category.value);
      })
      .catch((error) => {
        console.warn('[KVE] categories fallback:', error.message);
        return getFallbackCategories();
      })
      .then((categories) => {
        categoryCache = categories;
        categoriesLoadedFromApi = true;
        categoryRequest = null;
        return categories;
      });

    return categoryRequest;
  }

  function getCurrentPageCategory(categories) {
    const pageSlug = normalizeCategoryValue(getPageSlug());
    const pool = Array.isArray(categories) && categories.length ? categories : (categoryCache?.length ? categoryCache : getFallbackCategories());
    const match = pool.find((category) => {
      const slugs = [category.value, category.page_slug].map(normalizeCategoryValue);
      return slugs.includes(pageSlug);
    });
    return match?.value || 'ai';
  }

  function getCategoryOptionsHtml(selectedValue, categories) {
    const pool = Array.isArray(categories) && categories.length ? categories : (categoryCache?.length ? categoryCache : getFallbackCategories());
    const resolvedValue = normalizeCategoryValue(selectedValue) || getCurrentPageCategory(pool);
    return pool.map((category) => {
      const selected = normalizeCategoryValue(category.value) === resolvedValue ? ' selected' : '';
      const dataId = category.id ? ` data-category-id="${esc(category.id)}"` : '';
      const pageSlug = category.page_slug ? ` data-page-slug="${esc(category.page_slug)}"` : '';
      return `<option value="${esc(category.value)}"${selected}${dataId}${pageSlug}>${esc(category.label)}</option>`;
    }).join('');
  }

  async function hydrateCategorySelect(select, preferredValue) {
    if (!select) return;
    const categories = await getCategories();
    select.innerHTML = getCategoryOptionsHtml(preferredValue, categories);
  }

  function getCategoryContextItemsHtml(categories) {
    const pool = Array.isArray(categories) && categories.length ? categories : (categoryCache?.length ? categoryCache : getFallbackCategories());
    return pool.map((category) => `<div class="kve-ctx-item" data-cat="${esc(category.value)}">${esc(category.label)}</div>`).join('');
  }

  function bindCategoryContextItems(menu, id) {
    menu.querySelectorAll('.kve-ctx-item[data-cat]').forEach((item) => {
      item.addEventListener('click', () => { moveToCategory(id, item.dataset.cat); removeContextMenu(); });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     3. BOOT
  ──────────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  async function boot() {
    await hydrateEditorPageSnapshot();

    /* Re-render dynamic components after snapshot hydration so editor matches public view */
    if (typeof KEYIFY !== 'undefined') {
      if (KEYIFY.repairVisibleText) KEYIFY.repairVisibleText(document.body);
      if (KEYIFY._initHeroRating) KEYIFY._initHeroRating();
      if (KEYIFY._initHeroFeaturedProduct) KEYIFY._initHeroFeaturedProduct();
      if (KEYIFY._wireProductButtons) KEYIFY._wireProductButtons();
      if (KEYIFY.LANG) KEYIFY.LANG.apply();
    }


    injectStyles();
    injectPdpVariantEditorStyles();
    injectButtonStudioStyles();
    injectToolbar();
    watchGrid();
    initContentEditor();        // existing: [data-ck] key/value text fields
    initSmartEngine();          // Universal click delegator (replaces initGlobalTextEditing)
    initSectionHoverControls(); // Floating toolbar on section/header/article hover
    injectButtonStudioPanel();
    injectAddSectionBtn();      // NEW: + Dodaj novu sekciju button
    initPdpVariantEditor();
  }

  function injectPdpVariantEditorStyles() {
    if (document.getElementById('kve-pdp-variant-styles')) return;
    const s = document.createElement('style');
    s.id = 'kve-pdp-variant-styles';
    s.textContent = `
      body.kve-active #pdp-variants.kve-pdp-variant-editor {
        align-items: stretch;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .variant-btn.kve-pdp-editable {
        position: relative;
        padding-top: 24px;
        min-width: 152px;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .variant-btn.kve-pdp-editable .kve-pdp-variant-tools {
        position: absolute;
        top: 6px;
        right: 6px;
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity .15s ease;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .variant-btn.kve-pdp-editable:hover .kve-pdp-variant-tools,
      body.kve-active #pdp-variants.kve-pdp-variant-editor .variant-btn.kve-pdp-editable.kve-pdp-open .kve-pdp-variant-tools {
        opacity: 1;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-icon {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-icon.edit {
        background: #1D6AFF;
        color: #fff;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-icon.delete {
        background: #ef4444;
        color: #fff;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-add {
        min-width: 152px;
        min-height: 88px;
        padding: 12px 16px;
        border: 2px dashed rgba(29,106,255,0.45);
        border-radius: 16px;
        background: rgba(29,106,255,0.05);
        color: #1D6AFF;
        font: inherit;
        font-weight: 700;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        transition: transform .15s ease, border-color .15s ease, background .15s ease;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-add:hover {
        transform: translateY(-2px);
        border-color: #1D6AFF;
        background: rgba(29,106,255,0.1);
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-add .plus {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: 2px dashed currentColor;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        line-height: 1;
      }
      body.kve-active #pdp-variants.kve-pdp-variant-editor .kve-pdp-variant-add .label {
        font-size: 12px;
        letter-spacing: .01em;
      }
      body.kve-active #pdp-variants-section .kve-pdp-editor-hint {
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.4;
        color: #6b7280;
      }
    `;
    document.head.appendChild(s);
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
          ${getCategoryOptionsHtml(currentCat)}
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
      <div class="kve-draft-variants-zone" style="margin-top:8px">
        <div style="font-size:11px;font-weight:700;color:#a0a0c0;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Paketi / Varijante (opciono)</div>
        <div class="kve-draft-variants-list" style="display:flex;flex-direction:column;gap:4px"></div>
        <button type="button" class="kve-draft-add-variant" style="margin-top:4px;font-size:11px;font-weight:600;color:#1D6AFF;background:rgba(29,106,255,0.1);border:none;border-radius:6px;padding:4px 10px;cursor:pointer">+ Dodaj paket</button>
      </div>
      <div class="kve-draft-actions">
        <button class="kve-draft-save">✓ Sačuvaj</button>
        <button class="kve-draft-cancel">✕ Otkaži</button>
      </div>
    `;
    grid.insertBefore(wrap, addWrap);
    hydrateCategorySelect(wrap.querySelector('.kve-draft-cat'), currentCat);
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

    /* ── Variant repeater wiring ── */
    const variantList = wrap.querySelector('.kve-draft-variants-list');
    const addVarBtn = wrap.querySelector('.kve-draft-add-variant');
    addVarBtn.addEventListener('click', () => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center';
      row.innerHTML = `
        <input type="text" class="kve-vr-label" placeholder="Label (npr. 1 mjesec)" style="flex:1;font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;outline:none"/>
        <input type="number" class="kve-vr-price" placeholder="Cijena €" step="0.01" style="width:80px;font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;outline:none"/>
        <button type="button" style="width:22px;height:22px;border:none;background:rgba(220,38,38,0.2);color:#f87171;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center" onclick="this.parentElement.remove()">×</button>`;
      variantList.appendChild(row);
    });

    setTimeout(() => wrap.querySelector('.kve-draft-name').focus(), 50);
  }

  function collectDraftVariants(wrap) {
    const rows = wrap.querySelectorAll('.kve-draft-variants-list > div');
    return Array.from(rows).map(r => ({
      label: r.querySelector('.kve-vr-label')?.value?.trim() || '',
      price: r.querySelector('.kve-vr-price')?.value || '',
    })).filter(v => v.label && v.price);
  }

  function showKveToast(msg, type) {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999999;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:700;font-family:Inter,sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.3);transition:opacity .3s`;
    t.style.background = type === 'error' ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : 'linear-gradient(135deg,#1D6AFF,#A259FF)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
  }

  async function submitDraftCard(wrap) {
    const name  = wrap.querySelector('.kve-draft-name').textContent.trim();
    const desc  = wrap.querySelector('.kve-draft-desc').textContent.trim();
    const priceInput = wrap.querySelector('.kve-draft-price').value;
    const price = parseFloat(priceInput);
    const catSelect = wrap.querySelector('.kve-draft-cat');
    const selectedCategory = catSelect?.options?.[catSelect.selectedIndex] || null;
    const cat   = selectedCategory?.value || catSelect?.value || getCurrentPageCategory();
    const img   = wrap.querySelector('.kve-draft-img').value.trim();
    const variants = collectDraftVariants(wrap);
    const variantPrices = variants
      .map((variant) => parseFloat(variant.price))
      .filter((variantPrice) => Number.isFinite(variantPrice) && variantPrice > 0);
    const resolvedPrice = Number.isFinite(price) && price > 0 ? price : (variantPrices.length ? Math.min(...variantPrices) : NaN);

    if (!name) {
      wrap.querySelector('.kve-draft-name').focus();
      wrap.querySelector('.kve-draft-name').style.borderColor = '#ef4444';
      return;
    }
    if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
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
      price: Number.isFinite(price) && price > 0 ? price : '',
      category: cat,
      category_id: selectedCategory?.dataset?.categoryId || null,
      image_url: img || null,
    };
    if (l === 'en') { body.name_en = name; body.description_en = desc; }
    else            { body.name_sr = name; body.description_sr = desc; }
    if (variants.length) body.variants = JSON.stringify(variants);

    try {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Greška ${res.status}`);
      showKveToast('Proizvod uspešno dodat!');
      wrap.remove();
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error('[KVE] submitDraftCard error:', err);
      showKveToast(err.message || 'Greška pri kreiranju proizvoda', 'error');
      saveBtn.textContent = '✓ Sačuvaj'; saveBtn.disabled = false;
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     7. INIT SINGLE PRODUCT CARD
  ──────────────────────────────────────────────────────────────────── */
  function initPdpVariantEditor() {
    if (!document.getElementById('pdp-variants')) return;
    const sync = (event) => {
      const product = event?.detail?.product || window.KEYIFY_PDP_PRODUCT || null;
      if (!product) return;
      enhancePdpVariantEditor(product);
    };
    window.addEventListener('keyify:pdp-rendered', sync);
    setTimeout(sync, 180);
  }

  function enhancePdpVariantEditor(product) {
    const section = document.getElementById('pdp-variants-section');
    const container = document.getElementById('pdp-variants');
    const label = document.getElementById('pdp-variants-label');
    if (!section || !container || !product || product.id == null) return;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (label) label.textContent = variants.length ? 'Izaberite paket' : 'Paketi proizvoda';
    section.style.display = 'block';
    container.classList.add('kve-pdp-variant-editor');

    container.querySelectorAll('[data-kve-pdp-variant-editor="1"]').forEach((node) => node.remove());
    container.querySelectorAll('.variant-btn').forEach((btn, index) => {
      btn.classList.add('kve-pdp-editable');
      btn.dataset.kveVariantIndex = String(index);
      btn.ondblclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPdpVariantModal(product, index);
      };

      const tools = document.createElement('div');
      tools.className = 'kve-pdp-variant-tools';
      tools.setAttribute('data-kve-editor', '1');
      tools.setAttribute('data-kve-pdp-variant-editor', '1');

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'kve-pdp-variant-icon edit';
      editBtn.textContent = '✎';
      editBtn.title = 'Uredi paket';
      editBtn.setAttribute('data-kve-editor', '1');
      editBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPdpVariantModal(product, index);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'kve-pdp-variant-icon delete';
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Obriši paket';
      deleteBtn.setAttribute('data-kve-editor', '1');
      deleteBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deletePdpVariant(product, index);
      });

      tools.appendChild(editBtn);
      tools.appendChild(deleteBtn);
      btn.appendChild(tools);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'kve-pdp-variant-add';
    addBtn.setAttribute('data-kve-editor', '1');
    addBtn.setAttribute('data-kve-pdp-variant-editor', '1');
    addBtn.innerHTML = '<span class="plus">+</span><span class="label">Dodaj paket</span>';
    addBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPdpVariantModal(product, -1);
    });
    container.appendChild(addBtn);

    let hint = section.querySelector('.kve-pdp-editor-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'kve-pdp-editor-hint';
      hint.textContent = 'Klik na paket ga bira, a olovka ili dupli klik otvara izmenu imena i cene.';
      hint.setAttribute('data-kve-editor', '1');
      hint.setAttribute('data-kve-pdp-variant-editor', '1');
      section.appendChild(hint);
    }
  }

  function normalizePdpVariants(variants) {
    return (Array.isArray(variants) ? variants : [])
      .map((variant) => {
        const label = String(variant?.label || '').trim();
        const price = parseFloat(variant?.price);
        const originalPrice = variant?.original_price === '' || variant?.original_price == null
          ? null
          : parseFloat(variant.original_price);
        if (!label || !Number.isFinite(price) || price <= 0) return null;
        return {
          label,
          price,
          original_price: Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
          variant_type: variant?.variant_type || 'duration',
        };
      })
      .filter(Boolean);
  }

  function openPdpVariantModal(product, index) {
    const source = window.KEYIFY_PDP_PRODUCT || product;
    const variants = Array.isArray(source?.variants) ? source.variants : [];
    const variant = index >= 0 ? variants[index] : null;
    const editing = index >= 0 && !!variant;
    const modal = createModal(editing ? '📦 Uredi paket' : '📦 Dodaj paket', `
      <label>Naziv paketa</label>
      <input type="text" id="kve-pdp-variant-label" value="${esc(variant?.label || '')}" placeholder="npr. 3 meseca"/>
      <label>Cijena (€)</label>
      <input type="number" id="kve-pdp-variant-price" min="0.01" step="0.01" value="${esc(variant?.price != null ? parseFloat(variant.price).toFixed(2) : '')}" placeholder="npr. 19.99"/>
      <label>Stara cijena (€) - opciono</label>
      <input type="number" id="kve-pdp-variant-original" min="0" step="0.01" value="${esc(variant?.original_price != null ? parseFloat(variant.original_price).toFixed(2) : '')}" placeholder="ostavite prazno ako nema popusta"/>
    `);
    modal.ok.textContent = editing ? 'Sačuvaj paket' : 'Dodaj paket';
    modal.ok.addEventListener('click', async () => {
      const labelInput = modal.overlay.querySelector('#kve-pdp-variant-label');
      const priceInput = modal.overlay.querySelector('#kve-pdp-variant-price');
      const originalInput = modal.overlay.querySelector('#kve-pdp-variant-original');
      const nextLabel = labelInput.value.trim();
      const nextPrice = parseFloat(priceInput.value);
      const nextOriginal = originalInput.value.trim() ? parseFloat(originalInput.value) : null;

      if (!nextLabel) {
        labelInput.focus();
        labelInput.style.borderColor = '#ef4444';
        return;
      }
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
        priceInput.focus();
        priceInput.style.borderColor = '#ef4444';
        return;
      }

      const nextVariants = variants.slice();
      const payload = {
        label: nextLabel,
        price: nextPrice,
        original_price: Number.isFinite(nextOriginal) && nextOriginal > 0 ? nextOriginal : null,
        variant_type: variant?.variant_type || 'duration',
      };
      if (editing) nextVariants[index] = { ...variant, ...payload };
      else nextVariants.push(payload);

      modal.ok.disabled = true;
      modal.ok.textContent = 'Čuvanje...';
      try {
        await savePdpVariants(source.id, nextVariants, editing ? 'Paket uspešno sačuvan!' : 'Paket uspešno dodat!');
        closeModal(modal.overlay);
      } catch (error) {
        showKveToast(error.message || 'Greška pri čuvanju paketa', 'error');
        modal.ok.disabled = false;
        modal.ok.textContent = editing ? 'Sačuvaj paket' : 'Dodaj paket';
      }
    });
    setTimeout(() => modal.overlay.querySelector('#kve-pdp-variant-label')?.focus(), 60);
  }

  async function deletePdpVariant(product, index) {
    const source = window.KEYIFY_PDP_PRODUCT || product;
    const variants = Array.isArray(source?.variants) ? source.variants : [];
    const target = variants[index];
    if (!target) return;
    if (!confirm(`Obrisati paket "${target.label}"?`)) return;
    const nextVariants = variants.filter((_, variantIndex) => variantIndex !== index);
    try {
      await savePdpVariants(source.id, nextVariants, 'Paket uspešno obrisan!');
    } catch (error) {
      showKveToast(error.message || 'Greška pri brisanju paketa', 'error');
    }
  }

  async function savePdpVariants(productId, variants, successMessage) {
    const normalized = normalizePdpVariants(variants);
    const res = await fetch(`${API}/products/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ variants: JSON.stringify(normalized) }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || `Greška ${res.status}`);
    }

    const freshRes = await fetch(`${API}/products/${productId}`);
    if (!freshRes.ok) throw new Error('Paket je sačuvan, ali osvežavanje prikaza nije uspelo');
    const freshProduct = await freshRes.json();
    window.KEYIFY_PDP_PRODUCT = freshProduct;
    if (typeof window.KEYIFY_PDP_SET_PRODUCT === 'function') {
      window.KEYIFY_PDP_SET_PRODUCT(freshProduct);
    } else {
      enhancePdpVariantEditor(freshProduct);
    }
    showKveToast(successMessage || 'Paketi uspešno sačuvani!');
  }

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
    bar.setAttribute('data-kve-editor', '1');
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
      <div class="kve-ctx-cats">${getCategoryContextItemsHtml()}</div>
    `;
    const x = Math.min(e.clientX + 4, window.innerWidth  - 210);
    const y = Math.min(e.clientY + 4, window.innerHeight - 320);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    document.body.appendChild(menu);

    menu.querySelector('.kve-ctx-sale').addEventListener('click', () => {
      toggleSaleBadge(id, hasSale, cardWrap); removeContextMenu();
    });
    bindCategoryContextItems(menu, id);
    getCategories().then((categories) => {
      const target = menu.querySelector('.kve-ctx-cats');
      if (!target || !menu.isConnected) return;
      target.innerHTML = getCategoryContextItemsHtml(categories);
      bindCategoryContextItems(menu, id);
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

    try {
      const ok = await autosaveEditorPageSnapshot({ remote: true });
      if (!ok) throw new Error('Server greška');
      const slug = getPageSlug();
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

  function showEditorLoadingOverlay(text = 'Učitavanje panela...') {
    const overlay = document.createElement('div');
    overlay.className = 'kve-overlay';
    overlay.setAttribute('data-kve-editor', '1');
    overlay.style.zIndex = '1000002';
    overlay.innerHTML = `
      <div class="kve-modal" style="max-width:280px;text-align:center;padding:28px 24px">
        <div style="width:42px;height:42px;margin:0 auto 16px;border-radius:999px;border:4px solid rgba(148,163,184,0.28);border-top-color:#60a5fa;animation:kve-elem-spin .7s linear infinite"></div>
        <div style="color:#eef2ff;font-weight:700;font-size:15px;line-height:1.45">${esc(text)}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    return { overlay, startedAt: Date.now() };
  }

  async function hideEditorLoadingOverlay(state, minDuration = 220) {
    if (!state?.overlay) return;
    const elapsed = Date.now() - (state.startedAt || Date.now());
    const remaining = Math.max(0, minDuration - elapsed);
    if (remaining) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    state.overlay.remove();
  }

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
  let _openButtonEditModalFn = null; // bridge: set by initElementHoverControls

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
      'h1,h2,h3,h4,h5,h6,p,span,a,button,input,textarea,select,img,nav,ul,ol,li,div'
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

    /* ── Social link: small <a> whose only/primary child is an icon (svg or <i>) ── */
    /* Skip category cards and large link blocks — only treat compact icon-only links as social */
    if (tag === 'A' && !inNav && el.querySelector('svg, i')
        && el.children.length <= 2 && el.textContent.trim().length < 30) return 'sociallink';

    /* ── Skip text-type elements inside footer ── */
    if (el.closest('footer') && ['H1','H2','H3','H4','H5','H6','P','SPAN','DIV'].includes(tag)) return null;

    /* ── Rating component ── */
    if (el.dataset.kveRating !== undefined) return 'rating';

    /* ── Generic content types ── */
    if (['H1','H2','H3','H4','H5','H6'].includes(tag)) return 'heading';
    if (tag === 'P') return 'text';
    if (tag === 'SPAN' && el.textContent.trim().length > 0) return 'text';
    if (tag === 'DIV') {
      /* Only treat leaf-like divs (no block children) with short text as editable */
      const _BLOCK = new Set(['DIV','P','SECTION','ARTICLE','HEADER','FOOTER','NAV','UL','OL','TABLE','FORM','ASIDE','MAIN','BLOCKQUOTE','PRE','DL','FIGURE','DETAILS']);
      const hasBlock = Array.from(el.children).some(c => _BLOCK.has(c.tagName));
      if (!hasBlock && el.textContent.trim().length > 0 && el.textContent.trim().length < 200) return 'text';
      return null;
    }
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
    if (['link','button','input','select','image','navlink','sociallink','rating'].includes(type)) {
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
      /* Remove element hover toolbar if present (it would become part of editable content) */
      el.querySelectorAll('.kve-elem-btns').forEach(b => b.remove());
      el.classList.remove('kve-elem-wrap');
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
      rating: 'Ocena',
    };

    let btns = `<span class="kve-st-label">✦ ${labels[type] || type}</span><div class="kve-st-sep"></div>`;

    if (type === 'rating') {
      btns += `<button data-kve-action="rating-edit">⭐ Uredi ocenu</button>`;
    }
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
        <button data-kve-action="btn-function">⚙️ Funkcija</button>
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

  function _openRatingEditModal(el) {
    const currentRating = parseFloat(el.dataset.rating) || 0;
    const currentMax = parseInt(el.dataset.ratingMax, 10) || 5;
    const currentCount = parseInt(el.dataset.reviewCount, 10) || 0;
    const currentTitle = el.dataset.ratingTitle || 'Prose\u010dna ocena';
    const currentShowStars = el.dataset.showStars !== '0';
    const currentShowCount = el.dataset.showCount !== '0';

    const modal = createModal('\u2b50 Uredi ocenu', `
      <label>Naslov</label>
      <input type="text" id="kve-rating-title" value="${esc(currentTitle)}" placeholder="Prose\u010dna ocena" style="width:100%"/>
      <label style="margin-top:10px">Ocena (0.0 \u2013 max)</label>
      <input type="number" id="kve-rating-val" value="${currentRating.toFixed(1)}" min="0" max="${currentMax}" step="0.1" style="width:100%"/>
      <label style="margin-top:10px">Maksimalna ocena</label>
      <input type="number" id="kve-rating-max" value="${currentMax}" min="1" max="10" step="1" style="width:100%"/>
      <label style="margin-top:10px">Broj recenzija</label>
      <input type="number" id="kve-rating-count" value="${currentCount}" min="0" step="1" style="width:100%"/>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#c0c0e0">
          <input type="checkbox" id="kve-rating-show-stars" ${currentShowStars ? 'checked' : ''} style="accent-color:#1D6AFF"/>
          Prika\u017ei zvezdice
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#c0c0e0">
          <input type="checkbox" id="kve-rating-show-count" ${currentShowCount ? 'checked' : ''} style="accent-color:#1D6AFF"/>
          Prika\u017ei broj recenzija
        </label>
      </div>
      <div id="kve-rating-preview" style="margin-top:12px;display:flex;align-items:center;gap:6px"></div>
    `);

    const titleInput = modal.overlay.querySelector('#kve-rating-title');
    const ratingInput = modal.overlay.querySelector('#kve-rating-val');
    const maxInput = modal.overlay.querySelector('#kve-rating-max');
    const countInput = modal.overlay.querySelector('#kve-rating-count');
    const showStarsInput = modal.overlay.querySelector('#kve-rating-show-stars');
    const showCountInput = modal.overlay.querySelector('#kve-rating-show-count');
    const preview = modal.overlay.querySelector('#kve-rating-preview');

    const updatePreview = () => {
      const max = Math.max(1, parseInt(maxInput.value, 10) || 5);
      const val = Math.max(0, Math.min(max, parseFloat(ratingInput.value) || 0));
      ratingInput.max = max;
      const showS = showStarsInput.checked;
      if (typeof KEYIFY !== 'undefined' && KEYIFY.renderStarRating) {
        preview.innerHTML = (showS ? KEYIFY.renderStarRating(val, max) : '') + ' <span style="font-size:13px;font-weight:600;color:#e0e0f0">' + val.toFixed(1) + ' / ' + max + '.0</span>';
      }
    };
    ratingInput.addEventListener('input', updatePreview);
    maxInput.addEventListener('input', updatePreview);
    showStarsInput.addEventListener('change', updatePreview);
    updatePreview();

    modal.ok.addEventListener('click', async () => {
      const maxR = Math.max(1, parseInt(maxInput.value, 10) || 5);
      const rating = Math.max(0, Math.min(maxR, parseFloat(ratingInput.value) || 0));
      const count = Math.max(0, parseInt(countInput.value, 10) || 0);
      const title = titleInput.value.trim() || 'Prose\u010dna ocena';
      const showStars = showStarsInput.checked;
      const showCount = showCountInput.checked;
      closeModal(modal.overlay);

      el.dataset.rating = rating.toFixed(1);
      el.dataset.ratingMax = String(maxR);
      el.dataset.reviewCount = String(count);
      el.dataset.ratingTitle = title;
      el.dataset.showStars = showStars ? '1' : '0';
      el.dataset.showCount = showCount ? '1' : '0';

      /* Let keyify.js rebuild the full component from data attributes */
      if (typeof KEYIFY !== 'undefined' && KEYIFY._initHeroRating) {
        KEYIFY._initHeroRating();
      } else {
        /* Fallback: manual DOM update */
        const titleEl = el.querySelector('.text-xs.text-gray-500');
        const starsEl = el.querySelector('#hero-rating-stars') || el.querySelector('[id$="-rating-stars"]');
        const valueEl = el.querySelector('#hero-rating-value') || el.querySelector('[id$="-rating-value"]');
        const countEl = el.querySelector('#hero-rating-count') || el.querySelector('[id$="-rating-count"]');

        if (titleEl) titleEl.textContent = title;
        if (starsEl && typeof KEYIFY !== 'undefined' && KEYIFY.renderStarRating) {
          starsEl.innerHTML = showStars ? KEYIFY.renderStarRating(rating, maxR) : '';
          starsEl.style.display = showStars ? '' : 'none';
        }
        if (valueEl) valueEl.textContent = rating.toFixed(1) + ' / ' + maxR + '.0';
        if (countEl) {
          countEl.textContent = count + ' recenzija';
          countEl.style.display = showCount ? '' : 'none';
        }
      }

      const snapshotSaved = await autosaveEditorPageSnapshot({ remote: true });
      toastMsg(snapshotSaved ? '\u2b50 Ocena a\u017eurirana' : '\u26a0\ufe0f Ocena a\u017eurirana lokalno', !snapshotSaved);
    });
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

      case 'rating-edit':
        _openRatingEditModal(el);
        break;

      case 'btn-text':
      case 'link-text': {
        const m = createModal('✏️ Uredi tekst', `
          <label>Tekst</label>
          <input type="text" id="kve-st-text-inp" value="${esc(el.textContent.trim())}"/>
        `);
        m.ok.addEventListener('click', async () => {
          const v = m.overlay.querySelector('#kve-st-text-inp').value.trim();
          closeModal(m.overlay);
          if (v) {
            el.textContent = v;
            const saved = await autosaveEditorPageSnapshot({ remote: true });
            toastMsg(saved ? '✏️ Tekst izmijenjen.' : '⚠️ Tekst izmijenjen lokalno.', !saved);
          }
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

      case 'btn-function':
        if (_openButtonEditModalFn) {
          _openButtonEditModalFn(el);
        } else {
          toastMsg('Panel dugmeta nije spreman. Probaj ponovo.', true);
        }
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
    m.ok.addEventListener('click', async () => {
      const href   = m.overlay.querySelector('#kve-href-inp').value.trim();
      const target = m.overlay.querySelector('#kve-href-target').value;
      closeModal(m.overlay);
      if (href) el.setAttribute('href', href);
      el.setAttribute('target', target);
      const saved = await autosaveEditorPageSnapshot({ remote: true });
      toastMsg(saved ? '🔗 Link izmijenjen.' : '⚠️ Link izmijenjen lokalno.', !saved);
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

    m.ok.addEventListener('click', async () => {
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

      const saved = await autosaveEditorPageSnapshot({ remote: true });
      toastMsg(saved ? '🎨 Stil dugmeta izmijenjen.' : '⚠️ Stil izmijenjen lokalno.', !saved);
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
    const socialFieldById = {
      'footer-fb': 'facebook_url',
      'footer-tw': 'twitter_url',
      'footer-ig': 'instagram_url',
    };
    const socialAnimationFieldById = {
      'footer-fb': 'facebook_animation',
      'footer-tw': 'twitter_animation',
      'footer-ig': 'instagram_animation',
    };

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
    const socialTargetSelect = m.overlay.querySelector('#kve-soc-tgt');
    if (socialTargetSelect && socialTargetSelect.parentNode && !m.overlay.querySelector('#kve-soc-anim')) {
      const animLabel = document.createElement('label');
      animLabel.style.marginTop = '14px';
      animLabel.textContent = 'Animacija';
      const animSelect = document.createElement('select');
      animSelect.id = 'kve-soc-anim';
      animSelect.innerHTML = `
        <option value="float" ${String(el.dataset.kfAnim || 'float') === 'float' ? 'selected' : ''}>Float</option>
        <option value="pulse" ${String(el.dataset.kfAnim || '') === 'pulse' ? 'selected' : ''}>Pulse</option>
        <option value="bounce" ${String(el.dataset.kfAnim || '') === 'bounce' ? 'selected' : ''}>Bounce</option>
      `;
      socialTargetSelect.parentNode.insertBefore(animSelect, socialTargetSelect);
      socialTargetSelect.parentNode.insertBefore(animLabel, animSelect);
    }
    m.ok.addEventListener('click', async () => {
      const href    = m.overlay.querySelector('#kve-soc-href').value.trim();
      const anim    = m.overlay.querySelector('#kve-soc-anim').value;
      const tgt     = m.overlay.querySelector('#kve-soc-tgt').value;
      const svgCode = m.overlay.querySelector('#kve-soc-svg').value.trim();
      closeModal(m.overlay);

      if (href) el.setAttribute('href', href);
      el.setAttribute('target', tgt);
      el.classList.add('kf-social-link');
      el.dataset.kfAnim = anim || 'float';

      if (svgCode) {
        const existing = el.querySelector('svg, i');
        if (existing) existing.remove();
        const tmp = document.createElement('div');
        tmp.innerHTML = svgCode;
        const newIcon = tmp.firstElementChild;
        if (newIcon) el.prepend(newIcon);
      }

      const socialField = socialFieldById[el.id];
      const socialAnimationField = socialAnimationFieldById[el.id];
      if (socialField) {
        try {
          const response = await fetch(`${API}/admin/settings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              [socialField]: href || null,
              ...(socialAnimationField ? { [socialAnimationField]: anim || 'float' } : {}),
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `Greška ${response.status}`);
          showKveToast('Social link uspešno sačuvan!');
          return;
        } catch (error) {
          console.error('[KVE] social link save error:', error);
          showKveToast(error.message || 'Greška pri čuvanju social linka', 'error');
          return;
        }
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
  async function openInsertAtcModal(sec) {
    const loadingState = showEditorLoadingOverlay('Učitavanje proizvoda...');
    let products = [];
    try {
      products = await fetchEditorProducts();
    } catch (error) {
      await hideEditorLoadingOverlay(loadingState, 220);
      showKveToast(error.message || 'Greška pri učitavanju proizvoda.', 'error');
      return;
    }

    await hideEditorLoadingOverlay(loadingState);
    if (!products.length) {
      showKveToast('Nema proizvoda za povezivanje ATC dugmeta.', 'error');
      return;
    }

    const options = products.map((product) => {
      const name = product.name_sr || product.name || 'Proizvod';
      return `<option value="${esc(product.id)}">${esc(name)} — €${esc(Number(product.price || 0).toFixed(2))}</option>`;
    }).join('');

    const modal = createModal('🛒 Dodaj ATC dugme', `
      <label>Poveži sa proizvodom</label>
      <select id="kve-atc-product">${options}</select>
      <label style="margin-top:14px">Paket / varijacija</label>
      <select id="kve-atc-variant">
        <option value="">Osnovna cijena proizvoda</option>
      </select>
      <div id="kve-atc-variant-note" style="margin-top:8px;font-size:11px;color:#9090b8">Ako proizvod ima pakete, izaberi konkretan paket koji dugme dodaje u korpu.</div>
      <label style="margin-top:14px">Tekst dugmeta</label>
      <input type="text" id="kve-atc-label" value="Dodaj u korpu" placeholder="npr. Dodaj u korpu"/>
      <label style="margin-top:14px">Preset ikonica</label>
      <select id="kve-atc-icon">
        <option value="cart">Korpa</option>
        <option value="spotify">Spotify</option>
        <option value="netflix">Netflix</option>
        <option value="adobe">Adobe</option>
      </select>
      <label style="margin-top:14px">Custom ikonica URL <span style="color:#5050a0;font-weight:400">(opciono)</span></label>
      <input type="url" id="kve-atc-icon-url" placeholder="https://.../icon.png"/>
      <label style="margin-top:14px">Ili upload ikonice <span style="color:#5050a0;font-weight:400">(PNG / SVG)</span></label>
      <input type="file" id="kve-atc-icon-file" accept="image/png,image/svg+xml,image/webp,image/jpeg"/>
    `);

    const productInput = modal.overlay.querySelector('#kve-atc-product');
    const variantInput = modal.overlay.querySelector('#kve-atc-variant');
    const variantNote = modal.overlay.querySelector('#kve-atc-variant-note');
    let selectedProductDetails = products.find((item) => String(item.id) === String(productInput.value)) || null;

    const syncVariantOptions = async (selectedToken = '') => {
      const productId = productInput.value;
      if (!productId) {
        variantInput.innerHTML = '<option value="">Osnovna cijena proizvoda</option>';
        variantInput.disabled = true;
        variantNote.textContent = 'Prvo odaberi proizvod.';
        return;
      }

      variantInput.disabled = true;
      variantInput.innerHTML = '<option value="">Učitavanje paketa...</option>';
      try {
        selectedProductDetails = await fetchEditorProductDetails(productId);
        const variants = normalizeEditorVariants(selectedProductDetails);
        const preferred = String(selectedToken || '').trim().toLowerCase();
        const rows = variants.map((variant) => {
          const selected = preferred && preferred === variant._token ? ' selected' : '';
          const original = Number.isFinite(parseFloat(variant.original_price))
            ? ` — €${Number(variant.original_price).toFixed(2)}`
            : '';
          return `<option value="${esc(variant._token)}"${selected}>${esc(variant.label || 'Paket')} — €${esc(Number(variant.price).toFixed(2))}${esc(original)}</option>`;
        }).join('');
        variantInput.innerHTML = `<option value="">Osnovna cijena proizvoda</option>${rows}`;
        variantInput.disabled = false;
        variantNote.textContent = variants.length
          ? 'Izabrani paket određuje cijenu i naziv varijacije koja se dodaje u korpu.'
          : 'Ovaj proizvod nema definisane pakete. Dugme će koristiti osnovnu cijenu proizvoda.';
      } catch (error) {
        selectedProductDetails = products.find((item) => String(item.id) === String(productId)) || null;
        variantInput.innerHTML = '<option value="">Osnovna cijena proizvoda</option>';
        variantInput.disabled = true;
        variantNote.textContent = error.message || 'Paketi nisu dostupni za ovaj proizvod.';
      }
    };

    productInput.addEventListener('change', () => { void syncVariantOptions(''); });
    void syncVariantOptions('');

    modal.ok.addEventListener('click', async () => {
      const productId = productInput.value;
      const variantToken = variantInput.value || '';
      const label = modal.overlay.querySelector('#kve-atc-label').value.trim() || 'Dodaj u korpu';
      const iconPreset = modal.overlay.querySelector('#kve-atc-icon').value || 'cart';
      const customUrlInput = modal.overlay.querySelector('#kve-atc-icon-url').value.trim();
      const customFile = modal.overlay.querySelector('#kve-atc-icon-file').files?.[0] || null;
      const product = selectedProductDetails || products.find((item) => String(item.id) === String(productId));
      if (!product) {
        showKveToast('Proizvod nije pronađen.', 'error');
        return;
      }

      modal.ok.disabled = true;
      modal.ok.textContent = 'Dodajem...';

      try {
        const customIconUrl = customFile ? await uploadEditorAsset(customFile) : customUrlInput;
        const variant = resolveEditorVariant(product, variantToken);
        const button = buildAtcButtonNode(product, { label, iconPreset, customIconUrl, variant });
        const wrap = createEditorButtonWrap();
        wrap.appendChild(button);
        findSectionInsertTarget(sec).appendChild(wrap);
        enableFlexibleEditorButton(button);
        const snapshotSaved = await autosaveEditorPageSnapshot({ remote: true });
        closeModal(modal.overlay);
        showKveToast(snapshotSaved ? 'ATC dugme dodato.' : 'ATC dugme dodato lokalno — backend čuvanje nije prošlo.', snapshotSaved ? 'success' : 'error');
      } catch (error) {
        showKveToast(error.message || 'Greška pri dodavanju ATC dugmeta.', 'error');
        modal.ok.disabled = false;
        modal.ok.textContent = 'Sačuvaj';
      }
    });
  }

  async function openInsertLinkButtonModal(sec) {
    const modal = createModal('🔗 Dodaj link dugme', `
      <label>Tekst dugmeta</label>
      <input type="text" id="kve-link-btn-label" value="Saznaj vise" placeholder="npr. Procitaj vise"/>
      <label style="margin-top:14px">URL link</label>
      <input type="url" id="kve-link-btn-href" placeholder="https://..." />
      <label style="margin-top:14px">Preset ikonica</label>
      <select id="kve-link-btn-icon">
        <option value="cart">Korpa</option>
        <option value="spotify">Spotify</option>
        <option value="netflix">Netflix</option>
        <option value="adobe">Adobe</option>
      </select>
      <label style="margin-top:14px">Custom ikonica URL <span style="color:#5050a0;font-weight:400">(opciono)</span></label>
      <input type="url" id="kve-link-btn-icon-url" placeholder="https://.../icon.png"/>
      <label style="margin-top:14px">Ili upload ikonice</label>
      <input type="file" id="kve-link-btn-icon-file" accept="image/png,image/svg+xml,image/webp,image/jpeg"/>
    `);

    modal.ok.addEventListener('click', async () => {
      const label = modal.overlay.querySelector('#kve-link-btn-label').value.trim() || 'Saznaj vise';
      const href = modal.overlay.querySelector('#kve-link-btn-href').value.trim();
      const iconPreset = modal.overlay.querySelector('#kve-link-btn-icon').value || 'cart';
      const customUrlInput = modal.overlay.querySelector('#kve-link-btn-icon-url').value.trim();
      const customFile = modal.overlay.querySelector('#kve-link-btn-icon-file').files?.[0] || null;

      if (!href) {
        showKveToast('URL link je obavezan.', 'error');
        return;
      }

      modal.ok.disabled = true;
      modal.ok.textContent = 'Dodajem...';

      try {
        const customIconUrl = customFile ? await uploadEditorAsset(customFile) : customUrlInput;
        const button = buildHyperlinkButtonNode({ label, href, iconPreset, customIconUrl });
        const wrap = createEditorButtonWrap();
        wrap.appendChild(button);
        findSectionInsertTarget(sec).appendChild(wrap);
        enableFlexibleEditorButton(button);
        const snapshotSaved = await autosaveEditorPageSnapshot({ remote: true });
        closeModal(modal.overlay);
        showKveToast(snapshotSaved ? 'Link dugme dodato.' : 'Link dugme dodato lokalno — backend čuvanje nije prošlo.', snapshotSaved ? 'success' : 'error');
      } catch (error) {
        showKveToast(error.message || 'Greška pri dodavanju link dugmeta.', 'error');
        modal.ok.disabled = false;
        modal.ok.textContent = 'Sačuvaj';
      }
    });
  }

  function injectButtonStudioPanel() {
    if (document.getElementById('kve-button-studio')) return;

    const panel = document.createElement('aside');
    panel.id = 'kve-button-studio';
    panel.setAttribute('data-kve-editor', '1');
    panel.setAttribute('title', 'Prevuci cijeli toolbox ako želiš promijeniti poziciju.');
    panel.innerHTML = `
      <div class="kve-bs-kicker">Button Studio</div>
      <h3 class="kve-bs-title">Prevuci dugme na sekciju</h3>
      <p class="kve-bs-copy">Desni panel je za brzo ubacivanje CTA elemenata. Prevuci karticu na sekciju ili klikni za kratko uputstvo.</p>
      <div class="kve-bs-list">
        <div class="kve-bs-card" draggable="true" data-kve-template="cart">
          <div class="kve-bs-icon">${getKvePresetIcon('cart')}</div>
          <div><span class="kve-bs-name">ATC dugme</span><span class="kve-bs-meta">Povezuje dugme sa proizvodom i direktno dodaje u korpu.</span></div>
        </div>
        <div class="kve-bs-card" draggable="true" data-kve-template="hyperlink">
          <div class="kve-bs-icon">${getKvePresetIcon('adobe')}</div>
          <div><span class="kve-bs-name">Hyperlink dugme</span><span class="kve-bs-meta">CTA koji vodi na bilo koji interni ili eksterni URL.</span></div>
        </div>
        <div class="kve-bs-card" draggable="true" data-kve-template="social">
          <div class="kve-bs-icon">${KVE_SOCIAL_ICON_PRESETS.instagram}</div>
          <div><span class="kve-bs-name">Social ikonica</span><span class="kve-bs-meta">Dodaj Facebook, X ili Instagram link sa animacijom.</span></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    let panelDragState = null;
    const isPanelDragHandleTarget = (node) => {
      if (!node) return false;
      return !node.closest('.kve-bs-card, button, input, select, textarea, a, label');
    };
    const clampPanelPosition = (left, top) => {
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      return {
        left: Math.min(maxLeft, Math.max(8, Math.round(left))),
        top: Math.min(maxTop, Math.max(8, Math.round(top))),
      };
    };
    panel.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (!isPanelDragHandleTarget(event.target)) return;
      const rect = panel.getBoundingClientRect();
      panelDragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      panel.classList.add('kve-bs-dragging');
      panel.style.left = `${Math.round(rect.left)}px`;
      panel.style.top = `${Math.round(rect.top)}px`;
      panel.style.right = 'auto';
      event.preventDefault();
    });
    document.addEventListener('mousemove', (event) => {
      if (!panelDragState) return;
      const pos = clampPanelPosition(event.clientX - panelDragState.offsetX, event.clientY - panelDragState.offsetY);
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      panel.style.right = 'auto';
    }, true);
    document.addEventListener('mouseup', () => {
      if (!panelDragState) return;
      panelDragState = null;
      panel.classList.remove('kve-bs-dragging');
    }, true);
    window.addEventListener('resize', () => {
      if (!panel.isConnected || !panel.style.left) return;
      const pos = clampPanelPosition(parseFloat(panel.style.left || '0'), parseFloat(panel.style.top || '96'));
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
    });

    let activeDropTarget = null;
    const setDropTarget = (target) => {
      if (activeDropTarget && activeDropTarget !== target) {
        activeDropTarget.classList.remove('kve-button-drop-active');
      }
      activeDropTarget = target;
      activeDropTarget?.classList.add('kve-button-drop-active');
    };

    const resolveTarget = (node) => {
      const target = node?.closest?.('section, header, article, [data-kve-block]');
      if (!target || target.closest('[data-kve-editor]')) return null;
      target.classList.add('kve-button-drop-target');
      return target;
    };

    const _hasKveTemplate = (dt) => {
      if (!dt?.types) return false;
      if (typeof dt.types.includes === 'function') return dt.types.includes('text/kve-template');
      if (typeof dt.types.contains === 'function') return dt.types.contains('text/kve-template');
      for (let i = 0; i < dt.types.length; i++) { if (dt.types[i] === 'text/kve-template') return true; }
      return false;
    };

    panel.querySelectorAll('.kve-bs-card').forEach((card) => {
      card.addEventListener('click', () => {
        showKveToast('Prevuci karticu na sekciju gdje želiš ubaciti dugme.', 'info');
      });
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/kve-template', card.dataset.kveTemplate || '');
        event.dataTransfer?.setData('text/plain', card.dataset.kveTemplate || '');
        event.dataTransfer.effectAllowed = 'copy';
      });
      card.addEventListener('dragend', () => {
        setDropTarget(null);
        document.querySelectorAll('.kve-button-drop-target').forEach(el => el.classList.remove('kve-button-drop-target'));
      });
    });

    document.addEventListener('dragover', (event) => {
      if (!_hasKveTemplate(event.dataTransfer)) return;
      const target = resolveTarget(event.target);
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDropTarget(target);
    }, true);

    document.addEventListener('drop', (event) => {
      const template = event.dataTransfer?.getData('text/kve-template')
        || (event.dataTransfer?.getData('text/plain') || '');
      if (!template || !_hasKveTemplate(event.dataTransfer)) return;
      event.preventDefault();
      const target = resolveTarget(event.target) || activeDropTarget;
      setDropTarget(null);
      document.querySelectorAll('.kve-button-drop-target').forEach(el => el.classList.remove('kve-button-drop-target'));
      if (!target) {
        showKveToast('Prevuci karticu na sekciju stranice.', 'error');
        return;
      }
      if (template === 'cart') openInsertAtcModal(target);
      else if (template === 'hyperlink') openInsertLinkButtonModal(target);
      else if (template === 'social') openInsertSocialModal(target);
    }, true);
  }

  async function openInsertSocialModal(sec) {
    const modal = createModal('# Dodaj social ikonicu', `
      <label>Mreža</label>
      <select id="kve-social-network">
        <option value="facebook">Facebook</option>
        <option value="x">X / Twitter</option>
        <option value="instagram">Instagram</option>
      </select>
      <label style="margin-top:14px">URL link</label>
      <input type="url" id="kve-social-href" placeholder="https://..."/>
      <label style="margin-top:14px">Animacija</label>
      <select id="kve-social-anim">
        <option value="float">Float</option>
        <option value="pulse">Pulse</option>
        <option value="bounce">Bounce</option>
      </select>
      <label style="margin-top:14px">Custom ikonica URL <span style="color:#5050a0;font-weight:400">(opciono)</span></label>
      <input type="url" id="kve-social-icon-url" placeholder="https://.../icon.png"/>
      <label style="margin-top:14px">Ili upload ikonice</label>
      <input type="file" id="kve-social-icon-file" accept="image/png,image/svg+xml,image/webp,image/jpeg"/>
    `);

    modal.ok.addEventListener('click', async () => {
      const network = modal.overlay.querySelector('#kve-social-network').value;
      const href = modal.overlay.querySelector('#kve-social-href').value.trim();
      const animation = modal.overlay.querySelector('#kve-social-anim').value || 'float';
      const customUrlInput = modal.overlay.querySelector('#kve-social-icon-url').value.trim();
      const customFile = modal.overlay.querySelector('#kve-social-icon-file').files?.[0] || null;

      if (!href) {
        showKveToast('URL link je obavezan.', 'error');
        return;
      }

      modal.ok.disabled = true;
      modal.ok.textContent = 'Dodajem...';

      try {
        const customIconUrl = customFile ? await uploadEditorAsset(customFile) : customUrlInput;
        const link = buildSocialLinkNode({ network, href, animation, customIconUrl });
        const footerLike = sec.tagName === 'FOOTER' || !!sec.closest('footer');
        const idMap = { facebook: 'footer-fb', x: 'footer-tw', instagram: 'footer-ig' };
        if (footerLike && !document.getElementById(idMap[network])) {
          link.id = idMap[network];
        }

        const existingFooterIcon = footerLike ? document.getElementById(idMap[network]) : null;
        if (existingFooterIcon) {
          existingFooterIcon.replaceWith(link);
        } else {
          const target = sec.querySelector('#footer-fb, #footer-tw, #footer-ig')?.parentElement || findSectionInsertTarget(sec);
          target.appendChild(link);
        }

        if (footerLike) {
          const fieldMap = { facebook: 'facebook_url', x: 'twitter_url', instagram: 'instagram_url' };
          const animFieldMap = { facebook: 'facebook_animation', x: 'twitter_animation', instagram: 'instagram_animation' };
          const response = await fetch(`${API}/admin/settings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              [fieldMap[network]]: href,
              [animFieldMap[network]]: animation,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `Greška ${response.status}`);
        }

        closeModal(modal.overlay);
        showKveToast('Social ikonica dodata. Klikni "Sačuvaj stranicu".');
      } catch (error) {
        showKveToast(error.message || 'Greška pri dodavanju social ikonice.', 'error');
        modal.ok.disabled = false;
        modal.ok.textContent = 'Sačuvaj';
      }
    });
  }

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
    bar.insertAdjacentHTML('beforeend', `
      <button class="kve-sec-add-atc" title="Dodaj ATC dugme">ðŸ›’ ATC</button>
      <button class="kve-sec-add-social" title="Dodaj social ikonicu"># Social</button>
    `);
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
      const fpContainer = sec.querySelector('#hero-featured-product');
      if (fpContainer) {
        openFeaturedProductConfigModal(fpContainer);
      } else {
        openSectionStyleModal(sec);
      }
    });

    bar.querySelector('.kve-sec-add-atc')?.addEventListener('click', e => {
      e.stopPropagation();
      openInsertAtcModal(sec);
    });

    bar.querySelector('.kve-sec-add-social')?.addEventListener('click', e => {
      e.stopPropagation();
      openInsertSocialModal(sec);
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

  /* ── Hero Featured Product Config Modal ── */
  async function openFeaturedProductConfigModal(container) {
    const loadingState = showEditorLoadingOverlay('Učitavanje proizvoda...');
    let products = [];
    try { products = await fetchEditorProducts(); } catch {}
    await hideEditorLoadingOverlay(loadingState, 300);

    const currentMode = container.dataset.mode || 'auto';
    const currentProductId = container.dataset.productId || '';

    const productOptions = products.map(p => {
      const name = p.name_sr || p.name || 'Proizvod';
      const selected = String(p.id) === String(currentProductId) ? ' selected' : '';
      return `<option value="${esc(p.id)}"${selected}>${esc(name)} — €${esc(Number(p.price||0).toFixed(2))}</option>`;
    }).join('');

    const modal = createModal('⚡ Istaknuti proizvod – postavke', `
      <label>Način prikaza</label>
      <select id="kve-fp-mode">
        <option value="auto"${currentMode === 'auto' ? ' selected' : ''}>Automatski (najnoviji proizvod)</option>
        <option value="manual"${currentMode === 'manual' ? ' selected' : ''}>Ručni odabir</option>
      </select>
      <div id="kve-fp-manual-fields" style="margin-top:10px;${currentMode === 'manual' ? '' : 'display:none'}">
        <label>Odaberi proizvod</label>
        <select id="kve-fp-product"${products.length ? '' : ' disabled'}>
          <option value="">— Odaberi —</option>
          ${productOptions}
        </select>
      </div>
    `);

    const modeSelect = modal.overlay.querySelector('#kve-fp-mode');
    const manualFields = modal.overlay.querySelector('#kve-fp-manual-fields');
    modeSelect.addEventListener('change', () => {
      manualFields.style.display = modeSelect.value === 'manual' ? 'block' : 'none';
    });

    modal.ok.addEventListener('click', async () => {
      const mode = modeSelect.value;
      const productId = modal.overlay.querySelector('#kve-fp-product')?.value || '';
      closeModal(modal.overlay);

      container.dataset.mode = mode;
      container.dataset.productId = mode === 'manual' ? productId : '';

      const API_BASE = (window.KEYIFY_CONFIG && window.KEYIFY_CONFIG.API_BASE) || 'http://localhost:3001/api';
      try {
        let product = null;
        if (mode === 'manual' && productId) {
          const res = await fetch(API_BASE + '/products/' + encodeURIComponent(productId));
          if (res.ok) product = await res.json();
        }
        if (!product) {
          const res = await fetch(API_BASE + '/products');
          if (res.ok) {
            const list = await res.json();
            if (list.length) product = list[0];
          }
        }
        if (product && typeof KEYIFY !== 'undefined') {
          KEYIFY._renderHeroFP && KEYIFY._renderHeroFP(container, product);
        }
      } catch {}

      const snapshotSaved = await autosaveEditorPageSnapshot({ remote: true });
      toastMsg(snapshotSaved ? '⚡ Istaknuti proizvod ažuriran' : '⚠️ Ažurirano lokalno', !snapshotSaved);
    });
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
        .kve-elem-btns   { display:none;position:absolute;top:-18px;right:-6px;z-index:99999;
                           gap:8px;align-items:center;pointer-events:all;padding:8px 10px;
                           border-radius:16px;background:rgba(8,10,24,0.84);
                           border:1px solid rgba(255,255,255,0.08);
                           box-shadow:0 18px 42px rgba(0,0,0,.32);
                           backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px); }
        .kve-elem-wrap:hover .kve-elem-btns { display:flex; }
        .kve-elem-btns.kve-elem-btns-floating { display:flex; min-height:50px; }
        .kve-elem-btns.kve-elem-btns-floating::before {
                           content:'';position:absolute;inset:-10px; }
        .kve-elem-btns.kve-elem-btns-loading {
                           justify-content:center;min-width:66px; }
        .kve-elem-btn    { min-width:34px;height:34px;padding:0 10px;font-size:13px;font-weight:700;border:none;border-radius:10px;
                           cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
                           box-shadow:0 8px 20px rgba(0,0,0,.22);line-height:1;display:inline-flex;align-items:center;justify-content:center; }
        .kve-elem-del    { background:rgba(239,68,68,0.88);color:#fff; }
        .kve-elem-del:hover  { background:#ef4444; }
        .kve-elem-edit   { background:rgba(29,106,255,0.88);color:#fff; }
        .kve-elem-edit:hover { background:#1D6AFF; }
        .kve-elem-resize { background:rgba(16,185,129,0.88);color:#fff; }
        .kve-elem-resize:hover { background:#10b981; }
        .kve-elem-toolbar-loader { display:flex;align-items:center;justify-content:center;
                           width:24px;height:24px;border-radius:999px;pointer-events:none; }
        .kve-elem-toolbar-loader::before { content:'';width:22px;height:22px;border-radius:999px;
                           border:3px solid rgba(148,163,184,0.28);border-top-color:#60a5fa;
                           animation:kve-elem-spin .7s linear infinite; }
        @keyframes kve-elem-spin { to { transform:rotate(360deg); } }
        body.kve-active [data-kve-flexible-button="1"] { cursor:grab; user-select:none; }
        body.kve-active [data-kve-flexible-button="1"].kve-btn-dragging { cursor:grabbing; }
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
      if (isEditorNavigationElement(el)) return true;
      if (el.classList.contains('kve-elem-wrap')) return true;
      // Product cards, add-card box, and empty placeholder have their own controls
      if (el.closest('.kve-wrap, .kve-card-bar, .kve-add-card-wrap, .kve-empty-placeholder')) return true;
      return false;
    }

    // Floating btn overlay attached to hovered element
    let _activeWrap = null;
    let _activeFloatingBtns = null;
    let _activeToolbarCleanup = null;
    let _toolbarShowTimer = null;
    let _toolbarHideTimer = null;
    let _buttonDragState = null;
    let _buttonResizeState = null;

    function getEditableHoverTarget(node) {
      if (isEditorNavigationElement(node)) return null;
      return resolveButtonLikeEditableElement(node) || node;
    }

    function cancelToolbarShow() {
      if (_toolbarShowTimer) {
        clearTimeout(_toolbarShowTimer);
        _toolbarShowTimer = null;
      }
    }

    function cancelToolbarHide() {
      if (_toolbarHideTimer) {
        clearTimeout(_toolbarHideTimer);
        _toolbarHideTimer = null;
      }
    }

    function cleanupActiveToolbarBindings() {
      if (typeof _activeToolbarCleanup === 'function') _activeToolbarCleanup();
      _activeToolbarCleanup = null;
    }

    function clearActiveElementOverlay() {
      cancelToolbarShow();
      cancelToolbarHide();
      cleanupActiveToolbarBindings();
      if (_activeWrap) {
        _activeWrap.classList.remove('kve-elem-wrap');
        const oldBtns = _activeWrap.querySelector(':scope > .kve-elem-btns');
        if (oldBtns) oldBtns.remove();
      }
      if (_activeFloatingBtns) {
        _activeFloatingBtns.remove();
        _activeFloatingBtns = null;
      }
      _activeWrap = null;
    }

    function scheduleToolbarHide(delay = 280) {
      cancelToolbarHide();
      _toolbarHideTimer = setTimeout(() => clearActiveElementOverlay(), delay);
    }

    function positionFloatingElementTools(target, panel) {
      if (!target || !panel) return;
      const rect = target.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const top = Math.max(8, rect.top - Math.max(12, Math.round(panelRect.height * 0.35)));
      const left = Math.max(8, Math.min(window.innerWidth - panelRect.width - 8, rect.right - panelRect.width + 6));
      panel.style.position = 'fixed';
      panel.style.display = 'flex';
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
      panel.style.right = 'auto';
    }

    function bindFloatingToolbarLifecycle(target, panel) {
      cleanupActiveToolbarBindings();
      const handleEnter = () => cancelToolbarHide();
      const handleLeave = (event) => {
        const next = event.relatedTarget;
        if (next && (target.contains(next) || panel.contains(next))) return;
        scheduleToolbarHide();
      };
      target.addEventListener('mouseenter', handleEnter);
      target.addEventListener('mouseleave', handleLeave);
      panel.addEventListener('mouseenter', handleEnter);
      panel.addEventListener('mouseleave', handleLeave);
      _activeToolbarCleanup = () => {
        target.removeEventListener('mouseenter', handleEnter);
        target.removeEventListener('mouseleave', handleLeave);
        panel.removeEventListener('mouseenter', handleEnter);
        panel.removeEventListener('mouseleave', handleLeave);
      };
    }

    function renderElementToolbar(el, panel) {
      const useFloatingTools = isButtonLikeEditableElement(el);
      const btnWrap = panel || document.createElement('div');
      btnWrap.className = `kve-elem-btns${useFloatingTools ? ' kve-elem-btns-floating' : ''}`;
      btnWrap.setAttribute('data-kve-editor', '1');
      btnWrap.innerHTML = `<button class="kve-elem-btn kve-elem-del" title="Obriši element">🗑️</button><button class="kve-elem-btn kve-elem-edit" title="Uredi element">⚙️</button>`;
      if (useFloatingTools) {
        if (!btnWrap.isConnected) document.body.appendChild(btnWrap);
        positionFloatingElementTools(el, btnWrap);
        _activeFloatingBtns = btnWrap;
        bindFloatingToolbarLifecycle(el, btnWrap);
      } else {
        el.style.position = el.style.position || (window.getComputedStyle(el).position === 'static' ? 'relative' : '');
        el.appendChild(btnWrap);
      }
      btnWrap.querySelector('.kve-elem-del').addEventListener('click', ev => {
        ev.stopPropagation();
        if (!confirm('Obrisati ovaj element?')) return;
        const removeTarget = getEditorRemovalTarget(el);
        removeTarget.style.transition = 'opacity .25s,transform .25s';
        removeTarget.style.opacity = '0';
        removeTarget.style.transform = 'scale(.95)';
        setTimeout(() => removeTarget.remove(), 260);
        clearActiveElementOverlay();
        toastMsg('🗑️ Element obrisan');
      });
      btnWrap.querySelector('.kve-elem-edit').addEventListener('click', ev => {
        ev.stopPropagation();
        cancelToolbarHide();
        if (isButtonLikeEditableElement(el)) {
          openButtonEditModal(el);
          return;
        }
        openElementEditModal(el);
      });
      if (isButtonLikeEditableElement(el)) {
        enableFlexibleEditorButton(el);
        const resizeBtn = document.createElement('button');
        resizeBtn.className = 'kve-elem-btn kve-elem-resize';
        resizeBtn.title = 'Promijeni veličinu';
        resizeBtn.textContent = '↔';
        btnWrap.appendChild(resizeBtn);
        resizeBtn.addEventListener('mousedown', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          cancelToolbarHide();
          enableFlexibleEditorButton(el);
          _buttonResizeState = {
            el,
            startX: ev.clientX,
            startWidth: el.getBoundingClientRect().width,
          };
        });
      }
      return btnWrap;
    }

    function renderToolbarLoader(el) {
      const loader = document.createElement('div');
      loader.className = 'kve-elem-btns kve-elem-btns-floating kve-elem-btns-loading';
      loader.setAttribute('data-kve-editor', '1');
      loader.innerHTML = '<div class="kve-elem-toolbar-loader"></div>';
      document.body.appendChild(loader);
      positionFloatingElementTools(el, loader);
      _activeFloatingBtns = loader;
      bindFloatingToolbarLifecycle(el, loader);
      return loader;
    }

    document.addEventListener('mouseover', e => {
      const el = getEditableHoverTarget(e.target);
      if (shouldSkip(el)) return;
      if (el.classList.contains('kve-elem-btns') || el.closest('.kve-elem-btns')) return;
      if (_activeWrap === el) {
        cancelToolbarHide();
        if (_activeFloatingBtns) positionFloatingElementTools(_activeWrap, _activeFloatingBtns);
        return;
      }
      cancelToolbarHide();
      clearActiveElementOverlay();
      if (!el.querySelector(':scope > .kve-elem-btns') || isButtonLikeEditableElement(el)) {
        el.classList.add('kve-elem-wrap');
        if (isButtonLikeEditableElement(el)) {
          _activeWrap = el;
          renderToolbarLoader(el);
          _toolbarShowTimer = setTimeout(() => {
            if (_activeWrap !== el) return;
            renderElementToolbar(el, _activeFloatingBtns);
            _toolbarShowTimer = null;
          }, 140);
          return;
        }
        const btnWrap = document.createElement('div');
        btnWrap.className = 'kve-elem-btns';
        btnWrap.setAttribute('data-kve-editor', '1');
        btnWrap.innerHTML = `<button class="kve-elem-btn kve-elem-del" title="Obriši element">🗑️</button><button class="kve-elem-btn kve-elem-edit" title="Uredi element">⚙️</button>`;
        const useFloatingTools = isButtonLikeEditableElement(el);
        if (useFloatingTools) {
          document.body.appendChild(btnWrap);
          positionFloatingElementTools(el, btnWrap);
          _activeFloatingBtns = btnWrap;
        } else {
          el.style.position = el.style.position || (window.getComputedStyle(el).position === 'static' ? 'relative' : '');
          el.appendChild(btnWrap);
        }
        btnWrap.querySelector('.kve-elem-del').addEventListener('click', ev => {
          ev.stopPropagation();
          if (!confirm('Obrisati ovaj element?')) return;
          const removeTarget = getEditorRemovalTarget(el);
          removeTarget.style.transition = 'opacity .25s,transform .25s';
          removeTarget.style.opacity = '0';
          removeTarget.style.transform = 'scale(.95)';
          setTimeout(() => removeTarget.remove(), 260);
          clearActiveElementOverlay();
          toastMsg('🗑️ Element obrisan');
        });
        btnWrap.querySelector('.kve-elem-edit').addEventListener('click', ev => {
          ev.stopPropagation();
          if (isButtonLikeEditableElement(el)) {
            openButtonEditModal(el);
            return;
          }
          openElementEditModal(el);
        });
        if (isButtonLikeEditableElement(el)) {
          enableFlexibleEditorButton(el);
          const resizeBtn = document.createElement('button');
          resizeBtn.className = 'kve-elem-btn kve-elem-resize';
          resizeBtn.title = 'Promijeni veličinu';
          resizeBtn.textContent = '↔';
          btnWrap.appendChild(resizeBtn);
          resizeBtn.addEventListener('mousedown', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            enableFlexibleEditorButton(el);
            _buttonResizeState = {
              el,
              startX: ev.clientX,
              startWidth: el.getBoundingClientRect().width,
            };
          });
        }
      }
      _activeWrap = el;
    }, true);

    document.addEventListener('mouseout', e => {
      if (!_activeWrap) return;
      const leaving = e.target;
      const next = e.relatedTarget;
      const leavingActiveTarget = leaving === _activeWrap || _activeWrap.contains(leaving);
      const leavingToolbar = !!(_activeFloatingBtns && (leaving === _activeFloatingBtns || _activeFloatingBtns.contains(leaving)));
      if (!leavingActiveTarget && !leavingToolbar) return;
      if (next && ((_activeWrap && _activeWrap.contains(next)) || (_activeFloatingBtns && _activeFloatingBtns.contains(next)))) return;
      scheduleToolbarHide();
    }, true);

    document.addEventListener('click', e => {
      if (!document.body.classList.contains('kve-active')) return;
      if (e.target.closest('[data-kve-editor], .kve-card-bar, .kve-section-bar')) return;
      const target = resolveButtonLikeEditableElement(e.target);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    document.addEventListener('mousedown', e => {
      if (!document.body.classList.contains('kve-active')) return;
      if (e.button !== 0) return;
      if (e.target.closest('[data-kve-editor], .kve-card-bar, .kve-section-bar')) return;
      const target = resolveButtonLikeEditableElement(e.target);
      if (!target) return;
      enableFlexibleEditorButton(target);
      _buttonDragState = {
        el: target,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: parseFloat(target.dataset.kveOffsetX || '0') || 0,
        startTop: parseFloat(target.dataset.kveOffsetY || '0') || 0,
      };
      target.classList.add('kve-btn-dragging');
      e.preventDefault();
      e.stopPropagation();
    }, true);

    document.addEventListener('mousemove', e => {
      if (_buttonResizeState?.el) {
        const dx = e.clientX - _buttonResizeState.startX;
        applyButtonFlexSize(_buttonResizeState.el, _buttonResizeState.startWidth + dx);
        return;
      }
      if (!_buttonDragState?.el) return;
      const dx = e.clientX - _buttonDragState.startX;
      const dy = e.clientY - _buttonDragState.startY;
      applyButtonFlexPlacement(_buttonDragState.el, _buttonDragState.startLeft + dx, _buttonDragState.startTop + dy);
    }, true);

    document.addEventListener('mouseup', () => {
      if (_buttonDragState?.el) {
        _buttonDragState.el.classList.remove('kve-btn-dragging');
      }
      _buttonDragState = null;
      _buttonResizeState = null;
    }, true);

    document.addEventListener('scroll', () => {
      if (_activeWrap && _activeFloatingBtns) {
        positionFloatingElementTools(_activeWrap, _activeFloatingBtns);
      }
    }, true);
    window.addEventListener('resize', () => {
      if (_activeWrap && _activeFloatingBtns) {
        positionFloatingElementTools(_activeWrap, _activeFloatingBtns);
      }
    });

    // ── Right-click contextual menu ──────────────────────────────
    let _ctxTarget = null;

    document.addEventListener('contextmenu', e => {
      const target = getEditableHoverTarget(e.target);
      if (shouldSkip(target)) return;
      if (target.closest('[data-kve-editor]')) return;
      e.preventDefault();
      _ctxTarget = target;
      _showCtxMenu(e.clientX, e.clientY, target);
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

      modal.ok.addEventListener('click', async () => {
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
      modal.ok.addEventListener('click', async () => {
        const v = modal.overlay.querySelector('#kve-attr-val').value.trim();
        closeModal(modal.overlay);
        if (v) el.setAttribute(attr, v);
        else el.removeAttribute(attr);
        toastMsg(`✓ ${attr} ažuriran`);
      });
    }

    async function openButtonEditModal(el) {
      const loadingState = showEditorLoadingOverlay('Učitavanje panela dugmeta...');
      let products = [];
      let productLoadError = '';
      try {
        products = await fetchEditorProducts();
      } catch (error) {
        productLoadError = error.message || 'Greška pri učitavanju proizvoda.';
      }

      await hideEditorLoadingOverlay(loadingState, 360);
      const currentMode = getEditorButtonMode(el);
      const currentLabel = getEditorButtonLabel(el);
      const currentHref = parseEditorButtonHref(el);
      const currentProduct = extractEditorButtonProduct(el) || null;
      const currentProductId = el.dataset.kveProductId || currentProduct?.product_id || currentProduct?.id || '';
      const currentVariantToken = String(
        el.dataset.kveVariantId
        || currentProduct?.variant_id
        || currentProduct?.variant_label
        || ''
      ).trim().toLowerCase();
      const productOptions = products.length
        ? products.map((product) => {
            const name = product.name_sr || product.name || 'Proizvod';
            const selected = String(product.id) === String(currentProductId) ? ' selected' : '';
            return `<option value="${esc(product.id)}"${selected}>${esc(name)} — €${esc(Number(product.price || 0).toFixed(2))}</option>`;
          }).join('')
        : '<option value="">Nema proizvoda</option>';

      const modal = createModal(`⚙️ Uredi &lt;button&gt;`, `
        <label>Tekst / Sadržaj</label>
        <textarea id="kve-el-text" rows="3">${esc(currentLabel)}</textarea>
        <label style="margin-top:10px">CSS klase</label>
        <input type="text" id="kve-el-cls" value="${esc(el.className)}"/>
        <label style="margin-top:10px">Funkcija dugmeta</label>
        <select id="kve-el-btn-mode">
          <option value="none"${currentMode === 'none' ? ' selected' : ''}>Obično dugme</option>
          <option value="cart"${currentMode === 'cart' ? ' selected' : ''}>Add to cart</option>
          <option value="hyperlink"${currentMode === 'hyperlink' ? ' selected' : ''}>Hyperlink</option>
        </select>
        <div id="kve-el-btn-cart-fields" style="margin-top:10px">
          <label>Poveži proizvod</label>
          <select id="kve-el-btn-product"${products.length ? '' : ' disabled'}>${productOptions}</select>
          <label style="margin-top:10px">Paket / varijacija</label>
          <select id="kve-el-btn-variant">
            <option value="">Osnovna cijena proizvoda</option>
          </select>
          <div id="kve-el-btn-variant-note" style="margin-top:8px;font-size:11px;color:#9090b8">Odaberi konkretan paket ako dugme treba da dodaje određenu varijaciju.</div>
          ${productLoadError ? `<div style="margin-top:8px;font-size:11px;color:#fca5a5">${esc(productLoadError)}</div>` : ''}
        </div>
        <div id="kve-el-btn-link-fields" style="margin-top:10px">
          <label>URL link</label>
          <input type="url" id="kve-el-btn-href" value="${esc(currentHref)}" placeholder="https://..." />
          <label style="margin-top:8px">Otvori u</label>
          <select id="kve-el-btn-target">
            <option value="_self"${(el.getAttribute('target') || '_self') === '_self' ? ' selected' : ''}>Isti tab (_self)</option>
            <option value="_blank"${el.getAttribute('target') === '_blank' ? ' selected' : ''}>Novi tab (_blank)</option>
          </select>
        </div>`);

      const modeInput = modal.overlay.querySelector('#kve-el-btn-mode');
      const productInput = modal.overlay.querySelector('#kve-el-btn-product');
      const variantInput = modal.overlay.querySelector('#kve-el-btn-variant');
      const variantNote = modal.overlay.querySelector('#kve-el-btn-variant-note');
      const cartFields = modal.overlay.querySelector('#kve-el-btn-cart-fields');
      const linkFields = modal.overlay.querySelector('#kve-el-btn-link-fields');
      let selectedProductDetails = products.find((item) => String(item.id) === String(currentProductId)) || currentProduct || null;
      const syncModeUi = () => {
        const mode = modeInput.value || 'none';
        cartFields.style.display = mode === 'cart' ? 'block' : 'none';
        linkFields.style.display = mode === 'hyperlink' ? 'block' : 'none';
      };
      modeInput.addEventListener('change', syncModeUi);
      syncModeUi();

      const syncVariantOptions = async (selectedToken = '') => {
        const productId = productInput?.value || '';
        if (!variantInput) return;
        if (!productId) {
          variantInput.innerHTML = '<option value="">Osnovna cijena proizvoda</option>';
          variantInput.disabled = true;
          if (variantNote) variantNote.textContent = 'Prvo odaberi proizvod.';
          return;
        }

        variantInput.disabled = true;
        variantInput.innerHTML = '<option value="">Učitavanje paketa...</option>';
        try {
          selectedProductDetails = await fetchEditorProductDetails(productId);
          const variants = normalizeEditorVariants(selectedProductDetails);
          const preferred = String(selectedToken || '').trim().toLowerCase();
          const optionMarkup = variants.map((variant) => {
            const selected = preferred && preferred === variant._token ? ' selected' : '';
            return `<option value="${esc(variant._token)}"${selected}>${esc(variant.label || 'Paket')} — €${esc(Number(variant.price).toFixed(2))}</option>`;
          }).join('');
          variantInput.innerHTML = `<option value="">Osnovna cijena proizvoda</option>${optionMarkup}`;
          variantInput.disabled = false;
          if (variantNote) {
            variantNote.textContent = variants.length
              ? 'Izabrani paket određuje cijenu i naziv varijacije koja ide u korpu.'
              : 'Ovaj proizvod nema pakete. Dugme koristi osnovnu cijenu proizvoda.';
          }
        } catch (error) {
          selectedProductDetails = products.find((item) => String(item.id) === String(productId)) || currentProduct || null;
          variantInput.innerHTML = '<option value="">Osnovna cijena proizvoda</option>';
          variantInput.disabled = true;
          if (variantNote) variantNote.textContent = error.message || 'Paketi nisu dostupni.';
        }
      };

      if (productInput) {
        productInput.addEventListener('change', () => { void syncVariantOptions(''); });
        void syncVariantOptions(currentVariantToken);
      }

      modal.ok.addEventListener('click', async () => {
        const txt = modal.overlay.querySelector('#kve-el-text')?.value.trim() || 'Dugme';
        const cls = modal.overlay.querySelector('#kve-el-cls')?.value || '';
        const mode = modeInput.value || 'none';
        const href = modal.overlay.querySelector('#kve-el-btn-href')?.value.trim() || '';
        const target = modal.overlay.querySelector('#kve-el-btn-target')?.value || '_self';
        const productId = productInput?.value || '';
        const product = selectedProductDetails || products.find((item) => String(item.id) === String(productId));
        const variant = resolveEditorVariant(product, variantInput?.value || '');

        if (mode === 'cart' && !product) {
          toastMsg('Odaberi proizvod za cart dugme.', true);
          return;
        }
        if (mode === 'hyperlink' && !href) {
          toastMsg('URL link je obavezan.', true);
          return;
        }

        closeModal(modal.overlay);
        el.className = cls;
        try {
          applyButtonFunctionConfig(el, { mode, label: txt, href, target, product, variant });
          const snapshotSaved = await autosaveEditorPageSnapshot({ remote: true });
          toastMsg(snapshotSaved ? '✓ Dugme ažurirano' : '⚠️ Dugme ažurirano lokalno — backend čuvanje nije prošlo.', !snapshotSaved);
          _offerSync(el, cls);
        } catch (error) {
          toastMsg(`✗ ${error.message}`, true);
        }
      });
    }

    /* Expose openButtonEditModal to smart engine scope */
    _openButtonEditModalFn = openButtonEditModal;

    // ── Element edit modal (full) ──
    function openElementEditModal(el) {
      const modal = createModal(`⚙️ Uredi &lt;${el.tagName.toLowerCase()}&gt;`, `
        <label>Tekst / Sadržaj</label>
        <textarea id="kve-el-text" rows="3">${esc(el.innerText||'')}</textarea>
        <label style="margin-top:10px">CSS klase</label>
        <input type="text" id="kve-el-cls" value="${esc(el.className)}"/>
        ${el.hasAttribute('href') ? `<label style="margin-top:10px">href link</label><input type="text" id="kve-el-href" value="${esc(el.getAttribute('href')||'')}"/>` : ''}
        ${el.tagName === 'IMG' ? `<label style="margin-top:10px">src (URL slika)</label><input type="text" id="kve-el-src" value="${esc(el.getAttribute('src')||'')}"/>` : ''}`);

      modal.ok.addEventListener('click', async () => {
        const txt  = modal.overlay.querySelector('#kve-el-text')?.value;
        const cls  = modal.overlay.querySelector('#kve-el-cls')?.value;
        const href = modal.overlay.querySelector('#kve-el-href')?.value;
        const src  = modal.overlay.querySelector('#kve-el-src')?.value;
        closeModal(modal.overlay);
        if (txt  !== undefined && el.tagName !== 'IMG') el.innerText = txt;
        if (cls  !== undefined) el.className = cls;
        if (href !== undefined) el.setAttribute('href', href);
        if (src  !== undefined) el.setAttribute('src', src);
        const snapshotSaved = await autosaveEditorPageSnapshot({ remote: true });
        toastMsg(snapshotSaved ? '✓ Element ažuriran' : '⚠️ Element ažuriran lokalno — backend čuvanje nije prošlo.', !snapshotSaved);
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
  /* ── Pleasant editor notification sound (Web Audio API) ── */
  let _audioCtx = null;
  function _playEditorChime(isError = false) {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      if (isError) {
        /* Error: descending minor third, slightly buzzy */
        const o1 = ctx.createOscillator();
        o1.type = 'triangle';
        o1.frequency.setValueAtTime(440, now);
        o1.frequency.exponentialRampToValueAtTime(349, now + 0.15);
        o1.connect(gain);
        o1.start(now);
        o1.stop(now + 0.45);
      } else {
        /* Success: soft ascending perfect fifth — warm and unobtrusive */
        const o1 = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.setValueAtTime(523.25, now);         /* C5 */
        o1.connect(gain);
        o1.start(now);
        o1.stop(now + 0.22);

        const gain2 = ctx.createGain();
        gain2.connect(ctx.destination);
        gain2.gain.setValueAtTime(0, now + 0.1);
        gain2.gain.linearRampToValueAtTime(0.06, now + 0.13);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(659.25, now + 0.1);   /* E5 */
        o2.connect(gain2);
        o2.start(now + 0.1);
        o2.stop(now + 0.55);
      }
    } catch {}
  }

  function toastMsg(text, isError = false) {
    document.getElementById('kve-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'kve-toast';
    t.setAttribute('data-kve-editor', '1');
    t.textContent = text;
    t.style.background = isError ? '#ef4444' : '#22c55e';
    document.body.appendChild(t);
    _playEditorChime(isError);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 2800);
  }

})();
