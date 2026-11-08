# Phase 2 — checkout validation and order creation

Status: implemented on `feature/licensing-phase-2`; not merged or deployed.

## Implementation

`src/phase2-worker.js` adds a separate `POST /api/create-order` licensing-aware order endpoint and delegates all other requests to the original Worker in `src/index.js`. The Wrangler entry point is the wrapper. The endpoint accepts `email` and an `items` array of `{ beat_id, licence_key }` selections, validates published beat-category products and enabled catalogue/offering records, rejects beats with an existing exclusive sale, and obtains price, title, label and exact package key from D1. Browser-supplied price/total fields are ignored.

Input limits: JSON body at most 16 KiB, 1–25 items, beat ID at most 80 characters, licence key at most 64 characters, and email at most 254 characters. Duplicate beat/licence pairs and invalid email are rejected. Orders start pending, `orders.amount` is stored in kobo, and order-item prices are in NGN. Random IDs/references use Web Crypto. No entitlements are issued.

## API

Request:

```json
{
  "email": "buyer@example.com",
  "items": [
    { "beat_id": "beat-a", "licence_key": "mp3" },
    { "beat_id": "beat-b", "licence_key": "stems" }
  ]
}
```

Success returns HTTP 201 with `order`, `items`, `total`, `amount`, `currency`, `reference`, and `itemCount`. Validation failures return HTTP 400 with a customer-safe error. Database failures return a generic HTTP 500 response.

## Atomicity and D1 compatibility

Order and item inserts are parameterized prepared statements submitted in one `env.DB.batch(statements)` call. Cloudflare documents `D1Database.batch()` as sequential execution in one transaction; on a failed statement, the complete batch rolls back. The implementation uses the D1 binding's supported `prepare`, `bind`, and `batch` APIs and does not issue explicit transaction-control SQL. It checks that the batch returned one successful change result for each requested insert.

The automated test adapter uses an in-memory SQLite database and implements the same transaction contract. The failure test injects an error on the second item insertion, after the order and first item statement have run in the test transaction, and asserts both tables contain no rows afterward. This validates rollback logic in the adapter but is not a live Cloudflare D1 integration test.

Snapshot coverage creates the order first using the original offering, then changes the beat title, licence label, price, and package key. It verifies the stored item retains every original snapshot field.

## Compatibility and scope

The wrapper handles only `POST /api/create-order`; all other requests delegate to the existing Worker unchanged. Source review confirms `/api/create-payment`, `/api/verify-payment`, `/api/paystack-webhook`, email-delivery handling, and download-token generation/validation remain in the legacy Worker and are not rewritten by this endpoint. The new endpoint does not call Paystack, issue entitlements, create exclusivity reservations, or write/delete R2 objects. Exclusive sale records are read only to reject already-sold beats.

No migrations are added or run. No production D1, customer data, payment credentials, or R2 objects are modified by this implementation.

## Tests and checks

The project test command is `npm test` (`node --test tests/*.test.mjs`), which includes Phase 1 migration tests and Phase 2 checkout tests. The Phase 2 coverage includes valid single/multi-item orders, price manipulation, unknown beat/licence, disabled/unavailable licence, missing package, invalid price, duplicates, exclusive sale, invalid email, atomic batch failure, immutable snapshots, and unique references.

**Execution status for this change:** the GitHub repository tools available in this session can edit and inspect repository files but do not provide a shell/test runner. Therefore `npm test` and a local Wrangler/Cloudflare D1 integration test could not be executed here. Do not treat either test result as passing until the commands are run in a project checkout/runtime.

## Unresolved checks and Phase 3

Before deployment, run `npm test` in the repository's supported Node runtime and, when available, exercise the endpoint with a local Wrangler D1 binding. A remote production test is intentionally not performed. Phase 3 remains responsible for Paystack initialization, verification/webhook handling of licensing orders, order status transitions, idempotency, and entitlement issuance. Licensing-specific email/download fulfillment is not included in Phase 2.
