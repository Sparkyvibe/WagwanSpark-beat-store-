export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==============================
    // PAYSTACK PAYMENT INITIALIZATION
    // ==============================
    if (url.pathname === "/api/create-payment" && request.method === "POST") {
      try {
        const data = await request.json();

        const email = data.email;
        const beatId = data.beatId;
        const beatTitle = data.beatTitle;
        const amount = data.amount;

        if (!email || !beatId || !beatTitle || !amount) {
          return new Response(
            JSON.stringify({
              error: "Missing payment information"
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        const paystackResponse = await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email: email,
              amount: Math.round(Number(amount) * 100),
              currency: "NGN",
              metadata: {
                beatId: beatId,
                beatTitle: beatTitle
              }
            })
          }
        );

        const result = await paystackResponse.json();

        return new Response(JSON.stringify(result), {
          status: paystackResponse.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });

      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Payment initialization failed"
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    // ==============================
    // SERVE WEBSITE
    // ==============================
    return env.ASSETS.fetch(request);
  }
};
