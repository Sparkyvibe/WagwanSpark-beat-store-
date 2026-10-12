
 // ==========================================
 // WAGWANSPARK — BEAT STORE WORKER
 // Beats • Samples • Studio Tools
 // ==========================================

const LEGACY_BEATS = {
  "sun-fire": {
    title: "SUN FIRE",
    price: 7000,
    candidates: ["beats/SUN FIRE.zip", "SUN FIRE.zip"]
  },
  phenomenal: {
    title: "PHENOMENAL",
    price: 7000,
    candidates: ["beats/PHENOMENAL.zip", "PHENOMENAL.zip"]
  },
  serenade: {
    title: "SERENADE",
    price: 7000,
    candidates: ["beats/SERENADE.zip", "SERENADE.zip"]
  }
};

const CATEGORIES = ["beats", "samples", "studio-tools"];

const CALLBACK_URL =
  "https://wagwanspark-beat-store.taiyeowoyemi.workers.dev/success.html";

const DOWNLOAD_TOKEN_LIFETIME = 30 * 60 * 1000;
const EMAIL_DOWNLOAD_TOKEN_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const SESSION_COOKIE = "ws_admin_session";

// ==========================================
// GENERAL HELPERS
// ==========================================

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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(value) {
  value = value.replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
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

  if (
    typeof signature !== "string" ||
    signature.length !== expected.length
  ) return false;

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
      .map(byte => byte.toString(16).padStart(2, "0"))
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
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify(data))
  );
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
    typeof data.beatId !== "string" ||
    typeof data.reference !== "string"
  ) return null;

  return data;
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;

    if (part.slice(0, index).trim() === name) {
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

  if (
    !session ||
    session.role !== "admin" ||
    typeof session.csrf !== "string"
  ) return null;

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
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function validCategory(value) {
  return CATEGORIES.includes(value) ? value : null;
}

function categoryOf(product) {
  return validCategory(product.category) || "beats";
}

function productLabel(category) {
  return category === "samples"
    ? "sample pack"
    : category === "studio-tools"
      ? "studio tool"
      : "beat";
}

// ==========================================
// DATABASE HELPERS
// ==========================================

async function getBeat(env, id) {
  return env.DB.prepare(
    `SELECT id, title, genre, bpm, musical_key, price, description,
            artwork_key, preview_key, zip_key, status, featured,
            category, created_at, updated_at
     FROM beats WHERE id = ?`
  ).bind(id).first();
}

async function getPublishedBeats(env, category = "beats") {
  const safeCategory = validCategory(category) || "beats";

  const result = await env.DB.prepare(
    `SELECT id, title, genre, bpm, musical_key, price, description,
            artwork_key, preview_key, status, featured, category,
            created_at, updated_at
     FROM beats
     WHERE status = 'published'
       AND COALESCE(category, 'beats') = ?
     ORDER BY featured DESC, created_at DESC`
  ).bind(safeCategory).all();

  return result.results || [];
}

// ==========================================
// R2 FILE LOOKUP AND KEY RECOVERY
// ==========================================

function beatFileNameVariants(beat) {
  const id = String(beat.id || "");
  const title = String(beat.title || "");

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

function mediaKeyCandidates(beat, column) {
  const candidates = [];
  if (beat[column]) candidates.push(beat[column]);

  const names = beatFileNameVariants(beat);
  const category = categoryOf(beat);

  if (column === "artwork_key") {
    for (const name of names) {
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        candidates.push(`artwork/${name}.${ext}`);
        candidates.push(`artworks/${name}.${ext}`);
      }
    }
  }

  if (column === "preview_key") {
    for (const name of names) {
      for (const ext of ["mp3", "wav"]) {
        candidates.push(`previews/${name}.${ext}`);
        candidates.push(`preview/${name}.${ext}`);
      }
    }
  }

  if (column === "zip_key") {
    const folder = category === "samples"
      ? "samples"
      : category === "studio-tools"
        ? "studio-tools"
        : "beats";

    for (const name of names) {
      candidates.push(`${folder}/${name}.zip`);

      // Keep the old beat paths usable for existing products.
      if (category === "beats") {
        candidates.push(`beats/${name}.zip`);
      }

      candidates.push(`${name}.zip`);
    }

    const legacy = LEGACY_BEATS[beat.id];
    if (legacy) candidates.push(...legacy.candidates);
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function findExistingR2Object(env, beat, column) {
  if (!env.BEATS_BUCKET) return { key: null, object: null };

  for (const key of mediaKeyCandidates(beat, column)) {
    try {
      const object = await env.BEATS_BUCKET.head(key);
      if (object) return { key, object };
    } catch (error) {
      console.error("R2 object lookup failed:", key, error);
    }
  }

  return { key: null, object: null };
}

async function repairStoredFileKey(env, beat, column) {
  const found = await findExistingR2Object(env, beat, column);
  if (!found.key) return { found: false, key: null };

  if (beat[column] !== found.key) {
    await env.DB.prepare(
      `UPDATE beats
       SET ${column} = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(found.key, beat.id).run();

    beat[column] = found.key;
  }

  return { found: true, key: found.key };
}

async function getZipObject(env, beat) {
  if (!env.BEATS_BUCKET) return null;

  const found = await findExistingR2Object(env, beat, "zip_key");
  if (!found.key) return null;

  if (beat.zip_key !== found.key) {
    await env.DB.prepare(
      `UPDATE beats
       SET zip_key = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(found.key, beat.id).run();

    beat.zip_key = found.key;
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
// CHECKOUT HELPERS
// ==========================================

async function getRequestedBeats(data, env) {
  let productIds;

  if (Array.isArray(data.beatIds)) {
    productIds = data.beatIds;
  } else if (typeof data.beatId === "string") {
    productIds = [data.beatId];
  } else {
    return { error: "Please select at least one product." };
  }

  if (
    productIds.length === 0 ||
    productIds.length > 50 ||
    productIds.some(id => typeof id !== "string")
  ) {
    return { error: "Invalid number of selected products." };
  }

  if (new Set(productIds).size !== productIds.length) {
    return { error: "Duplicate products are not allowed." };
  }

  const beats = [];

  for (const id of productIds) {
    const beat = await getBeat(env, id);

    if (!beat || beat.status !== "published") {
      return { error: "One or more selected products are unavailable." };
    }

    if (!Number.isSafeInteger(beat.price) || beat.price < 1) {
      return { error: "Invalid product price." };
    }

    beats.push({
      id: beat.id,
      title: beat.title,
      price: beat.price,
      category: categoryOf(beat)
    });
  }

  return {
    beats,
    total: beats.reduce((sum, beat) => sum + beat.price, 0)
  };
}

function getPurchasedBeatIds(metadata) {
  if (!metadata || typeof metadata !== "object") return null;

  if (Array.isArray(metadata.beatIds)) return metadata.beatIds;

  if (typeof metadata.beatIds === "string") {
    try {
      const parsed = JSON.parse(metadata.beatIds);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  if (typeof metadata.beatId === "string") return [metadata.beatId];

  return null;
}

// ==========================================
// EMAIL DELIVERY
// ==========================================

async function verifyPaystackTransaction(reference, env) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
      }
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
  const beatIds = getPurchasedBeatIds(transaction.metadata || {});

  if (
    !Array.isArray(beatIds) ||
    beatIds.length === 0 ||
    beatIds.length > 50 ||
    beatIds.some(id => typeof id !== "string") ||
    new Set(beatIds).size !== beatIds.length
  ) {
    throw new Error("Purchased products could not be identified.");
  }

  const beats = [];

  for (const id of beatIds) {
    const beat = await getBeat(env, id);

    if (!beat || !Number.isSafeInteger(beat.price) || beat.price < 1) {
      throw new Error("Purchased product could not be verified.");
    }

    beats.push({
      id: beat.id,
      title: beat.title,
      price: beat.price,
      category: categoryOf(beat)
    });
  }

  const expectedKobo = beats.reduce(
    (sum, beat) => sum + beat.price * 100,
    0
  );

  if (
    !Number.isSafeInteger(expectedKobo) ||
    Number(transaction.amount) !== expectedKobo
  ) {
    throw new Error("Payment amount does not match the purchase.");
  }

  const email = cleanText(transaction.customer?.email, 254);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Verified customer email is missing or invalid.");
  }

  return { beats, email };
}

async function sendPurchaseEmail(env, email, reference, beats, origin) {
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

  for (const beat of beats) {
    const token = await createDownloadToken({
      reference,
      beatId: beat.id,
      exp: Date.now() + EMAIL_DOWNLOAD_TOKEN_LIFETIME
    }, env.PAYSTACK_SECRET_KEY);

    const downloadUrl =
      `${origin}/api/download?token=${encodeURIComponent(token)}`;

    downloadLines.push(`${beat.title}\nDownload: ${downloadUrl}`);
  }

  const subject = beats.length === 1
    ? `WagwanSpark — ${beats[0].title} Download`
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
    console.error("Email endpoint HTTP error:", response.status);
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
// PAYSTACK WEBHOOK
// ==========================================

async function handlePaystackWebhook(request, env, url) {
  if (!env.PAYSTACK_SECRET_KEY || !env.DB || !env.BEATS_BUCKET) {
    return json({ error: "Payment service is not configured." }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature") || "";

  const signatureValid = await verifyPaystackWebhookSignature(
    rawBody,
    signature,
    env.PAYSTACK_SECRET_KEY
  );

  if (!signatureValid) {
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

  if (
    typeof reference !== "string" ||
    !reference ||
    reference.length > 200
  ) {
    return json({ error: "Invalid payment reference." }, 400);
  }

  try {
    const transaction = await verifyPaystackTransaction(reference, env);

    if (
      event.data?.reference !== transaction.reference ||
      Number(event.data?.amount) !== Number(transaction.amount) ||
      event.data?.currency !== transaction.currency
    ) {
      return json({
        error: "Webhook and verified transaction do not match."
      }, 400);
    }

    const { beats, email } = await getVerifiedPurchase(transaction, env);

    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS email_deliveries (
        reference TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TEXT
      )`
    ).run();

    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO email_deliveries
       (reference, recipient, status)
       VALUES (?, ?, 'processing')`
    ).bind(reference, email).run();

    const wasInserted = Number(inserted.meta?.changes || 0) > 0;

    if (!wasInserted) {
      const existing = await env.DB.prepare(
        `SELECT reference, recipient, status, updated_at
         FROM email_deliveries WHERE reference = ?`
      ).bind(reference).first();

      if (existing?.status === "sent") {
        return json({ received: true, emailSent: true, duplicate: true });
      }

      const updatedAt = existing?.updated_at
        ? Date.parse(`${existing.updated_at.replace(" ", "T")}Z`)
        : NaN;

      const stale =
        !Number.isFinite(updatedAt) ||
        Date.now() - updatedAt > 5 * 60 * 1000;

      if (!existing || existing.recipient !== email) {
        return json({ error: "Email delivery record mismatch." }, 500);
      }

      if (existing.status === "processing" && !stale) {
        return json({ received: true, processing: true });
      }

      const reclaimed = await env.DB.prepare(
        `UPDATE email_deliveries
         SET recipient = ?, status = 'processing',
             updated_at = CURRENT_TIMESTAMP
         WHERE reference = ? AND status != 'sent'`
      ).bind(email, reference).run();

      if (Number(reclaimed.meta?.changes || 0) < 1) {
        const latest = await env.DB.prepare(
          `SELECT status FROM email_deliveries WHERE reference = ?`
        ).bind(reference).first();

        if (latest?.status === "sent") {
          return json({ received: true, emailSent: true, duplicate: true });
        }

        return json({ error: "Could not claim email delivery." }, 500);
      }
    }

    try {
      await sendPurchaseEmail(env, email, reference, beats, url.origin);

      await env.DB.prepare(
        `UPDATE email_deliveries
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE reference = ?`
      ).bind(reference).run();

      return json({ received: true, emailSent: true });
    } catch (emailError) {
      console.error("Purchase email delivery failed:", emailError);

      await env.DB.prepare(
        `UPDATE email_deliveries
         SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE reference = ?`
      ).bind(reference).run();

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
// ADMIN API
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

  const isReadOnly =
    request.method === "GET" && path === "/api/admin/beats";

  const auth = await requireAdmin(request, env, !isReadOnly);
  if (auth.response) return auth.response;

  if (path === "/api/admin/beats" && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT * FROM beats ORDER BY created_at DESC`
    ).all();

    return json({ beats: result.results || [] });
  }

  // Create a product draft in any category.
  if (path === "/api/admin/beats" && request.method === "POST") {
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const id = cleanText(data.id, 80).toLowerCase();
    const title = cleanText(data.title, 120);
    const genre = cleanText(data.genre, 80);
    const musicalKey = cleanText(data.musical_key, 40);
    const category = validCategory(data.category || "beats");

    const bpm = data.bpm === "" || data.bpm == null
      ? null
      : Number(data.bpm);

    const price = Number(data.price);

    if (!validId(id) || !title || !genre) {
      return json({
        error: "Provide a valid ID, title, and genre."
      }, 400);
    }

    if (!category) {
      return json({
        error: "Category must be beats, samples, or studio-tools."
      }, 400);
    }

    if (
      !Number.isSafeInteger(price) || price < 1 ||
      (bpm !== null &&
        (!Number.isInteger(bpm) || bpm < 1 || bpm > 400))
    ) {
      return json({ error: "Check the price and BPM values." }, 400);
    }

    try {
      await env.DB.prepare(
        `INSERT INTO beats
         (id, title, genre, bpm, musical_key, price, description,
          category, status, featured, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        id,
        title,
        genre,
        category === "beats" ? bpm : null,
        category === "beats" ? musicalKey : "",
        price,
        cleanText(data.description, 2000),
        category
      ).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        return json({ error: "That product ID already exists." }, 409);
      }
      throw error;
    }

    return json({ success: true, beat: await getBeat(env, id) }, 201);
  }

  // Upload artwork, optional preview, or private ZIP package.
  if (path === "/api/admin/upload" && request.method === "POST") {
    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Could not read the uploaded file." }, 400);
    }

    const id = cleanText(form.get("beatId"), 80).toLowerCase();
    const kind = cleanText(form.get("kind"), 20).toLowerCase();
    const file = form.get("file");

    if (!validId(id) || !file || typeof file.arrayBuffer !== "function") {
      return json({ error: "Select a product and a file." }, 400);
    }

    const beat = await getBeat(env, id);
    if (!beat) return json({ error: "Product not found." }, 404);

    const category = categoryOf(beat);
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
      const ext = mime === "image/jpeg"
        ? "jpg"
        : mime === "image/png"
          ? "png"
          : "webp";

      key = `artwork/${id}.${ext}`;
      column = "artwork_key";
      contentType = mime;
    } else if (kind === "preview") {
      if (!["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(mime)) {
        return json({ error: "Preview must be an MP3 or WAV audio file." }, 400);
      }

      maxBytes = 25 * 1024 * 1024;
      const ext = mime.includes("wav") ? "wav" : "mp3";

      key = `previews/${id}.${ext}`;
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

      const folder = category === "samples"
        ? "samples"
        : category === "studio-tools"
          ? "studio-tools"
          : "beats";

      key = `${folder}/${id}.zip`;
      column = "zip_key";
      contentType = "application/zip";
    } else {
      return json({ error: "Unknown upload type." }, 400);
    }

    if (!file.size) {
      return json({ error: "The selected file is empty." }, 400);
    }

    if (file.size > maxBytes) {
      return json({
        error: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB size limit.`
      }, 413);
    }

    try {
      await env.BEATS_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType },
        customMetadata: { beatId: id, kind, category }
      });
    } catch (error) {
      console.error("R2 upload failed:", { id, kind, key, error });
      return json({
        error: "R2 could not save the uploaded file. Please try again."
      }, 500);
    }

    let storedObject;
    try {
      storedObject = await env.BEATS_BUCKET.head(key);
    } catch (error) {
      console.error("R2 upload verification failed:", { key, error });
    }

    if (!storedObject) {
      return json({
        error: `Upload verification failed for ${key}. Please retry the upload.`
      }, 500);
    }

    try {
      await env.DB.prepare(
        `UPDATE beats
         SET ${column} = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(key, id).run();
    } catch (error) {
      console.error("Database file-key update failed:", error);
      return json({
        error: "The file is in R2, but its key could not be saved. Retry the upload."
      }, 500);
    }

    const updatedBeat = await getBeat(env, id);

    if (!updatedBeat || updatedBeat[column] !== key) {
      return json({
        error: "The database did not confirm the uploaded file key. Please retry."
      }, 500);
    }

    return json({ success: true, kind, key, beat: updatedBeat });
  }

  const beatMatch = path.match(/^\/api\/admin\/beats\/([a-z0-9-]+)$/);

  if (beatMatch && request.method === "PATCH") {
    const id = beatMatch[1];
    const existing = await getBeat(env, id);
    if (!existing) return json({ error: "Product not found." }, 404);

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const title = cleanText(data.title, 120);
    const genre = cleanText(data.genre, 80);
    const description = cleanText(data.description, 2000);
    const musicalKey = cleanText(data.musical_key, 40);
    const category = validCategory(data.category || categoryOf(existing));

    const bpm = data.bpm === "" || data.bpm == null
      ? null
      : Number(data.bpm);

    const price = Number(data.price);
    const featured = Number(data.featured) === 1 ? 1 : 0;
    const status = data.status === "published" ? "published" : "draft";

    if (!title || !genre) {
      return json({ error: "Title and genre are required." }, 400);
    }

    if (!category) {
      return json({
        error: "Category must be beats, samples, or studio-tools."
      }, 400);
    }

    if (
      !Number.isSafeInteger(price) || price < 1 ||
      (category === "beats" && bpm !== null &&
        (!Number.isInteger(bpm) || bpm < 1 || bpm > 400))
    ) {
      return json({ error: "Check the price and BPM values." }, 400);
    }

    // Publishing requirements vary by category.
    // All products require artwork and a ZIP.
    // Only beats require preview audio.
    if (status === "published") {
      const requiredFiles = [
        { column: "artwork_key", label: "artwork" },
        { column: "zip_key", label: "ZIP package" }
      ];

      if (category === "beats") {
        requiredFiles.push({
          column: "preview_key",
          label: "preview audio"
        });
      }

      const productForValidation = {
        ...existing,
        category
      };

      for (const item of requiredFiles) {
        const result = await repairStoredFileKey(
          env,
          productForValidation,
          item.column
        );

        if (!result.found) {
          return json({
            error: `The ${item.label} file is not present in R2 for ${title}. Upload that file again before publishing.`,
            missing: item.column,
            beatId: id
          }, 400);
        }
      }
    }

    await env.DB.prepare(
      `UPDATE beats
       SET title = ?, genre = ?, bpm = ?, musical_key = ?, price = ?,
           description = ?, category = ?, status = ?, featured = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      title,
      genre,
      category === "beats" ? bpm : null,
      category === "beats" ? musicalKey : "",
      price,
      description,
      category,
      status,
      featured,
      id
    ).run();

    return json({ success: true, beat: await getBeat(env, id) });
  }

  if (beatMatch && request.method === "DELETE") {
    const id = beatMatch[1];
    const beat = await getBeat(env, id);
    if (!beat) return json({ error: "Product not found." }, 404);

    for (const key of [
      beat.artwork_key,
      beat.preview_key,
      beat.zip_key
    ]) {
      if (key) {
        try {
          await env.BEATS_BUCKET.delete(key);
        } catch (error) {
          console.error("R2 delete failed:", key, error);
        }
      }
    }

    await env.DB.prepare("DELETE FROM beats WHERE id = ?").bind(id).run();
    return json({ success: true });
  }

  return json({ error: "Admin endpoint not found." }, 404);
}

// ==========================================
// PUBLIC CATALOGUE FORMATTER
// ==========================================

function formatPublicProduct(product, origin) {
  return {
    ...product,
    category: categoryOf(product),
    artwork: product.artwork_key
      ? `${origin}/api/media/${encodeURIComponent(product.id)}/artwork`
      : "",
    previewAudio: product.preview_key
      ? `${origin}/api/media/${encodeURIComponent(product.id)}/preview`
      : "",
    formats: ["ZIP"],
    available: true
  };
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

    // Existing beats endpoint remains compatible with the current store.
    if (path === "/api/beats" && request.method === "GET") {
      try {
        const beats = await getPublishedBeats(env, "beats");
        return json({
          beats: beats.map(beat => ({
            ...formatPublicProduct(beat, url.origin),
            formats: ["MP3", "WAV"]
          }))
        });
      } catch (error) {
        console.error("Public beats catalogue error:", error);
        return json({ error: "Catalogue unavailable." }, 500);
      }
    }

    // Separate category endpoint for Samples and Studio Tools pages.
    if (path === "/api/products" && request.method === "GET") {
      try {
        const category = validCategory(url.searchParams.get("category"));

        if (!category || category === "beats") {
          return json({
            error: "Choose category=samples or category=studio-tools."
          }, 400);
        }

        const products = await getPublishedBeats(env, category);

        return json({
          category,
          products: products.map(product =>
            formatPublicProduct(product, url.origin)
          )
        });
      } catch (error) {
        console.error("Public products catalogue error:", error);
        return json({ error: "Catalogue unavailable." }, 500);
      }
    }

    // Public artwork and preview audio. ZIP files are never served here.
    const mediaMatch = path.match(
      /^\/api\/media\/([a-z0-9-]+)\/(artwork|preview)$/
    );

    if (mediaMatch && request.method === "GET") {
      try {
        const product = await getBeat(env, mediaMatch[1]);

        if (!product || product.status !== "published") {
          return new Response("Not found.", { status: 404 });
        }

        const column = mediaMatch[2] === "artwork"
          ? "artwork_key"
          : "preview_key";

        if (column === "preview_key" && categoryOf(product) !== "beats") {
          return new Response("Not found.", { status: 404 });
        }

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

    // ========================================
    // CREATE PAYMENT
    // ========================================

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

        const selection = await getRequestedBeats(data, env);
        if (selection.error) {
          return json({ status: false, error: selection.error }, 400);
        }

        const { beats, total } = selection;
        const beatIds = beats.map(beat => beat.id);
        const beatTitles = beats.map(beat => beat.title);

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
                beatIds: JSON.stringify(beatIds),
                beatTitles: JSON.stringify(beatTitles),
                itemCount: beatIds.length,
                ...(beats.length === 1 ? {
                  beatId: beats[0].id,
                  beatTitle: beats[0].title
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

    // ========================================
    // VERIFY PAYMENT
    // ========================================

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
        const { beats } = await getVerifiedPurchase(transaction, env);
        const purchasedBeats = [];

        for (const beat of beats) {
          const token = await createDownloadToken({
            reference,
            beatId: beat.id,
            exp: Date.now() + DOWNLOAD_TOKEN_LIFETIME
          }, env.PAYSTACK_SECRET_KEY);

          purchasedBeats.push({
            beatId: beat.id,
            beatTitle: beat.title,
            downloadUrl:
              `${url.origin}/api/download?token=${encodeURIComponent(token)}`
          });
        }

        return json({
          success: true,
          beats: purchasedBeats,
          total: beats.reduce((sum, beat) => sum + beat.price, 0),
          currency: "NGN",
          ...(purchasedBeats.length === 1 ? {
            beatTitle: purchasedBeats[0].beatTitle,
            downloadUrl: purchasedBeats[0].downloadUrl
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

    // ========================================
    // SECURE DOWNLOAD
    // ========================================

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

        let product = await getBeat(env, data.beatId);

        // Preserve legacy download links for the three original beats.
        if (!product && LEGACY_BEATS[data.beatId]) {
          product = {
            id: data.beatId,
            title: LEGACY_BEATS[data.beatId].title,
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
            "Product file not found in storage. Please contact support.",
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

    // Serve existing site assets.
    return env.ASSETS.fetch(request);
  }
};
