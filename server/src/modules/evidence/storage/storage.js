import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../config/env.js";
import { createLocalStorage } from "./local.driver.js";
import { createS3StorageFromConfig } from "./s3.driver.js";
export { StorageKeyExistsError, StorageNotFoundError } from "./storage-errors.js";

/**
 * Evidence storage interface (V-01). Every driver provides exactly these calls:
 *
 *   put({ key, body, size, contentType }) -> Promise<{ key }>   body is a Readable; an existing key is never overwritten
 *   get(key)                              -> Promise<{ stream, size }>   throws StorageNotFoundError when absent
 *   signedUrl(key, opts)                  -> Promise<string | null>      null when the driver has no URLs (local disk)
 *
 * There is deliberately no delete and no update: evidence is kept (DECISIONS 320).
 */
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

let current;

/** The driver chosen by EVIDENCE_STORAGE_DRIVER. Production has no default. */
export function evidenceStorageConfigProblem(nodeEnv = env.NODE_ENV, config = env) {
  const driver = config.EVIDENCE_STORAGE_DRIVER ?? (nodeEnv === "production" ? null : "local");
  if (!driver) return "EVIDENCE_STORAGE_DRIVER must be set when NODE_ENV=production";
  if (driver === "local" && nodeEnv === "production") {
    return "EVIDENCE_STORAGE_DRIVER=local is not allowed when NODE_ENV=production";
  }
  if (driver === "s3") {
    const missing = ["EVIDENCE_S3_BUCKET", "EVIDENCE_S3_REGION"].filter((name) => !config[name]);
    if (missing.length) return `${missing.join(" and ")} must be set for the s3 driver`;
    if (
      Boolean(config.EVIDENCE_S3_ACCESS_KEY_ID) !== Boolean(config.EVIDENCE_S3_SECRET_ACCESS_KEY)
    ) {
      return "EVIDENCE_S3_ACCESS_KEY_ID and EVIDENCE_S3_SECRET_ACCESS_KEY must be set together";
    }
  }
  return null;
}

export function assertEvidenceStorageConfig() {
  const problem = evidenceStorageConfigProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}

export function getEvidenceStorage() {
  if (current) return current;
  const problem = evidenceStorageConfigProblem();
  if (problem) throw new Error(problem);
  const driver = env.EVIDENCE_STORAGE_DRIVER ?? "local";
  current =
    driver === "s3"
      ? createS3StorageFromConfig(env)
      : createLocalStorage({
          dir: env.EVIDENCE_LOCAL_DIR
            ? path.resolve(env.EVIDENCE_LOCAL_DIR)
            : path.join(SERVER_ROOT, "var", "evidence"),
        });
  return current;
}

/** Tests inject a driver. Pass nothing to go back to the configured one. */
export function setEvidenceStorage(driver) {
  current = driver;
}
