
 // ==========================================
 // WAGWANSPARK — BEAT STORE APPLICATION
 // ==========================================

 // ==========================================
 // BEAT CATALOG DATA
 // ==========================================
const BEATS_CATALOG = [
  {
    id: "sun-fire",
    title: "SUN FIRE",
    genre: "Afrobeat",
    bpm: 105,
    key: "A Minor",
    price: 15000,
    artwork: "/images/sun-fire.jpg",
    previewAudio: "/audio/sun-fire-preview.mp3",
    description: "Afrobeat instrumental",
    available: true,
    featured: true
  },
  {
    id: "phenomenal",
    title: "PHENOMENAL",
    genre: "Afrobeat",
    bpm: 124,
    key: "A Minor",
    price: 15000,
    artwork: "/images/phenomenal.JPEG",
    previewAudio: "/audio/phenomenal-preview.mp3",
    description: "Afrobeat instrumental",
    available: true,
    featured: true
  },
  {
    id: "serenade",
    title: "SERENADE",
    genre: "Afrobeat",
    bpm: 118,
    key: "A Minor",
    price: 15000,
    artwork: "/images/serenade.JPEG",
    previewAudio: "/audio/serenade-preview.mp3",
    description: "Afrobeat instrumental",
    available: true,
    featured: true
  }
];

// ==========================================
// APPLICATION STATE
// ==========================================
const CART_STORAGE_KEY = "wagwanspark_cart_v1";

function loadSavedCart() {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);

    if (!saved) return [];

    const parsed = JSON.parse(saved);

    if (!Array.isArray(parsed)) return [];

    const validIds = new Set(
      BEATS_CATALOG
        .filter(beat => beat.available)
        .map(beat => beat.id)
    );

    return [...new Set(
      parsed.filter(
        id => typeof id === "string" && validIds.has(id)
      )
    )];
  } catch (error) {
    console.error("Unable to restore saved cart:", error);
    return [];
  }
}

const state = {
  allBeats: BEATS_CATALOG.filter(beat => beat.available),
  filteredBeats: BEATS_CATALOG.filter(beat => beat.available),
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
const navLinks = document.querySelectorAll(".nav-link");

// Cart elements
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
// INITIALIZATION
// ==========================================
function init() {
  try {
    if (!beatsGrid || !playerModal || !audioPlayer) {
      throw new Error(
        "Required page elements are missing. Check index.html."
      );
    }

    buildAvailableGenres();

    if (genreFilter) {
      renderGenreSelect();
    } else {
      renderFilterButtons();
    }

    applyFilters();
    renderBeats();
    setupEventListeners();

    // Restore and synchronize the cart on page load.
    saveCart();
    renderCart();

    const yearElement = document.getElementById("currentYear");

    if (yearElement) {
      yearElement.textContent = new Date().getFullYear();
    }

    console.log(
      `Loaded ${state.allBeats.length} beats from catalog`
    );
    console.log("Restored cart:", state.cart);
  } catch (error) {
    console.error("Failed to initialize application:", error);

    if (beatsGrid) {
      displayErrorMessage(
        "Unable to load the beat catalog. Please refresh the page."
      );
    }
  }
}

// ==========================================
// GENRE MANAGEMENT
// ==========================================
function buildAvailableGenres() {
  state.availableGenres = [
    ...new Set(state.allBeats.map(beat => beat.genre))
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

  const genreOptions = [
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

  genreOptions.forEach(option => {
    if (
      option.key !== "all" &&
      !state.availableGenres.includes(option.key)
    ) {
      return;
    }

    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `filter-btn ${
        option.key === state.selectedGenre ? "active" : ""
      }`;

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
      beat.bpm.toString().includes(query) ||
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
// PAGINATION
// ==========================================
function getPaginatedBeats() {
  const startIndex =
    (state.currentPage - 1) * state.beatsPerPage;

  return state.filteredBeats.slice(
    startIndex,
    startIndex + state.beatsPerPage
  );
}

function getTotalPages() {
  return Math.ceil(
    state.filteredBeats.length / state.beatsPerPage
  );
}

// ==========================================
// BEAT RENDERING
// ==========================================
function renderBeats() {
  if (!beatsGrid) return;

  beatsGrid.innerHTML = "";

  if (paginationContainer) {
    paginationContainer.innerHTML = "";
  }

  if (state.filteredBeats.length === 0) {
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

  const alreadyInCart = state.cart.includes(beat.id);

  card.innerHTML = `
    <div
      class="beat-artwork"
      role="button"
      tabindex="0"
      aria-label="Play ${escapeHtml(beat.title)} preview"
    >
      <img
        src="${escapeHtml(beat.artwork)}"
        alt="${escapeHtml(beat.title)}"
        loading="lazy"
      >
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
          <i class="fas fa-music"></i>
          ${escapeHtml(beat.genre)}
        </span>

        <span class="beat-meta-item">
          <i class="fas fa-tachometer-alt"></i>
          ${beat.bpm} BPM
        </span>

        <span class="beat-meta-item">
          <i class="fas fa-key"></i>
          ${escapeHtml(beat.key)}
        </span>
      </div>

      <div class="beat-price">
        ${formatNaira(beat.price)}
      </div>

      <button
        class="buy-btn add-to-cart-btn"
        data-beat-id="${escapeHtml(beat.id)}"
        type="button"
        aria-label="Add ${escapeHtml(beat.title)} to cart"
      >
        <i class="fas ${
          alreadyInCart ? "fa-check" : "fa-cart-plus"
        }"></i>
        ${alreadyInCart ? "Added to Cart" : "Add to Cart"}
      </button>
    </div>
  `;

  const artwork = card.querySelector(".beat-artwork");
  const image = card.querySelector(".beat-artwork img");
  const addButton = card.querySelector(".add-to-cart-btn");

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

  addButton.addEventListener("click", event => {
    event.stopPropagation();
    addToCart(beat.id);
  });

  return card;
}

// ==========================================
// PAGINATION CONTROLS
// ==========================================
function renderPaginationControls(totalPages) {
  const container = paginationContainer || beatsGrid;
  const pagination = document.createElement("div");

  pagination.className = "pagination-controls";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "← Previous";
  prevBtn.disabled = state.currentPage === 1;

  const pageInfo = document.createElement("span");
  pageInfo.textContent =
    `Page ${state.currentPage} of ${totalPages}`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "Next →";
  nextBtn.disabled = state.currentPage === totalPages;

  prevBtn.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderBeats();

      beatsGrid.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  nextBtn.addEventListener("click", () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderBeats();

      beatsGrid.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });

  pagination.append(prevBtn, pageInfo, nextBtn);
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
// CART STORAGE
// ==========================================
function saveCart() {
  try {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify(state.cart)
    );
  } catch (error) {
    console.error("Unable to save cart:", error);
  }
}

function getCartBeats() {
  const validBeats = state.cart
    .map(id => state.allBeats.find(beat => beat.id === id))
    .filter(Boolean);

  // Remove stale or unavailable IDs from the stored cart.
  const validIds = validBeats.map(beat => beat.id);

  if (
    validIds.length !== state.cart.length ||
    new Set(state.cart).size !== state.cart.length
  ) {
    state.cart = [...new Set(validIds)];
    saveCart();
  }

  return validBeats;
}

function getCartTotal() {
  return getCartBeats().reduce(
    (total, beat) => total + beat.price,
    0
  );
}

function formatNaira(amount) {
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

// ==========================================
// ADD TO CART
// ==========================================
function addToCart(beatId) {
  const beat = state.allBeats.find(
    item => item.id === beatId
  );

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

// ==========================================
// REMOVE FROM CART
// ==========================================
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

  // Explicitly set display as well. This prevents a CSS display
  // rule from making a hidden empty-cart message visible again.
  element.style.display = visible ? displayValue : "none";

  element.setAttribute("aria-hidden", String(!visible));
}

function renderCart() {
  const beats = getCartBeats();
  const itemCount = beats.length;
  const total = beats.reduce(
    (sum, beat) => sum + beat.price,
    0
  );

  if (cartCount) {
    cartCount.textContent = String(itemCount);

    cartCount.setAttribute(
      "aria-label",
      `${itemCount} ${itemCount === 1 ? "item" : "items"} in cart`
    );

    cartCount.classList.toggle("has-items", itemCount > 0);
  }

  if (cartItemLabel) {
    cartItemLabel.textContent =
      `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  }

  if (cartSummaryCount) {
    cartSummaryCount.textContent = String(itemCount);
  }

  if (cartTotal) {
    cartTotal.textContent = formatNaira(total);
  }

  // Rebuild the actual item list.
  if (cartItemsContainer) {
    cartItemsContainer.innerHTML = "";

    beats.forEach(beat => {
      const item = document.createElement("div");
      item.className = "cart-item";

      item.innerHTML = `
        <img
          class="cart-item-image cart-item-artwork"
          src="${escapeHtml(beat.artwork)}"
          alt="${escapeHtml(beat.title)}"
        >

        <div class="cart-item-info cart-item-details">
          <h3 class="cart-item-title">${escapeHtml(beat.title)}</h3>
          <p class="cart-item-meta">
            ${escapeHtml(beat.genre)} · ${beat.bpm} BPM · ${escapeHtml(beat.key)}
          </p>
          <strong class="cart-item-price">
            ${formatNaira(beat.price)}
          </strong>
        </div>

        <button
          type="button"
          class="cart-remove-btn"
          data-remove-beat="${escapeHtml(beat.id)}"
          aria-label="Remove ${escapeHtml(beat.title)} from cart"
          title="Remove beat"
        >
          <i class="fas fa-trash-alt"></i>
        </button>
      `;

      const image = item.querySelector("img");

      image.addEventListener("error", () => {
        image.onerror = null;
        image.src = "/images/placeholder.jpg";
      });

      item.querySelector(".cart-remove-btn").addEventListener(
        "click",
        () => removeFromCart(beat.id)
      );

      cartItemsContainer.appendChild(item);
    });
  }

  // Critical fix: empty message and populated cart must never
  // be visible at the same time.
  setVisible(cartEmpty, itemCount === 0);
  setVisible(cartSummary, itemCount > 0);
  setVisible(cartItemsContainer, itemCount > 0);

  if (checkoutBtn) {
    checkoutBtn.disabled =
      itemCount === 0 || state.checkoutInProgress;

    checkoutBtn.setAttribute(
      "aria-disabled",
      String(checkoutBtn.disabled)
    );

    if (!state.checkoutInProgress) {
      checkoutBtn.innerHTML =
        '<span>Proceed to Checkout</span> <i class="fas fa-lock"></i>';
    }
  }

  console.log("Cart updated:", {
    itemCount,
    beatIds: beats.map(beat => beat.id),
    total
  });
}

// ==========================================
// OPEN AND CLOSE CART
// ==========================================
function openCart() {
  if (!cartDrawer || !cartOverlay) return;

  renderCart();

  cartDrawer.classList.add("active");
  cartOverlay.classList.add("active");

  cartDrawer.setAttribute("aria-hidden", "false");
  cartOverlay.setAttribute("aria-hidden", "false");

  if (cartToggle) {
    cartToggle.setAttribute("aria-expanded", "true");
  }

  document.body.classList.add("cart-open");

  if (closeCartButton) {
    closeCartButton.focus({ preventScroll: true });
  }
}

function closeCart() {
  if (!cartDrawer || !cartOverlay) return;

  cartDrawer.classList.remove("active");
  cartOverlay.classList.remove("active");

  cartDrawer.setAttribute("aria-hidden", "true");
  cartOverlay.setAttribute("aria-hidden", "true");

  if (cartToggle) {
    cartToggle.setAttribute("aria-expanded", "false");
    cartToggle.focus({ preventScroll: true });
  }

  document.body.classList.remove("cart-open");
}

function continueShopping() {
  closeCart();

  const beatsSection = document.getElementById("beats");

  if (beatsSection) {
    beatsSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

// ==========================================
// CART CHECKOUT — PAYSTACK
// ==========================================
async function checkoutCart() {
  if (state.checkoutInProgress) return;

  const beats = getCartBeats();

  if (beats.length === 0) {
    renderCart();
    alert("Your cart is empty. Add a beat before checking out.");
    return;
  }

  const beatIds = beats.map(beat => beat.id);

  const total = beats.reduce(
    (sum, beat) => sum + beat.price,
    0
  );

  const emailInput = prompt(
    `Your cart total is ${formatNaira(total)}.\n\nEnter your email address for payment:`
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
    const payload = {
      email,
      beatIds,
      amount: total
    };

    // Retain compatibility with the existing single-beat endpoint.
    if (beatIds.length === 1) {
      payload.beatId = beatIds[0];
    }

    const response = await fetch("/api/create-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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
      console.error("Checkout initialization failed:", result);

      throw new Error(
        result.message ||
        "Unable to start checkout. Please try again."
      );
    }

    // Keep cart intact until payment verification is handled.
    window.location.href = result.data.authorization_url;
  } catch (error) {
    console.error("Checkout error:", error);

    alert(
      error.message ||
      "Something went wrong while starting checkout. Please try again."
    );

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

  if (elements.title) {
    elements.title.textContent = beat.title;
  }

  if (elements.genre) {
    elements.genre.textContent = beat.genre;
  }

  if (elements.bpm) {
    elements.bpm.textContent = `${beat.bpm} BPM`;
  }

  if (elements.key) {
    elements.key.textContent = beat.key;
  }

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

  if (elements.progress) {
    elements.progress.style.width = "0%";
  }

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
      await openPlayer(state.currentBeat);
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
  ) {
    return;
  }

  const percent = Math.max(
    0,
    Math.min(100, Number(progressInput.value) || 0)
  );

  audioPlayer.currentTime =
    (percent / 100) * audioPlayer.duration;

  updateProgress();
}

function updateProgress() {
  if (!audioPlayer) return;

  const duration = audioPlayer.duration;
  const current = audioPlayer.currentTime || 0;

  const progressValue =
    Number.isFinite(duration) && duration > 0
      ? Math.min(100, (current / duration) * 100)
      : 0;

  const elements = getPlayerElements();

  if (elements.progress) {
    elements.progress.style.width = `${progressValue}%`;
  }

  if (progressInput) {
    progressInput.value = progressValue;
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
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

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
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  if (beatSearchInput) {
    beatSearchInput.addEventListener("input", event => {
      handleSearch(event.target.value);
    });
  }

  if (genreFilter) {
    genreFilter.addEventListener("change", event => {
      state.selectedGenre = event.target.value;
      applyFilters();
      renderBeats();
    });
  }

  if (closePlayer) {
    closePlayer.addEventListener("click", closePlayerModal);
  }

  if (playBtn) {
    playBtn.addEventListener("click", togglePlay);
  }

  if (progressInput) {
    progressInput.addEventListener("input", seek);
    progressInput.addEventListener("change", seek);
  }

  if (audioPlayer) {
    audioPlayer.addEventListener("timeupdate", updateProgress);
    audioPlayer.addEventListener("loadedmetadata", updateDuration);
    audioPlayer.addEventListener("durationchange", updateDuration);
    audioPlayer.addEventListener("ended", handleAudioEnd);
    audioPlayer.addEventListener("play", updatePlayButton);
    audioPlayer.addEventListener("pause", updatePlayButton);

    audioPlayer.addEventListener("error", () => {
      console.error(
        "Preview audio failed to load:",
        audioPlayer.currentSrc,
        audioPlayer.error
      );
    });
  }

  if (navbarToggle) {
    navbarToggle.addEventListener("click", toggleMobileMenu);

    navbarToggle.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMobileMenu();
      }
    });
  }

  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      if (navMenu) navMenu.classList.remove("active");
      if (navbarToggle) navbarToggle.classList.remove("active");

      if (navbarToggle) {
        navbarToggle.setAttribute("aria-expanded", "false");
      }
    });
  });

  if (playerModal) {
    playerModal.addEventListener("click", event => {
      if (event.target === playerModal) {
        closePlayerModal();
      }
    });
  }

  // Cart controls
  if (cartToggle) {
    cartToggle.addEventListener("click", () => {
      if (cartDrawer && cartDrawer.classList.contains("active")) {
        closeCart();
      } else {
        openCart();
      }
    });
  }

  if (closeCartButton) {
    closeCartButton.addEventListener("click", closeCart);
  }

  if (cartOverlay) {
    cartOverlay.addEventListener("click", closeCart);
  }

  if (continueShoppingButton) {
    continueShoppingButton.addEventListener(
      "click",
      continueShopping
    );
  }

  if (cartContinueShoppingButton) {
    cartContinueShoppingButton.addEventListener(
      "click",
      continueShopping
    );
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", checkoutCart);
  }

  document.addEventListener("keydown", event => {
    if (
      event.key === "Escape" &&
      cartDrawer &&
      cartDrawer.classList.contains("active")
    ) {
      closeCart();
    }

    if (
      event.key === "Escape" &&
      playerModal &&
      playerModal.classList.contains("active")
    ) {
      closePlayerModal();
    }
  });

  // Synchronize the cart if another tab changes it.
  window.addEventListener("storage", event => {
    if (event.key === CART_STORAGE_KEY) {
      state.cart = loadSavedCart();
      renderCart();
      renderBeats();
    }
  });
}

// ==========================================
// MOBILE MENU
// ==========================================
function toggleMobileMenu() {
  if (!navMenu || !navbarToggle) return;

  const isActive = navMenu.classList.toggle("active");

  navbarToggle.classList.toggle("active", isActive);
  navbarToggle.setAttribute("aria-expanded", String(isActive));
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(value).replace(
    /[&<>"']/g,
    character => map[character]
  );
}

// ==========================================
// INITIALIZE
// ==========================================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
