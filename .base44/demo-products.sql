-- Demo catalogue for local development.
--
-- These are the three products the Worker already knows about as LEGACY_BEATS
-- (see src/index.js) and for which artwork/preview files exist in public/. They
-- are inserted published so the storefront shows a working catalogue in the
-- sandbox. Media keys point at the objects uploaded to local R2 by
-- .base44/dev-setup.sh. INSERT OR IGNORE keeps re-runs harmless.
INSERT OR IGNORE INTO beats
  (id, title, genre, bpm, musical_key, price, description, artwork_key, preview_key, status, featured, category)
VALUES
  ('sun-fire', 'SUN FIRE', 'Afrobeat', 102, 'F Minor', 7000,
   'Demo product seeded for local development. Replace it from the admin panel.',
   'artwork/sun-fire.jpg', 'previews/sun-fire.mp3', 'published', 1, 'beats'),
  ('phenomenal', 'PHENOMENAL', 'Trap', 140, 'G Minor', 7000,
   'Demo product seeded for local development. Replace it from the admin panel.',
   'artwork/phenomenal.jpg', 'previews/phenomenal.mp3', 'published', 0, 'beats'),
  ('serenade', 'SERENADE', 'R&B', 96, 'C Major', 7000,
   'Demo product seeded for local development. Replace it from the admin panel.',
   'artwork/serenade.jpg', 'previews/serenade.mp3', 'published', 0, 'beats');
