import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const MIN_JWT_ACCESS_SECRET_LENGTH = 32;

const emptyToUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1).optional(),
  JWT_ACCESS_SECRET: z.string().min(1).optional(),
  /** bcrypt cost. Integer 4–15. Defaults to 10. Tests usually set 4. */
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  /** Dev seed only. When unset, the seed script uses its documented default. */
  SEED_PASSWORD: z.string().min(8).optional(),
  /** SMTP. Blank values are treated as unset. The password is never logged. */
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().max(65535).default(587),
  ),
  SMTP_SECURE: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  }, z.boolean().default(false)),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().email().optional()),
  /**
   * Field-level encryption (S-01). `id:base64key[,id:base64key]`, each key 32 bytes.
   * Required when NODE_ENV=production. Parsed and checked in lib/field-crypto.js.
   */
  FIELD_ENCRYPTION_KEYS: optionalString,
  /** Key id used to encrypt new values. Older ids in FIELD_ENCRYPTION_KEYS stay readable. */
  FIELD_ENCRYPTION_KEY_ID: optionalString,
  /** Base64, at least 32 bytes. Keyed hash for the lookup columns. */
  FIELD_HASH_KEY: optionalString,
  /**
   * Evidence vault storage (V-01). `local` writes to disk (development and tests), `s3` uses an
   * S3-compatible bucket. Production must name a driver. Credentials come only from here.
   */
  EVIDENCE_STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(["local", "s3"]).optional()),
  /** Directory for the local driver. Defaults to `var/evidence` under the server folder. */
  EVIDENCE_LOCAL_DIR: optionalString,
  EVIDENCE_S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  EVIDENCE_S3_REGION: optionalString,
  EVIDENCE_S3_BUCKET: optionalString,
  EVIDENCE_S3_FORCE_PATH_STYLE: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  }, z.boolean().default(false)),
  /** When both are unset the AWS SDK default credential chain is used. */
  EVIDENCE_S3_ACCESS_KEY_ID: optionalString,
  EVIDENCE_S3_SECRET_ACCESS_KEY: optionalString,
  /** Lifetime of a download link, in seconds. */
  EVIDENCE_SIGNED_URL_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(10).max(900).default(120),
  ),
  /** Attempt grace after the deadline, in seconds (E-03). Unset uses compliance.js. */
  ATTEMPT_GRACE_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(300).optional(),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/**
 * Production must supply its own access-token secret. There is no fallback.
 * @returns {string | null} error message, or null when startup may continue
 */
export function productionSecretProblem(nodeEnv, secret) {
  if (nodeEnv !== "production") return null;
  if (typeof secret !== "string" || secret.length < MIN_JWT_ACCESS_SECRET_LENGTH) {
    return "JWT_ACCESS_SECRET must be at least 32 characters when NODE_ENV=production";
  }
  return null;
}

export function assertProductionSecrets() {
  const problem = productionSecretProblem(env.NODE_ENV, env.JWT_ACCESS_SECRET);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
