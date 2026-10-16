import { createHash } from "node:crypto";
import { compliance } from "../../config/compliance.js";
import {
  AppError,
  conflictIdempotent,
  forbidden,
  notFound,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { toObjectIdOrNull } from "../../lib/object-id.js";
import { batchQueryFilter, batchScopeFor, isInBatchScope } from "../../middleware/scope.js";
import { Attempt } from "../../models/attempt.model.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Evidence } from "../../models/evidence.model.js";
import { ProctoringFlag, PROCTORING_SEVERITIES } from "../../models/proctoring-flag.model.js";
import { ProctoringSession } from "../../models/proctoring-session.model.js";
import { PROCTORING_INVALIDATE_ROLES, PROCTORING_LOCATION_ROLES } from "../../models/roles.js";
import { stableStringify } from "../login-events/login-event.service.js";
import { flagReason } from "./flag-reason.js";

/** Shown to the candidate when a reviewer warns without writing a message. */
export const DEFAULT_WARNING_MESSAGE =
  "The proctor noticed something during your exam. Please follow the exam rules.";

const idStr = (v) => (v == null ? null : String(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);
const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

/** The numbers the candidate's browser works with. All from compliance.js. */
export function proctoringConfig() {
  return {
    snapshotIntervalSeconds: compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS,
    detectionIntervalMs: compliance.PROCTOR_DETECTION_INTERVAL_MS,
    flagCooldownSeconds: compliance.PROCTOR_FLAG_COOLDOWN_SECONDS,
    sustainedSeconds: { ...compliance.PROCTOR_SUSTAINED_SECONDS },
    // X-07: the browser draws the severity on the flag photo.
    flagSeverity: { ...compliance.PROCTOR_FLAG_SEVERITY },
  };
}

export function severityOf(type) {
  return compliance.PROCTOR_FLAG_SEVERITY[type];
}

function feedLostMs() {
  return (
    compliance.PROCTOR_FEED_LOST_INTERVALS * compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS * 1000
  );
}

/**
 * `ended` once the attempt is closed; `feed_lost` when no heartbeat came for 3 snapshot
 * intervals (the session start counts as the first sign of life); `active` otherwise.
 */
export function displayStatus(session, attemptStatus, now = new Date()) {
  if (attemptStatus && attemptStatus !== "in_progress") return "ended";
  const seen = new Date(session.lastSeenAt ?? session.createdAt).getTime();
  return now.getTime() - seen > feedLostMs() ? "feed_lost" : "active";
}

function counts(session) {
  return {
    low: session.flagCounts?.low ?? 0,
    medium: session.flagCounts?.medium ?? 0,
    high: session.flagCounts?.high ?? 0,
  };
}

/** Audit view of a session. Ids, times and counts only. */
function sessionAuditView(session) {
  return {
    attemptId: idStr(session.attemptId),
    batchId: idStr(session.batchId),
    candidateId: idStr(session.candidateId),
    lastSeenAt: iso(session.lastSeenAt),
    flagCounts: counts(session),
    warningCount: session.warnings?.length ?? 0,
    invalidationRecommended: session.invalidationRecommendedAt != null,
  };
}

/** Audit view of a flag. Never the note text, only its length. */
function flagAuditView(flag) {
  return {
    sessionId: idStr(flag.sessionId),
    type: flag.type,
    severity: flag.severity,
    capturedAt: iso(flag.capturedAt),
    evidenceId: idStr(flag.evidenceId),
    detail: flag.detail ?? null,
    decision: flag.review?.decision ?? null,
    noteLength: flag.review?.note ? flag.review.note.length : 0,
  };
}

function presentFlag(flag) {
  return {
    id: idStr(flag._id),
    sessionId: idStr(flag.sessionId),
    clientEventId: flag.clientEventId,
    type: flag.type,
    severity: flag.severity,
    capturedAt: iso(flag.capturedAt),
    receivedAt: iso(flag.receivedAt),
    detail: flag.detail ?? null,
    sustainedSeconds: compliance.PROCTOR_SUSTAINED_SECONDS[flag.type] ?? null,
    evidenceId: idStr(flag.evidenceId),
    // X-07: whether coordinates were kept. The coordinates themselves come from /flags/:id/capture.
    locationStatus: flag.locationStatus ?? "not_shared",
    review: flag.review
      ? {
          decision: flag.review.decision,
          note: flag.review.note ?? null,
          decidedAt: iso(flag.review.decidedAt),
          decidedBy: idStr(flag.review.decidedBy),
          decidedByRole: flag.review.decidedByRole,
        }
      : null,
  };
}

function presentWarning(w) {
  return { id: idStr(w._id), message: w.message, createdAt: iso(w.createdAt) };
}

/* ------------------------------------------------------------- candidate */

function ownsSession(user, session) {
  return idStr(session.userId) === idStr(user._id);
}

async function attemptStatusOf(attemptId) {
  const attempt = await Attempt.findById(attemptId).select("status").lean();
  return attempt?.status ?? null;
}

function presentForCandidate(session, attemptStatus, now, captureLocation = false) {
  return {
    id: idStr(session._id),
    attemptId: idStr(session.attemptId),
    batchId: idStr(session.batchId),
    status: displayStatus(session, attemptStatus, now),
    config: proctoringConfig(),
    // X-07: tells the browser whether to add its location to flag photos.
    captureLocation,
  };
}

async function captureLocationOf(batchId) {
  const batch = await Batch.findById(batchId).select("captureLocation").lean();
  return batch?.captureLocation === true;
}

/**
 * POST /proctoring/sessions. One session per attempt: a repeat returns the same session.
 * A new session needs the attempt to be in progress.
 */
export async function createSession(user, { attemptId }, now = new Date()) {
  const attempt = await Attempt.findById(attemptId).lean();
  if (!attempt) throw notFound();
  if (idStr(attempt.userId) !== idStr(user._id)) throw forbidden();

  const existing = await ProctoringSession.findOne({ attemptId: attempt._id }).lean();
  if (existing) {
    return {
      session: existing,
      created: false,
      body: presentForCandidate(
        existing,
        attempt.status,
        now,
        await captureLocationOf(existing.batchId),
      ),
    };
  }
  if (attempt.status !== "in_progress") {
    throw new AppError(409, "PROCTORING_ATTEMPT_CLOSED", "The attempt is already closed", {
      status: attempt.status,
    });
  }
  let session;
  try {
    const doc = await ProctoringSession.create({
      attemptId: attempt._id,
      batchId: attempt.batchId,
      abId: attempt.abId,
      candidateId: attempt.candidateId,
      learnerId: attempt.learnerId,
      userId: user._id,
      lastSeenAt: now,
    });
    session = doc.toObject();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two starts at once: the second gets the first one's session.
    const winner = await ProctoringSession.findOne({ attemptId: attempt._id }).lean();
    return {
      session: winner,
      created: false,
      body: presentForCandidate(
        winner,
        attempt.status,
        now,
        await captureLocationOf(winner.batchId),
      ),
    };
  }
  return {
    session,
    created: true,
    body: presentForCandidate(
      session,
      attempt.status,
      now,
      await captureLocationOf(session.batchId),
    ),
  };
}

async function loadOwnSession(user, id) {
  const session = await ProctoringSession.findById(id).lean();
  if (!session) throw notFound();
  if (!ownsSession(user, session)) throw forbidden();
  return session;
}

/** POST /proctoring/sessions/:id/heartbeat */
export async function heartbeat(user, id, now = new Date()) {
  const before = await loadOwnSession(user, id);
  const session = await ProctoringSession.findOneAndUpdate(
    { _id: before._id },
    { $set: { lastSeenAt: now } },
    { new: true },
  ).lean();
  const attemptStatus = await attemptStatusOf(session.attemptId);
  return {
    session,
    before: { lastSeenAt: iso(before.lastSeenAt) },
    after: { lastSeenAt: iso(session.lastSeenAt) },
    body: {
      id: idStr(session._id),
      status: displayStatus(session, attemptStatus, now),
      lastSeenAt: iso(session.lastSeenAt),
      serverTime: now.toISOString(),
    },
  };
}

function flagPayloadHash(session, body) {
  return createHash("sha256")
    .update(
      stableStringify({
        sessionId: idStr(session._id),
        clientEventId: body.clientEventId,
        type: body.type,
        capturedAt: new Date(body.capturedAt).toISOString(),
        detail: body.detail ?? null,
        evidenceId: body.evidenceId?.toLowerCase() ?? null,
      }),
    )
    .digest("hex");
}

function presentFlagForCandidate(flag, replayed) {
  return {
    id: idStr(flag._id),
    sessionId: idStr(flag.sessionId),
    clientEventId: flag.clientEventId,
    type: flag.type,
    severity: flag.severity,
    capturedAt: iso(flag.capturedAt),
    receivedAt: iso(flag.receivedAt),
    evidenceId: idStr(flag.evidenceId),
    replayed,
  };
}

function replayFlag(existing, hashValue) {
  if (existing.payloadHash !== hashValue) throw conflictIdempotent();
  return { flag: existing, replayed: true, body: presentFlagForCandidate(existing, true) };
}

const TRANSACTIONS_UNSUPPORTED = 20;
let warnedNoTransactions = false;

/**
 * Saves the flag and bumps the session's count together. A MongoDB without a replica set refuses
 * transactions with code 20 (IllegalOperation); the flag then goes in as two plain writes so it
 * is not lost. A replica set (docker-compose.yml) is still the supported set-up. X-06.
 */
async function saveFlagAndCount(sessionId, flagDoc, bump) {
  try {
    return await withTransaction(async (tx) => {
      const [created] = await ProctoringFlag.create([flagDoc], { session: tx });
      await ProctoringSession.updateOne({ _id: sessionId }, bump, { session: tx });
      return created.toObject();
    });
  } catch (err) {
    if (err?.code !== TRANSACTIONS_UNSUPPORTED) throw err;
    if (!warnedNoTransactions) {
      warnedNoTransactions = true;
      console.warn(
        "MongoDB is not a replica set: proctoring flags are saved without a transaction. See README.",
      );
    }
    const created = await ProctoringFlag.create(flagDoc);
    await ProctoringSession.updateOne({ _id: sessionId }, bump);
    return created.toObject();
  }
}

/**
 * POST /proctoring/sessions/:id/flags. Idempotent on `clientEventId` within the session.
 * The server sets the severity. A flag only records; it never changes the attempt.
 */
export async function recordFlag(user, id, body, now = new Date()) {
  const session = await loadOwnSession(user, id);
  const hashValue = flagPayloadHash(session, body);
  const existing = await ProctoringFlag.findOne({
    sessionId: session._id,
    clientEventId: body.clientEventId,
  }).lean();
  if (existing) return { ...replayFlag(existing, hashValue), session };

  let evidenceId = null;
  if (body.evidenceId) {
    const evidence = await Evidence.findOne({
      _id: body.evidenceId,
      sessionId: session._id,
      kind: "proctor_snapshot",
    })
      .select("_id")
      .lean();
    if (!evidence) {
      throw validationError("evidenceId is not a snapshot of this session", {
        evidenceId: ["Not a proctor_snapshot of this session"],
      });
    }
    evidenceId = evidence._id;
  }

  // X-07: coordinates are kept only while the batch has location capture on. They are not part of
  // the payload hash, so they never sit in a hash either.
  const keepLocation = body.location != null && (await captureLocationOf(session.batchId));
  const severity = severityOf(body.type);
  const flagDoc = {
    sessionId: session._id,
    attemptId: session.attemptId,
    batchId: session.batchId,
    abId: session.abId,
    clientEventId: body.clientEventId,
    type: body.type,
    severity,
    capturedAt: new Date(body.capturedAt),
    receivedAt: now,
    detail: body.detail ?? null,
    evidenceId,
    locationStatus: keepLocation ? "captured" : "not_shared",
    location: keepLocation ? JSON.stringify(body.location) : null,
    payloadHash: hashValue,
  };
  const bump = { $inc: { [`flagCounts.${severity}`]: 1 } };
  try {
    const flag = await saveFlagAndCount(session._id, flagDoc, bump);
    return { flag, replayed: false, session, body: presentFlagForCandidate(flag, false) };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const winner = await ProctoringFlag.findOne({
      sessionId: session._id,
      clientEventId: body.clientEventId,
    }).lean();
    if (!winner) throw err;
    return { ...replayFlag(winner, hashValue), session };
  }
}

/** GET /proctoring/sessions/:id/warnings. The candidate's own session, oldest first. */
export async function listWarnings(user, id) {
  const session = await loadOwnSession(user, id);
  return (session.warnings ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(presentWarning);
}

/** Used by the evidence upload: the candidate's own session on this batch, else 403. */
export async function loadSnapshotSession(user, sessionId, batchId) {
  const session = await ProctoringSession.findById(sessionId).lean();
  if (!session) {
    throw validationError("sessionId is not a proctoring session", {
      sessionId: ["Unknown proctoring session"],
    });
  }
  if (!ownsSession(user, session) || idStr(session.batchId) !== idStr(batchId)) {
    throw forbidden();
  }
  return session;
}

/* ----------------------------------------------------------------- staff */

async function loadReadableSession(user, id) {
  const session = await ProctoringSession.findById(id).lean();
  if (!session) throw notFound();
  const batch = await Batch.findById(session.batchId)
    .select("abId tpId assessorId proctorId")
    .lean();
  if (!isInBatchScope(user, batch)) throw forbidden();
  return { session, batch };
}

async function candidateNames(ids) {
  const docs = await Candidate.find({ _id: { $in: ids } })
    .select("name")
    .lean();
  return new Map(docs.map((d) => [String(d._id), d.name]));
}

function presentForStaff(session, { attemptStatus, name, unreviewed, now }) {
  return {
    id: idStr(session._id),
    attemptId: idStr(session.attemptId),
    batchId: idStr(session.batchId),
    abId: idStr(session.abId),
    candidateId: idStr(session.candidateId),
    candidateName: name ?? null,
    status: displayStatus(session, attemptStatus, now),
    attemptStatus: attemptStatus ?? null,
    startedAt: iso(session.createdAt),
    lastSeenAt: iso(session.lastSeenAt),
    flagCounts: counts(session),
    unreviewedCount: unreviewed ?? 0,
    warningCount: session.warnings?.length ?? 0,
    invalidationRecommended: session.invalidationRecommendedAt != null,
    invalidationRecommendedAt: iso(session.invalidationRecommendedAt),
  };
}

function minSeverityFilter(minSeverity) {
  const levels = PROCTORING_SEVERITIES.filter(
    (s) => SEVERITY_RANK[s] >= SEVERITY_RANK[minSeverity],
  );
  return { $or: levels.map((s) => ({ [`flagCounts.${s}`]: { $gt: 0 } })) };
}

async function scopeFilter(user) {
  const scope = batchScopeFor(user);
  if (scope.kind === "all") return {};
  if (user.role === "ab_reviewer") {
    const abId = toObjectIdOrNull(user.abId);
    return abId ? { abId } : { _id: { $in: [] } };
  }
  const batches = await Batch.find(batchQueryFilter(user)).select("_id").lean();
  return { batchId: { $in: batches.map((b) => b._id) } };
}

/**
 * GET /proctoring/sessions. The shown status is computed, so the status filter and the paging
 * run after the attempts are read. Newest session first.
 */
export async function listSessions(user, query, now = new Date()) {
  const filter = { ...(await scopeFilter(user)) };
  if (query.batchId) {
    const batchId = toObjectIdOrNull(query.batchId);
    filter.batchId =
      filter.batchId?.$in != null
        ? { $in: filter.batchId.$in.filter((b) => String(b) === String(batchId)) }
        : batchId;
  }
  if (query.minSeverity) Object.assign(filter, minSeverityFilter(query.minSeverity));

  const sessions = await ProctoringSession.find(filter).sort({ createdAt: -1, _id: -1 }).lean();
  const attempts = await Attempt.find({ _id: { $in: sessions.map((s) => s.attemptId) } })
    .select("status")
    .lean();
  const statusById = new Map(attempts.map((a) => [String(a._id), a.status]));
  const withStatus = sessions
    .map((s) => ({ session: s, attemptStatus: statusById.get(String(s.attemptId)) ?? null }))
    .filter(
      ({ session, attemptStatus }) =>
        !query.status || displayStatus(session, attemptStatus, now) === query.status,
    );

  const start = (query.page - 1) * query.pageSize;
  const page = withStatus.slice(start, start + query.pageSize);
  const ids = page.map(({ session }) => session._id);
  const [names, pending] = await Promise.all([
    candidateNames(page.map(({ session }) => session.candidateId)),
    ProctoringFlag.aggregate([
      { $match: { sessionId: { $in: ids }, review: null } },
      { $group: { _id: "$sessionId", n: { $sum: 1 } } },
    ]),
  ]);
  const pendingById = new Map(pending.map((p) => [String(p._id), p.n]));
  return {
    page: query.page,
    pageSize: query.pageSize,
    total: withStatus.length,
    serverTime: now.toISOString(),
    items: page.map(({ session, attemptStatus }) =>
      presentForStaff(session, {
        attemptStatus,
        name: names.get(String(session.candidateId)),
        unreviewed: pendingById.get(String(session._id)) ?? 0,
        now,
      }),
    ),
  };
}

async function loadFlags(sessionId) {
  return ProctoringFlag.find({ sessionId }).sort({ capturedAt: 1, _id: 1 }).lean();
}

/** GET /proctoring/sessions/:id with every flag, oldest first. */
export async function getSessionDetail(user, id, now = new Date()) {
  const { session } = await loadReadableSession(user, id);
  const [attemptStatus, names, flags] = await Promise.all([
    attemptStatusOf(session.attemptId),
    candidateNames([session.candidateId]),
    loadFlags(session._id),
  ]);
  return {
    ...presentForStaff(session, {
      attemptStatus,
      name: names.get(String(session.candidateId)),
      unreviewed: flags.filter((f) => !f.review).length,
      now,
    }),
    serverTime: now.toISOString(),
    warnings: (session.warnings ?? []).map(presentWarning),
    flags: flags.map(presentFlag),
  };
}

/** GET /proctoring/sessions/:id/report. P-04: counts, timeline and decisions. Writes nothing. */
export async function getReport(user, id, now = new Date()) {
  const { session } = await loadReadableSession(user, id);
  const [attemptStatus, names, flags] = await Promise.all([
    attemptStatusOf(session.attemptId),
    candidateNames([session.candidateId]),
    loadFlags(session._id),
  ]);
  const byTypeMap = new Map();
  for (const f of flags) {
    const row = byTypeMap.get(f.type) ?? { type: f.type, severity: f.severity, count: 0 };
    row.count += 1;
    byTypeMap.set(f.type, row);
  }
  const byType = [...byTypeMap.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.type.localeCompare(b.type),
  );
  const bySeverity = { low: 0, medium: 0, high: 0 };
  for (const f of flags) bySeverity[f.severity] += 1;
  const reviewed = flags.filter((f) => f.review);
  return {
    sessionId: idStr(session._id),
    attemptId: idStr(session.attemptId),
    batchId: idStr(session.batchId),
    candidateId: idStr(session.candidateId),
    candidateName: names.get(String(session.candidateId)) ?? null,
    generatedAt: now.toISOString(),
    status: displayStatus(session, attemptStatus, now),
    attemptStatus,
    startedAt: iso(session.createdAt),
    lastSeenAt: iso(session.lastSeenAt),
    invalidationRecommended: session.invalidationRecommendedAt != null,
    invalidationRecommendedAt: iso(session.invalidationRecommendedAt),
    totals: {
      flags: flags.length,
      bySeverity,
      reviewed: reviewed.length,
      unreviewed: flags.length - reviewed.length,
      warnings: session.warnings?.length ?? 0,
    },
    byType,
    timeline: flags.map((f) => ({
      flagId: idStr(f._id),
      type: f.type,
      severity: f.severity,
      capturedAt: iso(f.capturedAt),
      receivedAt: iso(f.receivedAt),
      evidenceId: idStr(f.evidenceId),
      decision: f.review?.decision ?? null,
    })),
    decisions: reviewed
      .slice()
      .sort((a, b) => new Date(a.review.decidedAt) - new Date(b.review.decidedAt))
      .map((f) => ({
        flagId: idStr(f._id),
        type: f.type,
        severity: f.severity,
        decision: f.review.decision,
        note: f.review.note ?? null,
        decidedAt: iso(f.review.decidedAt),
        decidedByRole: f.review.decidedByRole,
      })),
  };
}

/**
 * PATCH /proctoring/flags/:id/review. One decision per flag. `warn` adds a warning the candidate
 * can read; `invalidate_recommended` (aa_admin only) marks the session. Neither touches the
 * attempt or the result.
 */
export async function reviewFlag(user, flagId, { decision, note }, now = new Date()) {
  const flag = await ProctoringFlag.findById(flagId).lean();
  if (!flag) throw notFound();
  const batch = await Batch.findById(flag.batchId).select("abId assessorId proctorId").lean();
  if (!isInBatchScope(user, batch)) throw forbidden();
  if (decision === "invalidate_recommended" && !PROCTORING_INVALIDATE_ROLES.includes(user.role)) {
    throw forbidden("Only aa_admin may recommend invalidation");
  }
  if (flag.review) {
    throw new AppError(409, "PROCTORING_FLAG_REVIEWED", "This flag already has a decision", {
      decision: flag.review.decision,
    });
  }
  const cleanNote = note ? note : null;
  const review = {
    decision,
    note: cleanNote,
    decidedAt: now,
    decidedBy: user._id,
    decidedByRole: user.role,
  };

  const result = await withTransaction(async (tx) => {
    const updated = await ProctoringFlag.findOneAndUpdate(
      { _id: flag._id, review: null },
      { $set: { review } },
      { new: true, session: tx },
    ).lean();
    if (!updated) return null;
    const sessionBefore = await ProctoringSession.findById(flag.sessionId).session(tx).lean();
    let sessionAfter = sessionBefore;
    if (decision === "warn") {
      sessionAfter = await ProctoringSession.findOneAndUpdate(
        { _id: flag.sessionId },
        {
          $push: {
            warnings: {
              flagId: flag._id,
              message: cleanNote ?? DEFAULT_WARNING_MESSAGE,
              createdAt: now,
              createdBy: user._id,
            },
          },
        },
        { new: true, session: tx },
      ).lean();
    } else if (
      decision === "invalidate_recommended" &&
      sessionBefore.invalidationRecommendedAt == null
    ) {
      sessionAfter = await ProctoringSession.findOneAndUpdate(
        { _id: flag.sessionId },
        {
          $set: {
            invalidationRecommendedAt: now,
            invalidationRecommendedBy: user._id,
            invalidationRecommendedFlagId: flag._id,
          },
        },
        { new: true, session: tx },
      ).lean();
    }
    return { updated, sessionBefore, sessionAfter };
  });
  if (!result) {
    throw new AppError(409, "PROCTORING_FLAG_REVIEWED", "This flag already has a decision");
  }
  return {
    flag: result.updated,
    before: {
      flag: flagAuditView(flag),
      session: sessionAuditView(result.sessionBefore),
    },
    after: {
      flag: flagAuditView(result.updated),
      session: sessionAuditView(result.sessionAfter),
    },
    body: presentFlag(result.updated),
  };
}

/**
 * GET /proctoring/flags/:id/capture. X-07: what the server saved about a flag photo, to read next
 * to the picture. The reason is built here, not read from the picture. Coordinates are returned
 * only to aa_admin, the batch's training partner and the assigned proctor; `readers` says whose
 * personal data to log (the flag, and the learner it shows).
 */
export async function getFlagCapture(user, flagId) {
  const flag = await ProctoringFlag.findById(flagId).lean();
  if (!flag) throw notFound();
  const batch = await Batch.findById(flag.batchId).select("abId tpId assessorId proctorId").lean();
  if (!isInBatchScope(user, batch)) throw forbidden();

  const locationVisible = PROCTORING_LOCATION_ROLES.includes(user.role);
  let location = null;
  if (locationVisible && flag.locationStatus === "captured" && flag.location) {
    try {
      const parsed = JSON.parse(flag.location);
      location = {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        accuracy: parsed.accuracy ?? null,
      };
    } catch {
      location = null;
    }
  }
  const session = location
    ? await ProctoringSession.findById(flag.sessionId).select("learnerId").lean()
    : null;
  return {
    flag,
    learnerId: session?.learnerId ?? null,
    body: {
      flagId: idStr(flag._id),
      sessionId: idStr(flag.sessionId),
      type: flag.type,
      reason: flagReason(flag.type),
      severity: flag.severity,
      capturedAt: iso(flag.capturedAt),
      receivedAt: iso(flag.receivedAt),
      evidenceId: idStr(flag.evidenceId),
      locationStatus: flag.locationStatus ?? "not_shared",
      locationVisible,
      location,
    },
  };
}
