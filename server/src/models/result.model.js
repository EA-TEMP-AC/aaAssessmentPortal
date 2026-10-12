import mongoose from "mongoose";

/**
 * results. docs/SCHEMA.md §3.14. NCVET:FR §F.
 * One document per batch. `outcome` is always computed by the server
 * (modules/results/result-scoring.js); null while a draft row is missing marks.
 * `publishedAt` is the reassessment window anchor (Guidelines 4.7, SCHEMA §4.2).
 */
export const RESULT_STATUSES = Object.freeze(["draft", "submitted", "validated", "published"]);

/** CandidateOutcome. docs/SCHEMA.md §1.4. */
export const CANDIDATE_OUTCOMES = Object.freeze(["Pass", "Fail", "Absent"]);

const nosMarksSchema = new mongoose.Schema(
  {
    nosId: { type: String, required: true, trim: true, maxlength: 64 },
    theory: { type: Number, default: null, min: 0 },
    practical: { type: Number, default: null, min: 0 },
    viva: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

const resultRowSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Candidate" },
    absent: { type: Boolean, required: true, default: false },
    outcome: { type: String, enum: [...CANDIDATE_OUTCOMES, null], default: null },
    nos: { type: [nosMarksSchema], default: [] },
  },
  { _id: false },
);

const resultSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    rows: { type: [resultRowSchema], default: [] },
    status: { type: String, required: true, enum: RESULT_STATUSES, default: "draft" },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" },
    validatedAt: { type: Date, default: null },
    validatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" },
  },
  { timestamps: true },
);

resultSchema.index({ batchId: 1 }, { unique: true });

export const Result = mongoose.model("Result", resultSchema, "results");
