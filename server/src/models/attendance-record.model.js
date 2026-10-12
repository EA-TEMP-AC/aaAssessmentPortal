import mongoose from "mongoose";

/**
 * attendanceRecords. docs/SCHEMA.md §3.13. NCVET:FR §E.
 * One row per roster candidate on a batch. `present: false` drives the result
 * outcome `Absent` (B-05). `capturedAt` is the device clock, `receivedAt` the
 * server clock. No Aadhaar or other national ID: `idVerified` is a yes/no only.
 */
const attendanceRecordSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    candidateId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Candidate" },
    present: { type: Boolean, required: true },
    idVerified: { type: Boolean, default: null },
    note: { type: String, trim: true, maxlength: 500 },
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    /** assessors id (users.linkedProfileId) and the user who sent it. */
    assessorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Assessor" },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

attendanceRecordSchema.index({ batchId: 1, candidateId: 1 }, { unique: true });

export const AttendanceRecord = mongoose.model(
  "AttendanceRecord",
  attendanceRecordSchema,
  "attendanceRecords",
);
