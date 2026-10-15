import { AppError, duplicateResource, notFound, validationError } from "../../lib/errors.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { Project } from "../../models/project.model.js";
import { Scheme } from "../../models/scheme.model.js";
import { Signatory } from "../../models/signatory.model.js";
import { signatoryScopeIssues } from "./schemes.schemas.js";

function iso(value) {
  return new Date(value).toISOString();
}

function idOf(value) {
  if (value == null || value === "") return null;
  return value.toString();
}

function throwWriteError(err) {
  if (err instanceof AppError) throw err;
  if (err?.code === 11000) throw duplicateResource("A record with this code already exists");
  console.error("scheme master write failed", safeErrorCode(err, "SCHEME_WRITE_FAILED"));
  throw new AppError(500, "INTERNAL", "Internal server error");
}

function presentScheme(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code,
    fundingBody: doc.fundingBody,
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentProject(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    code: doc.code,
    schemeId: idOf(doc.schemeId),
    startDate: doc.startDate,
    endDate: doc.endDate ?? null,
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentSignatory(doc) {
  return {
    id: idOf(doc._id),
    name: doc.name,
    designation: doc.designation,
    scope: doc.scope,
    schemeId: idOf(doc.schemeId),
    projectId: idOf(doc.projectId),
    validFrom: doc.validFrom,
    validTo: doc.validTo ?? null,
    active: doc.active,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

async function paginate(model, filter, query, present) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    model.countDocuments(filter),
    model.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  return { page: query.page, pageSize: query.pageSize, total, items: docs.map(present) };
}

async function applyUpdate(model, id, set) {
  try {
    const updated = await model
      .findOneAndUpdate({ _id: id }, { $set: set }, { new: true, runValidators: true })
      .lean();
    if (!updated) throw notFound();
    return updated;
  } catch (err) {
    throwWriteError(err);
  }
}

async function create(model, doc, present) {
  try {
    const created = await model.create(doc);
    return present(created.toObject());
  } catch (err) {
    throwWriteError(err);
  }
}

/** Only the keys the caller sent. */
function pick(body, keys) {
  const out = {};
  for (const key of keys) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

async function activeScheme(schemeId, field = "schemeId") {
  const scheme = await Scheme.findById(schemeId).select("active").lean();
  if (!scheme) throw validationError("Unknown reference", { [field]: ["Does not exist"] });
  if (!scheme.active) throw validationError("Inactive reference", { [field]: ["Is not active"] });
  return scheme;
}

async function activeProject(projectId, field = "projectId") {
  const project = await Project.findById(projectId).select("active schemeId").lean();
  if (!project) throw validationError("Unknown reference", { [field]: ["Does not exist"] });
  if (!project.active) throw validationError("Inactive reference", { [field]: ["Is not active"] });
  return project;
}

/** Schemes. */

export async function createScheme(body) {
  return create(
    Scheme,
    { ...pick(body, ["name", "code", "fundingBody"]), active: body.active ?? true },
    presentScheme,
  );
}

export async function listSchemes(query) {
  const filter = {};
  if (query.active !== undefined) filter.active = query.active;
  return paginate(Scheme, filter, query, presentScheme);
}

export async function getScheme(id) {
  const doc = await Scheme.findById(id).lean();
  if (!doc) throw notFound();
  return presentScheme(doc);
}

export async function updateScheme(id, body) {
  const existing = await Scheme.findById(id).lean();
  if (!existing) throw notFound();
  const updated = await applyUpdate(
    Scheme,
    existing._id,
    pick(body, ["name", "code", "fundingBody", "active"]),
  );
  return { before: presentScheme(existing), scheme: presentScheme(updated) };
}

export async function deactivateScheme(id) {
  return updateScheme(id, { active: false });
}

/** Projects. */

export async function createProject(body) {
  await activeScheme(body.schemeId);
  return create(
    Project,
    {
      ...pick(body, ["name", "code", "schemeId", "startDate"]),
      endDate: body.endDate ?? null,
      active: body.active ?? true,
    },
    presentProject,
  );
}

export async function listProjects(query) {
  const filter = {};
  if (query.active !== undefined) filter.active = query.active;
  if (query.schemeId) filter.schemeId = query.schemeId;
  return paginate(Project, filter, query, presentProject);
}

export async function getProject(id) {
  const doc = await Project.findById(id).lean();
  if (!doc) throw notFound();
  return presentProject(doc);
}

export async function updateProject(id, body) {
  const existing = await Project.findById(id).lean();
  if (!existing) throw notFound();
  const startDate = body.startDate ?? existing.startDate;
  const endDate = body.endDate === undefined ? existing.endDate : body.endDate;
  if (endDate && endDate < startDate) {
    throw validationError("Request validation failed", {
      endDate: ["endDate must be on or after startDate"],
    });
  }
  if (body.schemeId && body.schemeId !== String(existing.schemeId)) {
    await activeScheme(body.schemeId);
  }
  const updated = await applyUpdate(
    Project,
    existing._id,
    pick(body, ["name", "code", "schemeId", "startDate", "endDate", "active"]),
  );
  return { before: presentProject(existing), project: presentProject(updated) };
}

export async function deactivateProject(id) {
  return updateProject(id, { active: false });
}

/** Authorised signatories. */

async function assertSignatoryRefs(row, previous) {
  if (row.schemeId && String(row.schemeId) !== String(previous?.schemeId ?? "")) {
    await activeScheme(row.schemeId);
  }
  if (row.projectId && String(row.projectId) !== String(previous?.projectId ?? "")) {
    await activeProject(row.projectId);
  }
}

export async function createSignatory(body) {
  await assertSignatoryRefs(body, null);
  return create(
    Signatory,
    {
      ...pick(body, ["name", "designation", "scope", "validFrom"]),
      schemeId: body.schemeId ?? null,
      projectId: body.projectId ?? null,
      validTo: body.validTo ?? null,
      active: body.active ?? true,
    },
    presentSignatory,
  );
}

export async function listSignatories(query) {
  const filter = {};
  if (query.active !== undefined) filter.active = query.active;
  if (query.scope) filter.scope = query.scope;
  if (query.schemeId) filter.schemeId = query.schemeId;
  if (query.projectId) filter.projectId = query.projectId;
  return paginate(Signatory, filter, query, presentSignatory);
}

export async function getSignatory(id) {
  const doc = await Signatory.findById(id).lean();
  if (!doc) throw notFound();
  return presentSignatory(doc);
}

export async function updateSignatory(id, body) {
  const existing = await Signatory.findById(id).lean();
  if (!existing) throw notFound();
  const merged = {
    scope: body.scope ?? existing.scope,
    schemeId: body.schemeId === undefined ? existing.schemeId : body.schemeId,
    projectId: body.projectId === undefined ? existing.projectId : body.projectId,
    validFrom: body.validFrom ?? existing.validFrom,
    validTo: body.validTo === undefined ? existing.validTo : body.validTo,
  };
  const details = {};
  for (const issue of signatoryScopeIssues(merged)) details[issue.path] = [issue.message];
  if (merged.validTo && merged.validTo < merged.validFrom) {
    details.validTo = ["validTo must be on or after validFrom"];
  }
  if (Object.keys(details).length > 0) throw validationError("Request validation failed", details);
  await assertSignatoryRefs(merged, existing);
  const updated = await applyUpdate(Signatory, existing._id, {
    ...pick(body, ["name", "designation", "active"]),
    scope: merged.scope,
    schemeId: merged.schemeId ?? null,
    projectId: merged.projectId ?? null,
    validFrom: merged.validFrom,
    validTo: merged.validTo ?? null,
  });
  return { before: presentSignatory(existing), signatory: presentSignatory(updated) };
}

export async function deactivateSignatory(id) {
  return updateSignatory(id, { active: false });
}

/**
 * Batch links (H-01). Both ids are optional. Each must exist and be active, and a project
 * must belong to the given scheme. A project without a scheme gets the project's scheme.
 * @returns {Promise<{ schemeId: string|null, projectId: string|null }>}
 */
export async function resolveBatchLinks({ schemeId, projectId }) {
  if (!schemeId && !projectId) return { schemeId: null, projectId: null };
  if (schemeId) await activeScheme(schemeId);
  if (!projectId) return { schemeId, projectId: null };
  const project = await activeProject(projectId);
  if (schemeId && String(project.schemeId) !== String(schemeId)) {
    throw validationError("Unknown or inconsistent reference", {
      projectId: ["Project does not belong to this scheme"],
    });
  }
  const parent = String(project.schemeId);
  if (!schemeId) await activeScheme(parent, "projectId");
  return { schemeId: parent, projectId };
}
