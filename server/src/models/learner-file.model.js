import mongoose from "mongoose";

export const LEARNER_FILE_KINDS = Object.freeze(["photo", "identity"]);
export const IDENTITY_DOC_TYPES = Object.freeze(["aadhaar_card", "driving_licence", "voter_id"]);

/**
 * learnerFiles. docs/SCHEMA.md §3.3a (X-47). A student's photo and identity card picture.
 * The bytes live in the evidence storage driver; this row holds where and what. A new upload
 * replaces the current one for the same kind and document type: the old row is kept with
 * `current: false` because storage has no delete. No card number is read from the picture.
 */
const learnerFileSchema = new mongoose.Schema(
  {
    learnerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Learner" },
    kind: { type: String, required: true, enum: LEARNER_FILE_KINDS },
    docType: { type: String, enum: IDENTITY_DOC_TYPES },
    storageKey: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    current: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

learnerFileSchema.index({ learnerId: 1, kind: 1, docType: 1, current: 1 });

export const LearnerFile = mongoose.model("LearnerFile", learnerFileSchema, "learnerFiles");
