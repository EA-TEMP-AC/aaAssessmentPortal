import mongoose from "mongoose";
import { RESULT_STATUSES } from "./result.model.js";

/**
 * resultChangeLogs. docs/SCHEMA.md §3.15. Append-only: no update or delete.
 * One row per result write. `changes` holds the rows that differ, before and after.
 */
export const RESULT_CHANGE_ACTIONS = Object.freeze(["save", "submit", "validate", "publish"]);

const changeSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, required: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const resultChangeLogSchema = new mongoose.Schema(
  {
    resultId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Result" },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    action: { type: String, required: true, enum: RESULT_CHANGE_ACTIONS },
    fromStatus: { type: String, enum: [...RESULT_STATUSES, null], default: null },
    toStatus: { type: String, required: true, enum: RESULT_STATUSES },
    byUserId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    byRole: { type: String, required: true },
    reason: { type: String, default: null, maxlength: 2000 },
    changes: { type: [changeSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

resultChangeLogSchema.index({ resultId: 1, createdAt: 1 });

export const ResultChangeLog = mongoose.model(
  "ResultChangeLog",
  resultChangeLogSchema,
  "resultChangeLogs",
);
