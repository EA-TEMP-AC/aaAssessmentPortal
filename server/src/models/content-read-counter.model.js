import mongoose from "mongoose";

/**
 * contentReadCounters. docs/SCHEMA.md §3.36. S-02.
 * One row per user per IST day: how many questions that user has read. Counts only, no content.
 */
const contentReadCounterSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    /** IST civil date, `YYYY-MM-DD`. */
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

contentReadCounterSchema.index({ userId: 1, day: 1 }, { unique: true });

export const ContentReadCounter = mongoose.model(
  "ContentReadCounter",
  contentReadCounterSchema,
  "contentReadCounters",
);
