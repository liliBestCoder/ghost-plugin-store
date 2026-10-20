// Lemon Squeezy webhook handling.

import { verifySignature } from "./hmac.js";
import { putLicense, deleteLicense } from "./kv.js";

const DAY = 24 * 3600 * 1000;

// Map a paid order's variant to (plugin, tier). The owner pastes the real
// mapping into VARIANT_MAP (a JSON string secret) as { "<variant_id_or_name>":
// { "plugin": "com.example.paid", "tier": "month" } }. Empty or unmatched, falls
// back to the naming convention GHOST:<plugin-id>:<tier> so an empty mapping
// still works for variants named that way.
function resolveVariant(env, variantId, variantName) {
  let map = null;
  try {
    map = env.VARIANT_MAP ? JSON.parse(env.VARIANT_MAP) : null;
  } catch {
    map = null;
  }
  const hit = map && (variantId && map[variantId] ? map[variantId] : map[variantName]);
  if (hit) return hit;
  if (variantName && variantName.startsWith("GHOST:")) {
    const parts = variantName.split(":");
    if (parts.length === 3) return { plugin: parts[1], tier: parts[2] };
  }
  return null;
}

// Fixed-term, manual renewal: expiry is measured from the payment date. A
// "perpetual" purchase has no expiry.
function tierExpiry(tier) {
  if (tier === "month") return Date.now() + 30 * DAY;
  if (tier === "year") return Date.now() + 365 * DAY;
  if (tier === "perpetual") return null;
  return null;
}

// LS delivers the license key in data.attributes.license_key, either as a
// string or as { key: "..." }. Accept both.
function extractLicenseKey(attrs) {
  const k = attrs && (attrs.license_key || attrs.licenseKey);
  if (!k) return null;
  if (typeof k === "string") return k.trim();
  if (k && typeof k === "object" && typeof k.key === "string") return k.key.trim();
  return null;
}

export async function handleWebhook(request, env, respond) {
  const raw = await request.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return respond({ ok: false, error: "bad_json" }, 400, env);
  }

  // Isolate per store: reject a webhook that belongs to another LS store.
  const storeId =
    payload && payload.store && payload.store.attributes && payload.store.attributes.store_id;
  if (storeId !== undefined && String(storeId) !== String(env.STORE_ID)) {
    return respond({ ok: false, error: "wrong_store" }, 403, env);
  }

  const sig = request.headers.get("X-Signature") || "";
  const signed = await verifySignature(raw, sig, env.LEMONSQUEEZY_WEBHOOK_SECRET);
  if (!signed) return respond({ ok: false, error: "bad_signature" }, 401, env);

  const event = payload && payload.meta ? payload.meta.event_name : "";
  try {
    if (event === "order_created") await processOrder(payload, env);
    else if (event === "refunded") await processRefund(payload, env);
    // other events: acknowledged, nothing to do
  } catch (err) {
    console.error("webhook handler failed", err);
  }

  return respond({ ok: true }, 200, env);
}

async function processOrder(payload, env) {
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const item = attrs.first_order_item || {};
  const variantId = item.variant_id != null ? String(item.variant_id) : null;
  const variantName = item.variant_name || "";
  const resolved = resolveVariant(env, variantId, variantName);
  const licenseKey = extractLicenseKey(attrs);
  if (!resolved || !licenseKey) return; // can't attribute the order: ack, skip

  const rec = {
    licenseKey,
    plugin: resolved.plugin,
    tier: resolved.tier,
    expiresAt: tierExpiry(resolved.tier),
    email: (attrs.buyer_email || "").toLowerCase(),
    orderId: attrs.order_id != null ? String(attrs.order_id) : "",
    createdAt: Date.now(),
    activatedAt: null,
    device: null
  };
  // Same key (or a renewal's new order) just overwrites the record -- manual
  // renewal is simply a fresh fixed-term authorization.
  await putLicense(env.LICENSES, rec);
  console.log("license issued", rec.plugin, rec.tier, rec.orderId);
}

async function processRefund(payload, env) {
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const licenseKey = extractLicenseKey(attrs);
  if (licenseKey) await deleteLicense(env.LICENSES, licenseKey);
}
