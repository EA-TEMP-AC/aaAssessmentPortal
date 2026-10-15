import mongoose from "mongoose";

/**
 * Question model. docs/SCHEMA.md §3.19. NCVET:TR s4-s5, s13-s17.
 * Versioned content. Updates create a new version; old versions are kept (isLatest: false).
 * Soft-delete only (status: "retired"); hard deletion is prohibited.
 */

export const QUESTION_TYPES = Object.freeze([
  "mcq",
  "short_answer",
  "scenario",
  "viva",
  "practical",
]);

export const QUESTION_STATUSES = Object.freeze(["draft", "in_review", "approved", "retired"]);

export const QUESTION_DIFFICULTIES = Object.freeze(["easy", "medium", "tough"]);

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 16 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { _id: false },
);

const questionSchema = new mongoose.Schema(
  {
    qualificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Qualification",
      required: true,
      index: true,
    },
    nosId: { type: String, required: true, trim: true, maxlength: 64 },
    pcId: { type: String, required: true, trim: true, maxlength: 64 },
    type: { type: String, required: true, enum: QUESTION_TYPES },
    language: { type: String, required: true, trim: true, maxlength: 32 },
    difficulty: { type: String, enum: QUESTION_DIFFICULTIES, default: null },
    bloomLevel: { type: String, trim: true, maxlength: 64, default: null },
    stem: { type: String, required: true, trim: true, maxlength: 10000 },
    options: { type: [optionSchema], default: [] },
    correctAnswer: { type: String, trim: true, default: null },
    marks: { type: Number, required: true, min: 0.5 },
    status: {
      type: String,
      required: true,
      enum: QUESTION_STATUSES,
      default: "draft",
      index: true,
    },
    version: { type: Number, required: true, default: 1 },
    rootQuestionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      default: null,
      index: true,
    },
    previousVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      default: null,
    },
    isLatest: { type: Boolean, required: true, default: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    retiredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

questionSchema.index({ qualificationId: 1, nosId: 1, pcId: 1, status: 1 });
questionSchema.index({ qualificationId: 1, status: 1 });
questionSchema.index({ rootQuestionId: 1, version: -1 });
questionSchema.index({ isLatest: 1, status: 1 });
questionSchema.index({ type: 1, language: 1 });

export const Question = mongoose.model("Question", questionSchema, "questions");
