import mongoose from "mongoose";
import { SECTOR_NAMES } from "../config/annexure.js";

/**
 * sectorConfigs. docs/SCHEMA.md §3.25. Task Q-05.
 * One row per Annexure II sector on the recognition record. Not the ratio class.
 */
const sectorConfigSchema = new mongoose.Schema(
  {
    sector: { type: String, required: true, enum: SECTOR_NAMES },
    active: { type: Boolean, required: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

sectorConfigSchema.index({ sector: 1 }, { unique: true });

export const SectorConfig = mongoose.model("SectorConfig", sectorConfigSchema, "sectorConfigs");
