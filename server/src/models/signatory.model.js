import mongoose from "mongoose";

export const SIGNATORY_SCOPES = Object.freeze(["scheme", "project", "agency"]);

/**
 * authorisedSignatories. docs/SCHEMA.md §3.27. Who may sign for a scheme, a project,
 * or the whole agency, within a validity window (`YYYY-MM-DD` IST). No signature
 * images and no personal ID numbers. Never deleted, only deactivated.
 */
const signatorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    designation: { type: String, required: true, trim: true, maxlength: 200 },
    scope: { type: String, required: true, enum: SIGNATORY_SCOPES },
    schemeId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Scheme" },
    projectId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Project" },
    validFrom: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    validTo: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

signatorySchema.index({ scope: 1, schemeId: 1, projectId: 1 });

export const Signatory = mongoose.model("Signatory", signatorySchema, "authorisedSignatories");
