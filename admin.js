(function () {
  'use strict';

  const state = window.KEYIFY_ADMIN_STATE;
  if (!state) return;

  const API_BASE = window.API_BASE || window.KEYIFY_CONFIG?.API_BASE || 'http://localhost:3001/api';
  const FALLBACK_CATEGORIES = [
    { id: null, slug: 'ai',        name: 'AI Alati',            page_slug: 'ai' },
    { id: null, slug: 'design',    name: 'Design & Creativity', page_slug: 'design' },
    { id: null, slug: 'business',  name: 'Business Software',   page_slug: 'business' },
    { id: null, slug: 'windows',   name: 'Windows & Office',    page_slug: 'windows' },
    { id: null, slug: 'music',     name: 'Music Streaming',     page_slug: 'music' },
    { id: null, slug: 'streaming', name: 'TV/Video Streaming',  page_slug: 'streaming' },
  ];

  let categoriesCache = FALLBACK_CATEGORIES.slice();
  let categoriesHydrated = false;
  let categoriesRequest = null;
  let invoicePage = 1;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function authHeaders() {
    if (typeof window.authHeaders === 'function') return window.authHeaders();
    const token = localStorage.getItem('keyify_token') || sessionStorage.getItem('keyify_token') || localStorage.getItem('kfy_token') || sessionStorage.getItem('kfy_token');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  function showToast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function waitForAdminLoaderPaint(minDelay) {
    return new Promise((resolve) => {
      const finish = () => window.setTimeout(resolve, minDelay || 0);
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
        return;
      }
      finish();
    });
  }

  function toggleProductEditorLoader(visible, text) {
    if (typeof window.setProductEditorLoader === 'function') {
      window.setProductEditorLoader(visible, text);
      return;
    }
    if (typeof window.setAdminPageLoader === 'function') {
      window.setAdminPageLoader(visible, text);
    }
  }

  window.openAdminReceipt = async function openAdminReceipt(transactionId) {
    if (!transactionId) return;

    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('section', 'invoices');
    returnUrl.searchParams.set('receipt_return', '1');
    try {
      localStorage.setItem('keyify_admin_return_url', returnUrl.toString());
    } catch {}
    const returnTo = encodeURIComponent(returnUrl.toString());
    const receiptUrl = `${API_BASE.replace('/api', '')}/api/admin/receipt/${encodeURIComponent(transactionId)}?ts=${Date.now()}&return_to=${returnTo}`;
    try {
      localStorage.setItem('kf_admin_goto', 'invoices');
    } catch {}
    if (typeof window.setAdminPageLoader === 'function') {
      window.setAdminPageLoader(true, 'Ucitavanje racuna...');
    }

    try {
      const response = await fetch(receiptUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: authHeaders(),
      });
      const html = await response.text();

      if (!response.ok) {
        throw new Error(html || 'Greska pri otvaranju racuna');
      }

      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      if (typeof window.setAdminPageLoader === 'function') {
        window.setAdminPageLoader(false);
      }
      showToast(error.message || 'Greska pri otvaranju racuna', 'error');
    }
  };

  function resetReceiptReturnState() {
    if (typeof window.setAdminPageLoader === 'function') {
      window.setAdminPageLoader(false);
    }
    toggleProductEditorLoader(false);
    const overlay = document.getElementById('admin-page-loader');
    if (overlay) {
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
    }
    const productOverlay = document.getElementById('product-editor-loader');
    if (productOverlay) {
      productOverlay.classList.remove('visible');
      productOverlay.setAttribute('aria-hidden', 'true');
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('receipt_return') === '1') {
        localStorage.removeItem('keyify_admin_return_url');
      }
    } catch {}
  }

  function normalizeCategory(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[()]/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function mapCategory(category, index) {
    const slug = normalizeCategory(category?.slug || category?.value || category?.page_slug || category?.name);
    return {
      id: category?.id || null,
      slug,
      name: category?.name || category?.label || slug || `Kategorija ${index + 1}`,
      page_slug: normalizeCategory(category?.page_slug || category?.slug || slug) || slug,
    };
  }

  async function loadCategories(forceRefresh) {
    if (!forceRefresh && categoriesRequest) return categoriesRequest;
    if (!forceRefresh && categoriesHydrated && categoriesCache.length) return categoriesCache;

    categoriesRequest = fetch(`${API_BASE}/categories`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Greška ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload) || !payload.length) return FALLBACK_CATEGORIES.map(mapCategory);
        return payload.map(mapCategory).filter((category) => category.slug);
      })
      .catch((error) => {
        console.warn('[admin.js] categories fallback:', error.message);
        return FALLBACK_CATEGORIES.map(mapCategory);
      })
      .then((categories) => {
        categoriesCache = categories;
        categoriesHydrated = true;
        categoriesRequest = null;
        populateCategoryControls(categories);
        return categories;
      });

    return categoriesRequest;
  }

  function populateCategoryControls(categories) {
    const filter = document.getElementById('product-filter');
    const modal = document.getElementById('prod-category');

    if (filter) {
      const current = filter.value;
      filter.innerHTML = `<option value="">Sve kategorije</option>${categories.map((category) => (
        `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</option>`
      )).join('')}`;
      filter.value = current || '';
    }

    if (modal) {
      const current = modal.dataset.selectedCategoryId || modal.dataset.selectedCategory || modal.value;
      modal.innerHTML = `<option value="">Izaberite...</option>${categories.map((category) => {
        const dataId = category.id ? ` data-category-id="${escapeHtml(category.id)}"` : '';
        return `<option value="${escapeHtml(category.slug)}"${dataId}>${escapeHtml(category.name)}</option>`;
      }).join('')}`;
      selectCategoryValue(modal, current);
    }
  }

  function selectCategoryValue(select, preferred) {
    if (!select) return;
    const normalized = normalizeCategory(preferred);
    const byId = Array.from(select.options).find((option) => option.dataset.categoryId && String(option.dataset.categoryId) === String(preferred));
    const bySlug = Array.from(select.options).find((option) => normalizeCategory(option.value) === normalized);
    const target = byId || bySlug;
    if (target) {
      select.value = target.value;
    } else if (!select.value) {
      select.selectedIndex = 0;
    }
  }

  function getFilteredProducts() {
    const category = document.getElementById('product-filter')?.value || '';
    if (!category) return state.allProducts;
    return state.allProducts.filter((product) => {
      const slug = normalizeCategory(product.category_slug || product.category);
      return slug === normalizeCategory(category);
    });
  }

  function getCurrentLang() {
    return state.currentLang || localStorage.getItem('keyify_lang') || 'sr';
  }

  function getDisplayText(product, key) {
    const lang = getCurrentLang();
    if (key === 'name') {
      return lang === 'en' && product.name_en ? product.name_en : (product.name_sr || product.name_en || '');
    }
    if (key === 'desc') {
      return lang === 'en' && product.description_en ? product.description_en : (product.description_sr || product.description_en || '');
    }
    return '';
  }

  function getDisplayPrice(product) {
    const minPrice = Number(product.min_variant_price);
    const hasPackages = Number(product.package_count || 0) > 0 || Number.isFinite(minPrice);
    if (hasPackages && Number.isFinite(minPrice) && minPrice > 0) {
      return {
        primary: `Od €${minPrice.toFixed(2)}`,
        secondary: Number(product.original_price) > minPrice ? `€${Number(product.original_price).toFixed(2)}` : '',
        packageLabel: Number(product.package_count || 0) > 0 ? `${Number(product.package_count)} paketa` : 'Paketi',
      };
    }

    const price = Number(product.price || 0);
    const original = Number(product.original_price || 0);
    return {
      primary: `€${price.toFixed(2)}`,
      secondary: original > price ? `€${original.toFixed(2)}` : '',
      packageLabel: '',
    };
  }

  function getCategoryLabel(product) {
    return product.category_label || product.category || 'Kategorija';
  }

  function requiredInputLabel(value) {
    const labels = {
      none: '',
      email: 'Trazi email',
      email_password: 'Trazi email + lozinku',
      pin_code: 'Trazi PIN',
      redirect_to_chat: 'Live chat isporuka',
    };
    return labels[normalizeCategory(value).replace(/-/g, '_')] || '';
  }

  window.loadProducts = async function loadProducts() {
    try {
      const [categories, response] = await Promise.all([
        loadCategories(),
        fetch(`${API_BASE}/products`, { headers: authHeaders() }),
      ]);

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Greška pri učitavanju proizvoda');

      state.allProducts = Array.isArray(payload) ? payload : [];
      populateCategoryControls(categories);
      window.renderProducts(getFilteredProducts());
    } catch (error) {
      console.error('[admin.js] loadProducts:', error);
      showToast(error.message || 'Greška pri učitavanju proizvoda', 'error');
    }
  };

  window.filterProducts = function filterProducts() {
    window.renderProducts(getFilteredProducts());
  };

  window.renderProducts = function renderProducts(products) {
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    if (!products.length) {
      grid.innerHTML = `<div class="col-span-full text-center py-16">
        <div class="text-dark-300 text-sm mb-4">Nema proizvoda u ovoj kategoriji</div>
        <button onclick="openProductModal(null)" class="px-5 py-2.5 rounded-xl text-white text-sm font-semibold" style="background:linear-gradient(135deg,#1D6AFF,#A259FF)">
          + Dodaj prvi proizvod
        </button>
      </div>`;
      return;
    }

    grid.innerHTML = products.map((product) => {
      const name = getDisplayText(product, 'name');
      const desc = getDisplayText(product, 'desc');
      const pricing = getDisplayPrice(product);
      const categoryLabel = getCategoryLabel(product);
      const inputLabel = requiredInputLabel(product.required_user_inputs);

      return `
        <div class="product-admin-card glass relative">
          <div class="relative overflow-hidden rounded-t-2xl" style="height:260px;background:linear-gradient(145deg,#0f0f1a,#1a1a2e)">
            ${product.image_url
              ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(name)}" class="w-full h-full object-cover"/>`
              : `<div class="w-full h-full flex items-center justify-center text-white text-4xl font-bold font-display" style="background:linear-gradient(135deg,rgba(29,106,255,0.28),rgba(162,89,255,0.22))">${escapeHtml(name.charAt(0) || '?')}</div>`}
            ${product.badge ? `<span class="absolute top-3 left-3 badge text-white text-xs" style="background:rgba(15,23,42,0.72);backdrop-filter:blur(8px)">${escapeHtml(product.badge)}</span>` : ''}
            <div class="actions absolute inset-0 flex items-center justify-center gap-3 rounded-t-2xl" style="background:rgba(10,10,18,0.66)">
              <button class="prod-edit-btn w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                      data-id="${escapeHtml(String(product.id))}"
                      style="background:rgba(29,106,255,0.3);color:#6699ff" title="Uredi">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="prod-del-btn w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                      data-id="${escapeHtml(String(product.id))}" data-name="${escapeHtml(name)}"
                      style="background:rgba(220,38,38,0.3);color:#f87171" title="Obriši">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
          <div class="p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="font-semibold text-white text-sm leading-tight">${escapeHtml(name)}</div>
              <span class="badge flex-shrink-0 text-xs" style="background:rgba(255,255,255,0.05);color:#9090b8">${escapeHtml(categoryLabel)}</span>
            </div>
            ${desc ? `<p class="text-xs text-dark-300 mt-1 line-clamp-2">${escapeHtml(desc)}</p>` : ''}
            <div class="mt-3 flex items-center gap-2 flex-wrap">
              <span class="font-display font-bold text-white">${escapeHtml(pricing.primary)}</span>
              ${pricing.secondary ? `<span class="text-xs text-dark-400 line-through">${escapeHtml(pricing.secondary)}</span>` : ''}
              ${pricing.packageLabel ? `<span class="badge ml-auto text-xs" style="background:rgba(29,106,255,0.15);color:#60a5fa">${escapeHtml(pricing.packageLabel)}</span>` : ''}
            </div>
            ${inputLabel ? `<div class="mt-2"><span class="badge text-xs" style="background:rgba(245,158,11,0.14);color:#fbbf24">${escapeHtml(inputLabel)}</span></div>` : ''}
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.prod-edit-btn').forEach((button) => {
      button.addEventListener('click', () => window.openProductModal(window.productById(button.dataset.id)));
    });
    grid.querySelectorAll('.prod-del-btn').forEach((button) => {
      button.addEventListener('click', () => window.deleteProduct(button.dataset.id, button.dataset.name));
    });
  };

  window.productById = function productById(id) {
    return state.allProducts.find((product) => String(product.id) === String(id)) || null;
  };

  window.editProduct = function editProduct(id) {
    return window.openProductModal(window.productById(id) || { id });
  };

  window.openProductModal = async function openProductModal(product) {
    const loaderStartedAt = Date.now();
    toggleProductEditorLoader(true, 'Ucitavanje editora proizvoda...');
    await waitForAdminLoaderPaint(180);

    try {
      await loadCategories();

    let fullProduct = product || null;
    if (product?.id) {
      try {
        const response = await fetch(`${API_BASE}/products/${product.id}`, { headers: authHeaders() });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Greška pri učitavanju proizvoda');
        fullProduct = payload;
      } catch (error) {
        console.error('[admin.js] openProductModal:', error);
        showToast(error.message || 'Greška pri učitavanju proizvoda', 'error');
        return;
      }
    }

    state.editingProduct = fullProduct;
    document.getElementById('modal-title').textContent = fullProduct ? 'Uredi proizvod' : 'Novi proizvod';
    document.getElementById('product-id').value = fullProduct?.id || '';
    document.getElementById('prod-name-sr').value = fullProduct?.name_sr || '';
    document.getElementById('prod-name-en').value = fullProduct?.name_en || '';
    document.getElementById('prod-desc-sr').value = fullProduct?.description_sr || '';
    document.getElementById('prod-desc-en').value = fullProduct?.description_en || '';
    document.getElementById('prod-price').value = fullProduct?.price || '';
    document.getElementById('prod-original-price').value = fullProduct?.original_price || '';
    document.getElementById('prod-badge').value = fullProduct?.badge || '';
    document.getElementById('prod-image-file').value = '';
    document.getElementById('img-file-name').textContent = 'Klikni ili prevuci sliku (max 10 MB)';
    document.getElementById('prod-image-url').value = fullProduct?.image_url || '';
    document.getElementById('prod-delivery-msg').value = fullProduct?.delivery_message || '';
    document.getElementById('prod-required-inputs').value = fullProduct?.required_user_inputs || 'none';
    document.getElementById('prod-warranty').value = fullProduct?.warranty_text || '';

    const categorySelect = document.getElementById('prod-category');
    categorySelect.dataset.selectedCategory = fullProduct?.category || fullProduct?.category_slug || '';
    categorySelect.dataset.selectedCategoryId = fullProduct?.category_id || '';
    populateCategoryControls(categoriesCache);
    selectCategoryValue(categorySelect, fullProduct?.category_id || fullProduct?.category || fullProduct?.category_slug || '');

    if (typeof window.switchImgTab === 'function') window.switchImgTab('url');
    if (typeof window.updateImgPreview === 'function') window.updateImgPreview();
    if (typeof window.populateBonusCouponDropdown === 'function') {
      await window.populateBonusCouponDropdown(fullProduct?.bonus_coupon_id || '');
    }

    const variantsHost = document.getElementById('variants-repeater');
    variantsHost.innerHTML = '';
    (fullProduct?.variants || []).forEach((variant) => {
      if (typeof window.addVariantRow === 'function') {
        window.addVariantRow(variant.label, variant.price, variant.original_price);
      }
    });

    const featuresHost = document.getElementById('features-repeater');
    featuresHost.innerHTML = '';
    (fullProduct?.features || []).forEach((feature) => {
      if (typeof window.addFeatureRow === 'function') {
        window.addFeatureRow(feature.text_sr, feature.text_en);
      }
    });

      document.getElementById('modal-overlay').classList.add('open');
    } finally {
      const remainingDelay = Math.max(0, 360 - (Date.now() - loaderStartedAt));
      if (remainingDelay) {
        await waitForAdminLoaderPaint(remainingDelay);
      }
      toggleProductEditorLoader(false);
    }
  };

  window.saveProduct = async function saveProduct(event) {
    event.preventDefault();

    const id = document.getElementById('product-id').value;
    const imageFileInput = document.getElementById('prod-image-file');
    const hasFile = imageFileInput.files.length > 0;
    const variants = typeof window.collectVariants === 'function' ? window.collectVariants() : [];
    const features = typeof window.collectFeatures === 'function' ? window.collectFeatures() : [];
    const categorySelect = document.getElementById('prod-category');
    const categoryOption = categorySelect.options[categorySelect.selectedIndex] || null;
    const categorySlug = categoryOption?.value || categorySelect.value;
    const categoryId = categoryOption?.dataset?.categoryId || null;
    const priceValue = document.getElementById('prod-price').value;
    const resolvedPrice = Number(priceValue || 0) > 0
      ? priceValue
      : (variants.length ? '' : null);

    if (!document.getElementById('prod-name-sr').value.trim()) {
      showToast('Naziv proizvoda je obavezan.', 'error');
      return;
    }
    if (!categorySlug) {
      showToast('Izaberite kategoriju proizvoda.', 'error');
      return;
    }
    if (resolvedPrice === null) {
      showToast('Unesite cijenu ili dodajte barem jedan paket.', 'error');
      return;
    }

    const payload = {
      name_sr: document.getElementById('prod-name-sr').value.trim(),
      name_en: document.getElementById('prod-name-en').value.trim(),
      description_sr: document.getElementById('prod-desc-sr').value.trim(),
      description_en: document.getElementById('prod-desc-en').value.trim(),
      price: resolvedPrice,
      original_price: document.getElementById('prod-original-price').value || '',
      category: categorySlug,
      category_id: categoryId,
      image_url: document.getElementById('prod-image-url').value.trim() || '',
      badge: document.getElementById('prod-badge').value || '',
      bonus_coupon_id: document.getElementById('prod-bonus-coupon').value || null,
      delivery_message: document.getElementById('prod-delivery-msg').value || null,
      required_user_inputs: document.getElementById('prod-required-inputs').value || 'none',
      warranty_text: document.getElementById('prod-warranty').value || null,
      variants: JSON.stringify(variants),
      features: JSON.stringify(features),
    };

    const endpoint = id ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;
    const method = id ? 'PUT' : 'POST';
    const submitButton = document.querySelector('#product-form button[type="submit"]');
    const originalLabel = submitButton?.textContent;
    const loaderLabel = id ? 'Azuriranje proizvoda...' : 'Dodavanje proizvoda...';

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Čuvanje...';
    }
    toggleProductEditorLoader(true, loaderLabel);
    await waitForAdminLoaderPaint(140);

    try {
      let response;
      if (hasFile) {
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== undefined && value !== null) formData.append(key, value);
        });
        formData.append('image', imageFileInput.files[0]);
        response = await fetch(endpoint, {
          method,
          headers: { Authorization: `Bearer ${localStorage.getItem('keyify_token')}` },
          body: formData,
        });
      } else {
        response = await fetch(endpoint, {
          method,
          headers: authHeaders(),
          body: JSON.stringify(payload),
        });
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Greška ${response.status}`);

      showToast(id ? 'Proizvod uspešno ažuriran!' : 'Proizvod uspešno dodat!');
      if (typeof window.closeModal === 'function') window.closeModal();
      await window.loadProducts();
    } catch (error) {
      console.error('[admin.js] saveProduct:', error);
      showToast(error.message || 'Greška pri čuvanju proizvoda', 'error');
    } finally {
      toggleProductEditorLoader(false);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  };

  window.deleteProduct = async function deleteProduct(id, name) {
    if (!window.confirm(`Obrisati "${name}"? Ova akcija je nepovratna.`)) return;

    try {
      const response = await fetch(`${API_BASE}/products/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Greška pri brisanju');

      showToast('Proizvod uspešno obrisan!');
      await window.loadProducts();
    } catch (error) {
      console.error('[admin.js] deleteProduct:', error);
      showToast(error.message || 'Greška pri brisanju proizvoda', 'error');
    }
  };

  function paymentMethodLabel(method) {
    const labels = {
      paypal: 'PayPal',
      btc: 'Bitcoin',
      eth: 'Ethereum',
      usdt: 'USDT',
      bank: 'Banka',
      stripe_card: 'Stripe',
      manual: 'Manuelno',
    };
    return labels[method] || (method ? method.replace(/_/g, ' ') : '—');
  }

  function paymentMethodBadge(method) {
    return `<span style="font-size:12px">${escapeHtml(paymentMethodLabel(method))}</span>`;
  }

  function transactionStatusBadge(status) {
    const styles = {
      completed: 'background:rgba(16,185,129,0.18);color:#10b981',
      pending: 'background:rgba(245,158,11,0.18);color:#f59e0b',
      failed: 'background:rgba(239,68,68,0.18);color:#ef4444',
      refunded: 'background:rgba(96,165,250,0.18);color:#60a5fa',
    };
    const labels = {
      completed: 'Završeno',
      pending: 'Na čekanju',
      failed: 'Neuspješno',
      refunded: 'Refund',
    };
    return `<span class="badge" style="${styles[status] || 'background:rgba(255,255,255,0.05);color:#9090b8'}">${escapeHtml(labels[status] || status || '—')}</span>`;
  }

  window.loadInvoices = async function loadInvoices(page) {
    invoicePage = Number(page || 1);
    const tbody = document.getElementById('invoices-tbody');
    if (!tbody) return;

    const limit = parseInt(document.getElementById('inv-limit')?.value || 25, 10);
    const status = document.getElementById('inv-status-filter')?.value || '';
    const method = document.getElementById('inv-method-filter')?.value || '';
    const params = new URLSearchParams({ page: String(invoicePage), limit: String(limit) });
    if (status) params.set('status', status);
    if (method) params.set('method', method);

    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10" style="color:#6b7280">Učitavanje transakcija...</td></tr>`;

    try {
      const response = await fetch(`${API_BASE}/admin/transactions?${params.toString()}`, {
        headers: authHeaders(),
      });
      const payload = await response.json();

      if (response.status === 403) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10" style="color:#f87171">Nemate dozvolu za pregled transakcija.</td></tr>`;
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'Greška pri dohvatanju transakcija');

      const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
      const total = Number(payload.total || 0);
      const totalLabel = document.getElementById('inv-total-label');
      if (totalLabel) totalLabel.textContent = `${total} transakcija`;

      if (!transactions.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10" style="color:#94a3b8">Nema transakcija za odabrane filtere.</td></tr>`;
      } else {
        tbody.innerHTML = transactions.map((transaction) => {
          const date = transaction.created_at
            ? new Date(transaction.created_at).toLocaleString('sr-RS', { dateStyle: 'short', timeStyle: 'short' })
            : '—';
          const amount = transaction.amount != null ? `€${Number(transaction.amount).toFixed(2)}` : '—';
          const avatar = transaction.avatar_url
            ? `<img src="${escapeHtml(transaction.avatar_url)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0"/>`
            : `<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;background:linear-gradient(135deg,#1D6AFF,#A259FF);flex-shrink:0">${escapeHtml((transaction.customer_name || transaction.customer_email || '?').charAt(0).toUpperCase())}</div>`;
          const payerAccount = transaction.payer_account
            ? `<span style="font-family:monospace;font-size:11px;color:#94a3b8;word-break:break-all" title="${escapeHtml(transaction.payer_account)}">${escapeHtml(transaction.payer_account.length > 24 ? `${transaction.payer_account.slice(0, 24)}…` : transaction.payer_account)}</span>`
            : '<span style="color:#475569;font-size:11px">—</span>';
          return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                ${avatar}
                <div>
                  <div style="font-weight:600;color:#e2e8f0;font-size:13px">${escapeHtml(transaction.customer_name || '—')}</div>
                  <div style="font-size:11px;color:#6b7280;font-family:monospace">${escapeHtml(transaction.customer_email || '—')}</div>
                </div>
              </div>
            </td>
            <td style="color:#c4b5fd;font-size:13px">${escapeHtml(transaction.product_name || '—')}</td>
            <td style="color:#60a5fa;font-weight:700;font-size:14px">${escapeHtml(amount)}</td>
            <td style="color:#94a3b8;font-size:12px">${escapeHtml(date)}</td>
            <td style="font-family:monospace;font-size:11px;color:#475569">${escapeHtml(transaction.ip_address || '—')}</td>
            <td>${paymentMethodBadge(transaction.payment_method)}</td>
            <td>${payerAccount}</td>
            <td>${transactionStatusBadge(transaction.status)}</td>
            <td>
              <button type="button" onclick="window.openAdminReceipt('${escapeHtml(transaction.id)}')"
                 style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:8px;font-size:11px;font-weight:700;background:rgba(29,106,255,0.15);color:#60a5fa;border:1px solid rgba(29,106,255,0.25);text-decoration:none">
                 Račun
              </button>
            </td>
          </tr>`;
        }).join('');
      }

      const pagination = document.getElementById('inv-pagination');
      if (pagination) {
        const pages = Math.max(1, Math.ceil(total / limit));
        const buttonStyle = 'border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s';
        let html = '';
        if (invoicePage > 1) {
          html += `<button onclick="loadInvoices(${invoicePage - 1})" style="${buttonStyle};background:rgba(255,255,255,0.06);color:#c0c0d8">← Prethodna</button>`;
        }
        for (let i = Math.max(1, invoicePage - 2); i <= Math.min(pages, invoicePage + 2); i += 1) {
          html += `<button onclick="loadInvoices(${i})" style="${buttonStyle};background:${i === invoicePage ? 'rgba(29,106,255,0.3)' : 'rgba(255,255,255,0.04)'};color:${i === invoicePage ? '#60a5fa' : '#9090b8'};border-color:${i === invoicePage ? 'rgba(29,106,255,0.4)' : 'rgba(255,255,255,0.06)'}">${i}</button>`;
        }
        if (invoicePage < pages) {
          html += `<button onclick="loadInvoices(${invoicePage + 1})" style="${buttonStyle};background:rgba(255,255,255,0.06);color:#c0c0d8">Sljedeća →</button>`;
        }
        pagination.innerHTML = html;
      }
    } catch (error) {
      console.error('[admin.js] loadInvoices:', error);
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10" style="color:#f87171">${escapeHtml(error.message || 'Greška pri dohvatanju transakcija')}</td></tr>`;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadCategories();
    resetReceiptReturnState();
  });

  window.addEventListener('pageshow', () => {
    resetReceiptReturnState();
  });
})();
