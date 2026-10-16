import mongoose from "mongoose";

/**
 * proctoringSessions. docs/SCHEMA.md §3.40. Tasks P-01, P-04, P-08.
 * One session per attempt. The shown status (`active`, `feed_lost`, `ended`) is computed from the
 * attempt and `lastSeenAt`; it is not stored. Warnings are kept on the session.
 * `invalidationRecommended*` only marks the session: it never changes the attempt or the result.
 */
export const PROCTORING_SESSION_STATUSES = Object.freeze(["active", "feed_lost", "ended"]);

const flagCountsSchema = new mongoose.Schema(
  {
    low: { type: Number, default: 0, min: 0 },
    medium: { type: Number, default: 0, min: 0 },
    high: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const warningSchema = new mongoose.Schema({
  flagId: { type: mongoose.Schema.Types.ObjectId, required: true },
  message: { type: String, required: true, maxlength: 300 },
  createdAt: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
});

const proctoringSessionSchema = new mongoose.Schema(
  {
    attemptId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Attempt" },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    abId: { type: mongoose.Schema.Types.ObjectId, required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Candidate" },
    learnerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    lastSeenAt: { type: Date, default: null },
    /** B-20: the batch's snapshot interval when the session began. Missing means compliance.js. */
    snapshotIntervalSeconds: { type: Number, min: 1 },
    /** B-20: flags counted by the batch's flag policy since the start or the last unlock. */
    policyFlagCount: { type: Number, default: 0, min: 0 },
    flagCounts: { type: flagCountsSchema, default: () => ({}) },
    warnings: { type: [warningSchema], default: [] },
    invalidationRecommendedAt: { type: Date, default: null },
    invalidationRecommendedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    invalidationRecommendedFlagId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

proctoringSessionSchema.index({ attemptId: 1 }, { unique: true });
proctoringSessionSchema.index({ batchId: 1, createdAt: -1 });
proctoringSessionSchema.index({ abId: 1, createdAt: -1 });
proctoringSessionSchema.index({ userId: 1 });

export const ProctoringSession = mongoose.model(
  "ProctoringSession",
  proctoringSessionSchema,
  "proctoringSessions",
);
