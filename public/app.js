
/* ==========================================
   WAGWANSPARK — BEAT STORE APPLICATION
   Beats • Samples • Studio Tools
   ========================================== */

const CART_STORAGE_KEY = "wagwanspark_cart_v1";

const API = {
  beats: "/api/beats",
  products: "/api/products",
  payment: "/api/create-payment"
};

let BEATS_CATALOG = [];
let SAMPLE_CATALOG = [];
let STUDIO_TOOLS_CATALOG = [];

function loadSavedCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? [...new Set(saved.filter(item => typeof item === "string"))]
      : [];
  } catch (error) {
    console.error("Unable to restore cart:", error);
    return [];
  }
}

const state = {
  allBeats: [],
  filteredBeats: [],
  currentPage: 1,
  beatsPerPage: 24,
  selectedGenre: "all",
  searchQuery: "",
  currentBeat: null,
  availableGenres: [],
  cart: loadSavedCart(),
  checkoutInProgress: false
};

/* ==========================================
   DOM ELEMENTS
   ========================================== */

const beatsGrid = document.getElementById("beatsGrid");
const paginationContainer = document.getElementById("pagination");
const genreFilter = document.getElementById("genreFilter");
const filterButtonsContainer = document.querySelector(".filter-buttons");

const beatSearchInput =
  document.getElementById("searchInput") ||
  document.getElementById("beatSearch");

const playerModal = document.getElementById("playerModal");
const closePlayer = document.getElementById("closePlayer");
const audioPlayer = document.getElementById("audioPlayer");

const playBtn =
  document.getElementById("playPauseBtn") ||
  document.getElementById("playBtn");

const progressInput =
  document.getElementById("progressBar") ||
  document.getElementById("progressInput");

const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");

const navbarToggle = document.getElementById("navbarToggle");
const navMenu = document.getElementById("navMenu");

const cartToggle = document.getElementById("cartToggle");
const cartCount = document.getElementById("cartCount");
const cartOverlay = document.getElementById("cartOverlay");
const cartDrawer = document.getElementById("cartDrawer");
const closeCartButton = document.getElementById("closeCart");
const cartItemsContainer = document.getElementById("cartItems");
const cartEmpty = document.getElementById("cartEmpty");
const cartSummary = document.getElementById("cartSummary");
const cartItemLabel = document.getElementById("cartItemLabel");
const cartSummaryCount = document.getElementById("cartSummaryCount");
const cartTotal = document.getElementById("cartTotal");
const checkoutBtn = document.getElementById("checkoutBtn");

const continueShoppingButton =
  document.getElementById("continueShopping");

const cartContinueShoppingButton =
  document.getElementById("cartContinueShopping");

/* ==========================================
   GENERAL HELPERS
   ========================================== */

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(`Invalid server response from ${url}.`);
  }

  if (!response.ok) {
    throw new Error(
      result.message || `${url} returned HTTP ${response.status}.`
    );
  }

  return result;
}

function mediaURL(id, type) {
  return `/api/media/${encodeURIComponent(id)}/${type}`;
}

function formatNaira(amount) {
  return `₦${Number(amount || 0).toLocaleString("en-NG")}`;
}

function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(value ?? "").replace(/[&<>"']/g, character => map[character]);
}

function getFormatLabel(product) {
  return (
    Array.isArray(product.formats) && product.formats.length
      ? product.formats
      : ["Digital Download"]
  ).join(" + ");
}

function isPublishedProduct(product) {
  return Boolean(
    product.id &&
    product.title &&
    product.price > 0 &&
    product.available &&
    product.status.toLowerCase() === "published"
  );
}

/* ==========================================
   PRODUCT NORMALIZATION
   ========================================== */

function normalizeProduct(product, category) {
  const id = String(product.id || "").trim();

  const previewKey = String(
    product.preview_key ||
    product.previewKey ||
    ""
  ).trim();

  const suppliedPreview = String(
    product.previewAudio ||
    product.preview_audio ||
    product.preview_url ||
    ""
  ).trim();

  /*
   * Samples use the Worker preview route when a preview key exists.
   * A supplied preview URL takes precedence.
   */
  const previewAudio = suppliedPreview ||
    (category === "samples" && previewKey
      ? mediaURL(id, "preview")
      : "");

  return {
    id,
    category,
    title: String(product.title || "").trim(),
    genre: String(product.genre || product.category || category).trim(),
    bpm: Number(product.bpm) || 0,
    key: String(product.musical_key || product.key || "").trim(),
    price: Number(product.price) || 0,

    artwork: product.artwork
      ? String(product.artwork)
      : mediaURL(id, "artwork"),

    preview_key: previewKey,
    previewAudio,

    description: String(product.description || "").trim(),

    formats: Array.isArray(product.formats) && product.formats.length
      ? product.formats
      : ["Digital Download"],

    featured:
      product.featured === true ||
      Number(product.featured) === 1,

    available:
      product.available === undefined
        ? true
        : product.available === true ||
          product.available === 1 ||
          product.available === "1",

    status: String(product.status || "published")
  };
}

/* ==========================================
   CATALOGUE LOADING
   ========================================== */

async function loadLiveCatalogue() {
  try {
    const data = await fetchJSON(API.beats);

    if (!Array.isArray(data.beats)) {
      throw new Error("Invalid beats catalogue response.");
    }

    BEATS_CATALOG = data.beats
      .map(beat => normalizeProduct(beat, "beats"))
      .filter(isPublishedProduct);

    console.log("Published beats loaded:", BEATS_CATALOG.length);
  } catch (error) {
    console.error("Could not load live beats:", error);
    BEATS_CATALOG = [];
  }
}

async function loadCategory(category) {
  try {
    const data = await fetchJSON(
      `${API.products}?category=${encodeURIComponent(category)}`
    );

    if (!Array.isArray(data.products)) {
      throw new Error(`Invalid ${category} catalogue response.`);
    }

    const products = data.products
      .map(product => normalizeProduct(product, category))
      .filter(isPublishedProduct);

    console.log(`${category} loaded:`, products.length);
    return products;
  } catch (error) {
    console.error(`Could not load ${category}:`, error);
    return [];
  }
}

/* ==========================================
   CATEGORY SECTIONS
   ========================================== */

function prepareCategorySections() {
  const categories = [
    {
      id: "samples",
      gridId: "samplesGrid",
      messageId: "samplesMessage"
    },
    {
      id: "studio-tools",
      gridId: "studioToolsGrid",
      messageId: "studioToolsMessage"
    }
  ];

  categories.forEach(category => {
    const section = document.getElementById(category.id);

    if (!section) {
      console.error(`Missing HTML section: #${category.id}`);
      return;
    }

    section.querySelector(".category-coming-soon")?.remove();

    let grid = document.getElementById(category.gridId);

    if (!grid) {
      grid = document.createElement("div");
      grid.id = category.gridId;
      grid.className = "beats-grid product-category-grid";

      const header = section.querySelector(".section-header");

      if (header) {
        header.insertAdjacentElement("afterend", grid);
      } else {
        section.appendChild(grid);
      }
    }

    let message = document.getElementById(category.messageId);

    if (!message) {
      message = document.createElement("p");
      message.id = category.messageId;
      message.className = "store-category-message";
      message.style.cssText =
        "padding:20px 0;color:var(--text-secondary,#aaa);";

      grid.insertAdjacentElement("afterend", message);
    }
  });
}

/* ==========================================
   CART ITEM IDENTIFIERS
   ========================================== */

/*
 * Beat IDs retain their original format for compatibility.
 * Other products use category:id so IDs cannot collide.
 */

function cartKey(product) {
  return product.category === "beats"
    ? product.id
    : `${product.category}:${product.id}`;
}

function parseCartKey(key) {
  const separator = key.indexOf(":");

  if (separator === -1) {
    return {
      category: "beats",
      id: key
    };
  }

  return {
    category: key.slice(0, separator),
    id: key.slice(separator + 1)
  };
}

function getCatalogue(category) {
  if (category === "beats") return state.allBeats;
  if (category === "samples") return SAMPLE_CATALOG;
  if (category === "studio-tools") return STUDIO_TOOLS_CATALOG;
  return [];
}

function findCartProduct(key) {
  const parsed = parseCartKey(key);

  return getCatalogue(parsed.category).find(
    product => product.id === parsed.id
  );
}

function getCartProducts() {
  const products = state.cart
    .map(findCartProduct)
    .filter(Boolean);

  const validKeys = products.map(cartKey);

  if (
    validKeys.length !== state.cart.length ||
    new Set(state.cart).size !== state.cart.length
  ) {
    state.cart = [...new Set(validKeys)];
    saveCart();
  }

  return products;
}

/* ==========================================
   RENDER SAMPLES AND STUDIO TOOLS
   ========================================== */

function renderProductCategory(products, category) {
  const isSamples = category === "samples";

  const gridId = isSamples ? "samplesGrid" : "studioToolsGrid";
  const messageId = isSamples ? "samplesMessage" : "studioToolsMessage";

  const grid = document.getElementById(gridId);
  const message = document.getElementById(messageId);

  if (!grid) {
    console.error(`Missing product grid: #${gridId}`);
    return;
  }

  grid.innerHTML = "";

  if (!products.length) {
    if (message) {
      message.textContent = isSamples
        ? "No published sample packs are available yet."
        : "No published studio tools are available yet.";
    }

    return;
  }

  if (message) message.textContent = "";

  products.forEach(product => {
    const card = document.createElement("article");
    card.className = "beat-card product-card";

    const image = document.createElement("img");
    image.className = "beat-product-artwork";
    image.src = product.artwork;
    image.alt = product.title;
    image.loading = "lazy";
    image.style.cssText =
      "width:100%;aspect-ratio:1/1;object-fit:cover;display:block;";

    image.addEventListener("error", () => {
      image.onerror = null;
      image.src = "/images/placeholder.jpg";
    });

    const info = document.createElement("div");
    info.className = "beat-info";

    const title = document.createElement("h3");
    title.className = "beat-title";
    title.textContent = product.title;

    const description = document.createElement("p");
    description.className = "product-description";
    description.textContent = product.description ||
      (isSamples ? "Digital sample pack" : "Studio production tool");

    const format = document.createElement("p");
    format.className = "product-format";
    format.textContent = `Format: ${getFormatLabel(product)}`;

    const price = document.createElement("div");
    price.className = "beat-price";
    price.textContent = formatNaira(product.price);

    info.append(title, description, format, price);

    if (isSamples) {
      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "buy-btn product-preview-btn";
      previewButton.innerHTML =
        '<i class="fas fa-play"></i> Preview Audio';

      previewButton.addEventListener("click", () => {
        openProductPreview(product);
      });

      info.appendChild(previewButton);
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "buy-btn add-to-cart-btn";

    function updateAddButton() {
      const added = state.cart.includes(cartKey(product));

      addButton.innerHTML = added
        ? '<i class="fas fa-check"></i> Added to Cart'
        : '<i class="fas fa-cart-plus"></i> Add to Cart';

      addButton.setAttribute("aria-pressed", String(added));
    }

    updateAddButton();

    addButton.addEventListener("click", () => {
      addProductToCart(product);
      updateAddButton();
    });

    info.appendChild(addButton);

    const note = document.createElement("p");
    note.className = "product-purchase-note";
    note.style.cssText = "font-size:12px;opacity:.7;margin-top:10px;";
    note.textContent = isSamples
      ? "Digital sample pack • Secure checkout"
      : "Digital studio resource • Secure checkout";

    info.appendChild(note);

    card.append(image, info);
    grid.appendChild(card);
  });
}

/* ==========================================
   SAMPLE PREVIEW
   ========================================== */

async function openProductPreview(product) {
  if (!product.previewAudio) {
    alert(
      "No preview file is linked to this sample yet. Upload a preview audio file in Admin and publish the sample."
    );
    return;
  }

  if (!audioPlayer || !playerModal) {
    alert("The audio player is not available on this page.");
    return;
  }

  state.currentBeat = product;

  const elements = getPlayerElements();

  if (elements.title) elements.title.textContent = product.title;
  if (elements.genre) elements.genre.textContent = "Sample Preview";

  if (elements.bpm) {
    elements.bpm.textContent = product.bpm ? `${product.bpm} BPM` : "";
  }

  if (elements.key) elements.key.textContent = product.key || "";

  if (elements.artwork) {
    elements.artwork.src = product.artwork;
    elements.artwork.alt = product.title;
  }

  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = product.previewAudio;
  audioPlayer.load();

  if (progressInput) {
    progressInput.value = 0;
    progressInput.max = 100;
  }

  if (currentTimeEl) currentTimeEl.textContent = "0:00";
  if (durationEl) durationEl.textContent = "0:00";
  if (elements.progress) elements.progress.style.width = "0%";

  playerModal.classList.add("active");
  playerModal.setAttribute("aria-hidden", "false");

  updatePlayButton();

  try {
    await audioPlayer.play();
  } catch (error) {
    console.error("Sample preview could not play:", error);

    alert(
      "The preview file could not be played. Check that the preview was uploaded correctly and that its Worker media route is working."
    );

    updatePlayButton();
  }
}

/* ==========================================
   GENRE MANAGEMENT
   ========================================== */

function buildAvailableGenres() {
  state.availableGenres = [
    ...new Set(state.allBeats.map(beat => beat.genre).filter(Boolean))
  ].sort();
}

function renderGenreSelect() {
  if (!genreFilter) return;

  genreFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Genres";
  genreFilter.appendChild(allOption);

  state.availableGenres.forEach(genre => {
    const option = document.createElement("option");
    option.value = genre;
    option.textContent = genre;
    genreFilter.appendChild(option);
  });

  genreFilter.value = state.selectedGenre;
}

function renderFilterButtons() {
  if (!filterButtonsContainer) return;

  const options = [
    { key: "all", label: "All" },
    { key: "Hip-Hop", label: "Hip-Hop" },
    { key: "Trap", label: "Trap" },
    { key: "R&B", label: "R&B" },
    { key: "Afrobeat", label: "Afrobeat" },
    { key: "Afro Fusion", label: "Afro Fusion" },
    { key: "Afro House", label: "Afro House" },
    { key: "Amapiano", label: "Amapiano" }
  ];

  filterButtonsContainer.innerHTML = "";

  options.forEach(option => {
    if (
      option.key !== "all" &&
      !state.availableGenres.includes(option.key)
    ) return;

    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `filter-btn ${option.key === state.selectedGenre ? "active" : ""}`;
    button.dataset.filter = option.key;
    button.textContent = option.label;

    button.addEventListener("click", () => {
      state.selectedGenre = option.key;
      state.currentPage = 1;
      updateFilterButtons();
      applyFilters();
      renderBeats();
    });

    filterButtonsContainer.appendChild(button);
  });
}

function updateFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.filter === state.selectedGenre
    );
  });
}

/* ==========================================
   BEAT SEARCH AND FILTERS
   ========================================== */

function applyFilters() {
  let filtered = [...state.allBeats];

  if (state.selectedGenre !== "all") {
    filtered = filtered.filter(
      beat => beat.genre === state.selectedGenre
    );
  }

  if (state.searchQuery.trim()) {
    const query = state.searchQuery.toLowerCase();

    filtered = filtered.filter(beat =>
      beat.title.toLowerCase().includes(query) ||
      beat.genre.toLowerCase().includes(query) ||
      beat.key.toLowerCase().includes(query) ||
      String(beat.bpm).includes(query) ||
      beat.description.toLowerCase().includes(query)
    );
  }

  state.filteredBeats = filtered;
  state.currentPage = 1;
}

function handleSearch(query) {
  state.searchQuery = query;
  applyFilters();
  renderBeats();
}

function getPaginatedBeats() {
  const start = (state.currentPage - 1) * state.beatsPerPage;

  return state.filteredBeats.slice(
    start,
    start + state.beatsPerPage
  );
}

function getTotalPages() {
  return Math.ceil(state.filteredBeats.length / state.beatsPerPage);
}

/* ==========================================
   BEAT CARDS
   ========================================== */

function renderBeats() {
  if (!beatsGrid) return;

  beatsGrid.innerHTML = "";

  if (paginationContainer) {
    paginationContainer.innerHTML = "";
  }

  if (!state.filteredBeats.length) {
    displayNoResultsMessage();
    return;
  }

  getPaginatedBeats().forEach(beat => {
    beatsGrid.appendChild(createBeatCard(beat));
  });

  const totalPages = getTotalPages();

  if (totalPages > 1) {
    renderPaginationControls(totalPages);
  }
}

function createBeatCard(beat) {
  const card = document.createElement("div");
  card.className = "beat-card";

  const added = state.cart.includes(beat.id);
  const formatLabel = getFormatLabel(beat);

  card.innerHTML = `
    <div class="beat-artwork" role="button" tabindex="0"
      aria-label="Play ${escapeHtml(beat.title)} preview">
      <img src="${escapeHtml(beat.artwork)}"
        alt="${escapeHtml(beat.title)}" loading="lazy">
      <div class="play-overlay">
        <div class="play-btn-overlay">
          <i class="fas fa-play"></i>
        </div>
      </div>
    </div>

    <div class="beat-info">
      <h3 class="beat-title">${escapeHtml(beat.title)}</h3>

      <div class="beat-meta">
        <span class="beat-meta-item">
          <i class="fas fa-music"></i> ${escapeHtml(beat.genre)}
        </span>
        <span class="beat-meta-item">
          <i class="fas fa-tachometer-alt"></i> ${beat.bpm} BPM
        </span>
        <span class="beat-meta-item">
          <i class="fas fa-key"></i> ${escapeHtml(beat.key)}
        </span>
      </div>

      <div class="beat-format-row">
        <span class="beat-format-badge">
          <i class="fas fa-file-audio"></i>
          ${escapeHtml(formatLabel)}
        </span>
        <span class="beat-download-note">Digital download</span>
      </div>

      <div class="beat-price">${formatNaira(beat.price)}</div>

      <button class="buy-btn add-to-cart-btn" type="button"
        data-beat-id="${escapeHtml(beat.id)}">
        <i class="fas ${added ? "fa-check" : "fa-cart-plus"}"></i>
        ${added ? "Added to Cart" : "Add to Cart"}
      </button>
    </div>
  `;

  const artwork = card.querySelector(".beat-artwork");
  const image = card.querySelector(".beat-artwork img");

  image.addEventListener("error", () => {
    image.onerror = null;
    image.src = "/images/placeholder.jpg";
  });

  artwork.addEventListener("click", () => openPlayer(beat));

  artwork.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPlayer(beat);
    }
  });

  card.querySelector(".add-to-cart-btn").addEventListener("click", event => {
    event.stopPropagation();
    addProductToCart(beat);
  });

  return card;
}

function renderPaginationControls(totalPages) {
  const container = paginationContainer || beatsGrid;
  const pagination = document.createElement("div");
  pagination.className = "pagination-controls";

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "← Previous";
  previous.disabled = state.currentPage === 1;

  const info = document.createElement("span");
  info.textContent = `Page ${state.currentPage} of ${totalPages}`;

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next →";
  next.disabled = state.currentPage === totalPages;

  previous.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderBeats();

      beatsGrid.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  next.addEventListener("click", () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderBeats();

      beatsGrid.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  pagination.append(previous, info, next);
  container.appendChild(pagination);
}

function displayNoResultsMessage() {
  if (!beatsGrid) return;

  beatsGrid.innerHTML = `
    <div class="store-message">
      <i class="fas fa-search"></i>
      <p>No beats found. Try adjusting your search or filters.</p>
    </div>
  `;
}

/* ==========================================
   CART STORAGE AND OPERATIONS
   ========================================== */

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
  } catch (error) {
    console.error("Unable to save cart:", error);
  }
}

function getCartTotal() {
  return getCartProducts().reduce(
    (total, product) => total + product.price,
    0
  );
}

function addProductToCart(product) {
  if (!product || !product.id || product.price <= 0) {
    alert("This product is currently unavailable.");
    return;
  }

  const key = cartKey(product);

  if (!state.cart.includes(key)) {
    state.cart.push(key);
  }

  saveCart();
  renderCart();
  renderBeats();

  renderProductCategory(SAMPLE_CATALOG, "samples");
  renderProductCategory(STUDIO_TOOLS_CATALOG, "studio-tools");

  openCart();
}

function removeFromCart(key) {
  state.cart = state.cart.filter(item => item !== key);

  saveCart();
  renderCart();
  renderBeats();

  renderProductCategory(SAMPLE_CATALOG, "samples");
  renderProductCategory(STUDIO_TOOLS_CATALOG, "studio-tools");
}

function setVisible(element, visible, displayValue = "") {
  if (!element) return;

  element.hidden = !visible;
  element.style.display = visible ? displayValue : "none";
  element.setAttribute("aria-hidden", String(!visible));
}

/* ==========================================
   CART RENDERING
   ========================================== */

function renderCart() {
  const products = getCartProducts();
  const count = products.length;
  const total = products.reduce((sum, product) => sum + product.price, 0);

  if (cartCount) {
    cartCount.textContent = String(count);
    cartCount.setAttribute(
      "aria-label",
      `${count} ${count === 1 ? "item" : "items"} in cart`
    );
    cartCount.classList.toggle("has-items", count > 0);
  }

  if (cartItemLabel) {
    cartItemLabel.textContent = `${count} ${count === 1 ? "item" : "items"}`;
  }

  if (cartSummaryCount) {
    cartSummaryCount.textContent = String(count);
  }

  if (cartTotal) {
    cartTotal.textContent = formatNaira(total);
  }

  if (cartItemsContainer) {
    cartItemsContainer.innerHTML = "";

    products.forEach(product => {
      const item = document.createElement("div");
      item.className = "cart-item";

      const categoryLabel = product.category === "beats"
        ? `${product.genre} · ${product.bpm} BPM · ${product.key}`
        : product.category === "samples"
          ? "Sample Pack"
          : "Studio Tool";

      item.innerHTML = `
        <img class="cart-item-image cart-item-artwork"
          src="${escapeHtml(product.artwork)}"
          alt="${escapeHtml(product.title)}">

        <div class="cart-item-info cart-item-details">
          <h3 class="cart-item-title">${escapeHtml(product.title)}</h3>
          <p class="cart-item-meta">${escapeHtml(categoryLabel)}</p>
          <span class="cart-item-format">
            Includes ${escapeHtml(getFormatLabel(product))}
          </span>
          <strong class="cart-item-price">
            ${formatNaira(product.price)}
          </strong>
        </div>

        <button type="button" class="cart-remove-btn"
          aria-label="Remove ${escapeHtml(product.title)} from cart">
          <i class="fas fa-trash-alt"></i>
        </button>
      `;

      const image = item.querySelector("img");

      image.addEventListener("error", () => {
        image.onerror = null;
        image.src = "/images/placeholder.jpg";
      });

      item.querySelector(".cart-remove-btn").addEventListener("click", () => {
        removeFromCart(cartKey(product));
      });

      cartItemsContainer.appendChild(item);
    });
  }

  setVisible(cartEmpty, count === 0);
  setVisible(cartSummary, count > 0);
  setVisible(cartItemsContainer, count > 0);

  if (checkoutBtn) {
    checkoutBtn.disabled = count === 0 || state.checkoutInProgress;

    if (!state.checkoutInProgress) {
      checkoutBtn.innerHTML =
        '<span>Proceed to Checkout</span> <i class="fas fa-lock"></i>';
    }
  }
}

/* ==========================================
   OPEN / CLOSE CART
   ========================================== */

function openCart() {
  if (!cartDrawer || !cartOverlay) return;

  renderCart();

  cartDrawer.classList.add("active");
  cartOverlay.classList.add("active");

  cartDrawer.setAttribute("aria-hidden", "false");
  cartOverlay.setAttribute("aria-hidden", "false");

  cartToggle?.setAttribute("aria-expanded", "true");
  document.body.classList.add("cart-open");

  closeCartButton?.focus({ preventScroll: true });
}

function closeCart() {
  if (!cartDrawer || !cartOverlay) return;

  cartDrawer.classList.remove("active");
  cartOverlay.classList.remove("active");

  cartDrawer.setAttribute("aria-hidden", "true");
  cartOverlay.setAttribute("aria-hidden", "true");

  cartToggle?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("cart-open");
}

function continueShopping() {
  closeCart();

  document.getElementById("beats")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* ==========================================
   PAYSTACK CHECKOUT
   Existing beat fields retained.
   Product items included for Worker integration.
   ========================================== */

async function checkoutCart() {
  if (state.checkoutInProgress) return;

  const products = getCartProducts();

  if (!products.length) {
    renderCart();
    alert("Your cart is empty. Add a product before checking out.");
    return;
  }

  const total = products.reduce(
    (sum, product) => sum + product.price,
    0
  );

  const emailInput = prompt(
    `Your cart total is ${formatNaira(total)}.\n\n` +
    "Your purchase includes the digital files listed for each item.\n\n" +
    "Enter your email address for payment:"
  );

  if (emailInput === null) return;

  const email = emailInput.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Please enter a valid email address.");
    return;
  }

  const beatIds = products
    .filter(product => product.category === "beats")
    .map(product => product.id);

  const productItems = products
    .filter(product => product.category !== "beats")
    .map(product => ({
      id: product.id,
      category: product.category
    }));

  state.checkoutInProgress = true;

  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Preparing Checkout...';
  }

  try {
    /*
     * Keep the existing beatIds / beatId / amount fields.
     * The Worker update must validate productItems against its
     * database and calculate the actual total server-side.
     */
    const payload = {
      email,
      beatIds,
      amount: total,
      productItems
    };

    if (beatIds.length === 1 && productItems.length === 0) {
      payload.beatId = beatIds[0];
    }

    const result = await fetchJSON(API.payment, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!result.status || !result.data?.authorization_url) {
      throw new Error(
        result.message || "Unable to start checkout. Please try again."
      );
    }

    window.location.href = result.data.authorization_url;
  } catch (error) {
    console.error("Checkout error:", error);

    alert(
      error.message || "Unable to start checkout. Please try again."
    );

    state.checkoutInProgress = false;
    renderCart();
  }
}

/* ==========================================
   AUDIO PLAYER
   ========================================== */

function getPlayerElement(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);

    if (element) return element;
  }

  return null;
}

function getPlayerElements() {
  return {
    title: getPlayerElement("playerTitle", "playerBeatTitle"),
    genre: getPlayerElement("playerGenre", "playerBeatGenre"),
    artwork: getPlayerElement("playerImage", "playerBeatArt"),
    bpm: getPlayerElement("playerBeatBPM"),
    key: getPlayerElement("playerBeatKey"),
    progress: getPlayerElement("progress")
  };
}

async function openPlayer(beat) {
  if (!beat || !audioPlayer || !playerModal) return;

  if (!beat.previewAudio) {
    alert("Preview audio is not available for this beat yet.");
    return;
  }

  state.currentBeat = beat;

  const elements = getPlayerElements();

  if (elements.title) elements.title.textContent = beat.title;
  if (elements.genre) elements.genre.textContent = beat.genre;
  if (elements.bpm) elements.bpm.textContent = `${beat.bpm} BPM`;
  if (elements.key) elements.key.textContent = beat.key;

  if (elements.artwork) {
    elements.artwork.src = beat.artwork;
    elements.artwork.alt = beat.title;

    elements.artwork.onerror = () => {
      elements.artwork.onerror = null;
      elements.artwork.src = "/images/placeholder.jpg";
    };
  }

  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = beat.previewAudio;
  audioPlayer.load();

  if (progressInput) {
    progressInput.value = 0;
    progressInput.max = 100;
    progressInput.setAttribute("aria-label", "Track progress");
  }

  if (currentTimeEl) currentTimeEl.textContent = "0:00";
  if (durationEl) durationEl.textContent = "0:00";
  if (elements.progress) elements.progress.style.width = "0%";

  playerModal.classList.add("active");
  playerModal.setAttribute("aria-hidden", "false");

  updatePlayButton();

  try {
    await audioPlayer.play();
  } catch (error) {
    console.error("Audio playback failed:", error);
    updatePlayButton();
  }
}

function closePlayerModal() {
  if (!playerModal || !audioPlayer) return;

  playerModal.classList.remove("active");
  playerModal.setAttribute("aria-hidden", "true");

  audioPlayer.pause();
  updatePlayButton();
}

async function togglePlay() {
  if (!audioPlayer) return;

  if (!audioPlayer.src) {
    if (state.currentBeat) {
      if (state.currentBeat.category === "samples") {
        await openProductPreview(state.currentBeat);
      } else {
        await openPlayer(state.currentBeat);
      }
    }

    return;
  }

  if (audioPlayer.paused) {
    try {
      await audioPlayer.play();
    } catch (error) {
      console.error("Unable to play audio:", error);
    }
  } else {
    audioPlayer.pause();
  }

  updatePlayButton();
}

function updatePlayButton() {
  if (!playBtn || !audioPlayer) return;

  const playing = !audioPlayer.paused;

  playBtn.innerHTML = playing
    ? '<i class="fas fa-pause"></i>'
    : '<i class="fas fa-play"></i>';

  playBtn.setAttribute(
    "aria-label",
    playing ? "Pause preview" : "Play preview"
  );

  playBtn.setAttribute("aria-pressed", String(playing));
}

function seek() {
  if (
    !audioPlayer ||
    !progressInput ||
    !Number.isFinite(audioPlayer.duration) ||
    audioPlayer.duration <= 0
  ) return;

  const percent = Math.max(
    0,
    Math.min(100, Number(progressInput.value) || 0)
  );

  audioPlayer.currentTime = (percent / 100) * audioPlayer.duration;

  updateProgress();
}

function updateProgress() {
  if (!audioPlayer) return;

  const duration = audioPlayer.duration;
  const current = audioPlayer.currentTime || 0;

  const percent =
    Number.isFinite(duration) && duration > 0
      ? Math.min(100, (current / duration) * 100)
      : 0;

  const elements = getPlayerElements();

  if (elements.progress) {
    elements.progress.style.width = `${percent}%`;
  }

  if (progressInput) {
    progressInput.value = percent;
  }

  if (currentTimeEl) {
    currentTimeEl.textContent = formatTime(current);
  }
}

function updateDuration() {
  if (!audioPlayer) return;

  if (durationEl) {
    durationEl.textContent = formatTime(audioPlayer.duration);
  }

  if (progressInput) {
    progressInput.min = 0;
    progressInput.max = 100;
    progressInput.step = 0.1;
  }

  updateProgress();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function handleAudioEnd() {
  if (!audioPlayer) return;

  audioPlayer.currentTime = 0;
  updateProgress();
  updatePlayButton();
}

/* ==========================================
   MOBILE MENU
   ========================================== */

function toggleMobileMenu() {
  if (!navMenu || !navbarToggle) return;

  const active = navMenu.classList.toggle("active");

  navbarToggle.classList.toggle("active", active);
  navbarToggle.setAttribute("aria-expanded", String(active));
}

/* ==========================================
   EVENT LISTENERS
   ========================================== */

function setupEventListeners() {
  beatSearchInput?.addEventListener("input", event => {
    handleSearch(event.target.value);
  });

  genreFilter?.addEventListener("change", event => {
    state.selectedGenre = event.target.value;
    applyFilters();
    renderBeats();
  });

  closePlayer?.addEventListener("click", closePlayerModal);
  playBtn?.addEventListener("click", togglePlay);

  progressInput?.addEventListener("input", seek);
  progressInput?.addEventListener("change", seek);

  if (audioPlayer) {
    audioPlayer.addEventListener("timeupdate", updateProgress);
    audioPlayer.addEventListener("loadedmetadata", updateDuration);
    audioPlayer.addEventListener("durationchange", updateDuration);
    audioPlayer.addEventListener("ended", handleAudioEnd);
    audioPlayer.addEventListener("play", updatePlayButton);
    audioPlayer.addEventListener("pause", updatePlayButton);

    audioPlayer.addEventListener("error", () => {
      console.error(
        "Preview audio failed:",
        audioPlayer.currentSrc,
        audioPlayer.error
      );
    });
  }

  navbarToggle?.addEventListener("click", toggleMobileMenu);

  navbarToggle?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMobileMenu();
    }
  });

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      navMenu?.classList.remove("active");
      navbarToggle?.classList.remove("active");
      navbarToggle?.setAttribute("aria-expanded", "false");
    });
  });

  playerModal?.addEventListener("click", event => {
    if (event.target === playerModal) {
      closePlayerModal();
    }
  });

  cartToggle?.addEventListener("click", () => {
    if (cartDrawer?.classList.contains("active")) {
      closeCart();
    } else {
      openCart();
    }
  });

  closeCartButton?.addEventListener("click", closeCart);
  cartOverlay?.addEventListener("click", closeCart);

  continueShoppingButton?.addEventListener("click", continueShopping);
  cartContinueShoppingButton?.addEventListener("click", continueShopping);

  checkoutBtn?.addEventListener("click", checkoutCart);

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    if (cartDrawer?.classList.contains("active")) closeCart();
    if (playerModal?.classList.contains("active")) closePlayerModal();
  });

  window.addEventListener("storage", event => {
    if (event.key === CART_STORAGE_KEY) {
      state.cart = loadSavedCart();
      renderCart();
      renderBeats();
      renderProductCategory(SAMPLE_CATALOG, "samples");
      renderProductCategory(STUDIO_TOOLS_CATALOG, "studio-tools");
    }
  });
}

/* ==========================================
   INITIALIZATION
   ========================================== */

async function init() {
  prepareCategorySections();

  await Promise.all([
    loadLiveCatalogue(),

    loadCategory("samples").then(products => {
      SAMPLE_CATALOG = products;
    }),

    loadCategory("studio-tools").then(products => {
      STUDIO_TOOLS_CATALOG = products;
    })
  ]);

  state.allBeats = [...BEATS_CATALOG];
  state.filteredBeats = [...state.allBeats];

  /*
   * Keep valid saved cart entries for all published product categories.
   * This also migrates old saved beat-only carts without removing them.
   */
  const validKeys = new Set([
    ...state.allBeats.map(cartKey),
    ...SAMPLE_CATALOG.map(cartKey),
    ...STUDIO_TOOLS_CATALOG.map(cartKey)
  ]);

  state.cart = loadSavedCart().filter(key => validKeys.has(key));

  buildAvailableGenres();

  if (genreFilter) {
    renderGenreSelect();
  } else {
    renderFilterButtons();
  }

  applyFilters();
  renderBeats();

  renderProductCategory(SAMPLE_CATALOG, "samples");
  renderProductCategory(STUDIO_TOOLS_CATALOG, "studio-tools");

  setupEventListeners();

  saveCart();
  renderCart();

  const yearElement = document.getElementById("currentYear");

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  console.log("Storefront ready:", {
    beats: state.allBeats.length,
    samples: SAMPLE_CATALOG.length,
    studioTools: STUDIO_TOOLS_CATALOG.length
  });
}

/* ==========================================
   START APPLICATION
   ========================================== */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
