#!/bin/sh
# One-shot local setup for the Base44 sandbox: creates the D1 schema, seeds a
# small demo catalogue, uploads the demo media and packages into local R2 and
# only then applies the licensing migrations.
#
# The order matters. migrations/0002_backfill_legacy_licence.sql grants each
# beat its existing price and zip_key under the MP3 + WAV tier, so the package
# object that key names has to be in R2 already — otherwise the backfill would
# enable a tier pointing at nothing. A licence is therefore never granted for a
# package this script has not uploaded.
#
# Safe to re-run: the schema uses IF NOT EXISTS, the rows use INSERT OR IGNORE,
# the seed only fills a missing zip_key, media puts simply overwrite, a package
# put is skipped when the object already exists, and the migrations runner
# records what it applied.
#
# Run as the `setup` service in docker-compose.base44.yml before the dev server
# starts.
set -eu

PERSIST_DIR="${WRANGLER_PERSIST_DIR:-/data/state}"
BUCKET="wagwanspark-beats"
PACKAGE_DIR="${DEMO_PACKAGE_DIR:-/tmp/wagwanspark-demo-packages}"

cd /app

echo "[setup] applying D1 schema"
wrangler d1 execute DB --local --yes --persist-to "$PERSIST_DIR" \
  --file .base44/schema.sql

echo "[setup] seeding demo products"
wrangler d1 execute DB --local --yes --persist-to "$PERSIST_DIR" \
  --file .base44/demo-products.sql

put() {
  wrangler r2 object put "$BUCKET/$1" \
    --file "$2" --content-type "$3" --local --persist-to "$PERSIST_DIR"
}

# Mutable preview/artwork keys: re-uploading them on every setup is intended.
echo "[setup] uploading demo media to local R2"
put artwork/sun-fire.jpg public/images/sun-fire.jpg image/jpeg
put artwork/phenomenal.jpg public/images/phenomenal.JPEG image/jpeg
put artwork/serenade.jpg public/images/serenade.JPEG image/jpeg
put previews/sun-fire.mp3 public/audio/sun-fire-preview.mp3 audio/mpeg
put previews/phenomenal.mp3 public/audio/phenomenal-preview.mp3 audio/mpeg
put previews/serenade.mp3 public/audio/serenade-preview.mp3 audio/mpeg

# Buyable packages. These keys are versioned and immutable: an entitlement that
# recorded one must keep resolving to the same bytes, so an existing object is
# never rewritten. The archives are regenerated deterministically every run, so
# even a rebuild would produce identical content.
echo "[setup] building demo packages"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"
node .base44/demo-packages.mjs --out "$PACKAGE_DIR" > "$PACKAGE_DIR/manifest.txt"

echo "[setup] uploading demo packages to local R2"
while read -r beat_id package_key package_file; do
  [ -n "${package_key:-}" ] || continue
  if wrangler r2 object get "$BUCKET/$package_key" --local \
       --persist-to "$PERSIST_DIR" --file /dev/null >/dev/null 2>&1; then
    echo "[setup] keeping existing package $package_key ($beat_id)"
  else
    put "$package_key" "$package_file" application/zip
  fi
done < "$PACKAGE_DIR/manifest.txt"

# Only now that every package object exists may a tier be enabled.
echo "[setup] applying licensing migrations"
wrangler d1 migrations apply DB --local --persist-to "$PERSIST_DIR"

# 0002 is recorded as applied and never runs again, so a sandbox seeded before
# the demo packages existed still needs its tier granted. Re-running the backfill
# is documented as idempotent; the reconciliation withdraws the "missing
# package" exceptions it recorded back then. Local only — production is
# untouched.
echo "[setup] reconciling legacy licence tiers"
wrangler d1 execute DB --local --yes --persist-to "$PERSIST_DIR" \
  --file migrations/0002_backfill_legacy_licence.sql
wrangler d1 execute DB --local --yes --persist-to "$PERSIST_DIR" \
  --file .base44/demo-licences.sql

echo "[setup] done"
