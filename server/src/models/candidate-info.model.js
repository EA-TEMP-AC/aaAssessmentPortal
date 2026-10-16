import mongoose from "mongoose";
import { encryptedFieldsPlugin, normalizeText } from "../lib/encrypted-fields.plugin.js";

/**
 * candidateInfo. docs/SCHEMA.md §3.43. Task B-20.
 * What a candidate typed into the pre-exam pop-up of their batch. One row per roster candidate.
 * Every value is encrypted at rest and none is searchable. No national ID field exists here.
 * Read only by aa_admin and the batch's tp; never written to audit rows or logs.
 */
const candidateInfoSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    candidateId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Candidate" },
    learnerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Learner" },
    email: { type: String },
    fatherName: { type: String },
    gender: { type: String },
    dateOfBirth: { type: String },
    submittedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

candidateInfoSchema.plugin(encryptedFieldsPlugin, {
  collection: "candidateInfo",
  fields: {
    email: { normalize: normalizeText },
    fatherName: { normalize: normalizeText },
    gender: { normalize: normalizeText },
    dateOfBirth: { normalize: normalizeText },
  },
});

candidateInfoSchema.index({ batchId: 1, candidateId: 1 }, { unique: true });

export const CandidateInfo = mongoose.model("CandidateInfo", candidateInfoSchema, "candidateInfo");
