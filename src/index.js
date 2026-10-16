// ==========================================
 // WAGWANSPARK — MULTI-CATEGORY STORE WORKER
 // Keeps existing beat routes and adds Samples + Studio Tools.
 // Adds authenticated Admin audio preview for draft and published products.
 // Purchase email is triggered by both webhook and verified success-page fallback.
 // Ranking: featured products first, then newest PUBLISH date (published_at).
 // Featured beats carousel: admin-controlled order stored in featured_position.
 // Main beats catalogue: admin-controlled order stored in catalogue_position,
 // fully independent of the carousel. Featured beats appear in BOTH the carousel
 // and the main catalogue.
 // ==========================================
const LEGACY_BEATS = {
  "sun-fire": { title: "SUN FIRE", price: 7000, candidates: ["beats/SUN FIRE.zip", "SUN FIRE.zip"] },
  phenomenal: { title: "PHENOMENAL", price: 7000, candidates: ["beats/PHENOMENAL.zip", "PHENOMENAL.zip"] },
  serenade: { title: "SERENADE", price: 7000, candidates: ["beats/SERENADE.zip", "SERENADE.zip"] }
};
const CALLBACK_URL = "https://wagwanspark.com.ng/success.html";
const STORE_ORIGIN = "https://wagwanspark.com.ng";
const DOWNLOAD_TOKEN_LIFETIME = 30 * 60 * 1000;
const EMAIL_DOWNLOAD_TOKEN_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const SESSION_COOKIE = "ws_admin_session";
const CATEGORIES = new Set(["beats", "samples", "studio-tools"]);

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

async function createSignature(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return base64url(new Uint8Array(signature));
}

async function verifySignature(payload, signature, secret) {
  const expected = await createSignature(payload, secret);
  if (typeof signature !== "string" || signature.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < signature.length; i++) {
    difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

async function verifyPaystackWebhookSignature(rawBody, signature, secret) {
  try {
    if (!signature || !secret) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(rawBody)
    );
    const expected = Array.from(new Uint8Array(signed))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    if (signature.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < signature.length; i++) {
      difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return difference === 0;
  } catch (error) {
    console.error("Paystack signature verification failed:", error);
    return false;
  }
}

async function createSignedToken(data, secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(data)));
  return `${payload}.${await createSignature(payload, secret)}`;
}

async function verifySignedToken(token, secret) {
  try {
    if (!token || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    if (!(await verifySignature(payload, signature, secret))) return null;
    const data = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payload))
    );
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

async function createDownloadToken(data, secret) {
  return createSignedToken(data, secret);
}

async function verifyDownloadToken(token, secret) {
  const data = await verifySignedToken(token, secret);
  if (
    !data ||
    typeof (data.productId || data.beatId) !== "string" ||
    typeof data.reference !== "string"
  ) return null;
  return data;
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return "";
}

function sessionCookie(token, maxAge = 28800) {
  return `${SESSION_COOKIE}=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function getAdminSession(request, env) {
  if (!env.ADMIN_PASSWORD) return null;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await verifySignedToken(token, env.ADMIN_PASSWORD);
  if (!session || session.role !== "admin" || typeof session.csrf !== "string") return null;
  return session;
}

async function requireAdmin(request, env, requireCsrf = false) {
  const session = await getAdminSession(request, env);
  if (!session) {
    return { response: json({ error: "Authentication required." }, 401) };
  }
  if (requireCsrf) {
    const supplied = request.headers.get("X-CSRF-Token") || "";
    if (!supplied || supplied !== session.csrf) {
      return { response: json({ error: "Invalid security token." }, 403) };
    }
  }
  return { session };
}

function validId(id) {
  return typeof id === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) &&
    id.length <= 80;
}

function cleanText(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validCategory(value) {
  return CATEGORIES.has(value) ? value : null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ==========================================
// RANKING SUPPORT — published_at column
// The column is created automatically the first time it is needed, so no
// manual database step is required. If you already added it by hand, this
// does nothing. Beats published before this change have no published_at,
// so they keep sorting by their created_at date (current order unchanged).
// ==========================================
let publishedAtReady = false;

async function ensurePublishedAtColumn(env) {
  if (publishedAtReady) return;
  try {
    await env.DB.prepare("SELECT published_at FROM beats LIMIT 1").first();
  } catch {
    try {
      await env.DB.prepare(
        "ALTER TABLE beats ADD COLUMN published_at TEXT"
      ).run();
    } catch (error) {
      // Another request may have added it at the same moment.
      if (!String(error).toLowerCase().includes("duplicate")) throw error;
    }
  }
  publishedAtReady = true;
}

// ==========================================
// FEATURED ORDER SUPPORT — featured_position column
// Created automatically on first use, like published_at. Lower numbers come
// first in the featured carousel; NULL (featured before this existed, or not
// featured) sorts after positioned products in the existing store order.
// ==========================================
let featuredPositionReady = false;

async function ensureFeaturedPositionColumn(env) {
  if (featuredPositionReady) return;
  try {
    await env.DB.prepare("SELECT featured_position FROM beats LIMIT 1").first();
  } catch {
    try {
      await env.DB.prepare(
        "ALTER TABLE beats ADD COLUMN featured_position INTEGER"
      ).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate")) throw error;
    }
  }
  featuredPositionReady = true;
}

// ==========================================
// MAIN CATALOGUE ORDER — catalogue_position column
// Created automatically on first use, like published_at / featured_position.
// Lower numbers come first in the main "All Beats" catalogue. It is separate
// from featured_position, and it is NEVER changed by featuring/unfeaturing,
// so an unfeatured beat returns to the slot it already holds.
//
// Initial order: beats that have no position yet are numbered newest-first by
// publish date (the order the store already showed among non-featured beats).
// Featured beats and drafts are numbered too, so they have a place to return to.
// ==========================================
const BEATS_CATALOGUE_ORDER_SQL =
  "catalogue_position IS NULL, catalogue_position ASC, " +
  "COALESCE(published_at, created_at) DESC, created_at DESC, id ASC";

let cataloguePositionReady = false;

async function backfillCataloguePositions(env) {
  const pending = await env.DB.prepare(
    `SELECT id FROM beats
     WHERE category = 'beats' AND catalogue_position IS NULL
     ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC, id ASC`
  ).all();
  const ids = (pending.results || []).map(row => row.id);
  if (!ids.length) return;

  const lowest = await env.DB.prepare(
    "SELECT MIN(catalogue_position) AS lowest FROM beats WHERE category = 'beats'"
  ).first();
  // First run: number 1..N. Later (a few un-numbered rows): put them on top.
  const start = lowest && lowest.lowest != null
    ? Number(lowest.lowest) - ids.length
    : 1;

  // The IS NULL guard means a concurrent initialisation cannot overwrite
  // a position that was already assigned.
  await env.DB.batch(ids.map((id, index) =>
    env.DB.prepare(
      "UPDATE beats SET catalogue_position = ? WHERE id = ? AND catalogue_position IS NULL"
    ).bind(start + index, id)
  ));
}

async function ensureCataloguePositionColumn(env) {
  if (cataloguePositionReady) return;
  await ensurePublishedAtColumn(env);
  try {
    await env.DB.prepare("SELECT catalogue_position FROM beats LIMIT 1").first();
  } catch {
    try {
      await env.DB.prepare(
        "ALTER TABLE beats ADD COLUMN catalogue_position INTEGER"
      ).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate")) throw error;
    }
  }
  await backfillCataloguePositions(env);
  cataloguePositionReady = true;
}

// Saves a new order for the main catalogue. `ids` must be exactly the
// published beats (featured beats included). Drafts keep their slots (so they
// return to the right place when published); the listed beats are reassigned
// among the slots that the listed beats occupy. Only catalogue_position is written.
async function saveCatalogueOrder(env, ids) {
  await ensureCataloguePositionColumn(env);

  const result = await env.DB.prepare(
    `SELECT id, status, featured, catalogue_position
     FROM beats WHERE category = 'beats'
     ORDER BY ${BEATS_CATALOGUE_ORDER_SQL}`
  ).all();
  const rows = result.results || [];

  const isMain = row => row.status === "published";
  const mainIds = new Set(rows.filter(isMain).map(row => row.id));

  if (mainIds.size !== ids.length || !ids.every(id => mainIds.has(id))) {
    return { conflict: true };
  }

  const queue = [...ids];
  const finalOrder = rows.map(row => isMain(row) ? queue.shift() : row.id);
  const current = new Map(rows.map(row => [row.id, row.catalogue_position]));

  const writes = [];
  finalOrder.forEach((id, index) => {
    const position = index + 1;
    if (Number(current.get(id)) !== position || current.get(id) == null) {
      writes.push(
        env.DB.prepare(
          "UPDATE beats SET catalogue_position = ? WHERE id = ? AND category = 'beats'"
        ).bind(position, id)
      );
    }
  });

  if (writes.length) await env.DB.batch(writes);
  return { conflict: false };
}

async function getProduct(env, id) {
  return env.DB.prepare(
    `SELECT id, title, genre, bpm, musical_key, price, description, artwork_key,
            preview_key, zip_key, status, featured, category, created_at, updated_at
     FROM beats WHERE id = ?`
  ).bind(id).first();
}

async function getBeat(env, id) {
  return getProduct(env, id);
}

async function getPublishedProducts(env, category) {
  await ensurePublishedAtColumn(env);
  await ensureFeaturedPositionColumn(env);
  await ensureCataloguePositionColumn(env);

  // Beats: the admin's manual catalogue order. Featured beats are returned in
  // this same list: the storefront shows them in the carousel AND in the main
  // catalogue. Samples and Studio Tools keep featured-first, newest-first.
  const orderBy = category === "beats"
    ? BEATS_CATALOGUE_ORDER_SQL
    : "featured DESC, COALESCE(published_at, created_at) DESC, created_at DESC";

  const result = await env.DB.prepare(
    `SELECT id, title, genre, bpm, musical_key, price, description, artwork_key,
            preview_key, status, featured, featured_position, catalogue_position, category
     FROM beats WHERE status = 'published' AND category = ?
     ORDER BY ${orderBy}`
  ).bind(category).all();
  return result.results || [];
}

async function getPublishedBeats(env) {
  return getPublishedProducts(env, "beats");
}

function productFileNameVariants(product) {
  const id = String(product.id || "");
  const title = String(product.title || "");
  const titleHyphen = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return [...new Set([
    id,
    id.toUpperCase(),
    title,
    title.toUpperCase(),
    title.toLowerCase(),
    title.replace(/\s+/g, "-"),
    titleHyphen
  ].filter(Boolean))];
}

function mediaKeyCandidates(product, column) {
  const candidates = [];
  if (product[column]) candidates.push(product[column]);
  const category = product.category || "beats";
  const isLegacyStyle = category === "beats" || Boolean(LEGACY_BEATS[product.id]);
  if (!isLegacyStyle) {
    const id = String(product.id || "");
    if (column === "artwork_key") {
      for (const ext of ["jpg", "png", "webp"]) {
        candidates.push(`products/${category}/${id}.${ext}`);
      }
    }
    if (column === "preview_key") {
      for (const ext of ["mp3", "wav"]) {
        candidates.push(`products/${category}/${id}-preview.${ext}`);
      }
    }
    if (column === "zip_key") {
      candidates.push(`products/${category}/${id}.zip`);
    }
    return [...new Set(candidates.filter(Boolean))];
  }
  const names = productFileNameVariants(product);
  if (column === "artwork_key") {
    for (const name of names) {
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        candidates.push(
          `artwork/${name}.${ext}`,
          `artworks/${name}.${ext}`,
          `products/${category}/${name}.${ext}`
        );
      }
    }
  }
  if (column === "preview_key") {
    for (const name of names) {
      for (const ext of ["mp3", "wav"]) {
        candidates.push(
          `previews/${name}.${ext}`,
          `preview/${name}.${ext}`,
          `products/${category}/${name}.${ext}`,
          `products/${category}/${name}-preview.${ext}`
        );
      }
    }
  }
  if (column === "zip_key") {
    for (const name of names) {
      candidates.push(
        `beats/${name}.zip`,
        `${name}.zip`,
        `products/${category}/${name}.zip`
      );
    }
    const legacy = LEGACY_BEATS[product.id];
    if (legacy) candidates.push(...legacy.candidates);
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function findExistingR2Object(env, product, column) {
  if (!env.BEATS_BUCKET) return { key: null, object: null };
  for (const key of mediaKeyCandidates(product, column)) {
    try {
      const object = await env.BEATS_BUCKET.head(key);
      if (object) return { key, object };
    } catch (error) {
      console.error("R2 object lookup failed:", key, error);
    }
  }
  return { key: null, object: null };
}

async function repairStoredFileKey(env, product, column) {
  const found = await findExistingR2Object(env, product, column);
  if (!found.key) return { found: false, key: null };
  if (product[column] !== found.key) {
    await env.DB.prepare(
      `UPDATE beats SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(found.key, product.id).run();
    product[column] = found.key;
  }
  return { found: true, key: found.key };
}

async function getZipObject(env, product) {
  if (!env.BEATS_BUCKET) return null;
  const found = await findExistingR2Object(env, product, "zip_key");
  if (!found.key) return null;
  if (product.zip_key !== found.key) {
    await env.DB.prepare(
      "UPDATE beats SET zip_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(found.key, product.id).run();
    product.zip_key = found.key;
  }
  return env.BEATS_BUCKET.get(found.key);
}

function safeFilename(value) {
  return String(value || "download")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 100) || "download";
}

// ==========================================
// PURCHASE VALIDATION — accepts legacy beatIds and generic productIds
// ==========================================
async function getRequestedProducts(data, env) {
  const entries = [];
  const beatIds = Array.isArray(data.beatIds)
    ? data.beatIds
    : typeof data.beatId === "string" ? [data.beatId] : [];
  const productIds = Array.isArray(data.productIds)
    ? data.productIds
    : typeof data.productId === "string" ? [data.productId] : [];
  if (
    beatIds.some(id => typeof id !== "string") ||
    productIds.some(id => typeof id !== "string")
  ) {
    return { error: "Invalid selected product." };
  }
  for (const id of beatIds) entries.push({ id, expectedCategory: null });
  for (const id of productIds) entries.push({ id, expectedCategory: null });
  if (data.productItems !== undefined) {
    if (!Array.isArray(data.productItems)) {
      return { error: "Invalid selected products." };
    }
    for (const item of data.productItems) {
      if (!item || typeof item.id !== "string") {
        return { error: "Invalid selected product." };
      }
      const category = validCategory(
        typeof item.category === "string" ? item.category : ""
      );
      if (!category || category === "beats") {
        return { error: "Invalid product category." };
      }
      entries.push({ id: item.id, expectedCategory: category });
    }
  }
  if (!entries.length || entries.length > 50) {
    return { error: "Invalid number of selected products." };
  }
  const ids = entries.map(item => item.id);
  if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) {
    return { error: "Invalid or duplicate products are not allowed." };
  }
  const products = [];
  for (const entry of entries) {
    const product = await getProduct(env, entry.id);
    if (!product || product.status !== "published") {
      return { error: "One or more selected products are unavailable." };
    }
    const category = product.category || "beats";
    if (entry.expectedCategory && category !== entry.expectedCategory) {
      return { error: "A selected product does not match its category." };
    }
    if (!Number.isSafeInteger(product.price) || product.price < 1) {
      return { error: "Invalid product price." };
    }
    products.push({
      id: product.id,
      title: product.title,
      price: product.price,
      category
    });
  }
  const total = products.reduce((sum, item) => sum + item.price, 0);
  if (!Number.isSafeInteger(total) || total < 1) {
    return { error: "Invalid checkout total." };
  }
  return { products, beats: products, total };
}

function getPurchasedProductIds(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata.productIds ?? metadata.beatIds;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  if (typeof metadata.productId === "string") return [metadata.productId];
  if (typeof metadata.beatId === "string") return [metadata.beatId];
  return null;
}

async function verifyPaystackTransaction(reference, env) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
    }
  );
  const result = await response.json();
  if (!response.ok || !result.status || !result.data) {
    throw new Error("Paystack transaction verification failed.");
  }
  const transaction = result.data;
  if (transaction.status !== "success") {
    throw new Error("Paystack transaction is not successful.");
  }
  if (transaction.currency !== "NGN") {
    throw new Error("Payment currency is incorrect.");
  }
  if (
    !Number.isSafeInteger(Number(transaction.amount)) ||
    Number(transaction.amount) < 1
  ) {
    throw new Error("Payment amount is invalid.");
  }
  if (transaction.reference !== reference) {
    throw new Error("Payment reference mismatch.");
  }
  return transaction;
}

async function getVerifiedPurchase(transaction, env) {
  const ids = getPurchasedProductIds(transaction.metadata || {});
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 50 ||
    ids.some(id => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("Purchased products could not be identified.");
  }
  const products = [];
  for (const id of ids) {
    const product = await getProduct(env, id);
    if (!product || !Number.isSafeInteger(product.price) || product.price < 1) {
      throw new Error("Purchased product could not be verified.");
    }
    products.push({
      id: product.id,
      title: product.title,
      price: product.price,
      category: product.category || "beats"
    });
  }
  const expectedKobo = products.reduce(
    (sum, item) => sum + item.price * 100,
    0
  );
  if (
    !Number.isSafeInteger(expectedKobo) ||
    Number(transaction.amount) !== expectedKobo
  ) {
    throw new Error("Payment amount does not match the purchased products.");
  }
  const email = cleanText(transaction.customer?.email, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Verified customer email is missing or invalid.");
  }
  return { products, beats: products, email };
}

async function sendPurchaseEmail(env, email, reference, products, origin) {
  if (!env.EMAIL_SCRIPT_URL || !env.EMAIL_SHARED_SECRET) {
    throw new Error("Email delivery secrets are not configured.");
  }
  if (
    !env.EMAIL_SCRIPT_URL.startsWith("https://script.google.com/macros/s/") ||
    !env.EMAIL_SCRIPT_URL.endsWith("/exec")
  ) {
    throw new Error("EMAIL_SCRIPT_URL is not a valid Apps Script URL.");
  }
  const downloadLines = [];
  for (const product of products) {
    const token = await createDownloadToken({
      reference,
      productId: product.id,
      beatId: product.id,
      exp: Date.now() + EMAIL_DOWNLOAD_TOKEN_LIFETIME
    }, env.PAYSTACK_SECRET_KEY);
    downloadLines.push(
      `${product.title}\nDownload: ${STORE_ORIGIN}/api/download?token=${encodeURIComponent(token)}`
    );
  }
  const subject = products.length === 1
    ? `WagwanSpark — ${products[0].title} Download`
    : "WagwanSpark — Your Downloads";
  const body = [
    "Thank you for purchasing from WagwanSpark.",
    "",
    "Your payment has been verified. Your download link(s) are below:",
    "",
    ...downloadLines,
    "",
    "IMPORTANT:",
    "• These secure download links expire in 7 days.",
    "• Keep this email for reference while the links are valid.",
    "• Do not share your download links publicly.",
    "",
    `Payment reference: ${reference}`,
    "",
    "WagwanSpark — Let the vibe be your guide."
  ].join("\n");
  const response = await fetch(env.EMAIL_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.EMAIL_SHARED_SECRET,
      to: email,
      subject,
      body
    }),
    redirect: "follow"
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error("Google email endpoint returned an HTTP error.");
  }
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Google email endpoint response was not valid JSON.");
  }
  if (!result.success) {
    throw new Error("Google email endpoint did not confirm delivery.");
  }
  return true;
}

// ==========================================
// SHARED EMAIL DELIVERY + DUPLICATE PROTECTION
// Both the Paystack webhook and verified-payment route use this function.
// A payment reference can be emailed successfully only once.
// Failed or stale deliveries can be retried.
// ==========================================
async function deliverPurchaseEmailOnce(env, reference, email, products) {
  if (!env.DB) {
    throw new Error("Database binding is missing for email delivery.");
  }

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS email_deliveries (
    reference TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  )`).run();

  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO email_deliveries (reference, recipient, status) VALUES (?, ?, 'processing')"
  ).bind(reference, email).run();

  const wasInserted = Number(inserted.meta?.changes || 0) > 0;

  if (!wasInserted) {
    const existing = await env.DB.prepare(
      "SELECT reference, recipient, status, updated_at FROM email_deliveries WHERE reference = ?"
    ).bind(reference).first();

    if (existing?.status === "sent") {
      return { sent: true, duplicate: true, processing: false };
    }

    if (!existing || existing.recipient !== email) {
      throw new Error("Email delivery record mismatch.");
    }

    const updatedAt = existing.updated_at
      ? Date.parse(`${existing.updated_at.replace(" ", "T")}Z`)
      : NaN;

    const stale = !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt > 5 * 60 * 1000;

    if (existing.status === "processing" && !stale) {
      return { sent: false, duplicate: false, processing: true };
    }

    const reclaimed = await env.DB.prepare(
      "UPDATE email_deliveries SET recipient = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE reference = ? AND status != 'sent'"
    ).bind(email, reference).run();

    if (Number(reclaimed.meta?.changes || 0) < 1) {
      const latest = await env.DB.prepare(
        "SELECT status FROM email_deliveries WHERE reference = ?"
      ).bind(reference).first();

      if (latest?.status === "sent") {
        return { sent: true, duplicate: true, processing: false };
      }
      throw new Error("Could not claim email delivery.");
    }
  }

  try {
    await sendPurchaseEmail(env, email, reference, products, STORE_ORIGIN);

    await env.DB.prepare(
      "UPDATE email_deliveries SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE reference = ?"
    ).bind(reference).run();

    return { sent: true, duplicate: false, processing: false };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE email_deliveries SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE reference = ? AND status != 'sent'"
    ).bind(reference).run();

    throw error;
  }
}

async function handlePaystackWebhook(request, env, url) {
  if (!env.PAYSTACK_SECRET_KEY || !env.DB || !env.BEATS_BUCKET) {
    return json({ error: "Payment service is not configured." }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature") || "";

  if (!(await verifyPaystackWebhookSignature(
    rawBody,
    signature,
    env.PAYSTACK_SECRET_KEY
  ))) {
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

  try {
    const transaction = await verifyPaystackTransaction(reference, env);

    if (
      event.data?.reference !== transaction.reference ||
      Number(event.data?.amount) !== Number(transaction.amount) ||
      event.data?.currency !== transaction.currency
    ) {
      return json({ error: "Webhook and verified transaction do not match." }, 400);
    }

    const { products, email } = await getVerifiedPurchase(transaction, env);

    try {
      const delivery = await deliverPurchaseEmailOnce(
        env,
        reference,
        email,
        products
      );

      return json({
        received: true,
        emailSent: delivery.sent,
        duplicate: delivery.duplicate,
        processing: delivery.processing
      });
    } catch (error) {
      console.error("Purchase email delivery failed:", error);
      return json({
        error: "Email delivery failed. Webhook retry is required."
      }, 500);
    }
  } catch (error) {
    console.error("Paystack webhook processing failed:", error);
    return json({ error: "Webhook processing failed." }, 500);
  }
}

// ==========================================
// ADMIN API — existing beat routes retained;
// generic product aliases and authenticated preview added.
// ==========================================
async function handleAdmin(request, env, url) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: "Admin password is not configured." }, 503);
  }
  if (!env.DB || !env.BEATS_BUCKET) {
    return json({ error: "Database or storage binding is missing." }, 500);
  }
  const path = url.pathname;
  if (path === "/api/admin/login" && request.method === "POST") {
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    if (
      typeof data.password !== "string" ||
      data.password.length > 1024 ||
      data.password !== env.ADMIN_PASSWORD
    ) {
      return json({ error: "Incorrect password." }, 401);
    }
    const csrf = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const token = await createSignedToken({
      role: "admin",
      csrf,
      exp: Date.now() + ADMIN_SESSION_LIFETIME
    }, env.ADMIN_PASSWORD);
    return json(
      { success: true },
      200,
      { "Set-Cookie": sessionCookie(token) }
    );
  }
  if (path === "/api/admin/logout" && request.method === "POST") {
    const auth = await requireAdmin(request, env, true);
    if (auth.response) return auth.response;
    return json(
      { success: true },
      200,
      { "Set-Cookie": sessionCookie("", 0) }
    );
  }
  if (path === "/api/admin/session" && request.method === "GET") {
    const session = await getAdminSession(request, env);
    if (!session) return json({ authenticated: false }, 401);
    return json({ authenticated: true, csrfToken: session.csrf });
  }

  const isAdminPreviewPath =
    /^\/api\/admin\/(?:beats|products)\/[a-z0-9-]+\/preview$/.test(path);
  const readOnly =
    request.method === "GET" &&
    (
      ["/api/admin/beats", "/api/admin/products"].includes(path) ||
      isAdminPreviewPath
    );
  const auth = await requireAdmin(request, env, !readOnly);
  if (auth.response) return auth.response;

  if (
    (path === "/api/admin/beats" || path === "/api/admin/products") &&
    request.method === "GET"
  ) {
    await ensureFeaturedPositionColumn(env);
    await ensureCataloguePositionColumn(env);
    const result = await env.DB.prepare(
      "SELECT * FROM beats ORDER BY created_at DESC"
    ).all();
    return json({
      beats: result.results || [],
      products: result.results || []
    });
  }

  const adminPreviewMatch = path.match(
    /^\/api\/admin\/(?:beats|products)\/([a-z0-9-]+)\/preview$/
  );

  if (adminPreviewMatch && request.method === "GET") {
    const id = adminPreviewMatch[1];
    const product = await getProduct(env, id);

    if (!product) {
      return json({ error: "Product not found." }, 404);
    }

    let key = product.preview_key;
    if (!key) {
      const recovered = await repairStoredFileKey(
        env,
        product,
        "preview_key"
      );
      if (!recovered.found) {
        return json({
          error: "No preview audio has been uploaded for this product.",
          productId: id
        }, 404);
      }
      key = recovered.key;
    }

    let object;
    try {
      object = await env.BEATS_BUCKET.get(key);
    } catch (error) {
      console.error("Admin preview read failed:", { id, key, error });
      return json({ error: "Could not read preview audio from storage." }, 500);
    }

    if (!object) {
      const recovered = await repairStoredFileKey(
        env,
        product,
        "preview_key"
      );
      if (!recovered.found) {
        return json({
          error: "Preview audio could not be found in storage.",
          productId: id
        }, 404);
      }
      try {
        object = await env.BEATS_BUCKET.get(recovered.key);
      } catch (error) {
        console.error("Admin preview recovery failed:", { id, error });
        return json({ error: "Could not read preview audio from storage." }, 500);
      }
    }

    if (!object) {
      return json({ error: "Preview audio could not be found in storage." }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const storedType = headers.get("Content-Type") || "";

    if (!storedType.startsWith("audio/")) {
      const keyLower = key.toLowerCase();
      headers.set(
        "Content-Type",
        keyLower.endsWith(".wav") ? "audio/wav" : "audio/mpeg"
      );
    }

    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Disposition", "inline");
    return new Response(object.body, { status: 200, headers });
  }

  if (
    (path === "/api/admin/beats" || path === "/api/admin/products") &&
    request.method === "POST"
  ) {
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const id = cleanText(data.id, 80).toLowerCase();
    const title = cleanText(data.title, 120);
    const genre = cleanText(data.genre || data.type || "Production Tools", 80);
    const category = validCategory(
      cleanText(data.category || "beats", 40).toLowerCase()
    );
    const musicalKey = cleanText(data.musical_key ?? data.musicalKey, 40);
    const bpm = data.bpm === "" || data.bpm == null ? null : Number(data.bpm);
    const price = Number(data.price);

    if (!validId(id) || !title || !genre || !category) {
      return json({
        error: "Provide a valid ID, title, genre, and category (beats, samples, or studio-tools)."
      }, 400);
    }

    if (
      !Number.isSafeInteger(price) ||
      price < 1 ||
      (bpm !== null && (!Number.isInteger(bpm) || bpm < 1 || bpm > 400))
    ) {
      return json({ error: "Check the price and BPM values." }, 400);
    }

    await ensureCataloguePositionColumn(env);

    try {
      // A new beat starts at the top of the main catalogue (as new uploads
      // did before). Publishing, unpublishing or editing never moves it.
      await env.DB.prepare(`INSERT INTO beats
        (id, title, genre, bpm, musical_key, price, description, status, featured, category, catalogue_position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?,
          CASE WHEN ? = 'beats'
            THEN (SELECT COALESCE(MIN(catalogue_position) - 1, 1) FROM beats WHERE category = 'beats')
            ELSE NULL
          END,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(
          id,
          title,
          genre,
          bpm,
          musicalKey,
          price,
          cleanText(data.description, 2000),
          category,
          category
        ).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return json({
          error: "That product ID already exists. IDs must be unique across all categories."
        }, 409);
      }
      throw error;
    }

    const created = await getProduct(env, id);
    return json({ success: true, beat: created, product: created }, 201);
  }

  if (path === "/api/admin/upload" && request.method === "POST") {
    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Could not read the uploaded file." }, 400);
    }

    const id = cleanText(
      form.get("beatId") || form.get("productId"),
      80
    ).toLowerCase();
    const kind = cleanText(form.get("kind"), 20).toLowerCase();
    const file = form.get("file");

    if (!validId(id) || !file || typeof file.arrayBuffer !== "function") {
      return json({ error: "Select a product and a file." }, 400);
    }

    const product = await getProduct(env, id);
    if (!product) return json({ error: "Product not found." }, 404);

    const category = product.category || "beats";
    const mime = (file.type || "").toLowerCase();
    let key;
    let column;
    let maxBytes;
    let contentType;

    if (kind === "artwork") {
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        return json({ error: "Artwork must be JPG, PNG, or WebP." }, 400);
      }
      maxBytes = 10 * 1024 * 1024;
      if (file.size > maxBytes) {
        return json({ error: "Artwork must be 10 MB or smaller." }, 413);
      }
      const ext = mime === "image/jpeg"
        ? "jpg"
        : mime === "image/png" ? "png" : "webp";
      key = category === "beats"
        ? `artwork/${id}.${ext}`
        : `products/${category}/${id}.${ext}`;
      column = "artwork_key";
      contentType = mime;
    } else if (kind === "preview") {
      if (!["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(mime)) {
        return json({
          error: "Preview must be an MP3 or WAV audio file."
        }, 400);
      }
      maxBytes = 25 * 1024 * 1024;
      if (file.size > maxBytes) {
        return json({ error: "Preview must be 25 MB or smaller." }, 413);
      }
      const ext = mime.includes("wav") ? "wav" : "mp3";
      key = category === "beats"
        ? `previews/${id}.${ext}`
        : `products/${category}/${id}-preview.${ext}`;
      column = "preview_key";
      contentType = ext === "wav" ? "audio/wav" : "audio/mpeg";
    } else if (kind === "zip") {
      const fileName = typeof file.name === "string"
        ? file.name.toLowerCase()
        : "";
      if (mime !== "application/zip" && !fileName.endsWith(".zip")) {
        return json({ error: "Upload a ZIP file." }, 400);
      }
      maxBytes = 100 * 1024 * 1024;
      if (file.size > maxBytes) {
        return json({ error: "ZIP must be 100 MB or smaller." }, 413);
      }
      key = category === "beats"
        ? `beats/${id}.zip`
        : `products/${category}/${id}.zip`;
      column = "zip_key";
      contentType = "application/zip";
    } else {
      return json({ error: "Unknown upload type." }, 400);
    }

    if (!file.size) {
      return json({ error: "The selected file is empty." }, 400);
    }
    if (file.size > maxBytes) {
      return json({ error: "File exceeds the size limit." }, 413);
    }

    try {
      await env.BEATS_BUCKET.put(
        key,
        await file.arrayBuffer(),
        {
          httpMetadata: { contentType },
          customMetadata: { productId: id, category, kind }
        }
      );
    } catch (error) {
      console.error("R2 upload failed:", { id, kind, key, error });
      return json({
        error: "R2 could not save the uploaded file. Please try again."
      }, 500);
    }

    const stored = await env.BEATS_BUCKET.head(key);
    if (!stored) {
      return json({
        error: `Upload verification failed for ${key}. Please retry.`
      }, 500);
    }

    await env.DB.prepare(
      `UPDATE beats SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(key, id).run();

    const updated = await getProduct(env, id);
    return json({
      success: true,
      kind,
      key,
      beat: updated,
      product: updated
    });
  }

  // Saves the top-to-bottom order of the MAIN beats catalogue. Independent of
  // the featured carousel: only catalogue_position is written. The list must be
  // exactly the published beats (featured ones included), so a stale admin tab
  // cannot drop or resurrect anything. Only the beats category is supported.
  if (path === "/api/admin/catalogue-order" && request.method === "PUT") {
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const category = cleanText(data.category || "beats", 40).toLowerCase();
    const ids = Array.isArray(data.ids) ? data.ids : null;

    if (
      category !== "beats" ||
      !ids ||
      !ids.length ||
      ids.length > 500 ||
      !ids.every(validId) ||
      new Set(ids).size !== ids.length
    ) {
      return json({ error: "Provide the beats category and a list of beat IDs." }, 400);
    }

    const saved = await saveCatalogueOrder(env, ids);

    if (saved.conflict) {
      return json({
        error: "The catalogue list has changed. Refresh the dashboard and try again."
      }, 409);
    }

    return json({ success: true, category, ids });
  }

  // Saves the left-to-right order of featured products. The list must be
  // exactly the currently featured products of that category, so a stale
  // admin tab cannot drop or resurrect anything.
  if (path === "/api/admin/featured-order" && request.method === "PUT") {
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const category = validCategory(
      cleanText(data.category || "beats", 40).toLowerCase()
    );
    const ids = Array.isArray(data.ids) ? data.ids : null;

    if (
      !category ||
      !ids ||
      !ids.length ||
      ids.length > 200 ||
      !ids.every(validId) ||
      new Set(ids).size !== ids.length
    ) {
      return json({ error: "Provide a valid category and list of product IDs." }, 400);
    }

    await ensureFeaturedPositionColumn(env);

    const current = await env.DB.prepare(
      "SELECT id FROM beats WHERE featured = 1 AND category = ?"
    ).bind(category).all();
    const featuredIds = new Set((current.results || []).map(row => row.id));

    if (
      featuredIds.size !== ids.length ||
      !ids.every(id => featuredIds.has(id))
    ) {
      return json({
        error: "The featured list has changed. Refresh the dashboard and try again."
      }, 409);
    }

    await env.DB.batch(ids.map((id, index) =>
      env.DB.prepare(
        "UPDATE beats SET featured_position = ? WHERE id = ? AND featured = 1 AND category = ?"
      ).bind(index + 1, id, category)
    ));

    return json({ success: true, category, ids });
  }

  const match = path.match(
    /^\/api\/admin\/(?:beats|products)\/([a-z0-9-]+)$/
  );

  if (match && request.method === "PATCH") {
    const id = match[1];
    const existing = await getProduct(env, id);
    if (!existing) return json({ error: "Product not found." }, 404);

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const title = cleanText(data.title, 120);
    const genre = cleanText(data.genre || data.type || existing.genre, 80);
    const description = cleanText(data.description, 2000);
    const musicalKey = cleanText(data.musical_key ?? data.musicalKey, 40);
    const bpm = data.bpm === "" || data.bpm == null ? null : Number(data.bpm);
    const price = Number(data.price);
    const category = validCategory(
      cleanText(data.category || existing.category || "beats", 40).toLowerCase()
    );
    const featured = Number(data.featured) === 1 || data.featured === true ? 1 : 0;
    const status = data.status === "published" ? "published" : "draft";

    if (!title || !genre || !category) {
      return json({
        error: "Title, genre, and a valid category are required."
      }, 400);
    }

    if (
      !Number.isSafeInteger(price) ||
      price < 1 ||
      (bpm !== null && (!Number.isInteger(bpm) || bpm < 1 || bpm > 400))
    ) {
      return json({ error: "Check the price and BPM values." }, 400);
    }

    if (status === "published") {
      const required = [
        { column: "artwork_key", label: "artwork" },
        { column: "zip_key", label: "download ZIP" }
      ];
      if (category === "beats") {
        required.splice(1, 0, {
          column: "preview_key",
          label: "preview audio"
        });
      }

      for (const item of required) {
        const found = await repairStoredFileKey(
          env,
          existing,
          item.column
        );
        if (!found.found) {
          return json({
            error: `The ${item.label} file is not present in R2 for ${existing.title}. Upload that file before publishing.`,
            missing: item.column,
            productId: id
          }, 400);
        }
      }
    }

    await ensurePublishedAtColumn(env);
    await ensureFeaturedPositionColumn(env);
    await ensureCataloguePositionColumn(env);

    // published_at is stamped only at the moment a product goes from
    // draft to published (SQLite reads the OLD status in this expression).
    // Editing a live product never changes its position in the store.
    // Newly featured products join the end of the featured order; editing
    // an already featured product keeps its place.
    await env.DB.prepare(`UPDATE beats
      SET title = ?, genre = ?, bpm = ?, musical_key = ?, price = ?,
          description = ?, category = ?, featured = ?,
          featured_position = CASE
            WHEN ? = 0 THEN NULL
            WHEN featured = 1 AND category = ? THEN featured_position
            ELSE (
              SELECT COALESCE(MAX(featured_position), 0) + 1
              FROM beats WHERE featured = 1 AND category = ?
            )
          END,
          catalogue_position = CASE
            WHEN ? = 'beats' AND catalogue_position IS NULL THEN (
              SELECT COALESCE(MIN(catalogue_position) - 1, 1)
              FROM beats WHERE category = 'beats'
            )
            ELSE catalogue_position
          END,
          published_at = CASE
            WHEN ? = 'published' AND status != 'published'
              THEN CURRENT_TIMESTAMP
            ELSE published_at
          END,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`)
      .bind(
        title,
        genre,
        bpm,
        musicalKey,
        price,
        description,
        category,
        featured,
        featured,
        category,
        category,
        category,
        status,
        status,
        id
      ).run();

    const updated = await getProduct(env, id);
    return json({ success: true, beat: updated, product: updated });
  }

  if (match && request.method === "DELETE") {
    const id = match[1];
    const product = await getProduct(env, id);
    if (!product) return json({ error: "Product not found." }, 404);

    for (const key of [
      product.artwork_key,
      product.preview_key,
      product.zip_key
    ]) {
      if (key) await env.BEATS_BUCKET.delete(key);
    }

    await env.DB.prepare("DELETE FROM beats WHERE id = ?").bind(id).run();
    return json({ success: true });
  }

  return json({ error: "Admin endpoint not found." }, 404);
}

// ==========================================
// WORKER ENTRY POINT
// ==========================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": url.origin,
          "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (path === "/api/paystack-webhook" && request.method === "POST") {
      try {
        return await handlePaystackWebhook(request, env, url);
      } catch (error) {
        console.error("Webhook handler error:", error);
        return json({ error: "Webhook handler failed." }, 500);
      }
    }

    if (path.startsWith("/api/admin/")) {
      try {
        return await handleAdmin(request, env, url);
      } catch (error) {
        console.error("Admin API error:", error);
        return json({ error: "Admin request failed." }, 500);
      }
    }

    if (path === "/api/beats" && request.method === "GET") {
      try {
        const beats = await getPublishedBeats(env);
        return json({
          beats: beats.map(beat => ({
            ...beat,
            artwork: beat.artwork_key
              ? `/api/media/${encodeURIComponent(beat.id)}/artwork`
              : "",
            previewAudio: beat.preview_key
              ? `/api/media/${encodeURIComponent(beat.id)}/preview`
              : "",
            formats: ["MP3", "WAV"],
            available: true
          }))
        });
      } catch (error) {
        console.error("Beat catalogue error:", error);
        return json({ error: "Catalogue unavailable." }, 500);
      }
    }

    const singleBeatMatch = path.match(/^\/api\/beats\/([a-z0-9-]+)$/);
    if (singleBeatMatch && request.method === "GET") {
      try {
        const product = await getProduct(env, singleBeatMatch[1]);
        if (!product || product.status !== "published") {
          return json({ error: "Beat not found." }, 404);
        }
        return json({
          ...product,
          artwork: product.artwork_key
            ? `/api/media/${encodeURIComponent(product.id)}/artwork`
            : "",
          previewAudio: product.preview_key
            ? `/api/media/${encodeURIComponent(product.id)}/preview`
            : "",
          formats: ["MP3", "WAV"],
          available: true
        });
      } catch (error) {
        console.error("Single beat error:", error);
        return json({ error: "Beat unavailable." }, 500);
      }
    }

    if (path === "/api/products" && request.method === "GET") {
      const category = validCategory(url.searchParams.get("category") || "");
      if (!category) {
        return json({
          error: "Choose category=beats, samples, or studio-tools."
        }, 400);
      }
      try {
        const products = await getPublishedProducts(env, category);
        return json({
          products: products.map(product => ({
            ...product,
            artwork: product.artwork_key
              ? `/api/media/${encodeURIComponent(product.id)}/artwork`
              : "",
            previewAudio: product.preview_key
              ? `/api/media/${encodeURIComponent(product.id)}/preview`
              : "",
            available: true
          }))
        });
      } catch (error) {
        console.error("Product catalogue error:", error);
        return json({ error: "Catalogue unavailable." }, 500);
      }
    }

    const mediaMatch = path.match(
      /^\/api\/media\/([a-z0-9-]+)\/(artwork|preview)$/
    );

    if (mediaMatch && request.method === "GET") {
      try {
        const product = await getProduct(env, mediaMatch[1]);
        if (!product || product.status !== "published") {
          return new Response("Not found.", { status: 404 });
        }

        const column = mediaMatch[2] === "artwork"
          ? "artwork_key"
          : "preview_key";
        let key = product[column];

        if (key) {
          const object = await env.BEATS_BUCKET.get(key);
          if (object) {
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Cache-Control", "public, max-age=300");
            headers.set("X-Content-Type-Options", "nosniff");
            return new Response(object.body, { headers });
          }
        }

        const recovered = await repairStoredFileKey(env, product, column);
        if (!recovered.found) {
          return new Response("Not found.", { status: 404 });
        }

        const object = await env.BEATS_BUCKET.get(recovered.key);
        if (!object) return new Response("Not found.", { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("Cache-Control", "public, max-age=300");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(object.body, { headers });
      } catch (error) {
        console.error("Media error:", error);
        return new Response("Media unavailable.", { status: 500 });
      }
    }

    if (path === "/api/create-payment" && request.method === "POST") {
      try {
        if (!env.PAYSTACK_SECRET_KEY || !env.DB) {
          return json({
            status: false,
            error: "Payment service is not configured."
          }, 500);
        }

        let data;
        try {
          data = await request.json();
        } catch {
          return json({
            status: false,
            error: "Invalid request data."
          }, 400);
        }

        const email = typeof data.email === "string"
          ? data.email.trim()
          : "";

        if (
          !email ||
          email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
          return json({
            status: false,
            error: "Please enter a valid email address."
          }, 400);
        }

        const selection = await getRequestedProducts(data, env);
        if (selection.error) {
          return json({ status: false, error: selection.error }, 400);
        }

        const { products, total } = selection;
        const ids = products.map(item => item.id);
        const titles = products.map(item => item.title);

        const response = await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email,
              amount: total * 100,
              currency: "NGN",
              callback_url: CALLBACK_URL,
              metadata: {
                productIds: JSON.stringify(ids),
                productTitles: JSON.stringify(titles),
                beatIds: JSON.stringify(ids),
                beatTitles: JSON.stringify(titles),
                itemCount: ids.length,
                ...(products.length === 1 ? {
                  productId: products[0].id,
                  productTitle: products[0].title,
                  beatId: products[0].id,
                  beatTitle: products[0].title
                } : {})
              }
            })
          }
        );

        const result = await response.json();

        if (
          !response.ok ||
          !result.status ||
          !result.data?.authorization_url ||
          !result.data?.reference
        ) {
          console.error("Paystack initialization failed:", result.message);
          return json({
            status: false,
            error: result.message || "Unable to initialize payment."
          }, 502);
        }

        return json(result);
      } catch (error) {
        console.error("Payment initialization error:", error);
        return json({
          status: false,
          error: "Payment initialization failed. Please try again."
        }, 500);
      }
    }

    if (path === "/api/verify-payment" && request.method === "GET") {
      try {
        if (!env.PAYSTACK_SECRET_KEY || !env.DB) {
          return json({
            success: false,
            error: "Payment verification is not configured."
          }, 500);
        }

        const reference = url.searchParams.get("reference");
        if (!reference || reference.length > 200) {
          return json({
            success: false,
            error: "Payment reference missing or invalid."
          }, 400);
        }

        const transaction = await verifyPaystackTransaction(reference, env);
        const { products, email } = await getVerifiedPurchase(transaction, env);

        // EMAIL FALLBACK:
        // The payment is independently verified with Paystack above.
        // If the webhook has not sent the receipt, this route can send it.
        // The shared D1 record prevents the webhook and this route from
        // sending duplicate receipts for the same payment reference.
        let emailDelivery = {
          sent: false,
          duplicate: false,
          processing: false,
          error: false
        };

        try {
          const delivery = await deliverPurchaseEmailOnce(
            env,
            reference,
            email,
            products
          );
          emailDelivery = {
            sent: delivery.sent,
            duplicate: delivery.duplicate,
            processing: delivery.processing,
            error: false
          };
        } catch (emailError) {
          // Do not break the success page or downloads if email fails.
          console.error("Verified-payment email fallback failed:", emailError);
          emailDelivery.error = true;
        }

        const purchasedProducts = [];

        for (const product of products) {
          const token = await createDownloadToken({
            reference,
            productId: product.id,
            beatId: product.id,
            exp: Date.now() + DOWNLOAD_TOKEN_LIFETIME
          }, env.PAYSTACK_SECRET_KEY);

          const downloadUrl =
            `${url.origin}/api/download?token=${encodeURIComponent(token)}`;

          purchasedProducts.push({
            productId: product.id,
            productTitle: product.title,
            beatId: product.id,
            beatTitle: product.title,
            category: product.category,
            downloadUrl
          });
        }

        return json({
          success: true,
          emailSent: emailDelivery.sent,
          emailProcessing: emailDelivery.processing,
          emailError: emailDelivery.error,
          products: purchasedProducts,
          beats: purchasedProducts,
          total: products.reduce((sum, product) => sum + product.price, 0),
          currency: "NGN",
          ...(purchasedProducts.length === 1 ? {
            productTitle: purchasedProducts[0].productTitle,
            beatTitle: purchasedProducts[0].beatTitle,
            downloadUrl: purchasedProducts[0].downloadUrl
          } : {})
        });
      } catch (error) {
        console.error("Payment verification error:", error);
        return json({
          success: false,
          error: "Payment verification failed. Please try again."
        }, 500);
      }
    }

    if (path === "/api/download" && request.method === "GET") {
      try {
        if (!env.PAYSTACK_SECRET_KEY || !env.BEATS_BUCKET) {
          return new Response("Download service is not configured.", {
            status: 500
          });
        }

        const token = url.searchParams.get("token");
        if (!token) {
          return new Response("Download token missing.", { status: 400 });
        }

        const data = await verifyDownloadToken(token, env.PAYSTACK_SECRET_KEY);
        if (!data) {
          return new Response("Invalid or expired download link.", {
            status: 403
          });
        }

        const id = data.productId || data.beatId;
        let product = await getProduct(env, id);

        if (!product && LEGACY_BEATS[id]) {
          product = {
            id,
            title: LEGACY_BEATS[id].title,
            category: "beats",
            zip_key: null
          };
        }

        if (!product) {
          return new Response("Product not found.", { status: 404 });
        }

        const object = await getZipObject(env, product);
        if (!object) {
          return new Response(
            "Download file not found in storage. Please contact support.",
            { status: 404 }
          );
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("Content-Type", "application/zip");
        headers.set(
          "Content-Disposition",
          `attachment; filename="${safeFilename(product.title)}.zip"`
        );
        headers.set("Cache-Control", "private, no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(object.body, { status: 200, headers });
      } catch (error) {
        console.error("Download error:", error);
        return new Response("Download failed. Please try again.", {
          status: 500
        });
      }
    }

    // Individual beat pages: /beat/<id> serves beat.html with server-side
    // Open Graph + Twitter Card metadata injected into the initial HTML so
    // social crawlers (WhatsApp, X, etc.) can read the title, description
    // and artwork without executing client-side JavaScript.
    const beatPageMatch = path.match(/^\/beat\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);

    if (beatPageMatch && request.method === "GET") {
      const beatId = beatPageMatch[1];
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/beat";

      const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (!assetResponse.ok) return assetResponse;

      let html = await assetResponse.text();

      try {
        const product = await getProduct(env, beatId);

        if (product && product.status === "published") {
          const title = String(product.title || beatId);
          const description = "Listen to and purchase this beat from WagwanSpark Sound Lab.";
          const beatUrl = `${url.origin}/beat/${beatId}`;

          let hasArtwork = Boolean(product.artwork_key);
          if (!hasArtwork) {
            const recovered = await repairStoredFileKey(env, product, "artwork_key");
            hasArtwork = recovered.found;
          }

          const artworkUrl = `${url.origin}/api/media/${encodeURIComponent(beatId)}/artwork`;
          const ogTitle = `${title} | WagwanSpark Sound Lab`;

          const metaTags = [
            `<meta property="og:title" content="${escapeHtml(ogTitle)}">`,
            `<meta property="og:description" content="${escapeHtml(description)}">`,
            `<meta property="og:url" content="${escapeHtml(beatUrl)}">`,
            `<meta property="og:type" content="website">`,
            `<meta property="og:site_name" content="WagwanSpark Sound Lab">`,
            hasArtwork
              ? `<meta property="og:image" content="${escapeHtml(artworkUrl)}">`
              : "",
            hasArtwork
              ? `<meta property="og:image:alt" content="${escapeHtml(title + " artwork")}">`
              : "",
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:title" content="${escapeHtml(ogTitle)}">`,
            `<meta name="twitter:description" content="${escapeHtml(description)}">`,
            hasArtwork
              ? `<meta name="twitter:image" content="${escapeHtml(artworkUrl)}">`
              : ""
          ].filter(Boolean).join("\n    ");

          html = html.replace(
            /<title>.*?<\/title>/s,
            `<title>${escapeHtml(title)} — WagwanSpark Sound Lab</title>`
          );

          html = html.replace(
            /(<meta name="description"[^>]*>)/,
            `$1\n    ${metaTags}`
          );
        }
      } catch (error) {
        console.error("Beat page OG metadata injection failed:", error);
      }

      const headers = new Headers(assetResponse.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");

      return new Response(html, {
        status: assetResponse.status,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
