# Migrations & Recovery Runbook

This repository had **no migration system** before Phase 1: the schema was created
lazily by the Worker at request time (`ensurePublishedAtColumn`,
`ensureFeaturedPositionColumn`, `ensureCataloguePositionColumn`, and the
`CREATE TABLE IF NOT EXISTS email_deliveries` inside the purchase-email path).
From Phase 1 on, licensing tables are owned by versioned migrations under
`migrations/`, applied with Cloudflare's own D1 migration runner.

> Phase 1 status, scope, test results and the remaining phases are recorded in
> [`docs/phase-1-implementation.md`](phase-1-implementation.md).

## Current migrations

| File | Kind | Effect |
| --- | --- | --- |
| `0001_licensing_schema.sql` | schema, additive | Creates `licences`, `beat_licences`, `orders`, `order_items`, `entitlements`, `exclusive_sales`, `exclusive_reservations`, `exclusive_offers`, `licence_events`, `webhook_events`, `licence_backfill_issues`; adopts `email_deliveries`; seeds the four licence keys. |
| `0002_backfill_legacy_licence.sql` | data, additive | Grants each `category = 'beats'` row its existing price and `zip_key` under `mp3_wav`; records exceptions in `licence_backfill_issues`. |
| `0004_unified_checkout.sql` | schema, additive, single-run | Adds `category` and `package_version` to `order_items` and `entitlements`, plus an index on `entitlements (order_item_id)`. |

`0001` and `0002` are **additive and idempotent**: `CREATE TABLE IF NOT EXISTS`,
`INSERT OR IGNORE`, no `DROP`, no `ALTER` of existing columns, no R2 writes.
Re-running `0002` is a no-op.

`0004` is additive but **not re-runnable**: `ALTER TABLE ... ADD COLUMN` has no
`IF NOT EXISTS` in SQLite, so it must go through the D1 migration runner exactly
once. It adds only nullable or defaulted columns — `category` defaults to
`'beats'`, which is what every pre-0004 row already was — so no existing row is
rewritten and a code rollback does not require undoing it.

> There is no `0003_*.sql` in this repository. The number was reserved for an
> exclusive-inventory migration that is not present on any branch; `0004` keeps
> that slot free. Gaps are harmless — D1 applies migrations in filename order.
>
> **Audited (Phase 4 follow-up).** Nothing is missing: the exclusive-inventory
> schema was consolidated into `0001_licensing_schema.sql` rather than split into
> a `0003`. That file creates `exclusive_sales` (PRIMARY KEY on `beat_id`, the
> row that permanently blocks a resale), `exclusive_reservations` with the
> partial unique index `idx_exclusive_reservations_active` that makes "at most one
> active hold per beat" atomic, `exclusive_offers`, and `licence_events`. The
> rules those tables enforce live in `src/licensing-inventory.js` and are applied
> at order creation, payment start and fulfilment. No `0003` file is needed, and
> none was applied anywhere: local `d1_migrations` records exactly `0001`,
> `0002`, `0004`.

## Local demo packages (development only, not a migration)

`GET /api/beat-licences` returned `[]` in the sandbox because the demo beats were
seeded with `zip_key = NULL`, so `0002` recorded them in
`licence_backfill_issues` and granted no tier. The fix is in the seed, not in a
migration — `migrations/` is unchanged:

1. `.base44/demo-products.sql` gives each demo beat the versioned key
   `beats/<id>-v1.zip`, and fills that key on an existing row only when it is
   still empty (a set key is never repointed).
2. `.base44/demo-packages.mjs` builds the matching archive — deterministic
   STORED ZIP of the preview audio plus a licence note — so the key names a real
   object rather than an invented path.
3. `.base44/dev-setup.sh` uploads those archives **before** `wrangler d1
   migrations apply`, skips a put when the object already exists, then re-runs
   `0002` (idempotent) and applies `.base44/demo-licences.sql`, which withdraws
   the now-resolved `missing_package` exceptions. That re-run repairs a sandbox
   whose `0002` had already been recorded as applied.

Production is unaffected: none of this runs against a remote database.

## Running them

```bash
# local sandbox (safe, always allowed)
docker compose -f docker-compose.base44.yml exec -T store \
  sh -c 'npx wrangler d1 migrations apply DB --local --persist-to /data/state'

# inspect what is applied
docker compose -f docker-compose.base44.yml exec -T store \
  sh -c 'npx wrangler d1 migrations list DB --local --persist-to /data/state'
```

Production is **gated**: nothing in this branch may be applied to a remote
database until the implementation has been reviewed and deployment explicitly
approved. When that approval exists the command is:

```bash
wrangler d1 migrations apply wagwanspark-beats-db --remote
```

> Before running it, confirm which database is actually production. `wrangler.toml`
> currently declares the **same** `database_id` and R2 bucket under the default
> environment and `[env.production]`, which may be a copy-paste error. Applying a
> migration to the wrong database is not reversible by redeploying code.

## Pre-flight (run immediately before any remote apply)

```bash
# 1. Full logical backup — the only thing that makes a real restore possible.
wrangler d1 export wagwanspark-beats-db --remote --output before-licensing-$(date +%Y%m%d-%H%M).sql

# 2. Record the baseline counts. Keep the output; you will compare against it.
wrangler d1 execute wagwanspark-beats-db --remote --command "SELECT category, COUNT(*) AS n FROM beats GROUP BY category"
wrangler d1 execute wagwanspark-beats-db --remote --command "SELECT COUNT(*) AS with_zip FROM beats WHERE zip_key IS NOT NULL AND TRIM(zip_key) <> ''"
wrangler d1 execute wagwanspark-beats-db --remote --command "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table'"
```

## Post-apply verification

```bash
# the four licence keys exist with the agreed labels
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT licence_key, label FROM licences ORDER BY sort_order"

# exactly one enabled tier per beat, matching the beat's current price
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT b.id, b.price AS beat_price, l.price AS licence_price, l.package_key
             FROM beats b LEFT JOIN beat_licences l ON l.beat_id = b.id AND l.enabled = 1
             WHERE b.category = 'beats' ORDER BY b.id"

# nothing was silently skipped
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT issue, COUNT(*) AS n FROM licence_backfill_issues GROUP BY issue"

# 0004: every pre-existing order item is still a beat, and the item/entitlement
# counts are exactly what the backup recorded
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT COUNT(*) AS n, SUM(category = 'beats') AS beats FROM order_items"
wrangler d1 execute wagwanspark-beats-db --remote \
  --command "SELECT COUNT(*) AS n FROM entitlements"
```

Expected: every beat has at most one enabled licence; `licence_price` equals
`beat_price`; every beat either has an enabled licence or a row in
`licence_backfill_issues`. Anything else is a stop-and-review condition.

## Recovery — code rollback is NOT a database rollback

This distinction is the whole point of this section.

| Action | What it restores | What it does **not** restore |
| --- | --- | --- |
| Revert the Worker commit and redeploy the previous version | Application behaviour only | The database. Every table, column and row the migration created **stays**. R2 objects stay. |
| `wrangler rollback` / redeploying an earlier Worker version | Application behaviour only | Same as above. |
| Restoring the pre-migration D1 export | Database contents as of the export | Anything written to D1 after the export, and **nothing** in R2. |
| Restoring R2 | Nothing in D1 | — |

Consequences to state plainly in any incident review: after a code rollback the
new tables remain in place and keep accumulating any rows the old code path
writes (it writes none, because the pre-Phase-1 code never touches them). A code
rollback is therefore the **safe, expected** way to back out this work. A schema
rollback is a separate, destructive operation.

### Because Phase 1 is additive, the standing recovery position is

1. **Roll back the code**, leave the schema alone. Nothing breaks: the old code
   ignores the new tables.
2. Only if the schema itself must go, treat it as a destructive change that needs
   its own approval and its own restore-from-export procedure:

   ```sql
   -- DESTRUCTIVE. Never run without an export and explicit approval.
   -- Dropping order_items/entitlements/exclusive_sales destroys purchase
   -- history; dropping licences destroys configuration.
   DROP TABLE IF EXISTS licence_events;
   DROP TABLE IF EXISTS webhook_events;
   DROP TABLE IF EXISTS exclusive_offers;
   DROP TABLE IF EXISTS exclusive_reservations;
   DROP TABLE IF EXISTS exclusive_sales;
   DROP TABLE IF EXISTS entitlements;
   DROP TABLE IF EXISTS order_items;
   DROP TABLE IF EXISTS orders;
   DROP TABLE IF EXISTS beat_licences;
   DROP TABLE IF EXISTS licences;
   DROP TABLE IF EXISTS licence_backfill_issues;
   -- email_deliveries is NOT dropped: it predates Phase 1 and holds real
   -- delivery state that the pre-Phase-1 code depends on.
   ```

3. Restoring from the export is the escalation path, and it is **not** a
   rollback: it discards every row written after the snapshot. Record the
   timestamp of the export, and reconcile any real purchases made in between
   from Paystack before restoring.

### What cannot be undone at all

**R2.** A deleted or overwritten package object cannot be recovered from a
database restore. This is why versioned, immutable package keys and the
"never delete a referenced package" guard must be in place *before* real orders
exist in these tables — and why Phase 1 writes no R2 objects and deletes none.

## Approval checklist before any remote run

- [ ] Which database is production confirmed (`wrangler.toml` `[env.production]`
      currently reuses the default `database_id`).
- [ ] `wrangler d1 export` snapshot taken and stored.
- [ ] Baseline row counts recorded.
- [ ] `licence_backfill_issues` reviewed after apply — beats listed there have no
      enabled tier and are not purchasable under the new flow until resolved.
- [ ] Rollback plan agreed as *code rollback + additive schema retained*.
