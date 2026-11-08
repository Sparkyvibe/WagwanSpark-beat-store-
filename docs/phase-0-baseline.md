# Phase 0 — Baseline, Schema & Behaviour Audit

**Status:** Phase 0 complete. Awaiting review before Phase 1.
**Branch:** `feature/tiered-licensing` @ `7d6ec79aab2f22c98065b82d7a9b5563e89480f8`
**Scope of this phase:** establish the branch, capture the baseline, inspect the existing D1
schema and R2 inventory, document current checkout and download behaviour. **No
implementation, no migrations, no production access, no secret changes, no deployment.**

---

## 1. Branch verification

| Check | Result |
| --- | --- |
| GitHub `main` head | `7d6ec79aab2f22c98065b82d7a9b5563e89480f8` |
| Commit subject | `Update app.js` |
| Commit date | 2026-10-30T13:28:27Z |
| Signature | GitHub-verified (`web-flow`) |
| Tree | `b5284b89a819a81871a0bbcc9220f13210423681` |

The requested commit **is** `main`. `feature/tiered-licensing` was created from exactly that
commit; `website-redesign` was used only as the pre-existing checkout and is untouched.

## 2. Baseline snapshot

The app is a single **Cloudflare Worker** (`src/index.js`, 1,978 lines) that serves a
multi-page static storefront from `public/` through the `ASSETS` binding, plus a JSON API.

| Binding | Value in `wrangler.toml` |
| --- | --- |
| D1 `DB` | `wagwanspark-beats-db`, id `92e11314-8f64-4719-ae7c-e7dde302ac13` |
| R2 `BEATS_BUCKET` | `wagwanspark-beats` |
| `ASSETS` | `public/` |
| Compatibility date | `2024-01-15` |

Storefront files: `index.html` (Beats/home), `beat.html` (`/beat/:id`), `samples.html`,
`studio-tools.html`, `success.html`, `admin.html`, all driven by `public/app.js` (2,632
lines).

### Toolchain and operational gaps

- **No tests on `main`.** `package.json` declares `"test": "jest"`, but Jest is not a
  dependency and there is no test file or `tests/` directory at this commit.
- **No CI/CD.** No `.github/` workflows. Deployment is a manual `wrangler deploy`.
- **No migrations directory.** Schema changes are applied lazily at request time by
  `ensurePublishedAtColumn`, `ensureFeaturedPositionColumn`, `ensureCataloguePositionColumn`
  (each `ALTER TABLE` guarded by a try/catch), and `email_deliveries` is created by
  `CREATE TABLE IF NOT EXISTS` inside the purchase-email path. `.base44/schema.sql` exists
  **only** for local sandbox development.
- `[env.production]` declares **the same `database_id` and R2 bucket as the default
  environment** (`92e11314-…`, `wagwanspark-beats`), and a placeholder `route = "example.com/*"`.
  See §8 — this needs confirming before any deploy.

## 3. Observed D1 schema

Read from the sandbox's local D1 emulation (`wrangler dev --persist-to /data/state`). This is
**not** production; see §7.

Tables present: `beats`, `_cf_METADATA` (Miniflare internal).
Indexes: `idx_beats_status_category`, `sqlite_autoindex_beats_1` (PK).

`beats` as it actually exists after the runtime `ALTER`s:

```sql
CREATE TABLE beats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  bpm INTEGER,
  musical_key TEXT,
  price INTEGER NOT NULL,          -- single price, integer naira. No tiers.
  description TEXT,
  artwork_key TEXT,
  preview_key TEXT,
  zip_key TEXT,                    -- ONE package per beat, mutable
  status TEXT NOT NULL DEFAULT 'draft',
  featured INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'beats',   -- beats | samples | studio-tools
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,               -- added lazily at runtime
  featured_position INTEGER,       -- added lazily at runtime
  catalogue_position INTEGER       -- added lazily at runtime
);
```

`email_deliveries` (does not exist until the first purchase email is attempted; created by
request-path DDL):

```sql
CREATE TABLE email_deliveries (
  reference TEXT PRIMARY KEY,      -- Paystack reference
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',   -- processing | sent | failed
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);
```

### What does **not** exist

There is **no** orders table, no order-items table, no entitlements table, no licences table,
no reservation table and no event log. Purchases are **not persisted anywhere** today. The only
durable trace of a transaction is the single `email_deliveries` row.

Local demo rows (3, all `category = beats`, all `price = 7000`, all `zip_key = NULL`):
`sun-fire` (featured, catalogue_position 3), `phenomenal` (1), `serenade` (2).

## 4. R2 inventory

### Local sandbox bucket

6 objects total — artwork and previews only, **no ZIP objects**:

```
artwork/sun-fire.jpg     previews/sun-fire.mp3
artwork/phenomenal.jpg   previews/phenomenal.mp3
artwork/serenade.jpg     previews/serenade.mp3
```

This matches `.base44/dev-setup.sh`, which uploads only `.base44/demo-products.sql` media. It is
consistent with the documented sandbox behaviour that seeded demo products are not downloadable.

### Key conventions derived from `src/index.js`

Uploads write deterministic, unversioned keys:

| Kind | `category = beats` | `category = samples / studio-tools` |
| --- | --- | --- |
| artwork | `artwork/{id}.{jpg,png,webp}` | `products/{category}/{id}.{ext}` |
| preview | `previews/{id}.{mp3,wav}` | `products/{category}/{id}-preview.{ext}` |
| package (ZIP) | `beats/{id}.zip` | `products/{category}/{id}.zip` |

Reads are far looser. `mediaKeyCandidates()` scans a fallback list, and for the `beats`
category it also tries, for each of the variants `{id, ID, Title, TITLE, title, Title-Hyphenated,
title-hyphenated}`: `artwork(s)/{name}.{ext}`, `preview(s)/{name}.{ext}`,
`beats/{name}.zip`, `{name}.zip`, plus `LEGACY_BEATS[id].candidates`.

`LEGACY_BEATS` hardcodes three beats with their package candidates:

```js
"sun-fire":   { price: 7000, candidates: ["beats/SUN FIRE.zip", "SUN FIRE.zip"] }
"phenomenal": { price: 7000, candidates: ["beats/PHENOMENAL.zip", "PHENOMENAL.zip"] }
"serenade":   { price: 7000, candidates: ["beats/SERENADE.zip", "SERENADE.zip"] }
```

These three are the concrete "legacy-equivalent" population for backfill on the data side.

## 5. Current checkout behaviour

Read from `src/index.js` and exercised locally where it requires no external call.

1. **`POST /api/create-payment`** — validates the email, resolves the selection through
   `getRequestedProducts()` (server-side price read from D1; client prices are never trusted;
   1–50 items, unique, must be `status = 'published'`, `price` a positive safe integer), then
   calls Paystack `transaction/initialize` with `amount = total * 100` kobo, `currency NGN`,
   `callback_url = CALLBACK_URL`, and `metadata` carrying `productIds` / `productTitles` /
   `beatIds` / `beatTitles` / `itemCount` (plus single-item aliases).
   **Nothing is written to D1.** There is no order row, no idempotency key, no reservation and
   no record of what was quoted.
2. Paystack redirects to `CALLBACK_URL` — hardcoded `https://wagwanspark.com.ng/success.html`,
   so a sandbox payment cannot complete locally (documented sandbox limitation).
3. **`GET /api/verify-payment?reference=…`** — verifies the transaction with Paystack and
   requires `status = success`, `currency = NGN`, `amount` exactly equal to the recomputed
   product prices, `reference` equality, and a valid customer email. It then (a) attempts the
   email via `deliverPurchaseEmailOnce()` and (b) mints one **30-minute** HMAC download token
   per product. The response is consumed by `success.html`, which renders the links.
4. **`POST /api/paystack-webhook`** — verifies the `x-paystack-signature` (HMAC-SHA512 of the
   raw body keyed with `PAYSTACK_SECRET_KEY`), ignores everything except `charge.success`,
   **re-verifies the transaction with Paystack by reference** (never trusts the payload), then
   cross-checks reference/amount/currency before delivering the receipt through the same
   deduped email path. Returns 500 on email failure so Paystack retries.

### Verified locally (read-only, no external calls)

| Probe | Result |
| --- | --- |
| `POST /api/create-payment` with `email: "nope"` | `400`, "Please enter a valid email address." (rejected before any Paystack call) |
| `POST /api/create-payment` with unknown product id | `400`, "One or more selected products are unavailable." |
| `GET /api/products?category=beats` | `200`, 3 products with `price`, `zip_key`, positions |

### Idempotency today

Only email delivery is deduplicated, via `email_deliveries.reference` as primary key:
first insert claims `processing`; `sent` is terminal; a `processing` row younger than 5 minutes
returns "processing"; older rows are reclaimed with a conditional `UPDATE … WHERE status != 'sent'`
and re-checked. Because no other side effect is persisted, no other side effect can duplicate
today — that safety net disappears the moment orders and entitlements are written.

### Email integration

Optional and self-gating: `EMAIL_SCRIPT_URL` (Google Apps Script `/exec` URL) plus
`EMAIL_SHARED_SECRET`, both checked for shape before use. Without them, purchase email throws
"not configured" and the caller reports `emailError` — checkout and downloads keep working.
Emailed links are minted with `STORE_ORIGIN` (production) and live **7 days**.

## 6. Current download behaviour

**`GET /api/download?token=…`**

- Requires `PAYSTACK_SECRET_KEY` and `BEATS_BUCKET`, else `500`.
- No token → `400`. Invalid/expired → `403` ("Invalid or expired download link").
- The token is `<base64url(json)>.<HMAC>` over `{ reference, productId|beatId, exp }`, keyed with
  **`PAYSTACK_SECRET_KEY`**. Verification checks signature, `exp` and the presence of the id and
  reference fields — **it performs no D1 lookup**. There is no order, no entitlement, no
  per-customer binding, no download counter, and no revocation. Possession of a valid token is
  the entire authorization.
- Consequence: **rotating `PAYSTACK_SECRET_KEY` silently invalidates every outstanding link**,
  and any leaked link is valid until it expires.
- It never touches the `price` or `category` of the product; `samples` and `studio-tools` are
  downloadable through the same endpoint.

**Package resolution — the important part.** `getZipObject()` does not simply read `zip_key`:

```js
const found = await findExistingR2Object(env, product, "zip_key");  // scans candidates
if (!found.key) return null;
if (product.zip_key !== found.key) {
  await env.DB.prepare("UPDATE beats SET zip_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(found.key, product.id).run();      // writes the discovered key back
}
return env.BEATS_BUCKET.get(found.key);
```

`repairStoredFileKey()` does the same for `artwork_key` / `preview_key`. So the ZIP a buyer
receives is **whatever resolves at request time**, and the resolution is itself persisted. The
same repair runs on `/api/media/*` and on publish (which requires artwork + package, plus preview
for beats, to resolve in R2).

Response: `Content-Type: application/zip`, `Content-Disposition: attachment` with
`safeFilename(title)`, `Cache-Control: private, no-store`. Missing object →
`404 "Download file not found in storage."`

## 7. Baseline preservation status (the key risks for Phase 1)

1. **Packages are addressed by a mutable key.** `beats.zip_key` can be rewritten by the
   self-healing lookup above, and uploads overwrite `beats/{id}.zip` in place. Replacing a
   package therefore **retroactively changes what every past buyer downloads**. Phase 1 must
   introduce immutable, versioned object keys and have entitlements pin the exact key resolved at
   grant time.
2. **`DELETE /api/admin/products/:id` hard-deletes R2 objects.** It loops over
   `artwork_key`, `preview_key`, `zip_key` and calls `BEATS_BUCKET.delete(key)` before deleting
   the row — with no reference check of any kind. This directly contradicts the approved rule
   "never automatically delete an R2 package referenced by an order item or entitlement", and it
   is reachable today.
3. **Replacement and removal are indistinguishable.** Upload = overwrite at a fixed key; delete =
   destroy the object. There is no "disable licence", no "replace package", no "remove reference
   only" distinction, and no way to keep historical purchase rights intact.
4. **Price is not snapshotted.** `getVerifiedPurchase()` recomputes the expected amount from
   live `beats.price`. Once tiers exist, editing a price would change what an in-flight or
   historical purchase verifies against.
5. **Legacy purchases cannot be reconstructed from D1.** Nothing persists a buyer, a reference
   or a product per transaction. Past entitlements exist only in Paystack's transaction history
   and in already-sent emails. If backfilled entitlements for past buyers are wanted, they must be
   sourced read-only from the Paystack API — it is not possible from the current database.
6. **Schema evolution is lazy and concurrent.** `beats` already carries three columns that no
   migration file created; production may or may not have them yet. Phase 1 migrations must be
   idempotent and must not assume a pristine schema — and should adopt `email_deliveries`
   explicitly instead of leaving it to request-path DDL.
7. **The store is not beats-only.** `samples` and `studio-tools` share the `beats` table and the
   same checkout and download path (`productItems` / `getRequestedProducts`). Licensing must
   exclude them by category rather than assume a beats-only store.

## 8. Production inspection gap — what Phase 0 could not do

No Cloudflare credentials are available in this environment (checked by name only:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_API_TOKEN` — all absent). The managed
secrets file contains only `ADMIN_PASSWORD` and `PAYSTACK_SECRET_KEY`. Therefore:

- **Not inspected:** production D1 schema, production row counts, production `beats.zip_key`
  values, whether production already has the three lazily-added columns, whether
  `email_deliveries` exists there, and the production R2 object inventory (which ZIP keys exist,
  which are orphans, which beats reference a package that is missing).
- **Inspected instead:** the repository's schema definition, the runtime DDL in
  `src/index.js`, and the sandbox's local D1/R2 emulation.

Read-only commands ready to run the moment credentials (or a read-only token) are supplied —
each is a `SELECT`/list only:

```bash
# schema
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name"

# catalogue + package references (the backfill input)
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT id, category, status, price, artwork_key, preview_key, zip_key FROM beats ORDER BY category, id"

# email delivery table existence / size
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT COUNT(*) AS rows FROM email_deliveries"

# R2 inventory (the CLI has no bucket listing; S3-compatible credentials required)
aws s3 ls --recursive s3://wagwanspark-beats --endpoint-url https://<account_id>.r2.cloudflarestorage.com
```

**Two questions that block a production read:**

1. Is the `wrangler.toml` `[env.production]` block correct? It reuses the **default**
   `database_id` and bucket, so today a "production" deploy and the default environment address
   the same D1 database and the same R2 bucket. If that is intended, fine; if production is
   meant to be isolated, the manifest is wrong and must be corrected before any migration planning.
2. Which database should the audit target — is `wagwanspark-beats-db`
   (`92e11314-8f64-4719-ae7c-e7dde302ac13`) the live production database, or does the live site
   use a different account/database that this manifest never names?

## 9. Migration recovery — the distinction, documented now

This is written down in Phase 0 so it cannot be blurred later:

- **Code rollback ≠ database rollback.** Reverting or redeploying the previous Worker version
  restores application behaviour only. D1 keeps every table, column and row the migration
  created, and R2 keeps every object written. There is no automatic undo.
- Planned Phase 1 recovery shape (to be executed only after explicit approval): take a full
  `wrangler d1 export --remote --output before-licensing.sql` snapshot and record row counts
  before touching anything; keep every migration **additive** (new tables, nullable new columns,
  no drops, no renames); gate new code paths behind a flag so the previous behaviour remains
  reachable; treat "rollback" as *deploy previous Worker + leave the additive schema in place*,
  and treat a destructive revert as a separate, explicitly approved operation with its own
  restore-from-export procedure.
- R2 is the part that cannot be undone by a database restore. This is precisely why versioned,
  immutable package keys and a "never delete a referenced package" guard must land **before** any
  new purchase can be recorded.

## 10. Approved decisions carried into the implementation plan

Locked, as confirmed, and reflected in the phase map below: stable licence keys `mp3`,
`mp3_wav`, `stems`, `exclusive` with customer labels MP3 License, MP3 + WAV License, Stems
License, Exclusive License; backfill preserves each beat's current price and valid ZIP as the
legacy-equivalent licence with **only** that tier enabled, flagging missing/invalid packages for
manual review and enabling nothing else; 48-hour exclusive reservation TTL; a licence may return
to available only after verifying no active reservation and no completed exclusive sale exists;
referenced R2 packages are never automatically deleted; in-panel admin offer inbox plus email
notifications when the existing email integration is configured; atomic expiry-release-then-
reserve; a completed exclusive sale permanently blocks further reservations and purchases;
entitlement authorization validates verified order + customer entitlement + beat + licence +
exact versioned object key; existing download links and legacy purchase behaviour preserved;
webhook retries cannot duplicate orders, entitlements, exclusive sales or email deliveries;
conflicting exclusive payments surface as an explicit manual-refund list and the exclusive
package is never delivered to two customers; licence disabling, package replacement and
package-reference removal are distinct admin operations with historical rights intact;
migration recovery documented with code rollback separated from database rollback.

### Phase map (unchanged)

| Phase | Content | Gate |
| --- | --- | --- |
| **0** | Branch, baseline, schema/R2 audit, behaviour documentation | **this document** |
| 1 | Schema + migrations (licences, orders, order items, entitlements, exclusivity, reservations, event log) and legacy backfill, additive and idempotent | after Phase 0 approval |
| 2 | Server-side licence validation and order creation at checkout | |
| 3 | Entitlement-gated downloads pinned to exact versioned keys; legacy links preserved | |
| 4 | Paystack webhook → order/entitlement/exclusive-sale materialization with idempotency and conflict detection | |
| 5 | Exclusive reserve / release / expired-offer handling, 48 h TTL, permanent lock after sale | |
| 6 | Admin: licence management, distinct disable/replace/remove actions, offer inbox, package guards | |
| 7 | Email notifications, manual-refund queue surfacing, runbook and recovery drill | |

## 11. What Phase 0 did not change

No source code, schema, migration, seed, secret, production data or deployment was modified. The
only additions on this branch are this document and the branch itself.
