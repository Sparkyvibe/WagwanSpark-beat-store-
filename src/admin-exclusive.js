// ==========================================
// ADMIN — EXCLUSIVE INVENTORY CONTROLS
//
// Exclusive reservations are held indefinitely. Nothing in the Worker expires,
// sweeps or times them out; the ONLY way a reservation stops blocking an
// exclusive purchase is a person releasing it here. A completed exclusive sale
// is permanent and is never written over.
//
//   GET  /api/admin/exclusive/reservations            list them
//   POST /api/admin/exclusive/reservations/release    release one active hold
//
// Both require the existing admin session; the POST also requires the CSRF
// token, exactly like the other admin writes.
// ==========================================
import { requireAdmin } from "./index.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function listReservations(env) {
  const result = await env.DB.prepare(
    `SELECT r.id, r.beat_id, r.email, r.amount, r.reference, r.status,
            r.expires_at, r.created_at, r.updated_at,
            b.title AS beat_title,
            s.beat_id AS sold_beat_id
       FROM exclusive_reservations r
       LEFT JOIN beats b ON b.id = r.beat_id
       LEFT JOIN exclusive_sales s ON s.beat_id = r.beat_id
      ORDER BY r.status = 'active' DESC, r.created_at DESC
      LIMIT 200`
  ).all();
  return result.results || [];
}

async function releaseReservation(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid request." }, 400);
  }
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id || id.length > 80) {
    return json({ success: false, error: "Select a reservation to release." }, 400);
  }

  const reservation = await env.DB.prepare(
    "SELECT id, beat_id, status FROM exclusive_reservations WHERE id = ?"
  ).bind(id).first();
  if (!reservation) {
    return json({ success: false, error: "Reservation not found." }, 404);
  }
  if (reservation.status !== "active") {
    return json({
      success: false,
      error: `This reservation is already ${reservation.status}.`
    }, 409);
  }

  // A sold beat stays sold: releasing a stale hold must never reopen it.
  const sold = await env.DB.prepare(
    "SELECT beat_id FROM exclusive_sales WHERE beat_id = ?"
  ).bind(reservation.beat_id).first();

  const statements = [
    env.DB.prepare(
      "UPDATE exclusive_reservations SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'"
    ).bind(id),
    env.DB.prepare(
      `INSERT INTO licence_events (id, entity_type, entity_id, event_type, actor, payload)
       VALUES (?, 'reservation', ?, 'released', 'admin', ?)`
    ).bind(
      `evt_${randomHex(12)}`,
      id,
      JSON.stringify({ beatId: reservation.beat_id, beatAlreadySold: Boolean(sold) })
    )
  ];

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error("Exclusive reservation release failed:", error);
    return json({ success: false, error: "Could not release the reservation." }, 500);
  }

  return json({
    success: true,
    released: id,
    beat_id: reservation.beat_id,
    beat_sold: Boolean(sold)
  });
}

export async function handleAdminExclusive(request, env, url) {
  if (!env.DB) {
    return json({ success: false, error: "Database is not configured." }, 500);
  }

  const path = url.pathname;

  if (path === "/api/admin/exclusive/reservations" && request.method === "GET") {
    const auth = await requireAdmin(request, env, false);
    if (auth.response) return auth.response;
    const reservations = await listReservations(env);
    return json({ success: true, reservations });
  }

  if (
    path === "/api/admin/exclusive/reservations/release" &&
    request.method === "POST"
  ) {
    const auth = await requireAdmin(request, env, true);
    if (auth.response) return auth.response;
    return releaseReservation(request, env);
  }

  return null;
}

export function isAdminExclusivePath(pathname) {
  return pathname.startsWith("/api/admin/exclusive/");
}
