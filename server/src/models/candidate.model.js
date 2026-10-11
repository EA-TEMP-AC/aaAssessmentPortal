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
candidateSchema.index({ batchId: 1, externalRef: 1 }, { unique: true, sparse: true });

export const Candidate = mongoose.model("Candidate", candidateSchema, "candidates");
