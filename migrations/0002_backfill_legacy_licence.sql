-- Phase 1 — legacy licence backfill.
--
-- Every existing BEAT keeps exactly what it has today: its current price and the
-- ZIP object key currently recorded in `beats.zip_key`, granted under the
-- legacy-equivalent tier.
--
-- Why `mp3_wav`: the storefront advertises "MP3 + WAV" on every card
-- (public/app.js) and on the beat page (public/beat.html), and the API returns
-- `formats: ["MP3", "WAV"]`. The single ZIP a buyer receives today is therefore
-- the MP3 + WAV bundle, so that is the tier preserved here.
--
-- Exactly ONE tier is enabled per beat. No additional tier is enabled, no price
-- is invented, and nothing is written to R2.
--
-- Scoped to `category = 'beats'`: samples and studio-tools keep their existing
-- purchase flow and are deliberately outside licensing.
--
-- Idempotent: re-running changes nothing (INSERT OR IGNORE on primary keys).
-- Rows that cannot be backfilled are recorded in licence_backfill_issues for
-- manual review rather than silently skipped.

-- 1. Grant the legacy-equivalent tier to every beat that has a usable package
--    reference and a valid price.
INSERT OR IGNORE INTO beat_licences
  (beat_id, licence_key, price, package_key, enabled)
SELECT
  beats.id,
  'mp3_wav',
  beats.price,
  beats.zip_key,
  1
FROM beats
WHERE beats.category = 'beats'
  AND beats.zip_key IS NOT NULL
  AND TRIM(beats.zip_key) <> ''
  AND beats.price IS NOT NULL
  AND beats.price > 0;

-- 2. Beats with no package reference at all — flagged, not enabled.
--    Note: a NULL zip_key does not prove the object is missing. The Worker can
--    still resolve a package through its legacy key-candidate scan
--    (mediaKeyCandidates in src/index.js), which only R2 can confirm, so these
--    require a human decision rather than an automatic grant.
INSERT OR IGNORE INTO licence_backfill_issues (beat_id, issue, detail)
SELECT
  beats.id,
  'missing_package',
  'beats.zip_key is NULL or empty; no package key recorded to grant.'
FROM beats
WHERE beats.category = 'beats'
  AND (beats.zip_key IS NULL OR TRIM(beats.zip_key) = '');

-- 3. Beats whose price would not satisfy the enabled-licence constraint.
INSERT OR IGNORE INTO licence_backfill_issues (beat_id, issue, detail)
SELECT
  beats.id,
  'invalid_price',
  'beats.price is not a positive integer; licence left disabled.'
FROM beats
WHERE beats.category = 'beats'
  AND beats.zip_key IS NOT NULL
  AND TRIM(beats.zip_key) <> ''
  AND (beats.price IS NULL OR beats.price < 1);
