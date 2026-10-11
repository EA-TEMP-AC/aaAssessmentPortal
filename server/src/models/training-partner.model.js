import mongoose from "mongoose";

/**
 * trainingPartners. docs/SCHEMA.md §3.6 lists no fields ("unchanged").
 * Shape used by B-07a is proposed in DECISIONS.md. No Aadhaar.
 */
const trainingPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, maxlength: 64 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

trainingPartnerSchema.index({ code: 1 }, { unique: true, sparse: true });
trainingPartnerSchema.index({ email: 1 }, { unique: true, sparse: true });

export const TrainingPartner = mongoose.model(
  "TrainingPartner",
  trainingPartnerSchema,
  "trainingPartners",
);
