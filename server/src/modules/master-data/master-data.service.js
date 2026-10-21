import { compliance } from "../../config/compliance.js";
import { AppError, duplicateResource, forbidden, notFound } from "../../lib/errors.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { AwardingBody } from "../../models/awarding-body.model.js";
import { Centre } from "../../models/centre.model.js";
import { AccessSettings, ACCESS_SETTINGS_KEY } from "../../models/access-settings.model.js";
import { Learner } from "../../models/learner.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { TrainingPartner } from "../../models/training-partner.model.js";
import { assertQualificationPassMarks } from "./pass-marks.js";

const READ_ALL = new Set(["aa_admin", "mis", "ncvet_viewer"]);

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
    if (pattern.email || pattern.notificationEmails) {
      throw duplicateResource("A record with this email already exists");
    }
    if (pattern.code) throw duplicateResource("A record with this code already exists");
    if (pattern.externalRef) {
      throw duplicateResource("A learner with this externalRef already exists");
    }
    throw duplicateResource("Unique constraint");
  }
  console.error("master data write failed", safeErrorCode(err, "MASTER_DATA_WRITE_FAILED"));
  throw new AppError(500, "INTERNAL", "Internal server error");
}

function assignClearable(set, unset, key, value) {
  if (value === undefined) return;
  if (value === null) unset[key] = "";
  else set[key] = value;
}

function updateDoc(set, unset) {
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

/**
 * Row filter for a master-data list.
 * aa_admin, mis, and ncvet_viewer see every row.
 * ab_reviewer sees their awarding body, and every qualification (no abId on that collection).
 * tp sees their training partner and centres with that tpId.
 * candidate sees the learner identified by linkedProfileId.
 * Anyone else is forbidden. See DECISIONS.md.
 */
export function scopeFilter(user, resource) {
  if (READ_ALL.has(user?.role)) return {};

  if (resource === "awardingBody" && user?.role === "ab_reviewer") {
    return user.abId ? { _id: user.abId } : { _id: { $in: [] } };
  }
  // X-10: the question bank and paper screens need the qualification list for sme too.
  if (resource === "qualification" && (user?.role === "ab_reviewer" || user?.role === "sme")) {
    return {};
  }
  if (resource === "trainingPartner" && user?.role === "tp") {
    return user.tpId ? { _id: user.tpId } : { _id: { $in: [] } };
  }
  if (resource === "centre" && user?.role === "tp") {
    return user.tpId ? { tpId: user.tpId } : { _id: { $in: [] } };
  }
  if (resource === "learner" && user?.role === "candidate") {
    return user.linkedProfileId ? { _id: user.linkedProfileId } : { _id: { $in: [] } };
  }
  throw forbidden();
}

function assertInScope(user, resource, doc) {
  const filter = scopeFilter(user, resource);
  if (filter._id && filter._id.$in) throw forbidden();
  if (filter._id && String(doc._id) !== String(filter._id)) throw forbidden();
  if (filter.tpId && String(doc.tpId) !== String(filter.tpId)) throw forbidden();
}

async function paginate(model, filter, query, present) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    model.countDocuments(filter),
    model.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map(present),
  };
}

async function applyUpdate(model, id, update) {
  try {
    const updated = await model
      .findOneAndUpdate({ _id: id }, update, { new: true, runValidators: true })
      .lean();
    if (!updated) throw notFound();
    return updated;
  } catch (err) {
    throwWriteError(err);
  }
}

function presentAwardingBody(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code ?? null,
    notificationEmails: [...(doc.notificationEmails ?? [])],
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentTrainingPartner(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code ?? null,
    email: doc.email ?? null,
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentCentre(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code ?? null,
    tpId: idOf(doc.tpId),
    state: doc.state,
    email: doc.email ?? null,
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentComponent(value) {
  if (value == null) return null;
  return {
    theory: value.theory ?? null,
    practical: value.practical ?? null,
    viva: value.viva ?? null,
  };
}

function presentPc(pc) {
  return {
    pcId: pc.pcId,
    code: pc.code,
    name: pc.name,
    passMark: pc.passMark ?? null,
    maxMark: pc.maxMark ?? null,
  };
}

function presentNos(item) {
  return {
    nosId: item.nosId,
    code: item.code,
    name: item.name,
    maxMarks: presentComponent(item.maxMarks),
    pcs: (item.pcs ?? []).map(presentPc),
  };
}

function presentQualification(doc) {
  return {
    id: idOf(doc._id),
    code: doc.code,
    name: doc.name,
    sector: doc.sector,
    ratioClass: doc.ratioClass,
    defaultBatchType: doc.defaultBatchType ?? null,
    passCriteriaMode: doc.passCriteriaMode ?? null,
    passMarkUnit: doc.passMarkUnit,
    passMarks: {
      theory: doc.passMarks.theory,
      practical: doc.passMarks.practical,
      viva: doc.passMarks.viva,
    },
    maxMarks: presentComponent(doc.maxMarks),
    nos: (doc.nos ?? []).map(presentNos),
    pcPassMarksRequired: Boolean(doc.pcPassMarksRequired),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

/** Last four digits only. The full number never leaves the server. */
function maskAadhaar(value) {
  return value ? `XXXXXXXX${String(value).slice(-4)}` : null;
}

/** Roles that may see all twelve digits when the setting is "full". */
const AADHAAR_FULL_ROLES = ["aa_admin", "mis"];

/** hidden, masked or full for this viewer, from the access setting (X-47). */
export async function aadhaarModeFor(user) {
  const setting = await AccessSettings.findOne({ key: ACCESS_SETTINGS_KEY })
    .select("aadhaarVisibility")
    .lean();
  const visibility = setting?.aadhaarVisibility ?? "masked";
  if (visibility === "hidden") return "hidden";
  if (visibility === "full" && AADHAAR_FULL_ROLES.includes(user?.role)) return "full";
  return "masked";
}

function presentLearner(doc, mode = "masked") {
  const hasAadhaar = Boolean(doc.aadhaar);
  const shown = hasAadhaar && mode === "full" ? { aadhaar: String(doc.aadhaar) } : {};
  return {
    id: idOf(doc._id),
    name: doc.name,
    externalRef: doc.externalRef ?? null,
    phone: doc.phone ?? null,
    enrolmentNumber: doc.enrolmentNumber ?? null,
    fatherName: doc.fatherName ?? null,
    gender: doc.gender ?? null,
    address: doc.address ?? null,
    hasAadhaar,
    aadhaarMasked: mode === "hidden" ? null : maskAadhaar(doc.aadhaar),
    ...shown,
    accommodations: [...(doc.accommodations ?? [])],
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function withOptionalCode(doc, body) {
  if (body.code) doc.code = body.code;
  return doc;
}

export async function createAwardingBody(body) {
  const doc = withOptionalCode(
    {
      name: body.name,
      notificationEmails: body.notificationEmails,
      active: body.active ?? true,
    },
    body,
  );
  try {
    const created = await AwardingBody.create(doc);
    return presentAwardingBody(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listAwardingBodies(user, query) {
  const filter = { ...scopeFilter(user, "awardingBody") };
  if (query.active !== undefined) filter.active = query.active;
  return paginate(AwardingBody, filter, query, presentAwardingBody);
}

export async function getAwardingBody(user, id) {
  const doc = await AwardingBody.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, "awardingBody", doc);
  return presentAwardingBody(doc);
}

export async function updateAwardingBody(id, body) {
  const existing = await AwardingBody.findById(id).lean();
  if (!existing) throw notFound();
  const set = {};
  const unset = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.notificationEmails !== undefined) set.notificationEmails = body.notificationEmails;
  if (body.active !== undefined) set.active = body.active;
  assignClearable(set, unset, "code", body.code);
  const updated = await applyUpdate(AwardingBody, existing._id, updateDoc(set, unset));
  return { before: presentAwardingBody(existing), awardingBody: presentAwardingBody(updated) };
}

export async function deactivateAwardingBody(id) {
  const existing = await AwardingBody.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await applyUpdate(AwardingBody, existing._id, { $set: { active: false } });
  return { before: presentAwardingBody(existing), awardingBody: presentAwardingBody(updated) };
}

export async function createTrainingPartner(body) {
  const doc = withOptionalCode({ name: body.name, active: body.active ?? true }, body);
  if (body.email) doc.email = body.email;
  try {
    const created = await TrainingPartner.create(doc);
    return presentTrainingPartner(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listTrainingPartners(user, query) {
  const filter = { ...scopeFilter(user, "trainingPartner") };
  if (query.active !== undefined) filter.active = query.active;
  return paginate(TrainingPartner, filter, query, presentTrainingPartner);
}

export async function getTrainingPartner(user, id) {
  const doc = await TrainingPartner.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, "trainingPartner", doc);
  return presentTrainingPartner(doc);
}

export async function updateTrainingPartner(id, body) {
  const existing = await TrainingPartner.findById(id).lean();
  if (!existing) throw notFound();
  const set = {};
  const unset = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.active !== undefined) set.active = body.active;
  assignClearable(set, unset, "code", body.code);
  assignClearable(set, unset, "email", body.email);
  const updated = await applyUpdate(TrainingPartner, existing._id, updateDoc(set, unset));
  return {
    before: presentTrainingPartner(existing),
    trainingPartner: presentTrainingPartner(updated),
  };
}

export async function deactivateTrainingPartner(id) {
  const existing = await TrainingPartner.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await applyUpdate(TrainingPartner, existing._id, { $set: { active: false } });
  return {
    before: presentTrainingPartner(existing),
    trainingPartner: presentTrainingPartner(updated),
  };
}

async function assertTrainingPartnerExists(tpId) {
  const tp = await TrainingPartner.findById(tpId).select("_id").lean();
  if (!tp) throw new AppError(400, "VALIDATION_ERROR", "Training partner not found");
}

export async function createCentre(body) {
  await assertTrainingPartnerExists(body.tpId);
  const doc = withOptionalCode(
    { name: body.name, tpId: body.tpId, state: body.state, active: body.active ?? true },
    body,
  );
  if (body.email) doc.email = body.email;
  try {
    const created = await Centre.create(doc);
    return presentCentre(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listCentres(user, query) {
  const filter = { ...scopeFilter(user, "centre") };
  if (query.active !== undefined) filter.active = query.active;
  if (query.tpId && READ_ALL.has(user.role)) filter.tpId = query.tpId;
  return paginate(Centre, filter, query, presentCentre);
}

export async function getCentre(user, id) {
  const doc = await Centre.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, "centre", doc);
  return presentCentre(doc);
}

export async function updateCentre(id, body) {
  const existing = await Centre.findById(id).lean();
  if (!existing) throw notFound();
  if (body.tpId) await assertTrainingPartnerExists(body.tpId);
  const set = {};
  const unset = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.tpId !== undefined) set.tpId = body.tpId;
  if (body.state !== undefined) set.state = body.state;
  if (body.active !== undefined) set.active = body.active;
  assignClearable(set, unset, "code", body.code);
  assignClearable(set, unset, "email", body.email);
  const updated = await applyUpdate(Centre, existing._id, updateDoc(set, unset));
  return { before: presentCentre(existing), centre: presentCentre(updated) };
}

export async function deactivateCentre(id) {
  const existing = await Centre.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await applyUpdate(Centre, existing._id, { $set: { active: false } });
  return { before: presentCentre(existing), centre: presentCentre(updated) };
}

function qualificationDraft(body, defaults = {}) {
  return {
    code: body.code ?? defaults.code,
    name: body.name ?? defaults.name,
    sector: body.sector ?? defaults.sector,
    ratioClass: body.ratioClass ?? defaults.ratioClass,
    defaultBatchType:
      body.defaultBatchType === undefined
        ? (defaults.defaultBatchType ?? null)
        : body.defaultBatchType,
    passCriteriaMode:
      body.passCriteriaMode === undefined
        ? (defaults.passCriteriaMode ?? null)
        : body.passCriteriaMode,
    passMarkUnit: body.passMarkUnit ?? defaults.passMarkUnit ?? compliance.DEFAULT_PASS_MARK_UNIT,
    passMarks: body.passMarks ?? defaults.passMarks,
    maxMarks: body.maxMarks === undefined ? (defaults.maxMarks ?? null) : body.maxMarks,
    nos: body.nos ?? defaults.nos ?? [],
    pcPassMarksRequired: body.pcPassMarksRequired ?? defaults.pcPassMarksRequired ?? false,
  };
}

function qualificationWrite(draft) {
  const doc = {
    code: draft.code,
    name: draft.name,
    sector: draft.sector,
    ratioClass: draft.ratioClass,
    passMarkUnit: draft.passMarkUnit,
    passMarks: draft.passMarks,
    maxMarks: draft.maxMarks,
    nos: draft.nos,
    pcPassMarksRequired: draft.pcPassMarksRequired,
  };
  if (draft.defaultBatchType) doc.defaultBatchType = draft.defaultBatchType;
  if (draft.passCriteriaMode) doc.passCriteriaMode = draft.passCriteriaMode;
  return doc;
}

export async function createQualification(body) {
  const draft = qualificationDraft(body);
  assertQualificationPassMarks(draft);
  const doc = qualificationWrite(draft);
  try {
    const created = await Qualification.create(doc);
    return presentQualification(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listQualifications(user, query) {
  const filter = { ...scopeFilter(user, "qualification") };
  if (query.sector) filter.sector = query.sector;
  return paginate(Qualification, filter, query, presentQualification);
}

export async function getQualification(user, id) {
  const doc = await Qualification.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, "qualification", doc);
  return presentQualification(doc);
}

export async function updateQualification(id, body) {
  const existing = await Qualification.findById(id).lean();
  if (!existing) throw notFound();
  const draft = qualificationDraft(body, existing);
  assertQualificationPassMarks(draft);
  const set = qualificationWrite(draft);
  const unset = {};
  if (!draft.defaultBatchType) unset.defaultBatchType = "";
  if (!draft.passCriteriaMode) unset.passCriteriaMode = "";
  const updated = await applyUpdate(Qualification, existing._id, updateDoc(set, unset));
  return { before: presentQualification(existing), qualification: presentQualification(updated) };
}

export async function deleteQualification(id) {
  const existing = await Qualification.findById(id).lean();
  if (!existing) throw notFound();
  await Qualification.deleteOne({ _id: existing._id });
  return presentQualification(existing);
}

export async function createLearner(body, viewer) {
  const doc = {
    name: body.name,
    accommodations: body.accommodations ?? [],
    active: body.active ?? true,
  };
  if (body.externalRef) doc.externalRef = body.externalRef;
  if (body.phone) doc.phone = body.phone;
  for (const key of ["enrolmentNumber", "fatherName", "gender", "address", "aadhaar"]) {
    if (body[key]) doc[key] = body[key];
  }
  try {
    const created = await Learner.create(doc);
    return presentLearner(created.toObject(), await aadhaarModeFor(viewer));
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listLearners(user, query) {
  const filter = { ...scopeFilter(user, "learner") };
  if (query.active !== undefined) filter.active = query.active;
  const mode = await aadhaarModeFor(user);
  return paginate(Learner, filter, query, (doc) => presentLearner(doc, mode));
}

export async function getLearner(user, id) {
  const doc = await Learner.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, "learner", doc);
  return presentLearner(doc, await aadhaarModeFor(user));
}

export async function updateLearner(id, body, viewer) {
  const existing = await Learner.findById(id).lean();
  if (!existing) throw notFound();
  const set = {};
  const unset = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.accommodations !== undefined) set.accommodations = body.accommodations;
  if (body.active !== undefined) set.active = body.active;
  assignClearable(set, unset, "externalRef", body.externalRef);
  assignClearable(set, unset, "phone", body.phone);
  for (const key of ["enrolmentNumber", "fatherName", "gender", "address", "aadhaar"]) {
    assignClearable(set, unset, key, body[key]);
  }
  const updated = await applyUpdate(Learner, existing._id, updateDoc(set, unset));
  const mode = await aadhaarModeFor(viewer);
  return { before: presentLearner(existing, mode), learner: presentLearner(updated, mode) };
}
