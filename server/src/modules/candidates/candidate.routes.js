import express from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { validationError } from "../../lib/errors.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { CANDIDATE_READ_ROLES, CANDIDATE_WRITE_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import { parseMultipartCsv } from "./candidate-csv.js";
import { CANDIDATE_CSV_MAX_BYTES } from "./candidate-limits.js";
import {
  addCandidateBodySchema,
  batchIdParamSchema,
  candidateIdParamSchema,
  importQuerySchema,
  listCandidatesQuerySchema,
  loginBodySchema,
  patchCandidateBodySchema,
} from "./candidate.schemas.js";
import {
  addCandidate,
  ensureStudentLogin,
  getCandidates,
  importCandidates,
  patchCandidate,
  writeRatioOverrideAudit,
} from "./candidate.service.js";

function setAudit(req, entry) {
  req.audit = entry;
}

const csvTextParser = express.text({
  type: ["text/csv", "text/plain", "application/csv"],
  limit: CANDIDATE_CSV_MAX_BYTES,
});

const multipartRawParser = express.raw({
  type: "multipart/form-data",
  limit: CANDIDATE_CSV_MAX_BYTES + 8192,
});

function isCsvContentType(type) {
  const base = String(type || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return base === "text/csv" || base === "text/plain" || base === "application/csv";
}

function parseImportBody(req, res, next) {
  const type = req.get("content-type") || "";
  if (type.toLowerCase().includes("multipart/form-data")) {
    multipartRawParser(req, res, next);
    return;
  }
  if (isCsvContentType(type)) {
    csvTextParser(req, res, next);
    return;
  }
  next(
    validationError("CSV file required", {
      contentType: ["Expected text/csv or a .csv file"],
    }),
  );
}

function csvFromRequest(req) {
  const type = req.get("content-type") || "";
  if (type.toLowerCase().includes("multipart/form-data")) {
    const parsed = parseMultipartCsv(req.body, type);
    return {
      csv: parsed.csv,
      ratioOverrideReason: parsed.fields.ratioOverrideReason,
    };
  }
  if (typeof req.body !== "string") {
    throw validationError("CSV file required", { file: ["Expected a CSV body"] });
  }
  if (Buffer.byteLength(req.body, "utf8") > CANDIDATE_CSV_MAX_BYTES) {
    throw validationError("CSV file is too large", { file: ["File exceeds the size limit"] });
  }
  return { csv: req.body, ratioOverrideReason: undefined };
}

/**
 * Mounted on the batches router (already behind requireAuth).
 * @param {import("express").Router} router
 */
export function mountCandidateRoutes(router) {
  router.post(
    "/:id/candidates/import",
    requireRoles(...CANDIDATE_WRITE_ROLES),
    parseImportBody,
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const query = importQuerySchema.parse(req.query);
      const parsed = csvFromRequest(req);
      const extras = {
        ratioOverrideReason: parsed.ratioOverrideReason ?? query.ratioOverrideReason,
      };
      const result = await importCandidates(req.user, id, parsed.csv, extras, {
        ip: clientIp(req),
      });
      setAudit(req, {
        action: "candidate.import",
        entity: "candidate",
        omitRequestBody: true,
        entityId: id,
        abId: result.abId,
        batchId: id,
        meta: {
          created: result.created,
          skipped: result.skipped,
          errorCount: result.errors.length,
          ...(result.logins ? { loginsCreated: result.logins.created } : {}),
        },
      });
      await writeRatioOverrideAudit(req.user, id, result.ratioOverride, clientIp(req));
      await res.status(200).json({
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
        ...(result.logins ? { logins: result.logins } : {}),
      });
    }),
  );

  router.post(
    "/:id/candidates",
    requireRoles(...CANDIDATE_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const body = addCandidateBodySchema.parse(req.body);
      const saved = await addCandidate(req.user, id, body, { ip: clientIp(req) });
      setAudit(req, {
        action: "candidate.create",
        entity: "candidate",
        omitRequestBody: true,
        entityId: saved.candidate.id,
        abId: saved.abId,
        batchId: id,
        after: saved.stored,
      });
      await writeRatioOverrideAudit(req.user, id, saved.ratioOverride, clientIp(req));
      await res
        .status(201)
        .json(saved.login ? { ...saved.candidate, login: saved.login } : saved.candidate);
    }),
  );

  router.get(
    "/:id/candidates",
    requireRoles(...CANDIDATE_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const query = listCandidatesQuerySchema.parse(req.query);
      const body = await getCandidates(req.user, id, query);
      await recordAccess(req, {
        subjectType: "learner",
        subjectIds: body.items.map((item) => item.learnerId),
        kind: "list",
        fields: ["name", "externalRef", "accommodations"],
      });
      // X-36: reading a student's first password is logged against the login.
      if (body.shownPasswordUserIds?.length) {
        await recordAccess(req, {
          subjectType: "user",
          subjectIds: body.shownPasswordUserIds,
          kind: "list",
          fields: ["loginId", "initialPassword"],
        });
      }
      await res.status(200).json({ items: body.items });
    }),
  );

  router.post(
    "/:id/candidates/:candidateId/login",
    requireRoles(...CANDIDATE_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id, candidateId } = candidateIdParamSchema.parse(req.params);
      const body = loginBodySchema.parse(req.body ?? {});
      const saved = await ensureStudentLogin(req.user, id, candidateId, body);
      setAudit(req, {
        action: saved.status === "reset" ? "candidate.login_reset" : "candidate.login_create",
        entity: "candidate",
        omitRequestBody: true,
        entityId: saved.candidateId,
        abId: saved.abId,
        batchId: id,
        meta: { status: saved.status },
      });
      await res.status(200).json({ status: saved.status });
    }),
  );

  router.patch(
    "/:id/candidates/:candidateId",
    requireRoles(...CANDIDATE_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id, candidateId } = candidateIdParamSchema.parse(req.params);
      const body = patchCandidateBodySchema.parse(req.body);
      const saved = await patchCandidate(req.user, id, candidateId, body, {
        ip: clientIp(req),
      });
      setAudit(req, {
        action: "candidate.update",
        entity: "candidate",
        entityId: saved.candidate.id,
        abId: saved.abId,
        batchId: id,
        before: saved.before,
        after: saved.stored,
      });
      await writeRatioOverrideAudit(req.user, id, saved.ratioOverride, clientIp(req));
      await res.status(200).json(saved.candidate);
    }),
  );
}
