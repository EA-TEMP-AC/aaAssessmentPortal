import mongoose from "mongoose";
import { RETENTION_POLICY } from "../../config/retention.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dry run only. Counts, per data class, the rows whose retention period has passed. It reads
 * and never writes: there is no delete in this module, by design (S-01, DECISIONS.md Q263).
 * Rows are reported as counts plus the oldest date. Ids are returned only when `sampleIds` > 0.
 *
 * @param {{ now?: Date, policy?: readonly object[], sampleIds?: number }} [options]
 */
export async function runRetentionDryRun({
  now = new Date(),
  policy = RETENTION_POLICY,
  sampleIds = 0,
} = {}) {
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections().toArray()).map((entry) => entry.name));

  const classes = [];
  for (const rule of policy) {
    const cutoff = new Date(now.getTime() - rule.retentionDays * DAY_MS);
    const entry = {
      dataClass: rule.dataClass,
      collection: rule.collection,
      dateField: rule.dateField,
      retentionDays: rule.retentionDays,
      containsPii: Boolean(rule.containsPii),
      cutoff: cutoff.toISOString(),
      pastRetention: 0,
      oldest: null,
    };
    if (existing.has(rule.collection)) {
      const filter = { ...(rule.filter ?? {}), [rule.dateField]: { $lt: cutoff } };
      const collection = db.collection(rule.collection);
      entry.pastRetention = await collection.countDocuments(filter);
      if (entry.pastRetention > 0) {
        const [oldest] = await collection
          .find(filter, { projection: { [rule.dateField]: 1 } })
          .sort({ [rule.dateField]: 1 })
          .limit(1)
          .toArray();
        entry.oldest = oldest?.[rule.dateField]?.toISOString?.() ?? null;
        if (sampleIds > 0) {
          const rows = await collection
            .find(filter, { projection: { _id: 1 } })
            .sort({ [rule.dateField]: 1 })
            .limit(sampleIds)
            .toArray();
          entry.sampleIds = rows.map((row) => row._id.toString());
        }
      }
    }
    classes.push(entry);
  }

  return {
    mode: "dry-run",
    generatedAt: now.toISOString(),
    deleted: 0,
    totalPastRetention: classes.reduce((sum, entry) => sum + entry.pastRetention, 0),
    classes,
  };
}
