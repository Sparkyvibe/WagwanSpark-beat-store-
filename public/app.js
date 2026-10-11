// ==========================================
// WAGWANSPARK — LIVE BEAT CATALOG
// ==========================================

// Fallback catalogue is used only if the API is unavailable.
const FALLBACK_BEATS_CATALOG = [
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

// Other functions continue using this variable.
// It gets replaced with the live database catalogue.
let BEATS_CATALOG = [...FALLBACK_BEATS_CATALOG];
