import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { ENCRYPTED_MODELS } from "../lib/encrypted-fields.plugin.js";
import {
  assertFieldEncryptionConfig,
  currentKeyId,
  decryptValue,
  encryptValue,
  FieldCryptoError,
  hashValue,
  keyIdOf,
  looksEncrypted,
} from "../lib/field-crypto.js";
// Importing the models registers them with ENCRYPTED_MODELS.
import "../models/assessor.model.js";
import "../models/learner.model.js";
import "../models/proctor.model.js";
import "../models/user.model.js";

/**
 * Encrypts personal fields that are still stored in plain text, fills the lookup hash columns,
 * re-encrypts values written under an older key id, and swaps the old unique indexes for the hash
 * indexes. Safe to run again: a second run finds nothing to change.
 *
 *   npm run migrate:encrypt -- --dry-run     report only, writes nothing
 *   npm run migrate:encrypt                  apply
 *
 * It reads and writes the raw collections, so the plugin hooks do not interfere. Output holds
 * counts and ids, never field values. Stop writers or run in a maintenance window: a document
 * changed between the read and the write is skipped (the write is conditional) and counted as
 * `conflicts`; run again to pick it up.
 */
const BATCH_SIZE = 500;

function emptyStats() {
  return {
    scanned: 0,
    encrypted: 0,
    rotated: 0,
    hashed: 0,
    unchanged: 0,
    conflicts: 0,
    errors: [],
  };
}

async function migrateCollection(name, { entries }, { dryRun }) {
  const stats = emptyStats();
  const collection = mongoose.connection.collection(name);
  const keyId = currentKeyId();
  const cursor = collection.find({});
  let ops = [];

  async function flush() {
    if (ops.length === 0) return;
    const result = await collection.bulkWrite(ops, { ordered: false });
    stats.conflicts += ops.length - result.modifiedCount;
    ops = [];
  }

  for await (const doc of cursor) {
    stats.scanned += 1;
    const $set = {};
    const filter = { _id: doc._id };
    let encrypted = false;
    let rotated = false;
    let hashed = false;
    let failed = false;

    for (const entry of entries) {
      const stored = doc[entry.path];
      if (typeof stored !== "string" || stored === "") continue;

      let plain = stored;
      let needsWrite = true;
      if (looksEncrypted(stored)) {
        try {
          plain = decryptValue(stored, entry.label);
        } catch (err) {
          if (!(err instanceof FieldCryptoError)) throw err;
          stats.errors.push({ id: doc._id.toString(), path: entry.path, code: err.code });
          failed = true;
          break;
        }
        needsWrite = keyIdOf(stored) !== keyId;
        if (needsWrite) rotated = true;
      } else {
        encrypted = true;
      }

      const normalized = entry.normalize(plain);
      if (needsWrite) {
        $set[entry.path] = encryptValue(normalized, entry.label);
        filter[entry.path] = stored;
      }
      if (entry.hashPath) {
        const hash = hashValue(normalized, entry.hashLabel);
        if (doc[entry.hashPath] !== hash) {
          $set[entry.hashPath] = hash;
          hashed = true;
          if (!(entry.path in filter)) filter[entry.path] = stored;
        }
      }
    }

    if (failed) continue;
    if (Object.keys($set).length === 0) {
      stats.unchanged += 1;
      continue;
    }
    if (encrypted) stats.encrypted += 1;
    if (rotated) stats.rotated += 1;
    if (hashed) stats.hashed += 1;
    if (dryRun) continue;
    ops.push({ updateOne: { filter, update: { $set } } });
    if (ops.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return stats;
}

/** Drops the old unique index on the plain path (for example `email_1`). Skips missing ones. */
async function swapIndexes(name, { entries }) {
  const collection = mongoose.connection.collection(name);
  const dropped = [];
  let existing = [];
  try {
    existing = await collection.indexes();
  } catch (err) {
    if (err?.codeName !== "NamespaceNotFound") throw err;
  }
  for (const entry of entries) {
    if (!entry.hashPath) continue;
    for (const index of existing) {
      const keys = Object.keys(index.key);
      if (keys.length === 1 && keys[0] === entry.path) {
        await collection.dropIndex(index.name);
        dropped.push(index.name);
      }
    }
  }
  const model = Object.values(mongoose.models).find(
    (candidate) => candidate.collection.name === name,
  );
  await model.createIndexes();
  return dropped;
}

/**
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<Record<string, object>>} stats per collection
 */
export async function migrateEncryption({ dryRun = false } = {}) {
  assertFieldEncryptionConfig();
  const report = {};
  for (const [name, config] of ENCRYPTED_MODELS) {
    const stats = await migrateCollection(name, config, { dryRun });
    const clean = stats.errors.length === 0;
    stats.indexesDropped = !dryRun && clean ? await swapIndexes(name, config) : [];
    report[name] = stats;
  }
  return report;
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main() {
  if (!env.MONGO_URI) {
    console.error("MONGO_URI is not set");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(env.MONGO_URI);
  try {
    const report = await migrateEncryption({ dryRun });
    console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", report }, null, 2));
    const failed = Object.values(report).some((stats) => stats.errors.length > 0);
    if (failed) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error("encryption migration failed", err?.name ?? "Error", err?.code ?? "");
    process.exit(1);
  });
}
