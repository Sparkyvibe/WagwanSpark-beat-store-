-- Phase 4 — unified mixed-category checkout.
--
-- ADDITIVE AND FORWARD-ONLY. Every statement either adds a nullable column or
-- adds a column with a default that reproduces the only rows that existed
-- before it: every pre-0004 order item and entitlement was a beat, so
-- `category` defaults to 'beats' and no historical row is rewritten.
--
-- `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS in SQLite, so this file is
-- meant to run exactly once, through D1's migration runner (which records what
-- it applied). Do not re-run it by hand against the same database: it will
-- stop on the first duplicate column. Everything it adds is nullable or has a
-- default, so a code rollback does not need to undo it.
--
-- Applied with:
--   wrangler d1 migrations apply DB --local     (development)
--   wrangler d1 migrations apply DB --remote    (production — ONLY after approval)
--
-- What the columns mean:
--   category            Which catalogue the item came from: 'beats',
--                       'samples' or 'studio-tools'. Beats keep their tiered
--                       licence semantics; the other two use one legacy
--                       purchase tier whose package is the product's ZIP.
--   package_version     The immutable package revision that was snapshotted,
--                       parsed from the versioned R2 key (-v<n>.zip). NULL for
--                       pre-0004 rows and for keys that are not versioned.
--
-- `beat_id` is NOT renamed and NOT repurposed: the catalogue table is `beats`
-- for all three categories, so `beat_id` holds the real catalogue id for every
-- item, beat or not. `category` is what disambiguates them.

ALTER TABLE order_items ADD COLUMN category TEXT NOT NULL DEFAULT 'beats';
ALTER TABLE order_items ADD COLUMN package_version INTEGER;

ALTER TABLE entitlements ADD COLUMN category TEXT NOT NULL DEFAULT 'beats';
ALTER TABLE entitlements ADD COLUMN package_version INTEGER;

-- Inventory reads done by checkout and fulfilment: "is this beat sold?"
-- (exclusive_sales is keyed by beat_id already) and "is an exclusive licence
-- currently held?" (the active-reservation lookup).
CREATE INDEX IF NOT EXISTS idx_entitlements_order_item
  ON entitlements (order_item_id);
