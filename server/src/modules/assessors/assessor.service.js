import { AppError, duplicateResource, forbidden, notFound } from "../../lib/errors.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { Assessor } from "../../models/assessor.model.js";
import { AssessorDayLock } from "../../models/assessor-day-lock.model.js";
import { Batch } from "../../models/batch.model.js";
import { toaCoversRange, languageMatches, civilDateRange } from "../batches/assign-rules.js";

const READ_ALL = new Set(["aa_admin", "mis", "ncvet_viewer", "ab_reviewer"]);

function iso(value) {
  return new Date(value).toISOString();
}

function idOf(value) {
  if (value == null || value === "") return null;
  return value.toString();
}

function throwWriteError(err) {
  if (err instanceof AppError) throw err;
  if (err?.code === 11000) {
    const pattern = err.keyPattern ?? {};
    if (pattern.email) throw duplicateResource("A record with this email already exists");
    if (pattern.code) throw duplicateResource("A record with this code already exists");
    throw duplicateResource("Unique constraint");
  }
  console.error("assessor write failed", safeErrorCode(err, "ASSESSOR_WRITE_FAILED"));
  throw new AppError(500, "INTERNAL", "Internal server error");
}

function assignClearable(set, unset, key, value) {
  if (value === undefined) return;
  if (value === null) unset[key] = "";
  else set[key] = value;
}

export function presentAssessor(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code ?? null,
    email: doc.email ?? null,
    qualifications: [...(doc.qualifications ?? [])],
    yearsOfExperience: doc.yearsOfExperience ?? null,
    languages: [...(doc.languages ?? [])],
    toa: doc.toa
      ? {
          certNo: doc.toa.certNo,
          issuedOn: doc.toa.issuedOn,
          expiresOn: doc.toa.expiresOn,
        }
      : null,
    otherAaCount: doc.otherAaCount,
    undertaking: doc.undertaking,
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

/**
 * aa_admin / mis / ncvet_viewer / ab_reviewer see every assessor.
 * An assessor sees only linkedProfileId. Anyone else is forbidden.
 */
export function assessorScopeFilter(user) {
  if (READ_ALL.has(user?.role)) return {};
  if (user?.role === "assessor") {
    return user.linkedProfileId ? { _id: user.linkedProfileId } : { _id: { $in: [] } };
  }
  throw forbidden();
}

function assertInScope(user, doc) {
  const filter = assessorScopeFilter(user);
  if (filter._id && filter._id.$in) throw forbidden();
  if (filter._id && String(doc._id) !== String(filter._id)) throw forbidden();
}

export async function createAssessor(body) {
  const doc = {
    name: body.name,
    qualifications: body.qualifications ?? [],
    languages: body.languages ?? [],
    otherAaCount: body.otherAaCount ?? 0,
    undertaking: body.undertaking ?? false,
    active: body.active ?? true,
  };
  if (body.code) doc.code = body.code;
  if (body.email) doc.email = body.email;
  if (body.yearsOfExperience !== undefined) doc.yearsOfExperience = body.yearsOfExperience;
  if (body.toa !== undefined) doc.toa = body.toa;
  try {
    const created = await Assessor.create(doc);
    return presentAssessor(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listAssessors(user, query) {
  const filter = { ...assessorScopeFilter(user) };
  if (query.active !== undefined) filter.active = query.active;
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    Assessor.countDocuments(filter),
    Assessor.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map(presentAssessor),
  };
}

export async function getAssessor(user, id) {
  const doc = await Assessor.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, doc);
  return presentAssessor(doc);
}

export async function updateAssessor(id, body) {
  const existing = await Assessor.findById(id).lean();
  if (!existing) throw notFound();
  const set = {};
  const unset = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.qualifications !== undefined) set.qualifications = body.qualifications;
  if (body.languages !== undefined) set.languages = body.languages;
  if (body.otherAaCount !== undefined) set.otherAaCount = body.otherAaCount;
  if (body.undertaking !== undefined) set.undertaking = body.undertaking;
  if (body.active !== undefined) set.active = body.active;
  assignClearable(set, unset, "code", body.code);
  assignClearable(set, unset, "email", body.email);
  assignClearable(set, unset, "yearsOfExperience", body.yearsOfExperience);
  assignClearable(set, unset, "toa", body.toa);
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  try {
    const updated = await Assessor.findOneAndUpdate({ _id: existing._id }, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) throw notFound();
    return { before: presentAssessor(existing), assessor: presentAssessor(updated) };
  } catch (err) {
    throwWriteError(err);
  }
}

export async function deactivateAssessor(id) {
  const existing = await Assessor.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await Assessor.findOneAndUpdate(
    { _id: existing._id },
    { $set: { active: false } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw notFound();
  return { before: presentAssessor(existing), assessor: presentAssessor(updated) };
}

/**
 * Active assessors who can take a window. Clash against batchId (if given)
 * uses assessorDayLocks at a different centre.
 */
export async function listAvailableAssessors(query) {
  const window = await resolveAvailabilityWindow(query);
  const filter = { active: true };
  const docs = await Assessor.find(filter).sort({ name: 1, _id: 1 }).lean();
  const items = [];
  for (const doc of docs) {
    if (window && !toaCoversRange(doc.toa, window.from, window.to)) continue;
    if (query.languages?.length) {
      const missing = query.languages.some((lang) => !languageMatches(doc.languages, lang));
      if (missing) continue;
    }
    if (window?.centreId) {
      const dates = civilDateRange(window.from, window.to);
      const clash = await AssessorDayLock.exists({
        assessorId: doc._id,
        istDate: { $in: dates },
        centreId: { $ne: window.centreId },
      });
      if (clash) continue;
    }
    items.push(presentAssessor(doc));
  }
  return { items };
}

async function resolveAvailabilityWindow(query) {
  let from = query.from;
  let to = query.to;
  let centreId = null;
  if (query.batchId) {
    const batch = await Batch.findById(query.batchId).lean();
    if (!batch) throw notFound();
    from = from ?? batch.assessmentStartDate;
    to = to ?? batch.assessmentEndDate;
    centreId = batch.centreId;
  }
  if (!from || !to) return centreId ? { from, to, centreId } : null;
  return { from, to, centreId };
}
