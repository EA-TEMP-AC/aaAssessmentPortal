import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { WeightProfile } from "../src/models/weight-profile.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { selectQuestions } from "../src/modules/test-generator/test-generator.service.js";
import {
  buildMixReport,
  targetCounts,
  weightsSumToHundred,
} from "../src/modules/test-generator/weight-math.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function sessionFor(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

function makeQualification(code = "QUAL-WP-01") {
  return Qualification.create({
    code,
    name: "Weight Test Qualification",
    sector: "Automotive",
    ratioClass: "manufacturing",
    defaultBatchType: "STT",
    passCriteriaMode: "nos_wise",
    passMarkUnit: "percent",
    passMarks: { theory: 60, practical: 70, viva: 60 },
    nos: [
      {
        nosId: "NOS-01",
        code: "N0101",
        name: "One",
        pcs: [
          { pcId: "PC-01", code: "PC1.1", name: "a", passMark: 60, maxMark: 100 },
          { pcId: "PC-02", code: "PC1.2", name: "b", passMark: 60, maxMark: 100 },
        ],
      },
    ],
  });
}

let seq = 0;
async function addQuestion(qual, overrides = {}) {
  seq += 1;
  const q = new Question({
    qualificationId: qual._id,
    nosId: "NOS-01",
    pcId: seq % 2 ? "PC-01" : "PC-02",
    type: "mcq",
    language: "en",
    stem: `SECRET-STEM-${seq}`,
    options: [
      { key: "A", text: "SECRET-OPT-A" },
      { key: "B", text: "SECRET-OPT-B" },
    ],
    correctAnswer: "A",
    marks: 1,
    status: "approved",
    version: 1,
    isLatest: true,
    createdBy: mongoose.Types.ObjectId.createFromTime(1),
    ...overrides,
  });
  q.rootQuestionId = q._id;
  await q.save();
  return q;
}

const D = (easy, medium, tough) => ({ easy, medium, tough });
const B = (o) => o;

describe("weight maths", () => {
  it("checks that percentages add up to 100 without float drift", () => {
    expect(weightsSumToHundred(D(33.33, 33.33, 33.34))).toBe(true);
    expect(weightsSumToHundred(D(50, 30, 20))).toBe(true);
    expect(weightsSumToHundred(D(50, 30, 19.99))).toBe(false);
    expect(weightsSumToHundred(D(0.1, 0.2, 99.7))).toBe(true);
  });

  it("turns percentages into whole-question targets that add up to the paper size", () => {
    const cats = ["easy", "medium", "tough"];
    expect(targetCounts(D(50, 30, 20), cats, 10)).toEqual({ easy: 5, medium: 3, tough: 2 });
    // 33.33% of 10 is 3.33 each: the spare question goes to the earlier category
    const t = targetCounts(D(33.33, 33.33, 33.34), cats, 10);
    expect(t.easy + t.medium + t.tough).toBe(10);
    expect(t).toEqual({ easy: 3, medium: 3, tough: 4 });
    expect(targetCounts(D(100, 0, 0), cats, 7)).toEqual({ easy: 7, medium: 0, tough: 0 });
    expect(targetCounts(D(50, 50, 0), cats, 5)).toEqual({ easy: 3, medium: 2, tough: 0 });
    expect(targetCounts(D(50, 30, 20), cats, 0)).toEqual({ easy: 0, medium: 0, tough: 0 });
  });

  it("reports unclassified items instead of placing them", () => {
    const profile = {
      difficultyWeights: D(50, 50, 0),
      bloomWeights: B({
        remember: 100,
        understand: 0,
        apply: 0,
        analyze: 0,
        evaluate: 0,
        create: 0,
      }),
    };
    const items = [
      { difficulty: "easy", bloomLevel: "remember" },
      { difficulty: "medium", bloomLevel: "Remember " },
      { difficulty: null, bloomLevel: "remember" },
      { difficulty: "easy", bloomLevel: "free text" },
    ];
    const r = buildMixReport(profile, items);
    expect(r.totalItems).toBe(4);
    expect(r.unclassifiedDifficulty).toBe(1);
    expect(r.unclassifiedBloom).toBe(1);
    expect(r.difficulty.unclassified).toEqual({ achievedCount: 1, achievedPercent: 25 });
    expect(r.difficulty.easy).toMatchObject({
      targetCount: 2,
      achievedCount: 2,
      achievedPercent: 50,
    });
    expect(r.bloom.remember).toMatchObject({
      targetCount: 4,
      achievedCount: 3,
      differenceCount: -1,
    });
    expect(r.matched).toBe(false);
  });
});

describe("selectQuestions with a profile (pure)", () => {
  const pool = [];
  const mk = (n, difficulty, bloomLevel, pcId = "PC-01") => {
    for (let i = 0; i < n; i += 1) {
      pool.push({
        _id: `${difficulty}-${bloomLevel}-${pool.length}`,
        version: 1,
        nosId: "NOS-01",
        pcId,
        type: "mcq",
        marks: 1,
        difficulty,
        bloomLevel,
      });
    }
  };
  mk(10, "easy", "remember");
  mk(10, "medium", "apply", "PC-02");
  mk(10, "tough", "analyze");
  const profile = {
    difficultyWeights: D(50, 30, 20),
    bloomWeights: B({
      remember: 50,
      understand: 0,
      apply: 30,
      analyze: 20,
      evaluate: 0,
      create: 0,
    }),
  };

  it("matches the target exactly when the pool allows it, and is repeatable", () => {
    const quotas = [{ nosId: "NOS-01", type: null, count: 10 }];
    const a = selectQuestions(pool, quotas, 5, profile);
    const b = selectQuestions(pool, quotas, 5, profile);
    expect(a.items.map((i) => i.questionId)).toEqual(b.items.map((i) => i.questionId));
    const r = buildMixReport(profile, a.items);
    expect(r.difficulty.easy.achievedCount).toBe(5);
    expect(r.difficulty.medium.achievedCount).toBe(3);
    expect(r.difficulty.tough.achievedCount).toBe(2);
    expect(r.matched).toBe(true);
  });

  it("gets as close as it can when the pool has too few of a class", () => {
    const small = pool.filter((q) => q.difficulty !== "tough" || q._id.endsWith("-29"));
    const quotas = [{ nosId: "NOS-01", type: null, count: 10 }];
    const { items } = selectQuestions(small, quotas, 5, profile);
    const r = buildMixReport(profile, items);
    expect(items).toHaveLength(10);
    expect(r.difficulty.tough.achievedCount).toBe(1);
    expect(r.difficulty.tough.differenceCount).toBe(-1);
    expect(r.matched).toBe(false);
  });

  it("takes unclassified questions only when nothing classified is left", () => {
    const mixed = [
      ...pool.filter((q) => q.difficulty === "easy").slice(0, 3),
      ...Array.from({ length: 5 }, (_, i) => ({
        _id: `u-${i}`,
        version: 1,
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        marks: 1,
        difficulty: null,
        bloomLevel: null,
      })),
    ];
    const quotas = [{ nosId: "NOS-01", type: null, count: 5 }];
    const { items } = selectQuestions(mixed, quotas, 1, profile);
    expect(items.filter((i) => i.difficulty === null)).toHaveLength(2);
    expect(items.slice(0, 3).every((i) => i.difficulty === "easy")).toBe(true);
  });
});

describe("Weight profiles API (server/src/modules/weight-profiles)", () => {
  let qual;
  let admin;
  let sme;
  let reviewer;
  let candidate;
  let tp;

  const post = (session, path, body) =>
    request(app).post(path).set(bearer(session.token)).send(body);
  const patch = (session, id, body) =>
    request(app).patch(`/api/v1/weight-profiles/${id}`).set(bearer(session.token)).send(body);
  const get = (session, path) => request(app).get(path).set(bearer(session.token));
  const approve = (session, id, body = {}) =>
    post(session, `/api/v1/weight-profiles/${id}/approve`, body);

  const profileBody = (extra = {}) => ({
    name: "Standard",
    difficultyWeights: D(50, 30, 20),
    bloomWeights: { remember: 50, apply: 30, analyze: 20 },
    ...extra,
  });
  const createProfile = async (session = sme, extra = {}) => {
    const res = await post(session, "/api/v1/weight-profiles", profileBody(extra));
    expect(res.status).toBe(201);
    return res.body;
  };
  const generate = (session, body) => post(session, "/api/v1/tests/generate", body);
  const genBody = (extra = {}) => ({
    qualificationId: String(qual._id),
    language: "en",
    quotas: [{ nosId: "NOS-01", count: 10 }],
    seed: 11,
    ...extra,
  });

  beforeAll(async () => {
    await startMongo();
    await WeightProfile.syncIndexes();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    qual = await makeQualification();
    admin = await sessionFor("aa_admin");
    sme = await sessionFor("sme");
    reviewer = await sessionFor("ab_reviewer");
    candidate = await sessionFor("candidate");
    tp = await sessionFor("tp");
  });

  async function fillWeightedBank() {
    for (let i = 0; i < 6; i += 1) {
      await addQuestion(qual, { difficulty: "easy", bloomLevel: "remember" });
      await addQuestion(qual, { difficulty: "medium", bloomLevel: "apply" });
      await addQuestion(qual, { difficulty: "tough", bloomLevel: "analyze" });
    }
  }

  describe("create and validate", () => {
    it("creates version 1 as a draft; omitted Bloom levels count as 0", async () => {
      const p = await createProfile();
      expect(p).toMatchObject({ version: 1, status: "draft", isLatest: true, name: "Standard" });
      expect(p.rootProfileId).toBe(p._id);
      expect(p.bloomWeights).toEqual({
        remember: 50,
        understand: 0,
        apply: 30,
        analyze: 20,
        evaluate: 0,
        create: 0,
      });
      expect(p.qualificationId).toBeNull();
    });

    it("accepts a qualification id or code and rejects an unknown one", async () => {
      const a = await createProfile(sme, { qualificationId: "QUAL-WP-01" });
      expect(a.qualificationId).toBe(String(qual._id));
      const res = await post(
        sme,
        "/api/v1/weight-profiles",
        profileBody({ qualificationId: "NOPE" }),
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("QUALIFICATION_NOT_FOUND");
    });

    it("rejects weights that do not add up to 100, or are out of range or malformed", async () => {
      const bad = [
        { difficultyWeights: D(50, 30, 10) },
        { difficultyWeights: D(50, 30, 30) },
        { difficultyWeights: { easy: 50, medium: 50 } },
        { difficultyWeights: D(-10, 60, 50) },
        { difficultyWeights: D(33.333, 33.333, 33.334) },
        { difficultyWeights: { ...D(50, 30, 20), extreme: 0 } },
        { bloomWeights: { remember: 60, apply: 30 } },
        { bloomWeights: { remember: 100, wisdom: 0 } },
        { bloomWeights: {} },
        { name: "" },
        { surprise: true },
        { aadhaar: "123456789012" },
      ];
      for (const extra of bad) {
        const res = await post(sme, "/api/v1/weight-profiles", profileBody(extra));
        expect(res.status).toBe(400);
      }
      expect(await WeightProfile.countDocuments()).toBe(0);
    });

    it("accepts two-decimal weights that add up exactly", async () => {
      const res = await post(
        sme,
        "/api/v1/weight-profiles",
        profileBody({ difficultyWeights: D(33.33, 33.33, 33.34) }),
      );
      expect(res.status).toBe(201);
    });
  });

  describe("versioning", () => {
    it("every edit makes a new draft version and keeps the old ones untouched", async () => {
      const v1 = await createProfile();
      const e1 = await patch(admin, v1._id, { difficultyWeights: D(40, 40, 20) });
      expect(e1.status).toBe(200);
      expect(e1.body).toMatchObject({ version: 2, status: "draft", isLatest: true });
      expect(e1.body.rootProfileId).toBe(v1._id);
      expect(e1.body._id).not.toBe(v1._id);
      // unchanged fields are carried over
      expect(e1.body.name).toBe("Standard");
      expect(e1.body.bloomWeights.remember).toBe(50);

      const e2 = await patch(sme, v1._id, { name: "Renamed" });
      expect(e2.body.version).toBe(3);

      const versions = await get(sme, `/api/v1/weight-profiles/${v1._id}/versions`);
      expect(versions.body.items.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(versions.body.items.map((v) => v.isLatest)).toEqual([false, false, true]);
      expect(versions.body.items[0].difficultyWeights).toEqual(D(50, 30, 20));
      expect(versions.body.items[0].name).toBe("Standard");
      expect(versions.body.items[1].difficultyWeights).toEqual(D(40, 40, 20));
      expect(await WeightProfile.countDocuments()).toBe(3);
    });

    it("reads the latest by default and any version on request", async () => {
      const v1 = await createProfile();
      await patch(sme, v1._id, { difficultyWeights: D(40, 40, 20) });
      const latest = await get(reviewer, `/api/v1/weight-profiles/${v1._id}`);
      expect(latest.body.version).toBe(2);
      const old = await get(reviewer, `/api/v1/weight-profiles/${v1._id}?version=1`);
      expect(old.body.difficultyWeights).toEqual(D(50, 30, 20));
      expect((await get(reviewer, `/api/v1/weight-profiles/${v1._id}?version=9`)).status).toBe(404);
    });

    it("editing an approved version creates a draft and leaves the approved one approved", async () => {
      const v1 = await createProfile();
      expect((await approve(reviewer, v1._id)).status).toBe(200);
      const e = await patch(sme, v1._id, { difficultyWeights: D(20, 40, 40) });
      expect(e.body).toMatchObject({ version: 2, status: "draft", approvedBy: null });
      const old = await get(sme, `/api/v1/weight-profiles/${v1._id}?version=1`);
      expect(old.body).toMatchObject({ status: "approved", difficultyWeights: D(50, 30, 20) });
    });

    it("refuses a stale expectedVersion, and an edit that changes nothing or breaks the sum", async () => {
      const v1 = await createProfile();
      await patch(sme, v1._id, { name: "Two" });
      const stale = await patch(sme, v1._id, { name: "Three", expectedVersion: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("WEIGHT_PROFILE_STALE_VERSION");
      expect(stale.body.error.details.latestVersion).toBe(2);
      expect((await patch(sme, v1._id, { expectedVersion: 2 })).status).toBe(400);
      expect((await patch(sme, v1._id, {})).status).toBe(400);
      expect((await patch(sme, v1._id, { difficultyWeights: D(1, 1, 1) })).status).toBe(400);
      expect((await patch(sme, v1._id, { version: 5, name: "x" })).status).toBe(400);
      const ok = await patch(sme, v1._id, { name: "Three", expectedVersion: 2 });
      expect(ok.body.version).toBe(3);
      expect(await WeightProfile.countDocuments()).toBe(3);
    });

    it("never lets two edits share a version number", async () => {
      const v1 = await createProfile();
      const results = await Promise.all([
        patch(sme, v1._id, { name: "A" }),
        patch(admin, v1._id, { name: "B" }),
      ]);
      const versions = await WeightProfile.find({ rootProfileId: v1._id }).distinct("version");
      expect(versions.sort()).toEqual(results.every((r) => r.status === 200) ? [1, 2, 3] : [1, 2]);
      expect(await WeightProfile.countDocuments({ rootProfileId: v1._id, isLatest: true })).toBe(1);
    });

    it("returns 404 and 400 for unknown and malformed ids", async () => {
      const unknown = "64b7f0f0f0f0f0f0f0f0f0f0";
      expect((await patch(sme, unknown, { name: "x" })).status).toBe(404);
      expect((await get(sme, `/api/v1/weight-profiles/${unknown}`)).status).toBe(404);
      expect((await get(sme, `/api/v1/weight-profiles/${unknown}/versions`)).status).toBe(404);
      expect((await approve(reviewer, unknown)).status).toBe(404);
      expect((await get(sme, "/api/v1/weight-profiles/not-an-id")).status).toBe(400);
    });
  });

  describe("approval", () => {
    it("lets ab_reviewer approve a version once, recording who and when", async () => {
      const v1 = await createProfile();
      const res = await approve(reviewer, v1._id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "approved", approvedBy: reviewer.userId });
      expect(res.body.approvedAt).toBeTruthy();
      const again = await approve(reviewer, v1._id);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("WEIGHT_PROFILE_ALREADY_APPROVED");
    });

    it("only the latest version can be approved", async () => {
      const v1 = await createProfile();
      await patch(sme, v1._id, { name: "Newer" });
      const res = await approve(reviewer, v1._id, { version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("WEIGHT_PROFILE_VERSION_SUPERSEDED");
      const ok = await approve(reviewer, v1._id, { version: 2 });
      expect(ok.body.version).toBe(2);
      expect((await approve(reviewer, v1._id, { version: 7 })).status).toBe(404);
      expect((await approve(reviewer, v1._id, { other: 1 })).status).toBe(400);
    });

    it("an approved version cannot be changed in place", async () => {
      const v1 = await createProfile();
      await approve(reviewer, v1._id);
      await patch(sme, v1._id, { name: "Changed" });
      const stored = await WeightProfile.findById(v1._id).lean();
      expect(stored.name).toBe("Standard");
      expect(stored.status).toBe("approved");
    });
  });

  describe("generating with a profile", () => {
    it("matches the target and reports target versus achieved, storing profile id and version", async () => {
      await fillWeightedBank();
      const p = await createProfile();
      await approve(reviewer, p._id);
      const res = await generate(sme, genBody({ weightProfileId: p._id }));
      expect(res.status).toBe(201);
      expect(res.body.weightProfile).toEqual({ profileId: p._id, version: 1 });
      const mix = res.body.weightMix;
      expect(mix.totalItems).toBe(10);
      expect(mix.difficulty.easy).toMatchObject({
        targetCount: 5,
        achievedCount: 5,
        achievedPercent: 50,
      });
      expect(mix.difficulty.medium).toMatchObject({ targetCount: 3, achievedCount: 3 });
      expect(mix.difficulty.tough).toMatchObject({ targetCount: 2, achievedCount: 2 });
      expect(mix.bloom.remember.achievedCount).toBe(5);
      expect(mix.matched).toBe(true);
      expect(mix.unclassifiedDifficulty).toBe(0);
      expect(res.body.items[0]).toHaveProperty("difficulty");
      expect(res.body.complete).toBe(true);

      const stored = await get(reviewer, `/api/v1/tests/${res.body._id}`);
      expect(stored.body.weightProfile).toEqual({ profileId: p._id, version: 1 });
      expect(stored.body.weightMix.matched).toBe(true);
    });

    it("uses the latest approved version by default and a named version when given", async () => {
      await fillWeightedBank();
      const p = await createProfile();
      await approve(reviewer, p._id);
      await patch(sme, p._id, {
        difficultyWeights: D(20, 40, 40),
        bloomWeights: { remember: 20, apply: 40, analyze: 40 },
      });
      // v2 is a draft: the default still picks approved v1
      const g1 = await generate(sme, genBody({ weightProfileId: p._id }));
      expect(g1.body.weightProfile.version).toBe(1);
      expect((await approve(reviewer, p._id)).body.version).toBe(2);
      const g2 = await generate(sme, genBody({ weightProfileId: p._id }));
      expect(g2.body.weightProfile.version).toBe(2);
      expect(g2.body.weightMix.difficulty.easy.targetCount).toBe(2);
      expect(g2.body.weightMix.difficulty.tough.achievedCount).toBe(4);
      const g3 = await generate(sme, genBody({ weightProfileId: p._id, version: 1 }));
      expect(g3.body.weightProfile.version).toBe(1);
    });

    it("refuses a draft, a missing profile or version, and a profile for another qualification", async () => {
      await fillWeightedBank();
      const draft = await createProfile();
      const noApproved = await generate(sme, genBody({ weightProfileId: draft._id }));
      expect(noApproved.status).toBe(404);
      expect(noApproved.body.error.code).toBe("WEIGHT_PROFILE_NOT_FOUND");
      const named = await generate(sme, genBody({ weightProfileId: draft._id, version: 1 }));
      expect(named.status).toBe(409);
      expect(named.body.error.code).toBe("WEIGHT_PROFILE_NOT_APPROVED");
      expect(
        (await generate(sme, genBody({ weightProfileId: draft._id, version: 4 }))).status,
      ).toBe(404);
      expect(
        (await generate(sme, genBody({ weightProfileId: "64b7f0f0f0f0f0f0f0f0f0f0" }))).status,
      ).toBe(404);
      expect((await generate(sme, genBody({ version: 1 }))).status).toBe(400);
      expect((await generate(sme, genBody({ weightProfileId: "bad" }))).status).toBe(400);

      const other = await makeQualification("QUAL-OTHER");
      const scoped = await createProfile(sme, { qualificationId: String(other._id) });
      await approve(reviewer, scoped._id);
      const mismatch = await generate(sme, genBody({ weightProfileId: scoped._id }));
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.error.code).toBe("WEIGHT_PROFILE_QUALIFICATION_MISMATCH");
      expect(await mongoose.model("TestPaper").countDocuments()).toBe(0);
    });

    it("reports unclassified questions and never counts them towards a class", async () => {
      for (let i = 0; i < 3; i += 1) {
        await addQuestion(qual, { difficulty: "easy", bloomLevel: "remember" });
      }
      for (let i = 0; i < 4; i += 1) await addQuestion(qual, {}); // no difficulty, no Bloom
      await addQuestion(qual, { difficulty: "medium", bloomLevel: "Creative thinking" });
      const p = await createProfile(sme, {
        difficultyWeights: D(100, 0, 0),
        bloomWeights: { remember: 100 },
      });
      await approve(reviewer, p._id);
      const res = await generate(
        sme,
        genBody({ weightProfileId: p._id, quotas: [{ nosId: "NOS-01", count: 6 }] }),
      );
      expect(res.status).toBe(201);
      const mix = res.body.weightMix;
      expect(mix.totalItems).toBe(6);
      expect(mix.difficulty.easy).toMatchObject({
        achievedCount: 3,
        targetCount: 6,
        differenceCount: -3,
      });
      expect(mix.unclassifiedDifficulty).toBe(2);
      expect(mix.unclassifiedBloom).toBe(3);
      expect(mix.difficulty.unclassified.achievedCount).toBe(2);
      expect(mix.matched).toBe(false);
      // the "Creative thinking" question has a difficulty but no usable Bloom level
      const noDifficulty = res.body.items.filter((i) => i.difficulty === null);
      expect(noDifficulty).toHaveLength(2);
      expect(res.body.items.filter((i) => i.bloomLevel === null)).toHaveLength(3);
    });

    it("reports the shortfall when the bank cannot give the mix, and still completes the paper", async () => {
      for (let i = 0; i < 10; i += 1) {
        await addQuestion(qual, { difficulty: "easy", bloomLevel: "remember" });
      }
      const p = await createProfile();
      await approve(reviewer, p._id);
      const res = await generate(sme, genBody({ weightProfileId: p._id }));
      expect(res.status).toBe(201);
      expect(res.body.complete).toBe(true);
      expect(res.body.weightMix.matched).toBe(false);
      expect(res.body.weightMix.difficulty.easy).toMatchObject({
        achievedCount: 10,
        differenceCount: 5,
      });
      expect(res.body.weightMix.difficulty.tough.differenceCount).toBe(-2);
      expect(res.body.weightMix.maxDifficultyDeviationPoints).toBe(50);
    });

    it("same seed and profile give the same paper, and regenerate-check reproduces it", async () => {
      await fillWeightedBank();
      const p = await createProfile();
      await approve(reviewer, p._id);
      const a = await generate(sme, genBody({ weightProfileId: p._id, seed: 77 }));
      const b = await generate(sme, genBody({ weightProfileId: p._id, seed: 77 }));
      expect(a.body.items.map((i) => i.questionId)).toEqual(b.body.items.map((i) => i.questionId));
      const check = await post(reviewer, `/api/v1/tests/${a.body._id}/regenerate-check`, {});
      expect(check.body).toMatchObject({ reproducible: true, poolUnchanged: true });
      // a newer profile version must not change how the stored paper replays
      await patch(sme, p._id, { difficultyWeights: D(0, 0, 100) });
      await approve(reviewer, p._id);
      const again = await post(reviewer, `/api/v1/tests/${a.body._id}/regenerate-check`, {});
      expect(again.body.reproducible).toBe(true);
    });

    it("a paper with a mix mismatch can still be approved (the mix is reported, not enforced)", async () => {
      for (let i = 0; i < 10; i += 1) {
        await addQuestion(qual, { difficulty: "easy", bloomLevel: "remember" });
      }
      const p = await createProfile();
      await approve(reviewer, p._id);
      const gen = await generate(sme, genBody({ weightProfileId: p._id }));
      const res = await post(reviewer, `/api/v1/tests/${gen.body._id}/approve`, {});
      expect(res.status).toBe(200);
    });
  });

  describe("E-01 behaviour without a profile", () => {
    it("stores no weight fields and does not look at difficulty or Bloom", async () => {
      await fillWeightedBank();
      const res = await generate(sme, genBody());
      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty("weightProfile");
      expect(res.body).not.toHaveProperty("weightMix");
      expect(res.body.items[0]).not.toHaveProperty("difficulty");
      expect(res.body.items[0]).not.toHaveProperty("bloomLevel");
    });
  });

  describe("list", () => {
    it("lists the latest version of each profile and filters by status and qualification", async () => {
      const a = await createProfile(sme, { name: "A" });
      await createProfile(sme, { name: "B", qualificationId: String(qual._id) });
      await patch(sme, a._id, { name: "A2" });
      await approve(reviewer, a._id);
      const all = await get(admin, "/api/v1/weight-profiles");
      expect(all.body.total).toBe(2);
      expect(all.body.items.map((i) => i.name).sort()).toEqual(["A2", "B"]);
      const approved = await get(admin, "/api/v1/weight-profiles?status=approved");
      expect(approved.body.items.map((i) => i.name)).toEqual(["A2"]);
      const scoped = await get(admin, "/api/v1/weight-profiles?qualificationId=QUAL-WP-01");
      expect(scoped.body.items.map((i) => i.name)).toEqual(["B"]);
      expect((await get(admin, "/api/v1/weight-profiles?bogus=1")).status).toBe(400);
      const page = await get(admin, "/api/v1/weight-profiles?page=2&pageSize=1");
      expect(page.body.items).toHaveLength(1);
    });
  });

  describe("roles", () => {
    it("aa_admin and sme write drafts; ab_reviewer cannot write", async () => {
      expect((await post(admin, "/api/v1/weight-profiles", profileBody())).status).toBe(201);
      expect((await post(sme, "/api/v1/weight-profiles", profileBody())).status).toBe(201);
      expect((await post(reviewer, "/api/v1/weight-profiles", profileBody())).status).toBe(403);
      const p = await createProfile();
      expect((await patch(reviewer, p._id, { name: "x" })).status).toBe(403);
    });

    it("only ab_reviewer approves", async () => {
      const p = await createProfile();
      for (const who of [admin, sme, candidate, tp]) {
        expect((await approve(who, p._id)).status).toBe(403);
      }
      expect((await get(sme, `/api/v1/weight-profiles/${p._id}`)).body.status).toBe("draft");
      expect((await approve(reviewer, p._id)).status).toBe(200);
    });

    it("aa_admin, sme and ab_reviewer read; everyone else is denied everything", async () => {
      const p = await createProfile();
      for (const who of [admin, sme, reviewer]) {
        expect((await get(who, "/api/v1/weight-profiles")).status).toBe(200);
        expect((await get(who, `/api/v1/weight-profiles/${p._id}`)).status).toBe(200);
        expect((await get(who, `/api/v1/weight-profiles/${p._id}/versions`)).status).toBe(200);
      }
      for (const who of [candidate, tp]) {
        expect((await get(who, "/api/v1/weight-profiles")).status).toBe(403);
        expect((await get(who, `/api/v1/weight-profiles/${p._id}`)).status).toBe(403);
        expect((await get(who, `/api/v1/weight-profiles/${p._id}/versions`)).status).toBe(403);
        expect((await post(who, "/api/v1/weight-profiles", profileBody())).status).toBe(403);
        expect((await patch(who, p._id, { name: "x" })).status).toBe(403);
      }
      const anon = await request(app).get("/api/v1/weight-profiles");
      expect(anon.status).toBe(401);
    });

    it("generating with a profile keeps the E-01 roles (ab_reviewer cannot generate)", async () => {
      await fillWeightedBank();
      const p = await createProfile();
      await approve(reviewer, p._id);
      expect((await generate(reviewer, genBody({ weightProfileId: p._id }))).status).toBe(403);
      expect((await generate(admin, genBody({ weightProfileId: p._id }))).status).toBe(201);
    });
  });

  describe("audit", () => {
    it("audits create, edit, approve and generate with before and after, no question text", async () => {
      await fillWeightedBank();
      const p = await createProfile();
      await patch(sme, p._id, { name: "Edited" });
      await approve(reviewer, p._id);
      await generate(sme, genBody({ weightProfileId: p._id }));
      const rows = await AuditLog.find({
        action: { $regex: /^weight_profile\.|^test\.generate$/ },
      })
        .sort({ createdAt: 1 })
        .lean();
      expect(rows.map((r) => r.action)).toEqual([
        "weight_profile.create",
        "weight_profile.edit",
        "weight_profile.approve",
        "test.generate",
      ]);
      expect(rows[1].before).toMatchObject({ version: 1, name: "Standard" });
      expect(rows[1].after).toMatchObject({ version: 2, name: "Edited", status: "draft" });
      expect(rows[2].before.status).toBe("draft");
      expect(rows[2].after).toMatchObject({ status: "approved", version: 2 });
      expect(rows[3].after.weightProfile).toMatchObject({ version: 2 });
      expect(JSON.stringify(rows)).not.toContain("SECRET-");
    });

    it("failed writes leave no audit row", async () => {
      await post(sme, "/api/v1/weight-profiles", profileBody({ difficultyWeights: D(1, 1, 1) }));
      expect(await AuditLog.countDocuments({ entity: "weightProfile" })).toBe(0);
    });
  });
});
