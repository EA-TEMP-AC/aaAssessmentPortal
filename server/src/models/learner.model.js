import mongoose from "mongoose";
import { encryptedFieldsPlugin, normalizeText } from "../lib/encrypted-fields.plugin.js";

/**
 * learners. docs/SCHEMA.md §3.3. NCVET:TR s25.
 * Stable person across batches. externalRef is a TP/AB id, not Aadhaar.
 * Do not add personal fields beyond this list.
 */
const learnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    externalRef: { type: String, trim: true, maxlength: 64 },
    // Encrypted at rest (S-01), not searchable. Length is checked in the request schema.
    phone: { type: String },
    accommodations: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

learnerSchema.plugin(encryptedFieldsPlugin, {
  collection: "learners",
  fields: { phone: { normalize: normalizeText } },
});

learnerSchema.index({ externalRef: 1 }, { unique: true, sparse: true });
learnerSchema.index({ name: 1 });

export const Learner = mongoose.model("Learner", learnerSchema, "learners");
