import mongoose from "mongoose";

/**
 * candidates. docs/SCHEMA.md §3.10.
 * Batch roster row. Soft-delete only (`active: false`). No Aadhaar.
 */
const candidateSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    learnerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Learner" },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    externalRef: { type: String, trim: true, maxlength: 64 },
    accommodations: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    active: { type: Boolean, required: true, default: true },
    sourceOriginalCandidateId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

candidateSchema.index({ batchId: 1 });
candidateSchema.index({ learnerId: 1 });
candidateSchema.index({ batchId: 1, learnerId: 1 }, { unique: true });
// Partial, not sparse: a sparse compound index still keys a row that has batchId
// but no externalRef, so two such rows on one batch collide.
const EXTERNAL_REF_INDEX_KEY = { batchId: 1, externalRef: 1 };
const EXTERNAL_REF_INDEX_FILTER = { externalRef: { $type: "string" } };
candidateSchema.index(EXTERNAL_REF_INDEX_KEY, {
  unique: true,
  partialFilterExpression: EXTERNAL_REF_INDEX_FILTER,
});

export const Candidate = mongoose.model("Candidate", candidateSchema, "candidates");

function sameKey(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Replaces the pre-B-07c sparse `{ batchId, externalRef }` index with the partial
 * one. Mongo will not change index options in place, so the old index is dropped
 * first. Safe to run on every start.
 * @returns {Promise<boolean>} true when an old index was dropped
 */
export async function ensureCandidateIndexes() {
  // Let the automatic build settle first; it fails while the old index exists.
  await Candidate.init().catch(() => {});
  await Candidate.createCollection();

  let dropped = false;
  const existing = await Candidate.collection.indexes();
  for (const index of existing) {
    if (!sameKey(index.key, EXTERNAL_REF_INDEX_KEY)) continue;
    if (sameKey(index.partialFilterExpression, EXTERNAL_REF_INDEX_FILTER)) continue;
    await Candidate.collection.dropIndex(index.name);
    dropped = true;
  }
  await Candidate.createIndexes();
  return dropped;
}
