import mongoose from "mongoose";
import { RATIO_CLASSES, SECTOR_NAMES } from "../config/annexure.js";

/**
 * qualifications. docs/SCHEMA.md §3.7. NCVET:FR §F (theory, practical, viva pass marks).
 * PC thresholds live on `pcs[].passMark` / `maxMark`. There is no active flag.
 */

const componentSchema = new mongoose.Schema(
  {
    theory: { type: Number, default: null },
    practical: { type: Number, default: null },
    viva: { type: Number, default: null },
  },
  { _id: false },
);

const pcSchema = new mongoose.Schema(
  {
    pcId: { type: String, required: true, trim: true, maxlength: 64 },
    code: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    passMark: { type: Number },
    maxMark: { type: Number },
  },
  { _id: false },
);

const nosSchema = new mongoose.Schema(
  {
    nosId: { type: String, required: true, trim: true, maxlength: 64 },
    code: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    maxMarks: { type: componentSchema, default: undefined },
    pcs: { type: [pcSchema], default: [] },
  },
  { _id: false },
);

const passMarksSchema = new mongoose.Schema(
  {
    theory: { type: Number, required: true },
    practical: { type: Number, required: true },
    viva: { type: Number, required: true },
  },
  { _id: false },
);

const qualificationSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sector: { type: String, required: true, enum: SECTOR_NAMES },
    ratioClass: { type: String, required: true, enum: RATIO_CLASSES },
    defaultBatchType: { type: String, enum: ["STT", "LTT"] },
    passCriteriaMode: { type: String, enum: ["nos_wise", "overall"] },
    passMarkUnit: { type: String, required: true, enum: ["percent", "absolute"] },
    passMarks: { type: passMarksSchema, required: true },
    maxMarks: { type: componentSchema, default: null },
    nos: { type: [nosSchema], required: true },
    pcPassMarksRequired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

qualificationSchema.index({ code: 1 }, { unique: true });
qualificationSchema.index({ sector: 1 });

export const Qualification = mongoose.model("Qualification", qualificationSchema, "qualifications");
