# Working on this repo in the Base44 sandbox

## What this app actually is

`src/index.js` is a **Cloudflare Worker**, not a Node server:

- `env.DB` — D1 database (`beats` table)
- `env.BEATS_BUCKET` — R2 bucket for artwork, preview audio and ZIPs
- `env.ASSETS` — static storefront from `public/` (all `/api/*` routes are handled by the Worker)

Worker entry point: `wrangler.toml` `main` points at `src/phase3-worker.js`,
which handles the licensing payment/fulfilment/download routes and delegates
everything else to `src/phase2-worker.js` (licensing order creation), which in
turn delegates to `src/index.js` (the original store worker). Add new routes to
the outermost layer and keep that delegation chain intact.

The `start`/`dev` scripts in `package.json` are stale (there is no index.js at the root and `nodemon` is not even a dependency) — ignore them. Local development runs the Worker through `wrangler dev`, which emulates D1, R2 and the assets binding.

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d --build   # http://localhost:3000
docker compose -f docker-compose.base44.yml logs -f store    # Worker logs
```

- `store` serves the Worker + assets on port 3000 with the repo bind-mounted, so source edits are picked up without a rebuild (multi-page site, so hard-refresh the browser — there is no SPA router).
- `setup` is a one-shot service that runs before `store`: `.base44/dev-setup.sh` applies `.base44/schema.sql`, inserts the demo catalogue (`.base44/demo-products.sql`), applies the `migrations/` licensing migrations and uploads the demo artwork/preview files into local R2. It is idempotent (`IF NOT EXISTS` / `INSERT OR IGNORE` / overwriting puts).
- D1 + R2 state lives in the `wrangler-state` volume at `/data/state` (not in the repo). `docker compose -f docker-compose.base44.yml down -v` wipes it and the next `up` re-seeds.

## Frontend structure (Sonic Kinetics redesign)

Three static pages served by the `ASSETS` binding: `index.html` (Beats/home),
`samples.html` (`/samples`), `studio-tools.html` (`/studio-tools`). All of them
share one script, `public/app.js`, which renders the product cards, the cart
drawer and the audio player.

Stylesheet load order matters and must be kept:
`styles.css` → `cart.css` → `store-pages.css` (samples/studio only) →
`theme.css`. `theme.css` is the redesign layer and is loaded **last on all
three pages** so it can override the base sheets without editing them. Any new
page must load `theme.css` too, or it will fall back to the old look.

- Colour/type tokens live in `styles.css` `:root` (`--primary-color` electric
  lime, `--secondary-color` the void, `--chrome`, `--iridescent`,
  `--font-display`/`--font-mono`). Retune the palette there, not in
  `theme.css`, so all pages follow.
- `app.js` appends a runtime stylesheet (`#wagwanspark-interaction-fixes`) to
  `head` *after* `theme.css`, so its rules win ties and it can beat
  `theme.css` even at lower specificity when it uses `!important`. Keep its
  accent hexes in sync with the tokens (currently `#ccff00`).
- `theme.css` styles the shared cards via `.beats-grid` / `.store-section
  .product-grid`, so Beats, Samples and Studio Tools stay identical.
- Homepage hero: markup in `index.html` + `buildHeroVisual()` and
  `bindHeroSearch()` in `app.js`. The hero search drives the same catalogue
  filter as `#searchInput`; the two fields stay mirrored.

To verify the redesign: `curl http://localhost:3000/theme.css` (200) and check
the homepage hero renders its 34 waveform bars.

### Verifying the secondary pages in the Base44 preview

The site is multi-page with no SPA router, so the preview browser can only load
the home route — navigating to `/samples` fails. Verify those pages from a
preview script by pointing a same-origin `<iframe>` at `/samples` or
`/studio-tools` and reading `iframe.contentDocument`.

### Schema

Every route needs the `beats` table, so `.base44/schema.sql` creates it (columns inferred from the SQL in `src/index.js`); `published_at`, `featured_position` and `catalogue_position` are added lazily by the Worker on first use.

Licensing tables (Phase 1 on) are owned by `migrations/` and applied with `wrangler d1 migrations apply DB --local --persist-to /data/state` — `.base44/dev-setup.sh` runs this after the seed. Phase 2 writes `orders`/`order_items`; Phase 3 adds payment, fulfilment and entitlement downloads over them; Phase 4 makes one order hold beats, Samples and Studio Tools and emails its links (`docs/phase-3-implementation.md`, `docs/phase-4-implementation.md`). See `docs/migrations.md` for the apply and recovery runbook; never apply them to a remote database without approval.

`0004_unified_checkout.sql` is the one migration that is **not** re-runnable
(`ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in SQLite) — apply it once
through the runner, never by hand.

### Licensing behaviour worth knowing before you touch checkout

- Beat tiers live in `beat_licences`; Samples and Studio Tools have exactly one
  implicit tier (`standard`, priced from the product row, packaged from its
  `zip_key`). Prices and packages are always resolved server-side.
- Inventory rules are in `src/licensing-inventory.js` and run at order creation,
  payment start and fulfilment. **Reservations never expire by themselves** —
  only an admin release (`POST /api/admin/exclusive/reservations/release`) frees
  one. A sold beat blocks every licence, for good.
- The seed data has no `zip_key` on its demo products, so Phase 1 flagged them in
  `licence_backfill_issues` and `GET /api/beat-licences` returns no tiers locally.
  Beat cards then show no licence picker and checkout falls back to the legacy
  `/api/create-payment` flow. Insert `beat_licences` rows to exercise the tiered
  flow (and delete them afterwards — they are real prices).
- Admin ZIP uploads write versioned keys (`-v<n>.zip`); the previous object is
  never overwritten. Never delete an object a past order or entitlement records.

### Secrets

Wrangler reads Worker secrets/bindings from `.dev.vars`, **not** from the process environment, so the `store` service generates `.dev.vars` at startup from the container environment (gitignored). Values must be single-line. Precedence: `.env.base44-defaults` (repo defaults, e.g. `ADMIN_PASSWORD=wagwanspark-admin`) then `/run/base44/app.env` (Base44-managed secrets) — secrets added on the Secrets page therefore win.

Paystack keys and the Google Apps Script email URL/secret are external credentials; add them on the Base44 Secrets page. Without `PAYSTACK_SECRET_KEY` the storefront, cart and admin panel all work, but checkout/verify/download/webhook return a "not configured" error by design.

## Verifying it works

```bash
curl -s http://localhost:3000/api/products?category=beats   # seeded catalogue
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3000/api/media/sun-fire/artwork
curl -s -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' \
  -d '{"password":"wagwanspark-admin"}'                     # 200 + ws_admin_session cookie
```

Tests run inside the container (no host runtime needed):

```bash
docker compose -f docker-compose.base44.yml exec -T store node --test tests/*.test.mjs
```

They cover the Phase 1 migrations, Phase 2 order creation and the Phase 3
payment/fulfilment/download routes; Paystack calls are stubbed, so no live
payment request is made.

Admin panel: `/admin` (or `/admin.html`). The session cookie is `Path=/api/admin`, `Secure`, `SameSite=Strict`; `GET /api/admin/session` reports 401 when signed out.

## Known sandbox limitations

- `CALLBACK_URL` in `src/index.js` is hardcoded to the production Worker. A real Paystack payment therefore redirects to production, not back to the sandbox — open `/success?reference=<reference>` manually to finish the flow locally.
- The seeded demo products have no `zip_key`, so a download for them returns "Download file not found in storage". Upload a ZIP from the admin panel to make one downloadable.
- The idle mini audio player renders `<img src="">`, which logs one failed-image console error on page load (pre-existing, no visual impact).
- `BASE44_PREVIEW_MODE` is passed through to the `store` service and into `.dev.vars` for sandbox-only overrides; when it is unset or anything other than `"1"`, application behaviour is unchanged.
