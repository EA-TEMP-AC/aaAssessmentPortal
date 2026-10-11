import mongoose from "mongoose";
import { Batch } from "../src/models/batch.model.js";
import {
  markOverdueSlaBreaches,
  openBreachKeys,
  SLA_BREACH_JOB_INTERVAL_MS,
  startSlaBreachScheduler,
} from "../src/modules/batches/sla-breach-job.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

const past = new Date("2000-01-01T00:00:00.000Z");
const future = new Date("2099-01-01T00:00:00.000Z");
const now = new Date("2026-10-11T12:00:00.000Z");

function sla(overrides) {
  return {
    acceptDueAt: future,
    assignDueAt: future,
    resultDueAt: future,
    breached: [],
    lateActions: [],
    ...overrides,
  };
}

async function insertBatch(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  const { sla: slaOverrides, ...rest } = overrides;
  return Batch.create({
    _id,
    abId: new mongoose.Types.ObjectId(),
    qualificationId: new mongoose.Types.ObjectId(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2099-06-15",
    assessmentEndDate: "2099-06-16",
    tpId: new mongoose.Types.ObjectId(),
    centreId: new mongoose.Types.ObjectId(),
    candidateCount: 10,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Hindi",
    state: "Maharashtra",
    status: "allocated",
    statusVersion: 1,
    isReassessment: false,
    firstAssessmentBatchId: _id,
    allocatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...rest,
    sla: sla(slaOverrides),
  });
}

describe("nightly SLA breach job", () => {
  beforeAll(async () => {
    await startMongo();
    await Batch.syncIndexes();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("does not treat a missing due instant as already breached", () => {
    expect(
      openBreachKeys(
        { status: "assessment_completed", sla: { acceptDueAt: past, resultDueAt: null } },
        now,
      ),
    ).toEqual([]);
    expect(
      openBreachKeys({ status: "accepted", sla: { assignDueAt: past, resultDueAt: past } }, now),
    ).toEqual(["assign"]);
  });

  it("flags only open steps that are past due, and a second run changes nothing", async () => {
    const allocated = await insertBatch({
      status: "allocated",
      sla: { acceptDueAt: past, assignDueAt: past },
    });
    const accepted = await insertBatch({
      status: "accepted",
      sla: { acceptDueAt: past, assignDueAt: past },
    });
    await insertBatch({
      status: "rejected",
      sla: { acceptDueAt: past, assignDueAt: past, resultDueAt: past },
    });
    await insertBatch({
      status: "in_progress",
      sla: { acceptDueAt: past, assignDueAt: past, resultDueAt: past },
    });
    const completed = await insertBatch({
      status: "assessment_completed",
      sla: { acceptDueAt: past, assignDueAt: past, resultDueAt: past },
    });
    await insertBatch({
      status: "assessment_completed",
      sla: { resultDueAt: future },
    });
    await insertBatch({
      status: "allocated",
      sla: { acceptDueAt: future, assignDueAt: future },
    });

    expect(await markOverdueSlaBreaches(now)).toEqual({ accept: 1, assign: 2, result: 1 });
    expect(await markOverdueSlaBreaches(now)).toEqual({ accept: 0, assign: 0, result: 0 });

    const allocatedSaved = await Batch.findById(allocated._id).lean();
    const acceptedSaved = await Batch.findById(accepted._id).lean();
    const completedSaved = await Batch.findById(completed._id).lean();
    expect(allocatedSaved.sla.breached.slice().sort()).toEqual(["accept", "assign"]);
    expect(acceptedSaved.sla.breached).toEqual(["assign"]);
    expect(completedSaved.sla.breached).toEqual(["result"]);
    expect(await Batch.countDocuments({ "sla.breached": "accept" })).toBe(1);
  });

  it("does not duplicate a key when two runs overlap", async () => {
    await insertBatch({
      status: "allocated",
      sla: { acceptDueAt: past, assignDueAt: future },
    });
    await Promise.all([markOverdueSlaBreaches(now), markOverdueSlaBreaches(now)]);
    const saved = await Batch.findOne().lean();
    expect(saved.sla.breached).toEqual(["accept"]);
  });

  it("exposes a scheduler hook that tests can stop", async () => {
    expect(SLA_BREACH_JOB_INTERVAL_MS).toBe(86_400_000);
    vi.useFakeTimers();
    try {
      const run = vi.fn().mockResolvedValue({ accept: 0, assign: 0, result: 0 });
      const stop = startSlaBreachScheduler({ intervalMs: 60_000, run });
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(1);
      stop();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
