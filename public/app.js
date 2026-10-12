// ==========================================
// WAGWANSPARK — BEAT STORE APPLICATION
// Beats • Samples • Studio Tools
// ==========================================
const CART_STORAGE_KEY = "wagwanspark_cart_v1";
const API = {
  beats: "/api/beats",
  products: "/api/products"
};
// ==========================================
// FALLBACK BEAT CATALOG
// ==========================================
let BEATS_CATALOG = [
  {
    id: "sun-fire",
    title: "SUN FIRE",
    genre: "Afrobeat",
    bpm: 105,
    key: "A Minor",
    price: 7000,
    artwork: "/images/sun-fire.jpg",
    previewAudio: "/audio/sun-fire-preview.mp3",
    description: "Afrobeat instrumental",
    formats: ["MP3", "WAV"],
    available: true,
    featured: true
  },
  {
    id: "phenomenal",
    title: "PHENOMENAL",
    genre: "Afrobeat",
    bpm: 124,
    key: "A Minor",
    price: 7000,
    artwork: "/images/phenomenal.JPEG",
    previewAudio: "/audio/phenomenal-preview.mp3",
    description: "Afrobeat instrumental",
    formats: ["MP3", "WAV"],
    available: true,
    featured: true
  },
  {
    id: "serenade",
    title: "SERENADE",
    genre: "Afrobeat",
    bpm: 118,
    key: "A Minor",
    price: 7000,
    artwork: "/images/serenade.JPEG",
    previewAudio: "/audio/serenade-preview.mp3",
    description: "Afrobeat instrumental",
    formats: ["MP3", "WAV"],
    available: true,
    featured: true
  }
];
let SAMPLE_CATALOG = [];
let STUDIO_TOOLS_CATALOG = [];
// ==========================================
// APPLICATION STATE
// ==========================================
function loadSavedCart() {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter(id => typeof id === "string"))]
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
// ==========================================
// DOM ELEMENTS
// ==========================================
const beatsGrid = document.getElementById("beatsGrid");
const paginationContainer = document.getElementById("pagination");
const genreFilter = document.getElementById("genreFilter");
const filterButtonsContainer =
  document.querySelector(".filter-buttons");
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
// ==========================================
// API HELPERS
// ==========================================
async function fetchJSON(url) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}
function mediaURL(id, type) {
  return `/api/media/${encodeURIComponent(id)}/${type}`;
}
function normalizeProduct(product, category) {
  const id = String(product.id || "").trim();
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
    previewAudio: product.previewAudio || product.preview_audio
      ? String(product.previewAudio || product.preview_audio)
      : mediaURL(id, "preview"),
    description: String(product.description || "").trim(),
    formats: Array.isArray(product.formats)
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
// ==========================================
// LOAD BEATS
// ==========================================
async function loadLiveCatalogue() {
  try {
    const data = await fetchJSON(API.beats);
    if (!data || !Array.isArray(data.beats)) {
      throw new Error("Invalid beats catalogue response.");
    }
    const liveBeats = data.beats.map(beat =>
      normalizeProduct(beat, "beats")
    ).filter(beat =>
      beat.id &&
      beat.title &&
      beat.price > 0 &&
      beat.available &&
      beat.status !== "draft"
    );
    if (liveBeats.length > 0) {
      BEATS_CATALOG = liveBeats;
    } else {
      console.warn("No published beats returned by the API.");
      BEATS_CATALOG = liveBeats;
    }
    console.log("Published beats loaded:", BEATS_CATALOG.length);
    return true;
  } catch (error) {
    console.error("Could not load live beats:", error);
    return false;
  }
}
// ==========================================
// LOAD SAMPLES AND STUDIO TOOLS
// ==========================================
async function loadCategory(category) {
  try {
    const url =
      `${API.products}?category=${encodeURIComponent(category)}`;
    const data = await fetchJSON(url);
    if (!data || !Array.isArray(data.products)) {
      throw new Error(`Invalid ${category} catalogue response.`);
    }
    const products = data.products
      .map(product => normalizeProduct(product, category))
      .filter(product =>
        product.id &&
        product.title &&
        product.price > 0 &&
        product.available &&
        product.status !== "draft"
      );
    console.log(`${category} loaded:`, products.length);
    return products;
  } catch (error) {
    console.error(`Could not load ${category}:`, error);
    return [];
  }
}
// ==========================================
// CREATE CATEGORY SECTIONS
// ==========================================
function ensureCategorySection(category, heading, description) {
  const sectionId = category === "studio-tools"
    ? "studio-tools"
    : category;
  let section = document.getElementById(sectionId);
  if (section) {
    return section;
  }
  section = document.createElement("section");
  section.id = sectionId;
  section.className = "store-category-section";
  section.style.cssText =
    "padding:64px 0;scroll-margin-top:100px;";
  const container = document.createElement("div");
  container.className = "container";
  const header = document.createElement("div");
  header.className = "section-header";
  const title = document.createElement("h2");
  title.className = "section-title";
  title.textContent = heading;
  const subtitle = document.createElement("p");
  subtitle.className = "section-description";
  subtitle.textContent = description;
  const grid = document.createElement("div");
  grid.id = category === "samples"
    ? "samplesGrid"
    : "studioToolsGrid";
  grid.className = "beats-grid";
  const message = document.createElement("p");
  message.className = "store-category-message";
  message.style.cssText =
    "padding:20px 0;color:var(--text-secondary,#aaa);";
  header.append(title, subtitle);
  container.append(header, grid, message);
  section.appendChild(container);
  // Put the new section after the existing beats section.
  const beatsSection =
    document.getElementById("beats") ||
    beatsGrid?.closest("section");
  if (beatsSection && beatsSection.parentNode) {
    let insertionPoint = beatsSection;
    if (category === "samples") {
      insertionPoint.insertAdjacentElement("afterend", section);
    } else {
      const samplesSection = document.getElementById("samples");
      if (samplesSection) {
        samplesSection.insertAdjacentElement("afterend", section);
      } else {
        insertionPoint.insertAdjacentElement("afterend", section);
      }
    }
  } else {
    document.body.appendChild(section);
  }
  return section;
}
function prepareCategorySections() {
  ensureCategorySection(
    "samples",
    "Samples",
    "Explore sounds, loops and sample packs for your next production."
  );
  ensureCategorySection(
    "studio-tools",
    "Studio Tools",
    "Production resources and tools built for your sound."
  );
  // Keep existing navigation links working.
  document.querySelectorAll(".nav-link").forEach(link => {
    const text = (link.textContent || "").trim().toLowerCase();
    const href = (link.getAttribute("href") || "").toLowerCase();
    if (text.includes("sample") || href.includes("sample")) {
      link.setAttribute("href", "#samples");
    } else if (
      text.includes("studio tools") ||
      href.includes("studio-tools")
    ) {
      link.setAttribute("href", "#studio-tools");
    } else if (text.includes("beat") || href === "#beats") {
      link.setAttribute("href", "#beats");
    }
  });
}
// ==========================================
// RENDER SAMPLES AND STUDIO TOOLS
// ==========================================
function renderProductCategory(products, category) {
  const gridId = category === "samples"
    ? "samplesGrid"
    : "studioToolsGrid";
  const grid = document.getElementById(gridId);
  const section = document.getElementById(category);
  const message = section?.querySelector(".store-category-message");
  if (!grid) return;
  grid.innerHTML = "";
  if (!products.length) {
    if (message) {
      message.textContent =
        `No published ${category === "samples" ? "samples" : "studio tools"} are available yet.`;
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
      (category === "samples"
        ? "Sample pack"
        : "Studio production tool");
    const price = document.createElement("div");
    price.className = "beat-price";
    price.textContent = formatNaira(product.price);
    info.append(title, description, price);
    // Samples can use the same preview media route as beats.
    if (category === "samples" && product.previewAudio) {
      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "buy-btn product-preview-btn";
      previewButton.innerHTML =
        '<i class="fas fa-play"></i> Preview';
      previewButton.addEventListener("click", () => {
        openProductPreview(product);
      });
      info.appendChild(previewButton);
    }
    // Product checkout is intentionally not wired to the beat cart.
    // The existing Worker checkout currently receives beatIds.
    const note = document.createElement("p");
    note.className = "product-purchase-note";
    note.style.cssText =
      "font-size:12px;opacity:.7;margin-top:10px;";
    note.textContent = category === "samples"
      ? "Sample pack"
      : "Studio resource";
    info.appendChild(note);
    card.append(image, info);
    grid.appendChild(card);
  });
}
async function openProductPreview(product) {
  if (!audioPlayer || !playerModal) {
    alert("The audio preview player is not available on this page.");
    return;
  }
  state.currentBeat = product;
  const title = document.getElementById("playerTitle") ||
    document.getElementById("playerBeatTitle");
  const genre = document.getElementById("playerGenre") ||
    document.getElementById("playerBeatGenre");
  if (title) title.textContent = product.title;
  if (genre) genre.textContent = "Sample Preview";
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = product.previewAudio;
  audioPlayer.load();
  playerModal.classList.add("active");
  playerModal.setAttribute("aria-hidden", "false");
  updatePlayButton();
  try {
    await audioPlayer.play();
  } catch (error) {
    console.error("Sample preview could not play:", error);
  }
}
// ==========================================
// INITIALIZATION
// ==========================================
async function init() {
  try {
    prepareCategorySections();
    // Load all catalogue types independently.
    await Promise.all([
      loadLiveCatalogue().then(() => {
        state.allBeats = BEATS_CATALOG.filter(beat => beat.available);
      }),
      loadCategory("samples").then(products => {
        SAMPLE_CATALOG = products;
      }),
      loadCategory("studio-tools").then(products => {
        STUDIO_TOOLS_CATALOG = products;
      })
    ]);
    state.filteredBeats = [...state.allBeats];
    state.cart = loadSavedCart();
    // Remove cart IDs that are not published beats.
    const validIds = new Set(state.allBeats.map(beat => beat.id));
    state.cart = state.cart.filter(id => validIds.has(id));
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
  } catch (error) {
    console.error("Application initialization failed:", error);
    if (beatsGrid) {
      displayErrorMessage(
        "Unable to load the catalogue. Please refresh the page."
      );
    }
  }
}
// ==========================================
// GENRE MANAGEMENT
// ==========================================
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
// ==========================================
// SEARCH AND FILTER
// ==========================================
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
// ==========================================
// BEAT PAGINATION
// ==========================================
function getPaginatedBeats() {
  const start = (state.currentPage - 1) * state.beatsPerPage;
  return state.filteredBeats.slice(start, start + state.beatsPerPage);
}
function getTotalPages() {
  return Math.ceil(state.filteredBeats.length / state.beatsPerPage);
}
// ==========================================
// BEAT RENDERING
// ==========================================
function renderBeats() {
  if (!beatsGrid) return;
  beatsGrid.innerHTML = "";
  if (paginationContainer) paginationContainer.innerHTML = "";
  if (!state.filteredBeats.length) {
    displayNoResultsMessage();
    return;
  }
  getPaginatedBeats().forEach(beat => {
    beatsGrid.appendChild(createBeatCard(beat));
  });
  const totalPages = getTotalPages();
  if (totalPages > 1) renderPaginationControls(totalPages);
}
function getFormatLabel(beat) {
  return (Array.isArray(beat.formats) ? beat.formats : ["MP3", "WAV"])
    .join(" + ");
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
    addToCart(beat.id);
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
      beatsGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  next.addEventListener("click", () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderBeats();
      beatsGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  pagination.append(previous, info, next);
  container.appendChild(pagination);
}
// ==========================================
// MESSAGES
// ==========================================
function displayNoResultsMessage() {
  beatsGrid.innerHTML = `
    <div class="store-message">
      <i class="fas fa-search"></i>
      <p>No beats found. Try adjusting your search or filters.</p>
    </div>
  `;
}
function displayErrorMessage(message) {
  beatsGrid.innerHTML = `
    <div class="store-message">
      <i class="fas fa-exclamation-circle"></i>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}
// ==========================================
// CART STORAGE AND TOTALS
// ==========================================
function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
  } catch (error) {
    console.error("Unable to save cart:", error);
  }
}
function getCartBeats() {
  const items = state.cart
    .map(id => state.allBeats.find(beat => beat.id === id))
    .filter(Boolean);
  const validIds = items.map(beat => beat.id);
  if (
    validIds.length !== state.cart.length ||
    new Set(state.cart).size !== state.cart.length
  ) {
    state.cart = [...new Set(validIds)];
    saveCart();
  }
  return items;
}
function getCartTotal() {
  return getCartBeats().reduce((total, beat) => total + beat.price, 0);
}
function formatNaira(amount) {
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}
// ==========================================
// ADD / REMOVE BEATS
// ==========================================
function addToCart(beatId) {
  const beat = state.allBeats.find(item => item.id === beatId);
  if (!beat) {
    alert("This beat is currently unavailable.");
    return;
  }
  if (state.cart.includes(beatId)) {
    renderCart();
    openCart();
    return;
  }
  state.cart.push(beatId);
  saveCart();
  renderCart();
  renderBeats();
  openCart();
}
function removeFromCart(beatId) {
  state.cart = state.cart.filter(id => id !== beatId);
  saveCart();
  renderCart();
  renderBeats();
}
// ==========================================
// CART RENDERING
// ==========================================
function setVisible(element, visible, displayValue = "") {
  if (!element) return;
  element.hidden = !visible;
  element.style.display = visible ? displayValue : "none";
  element.setAttribute("aria-hidden", String(!visible));
}
function renderCart() {
  const beats = getCartBeats();
  const count = beats.length;
  const total = beats.reduce((sum, beat) => sum + beat.price, 0);
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
  if (cartSummaryCount) cartSummaryCount.textContent = String(count);
  if (cartTotal) cartTotal.textContent = formatNaira(total);
  if (cartItemsContainer) {
    cartItemsContainer.innerHTML = "";
    beats.forEach(beat => {
      const item = document.createElement("div");
      item.className = "cart-item";
      item.innerHTML = `
        <img class="cart-item-image cart-item-artwork"
          src="${escapeHtml(beat.artwork)}"
          alt="${escapeHtml(beat.title)}">
        <div class="cart-item-info cart-item-details">
          <h3 class="cart-item-title">${escapeHtml(beat.title)}</h3>
          <p class="cart-item-meta">
            ${escapeHtml(beat.genre)} · ${beat.bpm} BPM · ${escapeHtml(beat.key)}
          </p>
          <span class="cart-item-format">
            Includes ${escapeHtml(getFormatLabel(beat))}
          </span>
          <strong class="cart-item-price">${formatNaira(beat.price)}</strong>
        </div>
        <button type="button" class="cart-remove-btn"
          aria-label="Remove ${escapeHtml(beat.title)} from cart">
          <i class="fas fa-trash-alt"></i>
        </button>
      `;
      const image = item.querySelector("img");
      image.addEventListener("error", () => {
        image.onerror = null;
        image.src = "/images/placeholder.jpg";
      });
      item.querySelector(".cart-remove-btn").addEventListener("click", () => {
        removeFromCart(beat.id);
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
// ==========================================
// OPEN / CLOSE CART
// ==========================================
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
  const section = document.getElementById("beats");
  section?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}
// ==========================================
// PAYSTACK CHECKOUT
// Existing beat checkout is preserved.
// ==========================================
async function checkoutCart() {
  if (state.checkoutInProgress) return;
  const beats = getCartBeats();
  if (!beats.length) {
    renderCart();
    alert("Your cart is empty. Add a beat before checking out.");
    return;
  }
  const beatIds = beats.map(beat => beat.id);
  const total = beats.reduce((sum, beat) => sum + beat.price, 0);
  const emailInput = prompt(
    `Your cart total is ${formatNaira(total)}.\n\n` +
    "Your purchase includes MP3 + WAV files for each beat.\n\n" +
    "Enter your email address for payment:"
  );
  if (emailInput === null) return;
  const email = emailInput.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Please enter a valid email address.");
    return;
  }
  state.checkoutInProgress = true;
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Preparing Checkout...';
  }
  try {
    const payload = { email, beatIds, amount: total };
    if (beatIds.length === 1) {
      payload.beatId = beatIds[0];
    }
    const response = await fetch("/api/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an invalid response.");
    }
    if (
      !response.ok ||
      !result.status ||
      !result.data ||
      !result.data.authorization_url
    ) {
      throw new Error(
        result.message || "Unable to start checkout. Please try again."
      );
    }
    window.location.href = result.data.authorization_url;
  } catch (error) {
    console.error("Checkout error:", error);
    alert(error.message || "Unable to start checkout. Please try again.");
    state.checkoutInProgress = false;
    renderCart();
  }
}
// ==========================================
// AUDIO PLAYER
// ==========================================
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
    if (state.currentBeat) await openPlayer(state.currentBeat);
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
  playBtn.setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
  playBtn.setAttribute("aria-pressed", String(playing));
}
function seek() {
  if (
    !audioPlayer ||
    !progressInput ||
    !Number.isFinite(audioPlayer.duration) ||
    audioPlayer.duration <= 0
  ) return;
  const percent = Math.max(0, Math.min(100, Number(progressInput.value) || 0));
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
  if (elements.progress) elements.progress.style.width = `${percent}%`;
  if (progressInput) progressInput.value = percent;
  if (currentTimeEl) currentTimeEl.textContent = formatTime(current);
}
function updateDuration() {
  if (!audioPlayer) return;
  if (durationEl) durationEl.textContent = formatTime(audioPlayer.duration);
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
// ==========================================
// MOBILE MENU
// ==========================================
function toggleMobileMenu() {
  if (!navMenu || !navbarToggle) return;
  const active = navMenu.classList.toggle("active");
  navbarToggle.classList.toggle("active", active);
  navbarToggle.setAttribute("aria-expanded", String(active));
}
// ==========================================
// EVENT LISTENERS
// ==========================================
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
    if (event.target === playerModal) closePlayerModal();
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
      const validIds = new Set(state.allBeats.map(beat => beat.id));
      state.cart = state.cart.filter(id => validIds.has(id));
      renderCart();
      renderBeats();
    }
  });
}
// ==========================================
// UTILITY
// ==========================================
function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return String(value).replace(/[&<>"']/g, character => map[character]);
}
// ==========================================
// START APPLICATION
// ==========================================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
