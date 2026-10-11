import mongoose from "mongoose";
import { STATE_UTS } from "../config/annexure.js";

/**
 * centres. docs/SCHEMA.md §3.6. `state` is Annexure IV (required).
 * Other fields stay the B-07a proposal (open questions 47–57).
 */
const centreSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, maxlength: 64 },
    tpId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "TrainingPartner" },
    state: { type: String, required: true, enum: STATE_UTS },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

centreSchema.index({ code: 1 }, { unique: true, sparse: true });
centreSchema.index({ tpId: 1 });

export const Centre = mongoose.model("Centre", centreSchema, "centres");
