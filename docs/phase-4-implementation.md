# Phase 4 — unified mixed-category checkout and fulfilment

Status: implemented on the licensing branch; not deployed. No production D1 or
R2 change, no live payment was initiated, and no legacy route was rewritten.

## What changed and why

Before Phase 4 only beats could be ordered through the licensing flow, every
order item was implicitly a beat, and a paid licensing order granted rights but
never emailed them. Phase 4 makes one order hold beats, Samples and Studio Tools
together, snapshots the package each item grants, and delivers that order's
links by email once.

### Schema — `migrations/0004_unified_checkout.sql`

Additive and forward-only. Two columns on each of `order_items` and
`entitlements`:

| Column | Meaning |
| --- | --- |
| `category` | `beats`, `samples` or `studio-tools`. `NOT NULL DEFAULT 'beats'`, so every pre-0004 row keeps its exact meaning — everything that existed before Phase 4 was a beat. |
| `package_version` | The immutable package revision snapshotted (parsed from a `-v<n>.zip` key). `NULL` for pre-0004 rows and non-versioned keys. |

`beat_id` is unchanged and is *not* a fake id for non-beat items: the catalogue
table is `beats` for all three categories, so `beat_id` holds the real catalogue
id and `category` disambiguates. Beat-specific columns (`beat_title`,
`licence_key`, `licence_label`, `price`, `package_key`) stay `NOT NULL` and keep
being populated for every item, so old rows and old readers are untouched.

`ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in SQLite: this migration is
meant to run once, through D1's migration runner. A code rollback does not need
to undo it.

### Order creation — `src/phase2-worker.js`

One `POST /api/create-order` accepts both item shapes in the same payload:

```json
{ "email": "buyer@example.com",
  "items": [
    { "category": "beats", "beat_id": "sun-fire", "licence_key": "mp3" },
    { "category": "samples", "product_id": "drum-kit" },
    { "category": "studio-tools", "product_id": "mix-chain" }
  ] }
```

For beats, the price and package come from `beat_licences`. For Samples and
Studio Tools there is exactly one tier — `standard` / "Standard License" —
priced at the product's own `price` and packaged from its own `zip_key`. Any
`price`, `package_key` or `licence_key` the browser sends for a non-beat item is
ignored.

Rules enforced here:

- An `exclusive` item must be the only item in its order.
- A sold beat (`exclusive_sales` row) is refused for every licence.
- An actively reserved beat is refused for the `exclusive` licence only; its
  other tiers stay purchasable.
- The whole order is written in one D1 batch, so a failure leaves no partial
  order.

### Inventory — `src/licensing-inventory.js`

One module holds the three rules and is called at all three check points: order
creation, `POST /api/licensing/create-payment`, and fulfilment.

**Reservations never expire on their own.** Nothing compares
`exclusive_reservations.expires_at` to the clock; that column is informational.
An `active` reservation blocks the exclusive licence until an administrator
releases it. A sold beat is permanent.

### Fulfilment — `src/licensing-checkout.js`

- Verifies the Paystack transaction (status, reference, currency, exact stored
  amount) before granting anything.
- Moves `pending → paid`, grants one `entitlements` row per item carrying the
  item's `category`, `package_key` and `package_version`, and writes the
  `exclusive_sales` row for an exclusive item.
- An order that is already `paid` is not re-granted. This fixes a Phase 3 edge
  case where a repeated `verify-payment` on a paid exclusive order collided with
  its own `exclusive_sales` row and parked it for review.
- If the beat was reserved or sold between payment start and fulfilment, the
  paid order is parked as `manual_review` with an `inventory_conflict` event and
  grants nothing.
- `GET /api/verify-payment` and the webhook both return per-item download links.

### Downloads

`GET /api/licensing/download?token=…` streams the package key recorded on the
entitlement, never the current catalogue value, so a later package replacement
cannot change what a past purchase downloads. Links work the same for all three
categories. The legacy `/api/download` route is untouched.

### Email

Fulfilment sends **one** email per paid order containing a line and a signed
7-day download link for every item, through the existing Apps Script endpoint
and the existing `email_deliveries` claim (now shared via
`deliverEmailOnce`/`sendEmailMessage` in `src/index.js`). Consequences:

- A webhook replay or a second verify call sends nothing extra.
- If the provider call fails, the entitlements stand, the delivery row is marked
  `failed`, and the next webhook retry or verify call attempts the send again.
- Without `EMAIL_SCRIPT_URL` / `EMAIL_SHARED_SECRET` the order still fulfils;
  the response reports `emailError: true`.

### Immutable packages

Admin ZIP uploads now write a versioned key (`beats/<id>-v<n>.zip`,
`products/<category>/<id>-v<n>.zip`), derived from the key the catalogue
currently points at. A replacement upload creates a new object and only moves
the catalogue pointer; the previous object is never overwritten or deleted. Beat
licence packages follow the same convention (`beats/<beat>-<tier>-v<n>.zip`)
and are not managed by the admin UI.

### Storefront

- `GET /api/beat-licences` returns tier labels, prices and availability. Package
  keys are deliberately excluded.
- Beat cards show a licence picker when a beat has more than one purchasable
  tier; the card price follows the selection and the cart records the tier.
- Checkout uses the licensing endpoints when every beat in the cart has a chosen
  tier, and the untouched legacy `/api/create-payment` flow otherwise (for
  example a cart saved before tiers existed).
- `success.html` renders the licensing response (one link per item, any
  category) as well as the legacy formats, and shows a "Payment Received —
  under review" state for `manual_review`.

### Admin

- `GET /api/admin/exclusive/reservations` lists reservations, active first.
- `POST /api/admin/exclusive/reservations/release` (admin session + CSRF) sets an
  `active` reservation to `released` and logs it. Releasing a beat that is
  already sold does not reopen it.
- There is no admin UI panel for these two endpoints yet, and no way to mark a
  beat sold by hand: a sale is recorded by a paid exclusive order so its price
  and reference stay tied to a real transaction.

## Not included

- Admin panel UI for tiers, reservations or manual-review orders.
- Paystack refund tooling for `manual_review` orders.
- Email resend from the admin panel.

## Verification

```bash
docker compose -f docker-compose.base44.yml exec -T store \
  node --test tests/*.test.mjs
```

64 tests pass: Phase 1 migrations, Phase 2 order creation, Phase 3
payment/fulfilment/downloads, and the Phase 4 suite in
`tests/phase4-unified-checkout.test.mjs` (mixed-category totals and snapshots,
every beat tier, the non-beat legacy tier, exclusive-only orders, reserved vs
sold, inventory re-checks at all three points, verification mismatches, webhook
and verify idempotency, immutable-package downloads, one-email-per-order,
failed-email retry, legacy purchase compatibility, admin release, migration
0004 row preservation, and the public tier list). Paystack and the email
endpoint are stubbed; no live request is made.

Checked by hand in the sandbox: `0004` applied to the local D1, a mixed order
created through `POST /api/create-order` with `category`/`package_version`
snapshots, and the beat-card licence picker driving the cart line — then the
test order and the temporary tier rows were deleted.
