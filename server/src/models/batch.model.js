import mongoose from "mongoose";
import {
  CANDIDATE_INFO_FIELDS,
  FLAG_COUNT_SEVERITIES,
  FLAG_PAUSE_AFTER_MAX,
  FLAG_PAUSE_AFTER_MIN,
  FLAG_POLICY_ACTIONS,
  IMAGE_INTERVAL_MAX_SECONDS,
  IMAGE_INTERVAL_MIN_SECONDS,
  LOCATION_VIEWER_ROLES,
} from "../config/batch-settings.js";
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

/**
 * B-20. Only values an aa_admin has set are stored; a missing key means the default in
 * config/batch-settings.js. No personal data here: the pop-up only lists which fields to ask.
 */
const batchSettingsSchema = new mongoose.Schema(
  {
    shuffleQuestions: { type: Boolean },
    shuffleOptions: { type: Boolean },
    showMarksToCandidate: { type: Boolean },
    marksAfterValidation: { type: Boolean },
    questionsMandatory: { type: Boolean },
    flagPolicy: {
      type: new mongoose.Schema(
        {
          action: { type: String, enum: FLAG_POLICY_ACTIONS },
          pauseAfterFlags: { type: Number, min: FLAG_PAUSE_AFTER_MIN, max: FLAG_PAUSE_AFTER_MAX },
          countSeverities: {
            type: [{ type: String, enum: FLAG_COUNT_SEVERITIES }],
            default: undefined,
          },
          extendOnUnlock: { type: Boolean },
        },
        { _id: false },
      ),
      default: undefined,
    },
    imageCapture: {
      type: new mongoose.Schema(
        {
          intervalSeconds: {
            type: Number,
            min: IMAGE_INTERVAL_MIN_SECONDS,
            max: IMAGE_INTERVAL_MAX_SECONDS,
          },
          atStartAndEnd: { type: Boolean },
        },
        { _id: false },
      ),
      default: undefined,
    },
    candidateInfoPopup: {
      type: new mongoose.Schema(
        {
          enabled: { type: Boolean },
          fields: { type: [{ type: String, enum: CANDIDATE_INFO_FIELDS }], default: undefined },
        },
        { _id: false },
      ),
      default: undefined,
    },
    captureLocation: { type: Boolean },
    locationVisibleTo: {
      type: [{ type: String, enum: LOCATION_VIEWER_ROLES }],
      default: undefined,
    },
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
    settings: { type: batchSettingsSchema, default: undefined },
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
    // X-07: when true, the candidate's browser may add its location to proctoring flag photos.
    captureLocation: { type: Boolean, required: true, default: false },
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
