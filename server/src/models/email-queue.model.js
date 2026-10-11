import mongoose from "mongoose";

/**
 * emailQueue. docs/SCHEMA.md §3.12.
 * Worker, retries, and SMTP are B-08. B-06 inserts assessor-login jobs only.
 * `text` may hold a temporary password. Do not copy `text` into audit logs or console output.
 * NCVET:FR §E; NCVET:TR s9 (AB mail delivery). Password-reset mail is a project choice.
 */
export const EMAIL_QUEUE_STATUSES = Object.freeze(["pending", "sending", "sent", "failed"]);

const emailQueueSchema = new mongoose.Schema(
  {
    to: { type: [String], required: true },
    subject: { type: String, required: true },
    text: { type: String, required: true },
    kind: { type: String, required: true },
    status: { type: String, required: true, enum: EMAIL_QUEUE_STATUSES, default: "pending" },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    lastError: { type: String },
    sentAt: { type: Date },
    claimedAt: { type: Date },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

emailQueueSchema.index({ status: 1, nextAttemptAt: 1 });

export const EmailQueue = mongoose.model("EmailQueue", emailQueueSchema, "emailQueue");
