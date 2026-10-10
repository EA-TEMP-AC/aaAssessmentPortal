import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const MIN_JWT_ACCESS_SECRET_LENGTH = 32;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1).optional(),
  JWT_ACCESS_SECRET: z.string().min(1).optional(),
  /** bcrypt cost. Integer 4–15. Defaults to 10. Tests usually set 4. */
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  /** Dev seed only. When unset, the seed script uses its documented default. */
  SEED_PASSWORD: z.string().min(8).optional(),
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
