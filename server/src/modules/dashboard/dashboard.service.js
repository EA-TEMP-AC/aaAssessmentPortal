import { namesForBatches } from "../../lib/display-names.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { batchQueryFilter } from "../../middleware/scope.js";
import { Attempt } from "../../models/attempt.model.js";
import { Batch } from "../../models/batch.model.js";
import { addDaysIso } from "./dates.js";

/**
 * X-49. Home dashboard for the agency. Counts and short batch rows only: no candidate names,
 * no contact details. Scope: the caller's batch rows.
 */
const NOT_RUNNING = ["cancelled", "rejected"];
/** An attempt that began longer ago than this is not "writing now" any more. */
const WRITING_WINDOW_MS = 6 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 50;

/** Filter shared by the dashboard and the mail search: scope, sector, one batch id. */
export function baseBatchFilter(user, { sector, batchId } = {}) {
  const filter = { ...batchQueryFilter(user), status: { $nin: NOT_RUNNING } };
  if (sector) filter.sector = sector;
  if (batchId) {
    if (filter._id) filter.$and = [{ _id: batchId }];
    else filter._id = batchId;
  }
  return filter;
}

export function batchRow(batch, names) {
  const n = names.get(String(batch._id)) ?? {};
  return {
    id: String(batch._id),
    qualification: n.qualificationName ?? null,
    sector: batch.sector,
    status: batch.status,
    assessmentStartDate: batch.assessmentStartDate,
    assessmentEndDate: batch.assessmentEndDate,
    candidateCount: batch.candidateCount,
    tpName: n.tpName ?? null,
    centreName: n.centreName ?? null,
    assessorName: n.assessorName ?? null,
  };
}

export async function dashboardSummary(user, query = {}, now = new Date()) {
  const today = istCalendarDate(now);
  const from = query.from ?? today;
  const to = query.to ?? from;
  const base = baseBatchFilter(user, query);

  const inRange = await Batch.find({
    ...base,
    assessmentStartDate: { $lte: to },
    assessmentEndDate: { $gte: from },
  })
    .select("assessorId")
    .lean();

  const runningToday = await Batch.find({
    ...base,
    assessmentStartDate: { $lte: today },
    assessmentEndDate: { $gte: today },
  })
    .select("_id")
    .lean();
  const writingIds = await Attempt.distinct("candidateId", {
    batchId: { $in: runningToday.map((b) => b._id) },
    status: "in_progress",
    startedAt: { $gte: new Date(now.getTime() - WRITING_WINDOW_MS) },
  });

  const upcoming = await Batch.find({
    ...base,
    assessmentStartDate: { $gte: addDaysIso(today, 1), $lte: addDaysIso(today, 7) },
  })
    .sort({ assessmentStartDate: 1, _id: 1 })
    .limit(UPCOMING_LIMIT)
    .lean();
  const names = await namesForBatches(upcoming);

  return {
    today,
    from,
    to,
    batchesScheduled: inRange.length,
    assessorsScheduled: new Set(
      inRange.filter((b) => b.assessorId).map((b) => String(b.assessorId)),
    ).size,
    writingNow: writingIds.length,
    nextSevenDays: upcoming.map((b) => batchRow(b, names)),
  };
}
