import express from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { validationError } from "../../lib/errors.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { CANDIDATE_READ_ROLES, CANDIDATE_WRITE_ROLES } from "../../models/roles.js";
import { parseMultipartCsv } from "./candidate-csv.js";
import { CANDIDATE_CSV_MAX_BYTES } from "./candidate-limits.js";
import {
  addCandidateBodySchema,
  batchIdParamSchema,
  candidateIdParamSchema,
  importQuerySchema,
  listCandidatesQuerySchema,
  patchCandidateBodySchema,
} from "./candidate.schemas.js";
import {
  addCandidate,
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
        entityId: id,
        abId: result.abId,
        batchId: id,
        meta: {
          created: result.created,
          skipped: result.skipped,
          errorCount: result.errors.length,
        },
      });
      await writeRatioOverrideAudit(req.user, id, result.ratioOverride, clientIp(req));
      await res.status(200).json({
        created: result.created,
        skipped: result.skipped,
        errors: result.errors,
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
        entityId: saved.candidate.id,
        abId: saved.abId,
        batchId: id,
        after: saved.stored,
      });
      await writeRatioOverrideAudit(req.user, id, saved.ratioOverride, clientIp(req));
      await res.status(201).json(saved.candidate);
    }),
  );

  router.get(
    "/:id/candidates",
    requireRoles(...CANDIDATE_READ_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const query = listCandidatesQuerySchema.parse(req.query);
      await res.status(200).json(await getCandidates(req.user, id, query));
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
