import mongoose from "mongoose";

/**
 * contentAnomalies. docs/SCHEMA.md §3.37. S-02.
 * One row per user per IST day on which a content read was refused for being over the cap.
 * Holds the user, role and numbers only, never question text or ids.
 */
const contentAnomalySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    /** IST civil date, `YYYY-MM-DD`. */
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** Cap in force when the first refusal happened. */
    cap: { type: Number, required: true },
    /** Questions the user had already read that day at the latest refusal. */
    readCount: { type: Number, required: true },
    /** Questions the latest refused request would have returned. */
    attemptedCount: { type: Number, required: true },
    /** How many requests were refused that day. */
    refusedRequests: { type: Number, required: true, default: 1 },
    /** Route template of the latest refusal, for example `GET /api/v1/question-bank/questions`. */
    route: { type: String, required: true },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
  },
  { timestamps: false },
);

contentAnomalySchema.index({ userId: 1, day: 1 }, { unique: true });
contentAnomalySchema.index({ lastAt: -1 });

export const ContentAnomaly = mongoose.model(
  "ContentAnomaly",
  contentAnomalySchema,
  "contentAnomalies",
);
