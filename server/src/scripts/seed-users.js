import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { hashPassword } from "../lib/password.js";
import { USER_ROLES } from "../models/roles.js";
import { User } from "../models/user.model.js";

/**
 * Dev-only default password. Not a real secret.
 * Override with SEED_PASSWORD in the environment (see server/.env.example).
 */
export const DEFAULT_SEED_PASSWORD = "Dev-Password-1";

/** One user per role. Later tasks add their own sample data; do not add it here. */
export const SEED_USERS = Object.freeze([
  { role: "aa_admin", email: "admin@aa.example", name: "AA Admin" },
  { role: "mis", email: "mis@aa.example", name: "MIS User" },
  { role: "sme", email: "sme@aa.example", name: "SME User" },
  { role: "assessor", email: "assessor@aa.example", name: "Assessor User" },
  { role: "proctor", email: "proctor@aa.example", name: "Proctor User" },
  { role: "candidate", email: "candidate@aa.example", name: "Candidate User" },
  { role: "tp", email: "tp@aa.example", name: "TP User" },
  { role: "ab_reviewer", email: "ab.reviewer@aa.example", name: "AB Reviewer" },
  { role: "ncvet_viewer", email: "ncvet.viewer@aa.example", name: "NCVET Viewer" },
]);

export async function seedRoleUsers({ password } = {}) {
  const plain = password ?? env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD;
  const roles = new Set(SEED_USERS.map((user) => user.role));
  if (roles.size !== USER_ROLES.length || USER_ROLES.some((role) => !roles.has(role))) {
    throw new Error("Seed must contain exactly one user for each role");
  }

  const passwordHash = await hashPassword(plain);
  for (const spec of SEED_USERS) {
    await User.updateOne(
      { email: spec.email },
      {
        $set: {
          email: spec.email,
          name: spec.name,
          role: spec.role,
          active: true,
          mustChangePassword: false,
          passwordHash,
        },
      },
      { upsert: true },
    );
  }

  return SEED_USERS.map((user) => user.email);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
}

async function main() {
  if (env.NODE_ENV === "production") {
    console.error("Refusing to seed users when NODE_ENV=production");
    process.exit(1);
  }
  if (!env.MONGO_URI) {
    console.error("MONGO_URI is required to seed users");
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  try {
    const emails = await seedRoleUsers();
    console.log(`Seeded ${emails.length} users (one per role)`);
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
