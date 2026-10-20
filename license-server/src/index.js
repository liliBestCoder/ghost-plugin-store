// Ghost license server -- a tiny Cloudflare Worker in plain JavaScript.
//
// Two jobs:
//   (a) receive Lemon Squeezy webhooks (order_created / refunded), record a
//       fixed-term authorization per license key in KV;
//   (b) expose POST /api/verify that the Ghost desktop client calls with a
//       license key (+ optional plugin id) to activate a paid plugin.
//
// No framework, no dependencies. Runs on the Workers runtime (Web Crypto,
// KV bindings, global fetch).

import { handleWebhook } from "./webhook.js";
import { handleVerify } from "./verify.js";

function respond(body, status, env) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  const origin = env && env.ALLOWED_ORIGIN;
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Signature";
  }
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return respond({}, 204, env);

    if (url.pathname === "/health" && request.method === "GET") {
      return respond({ ok: true }, 200, env);
    }

    if (url.pathname === "/api/webhook") {
      return handleWebhook(request, env, respond);
    }

    if (url.pathname === "/api/verify") {
      return handleVerify(request, env, respond);
    }

    return respond({ error: "not_found" }, 404, env);
  }
};
