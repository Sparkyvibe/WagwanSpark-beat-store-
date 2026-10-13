#!/bin/sh
# One-shot local setup for the Base44 sandbox: creates the D1 schema, seeds a
# small demo catalogue and uploads the demo media into local R2.
#
# Safe to re-run: the schema uses IF NOT EXISTS, the rows use INSERT OR IGNORE
# and R2 puts simply overwrite. Run as the `setup` service in
# docker-compose.base44.yml before the dev server starts.
set -eu

PERSIST_DIR="${WRANGLER_PERSIST_DIR:-/data/state}"
BUCKET="wagwanspark-beats"

cd /app

echo "[setup] applying D1 schema"
wrangler d1 execute DB --local --yes --persist-to "$PERSIST_DIR" \
  --file .base44/schema.sql

echo "[setup] seeding demo products"
wrangler d1 execute DB --local --yes --persist-to "$PERSIST_DIR" \
  --file .base44/demo-products.sql

echo "[setup] uploading demo media to local R2"
put() {
  wrangler r2 object put "$BUCKET/$1" \
    --file "$2" --content-type "$3" --local --persist-to "$PERSIST_DIR"
}
put artwork/sun-fire.jpg public/images/sun-fire.jpg image/jpeg
put artwork/phenomenal.jpg public/images/phenomenal.JPEG image/jpeg
put artwork/serenade.jpg public/images/serenade.JPEG image/jpeg
put previews/sun-fire.mp3 public/audio/sun-fire-preview.mp3 audio/mpeg
put previews/phenomenal.mp3 public/audio/phenomenal-preview.mp3 audio/mpeg
put previews/serenade.mp3 public/audio/serenade-preview.mp3 audio/mpeg

echo "[setup] done"
