import mongoose from "mongoose";

/**
 * proctors. docs/SCHEMA.md §3.5. No ToA (assessors only).
 * Do not store Aadhaar or other national IDs.
 */

const proctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, maxlength: 64 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    qualifications: { type: [{ type: String, trim: true, maxlength: 200 }], default: [] },
    languages: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

proctorSchema.index({ code: 1 }, { unique: true, sparse: true });
proctorSchema.index({ email: 1 }, { unique: true, sparse: true });
proctorSchema.index({ name: 1 });

export const Proctor = mongoose.model("Proctor", proctorSchema, "proctors");
