import { notFound, validationError } from "../../lib/errors.js";
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
  if (!doc) throw notFound();
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
  const extra = (await def.check?.(body, null)) ?? {};
  try {
    const created = await def.model.create({
      ...body,
      ...extra,
      createdBy: actor._id,
      updatedBy: actor._id,
    });
    return presentAdmin(slug, created.toObject());
  } catch (err) {
    return writeError(err);
  }
}

export async function updateItem(slug, actor, id, body) {
  const def = RESOURCES[slug];
  const existing = await def.model.findById(id).lean();
  if (!existing) throw notFound();
  const extra = (await def.check?.(body, existing)) ?? {};
  const merged = { ...existing, ...body };
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
    return { before: presentAdmin(slug, existing), after: presentAdmin(slug, saved) };
  } catch (err) {
    return writeError(err);
  }
}

export async function deleteItem(slug, id) {
  const def = RESOURCES[slug];
  const existing = await def.model.findOneAndDelete({ _id: id }).lean();
  if (!existing) throw notFound();
  if (slug === "organogram") {
    // Children of a removed node move to the top rather than pointing at nothing.
    await def.model.updateMany({ parentId: existing._id }, { $set: { parentId: null } });
  }
  return presentAdmin(slug, existing);
}

/** Anonymous list: published items only, whitelisted fields, never an admin field. */
export async function listPublic(slug, query) {
  const def = RESOURCES[slug];
  const filter = { published: true };
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
