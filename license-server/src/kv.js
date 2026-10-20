// KV persistence for authorizations.
//
// Key:   lic:<license key>
// Value: JSON record:
//   {
//     licenseKey, plugin, tier, expiresAt, email, orderId,
//     createdAt, activatedAt, device
//   }
// expiresAt is epoch ms, or null for a perpetual (永久买断) authorization.

const KEY_PREFIX = "lic:";
function keyFor(licenseKey) {
  return KEY_PREFIX + licenseKey;
}

async function getLicense(kv, licenseKey) {
  const raw = await kv.get(keyFor(licenseKey), "json");
  return raw || null;
}

async function putLicense(kv, rec) {
  // Let a finite-term record drop a little after it expires; a perpetual one
  // is kept without a TTL.
  let ttl;
  if (typeof rec.expiresAt === "number" && rec.expiresAt > 0) {
    const ms = rec.expiresAt - Date.now() + 24 * 3600 * 1000; // a day of grace
    ttl = Math.max(60, Math.round(ms / 1000)); // seconds
  }
  const putOpts = ttl ? { expirationTtl: ttl } : undefined;
  await kv.put(keyFor(rec.licenseKey), JSON.stringify(rec), putOpts);
}

async function deleteLicense(kv, licenseKey) {
  await kv.delete(keyFor(licenseKey));
}

export { getLicense, putLicense, deleteLicense };
