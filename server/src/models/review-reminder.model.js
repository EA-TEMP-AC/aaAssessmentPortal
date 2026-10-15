import mongoose from "mongoose";

/**
 * reviewReminders. docs/SCHEMA.md §3.35. Task Q-04.
 * One row per reminder queued for a qualification, awarding body and period. The unique
 * index is what stops the nightly job queuing the same reminder twice. No question text.
 */
const reviewReminderSchema = new mongoose.Schema(
  {
    qualificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    abId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // IST date the period is counted from, and which period since then (1 = first interval).
    anchorDate: { type: String, required: true },
    periodNo: { type: Number, required: true, min: 1 },
    dueQuestionCount: { type: Number, required: true, min: 0 },
    emailId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

reviewReminderSchema.index(
  { qualificationId: 1, abId: 1, anchorDate: 1, periodNo: 1 },
  { unique: true },
);

export const ReviewReminder = mongoose.model(
  "ReviewReminder",
  reviewReminderSchema,
  "reviewReminders",
);
