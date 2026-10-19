import mongoose from "mongoose";

/** Singleton document key. Decisions 174 and 175 (Q161, Q171). */
export const ACCESS_SETTINGS_KEY = "access";

/**
 * settings. docs/SCHEMA.md §3.22: one document, key "access". Both flags default to false so a
 * missing document and a fresh one read the same.
 */
const accessSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: ACCESS_SETTINGS_KEY },
    abReviewerCanReadAssessorPayments: { type: Boolean, required: true, default: false },
    ncvetViewerCanSeeAbQueue: { type: Boolean, required: true, default: false },
    // X-47: who sees the Aadhaar number. hidden: nobody. masked: last four digits. full: admin and
    // MIS see all twelve digits, everyone else the last four.
    aadhaarVisibility: {
      type: String,
      required: true,
      enum: ["hidden", "masked", "full"],
      default: "masked",
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

accessSettingsSchema.index({ key: 1 }, { unique: true });

export const AccessSettings = mongoose.model("AccessSettings", accessSettingsSchema, "settings");
