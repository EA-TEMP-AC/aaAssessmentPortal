import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { maskEmail, maskPersonalData } from "../lib/redact.js";

/**
 * Scrubs plain-text personal data (emails, phone numbers) from auditLogs,
 * finished emailQueue rows, and accessLogs.
 *
 *   npm run scrub:logs -- --dry-run     report only, writes nothing
 *   npm run scrub:logs                  apply
 */

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
}

export async function runScrubLogs({ dryRun = false } = {}) {
  const db = mongoose.connection.db;
  const report = {
    dryRun,
    auditLogs: { scanned: 0, scrubbed: 0 },
    emailQueue: { scanned: 0, scrubbed: 0 },
    accessLogs: { scanned: 0, scrubbed: 0 },
  };

  // 1. Scrub auditLogs
  const auditColl = db.collection("auditLogs");
  const auditCursor = auditColl.find({});
  while (await auditCursor.hasNext()) {
    const doc = await auditCursor.next();
    report.auditLogs.scanned += 1;
    let needsUpdate = false;
    const updateSet = {};

    if (doc.before !== undefined && doc.before !== null) {
      const masked = maskPersonalData(doc.before);
      if (JSON.stringify(masked) !== JSON.stringify(doc.before)) {
        updateSet.before = masked;
        needsUpdate = true;
      }
    }
    if (doc.after !== undefined && doc.after !== null) {
      const masked = maskPersonalData(doc.after);
      if (JSON.stringify(masked) !== JSON.stringify(doc.after)) {
        updateSet.after = masked;
        needsUpdate = true;
      }
    }
    if (doc.meta !== undefined && doc.meta !== null) {
      const masked = maskPersonalData(doc.meta);
      if (JSON.stringify(masked) !== JSON.stringify(doc.meta)) {
        updateSet.meta = masked;
        needsUpdate = true;
      }
    }
    if (doc.requestBody !== undefined && doc.requestBody !== null) {
      const masked = maskPersonalData(doc.requestBody);
      if (JSON.stringify(masked) !== JSON.stringify(doc.requestBody)) {
        updateSet.requestBody = masked;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      report.auditLogs.scrubbed += 1;
      if (!dryRun) {
        await auditColl.updateOne({ _id: doc._id }, { $set: updateSet });
      }
    }
  }

  // 2. Scrub emailQueue (finished jobs: sent or failed)
  const emailColl = db.collection("emailQueue");
  const emailCursor = emailColl.find({ status: { $in: ["sent", "failed"] } });
  while (await emailCursor.hasNext()) {
    const doc = await emailCursor.next();
    report.emailQueue.scanned += 1;
    let needsUpdate = false;
    const updateSet = {};
    const updateUnset = {};

    if (doc.text !== undefined && doc.text !== null) {
      updateUnset.text = "";
      needsUpdate = true;
    }

    if (Array.isArray(doc.to) && doc.to.length > 0) {
      const maskedTo = doc.to.map((addr) => maskEmail(addr));
      if (JSON.stringify(maskedTo) !== JSON.stringify(doc.to)) {
        updateSet.to = maskedTo;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      report.emailQueue.scrubbed += 1;
      if (!dryRun) {
        const updateDoc = {};
        if (Object.keys(updateSet).length > 0) updateDoc.$set = updateSet;
        if (Object.keys(updateUnset).length > 0) updateDoc.$unset = updateUnset;
        await emailColl.updateOne({ _id: doc._id }, updateDoc);
      }
    }
  }

  // 3. Scrub accessLogs
  const accessColl = db.collection("accessLogs");
  const accessCursor = accessColl.find({});
  while (await accessCursor.hasNext()) {
    const doc = await accessCursor.next();
    report.accessLogs.scanned += 1;
    let needsUpdate = false;
    const updateSet = {};

    if (typeof doc.subjectId === "string" && doc.subjectId.includes("@")) {
      const masked = maskEmail(doc.subjectId);
      if (masked !== doc.subjectId) {
        updateSet.subjectId = masked;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      report.accessLogs.scrubbed += 1;
      if (!dryRun) {
        await accessColl.updateOne({ _id: doc._id }, { $set: updateSet });
      }
    }
  }

  return {
    ...report,
    auditLogsScrubbed: report.auditLogs.scrubbed,
    emailQueueScrubbed: report.emailQueue.scrubbed,
    accessLogsScrubbed: report.accessLogs.scrubbed,
  };
}

async function main() {
  if (!env.MONGO_URI) {
    console.error("MONGO_URI is not set");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(env.MONGO_URI);
  try {
    const report = await runScrubLogs({ dryRun });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error("scrub:logs failed", err);
    process.exit(1);
  });
}
