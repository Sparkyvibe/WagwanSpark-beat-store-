/*
 * WAGWANSPARK — MULTI-PAGE STOREFRONT
 * index.html        = Beats
 * samples.html      = Sample Packs
 * studio-tools.html = Studio Tools
 *
 * Separate catalogues, audio previews, shared cart and Paystack checkout.
 * Existing API routes and checkout payload are preserved.
 */
(() => {
  "use strict";
  const API = {
    beats: "/api/beats",
    products: "/api/products",
    payment: "/api/create-payment"
  };
  const CART_STORAGE_KEY = "wagwanspark-cart-v3";
  const CATEGORIES = ["beats", "samples", "studio-tools"];
  const REQUEST_TIMEOUT_MS = 12000;
  const CHECKOUT_LABEL =
    '<span>Proceed to Checkout</span> <i class="fas fa-lock" aria-hidden="true"></i>';
  function detectCurrentPage() {
    const filename = window.location.pathname.split("/").pop().toLowerCase();
    if (filename === "samples.html") return "samples";
    if (filename === "studio-tools.html" || filename === "studio.html") {
      return "studio-tools";
    }
    return "beats";
  }
  const CURRENT_PAGE = detectCurrentPage();
  const state = {
    products: { beats: [], samples: [], "studio-tools": [] },
    catalogueErrors: { beats: "", samples: "", "studio-tools": "" },
    cart: [],
    activePreview: null,
    activeFilter: "all",
    search: "",
    categorySearch: "",
    checkoutBusy: false
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const safeText = value => String(value ?? "");
  const escapeHtml = value => safeText(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
  const money = value => new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
  const cartKey = product => product.category === "beats"
    ? product.id
    : `${product.category}:${product.id}`;
  function categoryLabel(category) {
    if (category === "studio-tools") return "Studio Tool";
    if (category === "samples") return "Sample Pack";
    return "Beat";
  }
  function normalizeProduct(raw, requestedCategory) {
    const item = { ...(raw || {}) };
    item.id = safeText(item.id || item.product_id).trim();
    item.title = safeText(item.title || item.name || item.id);
    item.category = safeText(item.category || requestedCategory).trim().toLowerCase();
    // Never silently reclassify a product returned by the API.
    if (!CATEGORIES.includes(item.category)) {
      item.category = requestedCategory;
    }
    item.genre = safeText(
      item.genre || item.type || item.instrument || categoryLabel(item.category)
    );
    item.description = safeText(item.description || item.details || "");
    item.price = Number(item.price) || 0;
    item.bpm = item.bpm === null || item.bpm === undefined || item.bpm === ""
      ? null
      : Number(item.bpm);
    item.musical_key = safeText(
      item.musical_key || item.musicalKey || item.key || ""
    );
    item.status = safeText(item.status || "published").toLowerCase();
    item.artwork = safeText(
      item.artwork ||
      item.artworkUrl ||
      item.artwork_url ||
      item.cover ||
      item.image ||
      item.image_url ||
      ""
    );
    item.previewAudio = safeText(
      item.previewAudio ||
      item.preview_audio ||
      item.previewAudioUrl ||
      item.preview_audio_url ||
      item.previewUrl ||
      item.preview_url ||
      item.audioPreview ||
      item.audio_preview ||
      item.preview ||
      ""
    );
    item.formats = Array.isArray(item.formats) ? item.formats : [];
    return item;
  }
  async function getJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("The store returned an unreadable response.");
      }
      if (!response.ok) {
        throw new Error(
          data.error || `Unable to load the store (HTTP ${response.status}).`
        );
      }
      if (!data || typeof data !== "object") {
        throw new Error("The store returned an invalid catalogue.");
      }
      return data;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("The catalogue request timed out. Please refresh and try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  function extractProducts(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.products)) return data.products;
    if (Array.isArray(data.beats)) return data.beats;
    if (Array.isArray(data.items)) return data.items;
    return [];
  }
  function installStoreInteractionStyles() {
    if (document.getElementById("wagwanspark-interaction-fixes")) return;
    const style = document.createElement("style");
    style.id = "wagwanspark-interaction-fixes";
    style.textContent = `
      .product-card-playable,.product-card-playable .product-artwork,
      .product-card-playable .product-artwork img{cursor:pointer}
      .product-card-playable .product-artwork{position:relative;overflow:hidden}
      .product-artwork .artwork-play-overlay{position:absolute;inset:0;z-index:2;
        display:flex;align-items:center;justify-content:center;pointer-events:none;
        background:rgba(0,0,0,.12);opacity:0;transition:opacity 180ms ease}
      .product-card-playable .product-artwork:hover .artwork-play-overlay,
      .product-card-playable:focus-within .artwork-play-overlay,
      .product-card-playable.is-preview-playing .artwork-play-overlay{opacity:1}
      .product-artwork .artwork-play-icon{display:inline-flex;align-items:center;
        justify-content:center;width:52px;height:52px;border-radius:50%;color:#fff;
        background:rgba(0,0,0,.68);border:1px solid rgba(255,255,255,.75);
        font-size:19px;box-shadow:0 3px 18px rgba(0,0,0,.25)}
      .product-card-playable.is-preview-playing .artwork-play-icon{
        color:#101010;background:#19d66b;border-color:#19d66b}
      .product-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
      .product-meta>span{display:inline-flex;align-items:center;gap:5px}
      .product-meta>span i{flex:0 0 auto;opacity:.9}
      .product-format{color:#19d66b!important;font-weight:700!important;letter-spacing:.02em}
      .product-format .format-separator{color:#19d66b;padding:0 3px}
      .product-actions{display:flex!important;flex-direction:column!important;
        align-items:stretch!important;justify-content:flex-start!important;
        width:100%!important;gap:8px!important;margin-top:12px!important}
      .product-actions .btn{box-sizing:border-box!important;display:flex!important;
        align-items:center!important;justify-content:center!important;width:100%!important;
        max-width:100%!important;min-width:0!important;min-height:40px!important;
        height:auto!important;padding:10px 12px!important;margin:0!important;
        border-radius:8px!important;font-size:.86rem!important;font-weight:700!important;
        line-height:1.25!important;white-space:normal!important;text-align:center!important;
        flex:0 0 auto!important;gap:7px!important;cursor:pointer}
      .product-actions .btn:disabled{opacity:.55;cursor:not-allowed}
      #cartSummary[hidden]{display:none!important}
      #cartSummary:not([hidden]){display:block!important;visibility:visible!important;
        box-sizing:border-box}
      #cartSummary .cart-checkout-btn,#cartSummary #checkoutBtn,
      #cartSummary #cartContinueShopping{box-sizing:border-box!important;width:100%!important;
        max-width:100%!important;min-width:0!important;min-height:46px!important;
        height:auto!important;padding:12px 16px!important;margin:12px 0 0!important;
        align-items:center!important;justify-content:center!important;border-radius:8px!important;
        font-size:.92rem!important;font-weight:700!important;line-height:1.3!important;
        white-space:normal!important;text-align:center!important;cursor:pointer}
      #cartSummary .cart-checkout-btn,#cartSummary #checkoutBtn{
        display:flex!important;gap:8px}
      #cartSummary #cartContinueShopping{display:flex!important;background:transparent;
        color:inherit;border:1px solid rgba(255,255,255,.25)}
      #cartSummary #checkoutBtn:disabled{opacity:.6;cursor:not-allowed}
      #cartSummary .cart-checkout-note{margin:12px 0}
      .catalogue-message{box-sizing:border-box;width:100%;padding:24px;text-align:center}
      .catalogue-message p{margin:0}
      @media(max-width:480px){
        .product-actions{gap:7px!important}
        .product-actions .btn{min-height:40px!important;padding:10px!important;font-size:.84rem!important}
        .product-artwork .artwork-play-icon{width:46px;height:46px;font-size:17px}
      }
      @media(hover:none){
        .product-card-playable .artwork-play-overlay{opacity:1;background:rgba(0,0,0,.08)}
        .product-card-playable .artwork-play-icon{width:44px;height:44px}
      }
    `;
    document.head.appendChild(style);
  }
  function configureNavigation() {
    $$(".navbar-logo").forEach(link => {
      link.href = "index.html";
    });
    $$("a.nav-link, .footer-navigation a").forEach(link => {
      const label = link.textContent.trim().toLowerCase();
      if (label === "home" || label === "beats") {
        link.href = label === "home" ? "index.html" : "index.html#beats";
      } else if (label === "samples") {
        link.href = "samples.html";
      } else if (label === "studio tools" || label === "studio-tools") {
        link.href = "studio-tools.html";
      } else if (label === "about") {
        link.href = "index.html#about";
      } else if (label === "contact") {
        link.href = "index.html#contact";
      }
    });
    $$("a[href='#beats']").forEach(link => {
      if (CURRENT_PAGE !== "beats") link.href = "index.html#beats";
    });
    const navMenu = document.getElementById("navMenu");
    if (navMenu) {
      navMenu.addEventListener("click", event => {
        const target = event.target instanceof Element
          ? event.target.closest("a")
          : null;
        if (!target) return;
        navMenu.classList.remove("active");
        const toggle = document.getElementById("navbarToggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    }
  }
  async function loadOneCatalogue(category, url) {
    try {
      const data = await getJson(url);
      const rawItems = extractProducts(data);
      const normalized = rawItems
        .map(item => normalizeProduct(item, category))
        .filter(item => item.id && item.status === "published");
      // Critical safeguard: only the requested category is rendered here.
      state.products[category] = normalized.filter(item => {
        if (item.category !== category) {
          console.warn(
            `Skipping "${item.title}" from ${category} catalogue; API category is "${item.category}".`
          );
          return false;
        }
        return true;
      });
      state.catalogueErrors[category] = "";
    } catch (error) {
      console.error(`${category} catalogue could not load:`, error);
      state.products[category] = [];
      state.catalogueErrors[category] =
        error?.message || "Catalogue could not load.";
    }
    if (CURRENT_PAGE === category) {
      renderAll();
    }
  }
  async function loadCatalogues() {
    const jobs = [
      loadOneCatalogue("beats", API.beats),
      loadOneCatalogue("samples", `${API.products}?category=samples`),
      loadOneCatalogue("studio-tools", `${API.products}?category=studio-tools`)
    ];
    await Promise.all(jobs);
    renderAll();
  }
  function showMessage(gridId, message) {
    const grid = document.getElementById(gridId);
    if (grid) {
      grid.innerHTML =
        `<div class="catalogue-message"><p>${escapeHtml(message)}</p></div>`;
    }
  }
  function productArtwork(product) {
    return product.artwork ||
      `/api/media/${encodeURIComponent(product.id)}/artwork`;
  }
  function productCard(product, category = product.category) {
    const key = cartKey(product);
    const inCart = state.cart.includes(key);
    const playable =
      (category === "beats" || category === "samples") &&
      Boolean(product.previewAudio);
    const metadata = [];
    if (product.genre) {
      metadata.push(
        `<span title="Genre"><i class="fas fa-music" aria-hidden="true"></i>${escapeHtml(product.genre)}</span>`
      );
    }
    if (product.bpm !== null && Number.isFinite(product.bpm) && product.bpm > 0) {
      metadata.push(
        `<span title="Tempo"><i class="fas fa-tachometer-alt" aria-hidden="true"></i>${escapeHtml(product.bpm)} BPM</span>`
      );
    }
    if (product.musical_key) {
      metadata.push(
        `<span title="Musical key"><i class="fas fa-key" aria-hidden="true"></i>${escapeHtml(product.musical_key)}</span>`
      );
    }
    const description = product.description
      ? `<p class="product-description">${escapeHtml(product.description)}</p>`
      : "";
    const playOverlay = playable ? `
      <span class="artwork-play-overlay" aria-hidden="true">
        <span class="artwork-play-icon"><i class="fas fa-play"></i></span>
      </span>` : "";
    const formatLabel = category === "beats" ? `
      <p class="product-format"><i class="fas fa-file-audio" aria-hidden="true"></i>
      MP3 <span class="format-separator">+</span> WAV</p>` :
      category === "samples" ? `
      <p class="product-format"><i class="fas fa-file-archive" aria-hidden="true"></i>
      Digital Sample Pack</p>` : `
      <p class="product-format"><i class="fas fa-sliders-h" aria-hidden="true"></i>
      Digital Studio Tool</p>`;
    return `
      <article class="beat-card product-card${playable ? " product-card-playable" : ""}"
        data-product-id="${escapeHtml(product.id)}"
        data-category="${escapeHtml(category)}"
        data-previewable="${playable ? "true" : "false"}"
        ${playable ? 'title="Tap the artwork to play or pause the preview"' : ""}>
        <div class="beat-artwork product-artwork">
          <img src="${escapeHtml(productArtwork(product))}"
            alt="${escapeHtml(product.title)} artwork"
            loading="lazy"
            onerror="this.onerror=null;this.style.display='none';this.parentElement.classList.add('artwork-placeholder');">
          ${playOverlay}
          <span class="product-category-label">${escapeHtml(categoryLabel(category))}</span>
        </div>
        <div class="beat-info product-info">
          <div class="beat-title-row">
            <h3>${escapeHtml(product.title)}</h3>
            <strong class="product-price">${money(product.price)}</strong>
          </div>
          <div class="beat-meta product-meta">${metadata.join("")}</div>
          ${description}
          ${formatLabel}
          <div class="product-actions">
            <button type="button" class="btn btn-primary product-add-btn"
              data-action="add" data-id="${escapeHtml(product.id)}"
              data-category="${escapeHtml(category)}">
              ${inCart
                ? '<i class="fas fa-check" aria-hidden="true"></i> Added to Cart'
                : '<i class="fas fa-cart-plus" aria-hidden="true"></i> Add to Cart'}
            </button>
          </div>
        </div>
      </article>`;
  }
  function renderBeats() {
    const grid = document.getElementById("beatsGrid");
    if (!grid) return;
    if (state.catalogueErrors.beats && !state.products.beats.length) {
      showMessage(
        "beatsGrid",
        `Beats could not load: ${state.catalogueErrors.beats}`
      );
      return;
    }
    const query = state.search.trim().toLowerCase();
    const items = state.products.beats.filter(product => {
      const matchesGenre = state.activeFilter === "all" ||
        product.genre.toLowerCase() === state.activeFilter;
      const searchable =
        `${product.title} ${product.genre} ${product.description} ${product.musical_key}`.toLowerCase();
      return matchesGenre && (!query || searchable.includes(query));
    });
    grid.innerHTML = items.length
      ? items.map(item => productCard(item, "beats")).join("")
      : `<div class="catalogue-message"><p>${state.products.beats.length
          ? "No beats match your search."
          : "No beats are currently published."}</p></div>`;
    const genreFilter = document.getElementById("genreFilter");
    if (genreFilter) {
      const current = genreFilter.value || state.activeFilter;
      const genres = [
        ...new Set(state.products.beats.map(item => item.genre).filter(Boolean))
      ].sort();
      genreFilter.innerHTML =
        `<option value="all">All Genres</option>` +
        genres.map(genre =>
          `<option value="${escapeHtml(genre.toLowerCase())}">${escapeHtml(genre)}</option>`
        ).join("");
      genreFilter.value = ["all", ...genres.map(genre => genre.toLowerCase())]
        .includes(current) ? current : "all";
    }
    const pagination = document.getElementById("pagination");
    if (pagination) pagination.innerHTML = "";
  }
  function renderProductCategory(category) {
    if (category !== "samples" && category !== "studio-tools") return;
    const gridId = category === "samples" ? "samplesGrid" : "studioToolsGrid";
    const grid = document.getElementById(gridId);
    if (!grid) return;
    if (state.catalogueErrors[category] && !state.products[category].length) {
      showMessage(
        gridId,
        `${categoryLabel(category)} catalogue could not load: ${state.catalogueErrors[category]}`
      );
      return;
    }
    const query = state.categorySearch.trim().toLowerCase();
    const items = (state.products[category] || []).filter(product => {
      const searchable =
        `${product.title} ${product.genre} ${product.description} ${product.musical_key}`.toLowerCase();
      return !query || searchable.includes(query);
    });
    grid.innerHTML = items.length
      ? items.map(item => productCard(item, category)).join("")
      : `<div class="catalogue-message"><p>${query
          ? "No products match your search."
          : category === "samples"
            ? "No sample packs are published yet. Publish a sample pack in Admin to display it here."
            : "No Studio Tools are published yet. Publish a Studio Tool in Admin to display it here."}</p></div>`;
  }
  function findProduct(id, category) {
    return (state.products[category] || []).find(product => product.id === id);
  }
  function saveCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
    } catch (error) {
      console.warn("Cart could not be saved.", error);
    }
  }
  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
      state.cart = Array.isArray(saved)
        ? saved.filter(key => typeof key === "string")
        : [];
    } catch {
      state.cart = [];
    }
  }
  function getCartProducts() {
    const all = CATEGORIES.flatMap(category => state.products[category] || []);
    const byKey = new Map(all.map(product => [cartKey(product), product]));
    state.cart = state.cart.filter(key => byKey.has(key));
    return state.cart.map(key => byKey.get(key));
  }
  function addToCart(product, openDrawer = true) {
    if (!product) return;
    const key = cartKey(product);
    if (!state.cart.includes(key)) {
      state.cart.push(key);
    }
    saveCart();
    renderAll();
    if (openDrawer) openCart();
  }
  function removeFromCart(key) {
    state.cart = state.cart.filter(item => item !== key);
    saveCart();
    renderAll();
  }
  function ensureCheckoutButton() {
    const summary = document.getElementById("cartSummary");
    if (!summary) return null;
    let button = document.getElementById("checkoutBtn");
    if (!button) {
      button = document.createElement("button");
      button.id = "checkoutBtn";
      button.type = "button";
      button.className = "btn btn-primary cart-checkout-btn";
      button.innerHTML = CHECKOUT_LABEL;
      summary.appendChild(button);
    }
    button.type = "button";
    button.style.boxSizing = "border-box";
    button.style.width = "100%";
    return button;
  }
  function renderCart() {
    const products = getCartProducts();
    const count = products.length;
    const total = products.reduce((sum, item) => sum + item.price, 0);
    const cartCount = document.getElementById("cartCount");
    if (cartCount) cartCount.textContent = String(count);
    const itemLabel = document.getElementById("cartItemLabel");
    if (itemLabel) {
      itemLabel.textContent = `${count} ${count === 1 ? "item" : "items"}`;
    }
    const summaryCount = document.getElementById("cartSummaryCount");
    if (summaryCount) summaryCount.textContent = String(count);
    const cartTotal = document.getElementById("cartTotal");
    if (cartTotal) cartTotal.textContent = money(total);
    const cartEmpty = document.getElementById("cartEmpty");
    if (cartEmpty) cartEmpty.style.display = count ? "none" : "flex";
    const cartSummary = document.getElementById("cartSummary");
    if (cartSummary) {
      cartSummary.hidden = count === 0;
      cartSummary.style.display = count ? "block" : "none";
      cartSummary.setAttribute("aria-hidden", count ? "false" : "true");
    }
    const cartItems = document.getElementById("cartItems");
    if (cartItems) {
      cartItems.innerHTML = products.map(product => `
        <div class="cart-item">
          <img class="cart-item-image"
            src="${escapeHtml(productArtwork(product))}" alt=""
            onerror="this.style.display='none'">
          <div class="cart-item-info">
            <h4>${escapeHtml(product.title)}</h4>
            <p>${escapeHtml(categoryLabel(product.category))}</p>
            <strong>${money(product.price)}</strong>
          </div>
          <button type="button" class="cart-item-remove"
            data-remove="${escapeHtml(cartKey(product))}"
            aria-label="Remove ${escapeHtml(product.title)}">
            <i class="fas fa-trash" aria-hidden="true"></i>
          </button>
        </div>`).join("");
    }
    const checkoutButton = ensureCheckoutButton();
    if (checkoutButton) {
      checkoutButton.disabled = count === 0 || state.checkoutBusy;
      checkoutButton.style.display = "flex";
      checkoutButton.style.visibility = "visible";
      checkoutButton.innerHTML = state.checkoutBusy
        ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Connecting to Paystack...'
        : CHECKOUT_LABEL;
    }
    const continueButton = document.getElementById("cartContinueShopping");
    if (continueButton) {
      continueButton.style.display = "flex";
      continueButton.style.width = "100%";
    }
    $$("[data-action='add']").forEach(button => {
      const product = findProduct(button.dataset.id, button.dataset.category);
      if (product) {
        button.innerHTML = state.cart.includes(cartKey(product))
          ? '<i class="fas fa-check" aria-hidden="true"></i> Added to Cart'
          : '<i class="fas fa-cart-plus" aria-hidden="true"></i> Add to Cart';
      }
    });
    updateCardPlayIcons();
  }
  function openCart() {
    renderCart();
    const drawer = document.getElementById("cartDrawer");
    const overlay = document.getElementById("cartOverlay");
    if (drawer) {
      drawer.classList.add("active", "open");
      drawer.setAttribute("aria-hidden", "false");
    }
    if (overlay) {
      overlay.classList.add("active", "open");
      overlay.setAttribute("aria-hidden", "false");
    }
    const toggle = document.getElementById("cartToggle");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("cart-open");
  }
  function closeCart() {
    const drawer = document.getElementById("cartDrawer");
    const overlay = document.getElementById("cartOverlay");
    if (drawer) {
      drawer.classList.remove("active", "open");
      drawer.setAttribute("aria-hidden", "true");
    }
    if (overlay) {
      overlay.classList.remove("active", "open");
      overlay.setAttribute("aria-hidden", "true");
    }
    const toggle = document.getElementById("cartToggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("cart-open");
  }
  function openPreview(product) {
    if (!product || !product.previewAudio) {
      alert("No preview audio has been uploaded for this product yet.");
      return;
    }
    const modal = document.getElementById("playerModal");
    const audio = document.getElementById("audioPlayer");
    if (!modal || !audio) {
      window.open(product.previewAudio, "_blank", "noopener,noreferrer");
      return;
    }
    const title = document.getElementById("playerTitle");
    const genre = document.getElementById("playerGenre");
    const image = document.getElementById("playerImage");
    const artwork = document.getElementById("playerArtwork");
    if (title) title.textContent = product.title;
    if (genre) {
      genre.textContent =
        `${categoryLabel(product.category)}${product.genre ? ` · ${product.genre}` : ""}`;
    }
    if (image) image.src = productArtwork(product);
    if (artwork) artwork.classList.remove("artwork-placeholder");
    audio.pause();
    audio.src = product.previewAudio;
    audio.load();
    state.activePreview = product;
    modal.classList.add("active", "open");
    modal.setAttribute("aria-hidden", "false");
    updateCardPlayIcons();
    audio.play().then(() => {
      updatePlayButton();
      updateCardPlayIcons();
    }).catch(error => {
      console.error("Preview playback failed:", error);
      updatePlayButton();
      updateCardPlayIcons();
      alert(
        "The preview could not be played. Confirm that the preview audio was uploaded and is a valid MP3 or WAV."
      );
    });
  }
  function toggleCardPreview(product) {
    if (!product) return;
    if (!product.previewAudio) {
      alert("No preview audio has been uploaded for this product yet.");
      return;
    }
    const audio = document.getElementById("audioPlayer");
    const sameProduct = Boolean(
      state.activePreview &&
      state.activePreview.id === product.id &&
      state.activePreview.category === product.category
    );
    if (sameProduct && audio) {
      if (audio.paused) {
        audio.play().then(() => {
          updatePlayButton();
          updateCardPlayIcons();
        }).catch(error => {
          console.error("Preview playback failed:", error);
          alert("Could not play this preview. Check the uploaded audio file.");
        });
      } else {
        audio.pause();
      }
      updatePlayButton();
      updateCardPlayIcons();
      return;
    }
    openPreview(product);
  }
  function closePreview() {
    const modal = document.getElementById("playerModal");
    const audio = document.getElementById("audioPlayer");
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (modal) {
      modal.classList.remove("active", "open");
      modal.setAttribute("aria-hidden", "true");
    }
    state.activePreview = null;
    updatePlayButton();
    updateCardPlayIcons();
  }
  function updateCardPlayIcons() {
    const audio = document.getElementById("audioPlayer");
    $$(".product-card-playable").forEach(card => {
      const isActive = Boolean(
        state.activePreview &&
        state.activePreview.id === card.dataset.productId &&
        state.activePreview.category === card.dataset.category
      );
      const isPlaying = Boolean(isActive && audio && !audio.paused);
      card.classList.toggle("is-preview-playing", isPlaying);
      const icon = $(".artwork-play-icon i", card);
      if (icon) {
        icon.className = isPlaying ? "fas fa-pause" : "fas fa-play";
      }
    });
  }
  function updatePlayButton() {
    const audio = document.getElementById("audioPlayer");
    const button = document.getElementById("playPauseBtn");
    if (audio && button) {
      button.innerHTML = audio.paused
        ? '<i class="fas fa-play" aria-hidden="true"></i>'
        : '<i class="fas fa-pause" aria-hidden="true"></i>';
      button.setAttribute(
        "aria-label",
        audio.paused ? "Play preview" : "Pause preview"
      );
    }
    updateCardPlayIcons();
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  }
  async function checkoutCart() {
    if (state.checkoutBusy) return;
    const products = getCartProducts();
    if (!products.length) {
      alert("Your cart is empty. Add a product before checkout.");
      renderCart();
      return;
    }
    const email = window.prompt(
      "Enter the email address where your secure download links should be sent:"
    );
    if (email === null) return;
    const cleanedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      alert("Enter a valid email address and try again.");
      return;
    }
    const beatIds = products
      .filter(item => item.category === "beats")
      .map(item => item.id);
    const productItems = products
      .filter(item => item.category !== "beats")
      .map(item => ({ id: item.id, category: item.category }));
    const payload = { email: cleanedEmail, beatIds, productItems };
    if (beatIds.length === 1 && products.length === 1) {
      payload.beatId = beatIds[0];
    }
    state.checkoutBusy = true;
    renderCart();
    try {
      const response = await fetch(API.payment, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The payment service returned an unreadable response.");
      }
      if (!response.ok || !result.status || !result.data?.authorization_url) {
        throw new Error(
          result.error || result.message || "Unable to start checkout. Please try again."
        );
      }
      window.location.href = result.data.authorization_url;
    } catch (error) {
      console.error("Checkout error:", error);
      alert(error.message || "Checkout failed. Please try again.");
    } finally {
      state.checkoutBusy = false;
      renderCart();
    }
  }
  function renderAll() {
    if (CURRENT_PAGE === "beats") {
      renderBeats();
    } else if (CURRENT_PAGE === "samples") {
      renderProductCategory("samples");
    } else if (CURRENT_PAGE === "studio-tools") {
      renderProductCategory("studio-tools");
    }
    renderCart();
  }
  function bindEvents() {
    document.addEventListener("click", event => {
      const target = event.target instanceof Element
        ? event.target
        : event.target?.parentElement;
      if (!target) return;
      const actionButton = target.closest("[data-action]");
      if (actionButton) {
        const product = findProduct(
          actionButton.dataset.id,
          actionButton.dataset.category
        );
        if (product && actionButton.dataset.action === "add") {
          addToCart(product, true);
        }
        return;
      }
      const removeButton = target.closest("[data-remove]");
      if (removeButton) {
        removeFromCart(removeButton.dataset.remove);
        return;
      }
      const card = target.closest(".product-card[data-previewable='true']");
      if (
        card &&
        !target.closest("button, a, input, select, textarea, [role='button']")
      ) {
        const product = findProduct(
          card.dataset.productId,
          card.dataset.category
        );
        if (product) toggleCardPreview(product);
      }
    });
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", event => {
        state.search = event.target.value || "";
        renderBeats();
      });
    }
    const categorySearchInput =
      document.getElementById("sampleSearchInput") ||
      document.getElementById("studioToolsSearch");
    if (categorySearchInput) {
      categorySearchInput.addEventListener("input", event => {
        state.categorySearch = event.target.value || "";
        renderProductCategory(CURRENT_PAGE);
      });
    }
    const genreFilter = document.getElementById("genreFilter");
    if (genreFilter) {
      genreFilter.addEventListener("change", event => {
        state.activeFilter = event.target.value || "all";
        renderBeats();
      });
    }
    const cartToggle = document.getElementById("cartToggle");
    if (cartToggle) {
      cartToggle.addEventListener("click", openCart);
    }
    ["closeCart", "cartContinueShopping", "continueShopping"].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("click", closeCart);
      }
    });
    const checkoutButton = ensureCheckoutButton();
    if (checkoutButton) {
      checkoutButton.addEventListener("click", checkoutCart);
    }
    const overlay = document.getElementById("cartOverlay");
    if (overlay) {
      overlay.addEventListener("click", closeCart);
    }
    const closePlayer = document.getElementById("closePlayer");
    if (closePlayer) {
      closePlayer.addEventListener("click", closePreview);
    }
    const closePlayerBackdrop =
      document.getElementById("closePlayerBackdrop");
    if (closePlayerBackdrop) {
      closePlayerBackdrop.addEventListener("click", closePreview);
    }
    const playerModal = document.getElementById("playerModal");
    if (playerModal) {
      playerModal.addEventListener("click", event => {
        if (event.target === playerModal) closePreview();
      });
    }
    const audio = document.getElementById("audioPlayer");
    const playPause = document.getElementById("playPauseBtn");
    if (playPause && audio) {
      playPause.addEventListener("click", () => {
        if (audio.paused) {
          audio.play().then(() => {
            updatePlayButton();
            updateCardPlayIcons();
          }).catch(error => {
            console.error("Preview playback failed:", error);
            alert("Could not play this preview. Check the uploaded audio file.");
          });
        } else {
          audio.pause();
        }
        updatePlayButton();
      });
    }
    if (audio) {
      audio.addEventListener("play", updatePlayButton);
      audio.addEventListener("pause", updatePlayButton);
      audio.addEventListener("ended", updatePlayButton);
      audio.addEventListener("timeupdate", () => {
        const current = document.getElementById("currentTime");
        const progress = document.getElementById("progressBar");
        if (current) current.textContent = formatTime(audio.currentTime);
        if (progress && Number.isFinite(audio.duration) && audio.duration > 0) {
          progress.value = String((audio.currentTime / audio.duration) * 100);
        }
      });
      audio.addEventListener("loadedmetadata", () => {
        const duration = document.getElementById("duration");
        if (duration) duration.textContent = formatTime(audio.duration);
      });
      audio.addEventListener("error", () => {
        if (state.activePreview) {
          console.error("Audio element error:", audio.error);
          updatePlayButton();
        }
      });
    }
    const progress = document.getElementById("progressBar");
    if (progress && audio) {
      progress.addEventListener("input", () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = (Number(progress.value) / 100) * audio.duration;
        }
      });
    }
    const navbarToggle = document.getElementById("navbarToggle");
    const navMenu = document.getElementById("navMenu");
    if (navbarToggle && navMenu) {
      navbarToggle.addEventListener("click", () => {
        navMenu.classList.toggle("active");
        navbarToggle.setAttribute(
          "aria-expanded",
          navMenu.classList.contains("active") ? "true" : "false"
        );
      });
    }
    const year = document.getElementById("currentYear");
    if (year) {
      year.textContent = String(new Date().getFullYear());
    }
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeCart();
        closePreview();
      }
    });
  }
  document.addEventListener("DOMContentLoaded", async () => {
    installStoreInteractionStyles();
    configureNavigation();
    loadCart();
    bindEvents();
    const summary = document.getElementById("cartSummary");
    if (summary) {
      summary.hidden = true;
      summary.style.display = "none";
    }
    renderCart();
    await loadCatalogues();
  });
})();
