import mongoose from "mongoose";

/**
 * learners. docs/SCHEMA.md §3.3. NCVET:TR s25.
 * Stable person across batches. externalRef is a TP/AB id, not Aadhaar.
 * Do not add personal fields beyond this list.
 */
const learnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    externalRef: { type: String, trim: true, maxlength: 64 },
    phone: { type: String, trim: true, maxlength: 32 },
    accommodations: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

learnerSchema.index({ externalRef: 1 }, { unique: true, sparse: true });
learnerSchema.index({ name: 1 });

export const Learner = mongoose.model("Learner", learnerSchema, "learners");
