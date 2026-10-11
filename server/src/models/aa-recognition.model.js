import mongoose from "mongoose";
import { SECTOR_NAMES, STATE_UTS } from "../config/annexure.js";

/**
 * aaRecognition. docs/SCHEMA.md §3.17. NCVET:FR recognition sections.
 * One document. PUT replaces it and does not rewrite existing batches.
 */
export const RECOGNITION_KEY = "default";

const aaRecognitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: RECOGNITION_KEY, enum: [RECOGNITION_KEY] },
    sectors: {
      type: [{ type: String, enum: SECTOR_NAMES }],
      required: true,
      validate: {
        validator(values) {
          return values.length > 0 && new Set(values).size === values.length;
        },
        message: "sectors must be a unique non-empty list",
      },
    },
    panIndia: { type: Boolean, required: true },
    states: {
      type: [{ type: String, enum: STATE_UTS }],
      required: true,
      validate: {
        validator(values) {
          return new Set(values).size === values.length;
        },
        message: "states must be unique",
      },
    },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

aaRecognitionSchema.index({ key: 1 }, { unique: true });

export const AaRecognition = mongoose.model("AaRecognition", aaRecognitionSchema, "aaRecognition");
