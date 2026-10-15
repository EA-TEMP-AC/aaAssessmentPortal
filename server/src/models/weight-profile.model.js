import mongoose from "mongoose";
import { QUESTION_DIFFICULTIES } from "./question.model.js";

/**
 * Versioned weight profile for test papers. docs/SCHEMA.md §3.29. Task E-02.
 * One row per version. An edit inserts a new draft version; old versions are never changed
 * except for isLatest, and an approved version is never edited.
 */
export const WEIGHT_PROFILE_STATUSES = Object.freeze(["draft", "approved"]);

/** Bloom's revised taxonomy. A question whose bloomLevel is not one of these is "unclassified". */
export const BLOOM_LEVELS = Object.freeze([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

const weights = (keys) =>
  Object.fromEntries(keys.map((k) => [k, { type: Number, required: true, min: 0, max: 100 }]));

const weightProfileSchema = new mongoose.Schema(
  {
    rootProfileId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    isLatest: { type: Boolean, required: true, default: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    qualificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Qualification", default: null },
    difficultyWeights: weights(QUESTION_DIFFICULTIES),
    bloomWeights: weights(BLOOM_LEVELS),
    status: { type: String, required: true, enum: WEIGHT_PROFILE_STATUSES, default: "draft" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

weightProfileSchema.index({ rootProfileId: 1, version: 1 }, { unique: true });
weightProfileSchema.index({ qualificationId: 1, isLatest: 1 });

export const WeightProfile = mongoose.model("WeightProfile", weightProfileSchema, "weightProfiles");
