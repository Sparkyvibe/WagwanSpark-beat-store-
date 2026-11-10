import legacyWorker from "./index.js";
import {
  LEGACY_PRODUCT_TIER,
  findInventoryConflict,
  inventoryConflictMessage,
  isNonBeatCategory,
  packageVersionFromKey
} from "./licensing-inventory.js";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_ITEMS = 25;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function makeOrderId() {
  return `ord_${randomHex(16)}`;
}

function makeItemId() {
  return `item_${randomHex(16)}`;
}

function makeReference() {
  return `WS-${Date.now().toString(36).toUpperCase()}-${randomHex(16).toUpperCase()}`;
}

const BEAT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LICENCE_KEY_PATTERN = /^[a-z0-9_]+$/;

// ==========================================
// SELECTION NORMALISATION
//
// Two item shapes are accepted in the same order:
//
//   beat      { beat_id: "sun-fire", licence_key: "mp3" }
//             { category: "beats", beat_id: "sun-fire", licence_key: "mp3" }
//   product   { category: "samples", product_id: "drum-kit" }
//             { category: "studio-tools", product_id: "mix-chain" }
//
// Non-beat items carry no licence key: Samples and Studio Tools each have one
// legacy purchase tier, decided by the server. Anything the browser sends for
// price, package key or tier label is ignored.
// ==========================================
function normalizeItems(data) {
  const values = Array.isArray(data.items) ? data.items : null;
  if (!values || values.length < 1 || values.length > MAX_ITEMS) {
    return { error: `Provide between 1 and ${MAX_ITEMS} selected products.` };
  }

  const items = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Each selection must include a product." };
    }

    const requestedCategory = typeof value.category === "string"
      ? value.category.trim()
      : "";

    if (isNonBeatCategory(requestedCategory)) {
      const productId = value.product_id ?? value.id;
      if (typeof productId !== "string" || productId.length > 80 ||
          !BEAT_ID_PATTERN.test(productId)) {
        return { error: "Each selected product must be valid." };
      }
      const key = `${requestedCategory}:${productId}`;
      if (seen.has(key)) {
        return { error: "Duplicate product selections are not allowed." };
      }
      seen.add(key);
      items.push({ category: requestedCategory, productId });
      continue;
    }

    if (requestedCategory && requestedCategory !== "beats") {
      return { error: "Each selected product must belong to a known catalogue." };
    }

    const beatId = value.beat_id ?? value.id;
    const licenceKey = value.licence_key;
    if (typeof beatId !== "string" || beatId.length > 80 ||
        !BEAT_ID_PATTERN.test(beatId) ||
        typeof licenceKey !== "string" || licenceKey.length > 64 ||
        !LICENCE_KEY_PATTERN.test(licenceKey)) {
      return { error: "Each selected beat and licence key must be valid." };
    }
    const pair = `beats:${beatId}:${licenceKey}`;
    if (seen.has(pair)) {
      return { error: "Duplicate beat and licence selections are not allowed." };
    }
    seen.add(pair);
    items.push({ category: "beats", beatId, licenceKey });
  }

  // An exclusive licence is the whole order or nothing: rights on that beat
  // cannot be shared with any other line, including another licence of the
  // same beat.
  const exclusiveItems = items.filter(item => item.licenceKey === "exclusive");
  if (exclusiveItems.length && items.length > 1) {
    return {
      error: "An exclusive licence must be the only item in its order."
    };
  }

  return { items };
}

async function resolveBeatSelection(item, env) {
  const { beatId, licenceKey } = item;

  const beat = await env.DB.prepare(
    "SELECT id, title, status, category FROM beats WHERE id = ?"
  ).bind(beatId).first();
  if (!beat || beat.status !== "published" || beat.category !== "beats") {
    return { error: "One or more selected beats are unavailable for purchase." };
  }

  const licence = await env.DB.prepare(
    "SELECT licence_key, label, enabled FROM licences WHERE licence_key = ?"
  ).bind(licenceKey).first();
  if (!licence || !licence.enabled) {
    return { error: "One or more selected licences are unavailable." };
  }

  const offering = await env.DB.prepare(
    "SELECT price, package_key, enabled FROM beat_licences WHERE beat_id = ? AND licence_key = ?"
  ).bind(beatId, licenceKey).first();
  if (!offering || !offering.enabled) {
    return { error: "One or more selected licences are unavailable." };
  }
  if (!Number.isSafeInteger(offering.price) || offering.price < 1) {
    return { error: "One or more selected licences have an invalid price." };
  }
  if (typeof offering.package_key !== "string" || !offering.package_key.trim()) {
    return { error: "One or more selected licences are missing a package key." };
  }

  return {
    selection: {
      category: "beats",
      beat_id: beat.id,
      beat_title: beat.title,
      licence_key: licenceKey,
      licence_label: licence.label,
      price: offering.price,
      package_key: offering.package_key,
      package_version: packageVersionFromKey(offering.package_key)
    }
  };
}

async function resolveProductSelection(item, env) {
  const product = await env.DB.prepare(
    `SELECT id, title, status, category, price, zip_key
       FROM beats WHERE id = ?`
  ).bind(item.productId).first();

  // The category is checked, not inferred: a Samples id submitted as a Studio
  // Tool must not resolve.
  if (!product || product.status !== "published" ||
      product.category !== item.category) {
    return { error: "One or more selected products are unavailable for purchase." };
  }
  if (!Number.isSafeInteger(product.price) || product.price < 1) {
    return { error: "One or more selected products have an invalid price." };
  }
  if (typeof product.zip_key !== "string" || !product.zip_key.trim()) {
    return { error: "One or more selected products are missing a package key." };
  }

  return {
    selection: {
      category: product.category,
      beat_id: product.id,
      beat_title: product.title,
      licence_key: LEGACY_PRODUCT_TIER.key,
      licence_label: LEGACY_PRODUCT_TIER.label,
      price: product.price,
      package_key: product.zip_key,
      package_version: packageVersionFromKey(product.zip_key)
    }
  };
}

async function resolveSelection(data, env) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Invalid request." };
  }
  const email = typeof data.email === "string" ? data.email.trim() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { error: "Please provide a valid email address." };
  }

  const normalized = normalizeItems(data);
  if (normalized.error) return normalized;

  const selections = [];
  let total = 0;
  for (const item of normalized.items) {
    const resolved = item.category === "beats"
      ? await resolveBeatSelection(item, env)
      : await resolveProductSelection(item, env);
    if (resolved.error) return resolved;

    total += resolved.selection.price;
    selections.push(resolved.selection);
  }

  // Inventory is re-checked here, when payment starts and again at
  // fulfilment — a reservation or a sale can appear in between.
  const conflict = await findInventoryConflict(env, selections);
  if (conflict) {
    return { error: inventoryConflictMessage(conflict), conflict };
  }

  const amount = total * 100;
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(amount)) {
    return { error: "The order total is not valid." };
  }
  return { email, total, amount, selections };
}

async function createLicensingOrder(request, env) {
  if (!env.DB || typeof env.DB.batch !== "function") {
    return json({ success: false, error: "Order service is not configured." }, 500);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ success: false, error: "Request is too large." }, 413);
  }

  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return json({ success: false, error: "Request is too large." }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ success: false, error: "Invalid request." }, 400);
  }

  const resolved = await resolveSelection(body, env);
  if (resolved.error) {
    const status = resolved.conflict ? 409 : 400;
    return json({ success: false, error: resolved.error }, status);
  }

  const orderId = makeOrderId();
  const reference = makeReference();
  const items = resolved.selections.map(selection => ({
    id: makeItemId(),
    order_id: orderId,
    ...selection
  }));

  const statements = [
    env.DB.prepare(
      `INSERT INTO orders (id, reference, email, currency, amount, status, provider, created_at, updated_at)
       VALUES (?, ?, ?, 'NGN', ?, 'pending', 'paystack', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(orderId, reference, resolved.email, resolved.amount),
    ...items.map(item => env.DB.prepare(
      `INSERT INTO order_items
         (id, order_id, beat_id, beat_title, licence_key, licence_label, price,
          package_key, category, package_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      item.id,
      orderId,
      item.beat_id,
      item.beat_title,
      item.licence_key,
      item.licence_label,
      item.price,
      item.package_key,
      item.category,
      item.package_version
    ))
  ];

  try {
    // Cloudflare D1 batch() executes the prepared statements sequentially in a
    // transaction; any statement error rolls back the complete batch.
    const results = await env.DB.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length ||
        results.some(result => Number(result.meta?.changes || 0) !== 1)) {
      throw new Error("Order batch did not insert every row.");
    }
  } catch (error) {
    // D1 batch rolls back all statements when any statement fails. The raw
    // database error is logged only server-side and never returned to a buyer.
    console.error("Licensing order batch failed:", error);
    return json({ success: false, error: "Unable to create your order at this time." }, 500);
  }

  return json({
    success: true,
    order: {
      id: orderId,
      reference,
      email: resolved.email,
      currency: "NGN",
      amount: resolved.amount,
      total: resolved.total,
      status: "pending"
    },
    items,
    total: resolved.total,
    amount: resolved.amount,
    currency: "NGN",
    reference,
    itemCount: items.length
  }, 201);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/create-order" && request.method === "POST") {
      try {
        return await createLicensingOrder(request, env);
      } catch (error) {
        console.error("Licensing order request failed:", error);
        return json({ success: false, error: "Unable to create your order at this time." }, 500);
      }
    }
    return legacyWorker.fetch(request, env, ctx);
  }
};
