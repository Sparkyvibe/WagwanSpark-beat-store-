#!/usr/bin/env node
// ==========================================
// DEMO PACKAGES (local development only)
//
// The demo catalogue in .base44/demo-products.sql gives every demo beat a
// versioned package key — `beats/<beat>-v1.zip`, the same shape the admin ZIP
// upload writes. This script produces the real ZIP object for each of those
// keys, so the legacy licence backfill (migrations/0002) grants a tier that
// resolves to an actual object instead of a key nobody uploaded.
//
// Constraints this file is written to:
//   * dependency-free — only node:fs. The sandbox setup runs it before any
//     npm install, and the ZIP is written by hand with STORED entries;
//   * deterministic — fixed entry order, fixed timestamps, no compression, so
//     re-running it regenerates byte-identical archives. That is what makes
//     re-uploading a package key harmless to an entitlement already pointing
//     at it;
//   * additive — it only ever emits the v1 demo keys. It never writes the
//     mutable artwork/preview keys and never a v2+ replacement key.
//
// CLI (used by .base44/dev-setup.sh):
//   node .base44/demo-packages.mjs --out <dir>
// prints one `<beatId> <packageKey> <absoluteFilePath>` line per package.
// ==========================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// The tier the legacy backfill grants: the single ZIP the store sold before
// tiered licensing existed, advertised as MP3 + WAV.
export const DEMO_TIER = Object.freeze({
  key: "mp3_wav",
  label: "MP3 + WAV License"
});

// One entry per demo row in .base44/demo-products.sql. Keeping the list here
// (rather than reading it back out of D1) is what lets setup upload the objects
// before the database backfill runs.
export const DEMO_BEATS = Object.freeze([
  Object.freeze({ id: "sun-fire", title: "SUN FIRE", audio: "sun-fire-preview.mp3" }),
  Object.freeze({ id: "phenomenal", title: "PHENOMENAL", audio: "phenomenal-preview.mp3" }),
  Object.freeze({ id: "serenade", title: "SERENADE", audio: "serenade-preview.mp3" })
]);

export function demoPackageKey(beatId) {
  return `beats/${beatId}-v1.zip`;
}

// 2026-01-01 00:00:00 in MS-DOS date/time form — a constant so the archive
// bytes never depend on when it was built.
const DOS_DATE = (46 << 9) | (1 << 5) | 1; // year-1980=46, month=1, day=1
const DOS_TIME = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal ZIP writer: local file headers, central directory, EOCD. STORED only
// (no compression), which keeps a package small and the bytes reproducible.
export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    chunks.push(local, name, data);

    const directoryEntry = Buffer.alloc(46);
    directoryEntry.writeUInt32LE(0x02014b50, 0); // central directory signature
    directoryEntry.writeUInt16LE(20, 4); // version made by
    directoryEntry.writeUInt16LE(20, 6); // version needed
    directoryEntry.writeUInt16LE(0, 8);
    directoryEntry.writeUInt16LE(0, 10);
    directoryEntry.writeUInt16LE(DOS_TIME, 12);
    directoryEntry.writeUInt16LE(DOS_DATE, 14);
    directoryEntry.writeUInt32LE(crc, 16);
    directoryEntry.writeUInt32LE(data.length, 20);
    directoryEntry.writeUInt32LE(data.length, 24);
    directoryEntry.writeUInt16LE(name.length, 28);
    directoryEntry.writeUInt16LE(0, 30); // extra
    directoryEntry.writeUInt16LE(0, 32); // comment
    directoryEntry.writeUInt16LE(0, 34); // disk number
    directoryEntry.writeUInt16LE(0, 36); // internal attributes
    directoryEntry.writeUInt32LE(0, 38); // external attributes
    directoryEntry.writeUInt32LE(offset, 42);
    central.push(directoryEntry, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // EOCD signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralDirectory, end]);
}

function licenseText(beat) {
  return [
    `WagwanSpark Sound Lab — ${beat.title}`,
    `${DEMO_TIER.label} (demo package)`,
    "",
    "Local development package. It contains the demo preview audio for this",
    "beat, which is the only audio file this repository ships. Replace the",
    "package from the admin panel to test a real delivery.",
    ""
  ].join("\n");
}

export function buildDemoPackage(beat, { publicDir = join(repoRoot, "public") } = {}) {
  const audio = readFileSync(join(publicDir, "audio", beat.audio));
  return buildZip([
    { name: "LICENSE.txt", data: licenseText(beat) },
    { name: `audio/${beat.audio}`, data: audio }
  ]);
}

/** Every demo package: what to call it, where each archive lives, its bytes. */
export function demoPackageManifest(options = {}) {
  return DEMO_BEATS.map(beat => ({
    beatId: beat.id,
    packageKey: demoPackageKey(beat.id),
    licenceKey: DEMO_TIER.key,
    licenceLabel: DEMO_TIER.label,
    archive: buildDemoPackage(beat, options)
  }));
}

/** Writes the archives into `outDir` and returns the manifest (bytes omitted). */
export function writeDemoPackages(outDir, options = {}) {
  mkdirSync(outDir, { recursive: true });
  return demoPackageManifest(options).map(entry => {
    const file = join(outDir, `${entry.beatId}-v1.zip`);
    writeFileSync(file, entry.archive);
    return {
      beatId: entry.beatId,
      packageKey: entry.packageKey,
      licenceKey: entry.licenceKey,
      licenceLabel: entry.licenceLabel,
      file,
      bytes: entry.archive.length
    };
  });
}

function main(argv) {
  const outIndex = argv.indexOf("--out");
  const outDir = outIndex === -1 ? "/tmp/wagwanspark-demo-packages" : resolve(argv[outIndex + 1]);
  for (const entry of writeDemoPackages(outDir)) {
    process.stdout.write(`${entry.beatId} ${entry.packageKey} ${entry.file}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
