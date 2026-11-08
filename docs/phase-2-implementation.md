# Phase 2 — checkout validation and order creation

Status: implemented for `feature/licensing-phase-2`, not merged, not deployed.

## What was implemented

This phase adds a licensing-aware checkout path that validates each customer selection server-side, resolves prices only from D1, and creates an atomic `orders` + `order_items` record set with immutable snapshot data.

Key behaviour:

- Accepts a validated customer order payload with one or more `(beat_id, licence_key)` pairs.
- Confirms each beat exists in `beats`, is published, and is not already sold exclusively.
- Resolves each requested licence from `licences` and `beat_licences`.
- Rejects unknown, disabled, unavailable, invalid-price, or missing-package selections.
- Ignores any browser-supplied price or total values and recalculates from D1 data.
- Creates a unique pending order with a generated reference and order items that store the exact beat title, licence label, price, and package key used at purchase time.
- Uses a D1 transaction to guarantee that the order and all items are created together, or nothing is created.

## Endpoint(s)

Added endpoint(s):

- `POST /api/create-order`
- `POST /api/checkout`
- `POST /api/checkout/validate`
- `POST /api/checkout/licensing`
- `POST /api/create-licensing-order`
- `POST /api/licensing-order`

A request can send either a single item or an array named `items`, `selections`, `licenses`, or `licenceSelections`. The code also accepts one-off pair fields such as `beat_id` + `licence_key`.

## Request format

Example request body:

```json
{
  "email": "buyer@example.com",
  "items": [
    { "beat_id": "beat-a", "licence_key": "mp3" },
    { "beat_id": "beat-b", "licence_key": "stems" }
  ]
}
```

Response format on success:

```json
{
  "success": true,
  "status": true,
  "order": {
    "id": "ord_...",
    "reference": "WS-...",
    "email": "buyer@example.com",
    "currency": "NGN",
    "amount": 450000,
    "total": 4500,
    "status": "pending"
  },
  "items": [
    {
      "id": "item_...",
      "order_id": "ord_...",
      "beat_id": "beat-a",
      "beat_title": "Beat A",
      "licence_key": "mp3",
      "licence_label": "MP3 License",
      "price": 4500,
      "package_key": "beats/beat-a-mp3.zip"
    }
  ],
  "total": 4500,
  "amount": 450000,
  "currency": "NGN",
  "reference": "WS-...",
  "itemCount": 1
}
```

Validation errors return a `400` response with a short customer-safe message, for example:

```json
{
  "success": false,
  "status": false,
  "error": "Licence mp3 is unavailable for beat beat-a."
}
```

## Validation rules

- `email` must be a syntactically valid address.
- `items` must be an array of 1 to 25 entries.
- No duplicate `(beat_id, licence_key)` pair is allowed in a single order.
- Each beat must exist in `beats`, be `status = 'published'`, and belong to the `beats` category.
- Each requested licence must exist in `licences` and be `enabled = 1`.
- Each `(beat_id, licence_key)` pair must exist in `beat_licences` and be `enabled = 1`.
- `beat_licences.price` must be a positive integer.
- `beat_licences.package_key` must be present and non-empty.
- The same beat cannot be purchased if `exclusive_sales.beat_id` already has a row.
- The total is computed from D1 only; browser-provided totals or prices are ignored.

## Order/reference lifecycle

- A new random order ID is generated for each order.
- A new reference is generated using cryptographic randomness and the `WS-...` format.
- `orders.amount` is stored in kobo for the NGN Paystack-compatible amount, while `order_items.price` stores the original NGN unit price snapshot.
- The order starts in `status = 'pending'`.
- If a transaction fails after the order has begun, `ROLLBACK` is executed so no partial records remain.

## Database operations and transaction strategy

The checkout implementation uses parameterized D1 queries and a transaction wrapper:

- open transaction with `BEGIN IMMEDIATE`
- insert `orders`
- insert each `order_items` row
- commit
- if anything fails, roll back

This prevents partial orders from being left behind when validation or insertion fails mid-way.

## Compatibility with the existing checkout

This phase adds a separate licensing-aware order creation route without modifying the legacy flow:

- `/api/create-payment` is unchanged
- `/api/verify-payment` is unchanged
- `/api/download` is unchanged
- webhook and purchase-email behavior remain intact
- no entitlements are issued during this phase
- no UI, cart, reservation, or exclusivity workflow was added
- no R2 object or package key was changed

## Tests and results

Testing command:

```bash
npm test
```

The Phase 2 suite includes the required cases:

- valid single-item order
- valid multi-item order
- client-submitted price manipulation
- unknown beat
- unknown licence key
- disabled licence
- missing package key
- invalid price
- duplicate selections
- exclusively sold beat
- invalid email
- atomic failure
- immutable snapshot correctness
- unique order reference

## Known limitations and what remains for Phase 3

- This phase creates the pending order record but does not issue entitlements.
- It does not create the Paystack verification/webhook side effects for the new order; that remains for Phase 3.
- Exclusivity reservations and exclusive sales remain out of scope for this phase.
- The new API is intentionally separate from the existing checkout route until the full licensing-aware flow is integrated in a later phase.

