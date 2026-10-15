import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  CONTENT_ANOMALY_READ_ROLES,
  SECURITY_AUDIT_READ_ROLES,
  SECURITY_AUDIT_WRITE_ROLES,
} from "../../models/roles.js";
import {
  createAuditSchema,
  createFindingSchema,
  idParamSchema,
  listAnomaliesQuerySchema,
  listAuditsQuerySchema,
  listFindingsQuerySchema,
  patchAuditSchema,
  patchFindingSchema,
} from "./security.schemas.js";
import {
  archiveAudit,
  archiveFinding,
  auditSummary,
  createAudit,
  createFinding,
  getAudit,
  getFinding,
  listAudits,
  listContentAnomalies,
  listFindings,
  updateAudit,
  updateFinding,
} from "./security.service.js";

const REDACTED = "[redacted]";

/**
 * Audit rows keep ids, types, severities, statuses and dates. The auditor and owner are people,
 * and a finding's description describes a weakness, so none of the three go into auditLogs.
 */
const REDACTED_FIELDS = ["auditor", "owner", "description"];

function redact(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of REDACTED_FIELDS) if (key in out) out[key] = REDACTED;
  return out;
}

/** The audit middleware also logs the request body, so the same fields are masked there. */
function redactBody(req) {
  if (!req.body || typeof req.body !== "object") return;
  req.body = redact(req.body);
}

export const securityRouter = Router();

securityRouter.use(requireAuth);

const read = requireRoles(...SECURITY_AUDIT_READ_ROLES);
const write = requireRoles(...SECURITY_AUDIT_WRITE_ROLES);

securityRouter.get(
  "/audits/summary",
  read,
  asyncHandler(async (_req, res) => {
    res.status(200).json(await auditSummary());
  }),
);

securityRouter.post(
  "/audits",
  write,
  asyncHandler(async (req, res) => {
    const body = createAuditSchema.parse(req.body);
    const created = await createAudit(body);
    redactBody(req);
    req.audit = {
      action: "securityAudit.create",
      entity: "securityAudit",
      entityId: created.id,
      after: redact(created),
    };
    res.status(201).json(created);
  }),
);

securityRouter.get(
  "/audits",
  read,
  asyncHandler(async (req, res) => {
    res.status(200).json(await listAudits(listAuditsQuerySchema.parse(req.query)));
  }),
);

securityRouter.get(
  "/audits/:id",
  read,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await getAudit(id));
  }),
);

securityRouter.patch(
  "/audits/:id",
  write,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const patch = patchAuditSchema.parse(req.body);
    const { before, after } = await updateAudit(id, patch);
    redactBody(req);
    req.audit = {
      action: "securityAudit.update",
      entity: "securityAudit",
      entityId: id,
      before: redact(before),
      after: redact(after),
    };
    res.status(200).json(after);
  }),
);

securityRouter.delete(
  "/audits/:id",
  write,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const before = await archiveAudit(id);
    req.audit = {
      action: "securityAudit.archive",
      entity: "securityAudit",
      entityId: id,
      before: redact(before),
      after: { archived: true },
    };
    res.status(200).json({ id, archived: true });
  }),
);

securityRouter.post(
  "/audits/:id/findings",
  write,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = createFindingSchema.parse(req.body);
    const created = await createFinding(id, body);
    redactBody(req);
    req.audit = {
      action: "securityFinding.create",
      entity: "securityFinding",
      entityId: created.id,
      after: redact(created),
      meta: { auditId: id },
    };
    res.status(201).json(created);
  }),
);

securityRouter.get(
  "/audits/:id/findings",
  read,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const query = listFindingsQuerySchema.parse(req.query);
    res.status(200).json(await listFindings({ ...query, auditId: undefined }, id));
  }),
);

securityRouter.get(
  "/findings",
  read,
  asyncHandler(async (req, res) => {
    res.status(200).json(await listFindings(listFindingsQuerySchema.parse(req.query)));
  }),
);

securityRouter.get(
  "/findings/:id",
  read,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(await getFinding(id));
  }),
);

securityRouter.patch(
  "/findings/:id",
  write,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const patch = patchFindingSchema.parse(req.body);
    const { before, after } = await updateFinding(id, patch);
    redactBody(req);
    req.audit = {
      action: "securityFinding.update",
      entity: "securityFinding",
      entityId: id,
      before: redact(before),
      after: redact(after),
      meta: { auditId: after.auditId },
    };
    res.status(200).json(after);
  }),
);

securityRouter.delete(
  "/findings/:id",
  write,
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const before = await archiveFinding(id);
    req.audit = {
      action: "securityFinding.archive",
      entity: "securityFinding",
      entityId: id,
      before: redact(before),
      after: { archived: true },
      meta: { auditId: before.auditId },
    };
    res.status(200).json({ id, archived: true });
  }),
);

securityRouter.get(
  "/content-anomalies",
  requireRoles(...CONTENT_ANOMALY_READ_ROLES),
  asyncHandler(async (req, res) => {
    res.status(200).json(await listContentAnomalies(listAnomaliesQuerySchema.parse(req.query)));
  }),
);
