# Working on this repo in the Base44 sandbox

## What this app actually is

`src/index.js` is a **Cloudflare Worker**, not a Node server:

- `env.DB` — D1 database (`beats` table)
- `env.BEATS_BUCKET` — R2 bucket for artwork, preview audio and ZIPs
- `env.ASSETS` — static storefront from `public/` (all `/api/*` routes are handled by the Worker)

The `start`/`dev` scripts in `package.json` are stale (there is no index.js at the root and `nodemon` is not even a dependency) — ignore them. Local development runs the Worker through `wrangler dev`, which emulates D1, R2 and the assets binding.

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d --build   # http://localhost:3000
docker compose -f docker-compose.base44.yml logs -f store    # Worker logs
```

- `store` serves the Worker + assets on port 3000 with the repo bind-mounted, so source edits are picked up without a rebuild (multi-page site, so hard-refresh the browser — there is no SPA router).
- `setup` is a one-shot service that runs before `store`: `.base44/dev-setup.sh` applies `.base44/schema.sql`, inserts the demo catalogue (`.base44/demo-products.sql`) and uploads the demo artwork/preview files into local R2. It is idempotent (`IF NOT EXISTS` / `INSERT OR IGNORE` / overwriting puts).
- D1 + R2 state lives in the `wrangler-state` volume at `/data/state` (not in the repo). `docker compose -f docker-compose.base44.yml down -v` wipes it and the next `up` re-seeds.

### Schema

The repository has no migrations directory, but every route needs the `beats` table, so `.base44/schema.sql` creates it (columns inferred from the SQL in `src/index.js`). `email_deliveries` is created at runtime by the Paystack webhook — nothing to do locally.

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

Admin panel: `/admin` (or `/admin.html`). The session cookie is `Path=/api/admin`, `Secure`, `SameSite=Strict`; `GET /api/admin/session` reports 401 when signed out.

## Known sandbox limitations

- `CALLBACK_URL` in `src/index.js` is hardcoded to the production Worker. A real Paystack payment therefore redirects to production, not back to the sandbox — open `/success?reference=<reference>` manually to finish the flow locally.
- The seeded demo products have no `zip_key`, so a download for them returns "Download file not found in storage". Upload a ZIP from the admin panel to make one downloadable.
- The idle mini audio player renders `<img src="">`, which logs one failed-image console error on page load (pre-existing, no visual impact).
- `BASE44_PREVIEW_MODE` is passed through to the `store` service and into `.dev.vars` for sandbox-only overrides; when it is unset or anything other than `"1"`, application behaviour is unchanged.
