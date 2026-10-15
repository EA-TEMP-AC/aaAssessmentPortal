import express, { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { SECTOR_COVERAGE_READ_ROLES, SECTOR_COVERAGE_WRITE_ROLES } from "../../models/roles.js";
import {
  createSectorConfigSchema,
  nqrImportQuerySchema,
  sectorConfigParamSchema,
  sectorIdParamSchema,
  uncoveredQuerySchema,
  updateSectorConfigSchema,
} from "./sector-coverage.schemas.js";
import {
  createSectorConfig,
  getSectorCoverage,
  importNqrQualifications,
  listSectorCoverage,
  NQR_CSV_MAX_BYTES,
  updateSectorConfig,
} from "./sector-coverage.service.js";

/** Mounted under /api/v1/question-bank by question-bank.routes.js, after requireAuth. */
export const sectorCoverageRouter = Router();

// Raw text so the CSV never reaches the audit request-body snapshot.
const csvParser = express.text({ type: ["text/csv", "text/plain"], limit: NQR_CSV_MAX_BYTES });

sectorCoverageRouter.get(
  "/sector-coverage",
  requireRoles(...SECTOR_COVERAGE_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await listSectorCoverage());
  }),
);

sectorCoverageRouter.get(
  "/sector-coverage/:sectorId",
  requireRoles(...SECTOR_COVERAGE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { sectorId } = sectorIdParamSchema.parse(req.params);
    const query = uncoveredQuerySchema.parse(req.query);
    res.status(200).json(await getSectorCoverage(sectorId, query));
  }),
);

sectorCoverageRouter.post(
  "/sector-config",
  requireRoles(...SECTOR_COVERAGE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = createSectorConfigSchema.parse(req.body);
    const created = await createSectorConfig(req.user, body);
    req.audit = {
      action: "sector_config.create",
      entity: "sector_config",
      entityId: created.id,
      after: created,
    };
    res.status(201).json(created);
  }),
);

sectorCoverageRouter.patch(
  "/sector-config/:id",
  requireRoles(...SECTOR_COVERAGE_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = sectorConfigParamSchema.parse(req.params);
    const body = updateSectorConfigSchema.parse(req.body);
    const { before, after } = await updateSectorConfig(req.user, id, body);
    req.audit = {
      action: "sector_config.update",
      entity: "sector_config",
      entityId: id,
      before,
      after,
    };
    res.status(200).json(after);
  }),
);

/**
 * POST /api/v1/question-bank/nqr-qualifications/import(?partial=true)
 * Body is the CSV as text/csv. Header: code,name,sector.
 */
sectorCoverageRouter.post(
  "/nqr-qualifications/import",
  requireRoles(...SECTOR_COVERAGE_WRITE_ROLES),
  csvParser,
  asyncHandler(async (req, res) => {
    const { partial } = nqrImportQuerySchema.parse(req.query);
    const result = await importNqrQualifications(req.user, {
      csv: typeof req.body === "string" ? req.body : null,
      partial,
    });
    req.audit = {
      action: "nqr_qualification.import",
      entity: "nqr_qualification",
      logOnFailure: true,
      meta: {
        totalRows: result.totalRows,
        importedCount: result.importedCount,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        errorCount: result.errorCount,
        partial,
      },
    };
    if (!result.success) {
      res.status(400).json(result);
    } else {
      res.status(result.createdCount > 0 ? 201 : 200).json(result);
    }
  }),
);
