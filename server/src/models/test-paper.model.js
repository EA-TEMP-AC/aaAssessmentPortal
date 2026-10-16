import mongoose from "mongoose";
import { QUESTION_TYPES } from "./question.model.js";

/**
 * Generated test paper. docs/SCHEMA.md §3.20. Task E-01.
 * Holds the seed, the rules and the chosen question ids and versions, never question text.
 */
export const TEST_PAPER_STATUSES = Object.freeze(["draft", "submitted", "approved"]);

const itemSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    rootQuestionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    version: { type: Number, required: true },
    nosId: { type: String, required: true },
    pcId: { type: String, required: true },
    type: { type: String, required: true, enum: QUESTION_TYPES },
    marks: { type: Number, required: true },
    // Only set when the paper was built with a weight profile (E-02). Null: unclassified.
    difficulty: { type: String },
    bloomLevel: { type: String },
  },
  { _id: false },
);

const quotaSchema = new mongoose.Schema(
  {
    nosId: { type: String, required: true },
    type: { type: String, enum: [...QUESTION_TYPES, null], default: null },
    count: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const shortageSchema = new mongoose.Schema(
  {
    nosId: { type: String, required: true },
    type: { type: String, default: null },
    requested: { type: Number, required: true },
    available: { type: Number, required: true },
  },
  { _id: false },
);

const testPaperSchema = new mongoose.Schema(
  {
    qualificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Qualification",
      required: true,
      index: true,
    },
    // B-18a: shown to candidates and reviewers. Older papers have none; readers fall back to
    // the qualification name and language.
    name: { type: String, trim: true, minlength: 1, maxlength: 80 },
    status: { type: String, required: true, enum: TEST_PAPER_STATUSES, default: "draft" },
    seed: { type: Number, required: true, min: 0, max: 4294967295 },
    rules: {
      language: { type: String, required: true },
      totalMarks: { type: Number, default: null },
      quotas: { type: [quotaSchema], default: [] },
    },
    // E-02: set only when the paper was generated with a weight profile.
    weightProfile: {
      profileId: { type: mongoose.Schema.Types.ObjectId, ref: "WeightProfile" },
      version: { type: Number },
    },
    weightMix: { type: mongoose.Schema.Types.Mixed },
    poolHash: { type: String, required: true },
    items: { type: [itemSchema], default: [] },
    totalMarks: { type: Number, required: true },
    shortages: { type: [shortageSchema], default: [] },
    durationMinutes: { type: Number, default: null, min: 1, max: 600 },
    marksTargetMet: { type: Boolean, default: true },
    complete: { type: Boolean, required: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

testPaperSchema.index({ qualificationId: 1, status: 1, createdAt: -1 });

export const TestPaper = mongoose.model("TestPaper", testPaperSchema, "testPapers");
