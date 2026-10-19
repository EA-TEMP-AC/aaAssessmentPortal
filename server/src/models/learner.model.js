import mongoose from "mongoose";
import { encryptedFieldsPlugin, normalizeText } from "../lib/encrypted-fields.plugin.js";

/**
 * learners. docs/SCHEMA.md §3.3. NCVET:TR s25.
 * Stable person across batches. externalRef is the student id from the TP/AB. Not a national ID.
 * X-45 (DECISIONS 999): father/husband name, gender, address and enrolment number were added at
 * the owner's request. Father/husband name and address are encrypted at rest.
 */
const learnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    externalRef: { type: String, trim: true, maxlength: 64 },
    // Encrypted at rest (S-01), not searchable. Length is checked in the request schema.
    phone: { type: String },
    enrolmentNumber: { type: String, trim: true, maxlength: 64 },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    fatherName: { type: String },
    address: { type: String },
    // X-46 (DECISIONS 1000): Aadhaar number, digits only. Encrypted at rest, never returned in full.
    aadhaar: { type: String },
    accommodations: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

learnerSchema.plugin(encryptedFieldsPlugin, {
  collection: "learners",
  fields: {
    phone: { normalize: normalizeText },
    fatherName: { normalize: normalizeText },
    address: { normalize: normalizeText },
    aadhaar: { normalize: normalizeText },
  },
});

learnerSchema.index({ externalRef: 1 }, { unique: true, sparse: true });
learnerSchema.index({ name: 1 });

export const Learner = mongoose.model("Learner", learnerSchema, "learners");
