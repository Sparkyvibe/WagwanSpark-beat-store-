
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
const navbarToggle = document.getElementById('navbarToggle');
const navMenu = document.getElementById('navMenu');
const navLinks = document.querySelectorAll('.nav-link');

// ==========================================
// INITIALIZATION
// ==========================================

function init() {
  try {
    if (!beatsGrid || !playerModal || !audioPlayer || !playBtn) {
      throw new Error(
        'Required page elements are missing. Check index.html.'
      );
    }

    state.allBeats = BEATS_CATALOG.filter(beat => beat.available);

    buildAvailableGenres();
    renderFilterButtons();
    applyFilters();
    renderBeats();
    setupEventListeners();

    console.log(
      `Loaded ${state.allBeats.length} beats from catalog`
    );
  } catch (error) {
    console.error('Failed to initialize application:', error);

    if (beatsGrid) {
      displayErrorMessage(
        'Unable to load the beat catalog. Please refresh the page.'
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

function renderFilterButtons() {
  if (!filterButtonsContainer) return;

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
    if (
      option.key !== 'all' &&
      !state.availableGenres.includes(option.key)
    ) {
      return;
    }

    const button = document.createElement('button');

    button.className =
      `filter-btn ${
        option.key === state.selectedGenre ? 'active' : ''
      }`;

    button.dataset.filter = option.key;
    button.textContent = option.label;

    button.addEventListener('click', () => {
      state.selectedGenre = option.key;
      state.currentPage = 1;

      updateFilterButtons();
      applyFilters();
      renderBeats();

      beatsGrid.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    });

    filterButtonsContainer.appendChild(button);
  });
}

function updateFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle(
      'active',
      btn.dataset.filter === state.selectedGenre
    );
  });
}

// ==========================================
// SEARCH AND FILTER
// ==========================================

function applyFilters() {
  let filtered = [...state.allBeats];

  if (state.selectedGenre !== 'all') {
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

  const endIndex =
    startIndex + state.beatsPerPage;

  return state.filteredBeats.slice(startIndex, endIndex);
}

function getTotalPages() {
  return Math.ceil(
    state.filteredBeats.length / state.beatsPerPage
  );
}

// ==========================================
// RENDERING
// ==========================================

function renderBeats() {
  if (!beatsGrid) return;

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

  const totalPages = getTotalPages();

  if (totalPages > 1) {
    renderPaginationControls(totalPages);
  }
}

function createBeatCard(beat) {
  const card = document.createElement('div');

  card.className = 'beat-card';

  card.innerHTML = `
    <div class="beat-artwork" role="button" tabindex="0"
         aria-label="Play ${escapeHtml(beat.title)} preview">
      <img
        src="${beat.artwork}"
        alt="${escapeHtml(beat.title)}"
        onerror="this.onerror=null;this.src='/images/placeholder.jpg'"
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
        ₦${beat.price.toLocaleString()}
      </div>

      <button
        class="buy-btn"
        data-beat-id="${beat.id}"
        type="button"
      >
        <i class="fas fa-shopping-cart"></i>
        Buy Beat
      </button>
    </div>
  `;

  // FIX: Make the entire artwork clickable.
  // This works even when CSS hides the play overlay on mobile.
  const artwork = card.querySelector('.beat-artwork');

  artwork.addEventListener('click', () => {
    openPlayer(beat);
  });

  artwork.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPlayer(beat);
    }
  });

  // Keep the purchase button independent from playback.
  card.querySelector('.buy-btn').addEventListener('click', event => {
    event.stopPropagation();
    handleBuyBeat(beat);
  });

  return card;
}

// ==========================================
// PAGINATION CONTROLS
// ==========================================

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

  const prevBtn = document.createElement('button');

  prevBtn.textContent = '← Previous';
  prevBtn.disabled = state.currentPage === 1;

  prevBtn.style.cssText = `
    padding: 0.5rem 1rem;
    background: ${
      state.currentPage === 1
        ? 'var(--lighter-bg)'
        : 'var(--primary-color)'
    };
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

      beatsGrid.scrollIntoView({
        behavior: 'smooth'
      });
    }
  });

  const pageInfo = document.createElement('span');

  pageInfo.textContent =
    `Page ${state.currentPage} of ${totalPages}`;

  const nextBtn = document.createElement('button');

  nextBtn.textContent = 'Next →';
  nextBtn.disabled = state.currentPage === totalPages;

  nextBtn.style.cssText = `
    padding: 0.5rem 1rem;
    background: ${
      state.currentPage === totalPages
        ? 'var(--lighter-bg)'
        : 'var(--primary-color)'
    };
    color: white;
    border: none;
    border-radius: 4px;
    cursor: ${
      state.currentPage === totalPages
        ? 'not-allowed'
        : 'pointer'
    };
    opacity: ${state.currentPage === totalPages ? '0.5' : '1'};
  `;

  nextBtn.addEventListener('click', () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderBeats();

      beatsGrid.scrollIntoView({
        behavior: 'smooth'
      });
    }
  });

  paginationContainer.appendChild(prevBtn);
  paginationContainer.appendChild(pageInfo);
  paginationContainer.appendChild(nextBtn);

  beatsGrid.appendChild(paginationContainer);
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
// AUDIO PLAYER
// ==========================================

async function openPlayer(beat) {
  if (!beat || !audioPlayer || !playerModal) return;

  state.currentBeat = beat;

  document.getElementById('playerBeatTitle').textContent = beat.title;
  document.getElementById('playerBeatGenre').textContent = beat.genre;
  document.getElementById('playerBeatBPM').textContent = beat.bpm;
  document.getElementById('playerBeatKey').textContent = beat.key;

  const playerArt = document.getElementById('playerBeatArt');
  playerArt.src = beat.artwork;
  playerArt.alt = beat.title;

  // Reset the previous track and its progress.
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = beat.previewAudio;
  audioPlayer.load();

  if (progressInput) progressInput.value = 0;
  if (currentTimeEl) currentTimeEl.textContent = '0:00';
  if (durationEl) durationEl.textContent = '0:00';

  const progress = document.getElementById('progress');
  if (progress) progress.style.width = '0%';

  // Show the mini-player immediately.
  playerModal.classList.add('active');
  updatePlayButton();

  // Attempt playback after opening the player.
  try {
    await audioPlayer.play();
  } catch (error) {
    console.error('Audio playback failed:', error);
    updatePlayButton();

    // The player remains visible so the user can press Play again.
    // Check the preview file path if playback continues to fail.
  }
}

function closePlayerModal() {
  if (!playerModal || !audioPlayer) return;

  playerModal.classList.remove('active');
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
      console.error('Unable to play audio:', error);
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
    playBtn.setAttribute('aria-label', 'Play preview');
  } else {
    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    playBtn.setAttribute('aria-label', 'Pause preview');
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

  const progress = document.getElementById('progress');

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
  if (!Number.isFinite(seconds)) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function handleAudioEnd() {
  if (!audioPlayer) return;

  audioPlayer.currentTime = 0;
  updatePlayButton();
}

// ==========================================
// PURCHASE HANDLING
// Payment logic preserved
// ==========================================

async function handleBuyBeat(beat) {
  const email = prompt(
    `Enter your email to purchase "${beat.title}":`
  );

  if (!email) return;

  if (!email.includes('@')) {
    alert('Please enter a valid email address.');
    return;
  }

  try {
    const response = await fetch('/api/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        beatId: beat.id,
        beatTitle: beat.title,
        amount: beat.price
      })
    });

    const result = await response.json();

    if (
      !response.ok ||
      !result.status ||
      !result.data?.authorization_url
    ) {
      console.error('Paystack error:', result);
      alert('Unable to start payment. Please try again.');
      return;
    }

    window.location.href = result.data.authorization_url;

  } catch (error) {
    console.error('Payment error:', error);
    alert('Something went wrong. Please try again.');
  }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

function setupEventListeners() {
  if (beatSearchInput) {
    beatSearchInput.addEventListener('input', event => {
      handleSearch(event.target.value);
    });
  }

  if (closePlayer) {
    closePlayer.addEventListener('click', closePlayerModal);
  }

  if (playBtn) {
    playBtn.addEventListener('click', togglePlay);
  }

  if (progressInput) {
    progressInput.addEventListener('input', seek);
    progressInput.addEventListener('change', seek);
  }

  if (audioPlayer) {
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('ended', handleAudioEnd);
    audioPlayer.addEventListener('play', updatePlayButton);
    audioPlayer.addEventListener('pause', updatePlayButton);

    audioPlayer.addEventListener('error', () => {
      console.error(
        'Preview audio failed to load:',
        audioPlayer.currentSrc,
        audioPlayer.error
      );
    });
  }

  if (navbarToggle) {
    navbarToggle.addEventListener('click', toggleMobileMenu);
  }

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (navMenu) navMenu.classList.remove('active');
      if (navbarToggle) navbarToggle.classList.remove('active');
    });
  });

  if (playerModal) {
    playerModal.addEventListener('click', event => {
      if (event.target === playerModal) {
        closePlayerModal();
      }
    });
  }
}

// ==========================================
// MOBILE MENU
// ==========================================

function toggleMobileMenu() {
  if (navMenu) navMenu.classList.toggle('active');
  if (navbarToggle) navbarToggle.classList.toggle('active');
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

  return String(text).replace(
    /[&<>"']/g,
    character => map[character]
  );
}

// ==========================================
// INITIALIZE
// ==========================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
