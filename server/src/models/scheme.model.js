import mongoose from "mongoose";

/**
 * schemes. docs/SCHEMA.md §3.27. Funding schemes that batches can be tagged with.
 * `code` is unique. Never deleted, only deactivated.
 */
const schemeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, required: true, trim: true, maxlength: 64 },
    fundingBody: { type: String, trim: true, maxlength: 200, default: "" },
    // X-45: the reference portal's scheme form.
    sector: { type: String, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 250 },
    thirdParty: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

schemeSchema.index({ code: 1 }, { unique: true });

export const Scheme = mongoose.model("Scheme", schemeSchema, "schemes");
