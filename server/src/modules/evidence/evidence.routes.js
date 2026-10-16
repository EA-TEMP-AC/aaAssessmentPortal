import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError, validationError } from "../../lib/errors.js";
import { withoutExactLocation } from "../../lib/audit-safe.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import {
  EVIDENCE_READ_ROLES,
  EVIDENCE_UPLOAD_ROLES,
  EVIDENCE_VERIFY_ROLES,
} from "../../models/roles.js";
import { EVIDENCE_ABSOLUTE_MAX_BYTES } from "./file-type.js";
import {
  batchIdParamSchema,
  evidenceFileQuerySchema,
  evidenceIdParamSchema,
  listEvidenceQuerySchema,
  uploadFieldsSchema,
} from "./evidence.schemas.js";
import {
  createEvidence,
  downloadName,
  listEvidence,
  loadReadableEvidence,
  loadUploadBatch,
  openEvidenceFile,
  presentEvidence,
  recordDownload,
  verifyEvidence,
} from "./evidence.service.js";

const UPLOAD_DIR = path.join(os.tmpdir(), "aa-evidence-uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

/** The upload goes to a temp file, never into memory, because a video can be 200 MB. */
const uploader = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: EVIDENCE_ABSOLUTE_MAX_BYTES,
    files: 1,
    fields: 20,
    fieldSize: 4096,
    parts: 25,
  },
}).single("file");

function parseMultipart(req, res) {
  return new Promise((resolve, reject) => {
    uploader(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === "LIMIT_FILE_SIZE") {
        return reject(
          new AppError(413, "FILE_TOO_LARGE", "The file is larger than the limit for its type", {
            maxBytes: EVIDENCE_ABSOLUTE_MAX_BYTES,
          }),
        );
      }
      if (err instanceof multer.MulterError) {
        return reject(validationError(`Upload rejected: ${err.code}`));
      }
      return reject(err);
    });
  });
}

/** Room for the multipart boundaries and text fields around the file bytes. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Refuses by the Content-Length header before the body is read. The size limit that depends on
 * the file type is checked after the type is known; this is the overall limit.
 */
function rejectOversizedByHeader(req) {
  const declared = Number(req.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > EVIDENCE_ABSOLUTE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
  ) {
    throw new AppError(413, "FILE_TOO_LARGE", "The file is larger than the limit for its type", {
      maxBytes: EVIDENCE_ABSOLUTE_MAX_BYTES,
    });
  }
}

function setAudit(req, entry) {
  req.audit = entry;
}

/** POST /batches/:id/evidence. Mounted on the batches router, which already requires a login. */
export function mountEvidenceBatchRoutes(router) {
  router.post(
    "/:id/evidence",
    requireRoles(...EVIDENCE_UPLOAD_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = batchIdParamSchema.parse(req.params);
      const batch = await loadUploadBatch(req.user, id);
      rejectOversizedByHeader(req);
      try {
        await parseMultipart(req, res);
        if (!req.file) {
          throw validationError("A file is required", {
            file: ["Send the file in the 'file' part"],
          });
        }
        const fields = uploadFieldsSchema.parse({ ...req.body });
        const saved = await createEvidence(req.user, batch, fields, req.file);
        const body = presentEvidence(saved.evidence, { replayed: saved.replayed });
        setAudit(req, {
          action: saved.replayed ? "evidence.replay" : "evidence.upload",
          entity: "evidence",
          entityId: body.id,
          abId: batch.abId,
          batchId: batch._id,
          omitRequestBody: true,
          after: withoutExactLocation({ ...body, replayed: undefined }),
          meta: { contentType: body.contentType, size: body.size, sha256: body.sha256 },
        });
        await res.status(saved.replayed ? 200 : 201).json(body);
      } finally {
        if (req.file?.path) await unlink(req.file.path).catch(() => {});
      }
    }),
  );
}

export const evidenceRouter = Router();

evidenceRouter.use(requireAuth);

evidenceRouter.get(
  "/",
  requireRoles(...EVIDENCE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const query = listEvidenceQuerySchema.parse(req.query);
    await res.status(200).json(await listEvidence(req.user, query));
  }),
);

evidenceRouter.get(
  "/:id",
  requireRoles(...EVIDENCE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = evidenceIdParamSchema.parse(req.params);
    await res.status(200).json(presentEvidence(await loadReadableEvidence(req.user, id)));
  }),
);

evidenceRouter.get(
  "/:id/file",
  requireRoles(...EVIDENCE_READ_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = evidenceIdParamSchema.parse(req.params);
    const { inline } = evidenceFileQuerySchema.parse(req.query);
    const doc = await loadReadableEvidence(req.user, id);
    // Logged first: a download that cannot be logged is not served.
    await recordDownload(req, doc);
    const file = await openEvidenceFile(doc, new Date(), { inline });
    if (file.url) {
      res.set("Cache-Control", "no-store");
      await res.status(200).json({
        url: file.url,
        expiresAt: file.expiresAt,
        contentType: doc.contentType,
        size: doc.size,
        sha256: doc.sha256,
      });
      return;
    }
    res.set({
      "Content-Type": doc.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${downloadName(doc)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.status(200);
    await pipeline(file.stream, res);
  }),
);

evidenceRouter.post(
  "/:id/verify",
  requireRoles(...EVIDENCE_VERIFY_ROLES),
  asyncHandler(async (req, res) => {
    const { id } = evidenceIdParamSchema.parse(req.params);
    const saved = await verifyEvidence(req.user, id);
    const body = presentEvidence(saved.evidence);
    const check = saved.evidence.lastVerification;
    body.verification = {
      ...body.verification,
      expectedSha256: saved.evidence.sha256,
      actualSha256: check.actualSha256 ?? (saved.result === "ok" ? saved.evidence.sha256 : null),
      actualSize: check.actualSize ?? (saved.result === "ok" ? saved.evidence.size : null),
    };
    setAudit(req, {
      action: "evidence.verify",
      entity: "evidence",
      entityId: body.id,
      abId: saved.evidence.abId,
      batchId: saved.evidence.batchId,
      before: { verification: saved.before.verification, verifyCount: saved.before.verifyCount },
      after: { verification: presentEvidence(saved.evidence).verification },
      meta: { result: saved.result },
    });
    await res.status(200).json(body);
  }),
);
