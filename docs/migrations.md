# Migrations & Recovery Runbook

This repository had **no migration system** before Phase 1: the schema was created
lazily by the Worker at request time (`ensurePublishedAtColumn`,
`ensureFeaturedPositionColumn`, `ensureCataloguePositionColumn`, and the
`CREATE TABLE IF NOT EXISTS email_deliveries` inside the purchase-email path).
From Phase 1 on, licensing tables are owned by versioned migrations under
`migrations/`, applied with Cloudflare's own D1 migration runner.

## Current migrations

| File | Kind | Effect |
| --- | --- | --- |
| `0001_licensing_schema.sql` | schema, additive | Creates `licences`, `beat_licences`, `orders`, `order_items`, `entitlements`, `exclusive_sales`, `exclusive_reservations`, `exclusive_offers`, `licence_events`, `webhook_events`, `licence_backfill_issues`; adopts `email_deliveries`; seeds the four licence keys. |
| `0002_backfill_legacy_licence.sql` | data, additive | Grants each `category = 'beats'` row its existing price and `zip_key` under `mp3_wav`; records exceptions in `licence_backfill_issues`. |

Both are **additive and idempotent**: `CREATE TABLE IF NOT EXISTS`,
`INSERT OR IGNORE`, no `DROP`, no `ALTER` of existing columns, no R2 writes.
Re-running `0002` is a no-op. Neither migration is read by the running Worker
until a later phase ships code that uses the tables — so applying them changes
no customer-facing behaviour.

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
