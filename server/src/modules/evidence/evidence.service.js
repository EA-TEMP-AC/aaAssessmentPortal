import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { env } from "../../config/env.js";
import {
  AppError,
  conflictIdempotent,
  forbidden,
  invalidTransition,
  notFound,
  validationError,
} from "../../lib/errors.js";
import { toObjectIdOrNull } from "../../lib/object-id.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Evidence } from "../../models/evidence.model.js";
import { recordAccess } from "../audit/access-log.service.js";
import { stableStringify } from "../login-events/login-event.service.js";
import {
  EVIDENCE_EXTENSIONS,
  EVIDENCE_MAX_BYTES,
  inspectFile,
  sniffContentType,
} from "./file-type.js";
import { getEvidenceStorage, StorageNotFoundError } from "./storage/storage.js";

/** Evidence may be added in every batch status except these two (V-01). */
export const EVIDENCE_CLOSED_BATCH_STATUSES = Object.freeze(["cancelled", "rejected"]);

const KIND_CONTENT_TYPES = {
  photo: ["image/jpeg", "image/png"],
  video: ["video/mp4"],
  id_proof: ["image/jpeg", "image/png", "application/pdf"],
  attendance: ["image/jpeg", "image/png", "application/pdf"],
  equipment: ["image/jpeg", "image/png", "application/pdf"],
  other: ["image/jpeg", "image/png", "application/pdf"],
};

const SUPPORTED = new Set(Object.keys(EVIDENCE_MAX_BYTES));

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

/** The API shape. The storage key and the payload hash never leave the server. */
export function presentEvidence(doc, { replayed } = {}) {
  const out = {
    id: String(doc._id),
    clientEventId: doc.clientEventId,
    batchId: String(doc.batchId),
    abId: String(doc.abId),
    candidateId: doc.candidateId ? String(doc.candidateId) : null,
    kind: doc.kind,
    contentType: doc.contentType,
    size: doc.size,
    sha256: doc.sha256,
    uploaderId: String(doc.uploaderUserId),
    uploaderRole: doc.uploaderRole,
    capturedAt: iso(doc.capturedAt),
    uploadedAt: iso(doc.uploadedAt),
    locationStatus: doc.locationStatus,
    latitude: doc.latitude ?? null,
    longitude: doc.longitude ?? null,
    accuracy: doc.accuracy ?? null,
    locationUnavailableReason: doc.locationUnavailableReason ?? null,
    hasLocation: doc.locationStatus === "captured",
    deviceId: doc.deviceId ?? null,
    verification: doc.lastVerification
      ? {
          at: iso(doc.lastVerification.at),
          byUserId: String(doc.lastVerification.byUserId),
          result: doc.lastVerification.result,
        }
      : null,
    verifyCount: doc.verifyCount ?? 0,
  };
  if (replayed !== undefined) out.replayed = replayed;
  return out;
}

/**
 * First gate for an upload, run before the body is read so a refused request costs nothing.
 * Unknown batch is 404, a batch outside the caller's scope is 403.
 */
export async function loadUploadBatch(user, batchId) {
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  if (!isInBatchScope(user, batch)) throw forbidden();
  return batch;
}

function payloadHash(user, batchId, fields, sha256) {
  return createHash("sha256")
    .update(
      stableStringify({
        userId: String(user._id),
        batchId: String(batchId),
        clientEventId: fields.clientEventId,
        kind: fields.kind,
        candidateId: fields.candidateId?.toLowerCase() ?? null,
        capturedAt: new Date(fields.capturedAt).toISOString(),
        locationStatus: fields.locationStatus ?? null,
        latitude: fields.latitude ?? null,
        longitude: fields.longitude ?? null,
        accuracy: fields.accuracy ?? null,
        locationUnavailableReason: fields.locationUnavailableReason ?? null,
        deviceId: fields.deviceId ?? null,
        sha256,
      }),
    )
    .digest("hex");
}

function locationFrom(fields) {
  if (fields.locationStatus === "unavailable") {
    return {
      locationStatus: "unavailable",
      latitude: null,
      longitude: null,
      accuracy: null,
      locationUnavailableReason: fields.locationUnavailableReason,
    };
  }
  if (fields.latitude !== undefined) {
    return {
      locationStatus: "captured",
      latitude: fields.latitude,
      longitude: fields.longitude,
      accuracy: fields.accuracy ?? null,
      locationUnavailableReason: null,
    };
  }
  return {
    locationStatus: "not_provided",
    latitude: null,
    longitude: null,
    accuracy: null,
    locationUnavailableReason: null,
  };
}

function replay(existing, hashValue) {
  if (existing.payloadHash !== hashValue) throw conflictIdempotent();
  return { evidence: existing, replayed: true };
}

/**
 * Store one uploaded file. docs/SCHEMA.md §3.24.
 * A repeat of the same `clientEventId` and payload returns the stored row (`replayed: true`)
 * without storing the file again. A different payload is `409 CONFLICT_IDEMPOTENT`.
 * @param {object} user
 * @param {object} batch from loadUploadBatch
 * @param {object} fields parsed uploadFieldsSchema
 * @param {{ path: string, mimetype?: string }} file the multipart temp file
 * @param {{ now?: Date }} [context]
 */
export async function createEvidence(user, batch, fields, file, context = {}) {
  const uploadedAt = context.now ?? new Date();
  const { sha256, size, head } = await inspectFile(file.path);

  const hashValue = payloadHash(user, batch._id, fields, sha256);
  const existing = await Evidence.findOne({ clientEventId: fields.clientEventId }).lean();
  if (existing) return replay(existing, hashValue);

  if (EVIDENCE_CLOSED_BATCH_STATUSES.includes(batch.status)) {
    throw invalidTransition("Batch status does not allow evidence uploads");
  }

  if (size === 0) throw validationError("The file is empty", { file: ["The file is empty"] });
  const contentType = sniffContentType(head);
  if (!contentType) {
    throw new AppError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Only JPEG, PNG, PDF and MP4 files are accepted",
    );
  }
  if (SUPPORTED.has(file.mimetype ?? "") && file.mimetype !== contentType) {
    throw new AppError(
      415,
      "FILE_TYPE_MISMATCH",
      "The file content does not match its declared type",
    );
  }
  if (size > EVIDENCE_MAX_BYTES[contentType]) {
    throw new AppError(413, "FILE_TOO_LARGE", "The file is larger than the limit for its type", {
      maxBytes: EVIDENCE_MAX_BYTES[contentType],
    });
  }
  if (!KIND_CONTENT_TYPES[fields.kind].includes(contentType)) {
    throw validationError("kind does not match the file type", {
      kind: [`kind '${fields.kind}' does not accept ${contentType}`],
    });
  }

  let candidateId = null;
  if (fields.candidateId) {
    const candidate = await Candidate.findOne({ _id: fields.candidateId, batchId: batch._id })
      .select("_id")
      .lean();
    if (!candidate) {
      throw validationError("candidateId is not on this batch", {
        candidateId: ["Not a candidate of this batch"],
      });
    }
    candidateId = candidate._id;
  }

  const storage = getEvidenceStorage();
  const storageKey = `evidence/${randomUUID()}.${EVIDENCE_EXTENSIONS[contentType]}`;
  await storage.put({
    key: storageKey,
    body: createReadStream(file.path),
    size,
    contentType,
  });

  let created;
  try {
    created = await Evidence.create({
      clientEventId: fields.clientEventId,
      batchId: batch._id,
      abId: batch.abId,
      candidateId,
      kind: fields.kind,
      contentType,
      size,
      sha256,
      storageDriver: storage.name,
      storageKey,
      uploaderUserId: user._id,
      uploaderRole: user.role,
      capturedAt: new Date(fields.capturedAt),
      uploadedAt,
      ...locationFrom(fields),
      deviceId: fields.deviceId ?? null,
      payloadHash: hashValue,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two uploads of the same clientEventId arrived together. The second object stays orphaned
    // in storage (DECISIONS 321); the interface has no delete.
    const winner = await Evidence.findOne({ clientEventId: fields.clientEventId }).lean();
    if (!winner) throw err;
    return replay(winner, hashValue);
  }
  return { evidence: created.toObject(), replayed: false };
}

/** Rows the caller may read. Assessor and proctor: own uploads. ab_reviewer: own awarding body. */
function readScope(user) {
  switch (user?.role) {
    case "aa_admin":
    case "mis":
    case "ncvet_viewer":
      return {};
    case "ab_reviewer": {
      const abId = toObjectIdOrNull(user.abId);
      return abId ? { abId } : { _id: { $in: [] } };
    }
    case "assessor":
    case "proctor":
      return { uploaderUserId: user._id };
    default:
      return { _id: { $in: [] } };
  }
}

export async function listEvidence(user, query) {
  const filter = { ...readScope(user) };
  if (query.batchId) filter.batchId = toObjectIdOrNull(query.batchId);
  if (query.candidateId) filter.candidateId = toObjectIdOrNull(query.candidateId);
  if (query.kind) filter.kind = query.kind;
  if (query.uploaderId) filter.uploaderUserId = toObjectIdOrNull(query.uploaderId);
  if (query.hasLocation !== undefined) {
    filter.locationStatus = query.hasLocation ? "captured" : { $ne: "captured" };
  }
  if (query.from || query.to) {
    filter.capturedAt = {};
    if (query.from) filter.capturedAt.$gte = new Date(query.from);
    if (query.to) filter.capturedAt.$lte = new Date(query.to);
  }

  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    Evidence.countDocuments(filter),
    Evidence.find(filter).sort({ capturedAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map((doc) => presentEvidence(doc)),
  };
}

/** Unknown id is 404; a row outside the caller's scope is 403. */
export async function loadReadableEvidence(user, id) {
  const doc = await Evidence.findById(id).lean();
  if (!doc) throw notFound();
  const allowed = await Evidence.exists({ _id: doc._id, ...readScope(user) });
  if (!allowed) throw forbidden();
  return doc;
}

/**
 * Logs the download against the evidence row and, when it shows a candidate, the learner.
 * The caller awaits this before sending anything, so an unlogged download is not served.
 */
export async function recordDownload(req, doc) {
  await recordAccess(req, {
    subjectType: "evidence",
    subjectIds: [doc._id],
    kind: "detail",
    fields: ["file"],
  });
  if (doc.candidateId) {
    const candidate = await Candidate.findById(doc.candidateId).select("learnerId").lean();
    if (candidate?.learnerId) {
      await recordAccess(req, {
        subjectType: "learner",
        subjectIds: [candidate.learnerId],
        kind: "detail",
        fields: ["evidenceFile"],
      });
    }
  }
}

export function downloadName(doc) {
  return `evidence-${String(doc._id)}.${EVIDENCE_EXTENSIONS[doc.contentType]}`;
}

/**
 * A short-lived link when the driver has URLs, otherwise the stream. Call recordDownload first.
 * @returns {Promise<{ url: string, expiresAt: string } | { stream: import("node:stream").Readable, size: number }>}
 */
export async function openEvidenceFile(doc, now = new Date()) {
  const storage = getEvidenceStorage();
  const expiresInSeconds = env.EVIDENCE_SIGNED_URL_SECONDS;
  const url = await storage.signedUrl(doc.storageKey, {
    expiresInSeconds,
    contentType: doc.contentType,
    filename: downloadName(doc),
  });
  if (url) {
    return { url, expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString() };
  }
  try {
    return await storage.get(doc.storageKey);
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      throw new AppError(404, "NOT_FOUND", "The stored file is missing");
    }
    throw err;
  }
}

/**
 * Re-reads the stored file and compares size and sha256 with the row. The result is recorded on
 * the row. A mismatch or a missing file is a result, not an error.
 */
export async function verifyEvidence(user, id, now = new Date()) {
  const doc = await Evidence.findById(id).lean();
  if (!doc) throw notFound();

  let result;
  let actualSha256 = null;
  let actualSize = null;
  try {
    const { stream } = await getEvidenceStorage().get(doc.storageKey);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of stream) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    actualSha256 = hash.digest("hex");
    actualSize = bytes;
    result = actualSha256 === doc.sha256 && bytes === doc.size ? "ok" : "mismatch";
  } catch (err) {
    if (!(err instanceof StorageNotFoundError)) throw err;
    result = "missing";
  }

  const lastVerification = {
    at: now,
    byUserId: user._id,
    result,
    actualSha256: result === "mismatch" ? actualSha256 : null,
    actualSize: result === "mismatch" ? actualSize : null,
  };
  const updated = await Evidence.findOneAndUpdate(
    { _id: doc._id },
    { $set: { lastVerification }, $inc: { verifyCount: 1 } },
    { new: true },
  ).lean();
  return { before: presentEvidence(doc), evidence: updated, result };
}
