import mongoose from "mongoose";
import { SECTOR_NAMES } from "../config/annexure.js";

/**
 * nqrQualifications. docs/SCHEMA.md §3.21. Task Q-05.
 * The National Qualifications Register list per sector, loaded by CSV.
 * `code` matches `qualifications.code` when the AA holds that qualification.
 */
const nqrQualificationSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sector: { type: String, required: true, enum: SECTOR_NAMES },
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

nqrQualificationSchema.index({ code: 1 }, { unique: true });
nqrQualificationSchema.index({ sector: 1, code: 1 });

export const NqrQualification = mongoose.model(
  "NqrQualification",
  nqrQualificationSchema,
  "nqrQualifications",
);
