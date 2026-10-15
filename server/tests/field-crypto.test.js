import crypto from "node:crypto";
import {
  assertFieldEncryptionConfig,
  configureFieldCrypto,
  currentKeyId,
  decryptValue,
  encryptValue,
  FieldCryptoError,
  hashValue,
  keyIdOf,
  looksEncrypted,
  parseFieldKeyConfig,
} from "../src/lib/field-crypto.js";

const key = () => crypto.randomBytes(32).toString("base64");
const hashKey = () => crypto.randomBytes(48).toString("base64");

afterEach(() => {
  configureFieldCrypto(null);
});

describe("field-crypto", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const stored = encryptValue("asha@example.com", "users.email");
    expect(looksEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("asha");
    expect(stored.startsWith("enc:v1:t1:")).toBe(true);
    expect(decryptValue(stored, "users.email")).toBe("asha@example.com");
  });

  it("uses a fresh IV, so equal values give different ciphertexts", () => {
    expect(encryptValue("same", "users.email")).not.toBe(encryptValue("same", "users.email"));
  });

  it("handles empty-looking and non-ASCII text", () => {
    const text = "पता: 12, नई दिल्ली";
    expect(decryptValue(encryptValue(text, "x.y"), "x.y")).toBe(text);
    expect(decryptValue(encryptValue(" ", "x.y"), "x.y")).toBe(" ");
  });

  it("rejects a tampered value", () => {
    const stored = encryptValue("secret", "users.email");
    const parts = stored.split(":");
    const body = Buffer.from(parts[5], "base64url");
    body[0] ^= 1;
    parts[5] = body.toString("base64url");
    expect(() => decryptValue(parts.join(":"), "users.email")).toThrow(FieldCryptoError);
  });

  it("binds the ciphertext to its field label", () => {
    const stored = encryptValue("9000000001", "learners.phone");
    expect(() => decryptValue(stored, "users.email")).toThrow(
      expect.objectContaining({ code: "DECRYPT_FAILED" }),
    );
  });

  it("does not put plaintext in error messages", () => {
    try {
      decryptValue(encryptValue("leak-me", "a.b"), "c.d");
    } catch (err) {
      expect(err.message).not.toContain("leak-me");
    }
  });

  it("reports values that are not in the stored format", () => {
    expect(looksEncrypted("plain@example.com")).toBe(false);
    expect(looksEncrypted(null)).toBe(false);
    expect(() => decryptValue("plain@example.com", "a.b")).toThrow(
      expect.objectContaining({ code: "NOT_ENCRYPTED" }),
    );
    expect(keyIdOf("plain")).toBeNull();
  });

  it("keeps old values readable after the key rotates", () => {
    const k1 = key();
    const k2 = key();
    const hash = hashKey();
    configureFieldCrypto({ keys: `k1:${k1}`, currentId: "k1", hashKey: hash });
    const old = encryptValue("rotate me", "users.email");
    expect(keyIdOf(old)).toBe("k1");

    configureFieldCrypto({ keys: `k1:${k1},k2:${k2}`, currentId: "k2", hashKey: hash });
    expect(currentKeyId()).toBe("k2");
    expect(decryptValue(old, "users.email")).toBe("rotate me");
    const fresh = encryptValue("rotate me", "users.email");
    expect(keyIdOf(fresh)).toBe("k2");

    configureFieldCrypto({ keys: `k2:${k2}`, currentId: "k2", hashKey: hash });
    expect(() => decryptValue(old, "users.email")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_KEY" }),
    );
    expect(decryptValue(fresh, "users.email")).toBe("rotate me");
  });

  it("hashes deterministically, per label and per key", () => {
    const a = hashValue("asha@example.com", "users.email#hash");
    expect(hashValue("asha@example.com", "users.email#hash")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashValue("asha@example.com", "assessors.email#hash")).not.toBe(a);
    expect(hashValue("other@example.com", "users.email#hash")).not.toBe(a);
    configureFieldCrypto({ keys: `t1:${key()}`, currentId: "t1", hashKey: hashKey() });
    expect(hashValue("asha@example.com", "users.email#hash")).not.toBe(a);
  });
});

describe("parseFieldKeyConfig", () => {
  const base = { nodeEnv: "production" };

  it("requires keys in production", () => {
    expect(() => parseFieldKeyConfig({ ...base })).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    expect(() => parseFieldKeyConfig({ ...base, keys: `k1:${key()}`, currentId: "k1" })).toThrow(
      /required when NODE_ENV=production/,
    );
  });

  it("accepts a complete production configuration", () => {
    const parsed = parseFieldKeyConfig({
      ...base,
      keys: `k1:${key()}`,
      currentId: "k1",
      hashKey: hashKey(),
    });
    expect(parsed.usingDevKeys).toBe(false);
    expect(parsed.currentId).toBe("k1");
  });

  it("rejects a key of the wrong length without echoing it", () => {
    const short = crypto.randomBytes(16).toString("base64");
    const attempt = () =>
      parseFieldKeyConfig({
        keys: `k1:${short}`,
        currentId: "k1",
        hashKey: hashKey(),
        nodeEnv: "test",
      });
    expect(attempt).toThrow(/32 bytes/);
    try {
      attempt();
    } catch (err) {
      expect(err.message).not.toContain(short);
    }
  });

  it("rejects a bad key id, a repeated id and a current id that is not configured", () => {
    const good = key();
    const common = { hashKey: hashKey(), nodeEnv: "test" };
    expect(() => parseFieldKeyConfig({ ...common, keys: `a:b:${good}`, currentId: "a" })).toThrow(
      /32 bytes/,
    );
    expect(() =>
      parseFieldKeyConfig({ ...common, keys: `bad id:${good}`, currentId: "x" }),
    ).toThrow(/invalid key id/);
    expect(() =>
      parseFieldKeyConfig({ ...common, keys: `k1:${good},k1:${good}`, currentId: "k1" }),
    ).toThrow(/repeats/);
    expect(() => parseFieldKeyConfig({ ...common, keys: `k1:${good}`, currentId: "k9" })).toThrow(
      /not in FIELD_ENCRYPTION_KEYS/,
    );
  });

  it("needs an explicit current id when several keys are configured", () => {
    expect(() =>
      parseFieldKeyConfig({
        keys: `k1:${key()},k2:${key()}`,
        hashKey: hashKey(),
        nodeEnv: "test",
      }),
    ).toThrow(/FIELD_ENCRYPTION_KEY_ID is required/);
  });

  it("rejects a short hash key", () => {
    expect(() =>
      parseFieldKeyConfig({
        keys: `k1:${key()}`,
        currentId: "k1",
        hashKey: crypto.randomBytes(8).toString("base64"),
        nodeEnv: "test",
      }),
    ).toThrow(/FIELD_HASH_KEY/);
  });

  it("falls back to development keys outside production only", () => {
    const parsed = parseFieldKeyConfig({ nodeEnv: "development" });
    expect(parsed.usingDevKeys).toBe(true);
    expect(parsed.ring.size).toBe(1);
  });

  it("passes the startup check with the test environment keys", () => {
    expect(assertFieldEncryptionConfig()).toBe("t1");
  });
});
