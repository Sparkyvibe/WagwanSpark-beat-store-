# Phase 3 — licensing payment, fulfilment and entitlement downloads

Status: implemented on top of Phase 2 (`feature/licensing-phase-2`); not merged
or deployed. No migration, no production D1/R2 change, and no legacy route was
rewritten.

## Why

Phase 2 creates pending licensing orders but nothing could pay for them or grant
rights afterwards, and the legacy webhook would have rejected a licensing
reference (its `getVerifiedPurchase` expects legacy `productIds` metadata).
Phase 3 closes that gap.

## Implementation

`src/phase3-worker.js` is the Worker entry (`wrangler.toml` `main`). It routes
licensing requests to `src/licensing-checkout.js` and delegates everything else
to `src/phase2-worker.js`, which in turn delegates to `src/index.js`. The
existing wrapper chain is preserved; no file from Phase 2 or the legacy worker
was modified.

A request is only treated as licensing when its reference exists in the
`orders` table written by Phase 2. Legacy purchases keep their exact previous
behaviour, including the webhook and verified-payment email fallback.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/licensing/create-payment` | Start (or replay) the Paystack transaction for a pending order |
| POST | `/api/paystack-webhook` | Fulfil licensing orders, then delegate unknown references to the legacy handler |
| GET | `/api/verify-payment` | Webhook fallback for licensing orders, then delegate unknown references |
| GET | `/api/licensing/download?token=…` | Stream the exact R2 package an entitlement granted |

`create-payment` accepts `{ order_id }` or `{ reference }`. The Paystack amount
is the stored `orders.amount` (kobo); no amount, price or licence label from the
browser is trusted. A duplicate call returns the first `authorization_url`
recorded in `licence_events` instead of opening a second transaction. Orders
that are no longer `pending`, orders with no items, and beats already sold
exclusively are refused.

### Fulfilment

Shared by the webhook and the verify fallback:

1. Verify the transaction with Paystack; require `status === 'success'`, the
   same reference, the same currency and an amount equal to `orders.amount`.
2. Conditionally move the order `pending → paid`.
3. Grant one `entitlements` row per order item (`INSERT OR IGNORE` on the
   `(reference, beat_id, licence_key)` unique index).
4. Insert the `exclusive_sales` row for an `exclusive` licence; if another order
   won that race, the whole batch rolls back and the paid order is parked as
   `manual_review` with an `exclusive_conflict` event instead of granting rights
   the catalogue already sold.
5. Append `order_paid` to `licence_events`.

Idempotency: `webhook_events.event_key` (`paystack:<transaction id>`) is claimed
with `INSERT OR IGNORE`, so a retried delivery returns `duplicate: true` and
grants nothing new; the verify fallback is safe to call repeatedly for the same
reason. D1 `batch()` supplies the transaction boundary.

### Downloads

`/api/licensing/download` verifies an HMAC-signed token (30 minutes, issued by
`/api/verify-payment`), then looks up the entitlement by
reference + beat + licence key and streams `entitlements.package_key` from R2.
A forged token is 401, a revoked/inactive entitlement is 403, a missing object
is 404. The package key comes from the entitlement snapshot, never from the
request.

## Not included (next slices)

- Purchasing email for licensing orders (the legacy
  `sendPurchaseEmail`/`deliverPurchaseEmailOnce` path is untouched and unused
  here) and 7-day email download tokens.
- Storefront/admin UI that calls `create-payment`; the endpoints are inert until
  a page uses them.
- Exclusive reservations/offers (`exclusive_reservations`, `exclusive_offers`)
  and any order-refund/admin transition tooling.

## Verification

```
docker compose -f docker-compose.base44.yml exec -T store node --test tests/*.test.mjs
```

43 tests pass (Phase 1 migrations, Phase 2 order creation, Phase 3 payment,
fulfilment, idempotency, exclusive conflict, downloads, legacy webhook
delegation). The Paystack calls are stubbed in tests; no live Paystack request
is made. Manually checked in the sandbox: the storefront and the Phase 2
`POST /api/create-order` still respond normally through the new entry point,
`create-payment` returns 404 for an unknown order, the webhook returns 401 for a
bad signature, and the download route returns 400 without a token.
