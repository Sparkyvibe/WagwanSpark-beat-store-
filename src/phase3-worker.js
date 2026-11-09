// ==========================================
// PHASE 3 WORKER ENTRY
//
// Thin router over the Phase 2 worker. Licensing payment, fulfilment and
// entitlement downloads are handled here; every other request — including the
// legacy beat/product checkout, admin panel and storefront — is delegated to
// src/phase2-worker.js unchanged, exactly as Phase 2 delegated to src/index.js.
// ==========================================
import phase2Worker from "./phase2-worker.js";
import {
  handleLicensingCreatePayment,
  handleLicensingDownload,
  handleLicensingVerify,
  handleLicensingWebhook
} from "./licensing-checkout.js";

function fail(request, error) {
  console.error("Licensing route failed:", request.url, error);
  return new Response(JSON.stringify({
    success: false,
    error: "Unable to complete this request at this time."
  }), {
    status: 500,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/licensing/create-payment" && request.method === "POST") {
      try {
        return await handleLicensingCreatePayment(request, env, url);
      } catch (error) {
        return fail(request, error);
      }
    }

    if (path === "/api/licensing/download" && request.method === "GET") {
      try {
        return await handleLicensingDownload(request, env, url);
      } catch (error) {
        return fail(request, error);
      }
    }

    if (path === "/api/paystack-webhook" && request.method === "POST") {
      try {
        const outcome = await handleLicensingWebhook(request, env);
        if (outcome?.delegate) {
          return phase2Worker.fetch(outcome.delegate, env, ctx);
        }
        if (outcome) return outcome;
      } catch (error) {
        return fail(request, error);
      }
    }

    if (path === "/api/verify-payment" && request.method === "GET") {
      try {
        const response = await handleLicensingVerify(env, url);
        if (response) return response;
      } catch (error) {
        return fail(request, error);
      }
    }

    return phase2Worker.fetch(request, env, ctx);
  }
};
