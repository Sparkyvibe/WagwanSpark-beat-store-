// Phase 4 — unified mixed-category checkout, fulfilment, downloads and email.
//
// Scope: behaviour added on top of Phases 1–3.
//   * one order holding beats, Samples and Studio Tools
//   * server-resolved prices/packages snapshotted per item (client values ignored)
//   * all four beat licence tiers plus the single non-beat legacy tier
//   * exclusive-only orders, and the difference between a reserved beat (blocks
//     the exclusive licence) and a sold beat (blocks every licence)
//   * inventory re-checked at creation, at payment start and at fulfilment
//   * Paystack amount/currency/reference verification and webhook idempotency
//   * entitlement downloads replaying the exact snapshotted package version
//   * exactly one email per paid order, with a link for every item
//   * the legacy purchase routes are untouched
//   * migration 0004 preserves pre-existing beat rows
//
// Runs on Node's built-in test runner and built-in `node:sqlite`. Paystack and
// the Apps Script email endpoint are stubbed; no network call leaves the test.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/phase3-worker.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => readFileSync(join(root, relativePath), "utf8");
const BASE_SCHEMA = read(".base44/schema.sql");
const MIGRATION_SCHEMA = read("migrations/0001_licensing_schema.sql");
const MIGRATION_BACKFILL = read("migrations/0002_backfill_legacy_licence.sql");
const MIGRATION_UNIFIED = read("migrations/0004_unified_checkout.sql");

const SECRET = "sk_test_phase4";
const ADMIN_PASSWORD = "test-admin-password";
const EMAIL_URL = "https://script.google.com/macros/s/test-deployment/exec";
const EMAIL_SECRET = "email-shared-secret";

// ---------------------------------------------------------------------------
// Catalogue + storage fixtures
// ---------------------------------------------------------------------------
const PACKAGES = {
  // beat tiers (immutable, versioned keys; v2 exists to prove replacement
  // never touches what an entitlement already recorded)
  "beats/beat-a-mp3-v1.zip": "bytes:beat-a:mp3:v1",
  "beats/beat-a-mp3-v2.zip": "bytes:beat-a:mp3:v2",
  "beats/beat-a-mp3-wav-v1.zip": "bytes:beat-a:mp3_wav:v1",
  "beats/beat-a-stems-v1.zip": "bytes:beat-a:stems:v1",
  "beats/beat-x-exclusive-v1.zip": "bytes:beat-x:exclusive:v1",
  // non-beat product ZIPs
  "samples/sample-1-v1.zip": "bytes:sample-1:v1",
  "samples/sample-1-v2.zip": "bytes:sample-1:v2",
  "tools/tool-1.zip": "bytes:tool-1:unversioned"
};

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(BASE_SCHEMA);
  sqlite.exec(MIGRATION_SCHEMA);
  sqlite.exec(MIGRATION_BACKFILL);
  sqlite.exec(MIGRATION_UNIFIED);

  const product = sqlite.prepare(
    "INSERT INTO beats (id, title, price, zip_key, category, status) VALUES (?, ?, ?, ?, ?, 'published')"
  );
  product.run("beat-a", "Beat A", 5000, "beats/beat-a.zip", "beats");
  product.run("beat-x", "Beat Exclusive", 90000, "beats/beat-x.zip", "beats");
  product.run("sample-1", "Sample One", 1500, "samples/sample-1-v1.zip", "samples");
  product.run("tool-1", "Tool One", 2500, "tools/tool-1.zip", "studio-tools");

  const tier = sqlite.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)"
  );
  tier.run("beat-a", "mp3", 4500, "beats/beat-a-mp3-v1.zip");
  tier.run("beat-a", "mp3_wav", 5200, "beats/beat-a-mp3-wav-v1.zip");
  tier.run("beat-a", "stems", 8000, "beats/beat-a-stems-v1.zip");
  tier.run("beat-x", "exclusive", 90000, "beats/beat-x-exclusive-v1.zip");

  const makeStatement = (sql, params = []) => ({
    sql,
    params,
    bind(...boundParams) {
      return makeStatement(sql, boundParams);
    },
    async first(column) {
      const row = sqlite.prepare(sql).get(...params);
      if (!row) return null;
      return column ? row[column] ?? null : row;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...params) };
    },
    async run() {
      const result = sqlite.prepare(sql).run(...params);
      return { meta: { changes: Number(result.changes) } };
    }
  });

  const db = {
    prepare(sql) {
      return makeStatement(sql);
    },
    // D1 contract: ordered statements, one transaction, full rollback.
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(statement => {
          const result = sqlite.prepare(statement.sql).run(...statement.params);
          return { meta: { changes: Number(result.changes) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { db, sqlite };
}

function makeBucket() {
  return {
    async head(key) {
      return Object.prototype.hasOwnProperty.call(PACKAGES, key)
        ? { key, size: PACKAGES[key].length }
        : null;
    },
    async get(key) {
      if (!Object.prototype.hasOwnProperty.call(PACKAGES, key)) return null;
      const value = PACKAGES[key];
      return { body: value, size: value.length };
    }
  };
}

// ---------------------------------------------------------------------------
// Stubs: Paystack + the Apps Script email endpoint
// ---------------------------------------------------------------------------
function installFetchStub({ transaction, emailFails = false } = {}) {
  const calls = [];
  const emails = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });

    if (target === EMAIL_URL) {
      const payload = JSON.parse(init.body);
      emails.push(payload);
      return new Response(JSON.stringify(emailFails
        ? { success: false }
        : { success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (target.endsWith("/transaction/initialize")) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.com/test-code",
          access_code: "test-code",
          // The legacy checkout generates the reference at Paystack; the
          // licensing checkout supplies its own.
          reference: body.reference || "WS-STUB-REF"
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.includes("/transaction/verify/")) {
      return new Response(JSON.stringify({ status: true, data: transaction }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  return {
    calls,
    emails,
    restore: () => { globalThis.fetch = original; }
  };
}

function signedTransaction(order, overrides = {}) {
  return {
    status: "success",
    reference: order.reference,
    currency: "NGN",
    amount: order.amount,
    customer: { email: order.email },
    metadata: { licensing: "true", orderId: order.id },
    ...overrides
  };
}

function webhookRequest(reference, id = "txn_1") {
  const rawBody = JSON.stringify({
    event: "charge.success",
    data: { id, reference, status: "success", currency: "NGN" }
  });
  const signature = createHmac("sha512", SECRET).update(rawBody).digest("hex");
  return new Request("https://lab.test/api/paystack-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: rawBody
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEnv(db) {
  return {
    DB: db,
    BEATS_BUCKET: makeBucket(),
    PAYSTACK_SECRET_KEY: SECRET,
    ADMIN_PASSWORD,
    EMAIL_SCRIPT_URL: EMAIL_URL,
    EMAIL_SHARED_SECRET: EMAIL_SECRET,
    ASSETS: { fetch: async () => new Response("ok") }
  };
}

async function postOrder(env, items, email = "buyer@example.com") {
  const response = await worker.fetch(new Request("https://lab.test/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, items })
  }), env);
  return { response, body: await response.json() };
}

async function createOrder(env, items, email) {
  const { response, body } = await postOrder(env, items, email);
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.order;
}

// Drives the real checkout order → Paystack initialize → webhook path.
async function payOrder(env, order, { txnId = "txn_1" } = {}) {
  const init = await worker.fetch(new Request(
    "https://lab.test/api/licensing/create-payment",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: order.id })
    }
  ), env);
  const initBody = await init.json();
  assert.equal(init.status, 200, JSON.stringify(initBody));

  const webhook = await worker.fetch(webhookRequest(order.reference, txnId), env);
  return { initBody, webhook, webhookBody: await webhook.json() };
}

function count(sqlite, sql, ...params) {
  return Number(sqlite.prepare(sql).get(...params).n);
}

// ===========================================================================
// 1. Order creation — mixed categories, server pricing, immutable snapshots
// ===========================================================================
test("a mixed-category order totals server prices and snapshots every item", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);

  const { response, body } = await postOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "mp3" },
    { category: "samples", product_id: "sample-1" },
    { category: "studio-tools", product_id: "tool-1" }
  ]);

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.total, 4500 + 1500 + 2500);
  assert.equal(body.amount, (4500 + 1500 + 2500) * 100);

  const rows = sqlite.prepare(
    `SELECT beat_id, beat_title, licence_key, licence_label, price, package_key,
            category, package_version
       FROM order_items WHERE order_id = ? ORDER BY beat_id`
  ).all(body.order.id);

  assert.deepEqual(rows.map(row => ({ ...row })), [
    {
      beat_id: "beat-a",
      beat_title: "Beat A",
      licence_key: "mp3",
      licence_label: "MP3 License",
      price: 4500,
      package_key: "beats/beat-a-mp3-v1.zip",
      category: "beats",
      package_version: 1
    },
    {
      beat_id: "sample-1",
      beat_title: "Sample One",
      licence_key: "standard",
      licence_label: "Standard License",
      price: 1500,
      package_key: "samples/sample-1-v1.zip",
      category: "samples",
      package_version: 1
    },
    {
      beat_id: "tool-1",
      beat_title: "Tool One",
      licence_key: "standard",
      licence_label: "Standard License",
      price: 2500,
      package_key: "tools/tool-1.zip",
      category: "studio-tools",
      package_version: null
    }
  ]);
});

test("client-supplied price, tier and package values are ignored", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);

  const { response, body } = await postOrder(env, [
    {
      category: "samples",
      product_id: "sample-1",
      price: 1,
      package_key: "attacker/other.zip",
      licence_key: "exclusive"
    }
  ]);

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.total, 1500);
  const row = sqlite.prepare(
    "SELECT licence_key, price, package_key FROM order_items WHERE order_id = ?"
  ).get(body.order.id);
  assert.deepEqual({ ...row }, {
    licence_key: "standard",
    price: 1500,
    package_key: "samples/sample-1-v1.zip"
  });
});

test("a non-beat product submitted under the wrong catalogue is rejected", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const { response } = await postOrder(env, [
    { category: "studio-tools", product_id: "sample-1" }
  ]);
  assert.equal(response.status, 400);
  assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM orders"), 0);
});

test("a product without a stored package cannot be added to an order", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  sqlite.prepare("UPDATE beats SET zip_key = NULL WHERE id = 'tool-1'").run();
  const { response } = await postOrder(env, [
    { category: "studio-tools", product_id: "tool-1" }
  ]);
  assert.equal(response.status, 400);
  assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM orders"), 0);
});

test("all four beat licence tiers resolve from the catalogue", async () => {
  const { db } = makeDb();
  const env = makeEnv(db);

  const cases = [
    ["beat-a", "mp3", 4500],
    ["beat-a", "mp3_wav", 5200],
    ["beat-a", "stems", 8000],
    ["beat-x", "exclusive", 90000]
  ];

  for (const [beatId, licenceKey, price] of cases) {
    const { response, body } = await postOrder(env, [
      { category: "beats", beat_id: beatId, licence_key: licenceKey }
    ]);
    assert.equal(response.status, 201, `${beatId}/${licenceKey}: ${JSON.stringify(body)}`);
    assert.equal(body.total, price, `${beatId}/${licenceKey} price`);
    assert.equal(body.items[0].licence_key, licenceKey);
    assert.equal(body.items[0].category, "beats");
  }
});

// ===========================================================================
// 2. Exclusive rules — sole item, reserved vs sold
// ===========================================================================
test("an exclusive licence cannot share an order with any other item", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);

  for (const items of [
    [
      { category: "beats", beat_id: "beat-x", licence_key: "exclusive" },
      { category: "beats", beat_id: "beat-a", licence_key: "mp3" }
    ],
    [
      { category: "beats", beat_id: "beat-x", licence_key: "exclusive" },
      { category: "samples", product_id: "sample-1" }
    ]
  ]) {
    const { response, body } = await postOrder(env, items);
    assert.equal(response.status, 400);
    assert.match(body.error, /only item/i);
  }
  assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM orders"), 0);
});

test("an active reservation blocks the exclusive tier but not the other tiers", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);

  sqlite.prepare(
    `INSERT INTO exclusive_reservations (id, beat_id, email, expires_at)
     VALUES ('res-1', 'beat-a', 'holder@example.com', datetime('now', '-400 days'))`
  ).run();

  const exclusive = await postOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "exclusive" }
  ]);
  // beat-a has no exclusive tier, so use the reserved beat's exclusive offering
  // through beat-x instead for the positive/negative pair below.
  assert.notEqual(exclusive.response.status, 201);

  const nonExclusive = await postOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "mp3" }
  ]);
  assert.equal(nonExclusive.response.status, 201, JSON.stringify(nonExclusive.body));

  // And the reserved beat itself refuses an exclusive licence even though the
  // reservation is long past its expires_at column: nothing expires itself.
  sqlite.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES ('beat-a', 'exclusive', 60000, 'beats/beat-a-exclusive-v1.zip', 1)"
  ).run();
  const reservedExclusive = await postOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "exclusive" }
  ]);
  assert.equal(reservedExclusive.response.status, 409);
  assert.match(reservedExclusive.body.error, /reserved/i);
});

test("a sold beat blocks every licence", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  sqlite.prepare(
    `INSERT INTO exclusive_sales
       (beat_id, order_id, order_item_id, reference, email, price, package_key)
     VALUES ('beat-a', 'ord_old', 'item_old', 'WS-OLD', 'old@example.com', 60000, 'beats/beat-a-mp3-v1.zip')`
  ).run();

  for (const licenceKey of ["mp3", "mp3_wav", "stems"]) {
    const { response, body } = await postOrder(env, [
      { category: "beats", beat_id: "beat-a", licence_key: licenceKey }
    ]);
    assert.equal(response.status, 409, `${licenceKey}: ${JSON.stringify(body)}`);
    assert.match(body.error, /sold exclusively/i);
  }
});

test("a reservation created after checkout stops payment from starting", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "beats", beat_id: "beat-x", licence_key: "exclusive" }
  ]);

  sqlite.prepare(
    `INSERT INTO exclusive_reservations (id, beat_id, email, expires_at)
     VALUES ('res-2', 'beat-x', 'holder@example.com', datetime('now', '+48 hours'))`
  ).run();

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    const response = await worker.fetch(new Request(
      "https://lab.test/api/licensing/create-payment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id })
      }
    ), env);
    const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.match(body.error, /reserved/i);
    assert.equal(
      stub.calls.filter(call => call.url.endsWith("/transaction/initialize")).length,
      0
    );
  } finally {
    stub.restore();
  }
});

test("fulfilment parks an exclusive order whose beat was reserved after checkout", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "beats", beat_id: "beat-x", licence_key: "exclusive" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    // Payment starts while the beat is still free...
    const init = await worker.fetch(new Request(
      "https://lab.test/api/licensing/create-payment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id })
      }
    ), env);
    assert.equal(init.status, 200);

    // ...and the hold appears while the buyer is on the Paystack page.
    sqlite.prepare(
      `INSERT INTO exclusive_reservations (id, beat_id, email, expires_at)
       VALUES ('res-3', 'beat-x', 'holder@example.com', datetime('now', '+48 hours'))`
    ).run();

    const webhook = await worker.fetch(webhookRequest(order.reference), env);
    const webhookBody = await webhook.json();
    assert.equal(webhook.status, 200, JSON.stringify(webhookBody));
    assert.equal(webhookBody.status, "manual_review");
    assert.equal(webhookBody.entitlements, 0);
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 0);
    assert.equal(
      sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(order.id).status,
      "manual_review"
    );
    // Parked orders are not emailed: nothing was granted to link to.
    assert.equal(stub.emails.length, 0);
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// 3. Payment verification and idempotency
// ===========================================================================
test("payment verification refuses a mismatched amount, currency or reference", async () => {
  const cases = [
    ["amount", { amount: 100 }],
    ["currency", { currency: "USD" }],
    ["reference", { reference: "WS-SOMETHING-ELSE" }],
    ["status", { status: "failed" }]
  ];

  for (const [label, overrides] of cases) {
    const { db, sqlite } = makeDb();
    const env = makeEnv(db);
    const order = await createOrder(env, [
      { category: "samples", product_id: "sample-1" }
    ]);

    const stub = installFetchStub({
      transaction: signedTransaction(order, overrides)
    });
    try {
      const response = await worker.fetch(webhookRequest(order.reference), env);
      assert.equal(response.status, 500, label);
      assert.equal(
        sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(order.id).status,
        "pending",
        label
      );
      assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 0, label);
      assert.equal(stub.emails.length, 0, label);
    } finally {
      stub.restore();
    }
  }
});

test("a duplicate webhook grants each entitlement once and sends one email", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "mp3" },
    { category: "samples", product_id: "sample-1" },
    { category: "studio-tools", product_id: "tool-1" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    const { webhookBody } = await payOrder(env, order, { txnId: "txn_dupe" });
    assert.equal(webhookBody.status, "paid");
    assert.equal(webhookBody.entitlements, 3);
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 3);
    assert.equal(stub.emails.length, 1);

    // Same Paystack transaction id delivered again.
    const replay = await worker.fetch(webhookRequest(order.reference, "txn_dupe"), env);
    const replayBody = await replay.json();
    assert.equal(replay.status, 200, JSON.stringify(replayBody));
    assert.equal(replayBody.duplicate, true);
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 3);
    assert.equal(stub.emails.length, 1, "a replay must not send a second email");
  } finally {
    stub.restore();
  }
});

test("verify-payment after the webhook neither re-grants nor re-emails", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "beats", beat_id: "beat-x", licence_key: "exclusive" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    await payOrder(env, order, { txnId: "txn_verify" });
    assert.equal(stub.emails.length, 1);

    const verified = await worker.fetch(new Request(
      `https://lab.test/api/verify-payment?reference=${encodeURIComponent(order.reference)}`
    ), env);
    const body = await verified.json();

    assert.equal(verified.status, 200, JSON.stringify(body));
    assert.equal(body.order.status, "paid", "a repeated verify must not park the order");
    assert.equal(body.downloads.length, 1);
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 1);
    assert.equal(stub.emails.length, 1, "no second email");
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM exclusive_sales").get().n,
      1
    );
  } finally {
    stub.restore();
  }
});

test("a failed email does not roll back the entitlements it could not announce", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "samples", product_id: "sample-1" }
  ]);

  const stub = installFetchStub({
    transaction: signedTransaction(order),
    emailFails: true
  });
  try {
    const { webhookBody } = await payOrder(env, order);
    assert.equal(webhookBody.status, "paid");
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 1);
    assert.equal(
      sqlite.prepare("SELECT status FROM email_deliveries WHERE reference = ?")
        .get(order.reference).status,
      "failed"
    );
    assert.equal(
      count(sqlite, "SELECT COUNT(*) AS n FROM licence_events WHERE event_type = 'email_failed'"),
      1
    );

    // The failed row is reclaimable: a later verify-payment sends the email.
    const verified = await worker.fetch(new Request(
      `https://lab.test/api/verify-payment?reference=${encodeURIComponent(order.reference)}`
    ), env);
    assert.equal(verified.status, 200);
    assert.equal(stub.emails.length, 2, "the retry actually attempted the send again");
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 1);
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// 4. Email — one message, one link per purchased item
// ===========================================================================
test("one paid order sends one email containing a link for every item", async () => {
  const { db } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "stems" },
    { category: "samples", product_id: "sample-1" },
    { category: "studio-tools", product_id: "tool-1" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    await payOrder(env, order);
    assert.equal(stub.emails.length, 1);

    const [email] = stub.emails;
    assert.equal(email.to, "buyer@example.com");
    assert.equal(email.secret, EMAIL_SECRET);
    assert.match(email.subject, /Your Downloads/);

    const links = email.body.match(/Download: [^\s]+/g) || [];
    assert.equal(links.length, 3, email.body);
    for (const title of ["Beat A", "Sample One", "Tool One"]) {
      assert.match(email.body, new RegExp(title));
    }
    assert.match(email.body, /Stems License/);
    assert.match(email.body, /Standard License/);
    assert.match(email.body, new RegExp(`Payment reference: ${order.reference}`));
    for (const link of links) {
      assert.match(link, /\/api\/licensing\/download\?token=/);
    }
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// 5. Entitlement downloads — exact immutable package per category
// ===========================================================================
test("each emailed link downloads the package version the entitlement recorded", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "beats", beat_id: "beat-a", licence_key: "mp3" },
    { category: "samples", product_id: "sample-1" },
    { category: "studio-tools", product_id: "tool-1" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    await payOrder(env, order);

    // The catalogue moves on: a new beat package version and a replaced
    // product ZIP. Historical entitlements must not follow it.
    sqlite.prepare(
      "UPDATE beat_licences SET package_key = 'beats/beat-a-mp3-v2.zip' WHERE beat_id = 'beat-a' AND licence_key = 'mp3'"
    ).run();
    sqlite.prepare(
      "UPDATE beats SET zip_key = 'samples/sample-1-v2.zip' WHERE id = 'sample-1'"
    ).run();

    const verified = await worker.fetch(new Request(
      `https://lab.test/api/verify-payment?reference=${encodeURIComponent(order.reference)}`
    ), env);
    const body = await verified.json();
    assert.equal(body.downloads.length, 3);

    const served = {};
    for (const download of body.downloads) {
      const response = await worker.fetch(new Request(download.download_url), env);
      assert.equal(response.status, 200, download.product_id);
      assert.match(response.headers.get("Content-Type"), /application\/zip/);
      served[download.product_id] = await response.text();
    }

    assert.deepEqual(served, {
      "beat-a": "bytes:beat-a:mp3:v1",
      "sample-1": "bytes:sample-1:v1",
      "tool-1": "bytes:tool-1:unversioned"
    });

    // Downloads expose the category and licence they were granted for.
    const byId = Object.fromEntries(body.downloads.map(item => [item.product_id, item]));
    assert.equal(byId["beat-a"].category, "beats");
    assert.equal(byId["beat-a"].licence_label, "MP3 License");
    assert.equal(byId["sample-1"].category, "samples");
    assert.equal(byId["sample-1"].licence_label, "Standard License");
    assert.equal(byId["tool-1"].category, "studio-tools");
  } finally {
    stub.restore();
  }
});

test("a revoked entitlement is refused and a forged token is rejected", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { category: "samples", product_id: "sample-1" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    await payOrder(env, order);
    const verified = await (await worker.fetch(new Request(
      `https://lab.test/api/verify-payment?reference=${encodeURIComponent(order.reference)}`
    ), env)).json();
    const downloadUrl = verified.downloads[0].download_url;

    const forged = await worker.fetch(new Request(
      downloadUrl.replace(/token=[^&]+/, "token=forged.payload")
    ), env);
    assert.equal(forged.status, 401);

    sqlite.prepare("UPDATE entitlements SET status = 'revoked'").run();
    const revoked = await worker.fetch(new Request(downloadUrl), env);
    assert.equal(revoked.status, 403);
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// 6. Legacy compatibility
// ===========================================================================
test("the legacy purchase flow still runs on its own routes and tables", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);

  const stub = installFetchStub({
    transaction: {
      status: "success",
      reference: "WS-LEGACY-1",
      currency: "NGN",
      amount: 150000,
      customer: { email: "legacy@example.com" },
      metadata: { productIds: JSON.stringify(["sample-1"]) }
    }
  });
  try {
    // Legacy checkout still opens a Paystack transaction for the whole cart.
    const pay = await worker.fetch(new Request("https://lab.test/api/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy@example.com",
        productItems: [{ id: "sample-1", category: "samples" }]
      })
    }), env);
    const payBody = await pay.json();
    assert.equal(pay.status, 200, JSON.stringify(payBody));
    assert.ok(payBody.data.authorization_url);

    const initialize = stub.calls.find(call => call.url.endsWith("/transaction/initialize"));
    const sent = JSON.parse(initialize.init.body);
    assert.equal(sent.amount, 150000);
    assert.deepEqual(JSON.parse(sent.metadata.productIds), ["sample-1"]);

    // The licensing tables stay untouched by a legacy purchase.
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM orders"), 0);
    assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 0);

    // Legacy verification still produces its own download links and email.
    const verified = await worker.fetch(new Request(
      "https://lab.test/api/verify-payment?reference=WS-LEGACY-1"
    ), env);
    const body = await verified.json();
    assert.equal(verified.status, 200, JSON.stringify(body));
    assert.equal(body.licensing, undefined);
    assert.equal(body.products.length, 1);
    assert.match(body.products[0].downloadUrl, /\/api\/download\?token=/);
    assert.equal(stub.emails.length, 1);
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// 7. Admin release control for indefinite reservations
// ===========================================================================
async function adminSession(env) {
  const login = await worker.fetch(new Request("https://lab.test/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD })
  }), env);
  assert.equal(login.status, 200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];

  const session = await worker.fetch(new Request("https://lab.test/api/admin/session", {
    headers: { Cookie: cookie }
  }), env);
  const sessionBody = await session.json();
  return { cookie, csrf: sessionBody.csrfToken };
}

test("an administrator can list and release an indefinite reservation", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);
  sqlite.prepare(
    `INSERT INTO exclusive_reservations (id, beat_id, email, expires_at)
     VALUES ('res-admin', 'beat-x', 'holder@example.com', datetime('now', '-400 days'))`
  ).run();

  const { cookie, csrf } = await adminSession(env);

  // Unauthenticated reads are refused.
  const anonymous = await worker.fetch(new Request(
    "https://lab.test/api/admin/exclusive/reservations"
  ), env);
  assert.equal(anonymous.status, 401);

  const list = await worker.fetch(new Request(
    "https://lab.test/api/admin/exclusive/reservations",
    { headers: { Cookie: cookie } }
  ), env);
  const listBody = await list.json();
  assert.equal(list.status, 200, JSON.stringify(listBody));
  assert.equal(listBody.reservations.length, 1);
  assert.equal(listBody.reservations[0].beat_id, "beat-x");
  assert.equal(listBody.reservations[0].status, "active");

  // While it is active the exclusive licence cannot be bought.
  const blocked = await postOrder(env, [
    { category: "beats", beat_id: "beat-x", licence_key: "exclusive" }
  ]);
  assert.equal(blocked.response.status, 409);

  // A release without the CSRF token is refused.
  const noCsrf = await worker.fetch(new Request(
    "https://lab.test/api/admin/exclusive/reservations/release",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ id: "res-admin" })
    }
  ), env);
  assert.equal(noCsrf.status, 403);

  const released = await worker.fetch(new Request(
    "https://lab.test/api/admin/exclusive/reservations/release",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf
      },
      body: JSON.stringify({ id: "res-admin" })
    }
  ), env);
  const releasedBody = await released.json();
  assert.equal(released.status, 200, JSON.stringify(releasedBody));
  assert.equal(releasedBody.beat_sold, false);
  assert.equal(
    sqlite.prepare("SELECT status FROM exclusive_reservations WHERE id = 'res-admin'").get().status,
    "released"
  );

  // With the hold released the exclusive licence is purchasable again.
  const allowed = await postOrder(env, [
    { category: "beats", beat_id: "beat-x", licence_key: "exclusive" }
  ]);
  assert.equal(allowed.response.status, 201, JSON.stringify(allowed.body));

  // Releasing again is refused rather than silently succeeding.
  const again = await worker.fetch(new Request(
    "https://lab.test/api/admin/exclusive/reservations/release",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf
      },
      body: JSON.stringify({ id: "res-admin" })
    }
  ), env);
  assert.equal(again.status, 409);
});

// ===========================================================================
// 8. Public tier catalogue — prices only, never package keys
// ===========================================================================
test("the public tier list exposes labels and prices but no package keys", async () => {
  const { db, sqlite } = makeDb();
  const env = makeEnv(db);

  sqlite.prepare(
    `INSERT INTO exclusive_reservations (id, beat_id, email, expires_at)
     VALUES ('res-tier', 'beat-x', 'holder@example.com', datetime('now', '+48 hours'))`
  ).run();

  const response = await worker.fetch(new Request(
    "https://lab.test/api/beat-licences"
  ), env);
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  const tiers = body.licences.filter(row => row.beat_id === "beat-a");
  assert.deepEqual(
    tiers.map(row => [row.licence_key, row.label, row.price]),
    [
      ["mp3", "MP3 License", 4500],
      ["mp3_wav", "MP3 + WAV License", 5200],
      ["stems", "Stems License", 8000]
    ]
  );
  assert.equal(
    JSON.stringify(body).includes("beats/beat-a-mp3-v1.zip"),
    false,
    "package keys must never reach the browser"
  );

  // A reserved beat hides only its exclusive option.
  const exclusive = body.licences.find(row => row.beat_id === "beat-x");
  assert.equal(exclusive.licence_key, "exclusive");
  assert.equal(exclusive.available, false);
  assert.equal(exclusive.unavailable_reason, "reserved");
});

// ===========================================================================
// 9. Migration 0004 — historical rows untouched
// ===========================================================================
test("migration 0004 adds category/version without rewriting existing rows", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(BASE_SCHEMA);
  sqlite.exec(MIGRATION_SCHEMA);
  sqlite.exec(MIGRATION_BACKFILL);

  // A Phase-3 era purchase, written before 0004 existed.
  sqlite.prepare(
    `INSERT INTO orders (id, reference, email, amount, status)
     VALUES ('ord_old', 'WS-OLD', 'old@example.com', 450000, 'paid')`
  ).run();
  sqlite.prepare(
    `INSERT INTO order_items
       (id, order_id, beat_id, beat_title, licence_key, licence_label, price, package_key)
     VALUES ('item_old', 'ord_old', 'beat-a', 'Beat A', 'mp3', 'MP3 License', 4500, 'beats/beat-a-mp3-v1.zip')`
  ).run();
  sqlite.prepare(
    `INSERT INTO entitlements
       (id, order_id, order_item_id, reference, email, beat_id, licence_key, package_key)
     VALUES ('ent_old', 'ord_old', 'item_old', 'WS-OLD', 'old@example.com', 'beat-a', 'mp3', 'beats/beat-a-mp3-v1.zip')`
  ).run();

  sqlite.exec(MIGRATION_UNIFIED);

  const item = sqlite.prepare(
    "SELECT beat_id, beat_title, licence_key, licence_label, price, package_key, category, package_version FROM order_items WHERE id = 'item_old'"
  ).get();
  assert.deepEqual({ ...item }, {
    beat_id: "beat-a",
    beat_title: "Beat A",
    licence_key: "mp3",
    licence_label: "MP3 License",
    price: 4500,
    package_key: "beats/beat-a-mp3-v1.zip",
    category: "beats",
    package_version: null
  });

  const entitlement = sqlite.prepare(
    "SELECT beat_id, licence_key, package_key, status, category FROM entitlements WHERE id = 'ent_old'"
  ).get();
  assert.deepEqual({ ...entitlement }, {
    beat_id: "beat-a",
    licence_key: "mp3",
    package_key: "beats/beat-a-mp3-v1.zip",
    status: "active",
    category: "beats"
  });

  assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM orders"), 1);
  assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM order_items"), 1);
  assert.equal(count(sqlite, "SELECT COUNT(*) AS n FROM entitlements"), 1);

  // New rows can carry an explicit category; the historical row kept 'beats'.
  sqlite.prepare(
    `INSERT INTO order_items
       (id, order_id, beat_id, beat_title, licence_key, licence_label, price, package_key, category, package_version)
     VALUES ('item_new', 'ord_old', 'sample-1', 'Sample One', 'standard', 'Standard License', 1500, 'samples/sample-1-v1.zip', 'samples', 1)`
  ).run();
  const newItem = sqlite.prepare(
    "SELECT category, package_version FROM order_items WHERE id = 'item_new'"
  ).get();
  assert.deepEqual({ ...newItem }, { category: "samples", package_version: 1 });
});
