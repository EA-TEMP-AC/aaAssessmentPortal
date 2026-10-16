import mongoose from "mongoose";
import { encryptedFieldsPlugin } from "../lib/encrypted-fields.plugin.js";

/**
 * proctoringFlags. docs/SCHEMA.md §3.40. Tasks P-01, P-04, P-08.
 * One row per event the candidate's browser reported. `severity` is set by the server from
 * compliance.PROCTOR_FLAG_SEVERITY. `detail` holds a label, a count and a confidence only, never
 * an image or personal data. A flag gets at most one review decision.
 */
export const PROCTORING_FLAG_TYPES = Object.freeze([
  "tab_hidden",
  "fullscreen_exit",
  "window_blur",
  "permission_revoked",
  "object_detected",
  "face_not_present",
  "multiple_faces",
  "person_detected",
  "phone_detected",
  "camera_blocked",
  "camera_frozen",
  "face_mismatch",
  "id_mismatch",
  "id_unreadable",
]);
export const PROCTORING_SEVERITIES = Object.freeze(["low", "medium", "high"]);
/** X-07: whether the flag photo carries coordinates. `captured` means `location` is set. */
export const PROCTORING_LOCATION_STATUSES = Object.freeze(["captured", "not_shared"]);
export const PROCTORING_DECISIONS = Object.freeze(["dismiss", "warn", "invalidate_recommended"]);

const detailSchema = new mongoose.Schema(
  {
    label: { type: String, maxlength: 60 },
    count: { type: Number, min: 0 },
    confidence: { type: Number, min: 0, max: 1 },
  },
  { _id: false },
);

const reviewSchema = new mongoose.Schema(
  {
    decision: { type: String, required: true, enum: PROCTORING_DECISIONS },
    note: { type: String, default: null, maxlength: 300 },
    decidedAt: { type: Date, required: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    decidedByRole: { type: String, required: true },
  },
  { _id: false },
);

const proctoringFlagSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "ProctoringSession" },
    attemptId: { type: mongoose.Schema.Types.ObjectId, required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    abId: { type: mongoose.Schema.Types.ObjectId, required: true },
    clientEventId: { type: String, required: true, maxlength: 200 },
    type: { type: String, required: true, enum: PROCTORING_FLAG_TYPES },
    severity: { type: String, required: true, enum: PROCTORING_SEVERITIES },
    /** Device clock, as sent. */
    capturedAt: { type: Date, required: true },
    /** Server clock. */
    receivedAt: { type: Date, required: true },
    detail: { type: detailSchema, default: null },
    evidenceId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Evidence" },
    /**
     * X-07: `{"latitude":n,"longitude":n,"accuracy":n}` as JSON text, encrypted at rest (personal
     * data). Only the photo-details read returns it, and only to aa_admin, tp and proctor.
     */
    location: { type: String, default: null },
    locationStatus: {
      type: String,
      required: true,
      enum: PROCTORING_LOCATION_STATUSES,
      default: "not_shared",
    },
    payloadHash: { type: String, required: true },
    review: { type: reviewSchema, default: null },
  },
  { timestamps: false },
);

proctoringFlagSchema.plugin(encryptedFieldsPlugin, {
  collection: "proctoringFlags",
  fields: { location: {} },
});

proctoringFlagSchema.index({ sessionId: 1, clientEventId: 1 }, { unique: true });
proctoringFlagSchema.index({ sessionId: 1, capturedAt: 1 });
proctoringFlagSchema.index({ batchId: 1, severity: 1 });

export const ProctoringFlag = mongoose.model(
  "ProctoringFlag",
  proctoringFlagSchema,
  "proctoringFlags",
);
