import { AppError, forbidden, notFound, validationError } from "../../lib/errors.js";
import { Assessor } from "../../models/assessor.model.js";
import { Proctor } from "../../models/proctor.model.js";
import { RESOURCES, monthBounds } from "./public-site.resources.js";

const DEFAULT_SORT = { sortOrder: 1, _id: 1 };

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function idOf(value) {
  return value == null ? null : String(value);
}

/** Admin view: every stored field of the item, ids as strings. */
export function presentAdmin(slug, doc) {
  const { __v, _id, createdAt, updatedAt, createdBy, updatedBy, ...rest } = doc;
  void __v;
  const out = { id: String(_id) };
  for (const [key, value] of Object.entries(rest)) {
    out[key] =
      value != null && typeof value === "object" && value._bsontype ? String(value) : value;
  }
  out.createdAt = iso(createdAt);
  out.updatedAt = iso(updatedAt);
  out.createdBy = idOf(createdBy);
  out.updatedBy = idOf(updatedBy);
  void slug;
  return out;
}

function pick(doc, fields) {
  const out = { id: String(doc._id) };
  for (const key of fields) {
    const value = doc[key];
    out[key] =
      value === undefined ? null : value != null && value._bsontype ? String(value) : value;
  }
  return out;
}

async function pageOf(def, filter, query, sort) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    def.model.countDocuments(filter),
    def.model.find(filter).sort(sort).skip(skip).limit(query.pageSize).lean(),
  ]);
  return { total, docs };
}

export async function listAdmin(slug, query) {
  const def = RESOURCES[slug];
  const filter = {};
  if (query.published !== undefined) filter.published = query.published;
  if (query.archived !== undefined) {
    filter.archived = query.archived;
  } else {
    filter.archived = { $ne: true };
  }
  const { total, docs } = await pageOf(def, filter, query, def.sort ?? DEFAULT_SORT);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map((doc) => presentAdmin(slug, doc)),
  };
}

export async function getAdmin(slug, id) {
  const doc = await RESOURCES[slug].model.findById(id).lean();
  if (!doc || doc.archived) throw notFound();
  return presentAdmin(slug, doc);
}

function writeError(err) {
  if (err?.code === 11000) {
    throw validationError("This item already exists", { duplicate: ["Already listed"] });
  }
  throw err;
}

export async function createItem(slug, actor, body) {
  const def = RESOURCES[slug];

  if (actor.role === "mis" && body.published) {
    throw forbidden("Only aa_admin may set published to true");
  }

  if (body.published === true) {
    if (slug === "people" && !body.consentRecorded) {
      throw new AppError(409, "CONSENT_REQUIRED", "Consent must be recorded before publishing");
    }
    if (slug === "posh" && body.kind === "committee_member" && !body.consentRecorded) {
      throw new AppError(409, "CONSENT_REQUIRED", "Consent must be recorded before publishing");
    }
  }

  const extra = (await def.check?.(body, null)) ?? {};
  try {
    const created = await def.model.create({
      ...body,
      ...extra,
      createdBy: actor._id,
      updatedBy: actor._id,
    });
    invalidatePublicPages(slug);
    return presentAdmin(slug, created.toObject());
  } catch (err) {
    return writeError(err);
  }
}

export async function updateItem(slug, actor, id, body) {
  const def = RESOURCES[slug];
  const existing = await def.model.findById(id).lean();
  if (!existing || existing.archived) throw notFound();

  if (actor.role === "mis") {
    if (existing.published) {
      throw forbidden("mis cannot edit published items");
    }
    if (body.published === true) {
      throw forbidden("Only aa_admin may set published to true");
    }
  }

  const willBePublished = body.published !== undefined ? body.published : existing.published;
  const consentRecorded =
    body.consentRecorded !== undefined ? body.consentRecorded : existing.consentRecorded;
  const kind = body.kind !== undefined ? body.kind : existing.kind;

  if (willBePublished === true) {
    if (slug === "people" && !consentRecorded) {
      throw new AppError(409, "CONSENT_REQUIRED", "Consent must be recorded before publishing");
    }
    if (slug === "posh" && kind === "committee_member" && !consentRecorded) {
      throw new AppError(409, "CONSENT_REQUIRED", "Consent must be recorded before publishing");
    }
  }

  const extra = (await def.check?.(body, existing)) ?? {};
  const merged = { ...existing, ...body };
  if (slug === "posh" && merged.kind !== "committee_member") {
    for (const key of ["memberName", "memberRole"]) {
      if (merged[key]) {
        throw validationError(`${key} is only allowed for a committee member`, {
          [key]: ["Only for a committee member"],
        });
      }
    }
  }
  if (slug === "events" && merged.endDate && merged.endDate < merged.date) {
    throw validationError("endDate is before date", { endDate: ["Before date"] });
  }
  try {
    const saved = await def.model
      .findOneAndUpdate(
        { _id: id },
        { $set: { ...body, ...extra, updatedBy: actor._id } },
        { new: true, runValidators: true },
      )
      .lean();
    invalidatePublicPages(slug);
    return { before: presentAdmin(slug, existing), after: presentAdmin(slug, saved) };
  } catch (err) {
    return writeError(err);
  }
}

export async function deleteItem(slug, actor, id) {
  const def = RESOURCES[slug];
  const existing = await def.model.findById(id).lean();
  if (!existing || existing.archived) throw notFound();

  if (actor.role === "mis" && existing.published) {
    throw forbidden("mis cannot unpublish or archive published items");
  }

  const saved = await def.model
    .findOneAndUpdate(
      { _id: id },
      { $set: { archived: true, published: false, updatedBy: actor._id } },
      { new: true },
    )
    .lean();

  if (slug === "organogram") {
    await def.model.updateMany({ parentId: existing._id }, { $set: { parentId: null } });
  }
  invalidatePublicPages(slug);
  return presentAdmin(slug, saved);
}

/** D7: the people and POSH pages are answered from memory for 60 seconds. */
export const SHORT_CACHE_SLUGS = Object.freeze(["people", "posh"]);
export const SHORT_CACHE_SECONDS = 60;
/** @type {Map<string, { at: number, body: object }>} */
const publicPageCache = new Map();

export function resetPublicPageCache() {
  publicPageCache.clear();
}

/** An admin write drops the cached pages of that section at once. */
function invalidatePublicPages(slug) {
  for (const key of publicPageCache.keys()) {
    if (key.startsWith(`${slug}:`)) publicPageCache.delete(key);
  }
}

const REGISTRY_CACHE_MS = 60_000;
/** @type {{ at: number, ids: unknown[] } | null} */
let registryCache = null;

export function resetRegistryIdCache() {
  registryCache = null;
  publicPageCache.clear();
}

/** Ids of active assessors (valid TOA) and proctors, reused for 60 seconds. */
async function activeRegistryIds(now = Date.now()) {
  if (registryCache && now - registryCache.at < REGISTRY_CACHE_MS) return registryCache.ids;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [activeAssessors, activeProctors] = await Promise.all([
    Assessor.find({ active: true, "toa.expiresOn": { $gte: today } })
      .select("_id")
      .lean(),
    Proctor.find({ active: true }).select("_id").lean(),
  ]);
  const ids = [...activeAssessors.map((a) => a._id), ...activeProctors.map((p) => p._id)];
  registryCache = { at: now, ids };
  return ids;
}

/** Anonymous list: published items only, whitelisted fields, never an admin field. */
export async function listPublic(slug, query, now = Date.now()) {
  if (!SHORT_CACHE_SLUGS.includes(slug)) return listPublicUncached(slug, query);
  const key = `${slug}:${JSON.stringify(query)}`;
  const hit = publicPageCache.get(key);
  if (hit && now - hit.at < SHORT_CACHE_SECONDS * 1000) return hit.body;
  const body = await listPublicUncached(slug, query);
  publicPageCache.set(key, { at: now, body });
  return body;
}

async function listPublicUncached(slug, query) {
  const def = RESOURCES[slug];
  const filter = { published: true, archived: { $ne: true } };

  if (slug === "people") {
    const validRegistryIds = await activeRegistryIds();
    filter.registryId = { $in: validRegistryIds };
  }

  for (const key of Object.keys(def.publicQuery ?? {})) {
    if (query[key] === undefined) continue;
    if (key === "month") {
      const { first, last } = monthBounds(query.month);
      filter.date = { $lte: last };
      filter.$expr = { $gte: [{ $ifNull: ["$endDate", "$date"] }, first] };
    } else {
      filter[key] = query[key];
    }
  }
  const { total, docs } = await pageOf(def, filter, query, def.sort ?? DEFAULT_SORT);
  const enriched = def.enrich ? await def.enrich(docs) : docs;
  const fields = [...def.publicFields, ...(def.enrichedFields ?? [])];
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: enriched.map((doc) => pick(doc, fields)),
  };
}
