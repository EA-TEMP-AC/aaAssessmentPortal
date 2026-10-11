import mongoose from "mongoose";

/**
 * awardingBodies. docs/SCHEMA.md §3.4.
 * `code` is unique when set. Each notification email belongs to one AB
 * (proposed; see DECISIONS.md). No Aadhaar.
 */
const awardingBodySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, trim: true, maxlength: 64 },
    notificationEmails: {
      type: [{ type: String, trim: true, lowercase: true }],
      required: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length >= 1;
        },
        message: "notificationEmails requires at least one address",
      },
    },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

awardingBodySchema.index({ code: 1 }, { unique: true, sparse: true });
awardingBodySchema.index({ notificationEmails: 1 }, { unique: true });

export const AwardingBody = mongoose.model("AwardingBody", awardingBodySchema, "awardingBodies");
