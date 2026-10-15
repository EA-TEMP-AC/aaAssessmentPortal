import mongoose from "mongoose";

/**
 * reviewSettings. docs/SCHEMA.md §3.34. Task Q-04.
 * Review interval for one qualification. No row means compliance.QUESTION_REVIEW_INTERVAL_MONTHS.
 */
const reviewSettingSchema = new mongoose.Schema(
  {
    qualificationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Qualification",
    },
    intervalMonths: { type: Number, required: true, min: 1, max: 60 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

reviewSettingSchema.index({ qualificationId: 1 }, { unique: true });

export const ReviewSetting = mongoose.model("ReviewSetting", reviewSettingSchema, "reviewSettings");
