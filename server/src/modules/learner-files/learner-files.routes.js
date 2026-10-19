import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError, validationError } from "../../lib/errors.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { MASTER_DATA_WRITE_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import {
  fileParamSchema,
  learnerParamSchema,
  uploadFieldsSchema,
} from "./learner-files.schemas.js";
import {
  listLearnerFiles,
  loadReadableFile,
  openLearnerFile,
  uploadLearnerFile,
} from "./learner-files.service.js";

const UPLOAD_DIR = path.join(os.tmpdir(), "aa-learner-uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_BYTES = 5 * 1024 * 1024;

const uploader = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_BYTES, files: 1, fields: 5, fieldSize: 256, parts: 8 },
}).single("file");

function parseMultipart(req, res) {
  return new Promise((resolve, reject) => {
    uploader(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === "LIMIT_FILE_SIZE") {
        return reject(
          new AppError(413, "FILE_TOO_LARGE", "The file is larger than the limit for its type", {
            maxBytes: MAX_BYTES,
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

/**
 * X-47. A student's photo and identity card picture, under /learners/:id/files.
 * Mounted on the learners router, which already requires a login. Admin and MIS only.
 */
export function mountLearnerFileRoutes(router) {
  router.post(
    "/:id/files",
    requireRoles(...MASTER_DATA_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = learnerParamSchema.parse(req.params);
      try {
        await parseMultipart(req, res);
        if (!req.file) {
          throw validationError("A file is required", {
            file: ["Send the file in the 'file' part"],
          });
        }
        const fields = uploadFieldsSchema.parse({ ...req.body });
        const saved = await uploadLearnerFile(req.user, id, fields, req.file);
        req.audit = {
          action: "learner.file_upload",
          entity: "learner",
          entityId: id,
          omitRequestBody: true,
          meta: {
            fileId: saved.id,
            kind: saved.kind,
            docType: saved.docType,
            contentType: saved.contentType,
            size: saved.size,
          },
        };
        await res.status(201).json(saved);
      } finally {
        if (req.file?.path) await unlink(req.file.path).catch(() => {});
      }
    }),
  );

  router.get(
    "/:id/files",
    requireRoles(...MASTER_DATA_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = learnerParamSchema.parse(req.params);
      res.set("Cache-Control", "no-store");
      await res.status(200).json(await listLearnerFiles(id));
    }),
  );

  router.get(
    "/:id/files/:fileId",
    requireRoles(...MASTER_DATA_WRITE_ROLES),
    asyncHandler(async (req, res) => {
      const { id, fileId } = fileParamSchema.parse(req.params);
      const doc = await loadReadableFile(req.user, id, fileId);
      // Logged first: a picture that cannot be logged is not served.
      await recordAccess(req, {
        subjectType: "learner",
        subjectIds: [id],
        kind: "detail",
        fields: [doc.kind === "photo" ? "photo" : `identity_${doc.docType}`],
      });
      const file = await openLearnerFile(doc);
      res.set({
        "Content-Type": doc.contentType,
        "Content-Length": String(file.size),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.status(200);
      await pipeline(file.stream, res);
    }),
  );
}
