import mongoose from "mongoose";

/**
 * holidays. docs/SCHEMA.md §3.15.
 * `region: null` is AA-wide. A non-null region applies only when a caller asks for it.
 * Unique on date + region. Writes are audit-logged and do not recompute stored due instants.
 */
const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    region: { type: String, default: null, maxlength: 64 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

holidaySchema.index({ date: 1, region: 1 }, { unique: true });

export const Holiday = mongoose.model("Holiday", holidaySchema, "holidays");
