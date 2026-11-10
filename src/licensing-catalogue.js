// ==========================================
// PUBLIC BEAT LICENCE TIERS
//
// GET /api/beat-licences
//
// The storefront needs the selectable tiers and their prices, and nothing else.
// `beat_licences.package_key` is deliberately NOT returned: the package a
// purchase grants is resolved server-side and snapshotted on the order, so the
// browser never sees — and can never ask for — a storage key.
//
// `available` reflects inventory only for the exclusive tier: a beat with an
// active reservation or a completed exclusive sale cannot be sold exclusively,
// while every other tier stays available. The same rules are enforced again at
// order creation, at payment start and at fulfilment.
// ==========================================
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

export async function handleBeatLicences(env) {
  if (!env.DB) {
    return json({ success: false, error: "Catalogue is not configured." }, 500);
  }

  const tiers = await env.DB.prepare(
    `SELECT l.beat_id, l.licence_key, c.label, l.price, c.is_exclusive
       FROM beat_licences l
       JOIN licences c ON c.licence_key = l.licence_key
       JOIN beats b ON b.id = l.beat_id
      WHERE l.enabled = 1
        AND l.price IS NOT NULL
        AND l.price > 0
        AND c.enabled = 1
        AND b.status = 'published'
      ORDER BY l.beat_id, c.sort_order`
  ).all();

  const sold = await env.DB.prepare(
    "SELECT beat_id FROM exclusive_sales"
  ).all();
  const reserved = await env.DB.prepare(
    "SELECT beat_id FROM exclusive_reservations WHERE status = 'active'"
  ).all();

  const soldBeats = new Set((sold.results || []).map(row => row.beat_id));
  const reservedBeats = new Set((reserved.results || []).map(row => row.beat_id));

  const licences = (tiers.results || []).map(row => {
    const exclusive = Number(row.is_exclusive) === 1;
    let available = true;
    let unavailableReason = null;

    if (exclusive && soldBeats.has(row.beat_id)) {
      available = false;
      unavailableReason = "sold";
    } else if (exclusive && reservedBeats.has(row.beat_id)) {
      available = false;
      unavailableReason = "reserved";
    }

    return {
      beat_id: row.beat_id,
      licence_key: row.licence_key,
      label: row.label,
      price: row.price,
      exclusive,
      available,
      unavailable_reason: unavailableReason
    };
  });

  return json({ success: true, licences });
}
