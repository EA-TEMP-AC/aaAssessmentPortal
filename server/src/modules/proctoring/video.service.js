import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { compliance } from "../../config/compliance.js";
import { resolveBatchSettings } from "../../config/batch-settings.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { Batch } from "../../models/batch.model.js";
import { ExamVideoChunk } from "../../models/exam-video-chunk.model.js";
import { AuditLog } from "../../models/audit-log.model.js";
import { recordAccess } from "../audit/access-log.service.js";
import { loadOwnSession, loadReadableSession } from "./proctoring.service.js";
import { deleteVideo, putVideo, readVideo, videoKey } from "./video-storage.js";

/** X-27. Exam video: the camera and the shared screen, sent as short pieces during the exam. */
export const VIDEO_MAX_PIECES = 6000; // about 16 hours of 10-second pieces
const DAY_MS = 24 * 60 * 60 * 1000;
const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

async function batchSettingsOf(batchId) {
  const batch = await Batch.findById(batchId).select("settings").lean();
  return resolveBatchSettings(batch?.settings);
}

/** POST /proctoring/sessions/:id/video/:track/:seq. Idempotent on (session, track, seq). */
export async function saveVideoPiece(user, id, { track, seq }, bytes, now = new Date()) {
  const session = await loadOwnSession(user, id);
  const settings = await batchSettingsOf(session.batchId);
  if (settings.recordVideo !== true) {
    throw new AppError(409, "VIDEO_NOT_ENABLED", "This batch does not record the exam video");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Send the video piece as the request body", {
      file: ["Send a video/webm piece as the request body"],
    });
  }
  if (bytes.length > compliance.EXAM_VIDEO_CHUNK_MAX_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "The video piece is too large", {
      maxBytes: compliance.EXAM_VIDEO_CHUNK_MAX_BYTES,
    });
  }
  // The first piece carries the file header; the type is read from the bytes, not the header.
  if (seq === 0 && !bytes.subarray(0, 4).equals(EBML_HEADER)) {
    throw new AppError(400, "VALIDATION_ERROR", "The first piece is not a WebM video", {
      file: ["The first piece is not a WebM video"],
    });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await ExamVideoChunk.findOne({ sessionId: session._id, track, seq }).lean();
  if (existing) {
    if (existing.sha256 !== sha256) {
      throw new AppError(409, "VIDEO_PIECE_CONFLICT", "A different piece was already saved here");
    }
    return { track, seq, size: existing.size, replayed: true, session };
  }
  const storageKey = videoKey(String(session._id), track, seq);
  await putVideo(storageKey, bytes);
  try {
    await ExamVideoChunk.create({
      sessionId: session._id,
      attemptId: session.attemptId,
      batchId: session.batchId,
      abId: session.abId,
      track,
      seq,
      size: bytes.length,
      sha256,
      storageKey,
      receivedAt: now,
      expiresAt: new Date(now.getTime() + compliance.EXAM_VIDEO_RETENTION_DAYS * DAY_MS),
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return { track, seq, size: bytes.length, replayed: true, session };
  }
  return { track, seq, size: bytes.length, replayed: false, session };
}

/** AA admin always; other roles only when the batch settings name them. Scope is checked first. */
async function loadWatchable(user, id) {
  const { session, batch } = await loadReadableSession(user, id);
  const settings = await batchSettingsOf(session.batchId);
  const allowed = user.role === "aa_admin" || settings.videoVisibleTo.includes(user.role);
  if (!allowed) throw forbidden();
  return { session, batch, settings };
}

/** GET /proctoring/sessions/:id/video. What was recorded, per track. No bytes. */
export async function listVideo(user, id) {
  const { session, settings } = await loadWatchable(user, id);
  const rows = await ExamVideoChunk.find({ sessionId: session._id })
    .select("track seq size receivedAt expiresAt")
    .sort({ seq: 1 })
    .lean();
  const tracks = {};
  for (const track of ["camera", "screen"]) {
    const mine = rows.filter((r) => r.track === track);
    tracks[track] = {
      pieces: mine.length,
      bytes: mine.reduce((sum, r) => sum + r.size, 0),
      firstReceivedAt: mine[0]?.receivedAt?.toISOString() ?? null,
      lastReceivedAt: mine.at(-1)?.receivedAt?.toISOString() ?? null,
      // A gap means some pieces never arrived; the video still plays but skips there.
      complete: mine.length > 0 && mine.at(-1).seq === mine.length - 1,
    };
  }
  return {
    sessionId: String(session._id),
    recordVideo: settings.recordVideo === true,
    canDownload: settings.downloadSessionVideo === true,
    // X-30: with `video` the viewer jumps to the moment of a flag. startedAt is when the session began;
    // the recording starts a moment later, so the jump is about right, not exact.
    flagEvidence: settings.ufmEvidence,
    startedAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
    retentionDays: compliance.EXAM_VIDEO_RETENTION_DAYS,
    expiresAt: rows.length
      ? rows
          .map((r) => r.expiresAt)
          .sort((a, b) => b - a)[0]
          .toISOString()
      : null,
    tracks,
  };
}

/** GET /proctoring/sessions/:id/video/:track. The pieces joined in order. The look is logged first. */
export async function openVideoTrack(req, id, track, { download = false } = {}) {
  const { session, settings } = await loadWatchable(req.user, id);
  // X-28: saving a copy needs the batch's download switch; watching does not.
  if (download && !settings.downloadSessionVideo) throw forbidden();
  const rows = await ExamVideoChunk.find({ sessionId: session._id, track })
    .select("storageKey size")
    .sort({ seq: 1 })
    .lean();
  if (rows.length === 0) throw notFound();
  await recordAccess(req, {
    subjectType: "proctoringSession",
    subjectIds: [String(session._id)],
    kind: "detail",
    fields: [download ? `exam_video_${track}_download` : `exam_video_${track}`],
  });
  // One piece at a time, so a long exam is never held in memory whole.
  return Readable.from(
    (async function* pieces() {
      for (const row of rows) {
        try {
          yield await readVideo(row.storageKey);
        } catch {
          // A piece that is gone is skipped; the player jumps over the gap.
        }
      }
    })(),
  );
}

/** Deletes pieces past their retention date, files first. Returns how many were removed. */
export async function deleteExpiredVideo(now = new Date(), batchSize = 500) {
  let removed = 0;
  for (;;) {
    const rows = await ExamVideoChunk.find({ expiresAt: { $lt: now } })
      .select("storageKey")
      .limit(batchSize)
      .lean();
    if (rows.length === 0) break;
    for (const row of rows) await deleteVideo(row.storageKey);
    await ExamVideoChunk.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
    removed += rows.length;
  }
  if (removed > 0) {
    await AuditLog.create({
      actorRole: "system",
      action: "exam_video.expire",
      entity: "examVideo",
      entityId: "retention",
      before: null,
      after: { removed },
      meta: { retentionDays: compliance.EXAM_VIDEO_RETENTION_DAYS },
    });
  }
  return removed;
}

export const EXAM_VIDEO_JOB_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Process-local timer, like the SLA job. Tests call deleteExpiredVideo directly. */
export function startExamVideoCleanup({ intervalMs = EXAM_VIDEO_JOB_INTERVAL_MS } = {}) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    deleteExpiredVideo()
      .catch(() => console.error("exam video cleanup failed"))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
