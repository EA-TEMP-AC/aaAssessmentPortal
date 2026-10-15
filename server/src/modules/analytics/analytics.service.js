import mongoose from "mongoose";
import { forbidden } from "../../lib/errors.js";
import { Assessor } from "../../models/assessor.model.js";
import { Batch } from "../../models/batch.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { Result } from "../../models/result.model.js";
import { TrainingPartner } from "../../models/training-partner.model.js";
import { BATCH_STATUSES } from "../batches/batch-transitions.js";

/**
 * Read-only analytics. docs/SCHEMA.md §3.8a and API_CONTRACT "Analytics".
 *
 * A batch is in range when its `assessmentStartDate` (an IST calendar date) is between `from` and
 * `to`, both inclusive. Pass rates, learners assessed and turnaround use published results only.
 * Nothing returned names or identifies a learner: counts and rates only.
 */

const IST = "Asia/Kolkata";
const DAY_MS = 86_400_000;

/** `field` forms the group; `lookup` names the collection that supplies a display name. */
const DIMENSIONS = {
  assessor: { field: "$assessorId", requireKey: true, lookup: Assessor.collection.name },
  "training-partner": { field: "$tpId", lookup: TrainingPartner.collection.name },
  "job-role": { field: "$qualificationId", lookup: Qualification.collection.name },
  state: { field: "$state", lookup: null },
};

function scopeMatch(user, from, to) {
  const match = { assessmentStartDate: { $gte: from, $lte: to } };
  if (user.role === "ab_reviewer") {
    if (!user.abId) throw forbidden();
    match.abId = new mongoose.Types.ObjectId(String(user.abId));
  }
  return match;
}

/** One document per batch in range, with the published result counts folded in. */
function perBatchStages(match) {
  const rows = { $ifNull: [{ $first: "$pub.rows" }, []] };
  const count = (cond) => ({ $size: { $filter: { input: rows, as: "r", cond } } });
  const isAbsent = { $or: [{ $eq: ["$$r.absent", true] }, { $eq: ["$$r.outcome", "Absent"] }] };
  return [
    { $match: match },
    {
      $lookup: {
        from: Result.collection.name,
        localField: "_id",
        foreignField: "batchId",
        pipeline: [
          { $match: { status: "published" } },
          { $project: { submittedAt: 1, "rows.outcome": 1, "rows.absent": 1 } },
        ],
        as: "pub",
      },
    },
    {
      $addFields: {
        published: { $gt: [{ $size: "$pub" }, 0] },
        passed: count({ $and: [{ $not: [isAbsent] }, { $eq: ["$$r.outcome", "Pass"] }] }),
        failed: count({ $and: [{ $not: [isAbsent] }, { $eq: ["$$r.outcome", "Fail"] }] }),
        absent: count(isAbsent),
        submittedAt: { $first: "$pub.submittedAt" },
        breaches: { $size: { $ifNull: ["$sla.breached", []] } },
        resultLate: { $in: ["result", { $ifNull: ["$sla.breached", []] }] },
      },
    },
    {
      // Days from the end of the last assessment day (IST) to result submission, never below 0.
      $addFields: {
        turnaround: {
          $cond: [
            { $and: ["$published", { $ne: [{ $type: "$submittedAt" }, "missing"] }] },
            {
              $max: [
                0,
                {
                  $divide: [
                    {
                      $subtract: [
                        "$submittedAt",
                        {
                          $add: [
                            {
                              $dateFromString: { dateString: "$assessmentEndDate", timezone: IST },
                            },
                            DAY_MS,
                          ],
                        },
                      ],
                    },
                    DAY_MS,
                  ],
                },
              ],
            },
            "$$REMOVE",
          ],
        },
      },
    },
  ];
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function presentGroup(row, names) {
  const decided = row.passed + row.failed;
  const named = names.get(String(row._id));
  return {
    id: String(row._id),
    name: named?.name ?? (typeof row._id === "string" ? row._id : null),
    code: named?.code ?? null,
    batches: row.batches,
    publishedBatches: row.publishedBatches,
    learnersAssessed: decided,
    passed: row.passed,
    failed: row.failed,
    absent: row.absent,
    passRate: decided > 0 ? round(row.passed / decided, 4) : null,
    avgTurnaroundDays: row.turnCount > 0 ? round(row.turnSum / row.turnCount, 2) : null,
    slaBreaches: row.slaBreaches,
  };
}

export async function analyticsByDimension(user, dimension, query) {
  const spec = DIMENSIONS[dimension];
  const match = scopeMatch(user, query.from, query.to);
  if (spec.requireKey) match.assessorId = { $ne: null };
  const skip = (query.page - 1) * query.pageSize;

  const [out] = await Batch.aggregate([
    ...perBatchStages(match),
    {
      $group: {
        _id: spec.field,
        batches: { $sum: 1 },
        publishedBatches: { $sum: { $cond: ["$published", 1, 0] } },
        passed: { $sum: "$passed" },
        failed: { $sum: "$failed" },
        absent: { $sum: "$absent" },
        slaBreaches: { $sum: "$breaches" },
        turnSum: { $sum: { $ifNull: ["$turnaround", 0] } },
        turnCount: { $sum: { $cond: [{ $gt: ["$turnaround", null] }, 1, 0] } },
      },
    },
    {
      $facet: {
        items: [{ $sort: { batches: -1, _id: 1 } }, { $skip: skip }, { $limit: query.pageSize }],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const names = new Map();
  if (spec.lookup && out.items.length > 0) {
    const docs = await mongoose.connection.db
      .collection(spec.lookup)
      .find({ _id: { $in: out.items.map((row) => row._id) } })
      .project({ name: 1, code: 1 })
      .toArray();
    for (const doc of docs) names.set(String(doc._id), { name: doc.name, code: doc.code ?? null });
  }

  return {
    from: query.from,
    to: query.to,
    page: query.page,
    pageSize: query.pageSize,
    total: out.total[0]?.n ?? 0,
    items: out.items.map((row) => presentGroup(row, names)),
  };
}

export async function analyticsSummary(user, query) {
  const match = scopeMatch(user, query.from, query.to);
  const [row] = await Batch.aggregate([
    ...perBatchStages(match),
    {
      $group: {
        _id: null,
        statuses: { $push: "$status" },
        batches: { $sum: 1 },
        publishedResults: { $sum: { $cond: ["$published", 1, 0] } },
        late: { $sum: { $cond: [{ $and: ["$published", "$resultLate"] }, 1, 0] } },
        passed: { $sum: "$passed" },
        failed: { $sum: "$failed" },
        slaBreaches: { $sum: "$breaches" },
      },
    },
  ]);

  const byStatus = Object.fromEntries(BATCH_STATUSES.map((status) => [status, 0]));
  for (const status of row?.statuses ?? []) byStatus[status] = (byStatus[status] ?? 0) + 1;
  const decided = (row?.passed ?? 0) + (row?.failed ?? 0);
  const published = row?.publishedResults ?? 0;
  const late = row?.late ?? 0;

  return {
    from: query.from,
    to: query.to,
    batches: { total: row?.batches ?? 0, byStatus },
    publishedResults: { total: published, onTime: published - late, late },
    learnersAssessed: decided,
    passRate: decided > 0 ? round(row.passed / decided, 4) : null,
    slaBreaches: row?.slaBreaches ?? 0,
  };
}
