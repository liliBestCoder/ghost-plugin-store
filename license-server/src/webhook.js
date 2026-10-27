// Ghost license server -- Webhook handling.
// Supports both Mianbaoduo (mbd.pub) and Lemon Squeezy webhooks.

import { verifySignature } from "./hmac.js";
import { putLicense, deleteLicense } from "./kv.js";

const DAY = 24 * 3600 * 1000;

function tierExpiry(tier) {
  if (tier === "month") return Date.now() + 30 * DAY;
  if (tier === "quarter") return Date.now() + 90 * DAY;
  if (tier === "year") return Date.now() + 365 * DAY;
  if (tier === "perpetual") return null;
  return null;
}

// Map Mianbaoduo payment to subscription tier
function resolveMbdTier(amount, description) {
  // Amount in cents (分)
  if (amount === 1990) return "month";
  if (amount === 5990) return "quarter";
  if (amount === 17990) return "year";

  const desc = (description || "").toLowerCase();
  if (desc.includes("月") || desc.includes("month")) return "month";
  if (desc.includes("季") || desc.includes("quarter")) return "quarter";
  if (desc.includes("年") || desc.includes("year")) return "year";
  if (desc.includes("永久") || desc.includes("perpetual") || desc.includes("lifetime")) return "perpetual";

  return "month";
}

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

  // 1. Check if this is a Mianbaoduo (mbd.pub) webhook
  if (payload && (payload.type === "charge_succeeded" || payload.type === "complaint" || (payload.data && payload.data.out_trade_no))) {
    return handleMbdWebhook(payload, env, respond);
  }

  // 2. Otherwise process as Lemon Squeezy webhook
  return handleLsWebhook(raw, payload, request, env, respond);
}

async function handleMbdWebhook(payload, env, respond) {
  const event = payload.type || "";
  try {
    if (event === "charge_succeeded" || (!event && payload.data && payload.data.out_trade_no)) {
      await processMbdOrder(payload, env);
    } else if (event === "complaint") {
      await processMbdRefund(payload, env);
    }
  } catch (err) {
    console.error("Mianbaoduo webhook handler failed", err);
  }

  return respond({ ok: true, code: 0, status: "success" }, 200, env);
}

async function processMbdOrder(payload, env) {
  const data = payload.data || {};
  const orderId = String(data.out_trade_no || data.order_id || "");
  const amount = Number(data.amount || 0);
  const desc = data.description || "";
  const tier = resolveMbdTier(amount, desc);
  const plugin = env.DEFAULT_PLUGIN_ID || "com.ghostproxifier.snagbox";

  // Generate a distinct base64url/UUID license key
  const rand = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase() : Date.now().toString(36).toUpperCase();
  const licenseKey = "GHOST-" + rand;

  const rec = {
    licenseKey,
    plugin,
    tier,
    expiresAt: tierExpiry(tier),
    email: data.openid || "",
    orderId,
    amount,
    createdAt: Date.now(),
    activatedAt: null,
    device: null
  };

  // Put primary license key
  await putLicense(env.LICENSES, rec);

  // Also index by Mianbaoduo orderId so buyers can activate using either key or orderId!
  if (orderId && orderId !== licenseKey) {
    const aliasRec = { ...rec, licenseKey: orderId, aliasOf: licenseKey };
    await putLicense(env.LICENSES, aliasRec);
  }

  console.log("Mianbaoduo license issued:", plugin, tier, "order:", orderId, "key:", licenseKey);
}

async function processMbdRefund(payload, env) {
  const data = payload.data || {};
  const orderId = String(data.out_trade_no || data.order_id || "");
  if (orderId) {
    await deleteLicense(env.LICENSES, orderId);
  }
}

async function handleLsWebhook(raw, payload, request, env, respond) {
  // Isolate per store: reject a webhook that belongs to another LS store.
  const storeId =
    payload && payload.store && payload.store.attributes && payload.store.attributes.store_id;
  if (storeId !== undefined && env.STORE_ID && String(storeId) !== String(env.STORE_ID)) {
    return respond({ ok: false, error: "wrong_store" }, 403, env);
  }

  const sig = request.headers.get("X-Signature") || "";
  if (env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    const signed = await verifySignature(raw, sig, env.LEMONSQUEEZY_WEBHOOK_SECRET);
    if (!signed) return respond({ ok: false, error: "bad_signature" }, 401, env);
  }

  const event = payload && payload.meta ? payload.meta.event_name : "";
  try {
    if (event === "order_created") await processLsOrder(payload, env);
    else if (event === "refunded") await processLsRefund(payload, env);
  } catch (err) {
    console.error("LS webhook handler failed", err);
  }

  return respond({ ok: true }, 200, env);
}

async function processLsOrder(payload, env) {
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const item = attrs.first_order_item || {};
  const variantId = item.variant_id != null ? String(item.variant_id) : null;
  const variantName = item.variant_name || "";
  const resolved = resolveVariant(env, variantId, variantName);
  const licenseKey = extractLicenseKey(attrs);
  if (!resolved || !licenseKey) return;

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
  await putLicense(env.LICENSES, rec);
  console.log("LS license issued", rec.plugin, rec.tier, rec.orderId);
}

async function processLsRefund(payload, env) {
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const licenseKey = extractLicenseKey(attrs);
  if (licenseKey) await deleteLicense(env.LICENSES, licenseKey);
}
