import mongoose from "mongoose";

/**
 * equipmentChecklists. docs/SCHEMA.md §3.13. NCVET:FR §E.
 * One row per submission (`clientEventId`). Item keys come from the client;
 * the Q File key list is open question 14.
 */
const checklistItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 100 },
    label: { type: String, maxlength: 200 },
    available: { type: Boolean, required: true },
    note: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const equipmentChecklistSchema = new mongoose.Schema(
  {
    clientEventId: { type: String, required: true, maxlength: 200 },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    /** assessors id (users.linkedProfileId) and the user who sent it. */
    assessorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Assessor" },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    items: { type: [checklistItemSchema], required: true },
    /** True when this submission asked for in_progress → assessment_completed. */
    completeAssessment: { type: Boolean, required: true, default: false },
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    /** SHA-256 of the accepted request. A replay must match it. Never returned. */
    payloadHash: { type: String, required: true },
  },
  { timestamps: true },
);

equipmentChecklistSchema.index({ clientEventId: 1 }, { unique: true });
equipmentChecklistSchema.index({ batchId: 1, capturedAt: -1 });

export const EquipmentChecklist = mongoose.model(
  "EquipmentChecklist",
  equipmentChecklistSchema,
  "equipmentChecklists",
);
