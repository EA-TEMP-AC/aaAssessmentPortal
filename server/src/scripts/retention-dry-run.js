import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { runRetentionDryRun } from "../modules/retention/retention.service.js";

/**
 * Prints how many records are past their retention period, per data class (config/retention.js).
 * Reads only. Nothing is deleted. Usage: npm run retention:dry-run [-- --ids=5]
 */
function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main() {
  if (!env.MONGO_URI) {
    console.error("MONGO_URI is not set");
    process.exit(1);
  }
  const idsArg = process.argv.find((arg) => arg.startsWith("--ids="));
  const sampleIds = idsArg ? Math.max(0, Number.parseInt(idsArg.slice(6), 10) || 0) : 0;
  await mongoose.connect(env.MONGO_URI);
  try {
    const report = await runRetentionDryRun({ sampleIds });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error("retention dry run failed", err?.name ?? "Error");
    process.exit(1);
  });
}
