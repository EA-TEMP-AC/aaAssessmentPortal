import mongoose from "mongoose";

/**
 * assessors. docs/SCHEMA.md §3.5. NCVET:FR §D; NCVET:TR s25.
 * ToA + undertaking. languages compared trim + case-insensitive to
 * batches.assessmentLanguage. Do not store Aadhaar or other national IDs.
 */

const toaSchema = new mongoose.Schema(
  {
    certNo: { type: String, required: true, trim: true, maxlength: 64 },
    issuedOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    expiresOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { _id: false },
);

const assessorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, maxlength: 64 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    qualifications: { type: [{ type: String, trim: true, maxlength: 200 }], default: [] },
    yearsOfExperience: { type: Number, min: 0, max: 80, default: null },
    languages: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
    toa: { type: toaSchema, default: null },
    otherAaCount: { type: Number, required: true, min: 0, max: 99, default: 0 },
    undertaking: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

assessorSchema.index({ code: 1 }, { unique: true, sparse: true });
assessorSchema.index({ email: 1 }, { unique: true, sparse: true });
assessorSchema.index({ name: 1 });

export const Assessor = mongoose.model("Assessor", assessorSchema, "assessors");
