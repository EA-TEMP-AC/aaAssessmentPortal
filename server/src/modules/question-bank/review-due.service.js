import { compliance } from "../../config/compliance.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { AwardingBody } from "../../models/awarding-body.model.js";
import { Batch } from "../../models/batch.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { Question } from "../../models/question.model.js";
import { ReviewCycle } from "../../models/review-cycle.model.js";
import { ReviewSetting } from "../../models/review-setting.model.js";

/**
 * Which qualifications are past their review interval. Q-04.
 *
 * A question's review clock starts when its current version was created and restarts when a
 * `keep` decision on it is recorded in a closed cycle. A qualification's clock restarts when
 * a cycle for it is closed with every question decided (not `incomplete`), and starts at the
 * qualification's own createdAt before that. Only approved, latest questions are counted.
 * Dates are IST calendar dates. Reads ids and dates only, never question text.
 */

/** YYYY-MM-DD plus whole months. A day past the end of the target month moves to its last day. */
export function addMonthsIso(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return out.toISOString().slice(0, 10);
}

/** Whole months from `fromIso` up to `toIso` (0 when `toIso` is earlier). */
export function wholeMonthsBetween(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, months);
}

function laterOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * @param {Date} [now]
 * @param {{ qualificationIds?: Array<unknown> }} [options]
 * @returns {Promise<Array<{
 *   qualificationId: string, code: string, name: string, intervalMonths: number,
 *   anchorDate: string, periodNo: number, lastCompletedReviewAt: Date|null,
 *   dueQuestionCount: number, qualificationOverdue: boolean, abIds: string[]
 * }>>}
 */
export async function computeReviewDue(now = new Date(), { qualificationIds } = {}) {
  const todayIso = istCalendarDate(now);
  const qualFilter = qualificationIds ? { _id: { $in: qualificationIds } } : {};
  const qualifications = await Qualification.find(qualFilter).select("code name createdAt").lean();
  if (qualifications.length === 0) return [];
  const ids = qualifications.map((q) => q._id);

  const [questions, cycles, settings, batchAbs] = await Promise.all([
    Question.find({ qualificationId: { $in: ids }, status: "approved", isLatest: true })
      .select("qualificationId rootQuestionId createdAt")
      .lean(),
    ReviewCycle.find({ qualificationId: { $in: ids } })
      .select(
        "qualificationId abId status incomplete closedAt items.rootQuestionId items.decision items.decidedAt",
      )
      .lean(),
    ReviewSetting.find({ qualificationId: { $in: ids } }).lean(),
    Batch.aggregate([
      { $match: { qualificationId: { $in: ids } } },
      { $group: { _id: { q: "$qualificationId", ab: "$abId" } } },
    ]),
  ]);

  const intervalByQual = new Map(
    settings.map((s) => [String(s.qualificationId), s.intervalMonths]),
  );
  const questionsByQual = new Map();
  for (const q of questions) {
    const key = String(q.qualificationId);
    if (!questionsByQual.has(key)) questionsByQual.set(key, []);
    questionsByQual.get(key).push(q);
  }

  const keptAt = new Map(); // rootQuestionId -> latest keep decision in a closed cycle
  const completedAt = new Map(); // qualificationId -> latest complete close
  const abSets = new Map(); // qualificationId -> Set of abId strings
  const addAb = (qualId, abId) => {
    const key = String(qualId);
    if (!abSets.has(key)) abSets.set(key, new Set());
    abSets.get(key).add(String(abId));
  };
  for (const cycle of cycles) {
    addAb(cycle.qualificationId, cycle.abId);
    if (cycle.status !== "closed") continue;
    for (const item of cycle.items ?? []) {
      if (item.decision !== "keep" || !item.decidedAt) continue;
      const key = String(item.rootQuestionId);
      keptAt.set(key, laterOf(keptAt.get(key), item.decidedAt));
    }
    if (!cycle.incomplete && cycle.closedAt) {
      const key = String(cycle.qualificationId);
      completedAt.set(key, laterOf(completedAt.get(key), cycle.closedAt));
    }
  }
  for (const row of batchAbs) addAb(row._id.q, row._id.ab);

  const activeAbs = new Set(
    (await AwardingBody.find({ active: true }).select("_id").lean()).map((ab) => String(ab._id)),
  );

  const due = [];
  for (const qual of qualifications) {
    const key = String(qual._id);
    const approved = questionsByQual.get(key) ?? [];
    if (approved.length === 0) continue;

    const intervalMonths = intervalByQual.get(key) ?? compliance.QUESTION_REVIEW_INTERVAL_MONTHS;
    const lastCompletedReviewAt = completedAt.get(key) ?? null;
    const anchorDate = istCalendarDate(lastCompletedReviewAt ?? qual.createdAt ?? now);
    const periods = Math.floor(wholeMonthsBetween(anchorDate, todayIso) / intervalMonths);

    let dueQuestionCount = 0;
    for (const q of approved) {
      const root = String(q.rootQuestionId ?? q._id);
      const lastReviewed = istCalendarDate(laterOf(q.createdAt, keptAt.get(root)));
      if (addMonthsIso(lastReviewed, intervalMonths) <= todayIso) dueQuestionCount += 1;
    }
    const qualificationOverdue = periods >= 1;
    if (dueQuestionCount === 0 && !qualificationOverdue) continue;

    due.push({
      qualificationId: key,
      code: qual.code,
      name: qual.name,
      intervalMonths,
      anchorDate,
      periodNo: Math.max(1, periods),
      lastCompletedReviewAt,
      dueQuestionCount,
      qualificationOverdue,
      abIds: [...(abSets.get(key) ?? [])].filter((id) => activeAbs.has(id)).sort(),
    });
  }
  due.sort((a, b) => a.code.localeCompare(b.code));
  return due;
}
