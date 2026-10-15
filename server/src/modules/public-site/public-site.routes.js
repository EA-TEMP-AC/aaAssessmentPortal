import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { notFound } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { PUBLIC_SITE_READ_ROLES, PUBLIC_SITE_WRITE_ROLES } from "../../models/roles.js";
import { publicRateLimit } from "./public-site.rate-limit.js";
import {
  RESOURCES,
  RESOURCE_SLUGS,
  createSchemaFor,
  patchSchemaFor,
} from "./public-site.resources.js";
import {
  createItem,
  deleteItem,
  getAdmin,
  listAdmin,
  listPublic,
  updateItem,
} from "./public-site.service.js";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
/** Seconds a browser or CDN may reuse a public answer. */
export const PUBLIC_CACHE_SECONDS = 300;

const idParam = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id") });

function queryNumber({ min, max, fallback }) {
  return z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().int().min(min).max(max),
  );
}

const pageFields = {
  page: queryNumber({ min: 1, max: 100000, fallback: 1 }),
  pageSize: queryNumber({ min: 1, max: PAGE_SIZE_MAX, fallback: PAGE_SIZE_DEFAULT }),
};

const adminListQuery = z
  .object({
    ...pageFields,
    published: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    archived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

function publicListQuery(slug) {
  return z.object({ ...pageFields, ...(RESOURCES[slug].publicQuery ?? {}) }).strict();
}

function slugOf(req) {
  const slug = req.params.slug;
  if (!RESOURCE_SLUGS.includes(slug)) throw notFound();
  return slug;
}

/** /admin/public-site/:slug. aa_admin writes, mis reads. Every write is audited. */
export const publicSiteAdminRouter = Router();
publicSiteAdminRouter.use(requireAuth);
publicSiteAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const audit = (slug, verb, id, before, after) => ({
  action: `public_site.${slug}.${verb}`,
  entity: "publicSite",
  entityId: id,
  before,
  after,
  meta: { resource: slug },
});

publicSiteAdminRouter.get(
  "/:slug",
  requireRoles(...PUBLIC_SITE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const slug = slugOf(req);
    res.status(200).json(await listAdmin(slug, adminListQuery.parse(req.query)));
  }),
);

publicSiteAdminRouter.get(
  "/:slug/:id",
  requireRoles(...PUBLIC_SITE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const slug = slugOf(req);
    const { id } = idParam.parse(req.params);
    res.status(200).json(await getAdmin(slug, id));
  }),
);

publicSiteAdminRouter.post(
  "/:slug",
  requireRoles(...PUBLIC_SITE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const slug = slugOf(req);
    const body = createSchemaFor(slug).parse(req.body);
    const created = await createItem(slug, req.user, body);
    req.audit = audit(slug, "create", created.id, undefined, created);
    res.status(201).json(created);
  }),
);

publicSiteAdminRouter.patch(
  "/:slug/:id",
  requireRoles(...PUBLIC_SITE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const slug = slugOf(req);
    const { id } = idParam.parse(req.params);
    const body = patchSchemaFor(slug).parse(req.body);
    const saved = await updateItem(slug, req.user, id, body);
    req.audit = audit(slug, "update", id, saved.before, saved.after);
    res.status(200).json(saved.after);
  }),
);

publicSiteAdminRouter.delete(
  "/:slug/:id",
  requireRoles(...PUBLIC_SITE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const slug = slugOf(req);
    const { id } = idParam.parse(req.params);
    const removed = await deleteItem(slug, req.user, id);
    req.audit = audit(slug, "delete", id, removed, undefined);
    res.status(204).send();
  }),
);

/** /public/:slug. No login. Published items, whitelisted fields, cached, rate limited. */
export const publicSiteRouter = Router();
publicSiteRouter.use(publicRateLimit);

publicSiteRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const slug = slugOf(req);
    const body = await listPublic(slug, publicListQuery(slug).parse(req.query));
    res.set("Cache-Control", `public, max-age=${PUBLIC_CACHE_SECONDS}`);
    res.status(200).json(body);
  }),
);
