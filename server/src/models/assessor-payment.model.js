import mongoose from "mongoose";

/**
 * assessorPayments. docs/SCHEMA.md §3.18. NCVET:FR §D, §J.
 * One row per batch and assessor. `pending` is always set by the server.
 */
const assessorPaymentSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    assessorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Assessor" },
    amountDue: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, required: true, min: 0 },
    pending: { type: Number, required: true, min: 0 },
    logisticsNote: { type: String, default: null, trim: true, maxlength: 2000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

assessorPaymentSchema.index({ batchId: 1, assessorId: 1 }, { unique: true });
assessorPaymentSchema.index({ assessorId: 1 });

export const AssessorPayment = mongoose.model(
  "AssessorPayment",
  assessorPaymentSchema,
  "assessorPayments",
);
