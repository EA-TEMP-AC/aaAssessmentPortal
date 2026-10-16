import mongoose from "mongoose";
import { RATIO_CLASSES, RECOGNITION_CHECKS, SECTOR_NAMES, STATE_UTS } from "../config/annexure.js";
import {
  BATCH_MODES,
  BATCH_STATUSES,
  BATCH_TYPES,
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
    assignDueAt: { type: Date, required: true },
    resultDueAt: { type: Date, required: true },
    breached: { type: [{ type: String, enum: SLA_BREACH_KEYS }], default: [] },
    lateActions: { type: [lateActionSchema], default: [] },
  },
  { _id: false },
);

const recognitionOverrideSchema = new mongoose.Schema(
  {
    byUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, maxlength: 2000 },
    at: { type: Date, required: true },
    checks: {
      type: [{ type: String, enum: RECOGNITION_CHECKS }],
      required: true,
    },
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

const learnerFeedbackSchema = new mongoose.Schema(
  {
    collected: { type: Boolean, required: true },
    reason: { type: String, default: null, maxlength: 2000 },
    note: { type: String, default: null, maxlength: 2000 },
    collectedOn: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    recordedAt: { type: Date, required: true },
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
    candidateCount: { type: Number, required: true, min: 0 },
    schemeId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Scheme" },
    projectId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Project" },
    sector: { type: String, required: true, enum: SECTOR_NAMES },
    ratioClass: { type: String, required: true, enum: RATIO_CLASSES },
    assessmentLanguage: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    state: { type: String, required: true, enum: STATE_UTS },
    learnerFeedback: { type: learnerFeedbackSchema, default: null },
    recognitionOverride: { type: recognitionOverrideSchema, default: null },
    status: { type: String, required: true, enum: BATCH_STATUSES },
    statusVersion: { type: Number, required: true, min: 1 },
    assessorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    proctorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    rejectReason: { type: String, default: null, maxlength: 2000 },
    cancelReason: { type: String, default: null, maxlength: 2000 },
    sla: { type: slaSchema, required: true },
    ratioOverride: { type: ratioOverrideSchema, default: null },
    resultId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // D5: the one test paper candidates of this batch can start. Set by aa_admin.
    testPaperId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "TestPaper" },
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
batchSchema.index({ schemeId: 1 }, { sparse: true });
batchSchema.index({ projectId: 1 }, { sparse: true });
// N-01 analytics: every query is a range on the IST start date, alone or with abId.
batchSchema.index({ assessmentStartDate: 1 });
batchSchema.index({ sector: 1 });
batchSchema.index({ reassessmentOf: 1 }, { sparse: true });
batchSchema.index({ firstAssessmentBatchId: 1 });

export const Batch = mongoose.model("Batch", batchSchema, "batches");
