/**
 * Regression tests for featured carousel ordering.
 *
 * Issue 1 — Legacy featured ordering:
 *   Beats featured before the carousel feature existed have NULL
 *   featured_position values. They must retain their sensible existing
 *   order (catalogue order = API response order). A newly featured beat
 *   must be appended AFTER all existing featured beats, including those
 *   with NULL positions.
 *
 * These tests replicate the sorting algorithm used in public/app.js
 * (featuredBeats) and public/admin.html (featuredBeatsInOrder), and the
 * SQL position-assignment logic from src/index.js (PATCH endpoint).
 */

const { test } = require("node:test");
const assert = require("node:assert");

// ── Frontend sorting logic (mirrors public/app.js featuredBeats) ──

function featuredBeats(products) {
  const position = product => {
    const value = Number(product.featured_position);
    return product.featured_position != null &&
      Number.isInteger(value) && value > 0 ? value : 0;
  };

  return products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => Number(product.featured) === 1)
    .sort((a, b) =>
      (position(a.product) - position(b.product)) || (a.index - b.index)
    )
    .map(({ product }) => product);
}

// ── Admin sorting logic (mirrors public/admin.html featuredBeatsInOrder) ──

function featuredBeatsInOrder(beats) {
  const position = item => {
    const value = Number(item.featured_position);
    return item.featured_position != null &&
      Number.isInteger(value) && value > 0 ? value : 0;
  };
  const published = item => String(item.published_at || item.created_at || "");

  return beats
    .filter(item =>
      Number(item.featured) === 1 && (item.category || "beats") === "beats"
    )
    .sort((a, b) =>
      (position(a) - position(b)) ||
      published(b).localeCompare(published(a)) ||
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );
}

// ── Backend position-assignment SQL (mirrors src/index.js PATCH) ──
// Simulates: SELECT MAX(COALESCE(featured_position, 0)) + 1
//            FROM beats WHERE featured = 1 AND category = ?
function nextFeaturedPosition(existingFeatured) {
  const maxPos = existingFeatured.reduce(
    (max, beat) => Math.max(max, Number(beat.featured_position) || 0),
    0
  );
  return maxPos + 1;
}

// ═══════════════════════════════════════════════════════════════
// Tests: Frontend sorting (app.js featuredBeats)
// ═══════════════════════════════════════════════════════════════

test("NULL-positioned featured beats retain catalogue order", () => {
  const products = [
    { id: "a", featured: 1, featured_position: null },
    { id: "b", featured: 1, featured_position: null },
    { id: "c", featured: 1, featured_position: null },
    { id: "d", featured: 0, featured_position: null }
  ];

  const result = featuredBeats(products).map(p => p.id);
  assert.deepEqual(result, ["a", "b", "c"]);
});

test("positioned beats sort by position, NULL beats first in catalogue order", () => {
  const products = [
    { id: "legacy-1", featured: 1, featured_position: null },
    { id: "pos-2", featured: 1, featured_position: 2 },
    { id: "legacy-2", featured: 1, featured_position: null },
    { id: "pos-1", featured: 1, featured_position: 1 },
    { id: "not-featured", featured: 0, featured_position: null }
  ];

  const result = featuredBeats(products).map(p => p.id);
  // NULL beats (position 0) come first in catalogue order, then positioned
  assert.deepEqual(result, ["legacy-1", "legacy-2", "pos-1", "pos-2"]);
});

test("newly featured beat with computed position appears after NULL beats", () => {
  // Simulate: 3 existing featured beats with NULL positions.
  // Backend assigns: MAX(COALESCE(NULL,0), COALESCE(NULL,0), COALESCE(NULL,0)) + 1 = 1
  const products = [
    { id: "legacy-a", featured: 1, featured_position: null },
    { id: "legacy-b", featured: 1, featured_position: null },
    { id: "legacy-c", featured: 1, featured_position: null },
    { id: "new-beat", featured: 1, featured_position: 1 }
  ];

  const result = featuredBeats(products).map(p => p.id);
  // NULL beats (position 0) sort before position 1
  assert.deepEqual(result, ["legacy-a", "legacy-b", "legacy-c", "new-beat"]);
});

test("newly featured beat appended after mix of NULL and positioned beats", () => {
  // Existing: NULL, NULL, position 3, position 5
  // Backend assigns: MAX(0, 0, 3, 5) + 1 = 6
  const products = [
    { id: "legacy-1", featured: 1, featured_position: null },
    { id: "pos-3", featured: 1, featured_position: 3 },
    { id: "legacy-2", featured: 1, featured_position: null },
    { id: "pos-5", featured: 1, featured_position: 5 },
    { id: "new-beat", featured: 1, featured_position: 6 }
  ];

  const result = featuredBeats(products).map(p => p.id);
  assert.deepEqual(result, ["legacy-1", "legacy-2", "pos-3", "pos-5", "new-beat"]);
});

test("all positioned beats sort by position", () => {
  const products = [
    { id: "c", featured: 1, featured_position: 3 },
    { id: "a", featured: 1, featured_position: 1 },
    { id: "b", featured: 1, featured_position: 2 },
    { id: "d", featured: 0, featured_position: null }
  ];

  const result = featuredBeats(products).map(p => p.id);
  assert.deepEqual(result, ["a", "b", "c"]);
});

// ═══════════════════════════════════════════════════════════════
// Tests: Admin sorting (admin.html featuredBeatsInOrder)
// ═══════════════════════════════════════════════════════════════

test("admin: NULL-positioned beats sort first by published_at DESC", () => {
  const beats = [
    { id: "old", featured: 1, featured_position: null, published_at: "2024-01-01", created_at: "2024-01-01", category: "beats" },
    { id: "new", featured: 1, featured_position: null, published_at: "2024-06-01", created_at: "2024-06-01", category: "beats" },
    { id: "pos1", featured: 1, featured_position: 1, published_at: "2024-03-01", created_at: "2024-03-01", category: "beats" }
  ];

  const result = featuredBeatsInOrder(beats).map(b => b.id);
  // NULL (position 0) first, sorted by published_at DESC: new, old
  // Then positioned: pos1
  assert.deepEqual(result, ["new", "old", "pos1"]);
});

test("admin: only beats category included", () => {
  const beats = [
    { id: "beat1", featured: 1, featured_position: null, category: "beats" },
    { id: "sample1", featured: 1, featured_position: null, category: "samples" }
  ];

  const result = featuredBeatsInOrder(beats).map(b => b.id);
  assert.deepEqual(result, ["beat1"]);
});

// ═══════════════════════════════════════════════════════════════
// Tests: Backend position-assignment SQL logic
// ═══════════════════════════════════════════════════════════════

test("backend: next position after all NULL beats is 1 (not before them)", () => {
  const existing = [
    { featured_position: null },
    { featured_position: null },
    { featured_position: null }
  ];
  // MAX(COALESCE(NULL,0), COALESCE(NULL,0), COALESCE(NULL,0)) + 1 = 0 + 1 = 1
  const pos = nextFeaturedPosition(existing);
  assert.equal(pos, 1);
  // In the frontend, NULL sorts as 0, so position 1 sorts after 0. Correct.
});

test("backend: next position after mix of NULL and positioned beats", () => {
  const existing = [
    { featured_position: null },
    { featured_position: null },
    { featured_position: 3 },
    { featured_position: 5 }
  ];
  // MAX(0, 0, 3, 5) + 1 = 6
  const pos = nextFeaturedPosition(existing);
  assert.equal(pos, 6);
});

test("backend: next position after all positioned beats", () => {
  const existing = [
    { featured_position: 1 },
    { featured_position: 2 },
    { featured_position: 3 }
  ];
  // MAX(1, 2, 3) + 1 = 4
  const pos = nextFeaturedPosition(existing);
  assert.equal(pos, 4);
});

test("backend: old COALESCE(MAX,0)+1 would give wrong result for all-NULL", () => {
  // Demonstrates the bug that was fixed:
  // Old: COALESCE(MAX(NULL,NULL,NULL), 0) + 1 = COALESCE(NULL, 0) + 1 = 1
  // This is the same numeric result, but with the OLD frontend (Infinity),
  // position 1 sorted BEFORE NULL (Infinity), putting the new beat first.
  // With the NEW frontend (0), position 1 sorts AFTER NULL (0). Fixed.
  const existing = [
    { featured_position: null },
    { featured_position: null }
  ];
  const oldResult = (existing.reduce(
    (max, b) => Math.max(max, b.featured_position), -Infinity
  ) || 0) + 1;  // old: COALESCE(MAX, 0) + 1
  assert.equal(oldResult, 1);

  const newResult = nextFeaturedPosition(existing);  // new: MAX(COALESCE,0) + 1
  assert.equal(newResult, 1);

  // Both give 1, but the fix is in the frontend: NULL now sorts as 0
  // (before position 1) instead of Infinity (after position 1).
  // Verify the frontend agrees:
  const products = [
    { id: "legacy-a", featured: 1, featured_position: null },
    { id: "legacy-b", featured: 1, featured_position: null },
    { id: "new", featured: 1, featured_position: 1 }
  ];
  const order = featuredBeats(products).map(p => p.id);
  assert.deepEqual(order, ["legacy-a", "legacy-b", "new"]);
});
