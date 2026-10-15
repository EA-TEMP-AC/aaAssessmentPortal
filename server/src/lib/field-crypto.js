import crypto from "node:crypto";
import { env } from "../config/env.js";

/**
 * Field-level encryption for personal data at rest. docs/SCHEMA.md §6, NCVET:TR s18 to s20.
 *
 * Stored form: `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url parts), AES-256-GCM with a
 * random 96-bit IV per value. The additional authenticated data is the field label (for example
 * `users.email`), so a ciphertext copied into another field fails to decrypt.
 *
 * Keys come from the environment, never from the database:
 *   FIELD_ENCRYPTION_KEYS    `id:base64key[,id:base64key...]`, each key 32 bytes
 *   FIELD_ENCRYPTION_KEY_ID  the id used to encrypt new values (older ids stay readable)
 *   FIELD_HASH_KEY           base64, at least 32 bytes, for the keyed lookup hash
 * Outside production, missing keys fall back to a built-in development key and a warning.
 * Production refuses to start without them (assertFieldEncryptionConfig).
 */

const PREFIX = "enc:v1:";
const STORED_PATTERN =
  /^enc:v1:([A-Za-z0-9_-]{1,32}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]*)$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const MIN_HASH_KEY_BYTES = 32;

/** Development fallback only. Never used when NODE_ENV=production. */
const DEV_KEY_ID = "dev";
const DEV_KEY = crypto.createHash("sha256").update("aa-portal-dev-field-key").digest();
const DEV_HASH_KEY = crypto.createHash("sha256").update("aa-portal-dev-hash-key").digest();

export class FieldCryptoError extends Error {
  /** @param {string} code */
  constructor(code, message) {
    super(message);
    this.name = "FieldCryptoError";
    this.code = code;
  }
}

function decodeBase64(value) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Parses the key settings. Pure, so tests can call it with their own values.
 * @returns {{ ring: Map<string, Buffer>, currentId: string, hashKey: Buffer, usingDevKeys: boolean }}
 * @throws {FieldCryptoError} CONFIG_INVALID, with no key material in the message
 */
export function parseFieldKeyConfig({ keys, currentId, hashKey, nodeEnv }) {
  const production = nodeEnv === "production";
  const hasKeys = typeof keys === "string" && keys.trim() !== "";
  const hasHashKey = typeof hashKey === "string" && hashKey.trim() !== "";

  if (!hasKeys || !hasHashKey) {
    if (production) {
      throw new FieldCryptoError(
        "CONFIG_INVALID",
        "FIELD_ENCRYPTION_KEYS, FIELD_ENCRYPTION_KEY_ID and FIELD_HASH_KEY are required when NODE_ENV=production",
      );
    }
  }

  const ring = new Map();
  let usingDevKeys = false;
  if (hasKeys) {
    for (const entry of keys.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(":");
      const id = colon === -1 ? "" : trimmed.slice(0, colon);
      const material = colon === -1 ? "" : trimmed.slice(colon + 1);
      if (!KEY_ID_PATTERN.test(id)) {
        throw new FieldCryptoError("CONFIG_INVALID", "FIELD_ENCRYPTION_KEYS has an invalid key id");
      }
      const bytes = decodeBase64(material);
      if (!bytes || bytes.length !== KEY_BYTES) {
        throw new FieldCryptoError(
          "CONFIG_INVALID",
          `FIELD_ENCRYPTION_KEYS key "${id}" must be ${KEY_BYTES} bytes, base64 encoded`,
        );
      }
      if (ring.has(id)) {
        throw new FieldCryptoError(
          "CONFIG_INVALID",
          `FIELD_ENCRYPTION_KEYS repeats key id "${id}"`,
        );
      }
      ring.set(id, bytes);
    }
  } else {
    ring.set(DEV_KEY_ID, DEV_KEY);
    usingDevKeys = true;
  }

  const wanted = typeof currentId === "string" && currentId.trim() !== "" ? currentId.trim() : null;
  let chosen = wanted;
  if (!chosen) {
    if (production || ring.size > 1) {
      throw new FieldCryptoError(
        "CONFIG_INVALID",
        "FIELD_ENCRYPTION_KEY_ID is required when more than one key is configured",
      );
    }
    chosen = [...ring.keys()][0];
  }
  if (!ring.has(chosen)) {
    throw new FieldCryptoError(
      "CONFIG_INVALID",
      `FIELD_ENCRYPTION_KEY_ID "${chosen}" is not in FIELD_ENCRYPTION_KEYS`,
    );
  }

  let hashBytes;
  if (hasHashKey) {
    hashBytes = decodeBase64(hashKey.trim());
    if (!hashBytes || hashBytes.length < MIN_HASH_KEY_BYTES) {
      throw new FieldCryptoError(
        "CONFIG_INVALID",
        `FIELD_HASH_KEY must be at least ${MIN_HASH_KEY_BYTES} bytes, base64 encoded`,
      );
    }
  } else {
    hashBytes = DEV_HASH_KEY;
    usingDevKeys = true;
  }

  return { ring, currentId: chosen, hashKey: hashBytes, usingDevKeys };
}

let active = null;
let warnedDev = false;

function config() {
  if (!active) {
    active = parseFieldKeyConfig({
      keys: env.FIELD_ENCRYPTION_KEYS,
      currentId: env.FIELD_ENCRYPTION_KEY_ID,
      hashKey: env.FIELD_HASH_KEY,
      nodeEnv: env.NODE_ENV,
    });
    if (active.usingDevKeys && env.NODE_ENV === "development" && !warnedDev) {
      warnedDev = true;
      console.warn(
        "Field encryption keys are not set; using the built-in development key. Do not use real data.",
      );
    }
  }
  return active;
}

/** Test hook: replace the key settings, or pass null to re-read the environment. */
export function configureFieldCrypto(settings) {
  active = settings ? parseFieldKeyConfig({ nodeEnv: "test", ...settings }) : null;
}

/** Startup check. Throws FieldCryptoError when the settings are missing (production) or malformed. */
export function assertFieldEncryptionConfig() {
  return config().currentId;
}

export function currentKeyId() {
  return config().currentId;
}

/** True when the string has the stored shape. It does not prove the value decrypts. */
export function looksEncrypted(value) {
  return typeof value === "string" && STORED_PATTERN.test(value);
}

export function keyIdOf(value) {
  const match = typeof value === "string" ? STORED_PATTERN.exec(value) : null;
  return match ? match[1] : null;
}

/** @param {string} plain @param {string} label */
export function encryptValue(plain, label) {
  const { ring, currentId } = config();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", ring.get(currentId), iv);
  cipher.setAAD(Buffer.from(label, "utf8"));
  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${currentId}:${iv.toString("base64url")}:${tag.toString("base64url")}:${body.toString("base64url")}`;
}

/**
 * @param {string} stored
 * @param {string} label
 * @throws {FieldCryptoError} NOT_ENCRYPTED, UNKNOWN_KEY or DECRYPT_FAILED. Messages carry no data.
 */
export function decryptValue(stored, label) {
  const match = typeof stored === "string" ? STORED_PATTERN.exec(stored) : null;
  if (!match) throw new FieldCryptoError("NOT_ENCRYPTED", "Value is not in the encrypted format");
  const [, keyId, iv, tag, body] = match;
  const key = config().ring.get(keyId);
  if (!key) throw new FieldCryptoError("UNKNOWN_KEY", `No key configured for key id "${keyId}"`);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(label, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new FieldCryptoError("DECRYPT_FAILED", "Value failed authentication");
  }
}

/**
 * Deterministic keyed hash for equality lookups and unique indexes. HMAC-SHA256 under
 * FIELD_HASH_KEY, domain-separated by label so the same address in two collections does not
 * produce the same hash. The caller normalises the value first.
 */
export function hashValue(normalized, label) {
  return crypto
    .createHmac("sha256", config().hashKey)
    .update(`${label}\0${normalized}`, "utf8")
    .digest("hex");
}
