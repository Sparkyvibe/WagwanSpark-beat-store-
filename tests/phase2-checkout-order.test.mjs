import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/phase2-worker.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => readFileSync(join(root, relativePath), "utf8");
const BASE_SCHEMA = read(".base44/schema.sql");
const MIGRATION_SCHEMA = read("migrations/0001_licensing_schema.sql");
const MIGRATION_BACKFILL = read("migrations/0002_backfill_legacy_licence.sql");

function makeDb({ failOrderItemInsert = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(BASE_SCHEMA);
  sqlite.exec(MIGRATION_SCHEMA);
  sqlite.exec(MIGRATION_BACKFILL);
  for (const [id, title, price] of [
    ["beat-a", "Beat A", 5000],
    ["beat-b", "Beat B", 10000],
    ["beat-c", "Beat C", 15000]
  ]) {
    sqlite.prepare("INSERT INTO beats (id, title, price, zip_key, category, status) VALUES (?, ?, ?, ?, 'beats', 'published')")
      .run(id, title, price, `beats/${id}.zip`);
  }
  sqlite.prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES ('beat-a', 'mp3', 4500, 'beats/beat-a-mp3.zip', 1)").run();
  sqlite.prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES ('beat-a', 'stems', 8000, 'beats/beat-a-stems.zip', 1)").run();
  sqlite.prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES ('beat-b', 'mp3_wav', 10000, 'beats/beat-b.zip', 1)").run();
  sqlite.prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES ('beat-c', 'mp3_wav', 15000, 'beats/beat-c.zip', 1)").run();

  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return { sql, params };
        },
        async first() {
          return sqlite.prepare(sql).get() ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all() };
        },
        async run() {
          const result = sqlite.prepare(sql).run();
          return { meta: { changes: Number(result.changes) } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          if (failOrderItemInsert && /^INSERT INTO order_items/i.test(statement.sql.trim())) {
            throw new Error("simulated order_items insert failure");
          }
          const result = sqlite.prepare(statement.sql).run(...statement.params);
          results.push({ meta: { changes: Number(result.changes) } });
        }
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

function makeEnv(db) {
  return { DB: db, ASSETS: { fetch: async () => new Response("ok") } };
}

function createRequest(body) {
  return new Request("http://localhost/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function postOrder(db, body) {
  return worker.fetch(createRequest(body), makeEnv(db));
}

 test("valid single-item order uses D1 price and snapshots", async () => {
  const { db, sqlite } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.total, 4500);
  assert.equal(data.amount, 450000);
  assert.equal(data.order.status, "pending");
  assert.equal(data.items[0].beat_title, "Beat A");
  assert.equal(data.items[0].licence_label, "MP3 License");
  assert.equal(data.items[0].price, 4500);
  assert.equal(data.items[0].package_key, "beats/beat-a-mp3.zip");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM order_items").get().n, 1);
});

test("valid multi-item order sums D1 prices", async () => {
  const { db } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [
    { beat_id: "beat-a", licence_key: "mp3" },
    { beat_id: "beat-b", licence_key: "mp3_wav" }
  ] });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.total, 14500);
  assert.equal(data.amount, 1450000);
  assert.equal(data.itemCount, 2);
});

test("client price manipulation is ignored", async () => {
  const { db } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", total: 1, items: [{ beat_id: "beat-a", licence_key: "mp3", price: 1 }] });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.total, 4500);
  assert.equal(data.items[0].price, 4500);
});

test("unknown beat is rejected", async () => {
  const { db, sqlite } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "missing", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 0);
});

test("unknown licence is rejected", async () => {
  const { db } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "unknown" }] });
  assert.equal(response.status, 400);
});

test("disabled licence is rejected", async () => {
  const { db, sqlite } = makeDb();
  sqlite.prepare("UPDATE licences SET enabled = 0 WHERE licence_key = 'mp3'").run();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
});

test("unavailable beat/licence offering is rejected", async () => {
  const { db } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-c", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
});

test("missing package key is rejected", async () => {
  const { db, sqlite } = makeDb();
  sqlite.prepare("UPDATE beat_licences SET package_key = ' ' WHERE beat_id = 'beat-a' AND licence_key = 'mp3'").run();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
});

test("invalid licence price is rejected", async () => {
  const { db, sqlite } = makeDb();
  sqlite.prepare("UPDATE beat_licences SET price = 0 WHERE beat_id = 'beat-a' AND licence_key = 'mp3'").run();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
});

test("duplicate selection is rejected", async () => {
  const { db } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [
    { beat_id: "beat-a", licence_key: "mp3" },
    { beat_id: "beat-a", licence_key: "mp3" }
  ] });
  assert.equal(response.status, 400);
});

test("exclusively sold beat is rejected", async () => {
  const { db, sqlite } = makeDb();
  sqlite.prepare("INSERT INTO exclusive_sales (beat_id, order_id, order_item_id, reference, email, price, package_key) VALUES ('beat-a', 'old-order', 'old-item', 'old-ref', 'buyer@example.com', 4500, 'beats/a.zip')").run();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
});

test("invalid email is rejected", async () => {
  const { db } = makeDb();
  const response = await postOrder(db, { email: "not-an-email", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  assert.equal(response.status, 400);
});

test("D1 batch failure at order_items insert leaves no partial order", async () => {
  const { db, sqlite } = makeDb({ failOrderItemInsert: true });
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  const data = await response.json();
  assert.equal(response.status, 500);
  assert.equal(data.success, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM order_items").get().n, 0);
});

test("snapshots remain unchanged after the offering is edited", async () => {
  const { db, sqlite } = makeDb();
  const response = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  const data = await response.json();
  assert.equal(response.status, 201);

  sqlite.prepare("UPDATE beats SET title = 'Renamed Beat' WHERE id = 'beat-a'").run();
  sqlite.prepare("UPDATE licences SET label = 'Renamed Licence' WHERE licence_key = 'mp3'").run();
  sqlite.prepare("UPDATE beat_licences SET price = 9000, package_key = 'beats/beat-a-repriced.zip' WHERE beat_id = 'beat-a' AND licence_key = 'mp3'").run();

  const snapshot = sqlite.prepare("SELECT beat_title, licence_key, licence_label, price, package_key FROM order_items WHERE order_id = ?").get(data.order.id);
  assert.deepEqual(snapshot, {
    beat_title: "Beat A",
    licence_key: "mp3",
    licence_label: "MP3 License",
    price: 4500,
    package_key: "beats/beat-a-mp3.zip"
  });
});

test("each successful order has a unique reference", async () => {
  const { db, sqlite } = makeDb();
  const first = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-a", licence_key: "mp3" }] });
  const second = await postOrder(db, { email: "buyer@example.com", items: [{ beat_id: "beat-c", licence_key: "mp3_wav" }] });
  const firstOrder = await first.json();
  const secondOrder = await second.json();
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(firstOrder.reference, secondOrder.reference);
  assert.equal(sqlite.prepare("SELECT COUNT(DISTINCT reference) AS n FROM orders").get().n, 2);
});
