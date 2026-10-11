import { AppError, duplicateResource, forbidden, notFound } from "../../lib/errors.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { Proctor } from "../../models/proctor.model.js";

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
  console.error("proctor write failed", safeErrorCode(err, "PROCTOR_WRITE_FAILED"));
  throw new AppError(500, "INTERNAL", "Internal server error");
}

function assignClearable(set, unset, key, value) {
  if (value === undefined) return;
  if (value === null) unset[key] = "";
  else set[key] = value;
}

export function presentProctor(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code ?? null,
    email: doc.email ?? null,
    qualifications: [...(doc.qualifications ?? [])],
    languages: [...(doc.languages ?? [])],
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function proctorScopeFilter(user) {
  if (READ_ALL.has(user?.role)) return {};
  if (user?.role === "proctor") {
    return user.linkedProfileId ? { _id: user.linkedProfileId } : { _id: { $in: [] } };
  }
  throw forbidden();
}

function assertInScope(user, doc) {
  const filter = proctorScopeFilter(user);
  if (filter._id && filter._id.$in) throw forbidden();
  if (filter._id && String(doc._id) !== String(filter._id)) throw forbidden();
}

export async function createProctor(body) {
  const doc = {
    name: body.name,
    qualifications: body.qualifications ?? [],
    languages: body.languages ?? [],
    active: body.active ?? true,
  };
  if (body.code) doc.code = body.code;
  if (body.email) doc.email = body.email;
  try {
    const created = await Proctor.create(doc);
    return presentProctor(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

export async function listProctors(user, query) {
  const filter = { ...proctorScopeFilter(user) };
  if (query.active !== undefined) filter.active = query.active;
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    Proctor.countDocuments(filter),
    Proctor.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map(presentProctor),
  };
}

export async function getProctor(user, id) {
  const doc = await Proctor.findById(id).lean();
  if (!doc) throw notFound();
  assertInScope(user, doc);
  return presentProctor(doc);
}

export async function updateProctor(id, body) {
  const existing = await Proctor.findById(id).lean();
  if (!existing) throw notFound();
  const set = {};
  const unset = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.qualifications !== undefined) set.qualifications = body.qualifications;
  if (body.languages !== undefined) set.languages = body.languages;
  if (body.active !== undefined) set.active = body.active;
  assignClearable(set, unset, "code", body.code);
  assignClearable(set, unset, "email", body.email);
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  try {
    const updated = await Proctor.findOneAndUpdate({ _id: existing._id }, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) throw notFound();
    return { before: presentProctor(existing), proctor: presentProctor(updated) };
  } catch (err) {
    throwWriteError(err);
  }
}

export async function deactivateProctor(id) {
  const existing = await Proctor.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await Proctor.findOneAndUpdate(
    { _id: existing._id },
    { $set: { active: false } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw notFound();
  return { before: presentProctor(existing), proctor: presentProctor(updated) };
}
