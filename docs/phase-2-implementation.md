# Phase 2 — checkout validation and order creation

Status: implemented on `feature/licensing-phase-2`; not merged or deployed.

## Implementation

`src/phase2-worker.js` adds a separate `POST /api/create-order` licensing-aware order endpoint and delegates all other requests to the original Worker in `src/index.js`. The Worker entry point in `wrangler.toml` now points at this wrapper. The legacy payment initialization, verification, webhook, email delivery, and download-token handlers are not replaced or routed through the new order flow.

The endpoint accepts `email` and `items`, with each item containing `beat_id` and `licence_key`. It validates each beat as a published beat-category product, checks the licence catalogue and per-beat offering, rejects sold-exclusive beats, and resolves price, title, label, and exact package key from D1. Browser-supplied price and total fields are ignored. Item count is limited to 25, IDs and licence keys are length/form constrained, duplicate `(beat_id, licence_key)` pairs are rejected, email is limited to 254 characters, and the complete JSON request is limited to 16 KiB.

Successful orders are stored pending with `orders.amount` in kobo (NGN × 100) and `order_items.price` in NGN. Cryptographically random IDs and unique-index-protected references are generated. Item records preserve beat title, licence key and label, price, and package key snapshots. No entitlements are issued.

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

Success response (HTTP 201) contains `success`, `order` (including generated ID/reference, NGN currency, kobo amount, NGN total and pending status), `items` (snapshot rows), and top-level `reference`, `total`, `amount`, `currency`, and `itemCount`. Validation errors are HTTP 400 with a customer-safe `error`; D1 failures return a generic HTTP 500 response.

## D1 transaction strategy

All inserts are prepared with bound parameters and submitted together through `env.DB.batch(statements)`. This is Cloudflare D1's supported batch API; D1 executes the statements sequentially inside a transaction, and a failed statement rolls back the batch. The implementation verifies the batch result count and each statement's change count, and returns a generic error if batch execution fails. No manual `BEGIN`, `COMMIT`, or `ROLLBACK` SQL is used.

Tests use an in-memory SQLite-backed D1 API adapter whose `batch()` method wraps the statements in a SQLite transaction and deliberately fails on an `order_items` insert to verify rollback. This exercises the application contract, but is not a live Cloudflare deployment test; compatibility relies on D1's documented `D1Database.batch()` behavior.

## Compatibility and scope

The new endpoint is separate from `/api/create-payment`. Requests not targeting the new endpoint are forwarded unchanged to the original Worker, preserving existing payment initialization/verification, Paystack webhook, purchase email, and download-token behavior. The endpoint does not call Paystack, issue entitlements, reserve exclusivity, alter package keys, or change R2 objects. Exclusive sale records are checked only to reject already-sold beats.

No migrations are added or run. No production D1 or customer data is accessed or modified by this implementation.

## Tests

Run the full suite with `npm test`. Phase 2 tests cover valid single/multi-item orders, price manipulation, unknown beat/licence, disabled/unavailable licence, missing package, invalid price, duplicate selections, exclusive sale, invalid email, atomic batch failure, immutable snapshots after post-order catalogue edits, and unique references. Test execution results must be recorded after running the command; repository API access does not provide a test runner.

## Remaining for Phase 3

Phase 3 must connect pending licensing orders to Paystack initialization, verified payment/webhook processing, status transitions, idempotency, and entitlement creation. Licensing-specific email/download fulfillment is not implemented here.
