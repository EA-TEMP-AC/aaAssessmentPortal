import { Batch } from "../src/models/batch.model.js";
import { Question } from "../src/models/question.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { User } from "../src/models/user.model.js";
import { listAvailable } from "../src/modules/attempts/attempt.service.js";
import { seedDemoExam } from "../src/scripts/seed-demo-exam.js";
import { SEED_BATCH_ID, seedMasterData } from "../src/scripts/seed-master-data.js";
import { seedRoleUsers } from "../src/scripts/seed-users.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

describe("demo exam seed (B-18a)", () => {
  beforeAll(async () => {
    await startMongo();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
  });

  it("refuses to run in production", async () => {
    await expect(seedDemoExam({ nodeEnv: "production" })).rejects.toThrow(/production/);
  });

  it("names the paper, sets it as the one paper of the seeded batch, and lists it for the candidate", async () => {
    await seedRoleUsers();
    await seedMasterData();
    const out = await seedDemoExam();
    expect(out.questions).toBe(12);

    const paper = await TestPaper.findById(out.paperId).lean();
    expect(paper).toMatchObject({
      name: "Demo exam (English)",
      status: "approved",
      complete: true,
    });
    const batch = await Batch.findById(SEED_BATCH_ID).lean();
    expect(String(batch.testPaperId)).toBe(out.paperId);
    expect(batch.status).toBe("in_progress");

    const candidate = await User.findOne({ email: "candidate@aa.example" }).lean();
    const { items } = await listAvailable(candidate);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      paperId: out.paperId,
      paperName: "Demo exam (English)",
      questionCount: 10,
      startable: { ok: true },
    });
    expect(
      await Question.countDocuments({ _id: { $in: paper.items.map((i) => i.questionId) } }),
    ).toBe(10);
  });

  it("can run again and keeps the same paper on the batch", async () => {
    await seedRoleUsers();
    await seedMasterData();
    const first = await seedDemoExam();
    const second = await seedDemoExam();
    expect(second.paperId).toBe(first.paperId);
    expect(await TestPaper.countDocuments()).toBe(1);
    expect(String((await Batch.findById(SEED_BATCH_ID).lean()).testPaperId)).toBe(first.paperId);
  });
});
