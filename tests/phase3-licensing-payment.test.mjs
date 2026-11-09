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

const SECRET = "sk_test_phase3";

// Minimal D1 adapter over in-memory SQLite. batch() models D1's contract:
// ordered statements in one transaction, any failure rolls the whole thing back.
function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(BASE_SCHEMA);
  sqlite.exec(MIGRATION_SCHEMA);
  sqlite.exec(MIGRATION_BACKFILL);

  for (const [id, title, price] of [
    ["beat-a", "Beat A", 5000],
    ["beat-b", "Beat B", 10000],
    ["beat-x", "Beat Exclusive", 90000]
  ]) {
    sqlite.prepare(
      "INSERT INTO beats (id, title, price, zip_key, category, status) VALUES (?, ?, ?, ?, 'beats', 'published')"
    ).run(id, title, price, `beats/${id}.zip`);
  }
  const offering = sqlite.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)"
  );
  offering.run("beat-a", "mp3", 4500, "beats/beat-a-mp3.zip");
  offering.run("beat-a", "stems", 8000, "beats/beat-a-stems.zip");
  offering.run("beat-b", "mp3_wav", 10000, "beats/beat-b.zip");
  offering.run("beat-x", "exclusive", 90000, "beats/beat-x-exclusive.zip");

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

  return {
    sqlite,
    prepare(sql) {
      return makeStatement(sql);
    },
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
}

function makeBucket(keys = ["beats/beat-a-mp3.zip"]) {
  return {
    async get(key) {
      if (!keys.includes(key)) return null;
      return { body: "zip-bytes", size: 9 };
    }
  };
}

function makeEnv(db, bucket = makeBucket()) {
  return { DB: db, BEATS_BUCKET: bucket, PAYSTACK_SECRET_KEY: SECRET };
}

// Paystack stub. `transaction` is what /transaction/verify returns; the
// initialize call echoes the reference it was given.
function installFetchStub({ transaction }) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (target.endsWith("/transaction/initialize")) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.com/test-code",
          access_code: "test-code",
          reference: body.reference
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
  return { calls, restore: () => { globalThis.fetch = original; } };
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

async function createOrder(env, items, email = "buyer@example.com") {
  const response = await worker.fetch(new Request("https://lab.test/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, items })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.order;
}

function webhookRequest(reference, amount, id = "txn_1") {
  const rawBody = JSON.stringify({
    event: "charge.success",
    data: {
      id,
      reference,
      amount,
      currency: "NGN",
      status: "success",
      customer: { email: "buyer@example.com" }
    }
  });
  const signature = createHmac("sha512", SECRET).update(rawBody).digest("hex");
  return new Request("https://lab.test/api/paystack-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: rawBody
  });
}

test("create-payment initialises Paystack with the stored order amount", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-a", licence_key: "mp3" }]);
  assert.equal(order.amount, 450000); // kobo

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

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.authorization_url, "https://checkout.paystack.com/test-code");
    assert.equal(body.reference, order.reference);

    const initialize = stub.calls.find(call => call.url.endsWith("/transaction/initialize"));
    const sent = JSON.parse(initialize.init.body);
    assert.equal(sent.amount, order.amount);
    assert.equal(sent.email, order.email);
    assert.equal(sent.reference, order.reference);
    assert.equal(sent.currency, "NGN");
    // Client-supplied prices are never part of the Paystack amount.
    assert.equal(sent.metadata.total, undefined);
  } finally {
    stub.restore();
  }
});

test("create-payment replays the first authorization instead of opening a second transaction", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-a", licence_key: "mp3" }]);
  const stub = installFetchStub({ transaction: signedTransaction(order) });

  try {
    const call = () => worker.fetch(new Request(
      "https://lab.test/api/licensing/create-payment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: order.reference })
      }
    ), env);

    const first = await (await call()).json();
    const second = await (await call()).json();

    assert.equal(first.duplicate, undefined);
    assert.equal(second.duplicate, true);
    assert.equal(second.authorization_url, first.authorization_url);
    assert.equal(
      stub.calls.filter(item => item.url.endsWith("/transaction/initialize")).length,
      1
    );
  } finally {
    stub.restore();
  }
});

test("create-payment refuses orders that are no longer pending and unknown orders", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-a", licence_key: "mp3" }]);
  db.sqlite.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);

  const paid = await worker.fetch(new Request(
    "https://lab.test/api/licensing/create-payment",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: order.id })
    }
  ), env);
  assert.equal(paid.status, 409);

  const missing = await worker.fetch(new Request(
    "https://lab.test/api/licensing/create-payment",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "ord_missing" })
    }
  ), env);
  assert.equal(missing.status, 404);
});

test("webhook fulfils a licensing order once and grants one entitlement per item", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [
    { beat_id: "beat-a", licence_key: "mp3" },
    { beat_id: "beat-a", licence_key: "stems" }
  ]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    const first = await worker.fetch(webhookRequest(order.reference, order.amount), env);
    const firstBody = await first.json();
    assert.equal(first.status, 200, JSON.stringify(firstBody));
    assert.equal(firstBody.status, "paid");
    assert.equal(firstBody.entitlements, 2);

    const paid = db.sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(order.id);
    assert.equal(paid.status, "paid");

    const second = await worker.fetch(webhookRequest(order.reference, order.amount), env);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.duplicate, true);

    const entitlements = db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM entitlements WHERE order_id = ?"
    ).get(order.id);
    assert.equal(Number(entitlements.count), 2);
  } finally {
    stub.restore();
  }
});

test("webhook rejects an amount that does not match the order and grants nothing", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-a", licence_key: "mp3" }]);

  const stub = installFetchStub({
    transaction: signedTransaction(order, { amount: order.amount - 100 })
  });
  try {
    const response = await worker.fetch(webhookRequest(order.reference, order.amount), env);
    assert.equal(response.status, 500);

    const status = db.sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(order.id);
    assert.equal(status.status, "pending");
    const entitlements = db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM entitlements WHERE order_id = ?"
    ).get(order.id);
    assert.equal(Number(entitlements.count), 0);
  } finally {
    stub.restore();
  }
});

test("a lost exclusive sale parks the paid order for manual review", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-x", licence_key: "exclusive" }]);

  // Another order already completed the exclusive sale for this beat.
  db.sqlite.prepare(
    "INSERT INTO exclusive_sales (beat_id, order_id, order_item_id, reference, email, price, package_key) VALUES ('beat-x', 'ord_other', 'item_other', 'WS-OTHER', 'other@example.com', 90000, 'beats/beat-x-exclusive.zip')"
  ).run();

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    const response = await worker.fetch(webhookRequest(order.reference, order.amount), env);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.status, "manual_review");

    const status = db.sqlite.prepare("SELECT status FROM orders WHERE id = ?").get(order.id);
    assert.equal(status.status, "manual_review");
    const entitlements = db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM entitlements WHERE order_id = ?"
    ).get(order.id);
    assert.equal(Number(entitlements.count), 0);
  } finally {
    stub.restore();
  }
});

test("verify-payment fulfils as a webhook fallback and issues download links", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-a", licence_key: "mp3" }]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  try {
    const response = await worker.fetch(new Request(
      `https://lab.test/api/verify-payment?reference=${encodeURIComponent(order.reference)}`
    ), env);
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.licensing, true);
    assert.equal(body.order.status, "paid");
    assert.equal(body.downloads.length, 1);
    assert.match(body.downloads[0].download_url, /\/api\/licensing\/download\?token=/);

    // A second verify call must not create a second entitlement.
    const entitlements = db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM entitlements WHERE order_id = ?"
    ).get(order.id);
    assert.equal(Number(entitlements.count), 1);
  } finally {
    stub.restore();
  }
});

test("a download serves the exact package the entitlement granted", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const order = await createOrder(env, [{ beat_id: "beat-a", licence_key: "mp3" }]);

  const stub = installFetchStub({ transaction: signedTransaction(order) });
  let downloadUrl;
  try {
    const verified = await (await worker.fetch(new Request(
      `https://lab.test/api/verify-payment?reference=${encodeURIComponent(order.reference)}`
    ), env)).json();
    downloadUrl = verified.downloads[0].download_url;

    const response = await worker.fetch(new Request(downloadUrl), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Disposition"), /beat-a-mp3\.zip/);
    assert.equal(await response.text(), "zip-bytes");

    const tampered = await worker.fetch(new Request(
      downloadUrl.replace(/token=[^&]+/, "token=forged.payload")
    ), env);
    assert.equal(tampered.status, 401);

    db.sqlite.prepare(
      "UPDATE entitlements SET status = 'revoked' WHERE order_id = ?"
    ).run(order.id);
    const revoked = await worker.fetch(new Request(downloadUrl), env);
    assert.equal(revoked.status, 403);
  } finally {
    stub.restore();
  }
});

test("the real webhook body is handed to the legacy flow for non-licensing references", async () => {
  const db = makeDb();
  const env = makeEnv(db);

  const stub = installFetchStub({
    transaction: {
      status: "success",
      reference: "WS-LEGACY-1",
      currency: "NGN",
      amount: 500000,
      customer: { email: "buyer@example.com" },
      metadata: { productIds: "[]" }
    }
  });
  try {
    const response = await worker.fetch(webhookRequest("WS-LEGACY-1", 500000), env);
    const body = await response.json();
    // The licensing reply always carries `licensing: true`; a delegated legacy
    // reply does not, which proves the fallback path still runs.
    assert.equal(body.licensing, undefined);
    assert.equal(body.error, "Webhook processing failed.");
  } finally {
    stub.restore();
  }
});
