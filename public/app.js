/*
 * WAGWANSPARK — MULTI-PAGE STOREFRONT
 * index.html        = Beats
 * samples.html      = Sample Packs
 * studio-tools.html = Studio Tools
 *
 * Separate catalogues, audio previews, shared cart and Paystack checkout.
 * Preserves existing API routes, checkout payload and storefront styling.
 *
 * Ranking: the worker returns products already sorted. Samples and Studio
 * Tools: featured first, then newest publish date, with a "Featured" badge.
 * Beats: the admin's manual catalogue order. Featured beats are shown ONLY in
 * the "Selected for the Vibe" carousel (no badge); the main catalogue lists
 * the remaining beats in the order received.
 */
(() => {
  "use strict";

  const API = {
    beats: "/api/beats",
    products: "/api/products",
    payment: "/api/create-payment"
  };

  const CART_STORAGE_KEY = "wagwanspark-cart-v3";
  // Small snapshots of cart items so the cart survives page changes
  // without needing every catalogue to be fetched on every page.
  const CART_ITEMS_STORAGE_KEY = "wagwanspark-cart-items-v1";
  const CATEGORIES = ["beats", "samples", "studio-tools"];
  const REQUEST_TIMEOUT_MS = 12000;

  const CHECKOUT_LABEL =
    '<span>Proceed to Checkout</span> <i class="fas fa-lock" aria-hidden="true"></i>';

  function detectCurrentPage() {
    const path = window.location.pathname
      .toLowerCase()
      .replace(/\/+$/, "");

    if (/\/samples(?:\.html)?$/.test(path)) {
      return "samples";
    }

    if (/\/studio-tools(?:\.html)?$/.test(path) ||
        /\/studio(?:\.html)?$/.test(path)) {
      return "studio-tools";
    }

    return "beats";
  }

  const CURRENT_PAGE = detectCurrentPage();

  const state = {
    products: {
      beats: [],
      samples: [],
      "studio-tools": []
    },
    catalogueErrors: {
      beats: "",
      samples: "",
      "studio-tools": ""
    },
    cart: [],
    cartItems: {},
    catalogueLoaded: {
      beats: false,
      samples: false,
      "studio-tools": false
    },
    activePreview: null,
    activeFilter: "all",
    search: "",
    categorySearch: "",
    checkoutBusy: false
  };

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const safeText = value => String(value ?? "");

  const escapeHtml = value =>
    safeText(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  const money = value =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0
    }).format(Number(value) || 0);

  const cartKey = product =>
    product.category === "beats"
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

    item.category = safeText(
      item.category || requestedCategory
    ).trim().toLowerCase();

    if (!CATEGORIES.includes(item.category)) {
      item.category = requestedCategory;
    }

    item.genre = safeText(
      item.genre ||
      item.type ||
      item.instrument ||
      categoryLabel(item.category)
    );

    item.description = safeText(
      item.description || item.details || ""
    );

    item.price = Number(item.price) || 0;

    item.bpm =
      item.bpm === null ||
      item.bpm === undefined ||
      item.bpm === ""
        ? null
        : Number(item.bpm);

    item.musical_key = safeText(
      item.musical_key ||
      item.musicalKey ||
      item.key ||
      ""
    );

    item.status = safeText(
      item.status || "published"
    ).toLowerCase();

    // Support both resolved API URLs and stored object keys.
    item.artwork = safeText(
      item.artwork ||
      item.artworkUrl ||
      item.artwork_url ||
      item.artwork_key ||
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
      item.preview_key ||
      item.audioPreview ||
      item.audio_preview ||
      item.preview ||
      ""
    );

    item.formats = Array.isArray(item.formats)
      ? item.formats
      : [];

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
        throw new Error(
          "The store returned an unreadable response."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
          `Unable to load the store (HTTP ${response.status}).`
        );
      }

      if (!data || typeof data !== "object") {
        throw new Error(
          "The store returned an invalid catalogue."
        );
      }

      return data;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(
          "The catalogue request timed out. Please refresh and try again."
        );
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
    if (document.getElementById("wagwanspark-interaction-fixes")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "wagwanspark-interaction-fixes";

    style.textContent = `
      .product-card-playable,
      .product-card-playable .product-artwork,
      .product-card-playable .product-artwork img {
        cursor: pointer;
      }

      .product-card-playable .product-artwork {
        position: relative;
        overflow: hidden;
      }

      .product-artwork .artwork-play-overlay {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background: rgba(0,0,0,.12);
        opacity: 0;
        transition: opacity 180ms ease;
      }

      .product-card-playable .product-artwork:hover .artwork-play-overlay,
      .product-card-playable:focus-within .artwork-play-overlay,
      .product-card-playable.is-preview-playing .artwork-play-overlay {
        opacity: 1;
      }

      .product-artwork .artwork-play-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        color: #fff;
        background: rgba(0,0,0,.68);
        border: 1px solid rgba(255,255,255,.75);
        font-size: 19px;
        box-shadow: 0 3px 18px rgba(0,0,0,.25);
      }

      .product-card-playable.is-preview-playing .artwork-play-icon {
        color: #101010;
        background: #ccff00;
        border-color: #ccff00;
      }

      /* Featured products: pinned to the top by the worker, and marked
         with a lime badge plus a thin lime outline on the card. */
      .product-card .product-artwork {
        position: relative;
      }

      .product-card.is-featured {
        box-shadow: 0 0 0 1px rgba(204,255,0,.5);
      }

      .product-featured-badge {
        position: absolute;
        left: 10px;
        bottom: 10px;
        z-index: 3;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 999px;
        background: #ccff00;
        color: #101010;
        font-size: .7rem;
        font-weight: 800;
        letter-spacing: .05em;
        text-transform: uppercase;
        line-height: 1.3;
        pointer-events: none;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
      }

      .product-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
      }

      .product-meta > span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .product-meta > span i {
        flex: 0 0 auto;
        opacity: .9;
      }

      .product-format {
        color: #ccff00 !important;
        font-weight: 700 !important;
        letter-spacing: .02em;
      }

      .product-format .format-separator {
        color: #ccff00;
        padding: 0 3px;
      }

      .product-actions {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
        width: 100% !important;
        gap: 8px !important;
        margin-top: 12px !important;
      }

      .product-actions .btn {
        box-sizing: border-box !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        min-height: 40px !important;
        height: auto !important;
        padding: 10px 12px !important;
        margin: 0 !important;
        border-radius: 8px !important;
        font-size: .86rem !important;
        font-weight: 700 !important;
        line-height: 1.25 !important;
        white-space: normal !important;
        text-align: center !important;
        flex: 0 0 auto !important;
        gap: 7px !important;
        cursor: pointer;
      }

      .product-actions .btn:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      #cartSummary[hidden] {
        display: none !important;
      }

      #cartSummary:not([hidden]) {
        display: block !important;
        visibility: visible !important;
        box-sizing: border-box;
      }

      #cartSummary .cart-checkout-btn,
      #cartSummary #checkoutBtn {
        box-sizing: border-box !important;
        display: flex !important;
        gap: 8px;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        min-height: 46px !important;
        height: auto !important;
        padding: 12px 16px !important;
        margin: 12px 0 0 !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 8px !important;
        font-size: .92rem !important;
        font-weight: 700 !important;
        line-height: 1.3 !important;
        white-space: normal !important;
        text-align: center !important;
        cursor: pointer;
      }

      /* Continue Shopping is styled by cart.css (same pill button as
         the Sample Packs / Studio Tools cart). */

      #cartSummary #checkoutBtn:disabled {
        opacity: .6;
        cursor: not-allowed;
      }

      .catalogue-message {
        box-sizing: border-box;
        width: 100%;
        padding: 24px;
        text-align: center;
      }

      .catalogue-message p {
        margin: 0;
      }

      @media (max-width: 480px) {
        .product-actions {
          gap: 7px !important;
        }

        .product-actions .btn {
          min-height: 40px !important;
          padding: 10px !important;
          font-size: .84rem !important;
        }

        .product-artwork .artwork-play-icon {
          width: 46px;
          height: 46px;
          font-size: 17px;
        }
      }

      @media (hover: none) {
        .product-card-playable .artwork-play-overlay {
          opacity: 1;
          background: rgba(0,0,0,.08);
        }

        .product-card-playable .artwork-play-icon {
          width: 44px;
          height: 44px;
        }
      }

      /* Playing artwork: a slow, seamless 5s zoom-and-drift loop.
         Attached while a card's preview is loaded and only running while
         its audio is audible, so pausing freezes it in place. Uses the
         individual scale/translate properties so it composes with the
         theme's hover transform. */
      @keyframes wsArtworkZoomDrift {
        0%, 100% { scale: 1; translate: 0 0; }
        50% { scale: 1.045; translate: -1.2% -0.8%; }
      }

      @media (prefers-reduced-motion: no-preference) {
        .product-card.is-preview-active .product-artwork > img,
        .beat-detail-artwork.is-preview-active > img {
          animation: wsArtworkZoomDrift 5s cubic-bezier(.45,0,.55,1) infinite;
          animation-play-state: paused;
          will-change: scale, translate;
        }

        .product-card.is-preview-animating .product-artwork > img,
        .beat-detail-artwork.is-preview-animating > img {
          animation-play-state: running;
        }
      }

      /* Featured beats carousel ("Selected for the Vibe"): reuses the
         catalogue card, laid out as a compact swipeable row. */
      .featured-carousel-section[hidden],
      .featured-carousel-nav[hidden] {
        display: none !important;
      }

      .featured-carousel-section.beats-section {
        padding-bottom: 0;
      }

      .featured-carousel-section .section-header {
        margin-bottom: 1.1rem;
      }

      .featured-carousel-bar {
        display: flex;
        justify-content: flex-end;
        max-width: 1300px;
        min-height: 0;
        margin: 0 auto 10px;
      }

      .featured-carousel-nav {
        display: flex;
        gap: 8px;
      }

      .featured-carousel-arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        padding: 0;
        border: 1px solid #262626;
        border-radius: 50%;
        background: #151515;
        color: #e6e6e6;
        font-size: 13px;
        cursor: pointer;
        transition: border-color .2s ease, color .2s ease, opacity .2s ease;
      }

      .featured-carousel-arrow:hover:not(:disabled),
      .featured-carousel-arrow:focus-visible {
        border-color: rgba(204,255,0,.55);
        color: #ccff00;
        outline: none;
      }

      .featured-carousel-arrow:disabled {
        opacity: .35;
        cursor: default;
      }

      .beats-grid.featured-carousel-track {
        grid-template-columns: none;
        grid-auto-flow: column;
        grid-auto-columns: calc((100% - 2 * 12px) / 2.3);
        gap: 12px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        padding: 4px 1px 6px;
        scroll-padding-inline: 1px;
      }

      .beats-grid.featured-carousel-track::-webkit-scrollbar {
        display: none;
      }

      .beats-grid.featured-carousel-track:focus-visible {
        outline: 1px solid rgba(204,255,0,.45);
        outline-offset: 4px;
        border-radius: 12px;
      }

      .featured-carousel-track > .product-card {
        scroll-snap-align: start;
      }

      .featured-carousel-track > .product-card:last-child {
        scroll-snap-align: end;
      }

      .featured-carousel-track .product-card.is-featured {
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
      }

      .featured-carousel-track .product-description,
      .featured-carousel-track .product-featured-badge {
        display: none;
      }

      @media (max-width: 699px) {
        .beats-grid.featured-carousel-track {
          padding: 4px 8px 6px;
          scroll-padding-inline: 8px;
        }
      }

      @media (min-width: 700px) {
        .beats-grid.featured-carousel-track {
          grid-auto-columns: calc((100% - 3 * 16px) / 3.4);
          gap: 16px;
        }
      }

      @media (min-width: 1040px) {
        .beats-grid.featured-carousel-track {
          grid-auto-columns: calc((100% - 4 * 18px) / 5);
          gap: 18px;
        }
      }

      @media (max-width: 699px) {
        .featured-carousel-bar {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  const NAV_BREAKPOINT = 860;

  // Opens or closes the mobile menu drawer (hamburger menu).
  function setNavOpen(open) {
    const navMenu = document.getElementById("navMenu");
    const toggle = document.getElementById("navbarToggle");
    const overlay = document.getElementById("navOverlay");

    if (!navMenu) return;

    navMenu.classList.toggle("active", open);
    if (overlay) overlay.classList.toggle("active", open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");

    document.body.classList.toggle("nav-open", open);
  }

  // Adds the header, extra links, cart shortcut and dimmed backdrop that
  // turn the nav links into a slide-in drawer on phones. These extras are
  // hidden on desktop by styles.css, so the desktop navbar is unchanged.
  function buildNavDrawer() {
    const navMenu = document.getElementById("navMenu");

    if (!navMenu || navMenu.dataset.drawerReady === "true") return;
    navMenu.dataset.drawerReady = "true";

    const head = document.createElement("div");
    head.className = "nav-drawer-head";
    head.innerHTML =
      '<span class="nav-drawer-brand">WagwanSpark</span>' +
      '<button type="button" class="nav-drawer-close" aria-label="Close menu">' +
      '<i class="fas fa-times" aria-hidden="true"></i></button>';
    navMenu.insertBefore(head, navMenu.firstChild);

    const sub = document.createElement("div");
    sub.className = "nav-drawer-sub";
    sub.innerHTML =
      '<a href="index.html#contact">Contact</a>';
    navMenu.appendChild(sub);

    const foot = document.createElement("div");
    foot.className = "nav-drawer-foot";
    foot.innerHTML =
      '<button type="button" class="nav-drawer-cart">' +
      '<i class="fas fa-shopping-cart" aria-hidden="true"></i> View cart</button>' +
      "<p>Let the vibe be your guide.</p>";
    navMenu.appendChild(foot);

    // The backdrop lives inside the navbar so it stacks with the drawer.
    const overlay = document.createElement("div");
    overlay.className = "nav-overlay";
    overlay.id = "navOverlay";
    (navMenu.closest(".navbar") || document.body).appendChild(overlay);

    overlay.addEventListener("click", () => setNavOpen(false));

    head.querySelector(".nav-drawer-close")
      .addEventListener("click", () => {
        setNavOpen(false);
        const toggle = document.getElementById("navbarToggle");
        if (toggle) toggle.focus();
      });

    foot.querySelector(".nav-drawer-cart")
      .addEventListener("click", () => {
        setNavOpen(false);
        openCart();
      });

    window.addEventListener("resize", () => {
      if (window.innerWidth > NAV_BREAKPOINT) setNavOpen(false);
    });
  }

  function configureNavigation() {
    // On /beat/<id> pages, relative paths resolve under /beat/ and break.
    const prefix =
      window.location.pathname.startsWith("/beat/") ? "/" : "";

    $$(".navbar-logo").forEach(link => {
      link.href = prefix + "index.html";
    });

    $$("a.nav-link, .footer-navigation a").forEach(link => {
      const label = link.textContent.trim().toLowerCase();

      if (label === "home" || label === "beats") {
        link.href = label === "home"
          ? prefix + "index.html"
          : prefix + "index.html#beats";
      } else if (label === "samples") {
        link.href = prefix + "samples.html";
      } else if (
        label === "studio tools" ||
        label === "studio-tools"
      ) {
        link.href = prefix + "studio-tools.html";
      } else if (label === "about") {
        link.href = prefix + "index.html#about";
      } else if (label === "contact") {
        link.href = prefix + "index.html#contact";
      }
    });

    $$("a[href='#beats']").forEach(link => {
      if (CURRENT_PAGE !== "beats") {
        link.href = prefix + "index.html#beats";
      }
    });

    const navMenu = document.getElementById("navMenu");

    if (navMenu) {
      navMenu.addEventListener("click", event => {
        const target = event.target instanceof Element
          ? event.target.closest("a")
          : null;

        if (!target) return;

        setNavOpen(false);
      });
    }
  }

  // Builds the homepage hero waveform: a row of chrome bars whose
  // staggered animation reads as an ambient signal. Purely decorative,
  // so it is skipped when the hero is not on the page.
  function buildHeroVisual() {
    const group = document.getElementById("heroBars");

    if (!group || group.childElementCount) return;

    const SVG_NS = "http://www.w3.org/2000/svg";
    const TOTAL = 34;

    for (let i = 0; i < TOTAL; i += 1) {
      const bar = document.createElementNS(SVG_NS, "rect");

      bar.setAttribute("x", String(12 + i * 14));
      bar.setAttribute("y", "46");
      bar.setAttribute("width", "8");
      bar.setAttribute("height", "208");
      bar.setAttribute("rx", "4");
      bar.setAttribute("class", i % 5 === 2 ? "bar irid" : "bar");

      bar.style.animationDelay = `${(-i * 0.13).toFixed(2)}s`;
      bar.style.animationDuration = `${(1.9 + (i % 6) * 0.28).toFixed(2)}s`;

      group.appendChild(bar);
    }
  }

  // The hero search field drives the same catalogue filter as the
  // section search box, so both stay in sync.
  function bindHeroSearch() {
    const heroForm = document.getElementById("heroSearchForm");
    const heroInput = document.getElementById("heroSearchInput");
    const mainInput = document.getElementById("searchInput");

    if (!heroInput) return;

    heroInput.addEventListener("input", () => {
      state.search = heroInput.value || "";
      if (mainInput) mainInput.value = state.search;
      renderBeats();
    });

    if (mainInput) {
      mainInput.addEventListener("input", () => {
        heroInput.value = mainInput.value;
      });
    }

    if (heroForm) {
      heroForm.addEventListener("submit", event => {
        event.preventDefault();
        state.search = heroInput.value || "";
        if (mainInput) mainInput.value = state.search;
        renderBeats();

        const target = document.getElementById("beats");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function showMessage(gridId, message) {
    const grid = document.getElementById(gridId);

    if (grid) {
      grid.innerHTML =
        `<div class="catalogue-message"><p>${escapeHtml(message)}</p></div>`;
    }
  }

  function productArtwork(product) {
    const artwork = safeText(product.artwork).trim();

    if (!artwork) {
      return `/api/media/${encodeURIComponent(product.id)}/artwork`;
    }

    // API media URLs are already usable. Resolve stored object keys
    // through the existing media endpoint instead of using raw R2 keys.
    if (
      !/^https?:\/\//i.test(artwork) &&
      !artwork.startsWith("/") &&
      /\.(png|jpe?g|webp|gif|avif)$/i.test(artwork)
    ) {
      return `/api/media/${encodeURIComponent(product.id)}/artwork`;
    }

    return artwork;
  }

  function productPreview(product) {
    const preview = safeText(product.previewAudio).trim();

    if (!preview) return "";

    // A stored preview key is not a public URL. Use the existing API
    // media route for products whose API response supplies preview_key.
    if (
      !/^https?:\/\//i.test(preview) &&
      !preview.startsWith("/")
    ) {
      return `/api/media/${encodeURIComponent(product.id)}/preview`;
    }

    return preview;
  }

  async function loadOneCatalogue(category, url) {
    try {
      const data = await getJson(url);
      const rawItems = extractProducts(data);

      const normalized = rawItems
        .map(item => normalizeProduct(item, category))
        .filter(item => item.id && item.status === "published");

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
      state.catalogueLoaded[category] = true;
      reconcileCart();
    } catch (error) {
      console.error(`${category} catalogue could not load:`, error);

      state.products[category] = [];
      state.catalogueErrors[category] =
        error?.message || "Catalogue could not load.";
    }

    renderAll();
  }

  function categoriesForThisPage() {
    if (document.getElementById("samplesGrid")) return ["samples"];
    if (document.getElementById("studioToolsGrid")) return ["studio-tools"];
    if (document.getElementById("beatsGrid")) return ["beats"];
    return [];
  }

  async function loadCatalogues() {
    // Only fetch the catalogue this page actually shows. The cart uses
    // saved snapshots for items from other categories.
    const loaders = {
      beats: () => loadOneCatalogue("beats", API.beats),
      samples: () =>
        loadOneCatalogue("samples", `${API.products}?category=samples`),
      "studio-tools": () =>
        loadOneCatalogue(
          "studio-tools",
          `${API.products}?category=studio-tools`
        )
    };

    // Each catalogue handles its own errors.
    await Promise.all(categoriesForThisPage().map(name => loaders[name]()));

    renderAll();
  }

  function productCard(product, category = product.category) {
    const key = cartKey(product);
    const inCart = state.cart.includes(key);
    const previewAudio = productPreview(product);

    // Any product with an uploaded preview is playable, including
    // Studio Tools such as FLP projects.
    const playable = Boolean(previewAudio);

    // Featured Samples and Studio Tools are pinned first by the worker and
    // keep their badge. Featured beats get no badge or outline: their place
    // in the carousel is what marks them as featured.
    const featured = category !== "beats" && Number(product.featured) === 1;

    const metadata = [];

    if (product.genre) {
      metadata.push(
        `<span title="Genre"><i class="fas fa-music" aria-hidden="true"></i>${escapeHtml(product.genre)}</span>`
      );
    }

    if (
      product.bpm !== null &&
      Number.isFinite(product.bpm) &&
      product.bpm > 0
    ) {
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

    const playOverlay = playable
      ? `
        <span class="artwork-play-overlay" aria-hidden="true">
          <span class="artwork-play-icon">
            <i class="fas fa-play"></i>
          </span>
        </span>`
      : "";

    const featuredBadge = featured
      ? `<span class="product-featured-badge"><i class="fas fa-star" aria-hidden="true"></i> Featured</span>`
      : "";

    const formatLabel =
      category === "beats"
        ? `
          <p class="product-format">
            <i class="fas fa-file-audio" aria-hidden="true"></i>
            MP3 <span class="format-separator">+</span> WAV
          </p>`
        : category === "samples"
          ? `
            <p class="product-format">
              <i class="fas fa-file-archive" aria-hidden="true"></i>
              Digital Sample Pack
            </p>`
          : `
            <p class="product-format">
              <i class="fas fa-sliders-h" aria-hidden="true"></i>
              Digital Studio Tool
            </p>`;

    return `
      <article
        class="beat-card product-card${playable ? " product-card-playable" : ""}${featured ? " is-featured" : ""}"
        data-product-id="${escapeHtml(product.id)}"
        data-category="${escapeHtml(category)}"
        data-previewable="${playable ? "true" : "false"}"
        ${playable ? 'title="Tap the artwork to play or pause the preview"' : ""}
      >
        <div class="beat-artwork product-artwork">
          <img
            src="${escapeHtml(productArtwork(product))}"
            alt="${escapeHtml(product.title)} artwork"
            loading="lazy"
            onerror="this.onerror=null;this.style.display='none';this.parentElement.classList.add('artwork-placeholder');"
          >
          ${playOverlay}
          <span class="product-category-label">${escapeHtml(categoryLabel(category))}</span>
          ${featuredBadge}
        </div>

        <div class="beat-info product-info">
          <div class="beat-title-row">
            <h3>${escapeHtml(product.title)}</h3>
            <strong class="product-price">${money(product.price)}</strong>
          </div>

          <div class="beat-meta product-meta">
            ${metadata.join("")}
          </div>

          ${description}
          ${formatLabel}

          <div class="product-actions">
            <button
              type="button"
              class="btn btn-primary product-add-btn"
              data-action="add"
              data-id="${escapeHtml(product.id)}"
              data-category="${escapeHtml(category)}"
            >
              ${
                inCart
                  ? '<i class="fas fa-check" aria-hidden="true"></i> Added to Cart'
                  : '<i class="fas fa-cart-plus" aria-hidden="true"></i> Add to Cart'
              }
            </button>
            ${
              category === "beats"
                ? `<button
              type="button"
              class="btn product-share-btn"
              data-action="share"
              data-id="${escapeHtml(product.id)}"
              data-category="${escapeHtml(category)}"
              aria-label="Share ${escapeHtml(product.title)}"
            >
              <i class="fas fa-share-alt" aria-hidden="true"></i> Share
            </button>`
                : ""
            }
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

    const catalogue = mainCatalogueBeats();

    const items = catalogue.filter(product => {
      const matchesGenre =
        state.activeFilter === "all" ||
        product.genre.toLowerCase() === state.activeFilter;

      const searchable =
        `${product.title} ${product.genre} ${product.description} ${product.musical_key}`.toLowerCase();

      return matchesGenre && (!query || searchable.includes(query));
    });

    const artworkTime = activeArtworkAnimationTime(grid);

    grid.innerHTML = items.length
      ? items.map(item => productCard(item, "beats")).join("")
      : `<div class="catalogue-message"><p>${
          catalogue.length
            ? "No beats match your search."
            : state.products.beats.length
              ? "More beats are coming soon. Check out the featured beats above."
              : "No beats are currently published."
        }</p></div>`;

    const genreFilter = document.getElementById("genreFilter");

    if (genreFilter) {
      const current = genreFilter.value || state.activeFilter;

      const genres = [
        ...new Set(
          catalogue.map(item => item.genre).filter(Boolean)
        )
      ].sort();

      genreFilter.innerHTML =
        `<option value="all">All Genres</option>` +
        genres.map(genre =>
          `<option value="${escapeHtml(genre.toLowerCase())}">${escapeHtml(genre)}</option>`
        ).join("");

      genreFilter.value = [
        "all",
        ...genres.map(genre => genre.toLowerCase())
      ].includes(current) ? current : "all";
    }

    const pagination = document.getElementById("pagination");
    if (pagination) pagination.innerHTML = "";

    updateCardPlayIcons();
    restoreArtworkAnimationTime(grid, artworkTime);
  }

  function renderProductCategory(category) {
    if (category !== "samples" && category !== "studio-tools") return;

    const gridId = category === "samples"
      ? "samplesGrid"
      : "studioToolsGrid";

    const grid = document.getElementById(gridId);
    if (!grid) return;

    if (
      state.catalogueErrors[category] &&
      !state.products[category].length
    ) {
      showMessage(
        gridId,
        `${categoryLabel(category)} catalogue could not load: ${state.catalogueErrors[category]}`
      );
      return;
    }

    const query = state.categorySearch.trim().toLowerCase();

    const items = state.products[category].filter(product => {
      const searchable =
        `${product.title} ${product.genre} ${product.description} ${product.musical_key}`.toLowerCase();

      return !query || searchable.includes(query);
    });

    const artworkTime = activeArtworkAnimationTime(grid);

    grid.innerHTML = items.length
      ? items.map(item => productCard(item, category)).join("")
      : `<div class="catalogue-message"><p>${
          query
            ? "No products match your search."
            : category === "samples"
              ? "No sample packs are available yet. Check back soon."
              : "No studio tools are available yet. Check back soon."
        }</p></div>`;

    updateCardPlayIcons();
    restoreArtworkAnimationTime(grid, artworkTime);
  }

  function findProduct(id, category) {
    const product = (state.products[category] || []).find(
      product => product.id === id
    );
    if (product) return product;
    // Beat detail page: the product may not be in the loaded catalogue
    const detail = window.__wagwanspark_detail_product;
    if (detail && detail.id === id && detail.category === category) {
      return detail;
    }
    return undefined;
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
      localStorage.setItem(
        CART_ITEMS_STORAGE_KEY,
        JSON.stringify(state.cartItems)
      );
    } catch (error) {
      console.warn("Cart could not be saved.", error);
    }
  }

  function loadCart() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(CART_STORAGE_KEY) || "[]"
      );

      state.cart = Array.isArray(saved)
        ? saved.filter(key => typeof key === "string")
        : [];
    } catch {
      state.cart = [];
    }

    try {
      const items = JSON.parse(
        localStorage.getItem(CART_ITEMS_STORAGE_KEY) || "{}"
      );

      state.cartItems =
        items && typeof items === "object" && !Array.isArray(items)
          ? items
          : {};
    } catch {
      state.cartItems = {};
    }
  }

  function cartSnapshot(product) {
    return {
      id: product.id,
      category: product.category,
      title: product.title,
      price: product.price,
      artwork: productArtwork(product)
    };
  }

  function getCartProducts() {
    const all = CATEGORIES.flatMap(
      category => state.products[category] || []
    );

    const byKey = new Map(
      all.map(product => [cartKey(product), product])
    );

    // Never edit state.cart here. This runs before catalogues have
    // loaded, and pruning at that point used to empty the cart.
    // Prefer the live product, fall back to the saved snapshot.
    return state.cart
      .map(key => byKey.get(key) || state.cartItems[key])
      .filter(Boolean);
  }

  // Runs once a catalogue has loaded successfully: refresh prices and
  // titles from live data, and drop items that are no longer published.
  function reconcileCart() {
    const byKey = new Map();

    CATEGORIES.forEach(category => {
      (state.products[category] || []).forEach(product => {
        byKey.set(cartKey(product), product);
      });
    });

    let changed = false;

    state.cart = state.cart.filter(key => {
      const live = byKey.get(key);

      if (live) {
        state.cartItems[key] = cartSnapshot(live);
        changed = true;
        return true;
      }

      const saved = state.cartItems[key];

      // Only drop an item when its own catalogue loaded without error.
      // A temporary failure must not empty the cart.
      if (saved && state.catalogueLoaded[saved.category]) {
        delete state.cartItems[key];
        changed = true;
        return false;
      }

      // Legacy cart entry with no snapshot: keep it until its
      // catalogue has loaded, then prune it.
      if (!saved) {
        const category = key.includes(":") ? key.split(":")[0] : "beats";

        if (state.catalogueLoaded[category]) {
          changed = true;
          return false;
        }
      }

      return true;
    });

    if (changed) saveCart();
  }

  function addToCart(product, openDrawer = true) {
    if (!product) return;

    const key = cartKey(product);
    if (!state.cart.includes(key)) state.cart.push(key);
    state.cartItems[key] = cartSnapshot(product);

    saveCart();
    renderAll();

    if (openDrawer) openCart();
  }

  function removeFromCart(key) {
    state.cart = state.cart.filter(item => item !== key);
    delete state.cartItems[key];
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
          <img
            class="cart-item-image"
            src="${escapeHtml(productArtwork(product))}"
            alt=""
            onerror="this.style.display='none'"
          >

          <div class="cart-item-info">
            <h4>${escapeHtml(product.title)}</h4>
            <p>${escapeHtml(categoryLabel(product.category))}</p>
            <strong>${money(product.price)}</strong>
          </div>

          <button
            type="button"
            class="cart-item-remove"
            data-remove="${escapeHtml(cartKey(product))}"
            aria-label="Remove ${escapeHtml(product.title)}"
          >
            <i class="fas fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      `).join("");
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

    const continueButton =
      document.getElementById("cartContinueShopping");

    if (continueButton) {
      continueButton.style.display = "flex";
      continueButton.style.width = "100%";
    }

    $$("[data-action='add']").forEach(button => {
      const product = findProduct(
        button.dataset.id,
        button.dataset.category
      );

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
    const previewAudio = product ? productPreview(product) : "";

    if (!product || !previewAudio) {
      alert("No preview audio has been uploaded for this product yet.");
      return;
    }

    const modal = document.getElementById("playerModal");
    const audio = document.getElementById("audioPlayer");

    if (!modal || !audio) {
      window.open(previewAudio, "_blank", "noopener,noreferrer");
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
    audio.src = previewAudio;
    audio.load();

    state.activePreview = product;

    modal.classList.add("active", "open");
    modal.setAttribute("aria-hidden", "false");

    updateCardPlayIcons();

    audio.play()
      .then(() => {
        updatePlayButton();
        updateCardPlayIcons();
      })
      .catch(error => {
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

    if (!productPreview(product)) {
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
        audio.play()
          .then(() => {
            updatePlayButton();
            updateCardPlayIcons();
          })
          .catch(error => {
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

  // Re-rendering a grid recreates the card images, which would restart
  // the playing artwork loop; carry its position over to the new image.
  function activeArtworkAnimations(root) {
    return $$(".is-preview-active img", root)
      .flatMap(img =>
        typeof img.getAnimations === "function" ? img.getAnimations() : []
      )
      .filter(animation => animation.animationName === "wsArtworkZoomDrift");
  }

  function activeArtworkAnimationTime(root) {
    const animation = activeArtworkAnimations(root)[0];
    return animation ? animation.currentTime : null;
  }

  function restoreArtworkAnimationTime(root, time) {
    if (time === null) return;

    activeArtworkAnimations(root).forEach(animation => {
      animation.currentTime = time;
    });
  }

  // The main "All Beats" catalogue: every published beat that is NOT in the
  // featured carousel, in the order received from the worker (the admin's
  // manual catalogue order). A beat is never in both sections.
  function mainCatalogueBeats() {
    return state.products.beats.filter(
      product => Number(product.featured) !== 1
    );
  }

  // Featured beats in the admin-chosen order. Products featured before
  // ordering existed have no position and follow in the catalogue order.
  function featuredBeats() {
    const position = product => {
      const value = Number(product.featured_position);
      return product.featured_position != null &&
        Number.isInteger(value) && value > 0 ? value : Infinity;
    };

    return state.products.beats
      .map((product, index) => ({ product, index }))
      .filter(({ product }) => Number(product.featured) === 1)
      .sort((a, b) =>
        (position(a.product) - position(b.product)) || (a.index - b.index)
      )
      .map(({ product }) => product);
  }

  function renderFeaturedCarousel() {
    const section = document.getElementById("featured");
    const track = document.getElementById("featuredCarousel");
    if (!section || !track) return;

    const items = featuredBeats();

    if (!items.length) {
      section.hidden = true;
      track.innerHTML = "";
      return;
    }

    const scrollLeft = track.scrollLeft;
    const artworkTime = activeArtworkAnimationTime(track);

    track.innerHTML = items.map(item => productCard(item, "beats")).join("");
    section.hidden = false;
    track.scrollLeft = scrollLeft;

    updateCardPlayIcons();
    restoreArtworkAnimationTime(track, artworkTime);
    updateFeaturedCarouselNav();
  }

  function updateFeaturedCarouselNav() {
    const track = document.getElementById("featuredCarousel");
    const nav = document.getElementById("featuredCarouselNav");
    const prev = document.getElementById("featuredPrev");
    const next = document.getElementById("featuredNext");
    if (!track || !nav || !prev || !next) return;

    const maxScroll = track.scrollWidth - track.clientWidth;
    nav.hidden = maxScroll <= 2;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= maxScroll - 2;
  }

  function scrollFeaturedCarousel(direction) {
    const track = document.getElementById("featuredCarousel");
    const card = track && $(".product-card", track);
    if (!track || !card) return;

    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = card.getBoundingClientRect().width + gap;
    const perView = Math.max(1, Math.floor((track.clientWidth + gap) / step));
    const reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const maxScroll = track.scrollWidth - track.clientWidth;
    const target = Math.max(0, Math.min(maxScroll, track.scrollLeft + direction * step * perView));

    track.scrollTo({ left: target, behavior: reduceMotion ? "auto" : "smooth" });

    // Some browsers drop or cancel smooth scrolling under load; finish the move.
    if (!reduceMotion) {
      setTimeout(() => {
        if (Math.abs(track.scrollLeft - target) > step / 2) {
          track.scrollTo({ left: target, behavior: "auto" });
        }
      }, 900);
    }
  }

  function bindFeaturedCarousel() {
    const track = document.getElementById("featuredCarousel");
    if (!track) return;

    const prev = document.getElementById("featuredPrev");
    const next = document.getElementById("featuredNext");

    if (prev) prev.addEventListener("click", () => scrollFeaturedCarousel(-1));
    if (next) next.addEventListener("click", () => scrollFeaturedCarousel(1));

    let frame = 0;
    const scheduleNavUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateFeaturedCarouselNav();
      });
    };

    track.addEventListener("scroll", scheduleNavUpdate, { passive: true });
    window.addEventListener("resize", scheduleNavUpdate);
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

      const isLoaded = Boolean(
        isActive && audio && audio.currentSrc && !audio.ended
      );

      const isAudible = Boolean(
        isPlaying &&
        !audio.ended &&
        audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      );

      card.classList.toggle("is-preview-playing", isPlaying);
      card.classList.toggle("is-preview-active", isLoaded);
      card.classList.toggle("is-preview-animating", isAudible);

      const icon = $(".artwork-play-icon i", card);

      if (icon) {
        icon.className = isPlaying ? "fas fa-pause" : "fas fa-play";
      }
    });
  }

  async function shareBeat(product) {
    if (!product) return;

    const shareUrl =
      `${window.location.origin}/beat/${encodeURIComponent(product.id)}`;

    const shareData = {
      title: `${product.title} — WagwanSpark`,
      text: `Check out "${product.title}" on WagwanSpark Sound Lab.`,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== "AbortError") {
          await copyLink(shareUrl);
        }
      }
    } else {
      await copyLink(shareUrl);
    }
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard!");
    } catch {
      const input = document.createElement("input");
      input.value = url;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        showToast("Link copied to clipboard!");
      } catch {
        showToast("Copy this link: " + url);
      }
      document.body.removeChild(input);
    }
  }

  function showToast(message) {
    let toast = document.getElementById("wagwanspark-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "wagwanspark-toast";
      toast.className = "wagwanspark-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 2500);
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

    return `${Math.floor(value / 60)}:${String(
      value % 60
    ).padStart(2, "0")}`;
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
      .map(item => ({
        id: item.id,
        category: item.category
      }));

    const payload = {
      email: cleanedEmail,
      beatIds,
      productItems
    };

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
        throw new Error(
          "The payment service returned an unreadable response."
        );
      }

      if (
        !response.ok ||
        !result.status ||
        !result.data?.authorization_url
      ) {
        throw new Error(
          result.error ||
          result.message ||
          "Unable to start checkout. Please try again."
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
    renderFeaturedCarousel();

    // Prefer the actual page grid, with URL detection as a fallback.
    if (document.getElementById("samplesGrid")) {
      renderProductCategory("samples");
    } else if (document.getElementById("studioToolsGrid")) {
      renderProductCategory("studio-tools");
    } else if (document.getElementById("beatsGrid")) {
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
        } else if (product && actionButton.dataset.action === "share") {
          shareBeat(product);
        }

        return;
      }

      const removeButton = target.closest("[data-remove]");

      if (removeButton) {
        removeFromCart(removeButton.dataset.remove);
        return;
      }

      const card = target.closest(
        ".product-card[data-previewable='true']"
      );

      if (
        card &&
        !target.closest(
          "button, a, input, select, textarea, [role='button']"
        )
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

    bindHeroSearch();
    bindFeaturedCarousel();

    const categorySearchInput =
      document.getElementById("sampleSearchInput") ||
      document.getElementById("studioToolsSearch");

    if (categorySearchInput) {
      categorySearchInput.addEventListener("input", event => {
        state.categorySearch = event.target.value || "";
        renderAll();
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

    [
      "closeCart",
      "cartContinueShopping",
      "continueShopping"
    ].forEach(id => {
      const element = document.getElementById(id);

      if (element) element.addEventListener("click", closeCart);
    });

    const checkoutButton = ensureCheckoutButton();

    if (checkoutButton) {
      checkoutButton.addEventListener("click", checkoutCart);
    }

    const overlay = document.getElementById("cartOverlay");

    if (overlay) overlay.addEventListener("click", closeCart);

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
          audio.play()
            .then(() => {
              updatePlayButton();
              updateCardPlayIcons();
            })
            .catch(error => {
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
      audio.addEventListener("playing", updateCardPlayIcons);
      audio.addEventListener("waiting", updateCardPlayIcons);

      audio.addEventListener("timeupdate", () => {
        const current = document.getElementById("currentTime");
        const progress = document.getElementById("progressBar");

        if (current) {
          current.textContent = formatTime(audio.currentTime);
        }

        if (
          progress &&
          Number.isFinite(audio.duration) &&
          audio.duration > 0
        ) {
          progress.value = String(
            (audio.currentTime / audio.duration) * 100
          );
        }
      });

      audio.addEventListener("loadedmetadata", () => {
        const duration = document.getElementById("duration");

        if (duration) {
          duration.textContent = formatTime(audio.duration);
        }
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
        if (
          Number.isFinite(audio.duration) &&
          audio.duration > 0
        ) {
          audio.currentTime =
            (Number(progress.value) / 100) * audio.duration;
        }
      });
    }

    const navbarToggle = document.getElementById("navbarToggle");
    const navMenu = document.getElementById("navMenu");

    if (navbarToggle && navMenu) {
      navbarToggle.addEventListener("click", () => {
        setNavOpen(!navMenu.classList.contains("active"));
      });
    }

    const year = document.getElementById("currentYear");

    if (year) {
      year.textContent = String(new Date().getFullYear());
    }

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        setNavOpen(false);
        closeCart();
        closePreview();
      }
    });

    // Beat detail page: update cart button state after the beat loads
    window.addEventListener("wagwanspark:detail-ready", () => {
      renderCart();
    });
  }

  async function initializeStore() {
    try {
      installStoreInteractionStyles();
      buildNavDrawer();
      buildHeroVisual();
      configureNavigation();
      loadCart();
      bindEvents();

      const summary = document.getElementById("cartSummary");

      if (summary) {
        summary.hidden = true;
        summary.style.display = "none";
      }

      renderCart();

      // Render a visible loading state immediately on category pages.
      if (document.getElementById("samplesGrid")) {
        showMessage("samplesGrid", "Loading sample packs...");
      } else if (document.getElementById("studioToolsGrid")) {
        showMessage("studioToolsGrid", "Loading Studio Tools...");
      } else if (document.getElementById("beatsGrid")) {
        showMessage("beatsGrid", "Loading beats...");
      }

      await loadCatalogues();
    } catch (error) {
      console.error("Store initialization failed:", error);

      if (document.getElementById("samplesGrid")) {
        showMessage(
          "samplesGrid",
          "The sample catalogue could not initialize. Refresh the page and try again."
        );
      } else if (document.getElementById("studioToolsGrid")) {
        showMessage(
          "studioToolsGrid",
          "The Studio Tools catalogue could not initialize. Refresh the page and try again."
        );
      } else if (document.getElementById("beatsGrid")) {
        showMessage(
          "beatsGrid",
          "The beat catalogue could not initialize. Refresh the page and try again."
        );
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeStore,
      { once: true }
    );
  } else {
    initializeStore();
  }
})();
