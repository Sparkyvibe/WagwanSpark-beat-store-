/**
 * Regression test for the featured carousel navigation race condition.
 *
 * Issue 2 — Navigation race condition:
 *   When a user clicks Next then Previous within 900 ms, the first click's
 *   900 ms fallback setTimeout can fire after the second click has already
 *   started a new smooth scroll, overriding the newer scroll target with
 *   the stale one.
 *
 * The fix: track the pending fallback timer and its target in closure
 * variables (featuredScrollTimer / featuredScrollTarget). Each new call to
 * scrollFeaturedCarousel clears the previous timer before starting a new
 * scroll, so a stale fallback can never override a newer click.
 *
 * This test replicates the fixed scrollFeaturedCarousel logic from
 * public/app.js and verifies the timer is cleared on re-entry.
 */

const { test } = require("node:test");
const assert = require("node:assert");

// ── Fake timer system ──

let timers = [];
let timerIdCounter = 0;

function fakeSetTimeout(fn, delay) {
  const id = ++timerIdCounter;
  timers.push({ id, fn, delay, fired: false });
  return id;
}

function fakeClearTimeout(id) {
  const timer = timers.find(t => t.id === id);
  if (timer) timer.cleared = true;
}

function runPendingTimers() {
  const pending = timers.filter(t => !t.fired && !t.cleared);
  pending.forEach(t => {
    t.fired = true;
    t.fn();
  });
  return pending.length;
}

function resetTimers() {
  timers = [];
  timerIdCounter = 0;
}

// ── Mock DOM track element ──

function createMockTrack(scrollWidth, clientWidth, cardWidth, gap) {
  return {
    scrollLeft: 0,
    scrollWidth,
    clientWidth,
    scrollTo: function (options) {
      // Simulate smooth scroll: update scrollLeft to the target
      // (in a real browser this would animate, but for testing we
      // just set it immediately unless behavior is "auto")
      if (options.behavior === "auto") {
        this.scrollLeft = options.left;
      } else {
        // Smooth: don't update immediately (the fallback timer would)
        // Leave scrollLeft where it is; the fallback timer "finishes" it
        this._pendingTarget = options.left;
      }
    },
    _cardWidth: cardWidth,
    _gap: gap
  };
}

// ── Replicated scrollFeaturedCarousel (with the fix) ──

let featuredScrollTimer = 0;
let featuredScrollTarget = 0;

function scrollFeaturedCarousel(direction, track) {
  if (!track) return;

  // Cancel any pending fallback from a previous arrow click.
  if (featuredScrollTimer) {
    fakeClearTimeout(featuredScrollTimer);
    featuredScrollTimer = 0;
  }

  const gap = track._gap;
  const step = track._cardWidth + gap;
  const perView = Math.max(1, Math.floor((track.clientWidth + gap) / step));

  const maxScroll = track.scrollWidth - track.clientWidth;
  const target = Math.max(0, Math.min(
    maxScroll,
    track.scrollLeft + direction * step * perView
  ));

  featuredScrollTarget = target;
  track.scrollTo({ left: target, behavior: "smooth" });

  // Fallback: finish the move if smooth scroll stalls.
  featuredScrollTimer = fakeSetTimeout(() => {
    featuredScrollTimer = 0;
    if (Math.abs(track.scrollLeft - featuredScrollTarget) > step / 2) {
      track.scrollTo({ left: featuredScrollTarget, behavior: "auto" });
    }
  }, 900);
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

test("Next click sets a 900ms fallback timer", () => {
  resetTimers();
  featuredScrollTimer = 0;
  featuredScrollTarget = 0;

  const track = createMockTrack(2000, 500, 200, 16);
  scrollFeaturedCarousel(1, track);

  assert.equal(timers.length, 1, "exactly one fallback timer scheduled");
  assert.equal(timers[0].delay, 900);
  assert.equal(featuredScrollTimer, timers[0].id);
  assert.notEqual(featuredScrollTarget, 0, "target was set");
});

test("Previous click within 900ms clears the previous fallback timer", () => {
  resetTimers();
  featuredScrollTimer = 0;
  featuredScrollTarget = 0;

  const track = createMockTrack(2000, 500, 200, 16);

  // 1. Click Next
  scrollFeaturedCarousel(1, track);
  const firstTimerId = featuredScrollTimer;
  assert.equal(timers.length, 1);

  // 2. Click Previous within 900ms (before the timer fires)
  scrollFeaturedCarousel(-1, track);

  // The first timer must be cleared
  const firstTimer = timers.find(t => t.id === firstTimerId);
  assert.ok(firstTimer.cleared, "first fallback timer was cleared");

  // A new timer was scheduled for the second click
  assert.equal(timers.length, 2);
  assert.notEqual(featuredScrollTimer, firstTimerId);
  assert.equal(featuredScrollTimer, timers[1].id);
});

test("stale fallback does not override newer scroll target", () => {
  resetTimers();
  featuredScrollTimer = 0;
  featuredScrollTarget = 0;

  const track = createMockTrack(2000, 500, 200, 16);

  // 1. Click Next → target moves forward
  scrollFeaturedCarousel(1, track);
  const nextTarget = featuredScrollTarget;
  assert.ok(nextTarget > 0, "Next moved target forward");

  // 2. Click Previous within 900ms → target moves back
  scrollFeaturedCarousel(-1, track);
  const prevTarget = featuredScrollTarget;
  assert.ok(prevTarget < nextTarget, "Previous moved target backward");

  // 3. Run all pending timers (simulates 900ms passing)
  // The first (stale) timer was cleared, so only the second fires.
  const fired = runPendingTimers();

  assert.equal(fired, 1, "only the second (latest) timer fired");
  assert.equal(
    featuredScrollTarget, prevTarget,
    "target is still the Previous click's target, not the stale Next target"
  );

  // The fallback should have scrolled to the Previous target, not the Next target
  // (In the test mock, smooth scroll doesn't update scrollLeft, so the fallback
  //  fires and sets it via behavior: "auto")
  assert.equal(
    track.scrollLeft, prevTarget,
    "track scrolled to the newer (Previous) target, not the stale (Next) one"
  );
});

test("multiple rapid clicks leave only the last timer active", () => {
  resetTimers();
  featuredScrollTimer = 0;
  featuredScrollTarget = 0;

  const track = createMockTrack(3000, 500, 200, 16);

  // Simulate 4 rapid clicks: Next, Next, Previous, Next
  scrollFeaturedCarousel(1, track);   // click 1
  scrollFeaturedCarousel(1, track);   // click 2
  scrollFeaturedCarousel(-1, track);  // click 3
  scrollFeaturedCarousel(1, track);   // click 4

  // 4 timers were scheduled, but only the last should be active
  assert.equal(timers.length, 4, "4 timers were scheduled");

  const cleared = timers.filter(t => t.cleared);
  assert.equal(cleared.length, 3, "3 stale timers were cleared");

  const active = timers.filter(t => !t.cleared);
  assert.equal(active.length, 1, "only 1 timer remains active");
  assert.equal(active[0].id, featuredScrollTimer, "active timer is the last one");
});

test("fallback fires normally when no race occurs", () => {
  resetTimers();
  featuredScrollTimer = 0;
  featuredScrollTarget = 0;

  const track = createMockTrack(2000, 500, 200, 16);

  scrollFeaturedCarousel(1, track);
  const target = featuredScrollTarget;

  // No subsequent click — let the timer fire
  const fired = runPendingTimers();
  assert.equal(fired, 1, "the fallback timer fired");
  assert.equal(featuredScrollTimer, 0, "timer id was cleared after firing");
  assert.equal(track.scrollLeft, target, "track scrolled to the target");
});
