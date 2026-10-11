import mongoose from "mongoose";
import {
  BATCH_MODES,
  BATCH_STATUSES,
  BATCH_TYPES,
  SECTORS,
  SLA_BREACH_KEYS,
} from "../modules/batches/batch-transitions.js";

/**
 * batches. docs/SCHEMA.md §3.8. NCVET:FR §F.
 * Status changes go through the transition table and compare-and-set on
 * status + statusVersion. Do not update status anywhere else.
 */

const lateActionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, enum: SLA_BREACH_KEYS },
    reason: { type: String, required: true, maxlength: 2000 },
    byUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const slaSchema = new mongoose.Schema(
  {
    acceptDueAt: { type: Date, required: true },
    assignDueAt: { type: Date, default: null },
    resultDueAt: { type: Date, default: null },
    breached: { type: [{ type: String, enum: SLA_BREACH_KEYS }], default: [] },
    lateActions: { type: [lateActionSchema], default: [] },
  },
  { _id: false },
);

const ratioOverrideSchema = new mongoose.Schema(
  {
    byUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, maxlength: 2000 },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const batchSchema = new mongoose.Schema(
  {
    abId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "AwardingBody" },
    qualificationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Qualification",
    },
    type: { type: String, required: true, enum: BATCH_TYPES },
    mode: { type: String, required: true, enum: BATCH_MODES },
    assessmentStartDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    assessmentEndDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    tpId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "TrainingPartner" },
    centreId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Centre" },
    candidateCount: { type: Number, required: true, min: 1 },
    sector: { type: String, required: true, enum: SECTORS },
    status: { type: String, required: true, enum: BATCH_STATUSES },
    statusVersion: { type: Number, required: true, min: 1 },
    assessorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    proctorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    rejectReason: { type: String, default: null, maxlength: 2000 },
    cancelReason: { type: String, default: null, maxlength: 2000 },
    sla: { type: slaSchema, required: true },
    ratioOverride: { type: ratioOverrideSchema, default: null },
    resultId: { type: mongoose.Schema.Types.ObjectId, default: null },
    isReassessment: { type: Boolean, required: true, default: false },
    reassessmentOf: { type: mongoose.Schema.Types.ObjectId },
    firstAssessmentBatchId: { type: mongoose.Schema.Types.ObjectId, default: null },
    accommodations: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    allocatedAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    assignedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

batchSchema.index({ status: 1, assessmentStartDate: 1 });
batchSchema.index({ assessorId: 1, assessmentStartDate: 1, assessmentEndDate: 1 });
batchSchema.index({ tpId: 1 });
batchSchema.index({ abId: 1 });
batchSchema.index({ reassessmentOf: 1 }, { sparse: true });
batchSchema.index({ firstAssessmentBatchId: 1 });

export const Batch = mongoose.model("Batch", batchSchema, "batches");
