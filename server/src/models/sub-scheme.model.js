import mongoose from "mongoose";

export const BILLED_ON = Object.freeze(["enrolled", "appeared"]);
export const JOB_ROLE_CATEGORIES = Object.freeze(["category_1", "category_2", "not_applicable"]);

/**
 * subSchemes. docs/SCHEMA.md §3.27a (X-45). A priced slice of a scheme for one sector and,
 * optionally, one job role (qualification). Never deleted, only deactivated.
 */
const subSchemeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sector: { type: String, required: true, trim: true, maxlength: 100 },
    schemeId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Scheme" },
    qualificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Qualification" },
    priceRegular: { type: Number, required: true, min: 0 },
    priceReassessment: { type: Number, required: true, min: 0 },
    priceEffectiveDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    billedOn: { type: String, required: true, enum: BILLED_ON },
    description: { type: String, trim: true, maxlength: 250 },
    jobRoleCategory: {
      type: String,
      required: true,
      enum: JOB_ROLE_CATEGORIES,
      default: "not_applicable",
    },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

subSchemeSchema.index({ schemeId: 1, name: 1 }, { unique: true });
subSchemeSchema.index({ sector: 1 });

export const SubScheme = mongoose.model("SubScheme", subSchemeSchema, "subSchemes");
