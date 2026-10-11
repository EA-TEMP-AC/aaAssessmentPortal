import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { assertSeedAllowed, seedMasterData } from "./seed-master-data.js";
import { seedRoleUsers } from "./seed-users.js";

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
}

async function main() {
  try {
    assertSeedAllowed();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!env.MONGO_URI) {
    console.error("MONGO_URI is required to seed");
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  try {
    const emails = await seedRoleUsers();
    const master = await seedMasterData();
    console.log(`Seeded ${emails.length} users (one per role)`);
    const qualifications = master.qualificationCodes.join(", ");
    console.log(
      `Seeded master data AB ${master.abCode}, TP ${master.tpCode}, centre ${master.centreCode}`,
    );
    console.log(`Seeded qualifications ${qualifications}, learner ${master.learnerExternalRef}`);
    console.log(`Seeded assessor ${master.assessorCode}, proctor ${master.proctorCode}`);
    console.log(`Seeded sample batch ${master.batchId} with ${master.rosterSize} candidates`);
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
