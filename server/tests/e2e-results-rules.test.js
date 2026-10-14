import { Batch } from "../src/models/batch.model.js";
import { Result } from "../src/models/result.model.js";
import {
  CAPTURED_AT,
  FAIL_NOS,
  GHOST_ID,
  PASS_NOS,
  addQualification,
  advanceBatch,
  auditRows,
  bootE2e,
  createLearners,
  expectError,
  expectStatus,
  get,
  makeWorld,
  nextId,
  patch,
  post,
  postCsv,
  prepareBatch,
  put,
  resetE2e,
  sessionFor,
  shutdownE2e,
} from "./helpers/e2e.js";

/**
 * T-01 flow 6. Results rules: Absent from attendance, partial rows, RESULT_INCOMPLETE, pass-mark
 * modes and units, return for correction, a closed result after publication, and who may read
 * an unpublished result.
 * docs/SCHEMA.md §3.7, §3.14; API_CONTRACT.md Results and return-for-correction;
 * DECISIONS.md results decisions (2026-10-12): Q120, Q122, Q125, Q127–Q130.
 */
const ALL_PRESENT = [true, true, true];

function outcomesOf(body) {
  return Object.fromEntries(body.rows.map((row) => [row.candidateId, row.outcome]));
}

function putRows(world, ctx, rows, extra = {}) {
  return put(world.admin.token, `/batches/${ctx.batch.id}/results`, { rows, ...extra });
}

function completed(world, options = {}) {
  return prepareBatch(world, { until: "completed", ...options });
}

describe("e2e: results rules", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  describe("Absent and attendance", () => {
    it("takes Absent from attendance and refuses rows that contradict it", async () => {
      const world = await makeWorld();
      const ctx = await completed(world); // Asha present, Bala absent, Chitra present
      const [asha, bala, chitra] = ctx.roster.map((row) => row.id);

      const saved = expectStatus(
        await putRows(world, ctx, [
          { candidateId: asha, nos: PASS_NOS },
          { candidateId: bala, nos: [] },
          { candidateId: chitra, nos: FAIL_NOS },
        ]),
        200,
      );
      expect(outcomesOf(saved)).toEqual({ [asha]: "Pass", [bala]: "Absent", [chitra]: "Fail" });
      expect(saved.rows.find((row) => row.candidateId === bala)).toEqual({
        candidateId: bala,
        absent: true,
        outcome: "Absent",
        nos: [],
      });

      const contradictions = {
        "absent flag on a present candidate": [{ candidateId: asha, absent: true, nos: [] }],
        "present flag on an absent candidate": [{ candidateId: bala, absent: false, nos: [] }],
        "marks for an absent candidate": [{ candidateId: bala, nos: PASS_NOS }],
        "a candidate that is not on the roster": [{ candidateId: GHOST_ID, nos: PASS_NOS }],
        "an NOS the qualification does not have": [
          { candidateId: asha, nos: [{ nosId: "NOS-99", theory: 50 }] },
        ],
      };
      for (const [label, rows] of Object.entries(contradictions)) {
        const res = await putRows(world, ctx, rows);
        expect(res.status, label).toBe(400);
        expect(res.body.error.code, label).toBe("VALIDATION_ERROR");
      }
      // A refused PUT leaves the saved draft as it was.
      const reread = expectStatus(
        await get(world.admin.token, `/batches/${ctx.batch.id}/results`),
        200,
      );
      expect(outcomesOf(reread)).toEqual({ [asha]: "Pass", [bala]: "Absent", [chitra]: "Fail" });
    });

    it("never trusts a client outcome", async () => {
      const world = await makeWorld();
      const ctx = await completed(world);
      const [asha, bala] = ctx.roster.map((row) => row.id);
      const wrong = await putRows(world, ctx, [
        { candidateId: asha, nos: PASS_NOS, outcome: "Fail" },
        { candidateId: bala, nos: [], outcome: "Pass" },
      ]);
      expectError(wrong, 400, "RESULT_OUTCOME_MISMATCH");
      expect(wrong.body.error.details.rows).toEqual(
        expect.arrayContaining([
          { candidateId: asha, outcome: "Pass" },
          { candidateId: bala, outcome: "Absent" },
        ]),
      );
      expect(await Result.countDocuments({})).toBe(0);
      // The same outcomes sent correctly are accepted.
      expectStatus(
        await putRows(world, ctx, [
          { candidateId: asha, nos: PASS_NOS, outcome: "Pass" },
          { candidateId: bala, nos: [], outcome: "Absent" },
        ]),
        200,
      );
    });

    it("treats a candidate with no attendance row as Absent only when the row says so", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "in_progress" });
      // The AA closes the assessment without attendance, with a reason (POST /complete).
      expectError(
        await post(world.admin.token, `/batches/${ctx.batch.id}/complete`, {}),
        400,
        "VALIDATION_ERROR",
      );
      const done = expectStatus(
        await post(world.admin.token, `/batches/${ctx.batch.id}/complete`, {
          reason: "Centre closed early; practical and viva completed; attendance on paper",
        }),
        200,
      );
      expect(done.status).toBe("assessment_completed");
      const [a, b, c] = ctx.roster.map((row) => row.id);
      const draft = expectStatus(
        await putRows(world, ctx, [
          { candidateId: a, nos: PASS_NOS },
          { candidateId: b, nos: [] },
          { candidateId: c, absent: true, nos: [] },
        ]),
        200,
      );
      // Row b has no marks and no absent flag: it stays unfinished rather than becoming Absent.
      expect(outcomesOf(draft)).toEqual({ [a]: "Pass", [b]: null, [c]: "Absent" });
      const res = await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {});
      expectError(res, 409, "RESULT_INCOMPLETE");
      expect(res.body.error.details.incompleteMarks).toEqual([b]);
    });
  });

  describe("partial rows and RESULT_INCOMPLETE", () => {
    it("gives a partly filled row no outcome and blocks submit until every row is finished", async () => {
      const world = await makeWorld();
      const ctx = await completed(world);
      const [asha, bala, chitra] = ctx.roster.map((row) => row.id);

      const draft = expectStatus(
        await putRows(world, ctx, [
          // Only one NOS, and NOS-02 has no marks yet.
          { candidateId: asha, nos: [PASS_NOS[0]] },
          { candidateId: bala, nos: [] },
        ]),
        200,
      );
      expect(outcomesOf(draft)).toEqual({ [asha]: null, [bala]: "Absent" });

      const blocked = await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {});
      expectError(blocked, 409, "RESULT_INCOMPLETE");
      expect(blocked.body.error.details).toEqual({
        missingCandidates: [chitra],
        incompleteMarks: [asha],
      });
      expect(await Batch.findById(ctx.batch.id).lean()).toMatchObject({
        status: "assessment_completed",
        statusVersion: 5,
      });
      expect((await Result.findOne({ batchId: ctx.batch.id }).lean()).status).toBe("draft");

      // A null mark inside a NOS is still incomplete.
      expectStatus(
        await putRows(world, ctx, [
          {
            candidateId: asha,
            nos: [PASS_NOS[0], { nosId: "NOS-02", theory: 60, practical: null }],
          },
          { candidateId: bala, nos: [] },
          { candidateId: chitra, nos: FAIL_NOS },
        ]),
        200,
      );
      expectError(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {}),
        409,
        "RESULT_INCOMPLETE",
      );

      expectStatus(
        await putRows(world, ctx, [
          { candidateId: asha, nos: PASS_NOS },
          { candidateId: bala, nos: [] },
          { candidateId: chitra, nos: FAIL_NOS },
        ]),
        200,
      );
      const submitted = expectStatus(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {}),
        200,
      );
      expect(submitted.batchStatus).toBe("result_submitted");
    });

    it("blocks submit when no draft exists at all", async () => {
      const world = await makeWorld();
      const ctx = await completed(world);
      const res = await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {});
      expectError(res, 409, "RESULT_INCOMPLETE");
      expect(res.body.error.details.missingCandidates.sort()).toEqual(
        ctx.roster.map((row) => row.id).sort(),
      );
    });

    it("does not ask for a row from a candidate deactivated before the assessment", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "accepted" });
      expectStatus(
        await patch(world.admin.token, `/batches/${ctx.batch.id}/candidates/${ctx.roster[2].id}`, {
          active: false,
        }),
        200,
      );
      ctx.roster = ctx.roster.slice(0, 2);
      ctx.presence = [true, false];
      await advanceBatch(ctx, "completed");
      const [asha, bala] = ctx.roster.map((row) => row.id);
      expectStatus(
        await putRows(world, ctx, [
          { candidateId: asha, nos: PASS_NOS },
          { candidateId: bala, nos: [] },
        ]),
        200,
      );
      expectStatus(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {}),
        200,
      );
    });
  });

  describe("pass marks", () => {
    it("scores NOS-wise by default, with the pass mark inclusive", async () => {
      const world = await makeWorld();
      const ctx = await completed(world, { presence: ALL_PRESENT });
      const [a, b, c] = ctx.roster.map((row) => row.id);
      const atMark = [
        { nosId: "NOS-01", theory: 50, practical: 50, viva: 50 },
        { nosId: "NOS-02", theory: 50, practical: 50, viva: 50 },
      ];
      const oneBelow = [
        { nosId: "NOS-01", theory: 50, practical: 50, viva: 50 },
        { nosId: "NOS-02", theory: 50, practical: 49.99, viva: 50 },
      ];
      const draft = expectStatus(
        await putRows(world, ctx, [
          { candidateId: a, nos: atMark },
          { candidateId: b, nos: oneBelow },
          { candidateId: c, nos: PASS_NOS },
        ]),
        200,
      );
      expect(outcomesOf(draft)).toEqual({ [a]: "Pass", [b]: "Fail", [c]: "Pass" });

      // Marks above the ceiling of 100 (percent, no maxMarks) are refused with the ceiling named.
      const over = await putRows(world, ctx, [
        { candidateId: a, nos: [{ nosId: "NOS-01", theory: 101, practical: 50, viva: 50 }] },
      ]);
      expectError(over, 400, "RESULT_PASS_MARK_INVALID");
      expect(over.body.error.details).toEqual({
        candidateId: a,
        nosId: "NOS-01",
        component: "theory",
        max: 100,
      });
    });

    it("scores a qualification with no passCriteriaMode as NOS-wise", async () => {
      const world = await makeWorld();
      const qualification = await addQualification(world, {
        code: "Q-NOMODE",
        passCriteriaMode: undefined,
      });
      const ctx = await completed(world, {
        qualificationId: qualification.id,
        presence: ALL_PRESENT,
      });
      const [a, b] = ctx.roster.map((row) => row.id);
      const draft = expectStatus(
        await putRows(world, ctx, [
          { candidateId: a, nos: PASS_NOS },
          { candidateId: b, nos: FAIL_NOS },
        ]),
        200,
      );
      expect(outcomesOf(draft)).toEqual({ [a]: "Pass", [b]: "Fail" });
    });

    it("scores an 'overall' qualification on the totals of each component", async () => {
      const world = await makeWorld();
      const overall = await addQualification(world, {
        code: "Q-OVERALL",
        passCriteriaMode: "overall",
      });
      const ctxOverall = await completed(world, {
        qualificationId: overall.id,
        presence: ALL_PRESENT,
      });
      const ctxNosWise = await completed(world, { presence: ALL_PRESENT });
      // Theory 40 and 70 average 55 %: enough overall, not enough NOS by NOS.
      const balanced = [
        { nosId: "NOS-01", theory: 40, practical: 80, viva: 80 },
        { nosId: "NOS-02", theory: 70, practical: 80, viva: 80 },
      ];
      // Theory 30 and 60 average 45 %.
      const short = [
        { nosId: "NOS-01", theory: 30, practical: 80, viva: 80 },
        { nosId: "NOS-02", theory: 60, practical: 80, viva: 80 },
      ];
      const [a, b] = ctxOverall.roster.map((row) => row.id);
      const viaOverall = expectStatus(
        await putRows(world, ctxOverall, [
          { candidateId: a, nos: balanced },
          { candidateId: b, nos: short },
        ]),
        200,
      );
      expect(outcomesOf(viaOverall)).toEqual({ [a]: "Pass", [b]: "Fail" });

      const [x] = ctxNosWise.roster.map((row) => row.id);
      const viaNosWise = expectStatus(
        await putRows(world, ctxNosWise, [{ candidateId: x, nos: balanced }]),
        200,
      );
      expect(outcomesOf(viaNosWise)).toEqual({ [x]: "Fail" });
    });

    it("compares raw marks with absolute pass marks and takes the ceiling from the NOS or the qualification", async () => {
      const world = await makeWorld();
      const absolute = await addQualification(world, {
        code: "Q-ABSOLUTE",
        passMarkUnit: "absolute",
        passMarks: { theory: 20, practical: 30, viva: 10 },
        maxMarks: { theory: 40, practical: 60, viva: 20 },
        nos: [
          { nosId: "NOS-01", code: "N01", name: "Safety", pcs: [] },
          {
            nosId: "NOS-02",
            code: "N02",
            name: "Wiring",
            maxMarks: { theory: 25, practical: null, viva: null },
            pcs: [],
          },
        ],
      });
      const ctx = await completed(world, { qualificationId: absolute.id, presence: ALL_PRESENT });
      const [a, b] = ctx.roster.map((row) => row.id);
      const atThreshold = [
        { nosId: "NOS-01", theory: 20, practical: 30, viva: 10 },
        { nosId: "NOS-02", theory: 20, practical: 30, viva: 10 },
      ];
      const oneShort = [
        { nosId: "NOS-01", theory: 20, practical: 30, viva: 10 },
        { nosId: "NOS-02", theory: 19, practical: 30, viva: 10 },
      ];
      const draft = expectStatus(
        await putRows(world, ctx, [
          { candidateId: a, nos: atThreshold },
          { candidateId: b, nos: oneShort },
        ]),
        200,
      );
      expect(outcomesOf(draft)).toEqual({ [a]: "Pass", [b]: "Fail" });

      // Ceiling from the qualification (40) and from the NOS (25).
      const aboveQualification = await putRows(world, ctx, [
        { candidateId: a, nos: [{ nosId: "NOS-01", theory: 41, practical: 30, viva: 10 }] },
      ]);
      expectError(aboveQualification, 400, "RESULT_PASS_MARK_INVALID");
      expect(aboveQualification.body.error.details).toMatchObject({ nosId: "NOS-01", max: 40 });
      const aboveNos = await putRows(world, ctx, [
        { candidateId: a, nos: [{ nosId: "NOS-02", theory: 26, practical: 30, viva: 10 }] },
      ]);
      expectError(aboveNos, 400, "RESULT_PASS_MARK_INVALID");
      expect(aboveNos.body.error.details).toMatchObject({
        nosId: "NOS-02",
        component: "theory",
        max: 25,
      });
    });

    it("does not ask for a component whose ceiling is 0 on that NOS", async () => {
      const world = await makeWorld();
      const qualification = await addQualification(world, {
        code: "Q-NOVIVA",
        nos: [
          { nosId: "NOS-01", code: "N01", name: "Safety", pcs: [] },
          {
            nosId: "NOS-02",
            code: "N02",
            name: "Wiring",
            maxMarks: { theory: null, practical: null, viva: 0 },
            pcs: [],
          },
        ],
      });
      const ctx = await completed(world, {
        qualificationId: qualification.id,
        presence: ALL_PRESENT,
      });
      const [a, b] = ctx.roster.map((row) => row.id);
      const draft = expectStatus(
        await putRows(world, ctx, [
          {
            candidateId: a,
            nos: [
              { nosId: "NOS-01", theory: 60, practical: 60, viva: 60 },
              { nosId: "NOS-02", theory: 60, practical: 60 },
            ],
          },
          {
            candidateId: b,
            nos: [
              { nosId: "NOS-01", theory: 60, practical: 60, viva: 60 },
              { nosId: "NOS-02", theory: 60 },
            ],
          },
        ]),
        200,
      );
      expect(outcomesOf(draft)).toEqual({ [a]: "Pass", [b]: null });
    });
  });

  describe("return for correction", () => {
    it("sends a submitted result back to draft, keeps the marks, and takes a corrected resubmit", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "submitted" });
      const base = `/batches/${ctx.batch.id}`;
      const [asha, bala, chitra] = ctx.roster.map((row) => row.id);

      // Who may return, and what is required.
      expectError(
        await post(world.admin.token, `${base}/return-for-correction`, { reason: "x" }),
        403,
        "FORBIDDEN",
      );
      expectError(
        await post(world.otherReviewer.token, `${base}/return-for-correction`, { reason: "x" }),
        403,
        "FORBIDDEN",
      );
      expectError(
        await post(world.reviewer.token, `${base}/return-for-correction`, {}),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await post(world.reviewer.token, `${base}/return-for-correction`, { reason: "  " }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await post(world.reviewer.token, `/batches/${GHOST_ID}/return-for-correction`, {
          reason: "x",
        }),
        404,
        "NOT_FOUND",
      );

      const reason = "NOS-02 theory marks do not match the marks sheet";
      const returned = expectStatus(
        await post(world.reviewer.token, `${base}/return-for-correction`, { reason }),
        200,
      );
      expect(returned).toMatchObject({
        status: "draft",
        batchStatus: "assessment_completed",
        batchStatusVersion: 7,
        submittedAt: null,
        submittedBy: null,
        validatedAt: null,
        validatedBy: null,
      });
      expect(outcomesOf(returned)).toEqual({ [asha]: "Pass", [bala]: "Absent", [chitra]: "Fail" });
      // Repeating the call is refused: the result is a draft now.
      expectError(
        await post(world.reviewer.token, `${base}/return-for-correction`, { reason }),
        409,
        "INVALID_TRANSITION",
      );

      // aa_admin corrects Chitra's NOS-02 theory mark and submits again.
      const fixed = expectStatus(
        await putRows(
          world,
          ctx,
          [
            { candidateId: asha, nos: PASS_NOS },
            { candidateId: bala, nos: [] },
            { candidateId: chitra, nos: PASS_NOS },
          ],
          { changeReason: "Corrected from the marks sheet" },
        ),
        200,
      );
      expect(outcomesOf(fixed)[chitra]).toBe("Pass");
      const resubmitted = expectStatus(
        await post(world.admin.token, `${base}/submit-result`, {}),
        200,
      );
      expect(resubmitted).toMatchObject({
        status: "submitted",
        batchStatus: "result_submitted",
        batchStatusVersion: 8,
      });

      const log = expectStatus(
        await get(world.admin.token, `/results/${ctx.result.id}/change-log`),
        200,
      );
      expect(log.items.map((row) => row.action)).toEqual([
        "save",
        "submit",
        "return",
        "save",
        "submit",
      ]);
      const returnRow = log.items[2];
      expect(returnRow).toMatchObject({
        fromStatus: "submitted",
        toStatus: "draft",
        reason,
        byRole: "ab_reviewer",
        changes: [],
      });
      expect(log.items[3].changes).toHaveLength(1);
      expect(log.items[3].changes[0]).toMatchObject({ candidateId: chitra });

      const audit = await auditRows({ batchId: ctx.batch.id });
      for (const action of ["batch.return-for-correction", "result.return"]) {
        const row = audit.find((r) => r.action === action);
        expect(row, action).toBeTruthy();
        expect(row.meta.reason).toBe(reason);
        expect(row.actorRole).toBe("ab_reviewer");
      }
    });

    it("also returns a validated result, never a published one, and has no limit on returns", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "validated" });
      const base = `/batches/${ctx.batch.id}`;
      for (let round = 1; round <= 3; round += 1) {
        expectStatus(
          await post(world.reviewer.token, `${base}/return-for-correction`, {
            reason: `Round ${round}`,
          }),
          200,
        );
        expectStatus(await post(world.admin.token, `${base}/submit-result`, {}), 200);
        expectStatus(await post(world.reviewer.token, `${base}/validate`, {}), 200);
      }
      expectStatus(await post(world.reviewer.token, `${base}/publish`, {}), 200);
      expectError(
        await post(world.reviewer.token, `${base}/return-for-correction`, { reason: "Too late" }),
        409,
        "INVALID_TRANSITION",
      );
      expect((await Batch.findById(ctx.batch.id).lean()).status).toBe("published");
    });

    it("keeps the original deadline: a corrected result sent after resultDueAt still needs a lateReason", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "submitted" });
      const base = `/batches/${ctx.batch.id}`;
      expectStatus(
        await post(world.reviewer.token, `${base}/return-for-correction`, { reason: "Fix marks" }),
        200,
      );
      await Batch.updateOne(
        { _id: ctx.batch.id },
        { $set: { "sla.resultDueAt": new Date("2020-01-01") } },
      );

      expectError(
        await post(world.admin.token, `${base}/submit-result`, {}),
        409,
        "SLA_RESULT_EXPIRED",
      );
      const sent = expectStatus(
        await post(world.admin.token, `${base}/submit-result`, {
          lateReason: "Marks re-checked after the AB query",
        }),
        200,
      );
      expect(sent.batchStatus).toBe("result_submitted");
      const batch = expectStatus(await get(world.admin.token, base), 200);
      expect(batch.sla.breached).toContain("result");
      expect(batch.sla.lateActions).toEqual([
        expect.objectContaining({ key: "result", reason: "Marks re-checked after the AB query" }),
      ]);
    });
  });

  describe("after publication", () => {
    it("closes every write path and changes nothing", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "published" });
      const base = `/batches/${ctx.batch.id}`;
      const before = await Batch.findById(ctx.batch.id).lean();
      const resultBefore = await Result.findOne({ batchId: ctx.batch.id }).lean();
      const stale = (res) => expectError(res, 409, "INVALID_TRANSITION");

      stale(await putRows(world, ctx, [{ candidateId: ctx.roster[0].id, nos: FAIL_NOS }]));
      stale(await post(world.admin.token, `${base}/submit-result`, {}));
      stale(await post(world.reviewer.token, `${base}/validate`, {}));
      stale(await post(world.reviewer.token, `${base}/publish`, {}));
      stale(await post(world.reviewer.token, `${base}/return-for-correction`, { reason: "No" }));
      stale(await post(world.admin.token, `${base}/accept`, {}));
      stale(await post(world.admin.token, `${base}/assign`, { assessorId: ctx.assessor.id }));
      stale(await post(world.admin.token, `${base}/reassign`, { assessorId: ctx.assessor.id }));
      stale(await post(world.admin.token, `${base}/cancel`, { reason: "Too late" }));
      stale(await post(world.admin.token, `${base}/complete`, { reason: "Too late" }));
      stale(
        await post(ctx.assessorSession.token, `/assessor/batches/${ctx.batch.id}/attendance`, {
          capturedAt: CAPTURED_AT,
          records: [{ candidateId: ctx.roster[0].id, present: false }],
        }),
      );
      stale(
        await post(ctx.assessorSession.token, `/assessor/batches/${ctx.batch.id}/checklist`, {
          clientEventId: nextId("chk"),
          capturedAt: CAPTURED_AT,
          items: [{ key: "multimeter", available: false }],
          completeAssessment: true,
        }),
      );
      const [extra] = await createLearners(world, 1);
      stale(await post(world.admin.token, `${base}/candidates`, { learnerId: extra.id }));
      stale(
        await patch(world.admin.token, `${base}/candidates/${ctx.roster[0].id}`, { active: false }),
      );
      stale(
        await postCsv(
          world.admin.token,
          `${base}/candidates/import`,
          "name,externalRef\nZed,Z-1\n",
        ),
      );

      const after = await Batch.findById(ctx.batch.id).lean();
      expect(after.status).toBe("published");
      expect(after.statusVersion).toBe(before.statusVersion);
      const resultAfter = await Result.findOne({ batchId: ctx.batch.id }).lean();
      expect(resultAfter.status).toBe("published");
      expect(resultAfter.rows).toEqual(resultBefore.rows);
      expect(resultAfter.publishedAt).toEqual(resultBefore.publishedAt);
    });

    it("still takes learner feedback, which is not part of the result", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "published" });
      const res = await put(world.admin.token, `/batches/${ctx.batch.id}/learner-feedback`, {
        collected: true,
        collectedOn: "2099-06-16",
        note: "Forms returned by all learners",
      });
      const body = expectStatus(res, 200);
      expect(body.learnerFeedback.collected).toBe(true);
      expect(body).toMatchObject({ status: "published", statusVersion: ctx.batch.statusVersion });
    });
  });

  describe("who can read an unpublished result", () => {
    it("hides it from candidate and tp until it is published, then scopes what they see", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "assigned" });
      const base = `/batches/${ctx.batch.id}/results`;
      const sessions = {
        candidate: await sessionFor("candidate", { linkedProfileId: ctx.learners[0].id }),
        tp: await sessionFor("tp", { tpId: world.tp.id }),
        mis: await sessionFor("mis"),
        ncvet_viewer: await sessionFor("ncvet_viewer"),
        proctor: await sessionFor("proctor"),
        sme: await sessionFor("sme"),
        reviewer: world.reviewer,
        assessor: ctx.assessorSession,
        admin: world.admin,
      };
      const canReadAnyStatus = ["admin", "mis", "assessor", "reviewer", "ncvet_viewer"];

      // No result yet is 404 for everyone who may read results.
      for (const role of canReadAnyStatus) {
        expectError(await get(sessions[role].token, base), 404, "NOT_FOUND");
      }

      const stages = ["drafted", "submitted", "validated"];
      for (const stage of stages) {
        await advanceBatch(ctx, stage);
        for (const role of canReadAnyStatus) {
          const res = await get(sessions[role].token, base);
          expect(res.status, `${role} at ${stage}`).toBe(200);
          expect(res.body.rows).toHaveLength(3);
        }
        for (const role of ["candidate", "tp"]) {
          expectError(await get(sessions[role].token, base), 404, "NOT_FOUND");
        }
        for (const role of ["proctor", "sme"]) {
          expectError(await get(sessions[role].token, base), 403, "FORBIDDEN");
        }
      }

      await advanceBatch(ctx, "published");
      const candidate = expectStatus(await get(sessions.candidate.token, base), 200);
      expect(candidate.status).toBe("published");
      expect(candidate.rows).toHaveLength(1);
      expect(candidate.rows[0].candidateId).toBe(ctx.roster[0].id);
      const tp = expectStatus(await get(sessions.tp.token, base), 200);
      expect(tp.rows).toHaveLength(3);

      // Row scope still applies to a published result.
      const stranger = await sessionFor("candidate", {
        email: "stranger@aa.example",
        linkedProfileId: GHOST_ID,
      });
      expectError(await get(stranger.token, base), 403, "FORBIDDEN");
      const otherTp = await sessionFor("tp", { email: "tp2@aa.example", tpId: world.otherTp.id });
      expectError(await get(otherTp.token, base), 403, "FORBIDDEN");
    });
  });
});
