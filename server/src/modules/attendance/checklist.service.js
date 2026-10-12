import { createHash } from "node:crypto";
import { AppError, conflictIdempotent, forbidden, invalidTransition } from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { Batch } from "../../models/batch.model.js";
import { EquipmentChecklist } from "../../models/equipment-checklist.model.js";
import { ATTENDANCE_WRITE_ROLES } from "../../models/roles.js";
import { resolveTransition } from "../batches/batch-transitions.js";
import { loadReadableBatch } from "../batches/batch.service.js";
import { stableStringify } from "../login-events/login-event.service.js";
import { candidatesMissingAttendance, loadBatchForFieldWrite } from "./attendance.service.js";

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

/** Same user, same batch, same body → same hash. `capturedAt` is compared as an instant. */
function payloadHash(user, batchId, body) {
  const canonical = stableStringify({
    userId: String(user._id),
    batchId: batchId.toLowerCase(),
    clientEventId: body.clientEventId,
    capturedAt: new Date(body.capturedAt).toISOString(),
    items: body.items,
    completeAssessment: body.completeAssessment,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function presentChecklist(doc) {
  return {
    id: String(doc._id),
    clientEventId: doc.clientEventId,
    batchId: String(doc.batchId),
    assessorId: String(doc.assessorId),
    items: doc.items.map((item) => ({
      key: item.key,
      label: item.label ?? null,
      available: item.available,
      note: item.note ?? null,
    })),
    completeAssessment: doc.completeAssessment,
    capturedAt: iso(doc.capturedAt),
    receivedAt: iso(doc.receivedAt),
  };
}

function assertSamePayload(existing, hash) {
  if (existing.payloadHash !== hash) throw conflictIdempotent();
  return existing;
}

async function replay(existing) {
  const batch = await Batch.findById(existing.batchId).select("status statusVersion abId").lean();
  return { checklist: existing, replayed: true, batch, abId: batch?.abId };
}

/**
 * Record one equipment checklist. docs/SCHEMA.md §3.13. NCVET:FR §E.
 * A repeat of the same `clientEventId` and payload returns the stored row
 * (`replayed: true`) without re-validating, so an offline queue can resend after
 * the batch has moved on. A different payload is `409 CONFLICT_IDEMPOTENT`.
 * With `completeAssessment: true` the batch moves `in_progress` →
 * `assessment_completed` (SCHEMA §1.2 checklist/attendance gate): every active
 * roster candidate must already have an attendance row.
 * @param {object} user
 * @param {string} batchId
 * @param {object} body parsed checklistBodySchema
 * @param {{ now?: Date, ip?: string }} [context]
 */
export async function recordChecklist(user, batchId, body, context = {}) {
  const receivedAt = context.now ?? new Date();
  if (!ATTENDANCE_WRITE_ROLES.includes(user?.role)) throw forbidden();

  const hash = payloadHash(user, batchId, body);
  const existing = await EquipmentChecklist.findOne({ clientEventId: body.clientEventId }).lean();
  if (existing) return replay(assertSamePayload(existing, hash));

  const capturedAt = new Date(body.capturedAt);
  const batch = await loadBatchForFieldWrite(user, batchId, capturedAt);

  let next = null;
  if (body.completeAssessment) {
    next = resolveTransition(user.role, batch.status, "checklist");
    if (!next) throw invalidTransition();
    const missing = await candidatesMissingAttendance(batch._id);
    if (missing.length > 0) {
      throw new AppError(409, "INVALID_TRANSITION", "Attendance is missing for active candidates", {
        missingAttendance: missing,
      });
    }
  }

  let saved;
  try {
    saved = await withTransaction(async (session) => {
      const [created] = await EquipmentChecklist.create(
        [
          {
            clientEventId: body.clientEventId,
            batchId: batch._id,
            assessorId: user.linkedProfileId,
            userId: user._id,
            items: body.items,
            completeAssessment: body.completeAssessment,
            capturedAt,
            receivedAt,
            payloadHash: hash,
          },
        ],
        { session },
      );
      if (!next) return { checklist: created.toObject(), moved: null };

      const moved = await Batch.findOneAndUpdate(
        { _id: batch._id, status: batch.status, statusVersion: batch.statusVersion },
        { $set: { status: next.to }, $inc: { statusVersion: 1 } },
        { new: true, runValidators: true, session },
      ).lean();
      // Raced with another status change: nothing is stored.
      if (!moved) throw invalidTransition();
      return { checklist: created.toObject(), moved };
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two submissions of the same clientEventId arrived together.
    const winner = await EquipmentChecklist.findOne({ clientEventId: body.clientEventId }).lean();
    if (!winner) throw err;
    return replay(assertSamePayload(winner, hash));
  }

  if (saved.moved) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "batch.checklist",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      before: { status: batch.status, statusVersion: batch.statusVersion },
      after: { status: saved.moved.status, statusVersion: saved.moved.statusVersion },
      meta: { checklistId: String(saved.checklist._id) },
      ip: context.ip,
    });
  }

  return {
    checklist: saved.checklist,
    replayed: false,
    batch: saved.moved ?? batch,
    abId: batch.abId,
  };
}

/**
 * GET /batches/:id/checklist. Newest `capturedAt` first; `latest` keeps one.
 */
export async function listChecklists(user, batchId, { latest = false } = {}) {
  const batch = await loadReadableBatch(user, batchId);
  const query = EquipmentChecklist.find({ batchId: batch._id }).sort({ capturedAt: -1, _id: -1 });
  if (latest) query.limit(1);
  const docs = await query.lean();
  return { items: docs.map(presentChecklist) };
}
