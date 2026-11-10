// Local demo catalogue — packages, package keys and the tier they back.
//
// The demo seed used to leave `zip_key` NULL, so 0002 recorded the three demo
// beats as `missing_package`, granted no tier, and GET /api/beat-licences
// returned `[]` in the sandbox. These tests pin the repair:
//
//   * every demo beat has a versioned package key (`beats/<id>-v1.zip`);
//   * the archive for that key is generated, is a valid ZIP, and is
//     byte-for-byte reproducible;
//   * the seed + migrations grant exactly one MP3 + WAV tier per demo beat, at
//     the beat's own price, whose package key names an archive we actually
//     wrote — no tier points at an invented path;
//   * setup is re-runnable, and a sandbox seeded before the packages existed is
//     repaired without repointing a key that is already set.
//
// Runs on Node's built-in test runner and built-in `node:sqlite`. No Wrangler,
// no R2, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { packageVersionFromKey } from "../src/licensing-inventory.js";
import {
  DEMO_BEATS,
  DEMO_TIER,
  buildDemoPackage,
  crc32,
  demoPackageKey,
  writeDemoPackages
} from "../.base44/demo-packages.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => readFileSync(join(root, relativePath), "utf8");

const BASE_SCHEMA = read(".base44/schema.sql");
const DEMO_SEED = read(".base44/demo-products.sql");
const DEMO_RECONCILE = read(".base44/demo-licences.sql");
const MIGRATION_SCHEMA = read("migrations/0001_licensing_schema.sql");
const MIGRATION_BACKFILL = read("migrations/0002_backfill_legacy_licence.sql");
const MIGRATION_UNIFIED = read("migrations/0004_unified_checkout.sql");

const BEAT_IDS = DEMO_BEATS.map(beat => beat.id).sort();

/** The dev-setup order: schema, seed, migrations, local reconciliation. */
function seededDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(BASE_SCHEMA);
  db.exec(DEMO_SEED);
  db.exec(MIGRATION_SCHEMA);
  db.exec(MIGRATION_BACKFILL);
  db.exec(MIGRATION_UNIFIED);
  db.exec(DEMO_RECONCILE);
  return db;
}

/** Walks a STORED archive's central directory and returns its entries. */
function zipEntries(archive) {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, "archive ends with an end-of-central-directory record");
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50, "central directory entry");
    const crc = archive.readUInt32LE(offset + 16);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, "local file header");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, crc, size, data: archive.subarray(start, start + size) });

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("every demo beat has a distinct, versioned package key", () => {
  const keys = new Set();
  for (const beatId of BEAT_IDS) {
    const key = demoPackageKey(beatId);
    assert.match(key, /^beats\/[a-z0-9-]+-v1\.zip$/, `${beatId} package key is versioned`);
    assert.equal(packageVersionFromKey(key), 1, `${beatId} version parses`);
    keys.add(key);
  }
  assert.equal(keys.size, BEAT_IDS.length, "no two demo beats share a package");
});

test("each demo package is a valid, reproducible ZIP archive", () => {
  for (const beat of DEMO_BEATS) {
    const archive = buildDemoPackage(beat);
    const entries = zipEntries(archive);

    assert.deepEqual(
      entries.map(entry => entry.name),
      ["LICENSE.txt", `audio/${beat.audio}`],
      `${beat.id} archive contents`
    );
    for (const entry of entries) {
      assert.equal(crc32(entry.data), entry.crc, `${beat.id} ${entry.name} CRC32`);
      assert.ok(entry.size > 0, `${beat.id} ${entry.name} is not empty`);
    }

    // The audio entry is the real preview file shipped in public/audio.
    const audio = readFileSync(join(root, "public", "audio", beat.audio));
    assert.deepEqual(
      entries.find(entry => entry.name.startsWith("audio/")).data,
      audio,
      `${beat.id} archive carries the preview audio`
    );
    assert.ok(buildDemoPackage(beat).equals(archive), `${beat.id} rebuild is byte-identical`);
  }
});

test("the seed's package keys are exactly the keys the generator produces", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(BASE_SCHEMA);
  db.exec(DEMO_SEED);

  const rows = db.prepare(
    "SELECT id, zip_key FROM beats WHERE category = 'beats' ORDER BY id"
  ).all().map(row => ({ id: row.id, zip_key: row.zip_key }));
  assert.deepEqual(
    rows,
    BEAT_IDS.map(beatId => ({ id: beatId, zip_key: demoPackageKey(beatId) }))
  );
});

test("a fresh setup grants one MP3 + WAV tier per demo beat, backed by a real archive", () => {
  const outDir = mkdtempSync(join(tmpdir(), "wagwanspark-demo-packages-"));
  const manifest = writeDemoPackages(outDir);
  assert.equal(manifest.length, BEAT_IDS.length, "one package per demo beat");

  const packages = new Map(manifest.map(entry => [entry.packageKey, entry]));
  assert.deepEqual([...packages.keys()].sort(), BEAT_IDS.map(demoPackageKey).sort());

  const db = seededDatabase();
  const tiers = db.prepare(
    `SELECT l.beat_id, l.licence_key, l.price AS licence_price, l.package_key,
            b.price AS beat_price
       FROM beat_licences l
       JOIN beats b ON b.id = l.beat_id
      WHERE l.enabled = 1
      ORDER BY l.beat_id`
  ).all();

  assert.deepEqual(tiers.map(tier => tier.beat_id), BEAT_IDS, "one tier per demo beat");
  for (const tier of tiers) {
    assert.equal(tier.licence_key, DEMO_TIER.key);
    assert.equal(tier.licence_price, tier.beat_price, "tier keeps the beat's price");

    const pkg = packages.get(tier.package_key);
    assert.ok(pkg, `${tier.beat_id} grants a package this setup wrote: ${tier.package_key}`);
    assert.ok(existsSync(pkg.file), `${tier.beat_id} archive exists on disk`);
    const archive = readFileSync(pkg.file);
    assert.ok(
      archive.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      `${tier.beat_id} archive has a ZIP local header`
    );
    assert.ok(zipEntries(archive).length > 0, `${tier.beat_id} archive is readable`);
  }

  assert.deepEqual(
    db.prepare("SELECT beat_id FROM licence_backfill_issues").all(),
    [],
    "no unresolved backfill exceptions"
  );
});

test("re-running the seed, backfill and reconciliation changes nothing", () => {
  const db = seededDatabase();
  const snapshot = () => ({
    licences: db.prepare(
      "SELECT beat_id, licence_key, price, package_key, enabled FROM beat_licences ORDER BY beat_id"
    ).all(),
    products: db.prepare("SELECT id, zip_key, price FROM beats ORDER BY id").all(),
    issues: db.prepare("SELECT beat_id, issue FROM licence_backfill_issues ORDER BY beat_id").all()
  });

  const before = snapshot();
  assert.ok(before.licences.length > 0, "first run granted tiers");

  db.exec(DEMO_SEED);
  db.exec(MIGRATION_BACKFILL);
  db.exec(DEMO_RECONCILE);

  assert.deepEqual(snapshot(), before);
});

test("a sandbox seeded before the packages existed is repaired without repointing a real key", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(BASE_SCHEMA);

  // The old seed: demo rows with no package key at all, and an operator's beat
  // whose package key is already set to something that is not ours.
  const insert = db.prepare(
    "INSERT INTO beats (id, title, price, category, status) VALUES (?, ?, ?, 'beats', 'published')"
  );
  for (const beat of DEMO_BEATS) insert.run(beat.id, beat.title, 7000);
  insert.run("operator-beat", "Operator Beat", 9000);
  db.prepare("UPDATE beats SET zip_key = 'beats/operator-beat-v3.zip' WHERE id = 'operator-beat'").run();

  db.exec(MIGRATION_SCHEMA);
  db.exec(MIGRATION_BACKFILL);

  // What the broken sandbox looked like: only the operator's beat was granted,
  // and all three demo beats were flagged.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM beat_licences").get().n, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM licence_backfill_issues WHERE issue = 'missing_package'").get().n,
    DEMO_BEATS.length
  );

  // The repair, in setup order: the seed fills only missing keys, the backfill
  // runs again (idempotent), then the reconciliation drops resolved exceptions.
  db.exec(DEMO_SEED);
  db.exec(MIGRATION_BACKFILL);
  db.exec(DEMO_RECONCILE);

  assert.deepEqual(
    db.prepare("SELECT beat_id, package_key FROM beat_licences WHERE enabled = 1 ORDER BY beat_id")
      .all().map(row => ({ beat_id: row.beat_id, package_key: row.package_key })),
    [
      { beat_id: "operator-beat", package_key: "beats/operator-beat-v3.zip" },
      { beat_id: "phenomenal", package_key: "beats/phenomenal-v1.zip" },
      { beat_id: "serenade", package_key: "beats/serenade-v1.zip" },
      { beat_id: "sun-fire", package_key: "beats/sun-fire-v1.zip" }
    ]
  );
  assert.deepEqual(db.prepare("SELECT beat_id FROM licence_backfill_issues").all(), []);
  assert.equal(
    db.prepare("SELECT zip_key FROM beats WHERE id = 'operator-beat'").get().zip_key,
    "beats/operator-beat-v3.zip",
    "an already-set package key is never replaced"
  );
});
