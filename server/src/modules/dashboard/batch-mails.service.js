import { notFound } from "../../lib/errors.js";
import { namesForBatches } from "../../lib/display-names.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { Assessor } from "../../models/assessor.model.js";
import { Batch } from "../../models/batch.model.js";
import { Centre } from "../../models/centre.model.js";
import { TrainingPartner } from "../../models/training-partner.model.js";
import { enqueueEmailSafely } from "../email/email-queue.service.js";
import { baseBatchFilter, batchRow } from "./dashboard.service.js";

/**
 * X-49. Notification mails for batches that are still to come. Search first, then send.
 * Past dates are never listed and never sent. The mail names the batch and the dates; it holds
 * no candidate data. The queue row keeps only batch ids, never the address, in `meta`.
 */
export const ASSESSOR_FILTERS = Object.freeze(["assigned", "unassigned"]);
export const TP_FILTERS = Object.freeze(["pending", "accepted"]);
export const MAIL_RECIPIENTS = Object.freeze(["training_partner", "centre", "assessor"]);
const PAGE_SIZE = 25;

function searchFilter(user, query, today) {
  const filter = baseBatchFilter(user, query);
  filter.assessmentStartDate = { $gte: query.from && query.from > today ? query.from : today };
  if (query.to) filter.assessmentStartDate.$lte = query.to;
  if (query.assessorStatus === "assigned") filter.assessorId = { $ne: null };
  if (query.assessorStatus === "unassigned") filter.assessorId = null;
  if (query.tpStatus === "pending") filter.status = "allocated";
  if (query.tpStatus === "accepted") {
    filter.status = { $nin: ["allocated", "cancelled", "rejected"] };
  }
  return filter;
}

export async function searchMailBatches(user, query = {}, now = new Date()) {
  const today = istCalendarDate(now);
  const filter = searchFilter(user, query, today);
  const page = query.page ?? 1;
  const [total, batches] = await Promise.all([
    Batch.countDocuments(filter),
    Batch.find(filter)
      .sort({ assessmentStartDate: 1, _id: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
  ]);
  const names = await namesForBatches(batches);
  return {
    page,
    pageSize: PAGE_SIZE,
    total,
    items: batches.map((b) => ({
      ...batchRow(b, names),
      assessorAssigned: b.assessorId != null,
      tpAccepted: b.status !== "allocated",
    })),
  };
}

function mailText(row, role) {
  const dates =
    row.assessmentStartDate === row.assessmentEndDate
      ? row.assessmentStartDate
      : `${row.assessmentStartDate} to ${row.assessmentEndDate}`;
  const lines = [
    role === "assessor"
      ? "You are scheduled to assess this batch."
      : "This is a reminder of your upcoming assessment batch.",
    "",
    `Qualification: ${row.qualification ?? "-"}`,
    `Date: ${dates}`,
    `Training centre: ${row.centreName ?? "-"}`,
    `Training partner: ${row.tpName ?? "-"}`,
    `Candidates: ${row.candidateCount}`,
  ];
  if (role !== "assessor") lines.push(`Assessor: ${row.assessorName ?? "to be assigned"}`);
  lines.push("", "Please log in to the portal for the full details.");
  return lines.join("\n");
}

/**
 * Queue one mail per batch and recipient. Returns counts and the batches that were skipped; no
 * address leaves this function.
 */
export async function sendBatchMails(user, { batchIds, recipients }, now = new Date()) {
  const today = istCalendarDate(now);
  const batches = await Batch.find({
    $and: [baseBatchFilter(user), { _id: { $in: batchIds } }],
  }).lean();
  if (batches.length === 0) throw notFound("No matching batches");
  const names = await namesForBatches(batches);
  const [tps, centres, assessors] = await Promise.all([
    TrainingPartner.find({ _id: { $in: batches.map((b) => b.tpId).filter(Boolean) } })
      .select("email")
      .lean(),
    Centre.find({ _id: { $in: batches.map((b) => b.centreId).filter(Boolean) } })
      .select("email")
      .lean(),
    Assessor.find({ _id: { $in: batches.map((b) => b.assessorId).filter(Boolean) } })
      .select("email")
      .lean(),
  ]);
  const tpEmail = new Map(tps.map((t) => [String(t._id), t.email]));
  const centreEmail = new Map(centres.map((c) => [String(c._id), c.email]));
  const assessorEmail = new Map(assessors.map((a) => [String(a._id), a.email]));

  let queued = 0;
  const skipped = [];
  const found = new Set(batches.map((b) => String(b._id)));
  for (const id of batchIds) if (!found.has(id)) skipped.push({ batchId: id, reason: "not_found" });

  for (const batch of batches) {
    const batchId = String(batch._id);
    if (batch.assessmentStartDate < today) {
      skipped.push({ batchId, reason: "past_date" });
      continue;
    }
    const row = batchRow(batch, names);
    for (const role of recipients) {
      const address =
        role === "assessor"
          ? assessorEmail.get(String(batch.assessorId))
          : role === "centre"
            ? centreEmail.get(String(batch.centreId))
            : tpEmail.get(String(batch.tpId));
      if (!address) {
        skipped.push({ batchId, reason: `no_${role}_email` });
        continue;
      }
      const result = await enqueueEmailSafely({
        to: [address],
        subject: `Assessment batch on ${row.assessmentStartDate}`,
        text: mailText(row, role),
        kind: "batch_notice",
        meta: { batchId, recipient: role },
      });
      if (result.queued) queued += 1;
      else skipped.push({ batchId, reason: "queue_failed" });
    }
  }
  return { queued, skipped };
}
