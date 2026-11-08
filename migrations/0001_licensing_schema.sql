-- Phase 1 — licensing schema.
--
-- ADDITIVE ONLY. This migration creates new tables and seeds reference data.
-- It does not alter or delete anything in `beats`, does not touch R2, and does
-- not change any existing route: the storefront keeps behaving exactly as it
-- does today until a later phase starts reading these tables.
--
-- Applied with:
--   wrangler d1 migrations apply DB --local     (development)
--   wrangler d1 migrations apply DB --remote    (production — ONLY after approval)
--
-- Timestamp convention: text, UTC, `YYYY-MM-DD HH:MM:SS` (what CURRENT_TIMESTAMP
-- produces in SQLite). All comparisons are lexicographic on that format, so
-- `expires_at <= CURRENT_TIMESTAMP` is correct. Never mix ISO-8601 'T'/'Z'
-- strings into these columns.

-- ---------------------------------------------------------------------------
-- Licence catalogue (reference data — the four stable keys)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licences (
  licence_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_exclusive INTEGER NOT NULL DEFAULT 0 CHECK (is_exclusive IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO licences (licence_key, label, sort_order, is_exclusive) VALUES
  ('mp3',       'MP3 License',         1, 0),
  ('mp3_wav',   'MP3 + WAV License',   2, 0),
  ('stems',     'Stems License',       3, 0),
  ('exclusive', 'Exclusive License',   4, 1);

-- ---------------------------------------------------------------------------
-- Per-beat licence offerings
--
-- `package_key` is the exact R2 object key this tier grants. For new grants it
-- must be an immutable, versioned key — a package replacement creates a new key
-- and never rewrites the object an existing entitlement points at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS beat_licences (
  beat_id TEXT NOT NULL,
  licence_key TEXT NOT NULL,
  price INTEGER,
  package_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (beat_id, licence_key),
  CHECK (
    enabled = 0
    OR (price IS NOT NULL AND price > 0 AND package_key IS NOT NULL AND TRIM(package_key) <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_beat_licences_licence
  ON beat_licences (licence_key, enabled);

-- ---------------------------------------------------------------------------
-- Orders
--
-- `reference` is the Paystack reference and is UNIQUE: that is the primary
-- duplicate guard for webhook retries and repeated verify-payment calls.
-- `amount` is in kobo, matching Paystack.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'manual_review')),
  provider TEXT NOT NULL DEFAULT 'paystack',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_email ON orders (email);

-- ---------------------------------------------------------------------------
-- Order items — immutable price/licence/package snapshot taken at purchase.
-- Everything needed to honour a historical purchase lives here, so later price
-- edits, licence disabling or package replacement cannot change past rights.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  beat_id TEXT NOT NULL,
  beat_title TEXT NOT NULL,
  licence_key TEXT NOT NULL,
  licence_label TEXT NOT NULL,
  price INTEGER NOT NULL,
  package_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_unique
  ON order_items (order_id, beat_id, licence_key);
CREATE INDEX IF NOT EXISTS idx_order_items_beat ON order_items (beat_id);

-- ---------------------------------------------------------------------------
-- Entitlements — what a customer may download.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL UNIQUE,
  reference TEXT NOT NULL,
  email TEXT NOT NULL,
  beat_id TEXT NOT NULL,
  licence_key TEXT NOT NULL,
  package_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_unique
  ON entitlements (reference, beat_id, licence_key);
CREATE INDEX IF NOT EXISTS idx_entitlements_email ON entitlements (email);

-- ---------------------------------------------------------------------------
-- Exclusive sales — one row per beat, forever. The PRIMARY KEY on beat_id is
-- what makes a completed exclusive sale permanently block every later
-- reservation and purchase: the second insert cannot succeed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exclusive_sales (
  beat_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL UNIQUE,
  reference TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  price INTEGER NOT NULL,
  package_key TEXT NOT NULL,
  sold_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Exclusive reservations
--
-- The partial unique index is the atomicity guarantee: at most one ACTIVE
-- reservation per beat can exist, so "expire then reserve" is a single
-- transaction that either fully succeeds or fully fails. Releasing an expired
-- reservation (status -> 'released'/'expired') frees the slot in the same
-- transaction that claims it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exclusive_reservations (
  id TEXT PRIMARY KEY,
  beat_id TEXT NOT NULL,
  email TEXT NOT NULL,
  amount INTEGER,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'converted', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusive_reservations_active
  ON exclusive_reservations (beat_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_exclusive_reservations_expiry
  ON exclusive_reservations (status, expires_at);

-- ---------------------------------------------------------------------------
-- Exclusive offers — the negotiation inbox rendered in the admin panel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exclusive_offers (
  id TEXT PRIMARY KEY,
  beat_id TEXT NOT NULL,
  email TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exclusive_offers_status
  ON exclusive_offers (status, created_at);

-- ---------------------------------------------------------------------------
-- Append-only event log for every licensing-side state change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licence_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_licence_events_entity
  ON licence_events (entity_type, entity_id, created_at);

-- ---------------------------------------------------------------------------
-- Webhook deliveries. `event_key` is the Paystack event identity; inserting it
-- first is what stops a retried webhook from materialising a second order.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  event_key TEXT PRIMARY KEY,
  reference TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_reference
  ON webhook_events (reference);

-- ---------------------------------------------------------------------------
-- email_deliveries was previously created by request-path DDL in the Worker.
-- Adopt it explicitly so the schema is owned by migrations from here on.
-- Same shape as before — CREATE TABLE IF NOT EXISTS is a no-op where it exists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_deliveries (
  reference TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

-- ---------------------------------------------------------------------------
-- Backfill exceptions for manual review.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licence_backfill_issues (
  beat_id TEXT PRIMARY KEY,
  issue TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
