import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { Batch } from "../src/models/batch.model.js";
import {
  auditRows,
  bootE2e,
  createBatch,
  expectError,
  expectStatus,
  get,
  istDateOf,
  makeWorld,
  post,
  prepareBatch,
  put,
  resetE2e,
  sessionFor,
  shutdownE2e,
  tryCreateBatch,
  withFrozenDate,
} from "./helpers/e2e.js";

/**
 * T-01 flow 5. Recognition scope on batch create and on reassessment create: sector, state,
 * start date and end date, the aa_admin override, and the fact that ab_reviewer cannot override.
 * docs/SCHEMA.md §3.17, §4.3; API_CONTRACT.md GET|PUT /admin/recognition; DECISIONS.md A-03.
 */
function recognition(overrides = {}) {
  return {
    sectors: ["Electronics"],
    panIndia: false,
    states: ["Maharashtra"],
    startDate: "2020-01-01",
    endDate: "2099-12-31",
    ...overrides,
  };
}

async function setRecognition(world, overrides, session = world.admin) {
  return expectStatus(await put(session.token, "/admin/recognition", recognition(overrides)), 200);
}

async function expectOutside(world, checks, overrides) {
  const res = await tryCreateBatch(world, overrides);
  expectError(res, 409, "RULE_OUTSIDE_RECOGNITION");
  expect(res.body.error.details.checks).toEqual(checks);
  return res;
}

describe("e2e: recognition scope", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  it("treats a missing recognition record as 'unconfigured'", async () => {
    const world = await makeWorld({ recognition: false });
    expectError(await get(world.admin.token, "/admin/recognition"), 404, "NOT_FOUND");
    await expectOutside(world, ["unconfigured"]);
    expect(await Batch.countDocuments({})).toBe(0);
    // aa_admin may still allocate with a reason; the batch records what was missing.
    const res = await tryCreateBatch(world, {
      recognitionOverrideReason: "Recognition letter pending",
    });
    const batch = expectStatus(res, 201);
    expect(batch.recognitionOverride).toMatchObject({
      reason: "Recognition letter pending",
      checks: ["unconfigured"],
    });
  });

  it("fails each check on its own: sector, state, not_started, expired", async () => {
    const world = await makeWorld();
    await setRecognition(world, { sectors: ["Construction"] });
    await expectOutside(world, ["sector"]);

    await setRecognition(world, { states: ["Gujarat"] });
    await expectOutside(world, ["state"]);

    await setRecognition(world, { startDate: "2099-01-01" });
    await expectOutside(world, ["not_started"]);

    await setRecognition(world, { startDate: "2020-01-01", endDate: "2020-12-31" });
    await expectOutside(world, ["expired"]);

    expect(await Batch.countDocuments({})).toBe(0);
  });

  it("lists every failed check together, in a fixed order", async () => {
    const world = await makeWorld();
    await setRecognition(world, {
      sectors: ["Construction"],
      states: ["Gujarat"],
      startDate: "2020-01-01",
      endDate: "2020-12-31",
    });
    await expectOutside(world, ["sector", "state", "expired"]);
    await setRecognition(world, {
      sectors: ["Construction"],
      states: ["Gujarat"],
      startDate: "2099-01-01",
      endDate: "2099-12-31",
    });
    await expectOutside(world, ["sector", "state", "not_started"]);
  });

  it("lets a PAN India recognition cover any centre state", async () => {
    const world = await makeWorld();
    await setRecognition(world, { panIndia: true, states: [] });
    const batch = await createBatch(world);
    expect(batch.state).toBe("Maharashtra");
    expect(batch.recognitionOverride).toBeNull();
  });

  it("compares the dates with today's IST date, both ends inclusive", async () => {
    const world = await makeWorld();
    // 20:00 UTC on 14 Oct is 01:30 IST on 15 Oct.
    await withFrozenDate("2026-10-14T20:00:00.000Z", async () => {
      const admin = await sessionFor("aa_admin", { email: "frozen@aa.example" });
      expect(istDateOf(new Date())).toBe("2026-10-15");
      const withDates = async (startDate, endDate) => {
        await setRecognition(world, { startDate, endDate }, admin);
        return tryCreateBatch(world, {}, admin.token);
      };
      // The UTC date is still the 14th; the AA is already on the 15th.
      expectError(await withDates("2026-01-01", "2026-10-14"), 409, "RULE_OUTSIDE_RECOGNITION");
      expectStatus(await withDates("2026-01-01", "2026-10-15"), 201);
      expectStatus(await withDates("2026-10-15", "2026-12-31"), 201);
      const tooEarly = await withDates("2026-10-16", "2026-12-31");
      expectError(tooEarly, 409, "RULE_OUTSIDE_RECOGNITION");
      expect(tooEarly.body.error.details.checks).toEqual(["not_started"]);
    });
  });

  describe("override", () => {
    it("lets aa_admin allocate outside recognition with a reason, and records it", async () => {
      const world = await makeWorld();
      await setRecognition(world, { sectors: ["Construction"], states: ["Gujarat"] });
      const batch = expectStatus(
        await tryCreateBatch(world, {
          recognitionOverrideReason: "NCVET extension letter on file",
        }),
        201,
      );
      expect(batch.recognitionOverride).toMatchObject({
        byUserId: world.admin.userId,
        reason: "NCVET extension letter on file",
        checks: ["sector", "state"],
      });
      expect(batch.recognitionOverride.at).toBeTruthy();
      expect(await Batch.countDocuments({})).toBe(1);

      const audit = (await auditRows({ batchId: batch.id })).find(
        (row) => row.action === "recognition_override",
      );
      expect(audit.actorRole).toBe("aa_admin");
      expect(audit.meta).toMatchObject({
        reason: "NCVET extension letter on file",
        checks: ["sector", "state"],
      });
      // Read back, the override is on the batch.
      const read = expectStatus(await get(world.admin.token, `/batches/${batch.id}`), 200);
      expect(read.recognitionOverride.checks).toEqual(["sector", "state"]);
    });

    it("does not let an ab_reviewer override, even with a reason", async () => {
      const world = await makeWorld();
      await setRecognition(world, { sectors: ["Construction"] });
      const res = await tryCreateBatch(
        world,
        { recognitionOverrideReason: "Please let this through" },
        world.reviewer.token,
      );
      expectError(res, 409, "RULE_OUTSIDE_RECOGNITION");
      expect(res.body.error.details.checks).toEqual(["sector"]);
      expect(await Batch.countDocuments({})).toBe(0);
      const actions = (await auditRows()).map((row) => row.action);
      expect(actions).not.toContain("recognition_override");
    });

    it("rejects a blank reason, and stores nothing when none was needed", async () => {
      const world = await makeWorld();
      await setRecognition(world, { sectors: ["Construction"] });
      expectError(
        await tryCreateBatch(world, { recognitionOverrideReason: "   " }),
        400,
        "VALIDATION_ERROR",
      );
      await setRecognition(world, {});
      const batch = expectStatus(
        await tryCreateBatch(world, { recognitionOverrideReason: "Not needed" }),
        201,
      );
      expect(batch.recognitionOverride).toBeNull();
      const actions = (await auditRows({ batchId: batch.id })).map((row) => row.action);
      expect(actions).not.toContain("recognition_override");
    });
  });

  it("audit-logs a change of recognition and leaves existing batches alone", async () => {
    const world = await makeWorld();
    const before = await createBatch(world);
    await setRecognition(world, { sectors: ["Construction"] });
    const rows = (await auditRows({ entity: "aaRecognition" })).map((row) => row.action);
    // One PUT in makeWorld and one here.
    expect(rows).toEqual(["aaRecognition.update", "aaRecognition.update"]);
    const last = (await auditRows({ entity: "aaRecognition" })).at(-1);
    expect(last.before.sectors).toEqual(["Electronics", "Construction"]);
    expect(last.after.sectors).toEqual(["Construction"]);

    const reread = expectStatus(await get(world.admin.token, `/batches/${before.id}`), 200);
    expect(reread).toMatchObject({ status: "allocated", sector: "Electronics" });
    expect(reread.recognitionOverride).toBeNull();
    expect(await AaRecognition.countDocuments({})).toBe(1);
    await expectOutside(world, ["sector"]);
  });

  describe("reassessment create", () => {
    // The check runs again for a reassessment, with the parent's stored sector and the centre's state.
    async function publishedParent(world) {
      return prepareBatch(world, { until: "published" });
    }

    function reassessmentBody(overrides = {}) {
      const start = istDateOf(Date.now() + 30 * 86_400_000);
      return { assessmentStartDate: start, assessmentEndDate: start, ...overrides };
    }

    it("refuses when recognition no longer covers the parent's sector", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      await setRecognition(world, { sectors: ["Construction"] });

      for (const session of [world.admin, world.reviewer]) {
        const res = await post(
          session.token,
          `/batches/${parent.batch.id}/reassessments`,
          reassessmentBody(),
        );
        expectError(res, 409, "RULE_OUTSIDE_RECOGNITION");
        expect(res.body.error.details.checks).toEqual(["sector"]);
      }
      expect(await Batch.countDocuments({ isReassessment: true })).toBe(0);
    });

    it("lets aa_admin override with a reason but not the awarding body reviewer", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      await setRecognition(world, { sectors: ["Construction"] });
      const body = reassessmentBody({
        recognitionOverrideReason: "NCVET extension letter on file",
      });

      expectError(
        await post(world.reviewer.token, `/batches/${parent.batch.id}/reassessments`, body),
        409,
        "RULE_OUTSIDE_RECOGNITION",
      );
      const created = expectStatus(
        await post(world.admin.token, `/batches/${parent.batch.id}/reassessments`, body),
        201,
      );
      expect(created.isReassessment).toBe(true);
      expect(created.recognitionOverride).toMatchObject({
        reason: "NCVET extension letter on file",
        checks: ["sector"],
        byUserId: world.admin.userId,
      });
      const actions = (await auditRows({ batchId: created.id })).map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["batch.reassess", "recognition_override"]));
    });
  });
});
