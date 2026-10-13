-- Schema for the D1 binding `DB`.
--
-- The repository has no migrations directory, but every Worker route reads and
-- writes the `beats` table, so local development needs it created explicitly.
-- Applied by .base44/dev-setup.sh; safe to re-run.
CREATE TABLE IF NOT EXISTS beats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  bpm INTEGER,
  musical_key TEXT,
  price INTEGER NOT NULL,
  description TEXT,
  artwork_key TEXT,
  preview_key TEXT,
  zip_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  featured INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'beats',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_beats_status_category
  ON beats (status, category);
