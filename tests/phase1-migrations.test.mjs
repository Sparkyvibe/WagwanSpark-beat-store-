// Phase 1 migration tests — schema, backfill, constraints, idempotency.
//
// Scope: the D1 migrations only. Nothing here exercises the Worker: the
// storefront, checkout, Paystack verification and download routes have NOT been
// integrated with these tables yet, so application-level licensing behaviour is
// deliberately untested.
//
// Runs on Node's built-in test runner and built-in `node:sqlite`, so there are
// no dependencies and no Wrangler, network or Cloudflare access involved.
//
//   npm test                # or: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

// The real production table shape, not a copy of it.
const BASE_SCHEMA = read(".base44/schema.sql");
const MIGRATION_SCHEMA = read("migrations/0001_licensing_schema.sql");
const MIGRATION_BACKFILL = read("migrations/0002_backfill_legacy_licence.sql");

const LICENSING_TABLES = [
  "licences",
  "beat_licences",
  "orders",
  "order_items",
  "entitlements",
  "exclusive_sales",
  "exclusive_reservations",
  "exclusive_offers",
  "licence_events",
  "webhook_events",
  "licence_backfill_issues",
];

// One row per case the backfill has to distinguish.
const FIXTURES = [
  // [id, title, price, zip_key, category]
  ["beat-a", "Beat A", 5000, "beats/beat-a.zip", "beats"],
  ["beat-b", "Beat B", 12500, "beats/beat-b.zip", "beats"],
  ["beat-no-package", "Beat No Package", 3000, null, "beats"],
  ["beat-blank-package", "Beat Blank Package", 2000, "   ", "beats"],
  ["beat-zero-price", "Beat Zero Price", 0, "beats/beat-zero-price.zip", "beats"],
  ["sample-1", "Sample One", 1500, "samples/sample-1.zip", "samples"],
  ["tool-1", "Tool One", 2500, "tools/tool-1.zip", "studio-tools"],
];

/** A database in the state a pre-Phase-1 production database is in. */
function freshDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(BASE_SCHEMA);

  // email_deliveries is created by the current Worker on first use; the
  // migration must adopt it without disturbing what is already stored.
  db.exec(`CREATE TABLE IF NOT EXISTS email_deliveries (
    reference TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  )`);
  db.prepare(
    "INSERT INTO email_deliveries (reference, recipient, status, sent_at) VALUES (?, ?, ?, ?)",
  ).run("ref-existing", "buyer@example.com", "sent", "2026-01-01 10:00:00");

  const insert = db.prepare(
    "INSERT INTO beats (id, title, price, zip_key, category) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [id, title, price, zipKey, category] of FIXTURES) {
    insert.run(id, title, price, zipKey, category);
  }
  return db;
}

const migrate = (db) => {
  db.exec(MIGRATION_SCHEMA);
  db.exec(MIGRATION_BACKFILL);
};

/** Runs both migrations `times` times over — the idempotency path. */
const migrateRepeatedly = (db, times) => {
  for (let i = 0; i < times; i += 1) migrate(db);
};

const rows = (db, sql, ...params) =>
  db
    .prepare(sql)
    .all(...params)
    .map((result) => ({ ...result }));

const row = (db, sql, ...params) => rows(db, sql, ...params)[0];

const tableNames = (db) =>
  rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);

const beatsSnapshot = (db) => rows(db, "SELECT * FROM beats ORDER BY id");

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

test("seeds exactly the four stable licence types", () => {
  const db = freshDatabase();
  migrate(db);

  assert.deepEqual(
    rows(db, "SELECT licence_key, label, sort_order, is_exclusive, enabled FROM licences ORDER BY sort_order"),
    [
      { licence_key: "mp3", label: "MP3 License", sort_order: 1, is_exclusive: 0, enabled: 1 },
      { licence_key: "mp3_wav", label: "MP3 + WAV License", sort_order: 2, is_exclusive: 0, enabled: 1 },
      { licence_key: "stems", label: "Stems License", sort_order: 3, is_exclusive: 0, enabled: 1 },
      { licence_key: "exclusive", label: "Exclusive License", sort_order: 4, is_exclusive: 1, enabled: 1 },
    ],
  );
});

test("running the schema migration twice keeps one row per licence type", () => {
  const db = freshDatabase();
  migrateRepeatedly(db, 2);

  assert.equal(row(db, "SELECT COUNT(*) AS n FROM licences").n, 4);
});

// ---------------------------------------------------------------------------
// Schema shape
// ---------------------------------------------------------------------------

test("creates the core licensing tables and the supporting tables", () => {
  const db = freshDatabase();
  migrate(db);

  const tables = tableNames(db);
  for (const name of [...LICENSING_TABLES, "email_deliveries", "beats"]) {
    assert.ok(tables.includes(name), `expected table ${name} to exist`);
  }
});

test("exposes the columns later phases depend on", () => {
  const db = freshDatabase();
  migrate(db);

  const columns = (table) => rows(db, `PRAGMA table_info(${table})`).map((c) => c.name);
  const expectColumns = (table, expected) => {
    for (const column of expected) {
      assert.ok(columns(table).includes(column), `${table}.${column} is missing`);
    }
  };

  expectColumns("beat_licences", ["beat_id", "licence_key", "price", "package_key", "enabled"]);
  expectColumns("orders", ["id", "reference", "email", "amount", "status"]);
  expectColumns("order_items", ["order_id", "beat_id", "licence_key", "price", "package_key", "beat_title"]);
  expectColumns("entitlements", ["order_item_id", "reference", "beat_id", "licence_key", "package_key", "status"]);
  expectColumns("exclusive_sales", ["beat_id", "order_item_id", "reference", "package_key"]);
  expectColumns("exclusive_reservations", ["beat_id", "status", "expires_at"]);
});

// ---------------------------------------------------------------------------
// Legacy backfill
// ---------------------------------------------------------------------------

test("backfills each legacy beat onto mp3_wav with its own price and zip key", () => {
  const db = freshDatabase();
  migrate(db);

  assert.deepEqual(
    rows(
      db,
      "SELECT beat_id, licence_key, price, package_key, enabled FROM beat_licences ORDER BY beat_id",
    ),
    [
      { beat_id: "beat-a", licence_key: "mp3_wav", price: 5000, package_key: "beats/beat-a.zip", enabled: 1 },
      { beat_id: "beat-b", licence_key: "mp3_wav", price: 12500, package_key: "beats/beat-b.zip", enabled: 1 },
    ],
  );
});

test("enables exactly one tier per backfilled beat", () => {
  const db = freshDatabase();
  migrate(db);

  assert.deepEqual(
    rows(db, "SELECT beat_id, COUNT(*) AS n FROM beat_licences WHERE enabled = 1 GROUP BY beat_id ORDER BY beat_id"),
    [
      { beat_id: "beat-a", n: 1 },
      { beat_id: "beat-b", n: 1 },
    ],
  );
});

test("flags beats with no package reference instead of enabling them", () => {
  const db = freshDatabase();
  migrate(db);

  assert.deepEqual(
    rows(db, "SELECT beat_id, issue FROM licence_backfill_issues ORDER BY beat_id"),
    [
      { beat_id: "beat-blank-package", issue: "missing_package" },
      { beat_id: "beat-no-package", issue: "missing_package" },
      { beat_id: "beat-zero-price", issue: "invalid_price" },
    ],
  );

  for (const beatId of ["beat-no-package", "beat-blank-package", "beat-zero-price"]) {
    assert.equal(
      row(db, "SELECT COUNT(*) AS n FROM beat_licences WHERE beat_id = ?", beatId).n,
      0,
      `${beatId} must not get a licence`,
    );
  }
});

test("flags a beat whose price is not positive rather than granting a free tier", () => {
  const db = freshDatabase();
  migrate(db);

  assert.deepEqual(
    row(db, "SELECT issue FROM licence_backfill_issues WHERE beat_id = 'beat-zero-price'"),
    { issue: "invalid_price" },
  );
});

// ---------------------------------------------------------------------------
// Existing data is untouched
// ---------------------------------------------------------------------------

test("leaves samples, studio tools and every existing beat row unchanged", () => {
  const db = freshDatabase();
  const before = beatsSnapshot(db);

  migrate(db);

  assert.deepEqual(beatsSnapshot(db), before);
  assert.deepEqual(
    rows(db, "SELECT beat_id FROM beat_licences WHERE beat_id IN ('sample-1', 'tool-1')"),
    [],
  );
  assert.deepEqual(
    rows(db, "SELECT beat_id FROM licence_backfill_issues WHERE beat_id IN ('sample-1', 'tool-1')"),
    [],
  );
});

test("leaves existing email delivery records untouched", () => {
  const db = freshDatabase();
  migrate(db);

  assert.deepEqual(
    row(db, "SELECT reference, recipient, status, sent_at FROM email_deliveries"),
    {
      reference: "ref-existing",
      recipient: "buyer@example.com",
      status: "sent",
      sent_at: "2026-01-01 10:00:00",
    },
  );
});

// ---------------------------------------------------------------------------
// Constraints and indexes
// ---------------------------------------------------------------------------

test("refuses an enabled licence with no package", () => {
  const db = freshDatabase();
  migrate(db);

  assert.throws(
    () =>
      db
        .prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)")
        .run("beat-a", "stems", 9000, null),
    /constraint/i,
  );
});

test("refuses an enabled licence without a positive price", () => {
  const db = freshDatabase();
  migrate(db);

  assert.throws(
    () =>
      db
        .prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)")
        .run("beat-a", "stems", 0, "beats/beat-a-stems.zip"),
    /constraint/i,
  );
});

test("refuses a second row for the same beat and licence", () => {
  const db = freshDatabase();
  migrate(db);

  assert.throws(
    () =>
      db
        .prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, ?, ?, 1)")
        .run("beat-a", "mp3_wav", 999, "beats/other.zip"),
    /UNIQUE|constraint/i,
  );
});

test("allows a disabled placeholder row without price or package", () => {
  const db = freshDatabase();
  migrate(db);

  db.prepare("INSERT INTO beat_licences (beat_id, licence_key, price, package_key, enabled) VALUES (?, ?, NULL, NULL, 0)")
    .run("beat-a", "stems");

  assert.equal(
    row(db, "SELECT enabled FROM beat_licences WHERE beat_id = 'beat-a' AND licence_key = 'stems'").enabled,
    0,
  );
});

test("holds at most one active reservation per beat, and frees the slot on release", () => {
  const db = freshDatabase();
  migrate(db);

  const reserve = (id) =>
    db
      .prepare(
        "INSERT INTO exclusive_reservations (id, beat_id, email, expires_at) VALUES (?, ?, ?, datetime('now', '+48 hours'))",
      )
      .run(id, "beat-a", "buyer@example.com");

  reserve("res-1");
  assert.throws(() => reserve("res-2"), /UNIQUE|constraint/i);

  db.prepare("UPDATE exclusive_reservations SET status = 'released' WHERE id = 'res-1'").run();
  reserve("res-3");

  assert.deepEqual(
    rows(db, "SELECT id, status FROM exclusive_reservations WHERE beat_id = 'beat-a' AND status = 'active'"),
    [{ id: "res-3", status: "active" }],
  );
});

test("permits only one exclusive sale per beat, permanently", () => {
  const db = freshDatabase();
  migrate(db);

  const sell = (orderId, itemId, reference) =>
    db
      .prepare(
        "INSERT INTO exclusive_sales (beat_id, order_id, order_item_id, reference, email, price, package_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("beat-a", orderId, itemId, reference, "buyer@example.com", 250000, "beats/beat-a-exclusive.zip");

  sell("order-1", "item-1", "ref-1");
  assert.throws(() => sell("order-2", "item-2", "ref-2"), /UNIQUE|constraint/i);
});

test("treats the Paystack reference as unique on orders", () => {
  const db = freshDatabase();
  migrate(db);

  const createOrder = (id) =>
    db
      .prepare("INSERT INTO orders (id, reference, email, amount) VALUES (?, ?, ?, ?)")
      .run(id, "ref-same", "buyer@example.com", 500000);

  createOrder("order-1");
  assert.throws(() => createOrder("order-2"), /UNIQUE|constraint/i);
});

test("prevents duplicate entitlements for the same purchase", () => {
  const db = freshDatabase();
  migrate(db);

  const grant = (id, itemId) =>
    db
      .prepare(
        "INSERT INTO entitlements (id, order_id, order_item_id, reference, email, beat_id, licence_key, package_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, "order-1", itemId, "ref-1", "buyer@example.com", "beat-a", "mp3_wav", "beats/beat-a.zip");

  grant("ent-1", "item-1");
  // Same purchase, new row id, same (reference, beat, licence) triple.
  assert.throws(() => grant("ent-2", "item-2"), /UNIQUE|constraint/i);
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("is idempotent: running both migrations three times changes nothing", () => {
  const db = freshDatabase();
  migrate(db);

  const snapshot = () => ({
    licences: rows(db, "SELECT * FROM licences ORDER BY licence_key"),
    beatLicences: rows(db, "SELECT * FROM beat_licences ORDER BY beat_id, licence_key"),
    issues: rows(db, "SELECT * FROM licence_backfill_issues ORDER BY beat_id"),
    beats: beatsSnapshot(db),
    emails: rows(db, "SELECT * FROM email_deliveries ORDER BY reference"),
  });

  const first = snapshot();
  migrateRepeatedly(db, 2);

  assert.deepEqual(snapshot(), first);
});
