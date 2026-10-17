import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { Attempt } from "../src/models/attempt.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Learner } from "../src/models/learner.model.js";
import { ProctoringFlag } from "../src/models/proctoring-flag.model.js";
import { ProctoringSession } from "../src/models/proctoring-session.model.js";
import { Question } from "../src/models/question.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { buildDemoData, seedDemoFull } from "../src/scripts/seed-demo-full.js";

const id = () => new mongoose.Types.ObjectId();
const refs = {
  ab: { _id: id() },
  qualification: {
    _id: id(),
    sector: "Electronics",
    ratioClass: "manufacturing",
    nos: [{ nosId: "NOS-01", pcs: [{ pcId: "PC-01" }] }],
  },
  admin: { _id: id() },
  assessor: { _id: id() },
  proctor: { _id: id() },
};
const dueFor = async ({ allocatedAt }) => ({
  acceptDueAt: allocatedAt,
  assignDueAt: allocatedAt,
  resultDueAt: allocatedAt,
});

function problems(Model, docs) {
  return docs
    .map((doc, i) => {
      const err = new Model(doc).validateSync();
      return err ? `${Model.modelName}[${i}]: ${err.message}` : null;
    })
    .filter(Boolean);
}

describe("full demo seed", () => {
  it("builds documents that pass every model's validation", async () => {
    const d = await buildDemoData(refs, dueFor);
    const batches = d.batches.map(({ tpSlot: _tp, centreSlot: _c, ...b }) => ({
      ...b,
      tpId: id(),
      centreId: id(),
      state: "Karnataka",
    }));
    expect([
      ...problems(
        Centre,
        d.centres.map(({ tp: _tp, ...c }) => ({ ...c, tpId: id() })),
      ),
      ...problems(Question, d.questions),
      ...problems(TestPaper, d.papers),
      ...problems(Learner, d.learners),
      ...problems(Batch, batches),
      ...problems(Candidate, d.candidates),
      ...problems(Attempt, d.attempts),
      ...problems(ProctoringSession, d.sessions),
      ...problems(ProctoringFlag, d.flags),
    ]).toEqual([]);
  });

  it("has the shape the demo needs", async () => {
    const d = await buildDemoData(refs, dueFor);
    expect(d.learners).toHaveLength(30);
    expect(new Set(d.loginIds).size).toBe(30);
    expect(d.batches.map((b) => b.status)).toEqual([
      "allocated",
      "accepted",
      "assessor_assigned",
      "in_progress",
      "assessment_completed",
    ]);
    expect(d.batches[3].languagePapers).toHaveLength(1);
    expect(d.attempts.some((a) => a.status === "in_progress")).toBe(true);
    expect(d.flags.length).toBeGreaterThan(5);
    const keys = d.attempts.map((a) => `${a.testPaperId}:${a.candidateId}`);
    expect(new Set(keys).size).toBe(keys.length);
    const flagKeys = d.flags.map((f) => `${f.sessionId}:${f.clientEventId}`);
    expect(new Set(flagKeys).size).toBe(flagKeys.length);
    for (const a of d.attempts.filter((x) => x.status === "submitted")) {
      expect(a.scores.complete).toBe(true);
      expect(a.scores.obtainedMarks).toBeLessThanOrEqual(a.scores.maxMarks);
    }
  });

  it("refuses to run in production", async () => {
    await expect(seedDemoFull({ nodeEnv: "production" })).rejects.toThrow(/production/);
  });
});
