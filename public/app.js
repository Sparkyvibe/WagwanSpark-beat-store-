// ==========================================
// BEAT CATALOG DATA
// ==========================================
// This is the centralized beat data structure.
// Add new beats here to automatically populate the catalog.
// Each beat supports: id, title, genre, bpm, key, price, artwork, previewAudio, description, available, featured

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
  }
];

// ==========================================
// APPLICATION STATE
// ==========================================
const state = {
  allBeats: [...BEATS_CATALOG],
  filteredBeats: [...BEATS_CATALOG],
  currentPage: 1,
  beatsPerPage: 24,
  selectedGenre: 'all',
  searchQuery: '',
  currentBeat: null,
  availableGenres: []
};

// ==========================================
// DOM ELEMENTS
// ==========================================
const beatsGrid = document.getElementById('beatsGrid');
const filterButtonsContainer = document.querySelector('.filter-buttons');
const beatSearchInput = document.getElementById('beatSearch');
const playerModal = document.getElementById('playerModal');
const closePlayer = document.getElementById('closePlayer');
const audioPlayer = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const progressInput = document.getElementById('progressInput');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const volumeControl = document.getElementById('volumeControl');
const navbarToggle = document.getElementById('navbarToggle');
const navMenu = document.getElementById('navMenu');
const navLinks = document.querySelectorAll('.nav-link');

// ==========================================
// INITIALIZATION
// ==========================================
function init() {
  try {
    state.allBeats = BEATS_CATALOG.filter(beat => beat.available);
    buildAvailableGenres();
    renderFilterButtons();
    applyFilters();
    renderBeats();
    setupEventListeners();
    console.log(`Loaded ${state.allBeats.length} beats from catalog`);
  } catch (error) {
    console.error('Failed to initialize application:', error);
    displayErrorMessage('Unable to load the beat catalog. Please refresh the page.');
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

function renderFilterButtons() {
  // Define genre buttons with display names
  const genreOptions = [
    { key: 'all', label: 'All' },
    { key: 'Hip-Hop', label: 'Hip-Hop' },
    { key: 'Trap', label: 'Trap' },
    { key: 'R&B', label: 'R&B' },
    { key: 'Afrobeat', label: 'Afrobeat' },
    { key: 'Afro Fusion', label: 'Afro Fusion' },
    { key: 'Afro House', label: 'Afro House' },
    { key: 'Amapiano', label: 'Amapiano' }
  ];

  filterButtonsContainer.innerHTML = '';

  genreOptions.forEach(option => {
    // Show 'All' button always, hide genre buttons if no beats in that genre
    if (option.key !== 'all' && !state.availableGenres.includes(option.key)) {
      return;
    }

    const button = document.createElement('button');
    button.className = `filter-btn ${option.key === state.selectedGenre ? 'active' : ''}`;
    button.dataset.filter = option.key;
    button.textContent = option.label;

    button.addEventListener('click', () => {
      state.selectedGenre = option.key;
      state.currentPage = 1;
      updateFilterButtons();
      applyFilters();
      renderBeats();
      beatsGrid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    filterButtonsContainer.appendChild(button);
  });
}

function updateFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === state.selectedGenre);
  });
}

// ==========================================
// SEARCH AND FILTER
// ==========================================
function applyFilters() {
  let filtered = [...state.allBeats];

  // Apply genre filter
  if (state.selectedGenre !== 'all') {
    filtered = filtered.filter(beat => beat.genre === state.selectedGenre);
  }

  // Apply search filter
  if (state.searchQuery.trim()) {
    const query = state.searchQuery.toLowerCase();
    filtered = filtered.filter(beat => {
      return beat.title.toLowerCase().includes(query) ||
             beat.genre.toLowerCase().includes(query) ||
             beat.key.toLowerCase().includes(query) ||
             beat.bpm.toString().includes(query) ||
             beat.description.toLowerCase().includes(query);
    });
  }

  state.filteredBeats = filtered;
  state.currentPage = 1; // Reset to first page when filters change
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
  const startIndex = (state.currentPage - 1) * state.beatsPerPage;
  const endIndex = startIndex + state.beatsPerPage;
  return state.filteredBeats.slice(startIndex, endIndex);
}

function getTotalPages() {
  return Math.ceil(state.filteredBeats.length / state.beatsPerPage);
}

// ==========================================
// RENDERING
// ==========================================
function renderBeats() {
  beatsGrid.innerHTML = '';

  if (state.filteredBeats.length === 0) {
    displayNoResultsMessage();
    return;
  }

  const paginatedBeats = getPaginatedBeats();
  paginatedBeats.forEach(beat => {
    const beatCard = createBeatCard(beat);
    beatsGrid.appendChild(beatCard);
  });

  // Add pagination controls if needed
  const totalPages = getTotalPages();
  if (totalPages > 1) {
    renderPaginationControls(totalPages);
  }
}

function createBeatCard(beat) {
  const card = document.createElement('div');
  card.className = 'beat-card';
  
  card.innerHTML = `
    <div class="beat-artwork">
      <img src="${beat.artwork}" alt="${beat.title}" onerror="this.src='/images/placeholder.jpg'">
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
      <div class="beat-price">₦${beat.price.toLocaleString()}</div>
      <button class="buy-btn" data-beat-id="${beat.id}">
        <i class="fas fa-shopping-cart"></i> Buy Beat
      </button>
    </div>
  `;

  // Add play preview listener
  card.querySelector('.play-overlay').addEventListener('click', () => {
    openPlayer(beat);
  });

  // Add buy button listener
  card.querySelector('.buy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    handleBuyBeat(beat);
  });

  return card;
}

function renderPaginationControls(totalPages) {
  const paginationContainer = document.createElement('div');
  paginationContainer.className = 'pagination-controls';
  paginationContainer.style.cssText = `
    grid-column: 1 / -1;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    padding: 2rem 0;
    color: var(--text-secondary);
  `;

  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '← Previous';
  prevBtn.disabled = state.currentPage === 1;
  prevBtn.style.cssText = `
    padding: 0.5rem 1rem;
    background: ${state.currentPage === 1 ? 'var(--lighter-bg)' : 'var(--primary-color)'};
    color: white;
    border: none;
    border-radius: 4px;
    cursor: ${state.currentPage === 1 ? 'not-allowed' : 'pointer'};
    opacity: ${state.currentPage === 1 ? '0.5' : '1'};
  `;
  prevBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderBeats();
      beatsGrid.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Page info
  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;

  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = state.currentPage === totalPages;
  nextBtn.style.cssText = `
    padding: 0.5rem 1rem;
    background: ${state.currentPage === totalPages ? 'var(--lighter-bg)' : 'var(--primary-color)'};
    color: white;
    border: none;
    border-radius: 4px;
    cursor: ${state.currentPage === totalPages ? 'not-allowed' : 'pointer'};
    opacity: ${state.currentPage === totalPages ? '0.5' : '1'};
  `;
  nextBtn.addEventListener('click', () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderBeats();
      beatsGrid.scrollIntoView({ behavior: 'smooth' });
    }
  });

  paginationContainer.appendChild(prevBtn);
  paginationContainer.appendChild(pageInfo);
  paginationContainer.appendChild(nextBtn);

  beatsGrid.appendChild(paginationContainer);
}

function displayNoResultsMessage() {
  beatsGrid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
      <i class="fas fa-search" style="font-size: 3rem; color: var(--accent-color); margin-bottom: 1rem;"></i>
      <p style="font-size: 1.1rem;">No beats found. Try adjusting your search or filters.</p>
    </div>
  `;
}

function displayErrorMessage(message) {
  beatsGrid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
      <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: var(--accent-color); margin-bottom: 1rem;"></i>
      <p style="font-size: 1.1rem;">${message}</p>
    </div>
  `;
}

// ==========================================
// AUDIO PLAYER
// ==========================================
function openPlayer(beat) {
  state.currentBeat = beat;
  document.getElementById('playerBeatTitle').textContent = beat.title;
  document.getElementById('playerBeatGenre').textContent = beat.genre;
  document.getElementById('playerBeatBPM').textContent = beat.bpm;
  document.getElementById('playerBeatKey').textContent = beat.key;
  document.getElementById('playerBeatArt').src = beat.artwork;

  audioPlayer.src = beat.previewAudio;
audioPlayer.volume = Number(volumeControl.value) / 100;
playerModal.classList.add('active');
audioPlayer.play();

function closePlayerModal() {
  playerModal.classList.remove('active');
  audioPlayer.pause();
  updatePlayButton();
}

function togglePlay() {
  if (audioPlayer.paused) {
    audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
  updatePlayButton();
}

function updatePlayButton() {
  if (audioPlayer.paused) {
    playBtn.innerHTML = '<i class="fas fa-play"></i>';
  } else {
    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
  }
}

function seek() {
  const seekTime = (progressInput.value / 100) * audioPlayer.duration;
  audioPlayer.currentTime = seekTime;
}

function updateProgress() {
  if (audioPlayer.duration) {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    document.getElementById('progress').style.width = progress + '%';
    progressInput.value = progress;
    currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
  }
}

function updateDuration() {
  durationEl.textContent = formatTime(audioPlayer.duration);
  progressInput.max = 100;
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function handleAudioEnd() {
  audioPlayer.currentTime = 0;
  updatePlayButton();
}

function changeVolume() {
  const volume = Number(volumeControl.value) / 100;
  audioPlayer.volume = volume;
}

// ==========================================
// PURCHASE HANDLING
// ==========================================
function handleBuyBeat(beat) {
  // TODO: Integrate with Paystack payment gateway
  // Beat data available: beat.id, beat.title, beat.price
  console.log('Buy button clicked for beat:', beat.id, beat.title, beat.price);
  alert(`Ready to purchase: ${beat.title}\n\nPrice: ₦${beat.price.toLocaleString()}\n\nPaystack integration coming soon...`);
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  // Search input
  beatSearchInput.addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  // Player controls
  closePlayer.addEventListener('click', closePlayerModal);
  playBtn.addEventListener('click', togglePlay);
  progressInput.addEventListener('change', seek);
  progressInput.addEventListener('input', seek);
  volumeControl.addEventListener('input', changeVolume);
  volumeControl.addEventListener('change', changeVolume);

  // Audio events
  audioPlayer.addEventListener('timeupdate', updateProgress);
  audioPlayer.addEventListener('loadedmetadata', updateDuration);
  audioPlayer.addEventListener('ended', handleAudioEnd);

  // Mobile menu
  navbarToggle.addEventListener('click', toggleMobileMenu);
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('active');
      navbarToggle.classList.remove('active');
    });
  });

  // Close player when clicking outside
  playerModal.addEventListener('click', (e) => {
    if (e.target === playerModal) {
      closePlayerModal();
    }
  });
}

function toggleMobileMenu() {
  navMenu.classList.toggle('active');
  navbarToggle.classList.toggle('active');
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ==========================================
// INITIALIZE ON PAGE LOAD
// ==========================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
