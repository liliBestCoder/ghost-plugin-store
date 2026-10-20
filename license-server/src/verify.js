// POST /api/verify -- the contract the Ghost desktop client calls to activate
// a paid plugin with the license key Lemon Squeezy emailed to the buyer.

import { getLicense, putLicense } from "./kv.js";

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 40; // requests per IP per window

// A tiny KV-window rate limit so a leaked list of keys can't be brute-forced.
async function allowRate(env, ip) {
  if (!ip) return true;
  const key = "rl:" + ip;
  const now = Date.now();
  const cur = await env.LICENSES.get(key, "json");
  if (cur && now - cur.at < RATE_WINDOW_MS && cur.n >= RATE_MAX) return false;
  await env.LICENSES.put(key, JSON.stringify({ at: now, n: (cur ? cur.n : 0) + 1 }), { expirationTtl: 60 });
  return true;
}

export async function handleVerify(request, env, respond) {
  if (request.method !== "POST") return respond({ error: "method_not_allowed" }, 405, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "bad_json" }, 400, env);
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < 8 || key.length > 256) return respond({ valid: false, reason: "bad_key" }, 400, env);
  const plugin = typeof body.plugin === "string" ? body.plugin.slice(0, 64) : "";

  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!(await allowRate(env, ip))) return respond({ valid: false, reason: "rate_limited" }, 429, env);

  const rec = await getLicense(env.LICENSES, key);
  if (!rec) return respond({ valid: false, reason: "not_found" }, 200, env);

  if (typeof rec.expiresAt === "number" && rec.expiresAt > 0 && Date.now() > rec.expiresAt) {
    return respond({ valid: false, reason: "expired", plugin: rec.plugin, tier: rec.tier }, 200, env);
  }
  if (plugin && rec.plugin !== plugin) {
    return respond({ valid: false, reason: "wrong_plugin" }, 200, env);
  }

  if (!rec.activatedAt) {
    rec.activatedAt = Date.now();
    if (typeof body.device === "string" && body.device.length <= 128) rec.device = body.device;
    await putLicense(env.LICENSES, rec);
  }

  return respond(
    {
      valid: true,
      plugin: rec.plugin,
      tier: rec.tier,
      expiresAt: rec.expiresAt // null = perpetual
    },
    200,
    env
  );
}
