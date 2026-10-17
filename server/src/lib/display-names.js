import { Assessor } from "../models/assessor.model.js";
import { AwardingBody } from "../models/awarding-body.model.js";
import { Batch } from "../models/batch.model.js";
import { Centre } from "../models/centre.model.js";
import { Proctor } from "../models/proctor.model.js";
import { Qualification } from "../models/qualification.model.js";
import { TrainingPartner } from "../models/training-partner.model.js";
import { User } from "../models/user.model.js";

/**
 * X-11. Names to show next to ids, in one place so every screen says the same thing.
 * Only names are read: no contact details, no codes of people, no ID numbers.
 */

const idStr = (value) => (value == null ? null : String(value));

async function nameMap(Model, ids, select = "name") {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await Model.find({ _id: { $in: unique } })
    .select(select)
    .lean();
  return new Map(rows.map((row) => [String(row._id), row]));
}

/** "ELE/Q0001 Field Technician". */
export function qualificationLabel(qualification) {
  if (!qualification) return null;
  return `${qualification.code} ${qualification.name}`.trim();
}

/** "ELE/Q0001 Field Technician, 2026-10-15 to 2026-10-17". Same wording as the candidate's list. */
export function batchLabelOf(batch, qualification) {
  const qual = qualificationLabel(qualification) ?? "Batch";
  return `${qual}, ${batch.assessmentStartDate} to ${batch.assessmentEndDate}`;
}

/** The names behind one batch's ids. A missing record gives `null`; the screen then shows the id. */
export async function namesForBatch(batch) {
  const [ab, qual, tp, centre, assessor, proctor] = await Promise.all([
    nameMap(AwardingBody, [batch.abId]),
    nameMap(Qualification, [batch.qualificationId], "code name"),
    nameMap(TrainingPartner, [batch.tpId]),
    nameMap(Centre, [batch.centreId]),
    nameMap(Assessor, [batch.assessorId]),
    nameMap(Proctor, [batch.proctorId]),
  ]);
  return {
    abName: ab.get(idStr(batch.abId))?.name ?? null,
    qualificationName: qualificationLabel(qual.get(idStr(batch.qualificationId))),
    tpName: tp.get(idStr(batch.tpId))?.name ?? null,
    centreName: centre.get(idStr(batch.centreId))?.name ?? null,
    assessorName: assessor.get(idStr(batch.assessorId))?.name ?? null,
    proctorName: proctor.get(idStr(batch.proctorId))?.name ?? null,
  };
}

/** Batch id -> label, for lists that show one batch per row. */
export async function batchLabels(batchIds) {
  const batches = await nameMap(
    Batch,
    batchIds,
    "qualificationId assessmentStartDate assessmentEndDate",
  );
  const quals = await nameMap(
    Qualification,
    [...batches.values()].map((b) => b.qualificationId),
    "code name",
  );
  const out = new Map();
  for (const [id, batch] of batches) {
    out.set(id, batchLabelOf(batch, quals.get(idStr(batch.qualificationId))));
  }
  return out;
}

/** X-20. The names behind a page of batches, read in one go per collection. Same shape as namesForBatch. */
export async function namesForBatches(batches) {
  const [ab, qual, tp, centre, assessor, proctor] = await Promise.all([
    nameMap(
      AwardingBody,
      batches.map((b) => b.abId),
    ),
    nameMap(
      Qualification,
      batches.map((b) => b.qualificationId),
      "code name",
    ),
    nameMap(
      TrainingPartner,
      batches.map((b) => b.tpId),
    ),
    nameMap(
      Centre,
      batches.map((b) => b.centreId),
    ),
    nameMap(
      Assessor,
      batches.map((b) => b.assessorId),
    ),
    nameMap(
      Proctor,
      batches.map((b) => b.proctorId),
    ),
  ]);
  const out = new Map();
  for (const batch of batches) {
    out.set(idStr(batch._id), {
      abName: ab.get(idStr(batch.abId))?.name ?? null,
      qualificationName: qualificationLabel(qual.get(idStr(batch.qualificationId))),
      tpName: tp.get(idStr(batch.tpId))?.name ?? null,
      centreName: centre.get(idStr(batch.centreId))?.name ?? null,
      assessorName: assessor.get(idStr(batch.assessorId))?.name ?? null,
      proctorName: proctor.get(idStr(batch.proctorId))?.name ?? null,
    });
  }
  return out;
}

/** X-20. User id -> display name only (never the email or any other field). */
export async function userNames(userIds) {
  const users = await nameMap(User, userIds);
  return new Map([...users].map(([id, row]) => [id, row.name ?? null]));
}
