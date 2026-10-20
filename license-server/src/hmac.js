// Verify the Lemon Squeezy webhook signature.
//
// Lemon Squeezy signs each webhook with an HMAC-SHA256 of the raw request body,
// hex-encoded, in the `X-Signature` header. Secret is the webhook Signing
// secret shown in the LS dashboard. Compare in constant time.

export async function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  let key;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    return false;
  }
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, signatureHeader.toLowerCase());
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
