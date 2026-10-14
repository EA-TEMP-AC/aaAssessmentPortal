import { AssessorDayLock } from "../src/models/assessor-day-lock.model.js";
import { AttendanceRecord } from "../src/models/attendance-record.model.js";
import { Batch } from "../src/models/batch.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { Result } from "../src/models/result.model.js";
import {
  CAPTURED_AT,
  CAPTURED_LATER_AT,
  FAIL_NOS,
  GHOST_ID,
  PASS_NOS,
  WINDOW,
  addRoster,
  auditRows,
  bootE2e,
  createBatch,
  createLearners,
  createProctor,
  dueAfter,
  expectError,
  expectStatus,
  get,
  loginEventBody,
  makeAssessor,
  makeWorld,
  nextId,
  post,
  put,
  resetE2e,
  secretsOf,
  sessionFor,
  shutdownE2e,
  tryCreateBatch,
  withFrozenDate,
} from "./helpers/e2e.js";

/**
 * T-01 flow 1. A short-term batch from allocation to publication, through the HTTP API only.
 * Sources: docs/SCHEMA.md §1.2, §2.1, §2.3, §3.11, §3.13, §3.14; API_CONTRACT.md Batches,
 * Assessor field app, Results.
 */
describe("e2e: short-term batch lifecycle", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  it("walks allocated to published and records dues, statuses and audit rows", async () => {
    const world = await makeWorld();
    const learners = await createLearners(world, 3);
    const proctor = await createProctor(world);
    const { assessor, session: assessorSession } = await makeAssessor(world);
    const secrets = secretsOf(world.admin, world.reviewer, assessorSession);

    // The awarding body allocates the batch.
    const created = await createBatch(world, {}, world.reviewer.token);
    expect(created).toMatchObject({
      status: "allocated",
      statusVersion: 1,
      type: "STT",
      sector: "Electronics",
      ratioClass: "manufacturing",
      state: "Maharashtra",
      assessmentLanguage: "Hindi",
      isReassessment: false,
      reassessmentOf: null,
      firstAssessmentBatchId: created.id,
      assessorId: null,
      resultId: null,
      recognitionOverride: null,
    });
    expect(created.sla.breached).toEqual([]);

    // Stored due instants follow SCHEMA §2.1: next working day is day 1, due is end of day IST.
    const dues = {
      acceptDueAt: dueAfter(created.allocatedAt, 2),
      assignDueAt: dueAfter(created.allocatedAt, 7),
      resultDueAt: dueAfter(WINDOW.end, 3),
    };
    expect(created.sla).toMatchObject(dues);
    for (const value of Object.values(dues)) expect(value).toMatch(/T18:29:59\.999Z$/);
    const stored = await Batch.findById(created.id).lean();
    expect(stored.sla.acceptDueAt.toISOString()).toBe(dues.acceptDueAt);
    expect(stored.sla.assignDueAt.toISOString()).toBe(dues.assignDueAt);
    expect(stored.sla.resultDueAt.toISOString()).toBe(dues.resultDueAt);

    const roster = await addRoster(world, created.id, learners);
    expect(roster.map((row) => row.learnerId)).toEqual(learners.map((l) => l.id));

    // AA accepts, then assigns.
    const accepted = expectStatus(
      await post(world.admin.token, `/batches/${created.id}/accept`),
      200,
    );
    expect(accepted).toMatchObject({ status: "accepted", statusVersion: 2 });
    expect(accepted.acceptedAt).toBeTruthy();
    expect(accepted.sla.breached).toEqual([]);

    const assigned = expectStatus(
      await post(world.admin.token, `/batches/${created.id}/assign`, {
        assessorId: assessor.id,
        proctorId: proctor.id,
      }),
      200,
    );
    expect(assigned).toMatchObject({
      status: "assessor_assigned",
      statusVersion: 3,
      assessorId: assessor.id,
      proctorId: proctor.id,
    });
    expect(assigned.sla.breached).toEqual([]);
    const locks = await AssessorDayLock.find({ assessorId: assessor.id })
      .sort({ istDate: 1 })
      .lean();
    expect(locks.map((lock) => lock.istDate)).toEqual([WINDOW.start, WINDOW.end]);
    expect(locks.every((lock) => lock.batchIds.map(String).includes(created.id))).toBe(true);

    // The assessor logs in on site: the batch starts and one mail is queued for the AB.
    const loginBody = loginEventBody(created.id);
    const login = expectStatus(
      await post(assessorSession.token, "/assessor/login-event", loginBody),
      200,
    );
    expect(login).toMatchObject({
      actorType: "assessor",
      actorId: assessor.id,
      batchId: created.id,
      type: "login",
      locationStatus: "captured",
      missingGpsFix: false,
      replayed: false,
    });
    expect(login.abEmailQueuedAt).toBeTruthy();
    const afterLogin = expectStatus(await get(world.admin.token, `/batches/${created.id}`), 200);
    expect(afterLogin).toMatchObject({ status: "in_progress", statusVersion: 4 });
    const mails = await EmailQueue.find({ kind: "assessor_login" }).lean();
    expect(mails).toHaveLength(1);
    expect([...mails[0].to].sort()).toEqual(["one@ab.example", "two@ab.example"]);

    const events = expectStatus(
      await get(world.admin.token, `/batches/${created.id}/login-events`),
      200,
    );
    expect(events.items).toHaveLength(1);

    // Attendance: Asha and Chitra present, Bala absent.
    const attendance = expectStatus(
      await post(assessorSession.token, `/assessor/batches/${created.id}/attendance`, {
        capturedAt: CAPTURED_AT,
        records: [
          { candidateId: roster[0].id, present: true, idVerified: true },
          { candidateId: roster[1].id, present: false, note: "Did not report" },
          { candidateId: roster[2].id, present: true, idVerified: true },
        ],
      }),
      200,
    );
    expect(attendance.items).toHaveLength(3);
    expect(await AttendanceRecord.countDocuments({ batchId: created.id })).toBe(3);

    // Checklist with completeAssessment moves the batch on.
    const checklist = expectStatus(
      await post(assessorSession.token, `/assessor/batches/${created.id}/checklist`, {
        clientEventId: nextId("chk"),
        capturedAt: CAPTURED_LATER_AT,
        items: [
          { key: "multimeter", label: "Digital multimeter", available: true },
          { key: "soldering-station", available: false, note: "One of two units faulty" },
        ],
        completeAssessment: true,
      }),
      200,
    );
    expect(checklist).toMatchObject({
      replayed: false,
      batchStatus: "assessment_completed",
      batchStatusVersion: 5,
    });

    // aa_admin enters marks. Outcomes come from the server.
    const drafted = expectStatus(
      await put(world.admin.token, `/batches/${created.id}/results`, {
        rows: [
          { candidateId: roster[0].id, nos: PASS_NOS },
          { candidateId: roster[1].id, nos: [] },
          { candidateId: roster[2].id, nos: FAIL_NOS },
        ],
        changeReason: "Marks sheet received from the assessor",
      }),
      200,
    );
    expect(drafted.status).toBe("draft");
    expect(Object.fromEntries(drafted.rows.map((row) => [row.candidateId, row.outcome]))).toEqual({
      [roster[0].id]: "Pass",
      [roster[1].id]: "Absent",
      [roster[2].id]: "Fail",
    });
    const midway = await Batch.findById(created.id).lean();
    expect(midway).toMatchObject({ status: "assessment_completed", statusVersion: 5 });
    expect(String(midway.resultId)).toBe(drafted.id);

    // Submit, validate, publish.
    const submitted = expectStatus(
      await post(world.admin.token, `/batches/${created.id}/submit-result`),
      200,
    );
    expect(submitted).toMatchObject({
      status: "submitted",
      batchStatus: "result_submitted",
      batchStatusVersion: 6,
      submittedBy: world.admin.userId,
    });
    expect(submitted.submittedAt).toBeTruthy();

    const validated = expectStatus(
      await post(world.reviewer.token, `/batches/${created.id}/validate`, {
        reason: "Checked against the marks sheet",
      }),
      200,
    );
    expect(validated).toMatchObject({
      status: "validated",
      batchStatus: "ab_validated",
      batchStatusVersion: 7,
      validatedBy: world.reviewer.userId,
    });

    const published = expectStatus(
      await post(world.reviewer.token, `/batches/${created.id}/publish`),
      200,
    );
    expect(published).toMatchObject({
      status: "published",
      batchStatus: "published",
      batchStatusVersion: 8,
      publishedBy: world.reviewer.userId,
    });
    expect(published.publishedAt).toBeTruthy();

    const final = expectStatus(await get(world.admin.token, `/batches/${created.id}`), 200);
    expect(final).toMatchObject({ status: "published", statusVersion: 8, resultId: drafted.id });
    expect(final.sla.breached).toEqual([]);
    expect(final.sla.lateActions).toEqual([]);
    expect((await Result.findById(drafted.id).lean()).status).toBe("published");

    const changeLog = expectStatus(
      await get(world.admin.token, `/results/${drafted.id}/change-log`),
      200,
    );
    expect(changeLog.items.map((row) => row.action)).toEqual([
      "save",
      "submit",
      "validate",
      "publish",
    ]);

    // Audit trail: one batch.* row per status step, by the right actor.
    const rows = await auditRows({ batchId: created.id });
    const statusSteps = rows
      .filter((row) => row.action.startsWith("batch.") && row.action !== "batch.create")
      .map((row) => [row.action, row.actorRole]);
    expect(statusSteps).toEqual([
      ["batch.accept", "aa_admin"],
      ["batch.assign", "aa_admin"],
      ["batch.login-event", "assessor"],
      ["batch.checklist", "assessor"],
      ["batch.submit-result", "aa_admin"],
      ["batch.validate", "ab_reviewer"],
      ["batch.publish", "ab_reviewer"],
    ]);
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "batch.create",
      "candidate.create",
      "loginEvent.create",
      "attendance.record",
      "checklist.create",
      "result.save",
      "result.submit",
      "result.validate",
      "result.publish",
    ]) {
      expect(actions, `audit action ${action}`).toContain(action);
    }
    const createRow = rows.find((row) => row.action === "batch.create");
    expect(createRow.actorRole).toBe("ab_reviewer");
    const accept = rows.find((row) => row.action === "batch.accept");
    expect(accept.before).toMatchObject({ status: "allocated", statusVersion: 1 });
    expect(accept.after).toMatchObject({ status: "accepted", statusVersion: 2 });

    // No token, refresh token, password or hash in any audit row, stored or read back.
    const everyRow = await auditRows();
    const stored_ = JSON.stringify(everyRow);
    for (const secret of secrets) expect(stored_).not.toContain(secret);
    expect(stored_).not.toMatch(/\$2[aby]\$/);
    const viaApi = expectStatus(
      await get(world.admin.token, "/audit-logs", { entity: "batch", entityId: created.id }),
      200,
    );
    expect(viaApi.items.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(JSON.stringify(viaApi)).not.toContain(secret);
    const loginRows = everyRow.filter((row) => row.action === "auth.login");
    expect(loginRows.length).toBeGreaterThanOrEqual(3);
    for (const row of loginRows) {
      expect(JSON.stringify(row.meta?.requestBody ?? {})).not.toMatch(/Correct-Horse-9/);
    }
  });

  it("matches the worked example in the contract for an STT batch", async () => {
    // SCHEMA §2.1 and API_CONTRACT POST /batches: allocated Thursday 08 Oct 2026 08:00Z (13:30 IST).
    const body = await withFrozenDate("2026-10-08T08:00:00.000Z", async () => {
      const world = await makeWorld();
      return createBatch(world, {
        assessmentStartDate: "2026-11-20",
        assessmentEndDate: "2026-11-21",
        candidateCount: 24,
      });
    });
    expect(body.allocatedAt).toBe("2026-10-08T08:00:00.000Z");
    expect(body.sla).toMatchObject({
      acceptDueAt: "2026-10-12T18:29:59.999Z",
      assignDueAt: "2026-10-19T18:29:59.999Z",
      resultDueAt: "2026-11-25T18:29:59.999Z",
      breached: [],
    });
  });

  it("refuses steps taken out of order and leaves the batch where it was", async () => {
    const world = await makeWorld();
    const { assessor, session } = await makeAssessor(world);
    const batch = await createBatch(world, { candidateCount: 3 });
    const base = `/batches/${batch.id}`;

    // Allocated: nothing past accept/reject/cancel is open.
    expectError(
      await post(world.admin.token, `${base}/assign`, { assessorId: assessor.id }),
      409,
      "INVALID_TRANSITION",
    );
    expectError(await post(world.admin.token, `${base}/submit-result`), 409, "INVALID_TRANSITION");
    expectError(await post(world.reviewer.token, `${base}/validate`), 409, "INVALID_TRANSITION");
    expectError(await post(world.reviewer.token, `${base}/publish`), 409, "INVALID_TRANSITION");
    expectError(
      await post(world.admin.token, `${base}/complete`, { reason: "Skipping ahead" }),
      409,
      "INVALID_TRANSITION",
    );
    expectError(
      await put(world.admin.token, `${base}/results`, { rows: [] }),
      409,
      "INVALID_TRANSITION",
    );

    // Accepted but not assigned: the assessor is not on the batch yet.
    expectStatus(await post(world.admin.token, `${base}/accept`), 200);
    expectError(await post(world.admin.token, `${base}/accept`), 409, "INVALID_TRANSITION");
    expectError(
      await post(session.token, "/assessor/login-event", loginEventBody(batch.id)),
      403,
      "FORBIDDEN",
    );

    // Assigned: attendance and checklist wait for the first login.
    expectStatus(await post(world.admin.token, `${base}/assign`, { assessorId: assessor.id }), 200);
    expectError(
      await post(session.token, `/assessor/batches/${batch.id}/attendance`, {
        capturedAt: CAPTURED_AT,
        records: [{ candidateId: GHOST_ID, present: true }],
      }),
      409,
      "INVALID_TRANSITION",
    );
    expectError(
      await post(session.token, `/assessor/batches/${batch.id}/checklist`, {
        clientEventId: nextId("chk"),
        capturedAt: CAPTURED_AT,
        items: [{ key: "multimeter", available: true }],
        completeAssessment: true,
      }),
      409,
      "INVALID_TRANSITION",
    );

    // A login outside the assessment window is refused and does not start the batch.
    const early = await post(
      session.token,
      "/assessor/login-event",
      loginEventBody(batch.id, { capturedAt: "2099-06-14T05:00:00.000Z" }),
    );
    expectError(early, 400, "VALIDATION_ERROR");
    expect(early.body.error.details.capturedAt).toBeTruthy();

    const row = await Batch.findById(batch.id).lean();
    expect(row).toMatchObject({ status: "assessor_assigned", statusVersion: 3 });
  });

  it("refuses a new batch whose reference data does not fit together", async () => {
    const world = await makeWorld();
    // Centre of another training partner.
    const wrongCentre = await tryCreateBatch(world, { centreId: world.otherTpCentre.id });
    expectError(wrongCentre, 400, "VALIDATION_ERROR");
    expect(wrongCentre.body.error.details.centreId).toBeTruthy();
    // sector and ratioClass are copied by the server and cannot be sent.
    expectError(
      await tryCreateBatch(world, { sector: "Healthcare", ratioClass: "services" }),
      400,
      "VALIDATION_ERROR",
    );
    // A reviewer cannot allocate for another awarding body; mis cannot allocate at all.
    expectError(await tryCreateBatch(world, {}, world.otherReviewer.token), 403, "FORBIDDEN");
    const mis = await sessionFor("mis");
    expectError(await tryCreateBatch(world, {}, mis.token), 403, "FORBIDDEN");
    expect(await Batch.countDocuments({})).toBe(0);
  });
});
