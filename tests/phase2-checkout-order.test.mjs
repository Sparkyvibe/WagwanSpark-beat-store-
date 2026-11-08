import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

const BASE_SCHEMA = read(".base44/schema.sql");
const MIGRATION_SCHEMA = read("migrations/0001_licensing_schema.sql");
const MIGRATION_BACKFILL = read("migrations/0002_backfill_legacy_licence.sql");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(BASE_SCHEMA);
  db.exec(MIGRATION_SCHEMA);
  db.exec(MIGRATION_BACKFILL);

  db.prepare(
    "INSERT INTO beats (id, title, price, zip_key, category, status) VALUES (?, ?, ?, ?, ?, 'published')"
  ).run("beat-a", "Beat A", 5000, "beats/beat-a.zip", "beats");
  db.prepare(
    "INSERT INTO beats (id, title, price, zip_key, category, status) VALUES (?, ?, ?, ?, ?, 'published')"
  ).run("beat-b", "Beat B", 10000, "beats/beat-b.zip", "beats");
  db.prepare(
    "INSERT INTO beats (id, title, price, zip_key, category, status) VALUES (?, ?, ?, ?, ?, 'published')"
  ).run("beat-c", "Beat C", 15000, "beats/beat-c.zip", "beats");

  db.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)"
  ).run("beat-a", "mp3", 4500, "beats/beat-a-mp3.zip");
  db.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)"
  ).run("beat-a", "stems", 8000, "beats/beat-a-stems.zip");
  db.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)"
  ).run("beat-b", "mp3_wav", 10000, "beats/beat-b.zip");
  db.prepare(
    "INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)"
  ).run("beat-c", "mp3_wav", 15000, "beats/beat-c.zip");

  return db;
}

function createRequest(body) {
  return new Request("http://localhost/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function makeEnv(db) {
  return { DB: db, ASSETS: { fetch: async () => new Response("ok", { status: 200 }) } };
}

function withQueryOverride(baseDb, override) {
  const wrapped = {
    prepare(sql) {
      const real = baseDb.prepare(sql);
      return {
        bind(...args) {
          const result = override(sql, args);
          if (result) {
            return result;
          }
          return real.bind(...args);
        },
        run(...args) {
          const result = override(sql, args);
          if (result) {
            return result;
          }
          return real.run(...args);
        },
        first(...args) {
          const result = override(sql, args);
          if (result) {
            return result;
          }
          return real.first(...args);
        },
        all(...args) {
          const result = override(sql, args);
          if (result) {
            return result;
          }
          return real.all(...args);
        }
      };
    }
  };
  return wrapped;
}

function routeSuccess(response) {
  return response.status === 201 || response.ok;
}

test("valid single-item order is created atomically", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(data.success, true);
  assert.equal(data.order.total, 4500);
  assert.equal(data.order.amount, 450000);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].beat_id, "beat-a");
  assert.equal(data.items[0].licence_key, "mp3");
  assert.equal(data.items[0].licence_label, "MP3 License");
  assert.equal(data.items[0].price, 4500);
  assert.equal(data.reference.length > 0, true);
  assert.equal(data.order.reference, data.reference);

  const orderCount = db.prepare("SELECT COUNT(*) AS count FROM orders").first().count;
  const itemCount = db.prepare("SELECT COUNT(*) AS count FROM order_items").first().count;
  assert.equal(orderCount, 1);
  assert.equal(itemCount, 1);
});

test("valid multi-item order succeeds and totals the DB price sum", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({
    email: "buyer@example.com",
    items: [
      { beat_id: "beat-a", licence_key: "mp3" },
      { beat_id: "beat-b", licence_key: "mp3_wav" }
    ]
  }), env);
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(data.success, true);
  assert.equal(data.total, 14500);
  assert.equal(data.amount, 1450000);
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].beat_id, "beat-a");
  assert.equal(data.items[1].beat_id, "beat-b");
});

test("client-submitted price manipulation is ignored and DB prices are used", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({
    email: "buyer@example.com",
    amount: 1,
    total: 1,
    items: [{ beat_id: "beat-a", licence_key: "mp3", price: 1 }]
  }), env);
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(data.order.total, 4500);
  assert.equal(data.items[0].price, 4500);
  assert.equal(data.amount, 450000);

  const row = db.prepare("SELECT amount FROM orders WHERE reference = ?").bind(data.reference).first();
  assert.equal(row.amount, 450000);
});

test("unknown beat is rejected", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "missing-beat", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /unavailable/i);
});

test("unknown licence key is rejected", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "not-real" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /not recognised|invalid/i);
});

test("disabled licence is rejected", async () => {
  const db = makeDb();
  db.prepare("UPDATE beat_licences SET enabled = 0 WHERE beat_id = 'beat-a' AND licence_key = 'mp3'").run();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /disabled|unavailable/i);
});

test("missing package key is rejected", async () => {
  const baseDb = makeDb();
  const env = makeEnv(withQueryOverride(baseDb, (sql, args) => {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.includes("SELECT beat_id, licence_key, price, package_key, enabled FROM beat_licences WHERE beat_id = ? AND licence_key = ?")) {
      return {
        bind(...params) {
          return {
            async first() {
              return { beat_id: args[0][0], licence_key: args[0][1], price: 5000, package_key: "", enabled: 1 };
            }
          };
        }
      };
    }
    return null;
  }));

  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /package key/i);
});

test("invalid price is rejected", async () => {
  const baseDb = makeDb();
  const env = makeEnv(withQueryOverride(baseDb, (sql, args) => {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.includes("SELECT beat_id, licence_key, price, package_key, enabled FROM beat_licences WHERE beat_id = ? AND licence_key = ?")) {
      return {
        bind(...params) {
          return {
            async first() {
              return { beat_id: args[0][0], licence_key: args[0][1], price: 0, package_key: "beats/beat-a.zip", enabled: 1 };
            }
          };
        }
      };
    }
    return null;
  }));

  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /invalid price/i);
});

test("duplicate selections in one order are rejected", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({
    email: "buyer@example.com",
    items: [
      { beat_id: "beat-a", licence_key: "mp3" },
      { beat_id: "beat-a", licence_key: "mp3" }
    ]
  }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /duplicate/i);
});

test("exclusive sale blocks a purchase", async () => {
  const db = makeDb();
  db.prepare("INSERT INTO exclusive_sales (beat_id, order_id, order_item_id, reference, email, price, package_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("beat-a", "order-1", "item-1", "ref-1", "buyer@example.com", 4500, "beats/beat-a-mp3.zip");
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /sold exclusively/i);
});

test("invalid email is rejected", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const response = await worker.fetch(createRequest({ email: "bad-email", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /valid email/i);
});

test("atomic failure leaves no order or order items behind", async () => {
  const db = makeDb();
  const env = makeEnv({
    DB: {
      prepare(sql) {
        const real = db.prepare(sql);
        if (sql.trim().startsWith("INSERT INTO order_items")) {
          return {
            bind(...args) {
              return {
                async run() {
                  throw new Error("simulated insert failure");
                }
              };
            }
          };
        }
        return real;
      }
    },
    ASSETS: { fetch: async () => new Response("ok", { status: 200 }) }
  });

  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 500);
  assert.equal(data.success, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders").first().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_items").first().count, 0);
});

test("snapshotted item values are immutable and preserved", async () => {
  const db = makeDb();
  db.prepare("UPDATE beat_licences SET price = 9000, package_key = 'beats/beat-a-repriced.zip' WHERE beat_id = 'beat-a' AND licence_key = 'mp3'").run();
  const env = makeEnv(db);

  const response = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(data.items[0].price, 4500);
  assert.equal(data.items[0].beat_title, "Beat A");
  assert.equal(data.items[0].licence_key, "mp3");
  assert.equal(data.items[0].licence_label, "MP3 License");
  assert.equal(data.items[0].package_key, "beats/beat-a-mp3.zip");

  const row = db.prepare("SELECT beat_title, licence_key, licence_label, price, package_key FROM order_items WHERE beat_id = 'beat-a' LIMIT 1").first();
  assert.equal(row.beat_title, "Beat A");
  assert.equal(row.licence_key, "mp3");
  assert.equal(row.licence_label, "MP3 License");
  assert.equal(row.price, 4500);
  assert.equal(row.package_key, "beats/beat-a-mp3.zip");
});

test("order references are unique per order", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const first = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] }), env);
  const second = await worker.fetch(createRequest({ email: "buyer@example.com", items: [{ beat_id: "beat-c", licence_key: "mp3_wav" }] }), env);
  const firstData = await first.json();
  const secondData = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(firstData.reference, secondData.reference);
  assert.equal(db.prepare("SELECT COUNT(DISTINCT reference) FROM orders").first()["COUNT(DISTINCT reference)"], 2);
});

