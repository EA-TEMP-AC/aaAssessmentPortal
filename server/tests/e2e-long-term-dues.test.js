import { Batch } from "../src/models/batch.model.js";
import {
  addRoster,
  auditRows,
  bootE2e,
  createBatch,
  createLearners,
  del,
  dueAfter,
  dueBefore,
  expectStatus,
  get,
  makeWorld,
  post,
  put,
  resetE2e,
  shutdownE2e,
} from "./helpers/e2e.js";

/**
 * T-01 flow 2. Long-term batch dues: assign is due 30 working days before the exam date,
 * result is due 5 working days after the exam date, and holidays move both but only for
 * batches created afterwards. docs/SCHEMA.md §2.1–§2.3; API_CONTRACT.md POST /batches.
 */
const EXAM = "2026-11-20"; // Friday
const LTT = { type: "LTT", assessmentStartDate: EXAM, assessmentEndDate: EXAM };

describe("e2e: long-term batch dues", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  it("stores the contract's LTT example: assign 30 WD before the exam, result 5 WD after", async () => {
    const world = await makeWorld();
    const batch = await createBatch(world, LTT);
    expect(batch.type).toBe("LTT");
    expect(batch.sla).toMatchObject({
      assignDueAt: "2026-10-09T18:29:59.999Z",
      resultDueAt: "2026-11-27T18:29:59.999Z",
    });
    // `sla.breached` is recomputed on read against the real clock, so it is not asserted here.
    // The independent oracle agrees with the written example.
    expect(batch.sla.assignDueAt).toBe(dueBefore(EXAM, 30));
    expect(batch.sla.resultDueAt).toBe(dueAfter(EXAM, 5));
    // Accept stays 2 WD after allocation, whatever the type.
    expect(batch.sla.acceptDueAt).toBe(dueAfter(batch.allocatedAt, 2));
  });

  it("anchors an LTT result on the exam date, not on the assessment end date", async () => {
    const world = await makeWorld();
    const multiDay = await createBatch(world, {
      ...LTT,
      assessmentEndDate: "2026-11-24",
    });
    // Counting from the 24th would give 2026-12-01. The exam date is the 20th.
    expect(multiDay.sla.resultDueAt).toBe("2026-11-27T18:29:59.999Z");
    const stt = await createBatch(world, {
      type: "STT",
      assessmentStartDate: EXAM,
      assessmentEndDate: "2026-11-24",
    });
    // An STT batch with the same dates counts 3 WD from the end date and 7 WD from allocation.
    expect(stt.sla.resultDueAt).toBe(dueAfter("2026-11-24", 3));
    expect(stt.sla.resultDueAt).toBe("2026-11-27T18:29:59.999Z");
    expect(stt.sla.assignDueAt).toBe(dueAfter(stt.allocatedAt, 7));
    expect(stt.sla.assignDueAt).not.toBe(multiDay.sla.assignDueAt);
  });

  it("skips AA-wide holidays between the dates, and never rewrites a batch that already exists", async () => {
    const world = await makeWorld();
    const before = await createBatch(world, LTT);
    expect(before.sla.assignDueAt).toBe("2026-10-09T18:29:59.999Z");
    expect(before.sla.resultDueAt).toBe("2026-11-27T18:29:59.999Z");

    // Thu 22 Oct 2026 falls inside the 30 working days before the exam.
    // Wed 25 Nov 2026 falls inside the 5 working days after it.
    const diwali = expectStatus(
      await post(world.admin.token, "/admin/holidays", {
        date: "2026-10-22",
        name: "Test holiday before the exam",
        region: null,
      }),
      201,
    );
    const afterExam = expectStatus(
      await post(world.admin.token, "/admin/holidays", {
        date: "2026-11-25",
        name: "Test holiday after the exam",
        region: null,
      }),
      201,
    );

    // Holiday writes are audit-logged.
    const holidayAudits = await auditRows({ entity: "holiday" });
    expect(holidayAudits.map((row) => row.action)).toEqual(["holiday.create", "holiday.create"]);

    const after = await createBatch(world, LTT);
    // One working day earlier for the assign due: Thu 08 Oct instead of Fri 09 Oct.
    expect(after.sla.assignDueAt).toBe("2026-10-08T18:29:59.999Z");
    expect(after.sla.assignDueAt).toBe(dueBefore(EXAM, 30, { holidays: ["2026-10-22"] }));
    // One working day later for the result due: Mon 30 Nov instead of Fri 27 Nov.
    expect(after.sla.resultDueAt).toBe("2026-11-30T18:29:59.999Z");
    expect(after.sla.resultDueAt).toBe(dueAfter(EXAM, 5, { holidays: ["2026-11-25"] }));

    // The batch that existed before the holidays keeps its stored instants (SCHEMA §2.2).
    const reread = expectStatus(await get(world.admin.token, `/batches/${before.id}`), 200);
    expect(reread.sla).toMatchObject({
      acceptDueAt: before.sla.acceptDueAt,
      assignDueAt: "2026-10-09T18:29:59.999Z",
      resultDueAt: "2026-11-27T18:29:59.999Z",
    });
    const storedBefore = await Batch.findById(before.id).lean();
    expect(storedBefore.sla.assignDueAt.toISOString()).toBe("2026-10-09T18:29:59.999Z");
    expect(storedBefore.sla.resultDueAt.toISOString()).toBe("2026-11-27T18:29:59.999Z");

    // Removing a holiday is audit-logged and does not move the batch created while it stood.
    expect((await del(world.admin.token, `/admin/holidays/${afterExam.id}`)).status).toBe(204);
    expect((await auditRows({ entity: "holiday" })).map((row) => row.action)).toContain(
      "holiday.delete",
    );
    const stillHeld = await Batch.findById(after.id).lean();
    expect(stillHeld.sla.resultDueAt.toISOString()).toBe("2026-11-30T18:29:59.999Z");
    const next = await createBatch(world, LTT);
    expect(next.sla.resultDueAt).toBe("2026-11-27T18:29:59.999Z");
    expect(next.sla.assignDueAt).toBe("2026-10-08T18:29:59.999Z");
    expect(diwali.id).toBeTruthy();
  });

  it("honours a changed weekend for new batches", async () => {
    const world = await makeWorld();
    // Friday and Saturday off, so Sunday counts as a working day.
    expectStatus(
      await put(world.admin.token, "/admin/working-day-config", { weekendDays: [5, 6] }),
      200,
    );
    const batch = await createBatch(world, LTT);
    expect(batch.sla.resultDueAt).toBe(dueAfter(EXAM, 5, { weekend: [5, 6] }));
    expect(batch.sla.assignDueAt).toBe(dueBefore(EXAM, 30, { weekend: [5, 6] }));
  });

  it("keeps the stored result and assign dues when the batch is accepted", async () => {
    const world = await makeWorld();
    const learners = await createLearners(world, 2);
    const batch = await createBatch(world, {
      type: "LTT",
      assessmentStartDate: "2099-06-15",
      assessmentEndDate: "2099-06-16",
      candidateCount: 2,
    });
    await addRoster(world, batch.id, learners);
    const accepted = expectStatus(
      await post(world.admin.token, `/batches/${batch.id}/accept`),
      200,
    );
    // Accepting does not recompute the other dues.
    expect(accepted.sla.assignDueAt).toBe(batch.sla.assignDueAt);
    expect(accepted.sla.resultDueAt).toBe(batch.sla.resultDueAt);
    expect(accepted.sla.resultDueAt).toBe(dueAfter("2099-06-15", 5));
  });
});
