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
    // Only restore beats that still exist in the catalog.
    const validIds = new Set(
      BEATS_CATALOG
        .filter(beat => beat.available)
        .map(beat => beat.id)
    );
    return [...new Set(
      parsed.filter(id =>
        typeof id === "string" && validIds.has(id)
      )
    )];
  } catch (error) {
    console.error("Unable to restore saved cart:", error);
    return [];
  }
}
const state = {
  allBeats: [...BEATS_CATALOG],
  filteredBeats: [...BEATS_CATALOG],
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
// Supports the current index.html IDs
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
    state.allBeats = BEATS_CATALOG.filter(beat => beat.available);
    buildAvailableGenres();
    if (genreFilter) {
      renderGenreSelect();
    } else {
      renderFilterButtons();
    }
    applyFilters();
    renderBeats();
    setupEventListeners();
    // Restore the saved cart after refreshing the page.
    saveCart();
    renderCart();
    const yearElement = document.getElementById("currentYear");
    if (yearElement) {
      yearElement.textContent = new Date().getFullYear();
    }
    console.log(
      `Loaded ${state.allBeats.length} beats from catalog`
    );
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
  const genreSet = new Set();
  state.allBeats.forEach(beat => {
    genreSet.add(beat.genre);
  });
  state.availableGenres = Array.from(genreSet).sort();
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
    filtered = filtered.filter(beat => {
      return (
        beat.title.toLowerCase().includes(query) ||
        beat.genre.toLowerCase().includes(query) ||
        beat.key.toLowerCase().includes(query) ||
        beat.bpm.toString().includes(query) ||
        beat.description.toLowerCase().includes(query)
      );
    });
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
  const endIndex = startIndex + state.beatsPerPage;
  return state.filteredBeats.slice(startIndex, endIndex);
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
  const paginatedBeats = getPaginatedBeats();
  paginatedBeats.forEach(beat => {
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
      >
      <div class="play-overlay">
        <div class="play-btn-overlay">
          <i class="fas fa-play"></i>
        </div>
      </div>
    </div>
    <div class="beat-info">
      <h3 class="beat-title">
        ${escapeHtml(beat.title)}
      </h3>
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
        ₦${beat.price.toLocaleString("en-NG")}
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
  artwork.addEventListener("click", () => {
    openPlayer(beat);
  });
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
  pagination.appendChild(prevBtn);
  pagination.appendChild(pageInfo);
  pagination.appendChild(nextBtn);
  container.appendChild(pagination);
}
// ==========================================
// MESSAGES
// ==========================================
function displayNoResultsMessage() {
  beatsGrid.innerHTML = `
    <div style="
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-secondary);
    ">
      <i class="fas fa-search" style="
        font-size: 3rem;
        color: var(--accent-color);
        margin-bottom: 1rem;
      "></i>
      <p style="font-size: 1.1rem;">
        No beats found. Try adjusting your search or filters.
      </p>
    </div>
  `;
}
function displayErrorMessage(message) {
  beatsGrid.innerHTML = `
    <div style="
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-secondary);
    ">
      <i class="fas fa-exclamation-circle" style="
        font-size: 3rem;
        color: var(--accent-color);
        margin-bottom: 1rem;
      "></i>
      <p style="font-size: 1.1rem;">
        ${escapeHtml(message)}
      </p>
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
  return state.cart
    .map(id => state.allBeats.find(beat => beat.id === id))
    .filter(Boolean);
}
function getCartTotal() {
  return getCartBeats().reduce(
    (total, beat) => total + beat.price,
    0
  );
}
function formatNaira(amount) {
  return `₦${amount.toLocaleString("en-NG")}`;
}
// ==========================================
// ADD TO CART
// ==========================================
function addToCart(beatId) {
  const beat = state.allBeats.find(item => item.id === beatId);
  if (!beat) {
    alert("This beat is currently unavailable.");
    return;
  }
  if (state.cart.includes(beatId)) {
    openCart();
    return;
  }
  state.cart.push(beatId);
  saveCart();
  renderCart();
  renderBeats();
  // Brief visual feedback without interrupting playback.
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
// RENDER CART
// ==========================================
function renderCart() {
  const beats = getCartBeats();
  const itemCount = beats.length;
  const total = getCartTotal();
  if (cartCount) {
    cartCount.textContent = itemCount;
    cartCount.setAttribute(
      "aria-label",
      `${itemCount} ${itemCount === 1 ? "item" : "items"} in cart`
    );
  }
  if (cartItemLabel) {
    cartItemLabel.textContent =
      `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  }
  if (cartSummaryCount) {
    cartSummaryCount.textContent = itemCount;
  }
  if (cartTotal) {
    cartTotal.textContent = formatNaira(total);
  }
  if (cartItemsContainer) {
    cartItemsContainer.innerHTML = "";
    beats.forEach(beat => {
      const item = document.createElement("div");
      item.className = "cart-item";
      item.innerHTML = `
        <img
          class="cart-item-artwork"
          src="${escapeHtml(beat.artwork)}"
          alt="${escapeHtml(beat.title)}"
        >
        <div class="cart-item-details">
          <h3>${escapeHtml(beat.title)}</h3>
          <p>${escapeHtml(beat.genre)} · ${beat.bpm} BPM</p>
          <strong>${formatNaira(beat.price)}</strong>
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
  if (cartEmpty) {
    cartEmpty.hidden = itemCount > 0;
  }
  if (cartSummary) {
    cartSummary.hidden = itemCount === 0;
  }
  if (cartItemsContainer) {
    cartItemsContainer.hidden = itemCount === 0;
  }
  if (checkoutBtn) {
    checkoutBtn.disabled =
      itemCount === 0 || state.checkoutInProgress;
  }
}
// ==========================================
// OPEN AND CLOSE CART
// ==========================================
function openCart() {
  if (!cartDrawer || !cartOverlay) return;
  cartDrawer.classList.add("active");
  cartOverlay.classList.add("active");
  cartDrawer.setAttribute("aria-hidden", "false");
  cartOverlay.setAttribute("aria-hidden", "false");
  if (cartToggle) {
    cartToggle.setAttribute("aria-expanded", "true");
  }
  document.body.classList.add("cart-open");
  if (closeCartButton) {
    closeCartButton.focus();
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
    cartToggle.focus();
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
// CART CHECKOUT
// ==========================================
async function checkoutCart() {
  if (state.checkoutInProgress) return;
  const beats = getCartBeats();
  if (beats.length === 0) {
    alert("Your cart is empty. Add a beat before checking out.");
    return;
  }
  // Only use catalog prices and IDs from this script.
  const beatIds = beats.map(beat => beat.id);
  const total = beats.reduce((sum, beat) => sum + beat.price, 0);
  const emailInput = prompt(
    `Your cart total is ${formatNaira(total)}.\n\nEnter your email address for payment:`
  );
  if (emailInput === null) return;
  const email = emailInput.trim();
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
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
    // The backend will validate beat IDs and calculate the real total.
    // For a multi-beat order, deliberately omit beatId so an older
    // single-beat backend cannot accidentally charge for only one beat.
    const payload = {
      email,
      beatIds,
      amount: total
    };
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
    // Keep the cart saved until payment is verified.
    // Do not clear it before the customer completes payment.
    window.location.href = result.data.authorization_url;
  } catch (error) {
    console.error("Checkout error:", error);
    alert(
      error.message ||
      "Something went wrong while starting checkout. Please try again."
    );
    state.checkoutInProgress = false;
    if (checkoutBtn) {
      checkoutBtn.disabled = getCartBeats().length === 0;
      checkoutBtn.innerHTML =
        '<span>Proceed to Checkout</span> <i class="fas fa-lock"></i>';
    }
    renderCart();
  }
}
// ==========================================
// AUDIO PLAYER
// ==========================================
async function openPlayer(beat) {
  if (!beat || !audioPlayer || !playerModal) return;
  state.currentBeat = beat;
  // Support the IDs in the current index.html and older versions.
  const titleElement =
    document.getElementById("playerTitle") ||
    document.getElementById("playerBeatTitle");
  const genreElement =
    document.getElementById("playerGenre") ||
    document.getElementById("playerBeatGenre");
  const artworkElement =
    document.getElementById("playerImage") ||
    document.getElementById("playerBeatArt");
  const bpmElement = document.getElementById("playerBeatBPM");
  const keyElement = document.getElementById("playerBeatKey");
  if (titleElement) titleElement.textContent = beat.title;
  if (genreElement) genreElement.textContent = beat.genre;
  if (bpmElement) bpmElement.textContent = beat.bpm;
  if (keyElement) keyElement.textContent = beat.key;
  if (artworkElement) {
    artworkElement.src = beat.artwork;
    artworkElement.alt = beat.title;
    artworkElement.onerror = () => {
      artworkElement.onerror = null;
      artworkElement.src = "/images/placeholder.jpg";
    };
  }
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = beat.previewAudio;
  audioPlayer.load();
  if (progressInput) progressInput.value = 0;
  if (currentTimeEl) currentTimeEl.textContent = "0:00";
  if (durationEl) durationEl.textContent = "0:00";
  const progress = document.getElementById("progress");
  if (progress) {
    progress.style.width = "0%";
  }
  playerModal.classList.add("active");
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
  if (audioPlayer.paused) {
    playBtn.innerHTML = '<i class="fas fa-play"></i>';
    playBtn.setAttribute("aria-label", "Play preview");
  } else {
    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    playBtn.setAttribute("aria-label", "Pause preview");
  }
}
function seek() {
  if (!audioPlayer || !progressInput || !audioPlayer.duration) {
    return;
  }
  const seekTime =
    (Number(progressInput.value) / 100) * audioPlayer.duration;
  audioPlayer.currentTime = seekTime;
}
function updateProgress() {
  if (!audioPlayer || !audioPlayer.duration) return;
  const progressValue =
    (audioPlayer.currentTime / audioPlayer.duration) * 100;
  const progress = document.getElementById("progress");
  if (progress) {
    progress.style.width = `${progressValue}%`;
  }
  if (progressInput) {
    progressInput.value = progressValue;
  }
  if (currentTimeEl) {
    currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
  }
}
function updateDuration() {
  if (!audioPlayer) return;
  if (durationEl) {
    durationEl.textContent = formatTime(audioPlayer.duration);
  }
  if (progressInput) {
    progressInput.max = 100;
  }
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
function handleAudioEnd() {
  if (!audioPlayer) return;
  audioPlayer.currentTime = 0;
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
  // Escape closes the cart without stopping the audio player.
  document.addEventListener("keydown", event => {
    if (
      event.key === "Escape" &&
      cartDrawer &&
      cartDrawer.classList.contains("active")
    ) {
      closeCart();
    }
  });
  // If another tab updates the saved cart, synchronize this tab too.
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
