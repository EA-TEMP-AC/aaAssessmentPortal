import mongoose from "mongoose";

/** Singleton document key. SCHEMA §3.15 does not list fields; see DECISIONS.md. */
export const WORKING_DAY_CONFIG_KEY = "default";

function validWeekendDays(days) {
  return (
    Array.isArray(days) &&
    days.length < 7 &&
    new Set(days).size === days.length &&
    days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );
}

/**
 * workingDayConfig. docs/SCHEMA.md §3.15.
 * One row holds the weekend days used by the working-day calculator.
 */
const workingDayConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: WORKING_DAY_CONFIG_KEY },
    weekendDays: {
      type: [Number],
      required: true,
      validate: { validator: validWeekendDays, message: "Invalid weekendDays" },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

workingDayConfigSchema.index({ key: 1 }, { unique: true });

export const WorkingDayConfig = mongoose.model(
  "WorkingDayConfig",
  workingDayConfigSchema,
  "workingDayConfig",
);
