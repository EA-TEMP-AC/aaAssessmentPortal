import mongoose from "mongoose";

/**
 * projects. docs/SCHEMA.md §3.27. A project sits under one scheme. `code` is unique
 * across all projects. Dates are `YYYY-MM-DD` IST. Never deleted, only deactivated.
 */
const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, required: true, trim: true, maxlength: 64 },
    schemeId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Scheme" },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

projectSchema.index({ code: 1 }, { unique: true });
projectSchema.index({ schemeId: 1 });

export const Project = mongoose.model("Project", projectSchema, "projects");
