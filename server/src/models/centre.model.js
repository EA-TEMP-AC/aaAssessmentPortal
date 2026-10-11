import mongoose from "mongoose";

/**
 * centres. docs/SCHEMA.md §3.6 lists no fields ("unchanged").
 * `tpId` points at trainingPartners. Shape is proposed in DECISIONS.md.
 */
const centreSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, maxlength: 64 },
    tpId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "TrainingPartner" },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

centreSchema.index({ code: 1 }, { unique: true, sparse: true });
centreSchema.index({ tpId: 1 });

export const Centre = mongoose.model("Centre", centreSchema, "centres");
