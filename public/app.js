// DOM Elements
const beatsGrid = document.getElementById('beatsGrid');
const filterButtons = document.querySelectorAll('.filter-btn');
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

let beatsData = [];
let currentBeat = null;

// Initialize the application
async function init() {
    try {
        await loadBeats();
        renderBeats('all');
        setupEventListeners();
    } catch (error) {
        console.error('Failed to initialize application:', error);
        displayErrorMessage('Unable to load the beat catalog. Please refresh the page.');
    }
}

// Load beats from JSON file
async function loadBeats() {
    try {
        const response = await fetch('/beats.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        beatsData = await response.json();
        console.log(`Loaded ${beatsData.length} beats from catalog`);
    } catch (error) {
        console.error('Error loading beats:', error);
        throw error;
    }
}

// Display error message in the beats grid
function displayErrorMessage(message) {
    beatsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
            <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: var(--accent-color); margin-bottom: 1rem;"></i>
            <p style="font-size: 1.1rem;">${message}</p>
        </div>
    `;
}

// Render beats based on filter
function renderBeats(filter) {
    beatsGrid.innerHTML = '';

    const filteredBeats = filter === 'all' 
        ? beatsData 
        : beatsData.filter(beat => beat.category === filter);

    if (filteredBeats.length === 0) {
        beatsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
                <p style="font-size: 1.1rem;">No beats found in this genre.</p>
            </div>
        `;
        return;
    }

    filteredBeats.forEach(beat => {
        const beatCard = createBeatCard(beat);
        beatsGrid.appendChild(beatCard);
    });
}

// Create a beat card element
function createBeatCard(beat) {
    const card = document.createElement('div');
    card.className = 'beat-card';
    card.innerHTML = `
        <div class="beat-artwork">
            <img src="${beat.artwork}" alt="${beat.title}">
            <div class="play-overlay">
                <div class="play-btn-overlay">
                    <i class="fas fa-play"></i>
                </div>
            </div>
        </div>
        <div class="beat-info">
            <h3 class="beat-title">${beat.title}</h3>
            <div class="beat-meta">
                <span class="beat-meta-item">
                    <i class="fas fa-music"></i>
                    ${beat.genre}
                </span>
                <span class="beat-meta-item">
                    <i class="fas fa-tachometer-alt"></i>
                    ${beat.bpm} BPM
                </span>
                <span class="beat-meta-item">
                    <i class="fas fa-key"></i>
                    ${beat.key}
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

// Open audio player
function openPlayer(beat) {
    currentBeat = beat;
    document.getElementById('playerBeatTitle').textContent = beat.title;
    document.getElementById('playerBeatGenre').textContent = beat.genre;
    document.getElementById('playerBeatBPM').textContent = beat.bpm;
    document.getElementById('playerBeatKey').textContent = beat.key;
    document.getElementById('playerBeatArt').src = beat.artwork;

    audioPlayer.src = beat.previewAudio;
    playerModal.classList.add('active');
    audioPlayer.play();
    updatePlayButton();
}

// Close player
function closePlayerModal() {
    playerModal.classList.remove('active');
    audioPlayer.pause();
    updatePlayButton();
}

// Handle buy beat button
function handleBuyBeat(beat) {
    // TODO: Integrate with Paystack payment gateway
    console.log('Buy button clicked for beat:', beat.title);
    alert(`Ready to purchase: ${beat.title}\n\nPrice: ₦${beat.price.toLocaleString()}\n\nPaystack integration coming soon...`);
}

// Setup event listeners
function setupEventListeners() {
    // Filter buttons
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderBeats(btn.dataset.filter);
        });
    });

    // Player controls
    closePlayer.addEventListener('click', closePlayerModal);
    playBtn.addEventListener('click', togglePlay);
    progressInput.addEventListener('change', seek);
    progressInput.addEventListener('input', seek);
    volumeControl.addEventListener('input', changeVolume);

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

// Toggle play/pause
function togglePlay() {
    if (audioPlayer.paused) {
        audioPlayer.play();
    } else {
        audioPlayer.pause();
    }
    updatePlayButton();
}

// Update play button icon
function updatePlayButton() {
    if (audioPlayer.paused) {
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
    } else {
        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    }
}

// Seek to position
function seek() {
    const seekTime = (progressInput.value / 100) * audioPlayer.duration;
    audioPlayer.currentTime = seekTime;
}

// Update progress bar
function updateProgress() {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('progress').style.width = progress + '%';
        progressInput.value = progress;
        currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
    }
}

// Update duration display
function updateDuration() {
    durationEl.textContent = formatTime(audioPlayer.duration);
    progressInput.max = 100;
}

// Format time in MM:SS
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Handle audio end
function handleAudioEnd() {
    audioPlayer.currentTime = 0;
    updatePlayButton();
}

// Change volume
function changeVolume() {
    audioPlayer.volume = volumeControl.value / 100;
}

// Toggle mobile menu
function toggleMobileMenu() {
    navMenu.classList.toggle('active');
    navbarToggle.classList.toggle('active');
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
