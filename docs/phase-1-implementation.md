# Phase 1 — Licensing foundation

**Status: complete on `feature/tiered-licensing`. Not merged. Not deployed.**

Base commit: `7d6ec79aab2f22c98065b82d7a9b5563e89480f8` (`main`).

Nothing in this phase is read by the running Worker, so customer-facing
behaviour is unchanged. Everything below marked *done* exists in this branch;
everything marked *planned* does not exist yet, in code or in the database.

---

## 1. What has been implemented — done

### Schema (`migrations/0001_licensing_schema.sql`, additive)

Reference data:

- `licences` — the four stable keys with customer-facing labels: `mp3`
  (sort 1), `mp3_wav` (sort 2), `stems` (sort 3), `exclusive` (sort 4, flagged
  `is_exclusive = 1`). Seeded with `INSERT OR IGNORE`.

Per-beat offerings:

- `beat_licences` — one row per beat × tier: `price`, the exact `package_key`
  the tier grants, `enabled`. A CHECK constraint refuses an enabled row with no
  positive price or no package key; a disabled row may hold neither.

Orders and rights:

- `orders` — Paystack reference is `UNIQUE`, which is the primary duplicate
  guard for webhook retries and repeated verify calls. Amounts in kobo.
- `order_items` — immutable snapshot of the purchase (title, licence label,
  price, package key), so later price edits cannot rewrite history. Unique per
  `(order_id, beat_id, licence_key)`.
- `entitlements` — what a customer may download. Unique per `(reference,
  beat_id, licence_key)` and unique per `order_item_id`.
- `webhook_events` — Paystack event identity as primary key, for at-most-once
  processing of retried deliveries.

Exclusivity:

- `exclusive_sales` — `beat_id` is the PRIMARY KEY, so a completed exclusive
  sale permanently blocks every later sale of that beat.
- `exclusive_reservations` — 48-hour hold. A **partial unique index** on
  `status = 'active'` per beat is the atomicity guarantee: expire-then-reserve
  is one transaction that fully succeeds or fully fails.
- `exclusive_offers` — the negotiation inbox for the admin panel.

Audit and adoption:

- `licence_events` — append-only log (`entity_type`, `entity_id`,
  `event_type`, `actor`, JSON `payload`).
- `email_deliveries` — adopted with an unchanged shape. It was previously
  created by request-path DDL.
- `licence_backfill_issues` — the manual-review queue for backfill exceptions.

### Backfill (`migrations/0002_backfill_legacy_licence.sql`, additive)

- Every `category = 'beats'` row with a `zip_key` and a positive price gets
  exactly **one** enabled tier: `mp3_wav`, carrying that row's current price and
  its current `zip_key` verbatim.
- `mp3_wav` is used because the storefront advertises "MP3 + WAV" on every
  product card and product page, and the API returns `formats: ["MP3", "WAV"]`.
- Beats with no `zip_key` (NULL or blank) are recorded as `missing_package` and
  **not** enabled.
- Beats with a package but a non-positive price are recorded as
  `invalid_price` and **not** enabled.
- `samples` and `studio-tools` rows are deliberately outside the backfill: no
  licence row and no issue row is written for them.
- No R2 object is read, written or deleted.

### Runbook

- `docs/migrations.md` — apply procedure, pre-flight export/counts,
  post-apply verification queries, and the recovery runbook that separates a
  code rollback from a database rollback.

### Local setup

- `.base44/dev-setup.sh` now applies the migrations after seeding, so a fresh
  sandbox has the tables.

---

## 2. What has been verified — done

Verified in the sandbox against a local D1 and against in-memory SQLite in the
test suite:

- Both migrations apply cleanly (`0001`: 25 statements, `0002`: 4 statements).
- Four licence keys seeded with the intended labels, order and
  `is_exclusive` flag.
- Legacy beats mapped to `mp3_wav` with their own price and package key
  (probe beat: 5000 → `mp3_wav` / 5000 / exact key).
- Beats without a package flagged `missing_package`; beats with a non-positive
  price flagged `invalid_price`; neither receives an enabled licence.
- Enabled-but-package-less and enabled-with-zero-price rows rejected by the
  CHECK constraint.
- Second active reservation for one beat rejected by the partial unique index;
  the slot frees when the reservation is released.
- Second exclusive sale for one beat rejected by the primary key.
- Duplicate Paystack reference rejected; duplicate entitlement for the same
  purchase rejected.
- `beats`, `samples`, `studio-tools` and existing `email_deliveries` rows
  unchanged after migration.
- Idempotency: both migrations re-run — no duplicate licences, no duplicate
  offerings, no duplicate issues, no changed rows.
- Existing HTTP surface unchanged: `/api/products?category=beats` 200, `/` 200,
  `/api/download?token=<invalid>` 403.
- `.base44/dev-setup.sh` re-runs end to end (schema → seed → migrations → R2
  uploads), exit 0.

---

## 3. Tests added — done

`tests/phase1-migrations.test.mjs` — 19 tests, Node's built-in test runner and
built-in `node:sqlite`, no dependencies, no Wrangler, no network.

```bash
npm test                                  # node --test tests/*.test.mjs
# or, on the host, inside the container:
docker compose -f docker-compose.base44.yml exec -T store npm test
```

Result: **19 passed, 0 failed** (≈0.28 s).

Coverage:

| Test | Asserts |
| --- | --- |
| seeds exactly the four stable licence types | keys, labels, order, exclusive flag |
| running the schema migration twice keeps one row per licence type | seed idempotency |
| creates the core licensing tables and the supporting tables | 11 tables + `email_deliveries` |
| exposes the columns later phases depend on | column presence per table |
| backfills each legacy beat onto mp3_wav with its own price and zip key | exact mapping |
| enables exactly one tier per backfilled beat | no extra tiers |
| flags beats with no package reference instead of enabling them | `missing_package`, no licence |
| flags a beat whose price is not positive rather than granting a free tier | `invalid_price` |
| leaves samples, studio tools and every existing beat row unchanged | scope containment |
| leaves existing email delivery records untouched | adoption is non-destructive |
| refuses an enabled licence with no package | CHECK |
| refuses an enabled licence without a positive price | CHECK |
| refuses a second row for the same beat and licence | composite PK |
| allows a disabled placeholder row without price or package | CHECK exemption |
| holds at most one active reservation per beat, and frees the slot on release | partial unique index |
| permits only one exclusive sale per beat, permanently | `beat_id` PK |
| treats the Paystack reference as unique on orders | duplicate-payment guard |
| prevents duplicate entitlements for the same purchase | entitlement uniqueness |
| is idempotent: running both migrations three times changes nothing | full-state comparison |

### Not tested, deliberately

The storefront, cart, Paystack checkout and verification, webhook handling and
download routes are **not** integrated with these tables yet. No
application-level licensing behaviour — pricing enforcement, entitlement
issuance, download authorisation, exclusivity — has been exercised, and nothing
in this phase should be read as evidence that it works. Those paths begin in
Phase 2.

---

## 4. Known limitations and outstanding risks — open

1. **Production database identity is unconfirmed.** `wrangler.toml` declares the
   same `database_id` and R2 bucket under the default environment and
   `[env.production]`. Applying a migration to the wrong database is not undone
   by redeploying code. Must be settled before any remote apply.
2. **Beats flagged `missing_package` have no purchasable tier.** All three demo
   beats land here locally, because demo rows carry no `zip_key`. The Worker can
   still resolve a package through its legacy key-candidate scan
   (`mediaKeyCandidates` in `src/index.js`), and only R2 can confirm whether the
   object exists — so this needs a human decision, not an automatic grant.
3. **Legacy `package_key` values are unversioned and mutable.** Overwriting an
   object in R2 still changes what a historical entitlement would grant.
   Immutability depends on versioned keys, which arrive with a later phase.
4. **Migration order on a fresh database.** `0002` reads `beats`, which the
   migrations do not create; the schema must exist first. On an empty database
   the migration fails loudly rather than silently backfilling nothing.
5. **Foreign keys are declared but not enforced** by SQLite/D1 by default, so
   referential integrity between `order_items`/`orders`/`entitlements` is the
   application's responsibility.
6. **Timestamps must stay in `YYYY-MM-DD HH:MM:SS` UTC.** Later code must not mix
   ISO-8601 `T`/`Z` strings into these columns, or `expires_at <=
   CURRENT_TIMESTAMP` comparisons break.
7. **The legacy tier choice is unconfirmed by the owner.** `mp3_wav` is inferred
   from the storefront and API advertising "MP3 + WAV". If the existing ZIPs
   actually contain stems, the backfill mapping is wrong and is a one-line
   change in `0002`.

---

## 5. What remains — planned, not started

**Phase 2 — checkout validation and order creation.** Server-side licence and
price resolution for a licence-aware cart; create `orders` + `order_items` with
snapshots; reject client-supplied prices.

**Phase 3 — payment verification, webhook and entitlements.** Idempotent
verification via `webhook_events` and the unique reference; entitlement
issuance; keep the legacy HMAC download path working alongside it.

**Phase 4 — download authorisation by entitlement.** Grant downloads from
`entitlements` rather than price/`zip_key` alone, with an expiry and retry
policy, without breaking existing links.

**Phase 5 — admin licence management.** Edit price/package per tier, add or
disable tiers, replace packages with new versioned keys, and distinguish
disabling a licence from replacing a package from removing a reference.

**Phase 6 — product page and cart integration.** Tier selection UI, per-tier
pricing, and the cart carrying `(beat_id, licence_key)`.

**Phase 7 — exclusivity and negotiation.** 48-hour reservations, the offer
inbox, admin accept/decline, notification email, and the permanent lock once an
exclusive sale completes.

Each phase needs its own review and, before anything reaches a real database,
the deployment gate in `docs/migrations.md`.
