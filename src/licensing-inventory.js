// ==========================================
// LICENSING INVENTORY RULES
//
// Shared by order creation (src/phase2-worker.js) and payment/fulfilment
// (src/licensing-checkout.js) so the same three rules are applied at every
// check point:
//
//   1. A beat with an `exclusive_sales` row is sold: EVERY licence is blocked,
//      for good. The row is never removed.
//   2. A beat with an ACTIVE reservation can still be licensed non-exclusively;
//      only the `exclusive` licence is blocked.
//   3. Reservations never expire on their own. An active reservation stays
//      active until an administrator releases it. Nothing here sweeps, expires
//      or times out a reservation.
//
// Samples and Studio Tools have no inventory of this kind: they are not beats
// and are never exclusive.
// ==========================================

// The single purchase tier used by the non-beat catalogues. It is deliberately
// NOT one of the four beat licence keys: it grants the product's ZIP package
// and carries no tiered rights.
export const LEGACY_PRODUCT_TIER = Object.freeze({
  key: "standard",
  label: "Standard License"
});

export const NON_BEAT_CATEGORIES = Object.freeze(["samples", "studio-tools"]);

export function isNonBeatCategory(category) {
  return NON_BEAT_CATEGORIES.includes(category);
}

// Returns the first blocking conflict, or null when every item may be sold.
// `items` need `category`, `beat_id` and `licence_key`.
export async function findInventoryConflict(env, items) {
  for (const item of items) {
    const category = item.category || "beats";
    if (category !== "beats") continue;

    const sold = await env.DB.prepare(
      "SELECT beat_id FROM exclusive_sales WHERE beat_id = ?"
    ).bind(item.beat_id).first();
    if (sold) {
      return { beatId: item.beat_id, licenceKey: item.licence_key, reason: "sold" };
    }

    if (item.licence_key !== "exclusive") continue;

    // Only an active reservation blocks, and only the exclusive licence. The
    // partial unique index guarantees at most one active row per beat.
    const reserved = await env.DB.prepare(
      "SELECT id FROM exclusive_reservations WHERE beat_id = ? AND status = 'active'"
    ).bind(item.beat_id).first();
    if (reserved) {
      return {
        beatId: item.beat_id,
        licenceKey: item.licence_key,
        reason: "reserved",
        reservationId: reserved.id
      };
    }
  }
  return null;
}

export function inventoryConflictMessage(conflict) {
  if (!conflict) return null;
  if (conflict.reason === "reserved") {
    return "This beat is currently reserved for an exclusive deal and cannot be sold exclusively.";
  }
  return "This beat has already been sold exclusively.";
}

// Immutable packages are uploaded under a versioned key (-v<n>.zip). The
// version is snapshotted with the order for provenance; the key itself is what
// the entitlement replays.
export function packageVersionFromKey(key) {
  const match = /-v(\d+)\.zip$/i.exec(String(key || ""));
  return match ? Number(match[1]) : null;
}

// Next version for a replacement package. Derived from the key currently
// pointed at, so a replacement never reuses a version an entitlement already
// records.
export function nextPackageVersion(currentKey) {
  const version = packageVersionFromKey(currentKey);
  return version ? version + 1 : 1;
}
