import mongoose from "mongoose";

/**
 * reviewCycles. docs/SCHEMA.md §3.33. Task Q-04.
 * One review of a qualification's questions by an awarding body. Items hold question ids
 * and decisions only, never question text. `comment` is reviewer free text and stays
 * out of audit rows.
 */
export const REVIEW_CYCLE_STATUSES = Object.freeze(["open", "closed"]);
export const REVIEW_DECISIONS = Object.freeze(["keep", "revise", "retire"]);

const itemSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Question" },
    rootQuestionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    decision: { type: String, enum: REVIEW_DECISIONS, default: null },
    comment: { type: String, trim: true, maxlength: 2000, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    // The new draft version created by a `revise` decision.
    resultQuestionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
  },
  { _id: false },
);

const reviewCycleSchema = new mongoose.Schema(
  {
    qualificationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Qualification",
    },
    abId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "AwardingBody" },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    // IST calendar date, YYYY-MM-DD.
    dueDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, required: true, enum: REVIEW_CYCLE_STATUSES, default: "open" },
    items: { type: [itemSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    // True when closed with undecided items. Such a close does not count as a completed review.
    incomplete: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

reviewCycleSchema.index({ abId: 1, status: 1, dueDate: 1 });
reviewCycleSchema.index({ qualificationId: 1, status: 1, closedAt: -1 });
// One open cycle per qualification and awarding body.
reviewCycleSchema.index(
  { qualificationId: 1, abId: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);

export const ReviewCycle = mongoose.model("ReviewCycle", reviewCycleSchema, "reviewCycles");
