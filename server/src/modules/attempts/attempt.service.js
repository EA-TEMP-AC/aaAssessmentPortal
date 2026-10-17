import mongoose from "mongoose";
import { answerTimings } from "../reports/answer-timing.js";
import { resolveBatchSettings } from "../../config/batch-settings.js";
import { compliance } from "../../config/compliance.js";
import { env } from "../../config/env.js";
import { AppError, forbidden, notFound, validationError } from "../../lib/errors.js";
import { sameLanguage } from "../../lib/language.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { Attempt } from "../../models/attempt.model.js";
import { AuditLog } from "../../models/audit-log.model.js";
import { AttendanceRecord } from "../../models/attendance-record.model.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { Question } from "../../models/question.model.js";
import { Result } from "../../models/result.model.js";
import { TestPaper } from "../../models/test-paper.model.js";
import { MAX_QUESTIONS_PER_PAGE } from "../../config/content-controls.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { defaultPaperName } from "../test-generator/paper-name.js";
import { createRng, shuffle } from "../test-generator/seeded-random.js";
import {
  AUTO_SCORED_TYPES,
  computeDeadlines,
  computeScores,
  clockInstant,
  isClockHeld,
  isPastAcceptWindow,
  normaliseAnswer,
  round2,
  scoreQuestions,
} from "./attempt-scoring.js";

const MAX_CAS_TRIES = 5;

const idStr = (v) => (v == null ? null : String(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);
const emptyPage = (filters) => ({
  items: [],
  total: 0,
  page: filters.page,
  pageSize: filters.pageSize,
});

export function graceSeconds() {
  return env.ATTEMPT_GRACE_SECONDS ?? compliance.ATTEMPT_GRACE_SECONDS;
}

function closedError(attempt) {
  return new AppError(409, "ATTEMPT_CLOSED", "This attempt is already closed", {
    status: attempt.status,
  });
}

function timeUpError() {
  return new AppError(409, "ATTEMPT_TIME_UP", "The time for this attempt has ended", {
    status: "timed_out",
  });
}

function pausedError(attempt) {
  return new AppError(409, "ATTEMPT_PAUSED", "Your test is paused. Please contact your proctor.", {
    status: attempt.status,
  });
}

/** Stable 32-bit seed from ids: the same ids give the same order on every read and resume. */
function seedFrom(...parts) {
  let h = 2166136261;
  for (const ch of parts.map(String).join(":")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const isPaused = (attempt) => attempt.pause?.active === true;

/** B-20: options in a per-attempt stable order. Marking uses option keys, never positions. */
function orderedOptions(attempt, questionId, options) {
  if (attempt.shuffleOptions !== true) return options;
  return shuffle(options, createRng(seedFrom(attempt._id, questionId)));
}

async function loadBatchSettings(batchId) {
  const [batch, result] = await Promise.all([
    Batch.findById(batchId).select("settings").lean(),
    Result.findOne({ batchId }).select("status").lean(),
  ]);
  return {
    ...resolveBatchSettings(batch?.settings),
    // X-12: whether the awarding body has validated the result of this batch.
    resultValidated: result?.status === "validated" || result?.status === "published",
  };
}

/** What the exam page needs from the batch settings. No flag limits, no thresholds. */
function candidateSettingsView(settings) {
  return {
    questionsMandatory: settings.questionsMandatory,
    showMarksToCandidate: settings.showMarksToCandidate,
    // X-12: extendOnUnlock tells the page to hold its countdown while the exam is paused.
    flagPolicy: {
      action: settings.flagPolicy.action,
      extendOnUnlock: settings.flagPolicy.extendOnUnlock === true,
    },
    imageCapture: { ...settings.imageCapture },
    candidateInfoPopup: { ...settings.candidateInfoPopup },
    captureLocation: settings.captureLocation,
  };
}

/** The totals a candidate may see when the batch shows marks. Closed attempts only. */
function candidateMarksView(attempt, settings) {
  if (!settings.showMarksToCandidate || attempt.status === "in_progress" || !attempt.scores) {
    return null;
  }
  // X-12 (DECISIONS 805): unless the batch allows marks straight after the exam, they wait for validation.
  if (settings.marksAfterValidation && !settings.resultValidated) return null;
  return {
    obtainedMarks: attempt.scores.obtainedMarks,
    maxMarks: attempt.scores.maxMarks,
    complete: attempt.scores.complete,
  };
}

async function loadQuestionMap(ids) {
  const docs = await Question.find({ _id: { $in: ids } })
    .select("stem options correctAnswer type marks images")
    .lean();
  return new Map(docs.map((d) => [String(d._id), d]));
}

/** Audit view. Ids, status and numbers only: never question text or answers. */
export function auditView(attempt) {
  const qs = attempt.questions ?? [];
  return {
    testPaperId: idStr(attempt.testPaperId),
    batchId: idStr(attempt.batchId),
    candidateId: idStr(attempt.candidateId),
    status: attempt.status,
    closeReason: attempt.closeReason ?? null,
    questionCount: qs.length,
    answeredCount: qs.filter((q) => q.answer != null).length,
    scores: attempt.scores
      ? {
          maxMarks: attempt.scores.maxMarks,
          obtainedMarks: attempt.scores.obtainedMarks,
          pendingCount: attempt.scores.pendingCount,
          complete: attempt.scores.complete,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ access */

function canSee(user, attempt, batch) {
  switch (user.role) {
    case "candidate":
      return (
        user.linkedProfileId != null && idStr(attempt.learnerId) === idStr(user.linkedProfileId)
      );
    case "aa_admin":
      return true;
    case "ab_reviewer":
      return user.abId != null && idStr(attempt.abId) === idStr(user.abId);
    case "assessor":
      return (
        user.linkedProfileId != null &&
        batch?.assessorId != null &&
        idStr(batch.assessorId) === idStr(user.linkedProfileId)
      );
    default:
      return false;
  }
}

async function loadScoped(user, id) {
  const attempt = await Attempt.findById(id).lean();
  if (!attempt) throw notFound();
  const batch = await Batch.findById(attempt.batchId).select("assessorId abId status").lean();
  if (!canSee(user, attempt, batch)) throw forbidden();
  return { attempt, batch };
}

/* ----------------------------------------------------------------- closing */

/**
 * Closes an in-progress attempt and scores it. Compare-and-set on `rev`, so an answer saved
 * a moment earlier is never lost. A timeout writes its own audit row in the same transaction;
 * a submit is audited by the route.
 */
async function closeAttempt(attempt, { reason, now, trigger }) {
  let current = attempt;
  for (let i = 0; i < MAX_CAS_TRIES; i += 1) {
    if (current.status !== "in_progress") return { attempt: current, closed: false };
    // A paused attempt cannot be submitted; a timeout still closes it (the clock keeps running).
    if (reason === "submit" && isPaused(current)) throw pausedError(current);
    const keyDocs = await loadQuestionMap(current.questions.map((q) => q.questionId));
    const keys = new Map([...keyDocs].map(([id, d]) => [id, d.correctAnswer ?? null]));
    const optionsById = new Map([...keyDocs].map(([id, d]) => [id, d.options ?? []]));
    const questions = scoreQuestions(current.questions, keys, optionsById);
    const scores = computeScores(questions);
    const status = reason === "timeout" ? "timed_out" : "submitted";
    // A timeout closes at the deadline, not at the later moment a sweep or a read noticed it.
    const closedAt =
      reason === "timeout" && current.deadlineAt && new Date(current.deadlineAt) < now
        ? new Date(current.deadlineAt)
        : now;
    const set = { status, closedAt, closeReason: reason, questions, scores };

    const run = async (session) => {
      const updated = await Attempt.findOneAndUpdate(
        {
          _id: current._id,
          status: "in_progress",
          rev: current.rev,
          ...(reason === "submit" ? { "pause.active": { $ne: true } } : {}),
        },
        { $set: set, $inc: { rev: 1 } },
        { new: true, session },
      ).lean();
      if (updated && reason === "timeout") {
        await AuditLog.create(
          [
            {
              actorRole: "system",
              action: "attempt.timeout",
              entity: "attempt",
              entityId: String(updated._id),
              abId: updated.abId,
              batchId: updated.batchId,
              after: auditView(updated),
              meta: { trigger, graceSeconds: updated.graceSeconds },
            },
          ],
          { session },
        );
      }
      return updated;
    };
    const updated = reason === "timeout" ? await withTransaction(run) : await run(undefined);
    if (updated) return { attempt: updated, closed: true };
    current = await Attempt.findById(current._id).lean();
    if (!current) throw notFound();
  }
  throw new AppError(409, "CONFLICT", "The attempt changed while it was being closed; try again");
}

/** Lazy timeout: a read or write after the accept window closes the attempt first. */
async function expireIfDue(attempt, now, trigger) {
  if (attempt.status !== "in_progress" || !isPastAcceptWindow(attempt, now)) {
    return { attempt, timedOut: false };
  }
  const { attempt: after, closed } = await closeAttempt(attempt, {
    reason: "timeout",
    now,
    trigger,
  });
  return { attempt: after, timedOut: closed };
}

/**
 * Closes every attempt whose accept window has passed. Called by the attempt sweep job
 * (attempt-sweep-job.js) and safe to call from a script.
 */
export async function closeExpiredAttempts({ now = new Date(), limit = 200 } = {}) {
  const due = await Attempt.find({
    status: "in_progress",
    acceptUntil: { $lt: now },
    // X-12: a paused attempt whose clock is held is not due.
    $nor: [{ "pause.active": true, "pause.clockStopped": true }],
  })
    .sort({ acceptUntil: 1 })
    .limit(limit)
    .lean();
  let closed = 0;
  for (const attempt of due) {
    const res = await closeAttempt(attempt, { reason: "timeout", now, trigger: "sweep" });
    if (res.closed) closed += 1;
  }
  return { closed };
}

/* ------------------------------------------------------------------- start */

/**
 * The rules a new attempt must pass, in the order POST /attempts/start checks them. Start and
 * GET /attempts/available both use this, so the list and the start never disagree. Returns
 * null when the paper may be started, else { status, code, message, details }.
 * `today` is the IST calendar date; `deliverable` is false when a paper question is missing.
 */
/** X-19: complete, and approved unless the batch is set up to skip the reviewer's approval. */
export function paperUsable(paper, batch) {
  if (paper.complete !== true) return false;
  return (
    paper.status === "approved" || resolveBatchSettings(batch.settings).skipPaperApproval === true
  );
}

export function startBlocker({ batch, paper, absent, deliverable, today }) {
  if (batch.status !== "in_progress") {
    return {
      status: 409,
      code: "ATTEMPT_BATCH_NOT_IN_PROGRESS",
      message: "The batch is not in progress",
      details: { status: batch.status },
    };
  }
  if (today < batch.assessmentStartDate || today > batch.assessmentEndDate) {
    return {
      status: 409,
      code: "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW",
      message: "Today is outside the assessment dates of this batch",
      details: {
        assessmentStartDate: batch.assessmentStartDate,
        assessmentEndDate: batch.assessmentEndDate,
      },
    };
  }
  if (absent) {
    return {
      status: 409,
      code: "ATTEMPT_CANDIDATE_ABSENT",
      message: "The candidate is marked absent for this batch",
    };
  }
  // D5: a batch has one paper. Without one nothing can start.
  if (!batch.testPaperId) {
    return {
      status: 409,
      code: "ATTEMPT_NO_TEST_PAPER",
      message: "No test paper has been set for this batch",
    };
  }
  // A paper that is unknown, a draft, for another qualification, or not the paper of this batch
  // looks the same: not found.
  if (
    !paper ||
    idStr(paper._id) !== idStr(batch.testPaperId) ||
    !paperUsable(paper, batch) ||
    idStr(paper.qualificationId) !== idStr(batch.qualificationId)
  ) {
    return { status: 404, code: "NOT_FOUND", message: "Unknown id" };
  }
  if (!sameLanguage(paper.rules?.language, batch.assessmentLanguage)) {
    return {
      status: 409,
      code: "ATTEMPT_LANGUAGE_MISMATCH",
      message: "The test paper language differs from the batch assessment language",
    };
  }
  if (!deliverable) {
    return {
      status: 409,
      code: "ATTEMPT_PAPER_UNAVAILABLE",
      message: "The test paper cannot be delivered",
    };
  }
  return null;
}

/**
 * What the start button may do for one paper. An open attempt resumes (start replays it) until its
 * deadline; a closed one cannot be started again (start replays it closed, so the reason is
 * ATTEMPT_CLOSED).
 */
export function startableFor(attempt, blocker, now = new Date()) {
  if (attempt?.status === "in_progress") {
    if (attempt.deadlineAt && new Date(attempt.deadlineAt) <= clockInstant(attempt, now)) {
      return { ok: false, reason: "ATTEMPT_TIME_UP" };
    }
    return { ok: true };
  }
  if (attempt) return { ok: false, reason: "ATTEMPT_CLOSED" };
  return blocker ? { ok: false, reason: blocker.code } : { ok: true };
}

const shortCode = (id) => String(id).slice(-6).toUpperCase();

/**
 * GET /attempts/available. The one test paper (D5) of each in-progress batch where this
 * candidate is on the active roster, plus any paper with an attempt of theirs still open, even
 * when the batch is no longer in progress (Q702), and (X-13) any paper with a finished attempt of theirs, so the Completed tab keeps its history. Ids, labels, counts and the own attempt state
 * of the candidate only: never question ids, text, options, keys or marks. A batch with no paper
 * set lists nothing.
 */
export async function listAvailable(user) {
  if (user.linkedProfileId == null) return { items: [] };
  const rosters = await Candidate.find({ learnerId: user.linkedProfileId, active: true })
    .select("_id batchId")
    .lean();
  if (rosters.length === 0) return { items: [] };
  const rosterByBatch = new Map(rosters.map((r) => [idStr(r.batchId), r]));
  const rosterIds = rosters.map((r) => r._id);
  const now = new Date();

  const rows = await Attempt.find({ candidateId: { $in: rosterIds } })
    .select("testPaperId candidateId batchId status startedAt deadlineAt acceptUntil pause")
    .lean();
  const attemptByKey = new Map();
  const openByBatch = new Map();
  // X-13: a finished attempt keeps its paper on the Completed tab after the batch itself has closed.
  const doneByBatch = new Map();
  for (const row of rows) {
    let attempt = row;
    // Lazy timeout, as on any other read: an open attempt past its accept window closes here.
    if (attempt.status === "in_progress" && isPastAcceptWindow(attempt, now)) {
      const full = await Attempt.findById(attempt._id).lean();
      if (full) attempt = (await expireIfDue(full, now, "read")).attempt;
    }
    attemptByKey.set(`${idStr(attempt.candidateId)}:${idStr(attempt.testPaperId)}`, attempt);
    if (attempt.status === "in_progress") {
      const key = idStr(attempt.batchId);
      if (!openByBatch.has(key)) openByBatch.set(key, []);
      openByBatch.get(key).push(idStr(attempt.testPaperId));
    } else {
      const key = idStr(attempt.batchId);
      if (!doneByBatch.has(key)) doneByBatch.set(key, []);
      doneByBatch.get(key).push(idStr(attempt.testPaperId));
    }
  }

  const batches = await Batch.find({
    $or: [
      { _id: { $in: rosters.map((r) => r.batchId) }, status: "in_progress" },
      { _id: { $in: [...openByBatch.keys()] } },
      { _id: { $in: [...doneByBatch.keys()] } },
    ],
  })
    .select(
      "status qualificationId assessmentStartDate assessmentEndDate assessmentLanguage testPaperId captureLocation settings",
    )
    .sort({ assessmentStartDate: 1, _id: 1 })
    .lean();
  if (batches.length === 0) return { items: [] };

  const paperIdsOf = (batch) =>
    [
      ...new Set([
        idStr(batch.testPaperId),
        ...(openByBatch.get(idStr(batch._id)) ?? []),
        ...(doneByBatch.get(idStr(batch._id)) ?? []),
      ]),
    ].filter(Boolean);
  const wantedPaperIds = [...new Set(batches.flatMap(paperIdsOf))];
  const qualificationIds = [...new Set(batches.map((b) => idStr(b.qualificationId)))];
  const [papers, qualifications, absences] = await Promise.all([
    TestPaper.find({ _id: { $in: wantedPaperIds } })
      .select(
        "qualificationId name status complete rules.language durationMinutes items.questionId",
      )
      .lean(),
    Qualification.find({ _id: { $in: qualificationIds } })
      .select("code name")
      .lean(),
    AttendanceRecord.find({ candidateId: { $in: rosterIds }, present: false })
      .select("candidateId")
      .lean(),
  ]);

  const allIds = papers.flatMap((p) => p.items.map((i) => i.questionId));
  const present = new Set(
    (await Question.find({ _id: { $in: allIds } }).distinct("_id")).map(String),
  );
  const paperById = new Map(papers.map((p) => [idStr(p._id), p]));
  const qualById = new Map(qualifications.map((q) => [idStr(q._id), q]));
  const absentRosters = new Set(absences.map((a) => idStr(a.candidateId)));

  const today = istCalendarDate(now);
  const items = [];
  for (const batch of batches) {
    const roster = rosterByBatch.get(idStr(batch._id));
    if (!roster) continue;
    const qual = qualById.get(idStr(batch.qualificationId));
    const batchName = `${qual ? `${qual.code} ${qual.name}` : "Batch"}, ${
      batch.assessmentStartDate
    } to ${batch.assessmentEndDate}`;
    for (const paperId of paperIdsOf(batch)) {
      const paper = paperById.get(paperId);
      if (!paper) continue;
      const attempt = attemptByKey.get(`${idStr(roster._id)}:${paperId}`) ?? null;
      const open = attempt?.status === "in_progress";
      // Without an open attempt only an approved, complete paper is listed.
      if (!attempt && !paperUsable(paper, batch)) continue;
      const blocker = startBlocker({
        batch,
        paper,
        absent: absentRosters.has(idStr(roster._id)),
        deliverable: paper.items.every((i) => present.has(String(i.questionId))),
        today,
      });
      items.push({
        batchId: idStr(batch._id),
        batchName,
        assessmentStartDate: batch.assessmentStartDate,
        assessmentEndDate: batch.assessmentEndDate,
        // X-07: the check screen tells the candidate their location goes with flag photos.
        captureLocation: batch.captureLocation === true,
        // X-21: the check screen asks the candidate to share the screen.
        requireScreenShare: resolveBatchSettings(batch.settings).requireScreenShare === true,
        recordVideo: resolveBatchSettings(batch.settings).recordVideo === true,
        videoFailureAction: resolveBatchSettings(batch.settings).videoFailureAction,
        paperId: idStr(paper._id),
        paperCode: shortCode(paper._id),
        paperName: paper.name || defaultPaperName(qual?.name, paper.rules?.language),
        language: paper.rules?.language ?? null,
        questionCount: paper.items.length,
        durationMinutes: paper.durationMinutes ?? compliance.ATTEMPT_DEFAULT_DURATION_MINUTES,
        attempt: attempt
          ? {
              id: idStr(attempt._id),
              status: attempt.status,
              startedAt: iso(attempt.startedAt),
              deadline: iso(attempt.deadlineAt),
              remainingSeconds: open
                ? Math.max(0, Math.floor((new Date(attempt.deadlineAt) - now) / 1000))
                : null,
            }
          : null,
        startable: startableFor(attempt, blocker, now),
      });
    }
  }
  return { items };
}

export async function startAttempt(user, { batchId, testPaperId }) {
  if (user.linkedProfileId == null) throw forbidden();
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  const roster = await Candidate.findOne({ batchId: batch._id, learnerId: user.linkedProfileId })
    .select("_id learnerId active")
    .lean();
  if (!roster || roster.active !== true) throw forbidden("Not on the active roster of this batch");

  const existing = await Attempt.findOne({ testPaperId, candidateId: roster._id }).lean();
  if (existing) {
    const { attempt } = await expireIfDue(existing, new Date(), "start");
    return { attempt, created: false };
  }

  const [absent, paper] = await Promise.all([
    AttendanceRecord.exists({ batchId: batch._id, candidateId: roster._id, present: false }),
    TestPaper.findById(testPaperId).lean(),
  ]);
  const ids = paper?.items?.map((i) => i.questionId) ?? [];
  const deliverable =
    paper != null && (await Question.countDocuments({ _id: { $in: ids } })) === ids.length;
  const blocker = startBlocker({
    batch,
    paper,
    absent: Boolean(absent),
    deliverable,
    today: istCalendarDate(new Date()),
  });
  if (blocker) throw new AppError(blocker.status, blocker.code, blocker.message, blocker.details);

  // B-20: the order is seeded by the new attempt's id and stored, so a resume shows the same one.
  const attemptId = new mongoose.Types.ObjectId();
  const settings = resolveBatchSettings(batch.settings);
  const order = settings.shuffleQuestions
    ? shuffle([...paper.items], createRng(seedFrom(attemptId)))
    : [...paper.items];
  const questions = order.map((i) => ({
    questionId: i.questionId,
    version: i.version,
    nosId: i.nosId,
    pcId: i.pcId,
    type: i.type,
    marks: i.marks,
    answer: null,
    answeredAt: null,
    awardedMarks: null,
    scoreStatus: "pending",
    scoredBy: null,
    markedBy: null,
    markedAt: null,
  }));

  const startedAt = new Date();
  const durationMinutes = paper.durationMinutes ?? compliance.ATTEMPT_DEFAULT_DURATION_MINUTES;
  const grace = graceSeconds();
  const { deadlineAt, acceptUntil } = computeDeadlines(startedAt, durationMinutes, grace);

  try {
    const doc = await Attempt.create({
      _id: attemptId,
      shuffleOptions: settings.shuffleOptions,
      testPaperId: paper._id,
      batchId: batch._id,
      abId: batch.abId,
      candidateId: roster._id,
      learnerId: roster.learnerId,
      userId: user._id,
      status: "in_progress",
      durationMinutes,
      graceSeconds: grace,
      startedAt,
      deadlineAt,
      acceptUntil,
      questions,
      scores: null,
      rev: 0,
    });
    return { attempt: doc.toObject(), created: true };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two starts at once: the second one gets the first one's attempt.
    const winner = await Attempt.findOne({ testPaperId, candidateId: roster._id }).lean();
    return { attempt: winner, created: false };
  }
}

/* ------------------------------------------------------------------- reads */

/** The candidate's view: questions without keys, answers, no marks. */
async function presentForCandidate(
  attempt,
  now,
  qmap,
  questions = attempt.questions,
  batchSettings = null,
) {
  const open = attempt.status === "in_progress";
  return {
    id: idStr(attempt._id),
    testPaperId: idStr(attempt.testPaperId),
    batchId: idStr(attempt.batchId),
    status: attempt.status,
    durationMinutes: attempt.durationMinutes,
    startedAt: iso(attempt.startedAt),
    deadlineAt: iso(attempt.deadlineAt),
    closedAt: iso(attempt.closedAt),
    closeReason: attempt.closeReason ?? null,
    paused: open && isPaused(attempt),
    shuffleOptions: attempt.shuffleOptions === true,
    ...(batchSettings
      ? {
          settings: candidateSettingsView(batchSettings),
          marks: candidateMarksView(attempt, batchSettings),
        }
      : {}),
    serverTime: now.toISOString(),
    // X-12: tells the page the clock is held while paused, so it does not run down meanwhile.
    clockHeld: open && isClockHeld(attempt),
    remainingSeconds: open
      ? Math.max(
          0,
          Math.ceil(
            (new Date(attempt.deadlineAt).getTime() - clockInstant(attempt, now).getTime()) / 1000,
          ),
        )
      : 0,
    totalMarks: round2(attempt.questions.reduce((s, q) => s + q.marks, 0)),
    questions: questions.map((q, index) => {
      const doc = qmap.get(String(q.questionId));
      return {
        questionId: idStr(q.questionId),
        order: index + 1,
        type: q.type,
        marks: q.marks,
        stem: doc?.stem ?? "",
        images: (doc?.images ?? []).map((i) => ({ id: idStr(i.imageId), alt: i.alt })),
        options: orderedOptions(attempt, q.questionId, doc?.options ?? []).map((o) => ({
          key: o.key,
          text: o.text,
        })),
        answer: q.answer ?? null,
      };
    }),
  };
}

/** Staff view: adds NOS, marks and, once the attempt is closed, the key. */
async function presentForStaff(attempt, now, qmap, questions = attempt.questions) {
  const base = await presentForCandidate(attempt, now, qmap, questions);
  const closed = attempt.status !== "in_progress";
  const candidate = await Candidate.findById(attempt.candidateId).select("name").lean();
  const timings = answerTimings(attempt);
  return {
    ...base,
    abId: idStr(attempt.abId),
    candidateId: idStr(attempt.candidateId),
    learnerId: idStr(attempt.learnerId),
    candidateName: candidate?.name ?? null,
    scores: attempt.scores ?? null,
    questions: base.questions.map((q, index) => {
      const raw = questions[index];
      const out = {
        ...q,
        nosId: raw.nosId,
        pcId: raw.pcId,
        awardedMarks: raw.awardedMarks ?? null,
        scoreStatus: raw.scoreStatus,
        scoredBy: raw.scoredBy ?? null,
        markedBy: idStr(raw.markedBy),
        markedAt: iso(raw.markedAt),
        // X-09: when the answer was last saved and the time since the answer before it.
        answeredAt: iso(raw.answeredAt),
        secondsSpent: timings.get(q.questionId) ?? null,
      };
      // The key is shown only after the attempt closes, and never to the candidate.
      if (closed) out.correctAnswer = qmap.get(q.questionId)?.correctAnswer ?? null;
      return out;
    }),
  };
}

/**
 * The candidate gets every question (they need them all to sit the test). Staff get one page
 * of at most MAX_QUESTIONS_PER_PAGE questions, with itemPage, itemPageSize and itemTotal.
 */
export async function getAttempt(user, id, { itemPage = 1 } = {}) {
  const { attempt: loaded } = await loadScoped(user, id);
  const now = new Date();
  const { attempt } = await expireIfDue(loaded, now, "read");
  if (user.role === "candidate") {
    const [qmap, settings] = await Promise.all([
      loadQuestionMap(attempt.questions.map((q) => q.questionId)),
      loadBatchSettings(attempt.batchId),
    ]);
    return presentForCandidate(attempt, now, qmap, attempt.questions, settings);
  }
  const pageQuestions = attempt.questions.slice(
    (itemPage - 1) * MAX_QUESTIONS_PER_PAGE,
    itemPage * MAX_QUESTIONS_PER_PAGE,
  );
  const qmap = await loadQuestionMap(pageQuestions.map((q) => q.questionId));
  const view = await presentForStaff(attempt, now, qmap, pageQuestions);
  return {
    ...view,
    itemPage,
    itemPageSize: MAX_QUESTIONS_PER_PAGE,
    itemTotal: attempt.questions.length,
  };
}

function presentRow(a, names = new Map()) {
  return {
    candidateName: names.get(String(a.candidateId)) ?? null,
    id: idStr(a._id),
    testPaperId: idStr(a.testPaperId),
    batchId: idStr(a.batchId),
    abId: idStr(a.abId),
    candidateId: idStr(a.candidateId),
    learnerId: idStr(a.learnerId),
    status: a.status,
    startedAt: iso(a.startedAt),
    deadlineAt: iso(a.deadlineAt),
    closedAt: iso(a.closedAt),
    closeReason: a.closeReason ?? null,
    scoringComplete: a.scores ? a.scores.complete : null,
    maxMarks: a.scores?.maxMarks ?? null,
    obtainedMarks: a.scores?.obtainedMarks ?? null,
    pendingCount: a.scores?.pendingCount ?? null,
  };
}

export async function listAttempts(user, filters) {
  const filter = {};
  if (filters.batchId) filter.batchId = filters.batchId;
  if (filters.testPaperId) filter.testPaperId = filters.testPaperId;
  if (filters.status) filter.status = filters.status;

  if (user.role === "ab_reviewer") {
    if (user.abId == null) return emptyPage(filters);
    filter.abId = user.abId;
  } else if (user.role === "assessor") {
    if (user.linkedProfileId == null) return emptyPage(filters);
    const batchIds = await Batch.find({ assessorId: user.linkedProfileId }).distinct("_id");
    if (filter.batchId) {
      if (!batchIds.some((b) => String(b) === filter.batchId)) return emptyPage(filters);
    } else {
      filter.batchId = { $in: batchIds };
    }
  } else if (user.role !== "aa_admin") {
    throw forbidden();
  }

  const [rows, total] = await Promise.all([
    Attempt.find(filter)
      .select("-questions")
      .sort({ startedAt: -1, _id: -1 })
      .skip((filters.page - 1) * filters.pageSize)
      .limit(filters.pageSize)
      .lean(),
    Attempt.countDocuments(filter),
  ]);
  const candidates = await Candidate.find({ _id: { $in: rows.map((r) => r.candidateId) } })
    .select("name")
    .lean();
  const names = new Map(candidates.map((c) => [String(c._id), c.name]));
  return {
    items: rows.map((r) => presentRow(r, names)),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

const presentGroup = (g, name) => ({
  [name]: g.key,
  maxMarks: g.maxMarks,
  obtainedMarks: g.obtainedMarks,
  pendingMarks: g.pendingMarks,
  pendingCount: g.pendingCount,
});

/** Read-only totals for aa_admin to copy into a result draft. Writes nothing (Q424). */
export async function getSummary(user, id) {
  const { attempt: loaded } = await loadScoped(user, id);
  const { attempt } = await expireIfDue(loaded, new Date(), "summary");
  if (attempt.status === "in_progress") {
    throw new AppError(409, "ATTEMPT_NOT_CLOSED", "The attempt is still in progress");
  }
  return {
    attemptId: idStr(attempt._id),
    batchId: idStr(attempt.batchId),
    candidateId: idStr(attempt.candidateId),
    learnerId: idStr(attempt.learnerId),
    testPaperId: idStr(attempt.testPaperId),
    status: attempt.status,
    closedAt: iso(attempt.closedAt),
    scoringComplete: attempt.scores.complete,
    maxMarks: attempt.scores.maxMarks,
    obtainedMarks: attempt.scores.obtainedMarks,
    pendingMarks: attempt.scores.pendingMarks,
    pendingCount: attempt.scores.pendingCount,
    byNos: attempt.scores.byNos.map((g) => presentGroup(g, "nosId")),
    byType: attempt.scores.byType.map((g) => presentGroup(g, "type")),
  };
}

/* ----------------------------------------------------------------- answers */

export async function saveAnswers(user, id, answers) {
  const { attempt: loaded } = await loadScoped(user, id);
  const now = new Date();
  const { attempt, timedOut } = await expireIfDue(loaded, now, "answers");
  if (timedOut) throw timeUpError();
  if (attempt.status !== "in_progress") throw closedError(attempt);
  if (isPaused(attempt)) throw pausedError(attempt);

  const byId = new Map(attempt.questions.map((q) => [String(q.questionId), q]));
  const qmap = await loadQuestionMap(answers.map((a) => a.questionId));
  const set = {};
  const arrayFilters = [];
  const problems = {};
  answers.forEach((a, i) => {
    const key = a.questionId.toLowerCase();
    const item = byId.get(key);
    if (!item) {
      problems[`answers.${i}.questionId`] = ["Not a question of this attempt"];
      return;
    }
    let value = a.answer == null ? null : a.answer.trim();
    if (value === "") value = null;
    if (value !== null && item.type === "mcq") {
      const options = qmap.get(key)?.options ?? [];
      const match = options.find((o) => normaliseAnswer(o.key) === normaliseAnswer(value));
      if (!match) {
        problems[`answers.${i}.answer`] = ["Not an option of this question"];
        return;
      }
      value = match.key;
    }
    const alias = `q${i}`;
    set[`questions.$[${alias}].answer`] = value;
    set[`questions.$[${alias}].answeredAt`] = value === null ? null : now;
    arrayFilters.push({ [`${alias}.questionId`]: new mongoose.Types.ObjectId(key) });
  });
  if (Object.keys(problems).length > 0) {
    throw validationError("Request validation failed", problems);
  }

  const res = await Attempt.updateOne(
    {
      _id: attempt._id,
      status: "in_progress",
      acceptUntil: { $gte: now },
      "pause.active": { $ne: true },
    },
    { $set: set, $inc: { rev: 1 } },
    { arrayFilters },
  );
  if (res.modifiedCount === 0) {
    // Closed or timed out between the read and the write.
    const fresh = await Attempt.findById(attempt._id).lean();
    const after = await expireIfDue(fresh, new Date(), "answers");
    if (after.timedOut) throw timeUpError();
    if (after.attempt.status === "in_progress" && isPaused(after.attempt)) {
      throw pausedError(after.attempt);
    }
    throw closedError(after.attempt);
  }
  return {
    saved: answers.length,
    savedAt: now.toISOString(),
    deadlineAt: iso(attempt.deadlineAt),
    remainingSeconds: Math.max(
      0,
      Math.ceil((new Date(attempt.deadlineAt).getTime() - now.getTime()) / 1000),
    ),
  };
}

/* ------------------------------------------------------------------ submit */

/**
 * Submit is idempotent: a closed attempt is returned as it is. A submit that arrives after the
 * accept window is a timeout; the answers saved so far are scored.
 */
export async function submitAttempt(user, id) {
  const { attempt: loaded } = await loadScoped(user, id);
  const now = new Date();
  if (loaded.status !== "in_progress") return { attempt: loaded, outcome: "replay" };
  if (isPastAcceptWindow(loaded, now)) {
    const { attempt } = await expireIfDue(loaded, now, "submit");
    return { attempt, outcome: "late" };
  }
  if (isPaused(loaded)) throw pausedError(loaded);
  const settings = await loadBatchSettings(loaded.batchId);
  if (settings.questionsMandatory) {
    const unanswered = loaded.questions.filter((q) => q.answer == null).length;
    if (unanswered > 0) {
      throw new AppError(
        409,
        "ATTEMPT_UNANSWERED_QUESTIONS",
        "Every question must be answered before you submit",
        { unansweredCount: unanswered },
      );
    }
  }
  const { attempt, closed } = await closeAttempt(loaded, {
    reason: "submit",
    now,
    trigger: "submit",
  });
  return { attempt, outcome: closed ? "submitted" : "replay" };
}

/** What the candidate gets back from a submit: status and times. Marks only when the batch shows them. */
export async function presentClosed(attempt) {
  const settings = await loadBatchSettings(attempt.batchId);
  return {
    id: idStr(attempt._id),
    status: attempt.status,
    closeReason: attempt.closeReason ?? null,
    closedAt: iso(attempt.closedAt),
    deadlineAt: iso(attempt.deadlineAt),
    marks: candidateMarksView(attempt, settings),
  };
}

/* ------------------------------------------------------------ manual marks */

export async function applyManualMarks(user, id, marks) {
  const { attempt: loaded } = await loadScoped(user, id);
  let { attempt } = await expireIfDue(loaded, new Date(), "marks");

  for (let i = 0; i < MAX_CAS_TRIES; i += 1) {
    if (attempt.status === "in_progress") {
      throw new AppError(409, "ATTEMPT_NOT_CLOSED", "Marks can be given after the attempt closes");
    }
    const byId = new Map(attempt.questions.map((q) => [String(q.questionId), q]));
    const exceeded = [];
    const notManual = [];
    const unknown = [];
    for (const m of marks) {
      const item = byId.get(m.questionId.toLowerCase());
      if (!item) unknown.push(m.questionId);
      else if (AUTO_SCORED_TYPES.includes(item.type) && item.scoreStatus === "scored") {
        notManual.push(m.questionId);
      } else if (m.marks > item.marks) {
        exceeded.push({ questionId: m.questionId, maxMarks: item.marks, marks: m.marks });
      }
    }
    if (unknown.length > 0) {
      throw validationError("Request validation failed", {
        marks: [`Not questions of this attempt: ${unknown.join(", ")}`],
      });
    }
    if (notManual.length > 0) {
      throw new AppError(
        400,
        "ATTEMPT_QUESTION_AUTO_SCORED",
        "These questions are scored by the server",
        { questionIds: notManual },
      );
    }
    if (exceeded.length > 0) {
      throw new AppError(
        400,
        "ATTEMPT_MARKS_EXCEED_CEILING",
        "Marks are above the question's marks",
        { exceeded },
      );
    }

    // D6: once the batch result is submitted the marks are fixed. Changing them goes through
    // return-for-correction (with a reason), which puts the result back to draft.
    const result = await Result.findOne({ batchId: attempt.batchId }).select("status").lean();
    if (result && result.status !== "draft") {
      throw new AppError(
        409,
        "ATTEMPT_MARKS_LOCKED",
        "The batch result is submitted; marks can change only after it is returned for correction",
        { resultStatus: result.status },
      );
    }

    const now = new Date();
    const given = new Map(marks.map((m) => [m.questionId.toLowerCase(), m.marks]));
    const questions = attempt.questions.map((q) => {
      const value = given.get(String(q.questionId));
      if (value === undefined) return q;
      return {
        ...q,
        awardedMarks: value,
        scoreStatus: "scored",
        scoredBy: "manual",
        markedBy: user._id,
        markedAt: now,
      };
    });
    const scores = computeScores(questions);
    const updated = await Attempt.findOneAndUpdate(
      { _id: attempt._id, rev: attempt.rev, status: { $ne: "in_progress" } },
      { $set: { questions, scores }, $inc: { rev: 1 } },
      { new: true },
    ).lean();
    if (updated) {
      const pick = (a) =>
        marks.map((m) => {
          const q = a.questions.find((x) => String(x.questionId) === m.questionId.toLowerCase());
          return { questionId: m.questionId, awardedMarks: q.awardedMarks ?? null };
        });
      return {
        attempt: updated,
        before: { ...auditView(attempt), marks: pick(attempt) },
        after: { ...auditView(updated), marks: pick(updated) },
      };
    }
    attempt = await Attempt.findById(attempt._id).lean();
    if (!attempt) throw notFound();
  }
  throw new AppError(409, "CONFLICT", "The attempt changed while marking; try again");
}

/** The view the caller gets for an attempt row they already loaded (used after marking). */
export async function presentAttempt(user, attempt) {
  const now = new Date();
  const qmap = await loadQuestionMap(attempt.questions.map((q) => q.questionId));
  if (user.role !== "candidate") return presentForStaff(attempt, now, qmap);
  const settings = await loadBatchSettings(attempt.batchId);
  return presentForCandidate(attempt, now, qmap, attempt.questions, settings);
}
