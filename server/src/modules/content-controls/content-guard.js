import { contentReadCapFor } from "../../config/content-controls.js";
import { contentReadLimit } from "../../lib/errors.js";
import { toObjectIdOrNull } from "../../lib/object-id.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { ContentAnomaly } from "../../models/content-anomaly.model.js";
import { ContentReadCounter } from "../../models/content-read-counter.model.js";
import { recordAccess } from "../audit/access-log.service.js";

/** Personal-data style field names for the access log: which parts of a question were returned. */
export const CONTENT_FIELDS = Object.freeze(["stem", "options", "correctAnswer"]);

const MAX_ATTEMPTS = 3;

function routeOf(req) {
  return `${req.method} ${req.baseUrl}${req.route?.path === "/" ? "" : (req.route?.path ?? "")}`;
}

async function refuse(req, { userId, day, cap, attempted }) {
  const current = await ContentReadCounter.findOne({ userId, day }).select("count").lean();
  const readCount = current?.count ?? 0;
  const now = new Date();
  await ContentAnomaly.findOneAndUpdate(
    { userId, day },
    {
      $set: {
        role: req.user.role,
        readCount,
        attemptedCount: attempted,
        route: routeOf(req),
        lastAt: now,
      },
      $inc: { refusedRequests: 1 },
      $setOnInsert: { cap, firstAt: now },
    },
    { upsert: true },
  );
  throw contentReadLimit({ cap });
}

/**
 * Counts `count` question reads against the caller's daily cap (IST day). Refuses with
 * 429 CONTENT_READ_LIMIT, and records an anomaly row, when the read would pass the cap.
 * The increment is atomic, so parallel requests cannot slip past the cap together.
 * Call it after the data is loaded and before it is sent. Nothing about the content is stored.
 *
 * @param {import("express").Request} req
 * @param {number} count
 */
export async function chargeContentReads(req, count) {
  if (!Number.isInteger(count) || count <= 0) return;
  const userId = toObjectIdOrNull(req.user?._id);
  if (!userId) throw new TypeError("chargeContentReads needs an authenticated user");
  const day = istCalendarDate(new Date());
  const cap = contentReadCapFor(req.user.role);

  if (count > cap) {
    await refuse(req, { userId, day, cap, attempted: count });
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const updated = await ContentReadCounter.findOneAndUpdate(
        { userId, day, count: { $lte: cap - count } },
        { $inc: { count } },
        { upsert: true, new: true },
      );
      if (updated) return;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Either the row is over the cap, or two first requests of the day raced to create it.
      const current = await ContentReadCounter.findOne({ userId, day }).select("count").lean();
      if (current && current.count + count <= cap) continue;
    }
    break;
  }
  await refuse(req, { userId, day, cap, attempted: count });
}

/**
 * Guard for an endpoint that returns question content: counts the reads, then writes the
 * access-log rows. Either failing means the caller sends nothing.
 * `exemptFromCap` skips the count and the cap (Q588: staff attempt views) but the access-log
 * rows are still written.
 *
 * @param {import("express").Request} req
 * @param {{ questionIds?: Array<string|object>, paperId?: string|object, kind: "list"|"detail", exemptFromCap?: boolean }} entry
 */
export async function guardContentRead(
  req,
  { questionIds = [], paperId, kind, exemptFromCap = false },
) {
  if (!exemptFromCap) await chargeContentReads(req, questionIds.length);
  if (paperId) {
    await recordAccess(req, {
      subjectType: "testPaper",
      subjectIds: [paperId],
      kind,
      fields: ["items"],
    });
  }
  await recordAccess(req, {
    subjectType: "question",
    subjectIds: questionIds,
    kind,
    fields: [...CONTENT_FIELDS],
  });
}
