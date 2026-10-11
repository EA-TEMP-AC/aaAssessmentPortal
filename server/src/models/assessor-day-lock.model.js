import mongoose from "mongoose";

/**
 * assessorDayLocks. docs/SCHEMA.md §3.9.
 * Unique assessorId + istDate. Same centre merges batchIds.
 * A different centre on an overlapping day is RULE_ASSESSOR_CLASH.
 */

const assessorDayLockSchema = new mongoose.Schema(
  {
    assessorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Assessor" },
    istDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    centreId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Centre" },
    batchIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Batch" }],
      required: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "batchIds must contain at least one batch",
      },
    },
  },
  { timestamps: true },
);

assessorDayLockSchema.index({ assessorId: 1, istDate: 1 }, { unique: true });
assessorDayLockSchema.index({ batchIds: 1 });

export const AssessorDayLock = mongoose.model(
  "AssessorDayLock",
  assessorDayLockSchema,
  "assessorDayLocks",
);
