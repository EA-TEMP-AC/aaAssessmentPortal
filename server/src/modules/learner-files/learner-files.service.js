import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { AppError, forbidden, notFound, validationError } from "../../lib/errors.js";
import { Learner } from "../../models/learner.model.js";
import { LearnerFile } from "../../models/learner-file.model.js";
import { aadhaarModeFor } from "../master-data/master-data.service.js";
import { EVIDENCE_EXTENSIONS, inspectFile, sniffContentType } from "../evidence/file-type.js";
import { getEvidenceStorage, StorageNotFoundError } from "../evidence/storage/storage.js";

const MB = 1024 * 1024;
const RULES = {
  photo: { types: ["image/jpeg", "image/png"], maxBytes: 2 * MB },
  identity: { types: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 5 * MB },
};

export function presentLearnerFile(doc) {
  return {
    id: String(doc._id),
    learnerId: String(doc.learnerId),
    kind: doc.kind,
    docType: doc.docType ?? null,
    contentType: doc.contentType,
    size: doc.size,
    uploadedAt: new Date(doc.createdAt).toISOString(),
  };
}

async function requireLearner(id) {
  const learner = await Learner.findById(id).select("_id").lean();
  if (!learner) throw notFound();
  return learner;
}

export async function uploadLearnerFile(user, learnerId, fields, file) {
  await requireLearner(learnerId);
  const { sha256, size, head } = await inspectFile(file.path);
  if (size === 0) throw validationError("The file is empty", { file: ["The file is empty"] });
  const contentType = sniffContentType(head);
  const rule = RULES[fields.kind];
  if (!contentType || !rule.types.includes(contentType)) {
    throw new AppError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      fields.kind === "photo"
        ? "A photo must be a JPEG or PNG picture"
        : "An identity card must be a JPEG, PNG or PDF file",
    );
  }
  if (size > rule.maxBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", "The file is larger than the limit for its type", {
      maxBytes: rule.maxBytes,
    });
  }
  const storageKey = `learners/${randomUUID()}.${EVIDENCE_EXTENSIONS[contentType]}`;
  await getEvidenceStorage().put({
    key: storageKey,
    body: createReadStream(file.path),
    size,
    contentType,
  });
  const match = { learnerId, kind: fields.kind, current: true };
  if (fields.docType) match.docType = fields.docType;
  await LearnerFile.updateMany(match, { $set: { current: false } });
  const created = await LearnerFile.create({
    learnerId,
    kind: fields.kind,
    ...(fields.docType ? { docType: fields.docType } : {}),
    storageKey,
    contentType,
    size,
    sha256,
    uploadedBy: user._id,
    current: true,
  });
  return presentLearnerFile(created.toObject());
}

export async function listLearnerFiles(learnerId) {
  await requireLearner(learnerId);
  const rows = await LearnerFile.find({ learnerId, current: true }).sort({ createdAt: 1 }).lean();
  return { items: rows.map(presentLearnerFile) };
}

/** An Aadhaar card picture shows the whole number, so it follows the Aadhaar visibility setting. */
export async function loadReadableFile(user, learnerId, fileId) {
  const doc = await LearnerFile.findOne({ _id: fileId, learnerId }).lean();
  if (!doc) throw notFound();
  if (doc.docType === "aadhaar_card" && (await aadhaarModeFor(user)) !== "full") {
    throw forbidden("The Aadhaar card picture is not visible under the current Aadhaar setting");
  }
  return doc;
}

export async function openLearnerFile(doc) {
  try {
    return await getEvidenceStorage().get(doc.storageKey);
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      throw new AppError(404, "NOT_FOUND", "The stored file is missing");
    }
    throw err;
  }
}
