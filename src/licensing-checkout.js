// ==========================================
// PHASE 3 — LICENSING PAYMENT + FULFILMENT
//
// Bridges the Phase 2 licensing orders (created by src/phase2-worker.js on
// POST /api/create-order) to Paystack and to entitlements:
//
//   POST /api/licensing/create-payment  -> Paystack initialize for a pending order
//   POST /api/paystack-webhook          -> licensing orders fulfilled before the
//                                          legacy webhook is ever consulted
//   GET  /api/verify-payment            -> licensing orders fulfilled on return
//                                          from Paystack (webhook fallback)
//   GET  /api/licensing/download        -> streams the exact R2 package an
//                                          entitlement granted
//
// Everything here is additive: legacy /api/create-payment, /api/verify-payment,
// /api/paystack-webhook and /api/download keep running untouched for the old
// beat/product checkout. A request is only treated as licensing when its
// reference exists in the `orders` table written by Phase 2.
//
// Money rules: the client never supplies an amount. The Paystack amount is the
// stored `orders.amount` (kobo) and a verified transaction must match it.
// ==========================================
const PAYSTACK_API = "https://api.paystack.co";
const MAX_REQUEST_BYTES = 16 * 1024;
const VERIFY_DOWNLOAD_TOKEN_LIFETIME = 30 * 60 * 1000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value) {
  value = value.replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret, payload, hash) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  ));
}

// Same contract as the legacy worker: HMAC-SHA512 over the raw body, hex.
async function verifyWebhookSignature(rawBody, signature, secret) {
  try {
    if (!signature || !secret) return false;
    const expected = Array.from(await hmac(secret, rawBody, "SHA-512"))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
    if (signature.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < signature.length; i++) {
      difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return difference === 0;
  } catch {
    return false;
  }
}

async function createSignedToken(data, secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(data)));
  return `${payload}.${base64url(await hmac(secret, payload, "SHA-256"))}`;
}

async function verifySignedToken(token, secret) {
  try {
    if (!token || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    if (base64url(await hmac(secret, payload, "SHA-256")) !== signature) return null;
    const data = JSON.parse(new TextDecoder().decode(base64urlDecode(payload)));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

async function readJsonBody(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    return { tooLarge: true };
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { invalid: true };
    }
    return { body };
  } catch {
    return { invalid: true };
  }
}

async function loadOrder(env, { id, reference }) {
  if (id) {
    return env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  }
  return env.DB.prepare("SELECT * FROM orders WHERE reference = ?")
    .bind(reference)
    .first();
}

async function loadOrderItems(env, orderId) {
  const result = await env.DB.prepare(
    "SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at, id"
  ).bind(orderId).all();
  return result.results || [];
}

async function findSoldExclusiveBeat(env, items) {
  for (const item of items) {
    if (item.licence_key !== "exclusive") continue;
    const sold = await env.DB.prepare(
      "SELECT beat_id FROM exclusive_sales WHERE beat_id = ?"
    ).bind(item.beat_id).first();
    if (sold) return item.beat_id;
  }
  return null;
}

async function logEvents(env, statements, entityId, eventType, actor, payload) {
  statements.push(env.DB.prepare(
    "INSERT INTO licence_events (id, entity_type, entity_id, event_type, actor, payload) VALUES (?, 'order', ?, ?, ?, ?)"
  ).bind(`evt_${randomHex(12)}`, entityId, eventType, actor, JSON.stringify(payload)));
}

async function findPaymentInitialization(env, orderId) {
  const row = await env.DB.prepare(
    "SELECT payload FROM licence_events WHERE entity_type = 'order' AND entity_id = ? AND event_type = 'payment_initialized' ORDER BY created_at DESC LIMIT 1"
  ).bind(orderId).first();
  if (!row || !row.payload) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

async function verifyPaystackTransaction(reference, env) {
  const response = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || !result.status || !result.data) {
    throw new Error("Paystack transaction verification failed.");
  }
  return result.data;
}

function assertTransactionMatchesOrder(transaction, order) {
  if (transaction.status !== "success") {
    throw new Error("Paystack transaction is not successful.");
  }
  if (transaction.reference !== order.reference) {
    throw new Error("Payment reference does not match the order.");
  }
  if (transaction.currency !== order.currency) {
    throw new Error("Payment currency does not match the order.");
  }
  if (
    !Number.isSafeInteger(Number(transaction.amount)) ||
    Number(transaction.amount) !== order.amount
  ) {
    throw new Error("Payment amount does not match the order.");
  }
}

// ---------------------------------------------------------------------------
// POST /api/licensing/create-payment
// Initialises (or re-reports) the Paystack transaction for a pending order.
// ---------------------------------------------------------------------------
export async function handleLicensingCreatePayment(request, env, url) {
  if (!env.DB) {
    return json({ success: false, error: "Order service is not configured." }, 500);
  }
  if (!env.PAYSTACK_SECRET_KEY) {
    return json({ success: false, error: "Payment service is not configured." }, 500);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ success: false, error: "Request is too large." }, 413);
  }

  const parsed = await readJsonBody(request);
  if (parsed.tooLarge) {
    return json({ success: false, error: "Request is too large." }, 413);
  }
  if (parsed.invalid) {
    return json({ success: false, error: "Invalid request." }, 400);
  }

  const orderId = typeof parsed.body.order_id === "string"
    ? parsed.body.order_id.trim()
    : "";
  const reference = typeof parsed.body.reference === "string"
    ? parsed.body.reference.trim()
    : "";
  if (!orderId && !reference) {
    return json({ success: false, error: "Provide the order to pay for." }, 400);
  }
  if ((orderId && orderId.length > 80) || (reference && reference.length > 200)) {
    return json({ success: false, error: "Provide the order to pay for." }, 400);
  }

  const order = await loadOrder(env, orderId ? { id: orderId } : { reference });
  if (!order) {
    return json({ success: false, error: "Order not found." }, 404);
  }
  if (order.status !== "pending") {
    return json({
      success: false,
      error: "This order is no longer awaiting payment.",
      order: { id: order.id, reference: order.reference, status: order.status }
    }, 409);
  }

  const items = await loadOrderItems(env, order.id);
  if (!items.length) {
    return json({ success: false, error: "This order has no items." }, 409);
  }

  const soldBeat = await findSoldExclusiveBeat(env, items);
  if (soldBeat) {
    return json({
      success: false,
      error: "This beat has already been sold exclusively."
    }, 409);
  }

  // A retried click must not open a second Paystack transaction for the same
  // order; the first authorization URL is replayed instead.
  const existing = await findPaymentInitialization(env, order.id);
  if (existing && existing.authorization_url) {
    return json({
      success: true,
      duplicate: true,
      order: {
        id: order.id,
        reference: order.reference,
        email: order.email,
        currency: order.currency,
        amount: order.amount,
        status: order.status
      },
      authorization_url: existing.authorization_url,
      access_code: existing.access_code || null,
      reference: order.reference
    });
  }

  let result;
  try {
    const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: order.email,
        amount: order.amount,
        currency: order.currency,
        reference: order.reference,
        callback_url: `${url.origin}/success?reference=${encodeURIComponent(order.reference)}`,
        metadata: {
          licensing: "true",
          orderId: order.id,
          itemCount: String(items.length),
          beatIds: JSON.stringify(items.map(item => item.beat_id))
        }
      })
    });
    result = await response.json().catch(() => null);
    if (
      !response.ok ||
      !result ||
      !result.status ||
      !result.data?.authorization_url ||
      result.data?.reference !== order.reference
    ) {
      console.error("Licensing Paystack initialization failed:", result?.message);
      return json({
        success: false,
        error: "Unable to start the payment. Please try again."
      }, 502);
    }
  } catch (error) {
    console.error("Licensing payment initialization error:", error);
    return json({
      success: false,
      error: "Unable to start the payment. Please try again."
    }, 502);
  }

  try {
    const statements = [];
    await logEvents(env, statements, order.id, "payment_initialized", "buyer", {
      reference: order.reference,
      authorization_url: result.data.authorization_url,
      access_code: result.data.access_code || null
    });
    await env.DB.batch(statements);
  } catch (error) {
    // The payment is already open at Paystack; a missing audit row must not
    // stop the buyer from paying.
    console.error("Licensing payment audit write failed:", error);
  }

  return json({
    success: true,
    order: {
      id: order.id,
      reference: order.reference,
      email: order.email,
      currency: order.currency,
      amount: order.amount,
      status: order.status
    },
    authorization_url: result.data.authorization_url,
    access_code: result.data.access_code || null,
    reference: order.reference
  });
}

// ---------------------------------------------------------------------------
// Fulfilment — shared by the webhook and the verified-payment fallback.
// Idempotent: repeated calls for the same reference grant each entitlement once.
// ---------------------------------------------------------------------------
export async function fulfilLicensingOrder(env, reference, actor) {
  const order = await loadOrder(env, { reference });
  if (!order) return { handled: false };

  if (order.status === "failed" || order.status === "refunded") {
    return { handled: true, status: order.status, entitlements: 0 };
  }

  const transaction = await verifyPaystackTransaction(reference, env);
  assertTransactionMatchesOrder(transaction, order);

  const items = await loadOrderItems(env, order.id);
  if (!items.length) {
    throw new Error("Licensing order has no items.");
  }

  const statements = [];
  statements.push(env.DB.prepare(
    "UPDATE orders SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
  ).bind(order.id));

  for (const item of items) {
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO entitlements
        (id, order_id, order_item_id, reference, email, beat_id, licence_key, package_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `ent_${randomHex(12)}`,
      order.id,
      item.id,
      order.reference,
      order.email,
      item.beat_id,
      item.licence_key,
      item.package_key
    ));
  }

  const exclusiveItems = items.filter(item => item.licence_key === "exclusive");
  for (const item of exclusiveItems) {
    statements.push(env.DB.prepare(
      `INSERT INTO exclusive_sales
        (beat_id, order_id, order_item_id, reference, email, price, package_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      item.beat_id,
      order.id,
      item.id,
      order.reference,
      order.email,
      item.price,
      item.package_key
    ));
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (!exclusiveItems.length) throw error;
    // Another order won the exclusive sale first. The payment is real, so the
    // order is parked for a human decision instead of granting rights the
    // catalogue already sold away.
    console.error("Licensing exclusive sale conflict:", error);
    const parked = [];
    parked.push(env.DB.prepare(
      "UPDATE orders SET status = 'manual_review', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'paid')"
    ).bind(order.id));
    await logEvents(env, parked, order.id, "exclusive_conflict", actor, {
      reference: order.reference,
      beats: exclusiveItems.map(item => item.beat_id)
    });
    try {
      await env.DB.batch(parked);
    } catch (parkError) {
      console.error("Licensing manual-review write failed:", parkError);
    }
    return { handled: true, status: "manual_review", entitlements: 0 };
  }

  const events = [];
  await logEvents(env, events, order.id, "order_paid", actor, {
    reference: order.reference,
    itemCount: items.length,
    amount: order.amount
  });
  try {
    await env.DB.batch(events);
  } catch (error) {
    console.error("Licensing order event write failed:", error);
  }

  const granted = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM entitlements WHERE order_id = ?"
  ).bind(order.id).first();

  return {
    handled: true,
    status: "paid",
    entitlements: Number(granted?.count || 0)
  };
}

// ---------------------------------------------------------------------------
// POST /api/paystack-webhook — licensing first, legacy second.
// Returns { delegate: Request } when the reference is not a licensing order.
// ---------------------------------------------------------------------------
export async function handleLicensingWebhook(request, env) {
  if (!env.PAYSTACK_SECRET_KEY || !env.DB) return null;

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature") || "";
  if (!(await verifyWebhookSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY))) {
    return json({ error: "Invalid webhook signature." }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid webhook payload." }, 400);
  }

  if (event.event !== "charge.success") {
    return json({ received: true, ignored: true });
  }

  const reference = event.data?.reference;
  if (typeof reference !== "string" || !reference || reference.length > 200) {
    return json({ error: "Invalid payment reference." }, 400);
  }

  const order = await loadOrder(env, { reference });
  if (!order) {
    // Legacy purchase: hand the untouched body back to the original worker.
    return {
      delegate: new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: rawBody
      })
    };
  }

  const eventKey = `paystack:${event.data?.id || reference}`;
  const claimed = await env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_events (event_key, reference, event_type, status) VALUES (?, ?, ?, 'processing')"
  ).bind(eventKey, reference, event.event).run();

  if (Number(claimed.meta?.changes || 0) === 0) {
    const previous = await env.DB.prepare(
      "SELECT status FROM webhook_events WHERE event_key = ?"
    ).bind(eventKey).first();
    if (previous?.status === "processed") {
      return json({ received: true, duplicate: true });
    }
  }

  try {
    const result = await fulfilLicensingOrder(env, reference, "webhook");
    await env.DB.prepare(
      "UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?"
    ).bind(eventKey).run();
    return json({
      received: true,
      licensing: true,
      status: result.status,
      entitlements: result.entitlements
    });
  } catch (error) {
    console.error("Licensing webhook fulfilment failed:", error);
    await env.DB.prepare(
      "UPDATE webhook_events SET status = 'failed', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE event_key = ?"
    ).bind(eventKey).run();
    return json({ error: "Webhook processing failed." }, 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/verify-payment — licensing fallback when the webhook is late.
// Returns null when the reference is not a licensing order.
// ---------------------------------------------------------------------------
export async function handleLicensingVerify(env, url) {
  if (!env.DB) return null;
  const reference = url.searchParams.get("reference");
  if (!reference || reference.length > 200) return null;

  const order = await loadOrder(env, { reference });
  if (!order) return null;

  if (!env.PAYSTACK_SECRET_KEY) {
    return json({
      success: false,
      error: "Payment verification is not configured."
    }, 500);
  }

  let result;
  try {
    result = await fulfilLicensingOrder(env, reference, "verify");
  } catch (error) {
    console.error("Licensing payment verification failed:", error);
    return json({
      success: false,
      error: "This payment could not be verified yet. Please try again."
    }, 502);
  }

  const items = await loadOrderItems(env, order.id);
  const entitlements = await env.DB.prepare(
    "SELECT beat_id, licence_key, package_key, status FROM entitlements WHERE order_id = ?"
  ).bind(order.id).all();

  const rows = entitlements.results || [];
  const downloads = [];
  if (env.PAYSTACK_SECRET_KEY) {
    for (const row of rows) {
      if (row.status !== "active") continue;
      const token = await createSignedToken({
        reference: order.reference,
        beatId: row.beat_id,
        licenceKey: row.licence_key,
        exp: Date.now() + VERIFY_DOWNLOAD_TOKEN_LIFETIME
      }, env.PAYSTACK_SECRET_KEY);
      downloads.push({
        beat_id: row.beat_id,
        licence_key: row.licence_key,
        download_url: `${url.origin}/api/licensing/download?token=${encodeURIComponent(token)}`
      });
    }
  }

  return json({
    success: true,
    licensing: true,
    order: {
      id: order.id,
      reference: order.reference,
      email: order.email,
      currency: order.currency,
      amount: order.amount,
      status: result.status || order.status
    },
    manualReview: result.status === "manual_review",
    items: items.map(item => ({
      beat_id: item.beat_id,
      beat_title: item.beat_title,
      licence_key: item.licence_key,
      licence_label: item.licence_label,
      price: item.price
    })),
    downloads
  });
}

// ---------------------------------------------------------------------------
// GET /api/licensing/download?token=... — entitlement-scoped R2 delivery.
// ---------------------------------------------------------------------------
export async function handleLicensingDownload(request, env, url) {
  if (!env.DB) {
    return json({ error: "Download service is not configured." }, 500);
  }
  if (!env.PAYSTACK_SECRET_KEY) {
    return json({ error: "Download service is not configured." }, 500);
  }

  const token = url.searchParams.get("token");
  if (!token) {
    return json({ error: "Download token is missing." }, 400);
  }

  const data = await verifySignedToken(token, env.PAYSTACK_SECRET_KEY);
  if (!data || !data.reference || !data.beatId || !data.licenceKey) {
    return json({ error: "This download link is invalid or has expired." }, 401);
  }

  const entitlement = await env.DB.prepare(
    "SELECT package_key, status FROM entitlements WHERE reference = ? AND beat_id = ? AND licence_key = ?"
  ).bind(data.reference, data.beatId, data.licenceKey).first();

  if (!entitlement || entitlement.status !== "active") {
    return json({ error: "No active licence found for this download." }, 403);
  }

  let object = null;
  try {
    object = await env.BEATS_BUCKET.get(entitlement.package_key);
  } catch (error) {
    console.error("Licensing download storage error:", error);
  }
  if (!object) {
    return json({ error: "Download file not found in storage." }, 404);
  }

  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${data.beatId}-${data.licenceKey}.zip"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (typeof object.size === "number") {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { status: 200, headers });
}
