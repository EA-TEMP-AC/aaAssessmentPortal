import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_MAX_RECLAIMS,
  EMAIL_SENDING_STALE_MS,
  emailBackoffDelayMs,
} from "../../config/email.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { maskEmail } from "../../lib/redact.js";
import { EmailQueue } from "../../models/email-queue.model.js";

/**
 * Insert one emailQueue job. Callers that must not fail their API use enqueueEmailSafely.
 * @param {{ to: string[], subject: string, text: string, kind: string, meta?: object, nextAttemptAt?: Date }} input
 */
export async function enqueueEmail(input) {
  if (!Array.isArray(input.to) || input.to.length === 0) {
    const err = new Error("email recipient is required");
    err.code = "EMAIL_INVALID";
    throw err;
  }
  if (!input.subject || !input.text || !input.kind) {
    const err = new Error("email fields are required");
    err.code = "EMAIL_INVALID";
    throw err;
  }

  return EmailQueue.create({
    to: input.to,
    subject: input.subject,
    text: input.text,
    kind: input.kind,
    status: "pending",
    attempts: 0,
    nextAttemptAt: input.nextAttemptAt ?? new Date(),
    meta: input.meta,
  });
}

/**
 * Queue insert errors are swallowed. The password-reset API and later AB login
 * enqueue (B-06) must still succeed when this returns `{ queued: false }`.
 * Logs a code only — the error object can contain `text`.
 */
export async function enqueueEmailSafely(input) {
  try {
    const job = await enqueueEmail(input);
    return { queued: true, id: job._id.toString() };
  } catch (err) {
    console.error("email enqueue failed", safeErrorCode(err, "ENQUEUE_FAILED"));
    return { queued: false };
  }
}

/**
 * Atomic claim: pending → sending. Two workers cannot receive the same job.
 * `attempts` increments in the same update so a crash still counts the try.
 */
export async function claimNextEmail(now = new Date()) {
  return EmailQueue.findOneAndUpdate(
    {
      status: "pending",
      nextAttemptAt: { $lte: now },
      attempts: { $lt: EMAIL_MAX_ATTEMPTS },
    },
    {
      $set: { status: "sending", claimedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1, _id: 1 }, new: true },
  );
}

const STALE_CLAIM_ERROR = "Email send interrupted (STALE_CLAIM)";

/**
 * Reclaim jobs a crashed worker left in `sending` (open Q43, Q155). A job whose
 * claim is older than EMAIL_SENDING_STALE_MS returns to `pending` and is due
 * at once; the interrupted try stays counted in `attempts` and `reclaims`
 * goes up by one. A job already reclaimed EMAIL_MAX_RECLAIMS times, or one that
 * had used its last attempt, becomes `failed` instead, with `text` cleared.
 * A job saved before `reclaims` existed counts as 0.
 * Safe to run from several workers: each update filters on `sending`.
 * @returns {Promise<{ requeued: number, failed: number }>}
 */
export async function reclaimStaleEmails(now = new Date()) {
  const stale = {
    status: "sending",
    claimedAt: { $lte: new Date(now.getTime() - EMAIL_SENDING_STALE_MS) },
  };
  const staleFailedJobs = await EmailQueue.find({
    ...stale,
    $or: [{ attempts: { $gte: EMAIL_MAX_ATTEMPTS } }, { reclaims: { $gte: EMAIL_MAX_RECLAIMS } }],
  })
    .select("_id to")
    .lean();

  let failedCount = 0;
  for (const fJob of staleFailedJobs) {
    const maskedTo = Array.isArray(fJob.to) ? fJob.to.map(maskEmail) : fJob.to;
    const res = await EmailQueue.updateOne(
      { _id: fJob._id, status: "sending" },
      {
        $set: { status: "failed", lastError: STALE_CLAIM_ERROR, to: maskedTo },
        $unset: { text: "" },
      },
    );
    failedCount += res.modifiedCount;
  }

  const requeued = await EmailQueue.updateMany(
    {
      ...stale,
      attempts: { $lt: EMAIL_MAX_ATTEMPTS },
      reclaims: { $not: { $gte: EMAIL_MAX_RECLAIMS } },
    },
    {
      $set: { status: "pending", nextAttemptAt: now, lastError: STALE_CLAIM_ERROR },
      $inc: { reclaims: 1 },
    },
  );
  return { requeued: requeued.modifiedCount, failed: failedCount };
}

function safeSendError(err) {
  return `Email send failed (${safeErrorCode(err, "SEND_FAILED")})`;
}

/**
 * Claim one due job and send it. Transport failures stay on the job.
 * This function does not throw when send fails.
 */
export async function processNextEmail(transport, now = new Date()) {
  const job = await claimNextEmail(now);
  if (!job) return { claimed: false };

  const id = job._id.toString();
  const maskedTo = Array.isArray(job.to) ? job.to.map(maskEmail) : job.to;
  try {
    await transport.send({ to: job.to, subject: job.subject, text: job.text });
    await EmailQueue.updateOne(
      { _id: job._id, status: "sending" },
      {
        $set: { status: "sent", sentAt: now, lastError: null, to: maskedTo },
        $unset: { text: "" },
      },
    );
    return { claimed: true, status: "sent", id };
  } catch (err) {
    const lastError = safeSendError(err);
    const attempts = job.attempts;
    try {
      if (attempts >= EMAIL_MAX_ATTEMPTS) {
        await EmailQueue.updateOne(
          { _id: job._id, status: "sending" },
          { $set: { status: "failed", lastError, to: maskedTo }, $unset: { text: "" } },
        );
        console.error(`email job ${id} failed`, safeErrorCode(err, "SEND_FAILED"));
        return { claimed: true, status: "failed", id, attempts };
      }

      const delayMs = emailBackoffDelayMs(attempts);
      await EmailQueue.updateOne(
        { _id: job._id, status: "sending" },
        {
          $set: {
            status: "pending",
            nextAttemptAt: new Date(now.getTime() + delayMs),
            lastError,
          },
        },
      );
      console.error(`email job ${id} retry scheduled`, safeErrorCode(err, "SEND_FAILED"));
      return { claimed: true, status: "pending", id, attempts, delayMs };
    } catch (updateErr) {
      console.error(
        "email job status update failed",
        safeErrorCode(updateErr, "STATUS_UPDATE_FAILED"),
      );
      return { claimed: true, status: "sending", id, attempts };
    }
  }
}
