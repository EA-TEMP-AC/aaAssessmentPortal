/**
 * Replace secret fields with "***" before they are stored on auditLogs.
 * docs/SCHEMA.md: passwordHash and other secrets in before/after snapshots.
 * Also covers reset tokens and refresh token hashes (B-01).
 */
const SECRET_KEYS = new Set([
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "oldpassword",
  "refreshtoken",
  "tokenhash",
  "passwordresettoken",
  "passwordresettokenhash",
  "resettoken",
]);

function isSecretKey(key) {
  return SECRET_KEYS.has(String(key).replace(/[_-]/g, "").toLowerCase());
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Date) return false;
  if (Buffer.isBuffer(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (!isPlainObject(value)) return value;

  const redacted = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? "***" : redactSecrets(nested);
  }
  return redacted;
}
