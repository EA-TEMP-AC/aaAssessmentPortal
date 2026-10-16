import { istCalendarDate } from "../../lib/working-days.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { AwardingBody } from "../../models/awarding-body.model.js";
import { ReviewReminder } from "../../models/review-reminder.model.js";
import { enqueueEmail } from "../email/email-queue.service.js";
import { computeReviewDue } from "./review-due.service.js";

/** Once a day. Operational schedule, same as the SLA job. */
export const REVIEW_REMINDER_JOB_INTERVAL_MS = 86_400_000;

/**
 * A claim row with no emailId older than this is treated as a crashed run: it is removed so
 * the next run can queue the reminder. Operational value, not a compliance constant.
 */
export const REVIEW_REMINDER_CLAIM_TIMEOUT_MS = 600_000;

export const REVIEW_REMINDER_EMAIL_KIND = "question_review_due";

function reminderText(row) {
  const last = row.lastCompletedReviewAt
    ? istCalendarDate(row.lastCompletedReviewAt)
    : "none recorded";
  return [
    "Question bank review reminder.",
    `Qualification: ${row.code} - ${row.name}`,
    `Questions past the ${row.intervalMonths}-month review interval: ${row.dueQuestionCount}`,
    `Last completed review: ${last}`,
    "Please arrange a review cycle for this qualification in the Assessment Portal.",
    "This message does not contain any question content.",
  ].join("\n");
}

/**
 * Queue one reminder per qualification, awarding body and period. A reminder row is inserted
 * first; its unique index means a second run (or a second process) cannot queue the same
 * reminder again. If the email cannot be queued the row is removed so the next run retries.
 * The job does not write an audit row.
 * @param {Date} [now]
 * @returns {Promise<{ queued: number, alreadyReminded: number, noAwardingBody: number, failed: number }>}
 */
export async function queueReviewReminders(now = new Date()) {
  const result = { queued: 0, alreadyReminded: 0, noAwardingBody: 0, failed: 0 };
  await ReviewReminder.deleteMany({
    emailId: null,
    createdAt: { $lt: new Date(now.getTime() - REVIEW_REMINDER_CLAIM_TIMEOUT_MS) },
  });
  const due = await computeReviewDue(now);
  if (due.length === 0) return result;

  const abIds = [...new Set(due.flatMap((row) => row.abIds))];
  const abs = await AwardingBody.find({ _id: { $in: abIds }, active: true })
    .select("notificationEmails")
    .lean();
  const emailsByAb = new Map(abs.map((ab) => [String(ab._id), ab.notificationEmails]));

  for (const row of due) {
    const targets = row.abIds.filter((id) => emailsByAb.get(id)?.length);
    if (targets.length === 0) {
      result.noAwardingBody += 1;
      continue;
    }
    for (const abId of targets) {
      let claim;
      try {
        claim = await ReviewReminder.create({
          qualificationId: row.qualificationId,
          abId,
          anchorDate: row.anchorDate,
          periodNo: row.periodNo,
          dueQuestionCount: row.dueQuestionCount,
        });
      } catch (err) {
        if (err?.code === 11000) {
          result.alreadyReminded += 1;
          continue;
        }
        throw err;
      }
      try {
        const email = await enqueueEmail({
          to: emailsByAb.get(abId),
          subject: `Question bank review due: ${row.code}`,
          text: reminderText(row),
          kind: REVIEW_REMINDER_EMAIL_KIND,
          meta: { qualificationId: row.qualificationId, abId, periodNo: row.periodNo },
        });
        await ReviewReminder.updateOne({ _id: claim._id }, { $set: { emailId: email._id } });
        result.queued += 1;
      } catch (err) {
        await ReviewReminder.deleteOne({ _id: claim._id });
        console.error("review reminder enqueue failed", safeErrorCode(err, "ENQUEUE_FAILED"));
        result.failed += 1;
      }
    }
  }
  return result;
}

/**
 * Process-local timer. Tests call queueReviewReminders directly.
 * Overlapping ticks in this process are skipped; the unique reminder row covers a second process.
 * With runOnStart the job also runs once right away.
 * @param {{ intervalMs?: number, run?: typeof queueReviewReminders, runOnStart?: boolean }} [options]
 * @returns {() => void} stop
 */
export function startReviewReminderScheduler({
  intervalMs = REVIEW_REMINDER_JOB_INTERVAL_MS,
  run = queueReviewReminders,
  runOnStart = false,
} = {}) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => run())
      .catch((err) => {
        console.error("review reminder job failed", safeErrorCode(err, "REVIEW_REMINDER_FAILED"));
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  if (runOnStart) tick();
  if (typeof timer.unref === "function") timer.unref();

  return function stopReviewReminderScheduler() {
    clearInterval(timer);
  };
}
