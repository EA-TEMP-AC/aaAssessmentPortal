import { createHash } from "node:crypto";
import { compliance } from "../../config/compliance.js";
import {
  conflictIdempotent,
  forbidden,
  invalidTransition,
  notFound,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { Assessor } from "../../models/assessor.model.js";
import { AwardingBody } from "../../models/awarding-body.model.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { LoginEvent } from "../../models/login-event.model.js";
import { resolveTransition } from "../batches/batch-transitions.js";
import { enqueueEmailSafely } from "../email/email-queue.service.js";

/** users.role allowed on each path. The field app maps `candidate` to the student path. */
export const LOGIN_EVENT_ROLE_BY_ACTOR = Object.freeze({
  assessor: "assessor",
  proctor: "proctor",
  student: "candidate",
});

/** docs/SCHEMA.md §3.11 validation step 2. */
export const LOGIN_EVENT_BATCH_STATUSES = Object.freeze([
  "assessor_assigned",
  "in_progress",
  "assessment_completed",
  "result_submitted",
  "ab_validated",
  "published",
  "disputed",
]);

export const AB_LOGIN_EMAIL_KIND = "assessor_login";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

/** Same user, same path, same body → same hash. `capturedAt` is compared as an instant. */
function payloadHash(user, actorType, body) {
  const canonical = stableStringify({
    userId: String(user._id),
    actorType,
    clientEventId: body.clientEventId,
    batchId: body.batchId ? body.batchId.toLowerCase() : null,
    type: body.type,
    capturedAt: new Date(body.capturedAt).toISOString(),
    locationStatus: body.locationStatus ?? (body.lat !== undefined ? "captured" : "unavailable"),
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    accuracy: body.accuracy ?? null,
    locationUnavailableReason: body.locationUnavailableReason ?? null,
    locationUnavailableDetail: body.locationUnavailableDetail ?? null,
    device: body.device ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

export function presentLoginEvent(doc, { replayed }) {
  return {
    id: String(doc._id),
    clientEventId: doc.clientEventId,
    actorType: doc.actorType,
    actorId: String(doc.actorId),
    candidateId: doc.candidateId ? String(doc.candidateId) : null,
    batchId: doc.batchId ? String(doc.batchId) : null,
    type: doc.type,
    locationStatus: doc.locationStatus,
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    accuracy: doc.accuracy ?? null,
    locationUnavailableReason: doc.locationUnavailableReason ?? null,
    locationUnavailableDetail: doc.locationUnavailableDetail ?? null,
    missingGpsFix: doc.missingGpsFix ?? (doc.locationStatus === "unavailable" || doc.lat == null),
    noGpsFix: doc.noGpsFix ?? (doc.locationStatus === "unavailable" || doc.lat == null),
    capturedAt: iso(doc.capturedAt),
    receivedAt: iso(doc.receivedAt),
    clockSkewMs: doc.clockSkewMs,
    clockSkewFlag: doc.clockSkewFlag,
    lateSync: doc.lateSync,
    device: doc.device ?? null,
    syncedAt: iso(doc.syncedAt),
    abEmailQueuedAt: iso(doc.abEmailQueuedAt),
    abEmailSentAt: iso(doc.abEmailSentAt),
    replayed,
  };
}

/**
 * docs/SCHEMA.md §3.11 validation step 1. Returns the roster row for a student.
 */
async function assertAssigned(user, actorType, batch) {
  const profileId = user.linkedProfileId;
  if (!profileId) throw forbidden();
  if (actorType === "assessor") {
    if (String(batch.assessorId ?? "") !== String(profileId)) throw forbidden();
    return null;
  }
  if (actorType === "proctor") {
    if (String(batch.proctorId ?? "") !== String(profileId)) throw forbidden();
    return null;
  }
  const row = await Candidate.findOne({
    batchId: batch._id,
    learnerId: profileId,
    active: true,
  }).lean();
  if (!row) throw forbidden();
  return row;
}

function assertInWindow(batch, capturedAt) {
  const day = istCalendarDate(capturedAt);
  if (day < batch.assessmentStartDate || day > batch.assessmentEndDate) {
    throw validationError("capturedAt is outside the assessment window", {
      capturedAt: [
        `IST date ${day} is not within ${batch.assessmentStartDate} to ${batch.assessmentEndDate}`,
      ],
    });
  }
}

function assertSamePayload(existing, hash) {
  if (existing.payloadHash !== hash) throw conflictIdempotent();
  return existing;
}

function abEmailText({ assessorName, batch, event }) {
  const accuracy = event.accuracy == null ? "" : ` (accuracy ${event.accuracy} m)`;
  const location =
    event.locationStatus === "unavailable" || event.lat == null
      ? `Unavailable (${event.locationUnavailableReason ?? "no fix"})`
      : `${event.lat}, ${event.lng}${accuracy}`;
  return [
    "An assessor has logged in for an assessment batch.",
    "",
    `Assessor: ${assessorName}`,
    `Batch: ${String(batch._id)}`,
    `Assessment window (IST): ${batch.assessmentStartDate} to ${batch.assessmentEndDate}`,
    `Captured at (device clock): ${event.capturedAt.toISOString()}`,
    `Captured on (IST date): ${istCalendarDate(event.capturedAt)}`,
    `Received at (server clock): ${event.receivedAt.toISOString()}`,
    `Location: ${location}`,
  ].join("\n");
}

/**
 * Enqueue the AB mail for an assessor login. NCVET:FR §E; NCVET:TR s9.
 * Never throws: a missing AB, a failed lookup, or a failed insert leaves
 * `abEmailQueuedAt` null and the login event stands. The claim on
 * `abEmailQueuedAt` stops a replay from queuing a second mail.
 * B-06b: Skips email enqueue if event has no batch attached (batchId is null).
 * @returns {Promise<object>} the event as stored after the attempt
 */
export async function queueAbLoginEmail(event, now = new Date()) {
  if (event.actorType !== "assessor" || event.type !== "login") return event;
  if (!event.batchId) return event;
  if (event.abEmailQueuedAt) return event;
  try {
    const claimed = await LoginEvent.findOneAndUpdate(
      { _id: event._id, abEmailQueuedAt: null },
      { $set: { abEmailQueuedAt: now } },
      { new: true },
    ).lean();
    if (!claimed) return (await LoginEvent.findById(event._id).lean()) ?? event;

    let queued = false;
    try {
      const batch = await Batch.findById(event.batchId).lean();
      const ab = batch ? await AwardingBody.findById(batch.abId).lean() : null;
      const assessor = await Assessor.findById(event.actorId).select("name").lean();
      if (batch && ab?.notificationEmails?.length) {
        const result = await enqueueEmailSafely({
          to: ab.notificationEmails,
          subject: `Assessor login: batch ${String(batch._id)}`,
          text: abEmailText({ assessorName: assessor?.name ?? "Unknown", batch, event: claimed }),
          kind: AB_LOGIN_EMAIL_KIND,
          meta: {
            loginEventId: String(event._id),
            batchId: String(batch._id),
            capturedAt: claimed.capturedAt.toISOString(),
          },
        });
        queued = result.queued;
      }
    } catch (err) {
      console.error("AB login email enqueue failed", safeErrorCode(err, "ENQUEUE_FAILED"));
    }
    if (queued) return claimed;
    return await LoginEvent.findOneAndUpdate(
      { _id: event._id },
      { $set: { abEmailQueuedAt: null } },
      { new: true },
    ).lean();
  } catch (err) {
    console.error("AB login email enqueue failed", safeErrorCode(err, "ENQUEUE_FAILED"));
    return event;
  }
}

/**
 * Record one login or logout event. docs/SCHEMA.md §3.11.
 * A repeat of the same `clientEventId` and payload returns the stored event
 * (`replayed: true`) without re-validating, so an offline queue can resend after
 * the batch has moved on. A different payload is `409 CONFLICT_IDEMPOTENT`.
 * The first valid assessor login moves `assessor_assigned` → `in_progress`.
 * B-06b: accepts batchId null (skips batch-related checks and mail) and missing GPS.
 * @param {object} user
 * @param {"assessor"|"proctor"|"student"} actorType
 * @param {object} body parsed loginEventBodySchema
 * @param {{ now?: Date, ip?: string }} [context]
 */
export async function recordLoginEvent(user, actorType, body, context = {}) {
  const receivedAt = context.now ?? new Date();
  if (LOGIN_EVENT_ROLE_BY_ACTOR[actorType] !== user?.role) throw forbidden();

  const profileId = user.linkedProfileId;
  if (!profileId) throw forbidden();

  const hash = payloadHash(user, actorType, body);
  const existing = await LoginEvent.findOne({ clientEventId: body.clientEventId }).lean();
  if (existing) {
    // A replay also retries a mail that could not be queued the first time.
    const event = await queueAbLoginEmail(assertSamePayload(existing, hash), receivedAt);
    let abId = null;
    if (existing.batchId) {
      const b = await Batch.findById(existing.batchId).select("abId").lean();
      abId = b?.abId ?? null;
    }
    return { event, replayed: true, abId };
  }

  const hasBatch = Boolean(body.batchId);
  let batch = null;
  let candidate = null;

  if (hasBatch) {
    batch = await Batch.findById(body.batchId).lean();
    if (!batch) throw notFound();
    candidate = await assertAssigned(user, actorType, batch);
    if (!LOGIN_EVENT_BATCH_STATUSES.includes(batch.status)) {
      throw invalidTransition("Batch status does not allow login events");
    }
    const capturedAt = new Date(body.capturedAt);
    assertInWindow(batch, capturedAt);
  }

  const capturedAt = new Date(body.capturedAt);
  const clockSkewMs = receivedAt.getTime() - capturedAt.getTime();
  const next =
    hasBatch && body.type === "login"
      ? resolveTransition(user.role, batch.status, "login-event")
      : null;

  const locationStatus =
    body.locationStatus ?? (body.lat !== undefined ? "captured" : "unavailable");
  const isMissingFix = locationStatus === "unavailable" || body.lat == null;

  let saved;
  try {
    saved = await withTransaction(async (session) => {
      const [created] = await LoginEvent.create(
        [
          {
            clientEventId: body.clientEventId,
            actorType,
            actorId: profileId,
            userId: user._id,
            candidateId: candidate?._id ?? null,
            batchId: batch?._id ?? null,
            type: body.type,
            locationStatus,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            accuracy: body.accuracy ?? null,
            locationUnavailableReason: body.locationUnavailableReason ?? null,
            locationUnavailableDetail: body.locationUnavailableDetail ?? null,
            missingGpsFix: isMissingFix,
            noGpsFix: isMissingFix,
            capturedAt,
            receivedAt,
            clockSkewMs,
            clockSkewFlag: Math.abs(clockSkewMs) > compliance.MAX_CLOCK_SKEW_MS,
            lateSync: istCalendarDate(receivedAt) > istCalendarDate(capturedAt),
            device: body.device,
            syncedAt: receivedAt,
            payloadHash: hash,
          },
        ],
        { session },
      );

      let moved = null;
      if (next && batch) {
        moved = await Batch.findOneAndUpdate(
          { _id: batch._id, status: batch.status, statusVersion: batch.statusVersion },
          { $set: { status: next.to }, $inc: { statusVersion: 1 } },
          { new: true, runValidators: true, session },
        ).lean();
        if (!moved) {
          // Raced with another status change. The event stands only if the
          // batch is still in a status that accepts login events.
          const current = await Batch.findById(batch._id).session(session).lean();
          if (!current || !LOGIN_EVENT_BATCH_STATUSES.includes(current.status)) {
            throw invalidTransition("Batch status does not allow login events");
          }
        }
      }
      return { event: created.toObject(), moved };
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two submissions of the same clientEventId arrived together.
    const winner = await LoginEvent.findOne({ clientEventId: body.clientEventId }).lean();
    if (!winner) throw err;
    return { event: assertSamePayload(winner, hash), replayed: true, abId: batch?.abId ?? null };
  }

  if (saved.moved && batch) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "batch.login-event",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      before: { status: batch.status, statusVersion: batch.statusVersion },
      after: { status: saved.moved.status, statusVersion: saved.moved.statusVersion },
      meta: { loginEventId: String(saved.event._id) },
      ip: context.ip,
    });
  }

  const event = await queueAbLoginEmail(saved.event, receivedAt);
  return { event, replayed: false, abId: batch?.abId ?? null };
}
