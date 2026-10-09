const BEAT_FILES = {
  "sun-fire": {
    title: "SUN FIRE",
    price: 15000,
    candidates: [
      "beats/SUN FIRE.zip",
      "SUN FIRE.zip"
    ]
  },
  "phenomenal": {
    title: "PHENOMENAL",
    price: 15000,
    candidates: [
      "beats/PHENOMENAL.zip",
      "PHENOMENAL.zip"
    ]
  },
  "serenade": {
    title: "SERENADE",
    price: 15000,
    candidates: [
      "beats/SERENADE.zip",
      "SERENADE.zip"
    ]
  }
};
const CALLBACK_URL =
  "https://wagwanspark-beat-store.taiyeowoyemi.workers.dev/success.html";
const DOWNLOAD_TOKEN_LIFETIME = 30 * 60 * 1000;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    }
  });
}
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function base64urlDecode(value) {
  value = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  while (value.length % 4) {
    value += "=";
  }
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
    {
      name: "HMAC",
      hash: "SHA-256"
    },
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
async function createDownloadToken(data, secret) {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify(data))
  );
  const signature = await createSignature(
    payload,
    secret
  );
  return `${payload}.${signature}`;
}
async function verifyDownloadToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, signature] = parts;
  try {
    const expectedSignature = await createSignature(
      payload,
      secret
    );
    if (
      typeof signature !== "string" ||
      signature.length !== expectedSignature.length
    ) {
      return null;
    }
    let difference = 0;
    for (let i = 0; i < signature.length; i++) {
      difference |=
        signature.charCodeAt(i) ^
        expectedSignature.charCodeAt(i);
    }
    if (difference !== 0) {
      return null;
    }
    const data = JSON.parse(
      new TextDecoder().decode(
        base64urlDecode(payload)
      )
    );
    if (
      !data.exp ||
      Date.now() > data.exp ||
      typeof data.beatId !== "string" ||
      typeof data.reference !== "string"
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
/*
Accepts:
{ email, beatIds: ["sun-fire", "phenomenal"] }
Also supports the previous single-beat format:
{ email, beatId: "sun-fire" }
Prices always come from BEAT_FILES.
Client-supplied totals are never trusted.
*/
function getRequestedBeats(data) {
  let beatIds;
  if (Array.isArray(data.beatIds)) {
    beatIds = data.beatIds;
  } else if (typeof data.beatId === "string") {
    beatIds = [data.beatId];
  } else {
    return {
      error: "Please select at least one beat."
    };
  }
  if (
    beatIds.length === 0 ||
    beatIds.length > Object.keys(BEAT_FILES).length
  ) {
    return {
      error: "Invalid number of selected beats."
    };
  }
  if (
    beatIds.some(
      id => typeof id !== "string" || !BEAT_FILES[id]
    )
  ) {
    return {
      error: "One or more selected beats could not be found."
    };
  }
  if (new Set(beatIds).size !== beatIds.length) {
    return {
      error: "Duplicate beats are not allowed."
    };
  }
  const beats = beatIds.map(id => ({
    id,
    ...BEAT_FILES[id]
  }));
  const total = beats.reduce(
    (sum, beat) => sum + beat.price,
    0
  );
  return {
    beats,
    total
  };
}
/*
Supports Paystack metadata for multiple beats and
legacy metadata for a single beat.
*/
function getPurchasedBeatIds(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  if (Array.isArray(metadata.beatIds)) {
    return metadata.beatIds;
  }
  if (typeof metadata.beatIds === "string") {
    try {
      const parsed = JSON.parse(metadata.beatIds);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall back to the legacy single-beat field.
    }
  }
  if (typeof metadata.beatId === "string") {
    return [metadata.beatId];
  }
  return null;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // ==============================
    // CORS PREFLIGHT
    // ==============================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    // ==============================
    // CREATE PAYMENT
    // ==============================
    if (
      url.pathname === "/api/create-payment" &&
      request.method === "POST"
    ) {
      try {
        if (!env.PAYSTACK_SECRET_KEY) {
          console.error("PAYSTACK_SECRET_KEY is not configured.");
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
        const email =
          typeof data.email === "string"
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
        const selection = getRequestedBeats(data);
        if (selection.error) {
          return json({
            status: false,
            error: selection.error
          }, 400);
        }
        const { beats, total } = selection;
        const beatIds = beats.map(beat => beat.id);
        const beatTitles = beats.map(beat => beat.title);
        const paystackResponse = await fetch(
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
                ...(beats.length === 1
                  ? {
                      beatId: beats[0].id,
                      beatTitle: beats[0].title
                    }
                  : {})
              }
            })
          }
        );
        let result;
        try {
          result = await paystackResponse.json();
        } catch {
          console.error("Paystack returned an unreadable response.");
          return json({
            status: false,
            error: "Unable to initialize payment. Please try again."
          }, 502);
        }
        if (
          !paystackResponse.ok ||
          !result.status ||
          !result.data ||
          !result.data.authorization_url ||
          !result.data.reference
        ) {
          console.error(
            "Paystack initialization failed:",
            result.message || result
          );
          return json({
            status: false,
            error: result.message ||
              "Unable to initialize payment. Please try again."
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
    // ==============================
    // VERIFY PAYMENT
    // ==============================
    if (
      url.pathname === "/api/verify-payment" &&
      request.method === "GET"
    ) {
      try {
        if (!env.PAYSTACK_SECRET_KEY) {
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
        const paystackResponse = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
            }
          }
        );
        let result;
        try {
          result = await paystackResponse.json();
        } catch {
          return json({
            success: false,
            error: "Unable to read payment verification response."
          }, 502);
        }
        if (
          !paystackResponse.ok ||
          !result.status ||
          !result.data
        ) {
          return json({
            success: false,
            error: "Unable to verify payment."
          }, 400);
        }
        const transaction = result.data;
        if (transaction.status !== "success") {
          return json({
            success: false,
            error: "Payment was not successful."
          }, 400);
        }
        if (
          transaction.currency &&
          transaction.currency !== "NGN"
        ) {
          return json({
            success: false,
            error: "Payment currency is incorrect."
          }, 400);
        }
        const metadata = transaction.metadata || {};
        const beatIds = getPurchasedBeatIds(metadata);
        if (
          !Array.isArray(beatIds) ||
          beatIds.length === 0 ||
          beatIds.length > Object.keys(BEAT_FILES).length ||
          beatIds.some(
            id => typeof id !== "string" || !BEAT_FILES[id]
          ) ||
          new Set(beatIds).size !== beatIds.length
        ) {
          return json({
            success: false,
            error: "Purchased beats could not be identified."
          }, 400);
        }
        const beats = beatIds.map(id => ({
          id,
          ...BEAT_FILES[id]
        }));
        const expectedAmountKobo = beats.reduce(
          (sum, beat) => sum + beat.price * 100,
          0
        );
        if (
          !Number.isSafeInteger(Number(transaction.amount)) ||
          Number(transaction.amount) !== expectedAmountKobo
        ) {
          return json({
            success: false,
            error: "Payment amount does not match the selected beats."
          }, 400);
        }
        // Create a separate signed download link for every beat.
        const purchasedBeats = [];
        for (const beat of beats) {
          const token = await createDownloadToken(
            {
              reference,
              beatId: beat.id,
              exp: Date.now() + DOWNLOAD_TOKEN_LIFETIME
            },
            env.PAYSTACK_SECRET_KEY
          );
          const downloadUrl =
            `${url.origin}/api/download?token=${encodeURIComponent(token)}`;
          purchasedBeats.push({
            beatId: beat.id,
            beatTitle: beat.title,
            downloadUrl
          });
        }
        return json({
          success: true,
          beats: purchasedBeats,
          total: beats.reduce(
            (sum, beat) => sum + beat.price,
            0
          ),
          currency: "NGN",
          ...(purchasedBeats.length === 1
            ? {
                beatTitle: purchasedBeats[0].beatTitle,
                downloadUrl: purchasedBeats[0].downloadUrl
              }
            : {})
        });
      } catch (error) {
        console.error("Payment verification error:", error);
        return json({
          success: false,
          error: "Payment verification failed. Please try again."
        }, 500);
      }
    }
    // ==============================
    // SECURE DOWNLOAD
    // ==============================
    if (
      url.pathname === "/api/download" &&
      request.method === "GET"
    ) {
      try {
        if (!env.PAYSTACK_SECRET_KEY) {
          return new Response(
            "Download service is not configured.",
            { status: 500 }
          );
        }
        if (!env.BEATS_BUCKET) {
          return new Response(
            "Download storage is not configured.",
            { status: 500 }
          );
        }
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response(
            "Download token missing.",
            { status: 400 }
          );
        }
        const data = await verifyDownloadToken(
          token,
          env.PAYSTACK_SECRET_KEY
        );
        if (!data) {
          return new Response(
            "Invalid or expired download link.",
            { status: 403 }
          );
        }
        const beat = BEAT_FILES[data.beatId];
        if (!beat) {
          return new Response(
            "Beat not found.",
            { status: 404 }
          );
        }
        let object = null;
        for (const key of beat.candidates) {
          const found = await env.BEATS_BUCKET.get(key);
          if (found) {
            object = found;
            break;
          }
        }
        if (!object) {
          console.error(
            `R2 ZIP missing for ${beat.title}. Checked:`,
            beat.candidates
          );
          return new Response(
            "Beat file not found in storage. Please contact support.",
            { status: 404 }
          );
        }
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("Content-Type", "application/zip");
        headers.set(
          "Content-Disposition",
          `attachment; filename="${beat.title}.zip"`
        );
        headers.set("Cache-Control", "private, no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(object.body, {
          status: 200,
          headers
        });
      } catch (error) {
        console.error("Download error:", error);
        return new Response(
          "Download failed. Please try again.",
          { status: 500 }
        );
      }
    }
    // ==============================
    // SERVE WEBSITE
    // ==============================
    return env.ASSETS.fetch(request);
  }
};
