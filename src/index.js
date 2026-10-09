const BEAT_FILES = {
  "sun fire": {
    title: "SUN FIRE",
    price: 50,
    candidates: [
      "beats/SUN FIRE.zip",
      "SUN FIRE.zip"
    ]
  },

  "phenomenal": {
    title: "PHENOMENAL",
    price: 50,
    candidates: [
      "beats/PHENOMENAL.zip",
      "PHENOMENAL.zip"
    ]
  },

  "serenade": {
  title: "SERENADE",
  price: 50,
  candidates: [
    "beats/SERENADE.zip",
    "SERENADE.zip"
    ]
  }
};

const CALLBACK_URL =
  "https://wagwanspark-beat-store.taiyeowoyemi.workers.dev/success.html";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
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
    new TextEncoder().encode(
      JSON.stringify(data)
    )
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

  const expectedSignature =
    await createSignature(
      payload,
      secret
    );

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const data = JSON.parse(
      new TextDecoder().decode(
        base64urlDecode(payload)
      )
    );

    if (!data.exp || Date.now() > data.exp) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==============================
    // CREATE PAYMENT
    // ==============================

    if (
      url.pathname === "/api/create-payment" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const email = data.email;
        const beatId = data.beatId;

        if (!email || !beatId) {
          return json(
            {
              error: "Missing payment information"
            },
            400
          );
        }

        const beat = BEAT_FILES[beatId];

        if (!beat) {
          return json(
            {
              error: "Beat not found"
            },
            404
          );
        }

        const paystackResponse = await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${env.PAYSTACK_SECRET_KEY}`,
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              email: email,
              amount: beat.price * 100,
              currency: "NGN",

              callback_url: CALLBACK_URL,

              metadata: {
                beatId: beatId,
                beatTitle: beat.title
              }
            })
          }
        );

        const result =
          await paystackResponse.json();

        return json(
          result,
          paystackResponse.status
        );

      } catch (error) {
        console.error(
          "Payment initialization error:",
          error
        );

        return json(
          {
            error:
              "Payment initialization failed"
          },
          500
        );
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
        const reference =
          url.searchParams.get("reference");

        if (!reference) {
          return json(
            {
              success: false,
              error:
                "Payment reference missing"
            },
            400
          );
        }

        const paystackResponse = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          {
            method: "GET",
            headers: {
              Authorization:
                `Bearer ${env.PAYSTACK_SECRET_KEY}`
            }
          }
        );

        const result =
          await paystackResponse.json();

        if (
          !paystackResponse.ok ||
          !result.status ||
          !result.data
        ) {
          return json(
            {
              success: false,
              error:
                "Unable to verify payment"
            },
            400
          );
        }

        const transaction =
          result.data;

        if (
          transaction.status !== "success"
        ) {
          return json(
            {
              success: false,
              error:
                "Payment was not successful"
            },
            400
          );
        }

        const metadata =
          transaction.metadata || {};

        const beatId =
          metadata.beatId;

        const beat =
          BEAT_FILES[beatId];

        if (!beat) {
          return json(
            {
              success: false,
              error:
                "Purchased beat could not be identified"
            },
            400
          );
        }

        if (
          Number(transaction.amount) <
          beat.price * 100
        ) {
          return json(
            {
              success: false,
              error:
                "Payment amount is incorrect"
            },
            400
          );
        }

        const token =
          await createDownloadToken(
            {
              reference: reference,
              beatId: beatId,
              exp:
                Date.now() +
                30 * 60 * 1000
            },
            env.PAYSTACK_SECRET_KEY
          );

        const downloadUrl =
          `${url.origin}/api/download?token=${encodeURIComponent(token)}`;

        return json({
          success: true,
          beatTitle: beat.title,
          downloadUrl: downloadUrl
        });

      } catch (error) {
        console.error(
          "Payment verification error:",
          error
        );

        return json(
          {
            success: false,
            error:
              "Payment verification failed"
          },
          500
        );
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
        const token =
          url.searchParams.get("token");

        if (!token) {
          return new Response(
            "Download token missing",
            { status: 400 }
          );
        }

        const data =
          await verifyDownloadToken(
            token,
            env.PAYSTACK_SECRET_KEY
          );

        if (!data) {
          return new Response(
            "Invalid or expired download link",
            { status: 403 }
          );
        }

        const beat =
          BEAT_FILES[data.beatId];

        if (!beat) {
          return new Response(
            "Beat not found",
            { status: 404 }
          );
        }

        let object = null;

        for (const key of beat.candidates) {
          const found =
            await env.BEATS_BUCKET.get(key);

          if (found) {
            object = found;
            break;
          }
        }

        if (!object) {
          return new Response(
            "Beat file not found in R2",
            { status: 404 }
          );
        }

        const headers =
          new Headers();

        object.writeHttpMetadata(headers);

        headers.set(
          "Content-Disposition",
          `attachment; filename="${beat.title}.zip"`
        );

        headers.set(
          "Cache-Control",
          "private, no-store"
        );

        return new Response(
          object.body,
          {
            status: 200,
            headers: headers
          }
        );

      } catch (error) {
        console.error(
          "Download error:",
          error
        );

        return new Response(
          "Download failed",
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
