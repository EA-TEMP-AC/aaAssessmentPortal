import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { createRng, shuffle } from "../src/modules/test-generator/seeded-random.js";
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

function makeQualification() {
  return Qualification.create({
    code: "QUAL-GEN-01",
    name: "Generator Test Qualification",
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
      {
        nosId: "NOS-02",
        code: "N0102",
        name: "Two",
        pcs: [{ pcId: "PC-03", code: "PC2.1", name: "c", passMark: 60, maxMark: 100 }],
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
    pcId: "PC-01",
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
    createdBy: (await import("mongoose")).default.Types.ObjectId.createFromTime(1),
    ...overrides,
  });
  q.rootQuestionId = overrides.rootQuestionId || q._id;
  await q.save();
  return q;
}

async function fillBank(qual) {
  // NOS-01: 6 mcq (3 per PC), 2 viva. NOS-02: 4 mcq.
  for (let i = 0; i < 3; i += 1) {
    await addQuestion(qual, { pcId: "PC-01" });
    await addQuestion(qual, { pcId: "PC-02" });
  }
  await addQuestion(qual, { type: "viva", pcId: "PC-01", marks: 5 });
  await addQuestion(qual, { type: "viva", pcId: "PC-02", marks: 5 });
  for (let i = 0; i < 4; i += 1) await addQuestion(qual, { nosId: "NOS-02", pcId: "PC-03" });
}

const rulesBody = (qual, extra = {}) => ({
  qualificationId: String(qual._id),
  language: "en",
  quotas: [
    { nosId: "NOS-01", type: "mcq", count: 4 },
    { nosId: "NOS-01", type: "viva", count: 1 },
    { nosId: "NOS-02", count: 2 },
  ],
  ...extra,
});

describe("seeded random", () => {
  it("gives the same sequence for the same seed and a different one for another", () => {
    const a = Array.from({ length: 5 }, createRng(42));
    const b = Array.from({ length: 5 }, createRng(42));
    const c = Array.from({ length: 5 }, createRng(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(shuffle([1, 2, 3, 4, 5, 6], createRng(7))).toEqual(
      shuffle([1, 2, 3, 4, 5, 6], createRng(7)),
    );
  });
});

describe("Test generator API (server/src/modules/test-generator)", () => {
  let qual;
  let admin;
  let sme;
  let reviewer;
  let candidate;
  let tp;
  let mis;

  const generate = (session, body) =>
    request(app).post("/api/v1/tests/generate").set(bearer(session.token)).send(body);

  beforeAll(async () => {
    await startMongo();
    await Promise.all([TestPaper.syncIndexes(), Question.syncIndexes()]);
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
    mis = await sessionFor("mis");
  });

  describe("selection rules", () => {
    it("meets per-NOS and per-type quotas and the marks target", async () => {
      await fillBank(qual);
      const res = await generate(sme, rulesBody(qual, { totalMarks: 11, seed: 1 }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: "draft",
        seed: 1,
        totalMarks: 11,
        complete: true,
        shortages: [],
      });
      const items = res.body.items;
      const count = (nosId, type) =>
        items.filter((i) => i.nosId === nosId && (!type || i.type === type)).length;
      expect(count("NOS-01", "mcq")).toBe(4);
      expect(count("NOS-01", "viva")).toBe(1);
      expect(count("NOS-02")).toBe(2);
      expect(items).toHaveLength(7);
    });

    it("covers both PCs before using one twice", async () => {
      await fillBank(qual);
      const res = await generate(admin, {
        qualificationId: String(qual._id),
        language: "en",
        quotas: [{ nosId: "NOS-01", type: "mcq", count: 2 }],
        seed: 99,
      });
      expect(res.status).toBe(201);
      expect(new Set(res.body.items.map((i) => i.pcId))).toEqual(new Set(["PC-01", "PC-02"]));
    });

    it("never repeats a question and never picks retired, unapproved, old-version or other-language questions", async () => {
      await fillBank(qual);
      const retired = await addQuestion(qual, { status: "retired" });
      const draft = await addQuestion(qual, { status: "draft" });
      const hindi = await addQuestion(qual, { language: "hi" });
      const old = await addQuestion(qual, { isLatest: false });
      const newer = await addQuestion(qual, {
        version: 2,
        status: "draft",
        rootQuestionId: old.rootQuestionId,
      });
      const excluded = new Set([retired, draft, hindi, old, newer].map((q) => String(q._id)));

      for (const seed of [1, 2, 3, 4, 5]) {
        const res = await generate(admin, rulesBody(qual, { seed }));
        expect(res.status).toBe(201);
        const ids = res.body.items.map((i) => i.questionId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(excluded.has(id)).toBe(false);
      }
    });

    it("uses the latest approved version and records it", async () => {
      const v1 = await addQuestion(qual, { isLatest: false });
      const v2 = await addQuestion(qual, { version: 2, rootQuestionId: v1.rootQuestionId });
      const res = await generate(admin, {
        qualificationId: String(qual._id),
        language: "en",
        quotas: [{ nosId: "NOS-01", count: 1 }],
        seed: 5,
      });
      expect(res.status).toBe(201);
      expect(res.body.items[0]).toMatchObject({ questionId: String(v2._id), version: 2 });
    });

    it("accepts a qualification code and filters by language", async () => {
      await addQuestion(qual, { language: "hi" });
      const res = await generate(admin, {
        qualificationId: "QUAL-GEN-01",
        language: "HI",
        quotas: [{ nosId: "NOS-01", count: 1 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.rules.language).toBe("hi");
    });

    it("rejects bad rules", async () => {
      await fillBank(qual);
      const base = rulesBody(qual);
      const cases = [
        [{ ...base, extra: 1 }, 400],
        [{ ...base, quotas: [] }, 400],
        [{ ...base, quotas: [{ nosId: "NOS-99", count: 1 }] }, 400],
        [{ ...base, quotas: [{ nosId: "NOS-01", count: 0 }] }, 400],
        [
          {
            ...base,
            quotas: [
              { nosId: "NOS-01", count: 1 },
              { nosId: "NOS-01", count: 2 },
            ],
          },
          400,
        ],
        [
          {
            ...base,
            quotas: [
              { nosId: "NOS-01", count: 1 },
              { nosId: "NOS-01", type: "mcq", count: 1 },
            ],
          },
          400,
        ],
        [{ ...base, aadhaar: "123" }, 400],
        [{ ...base, qualificationId: "NO-SUCH" }, 404],
      ];
      for (const [body, status] of cases) {
        const res = await generate(admin, body);
        expect(res.status).toBe(status);
      }
    });
  });

  describe("reproducibility", () => {
    it("same seed gives the same paper, a different seed can differ", async () => {
      await fillBank(qual);
      const a = await generate(admin, rulesBody(qual, { seed: 1234 }));
      const b = await generate(admin, rulesBody(qual, { seed: 1234 }));
      const ids = (r) => r.body.items.map((i) => `${i.questionId}:${i.version}`);
      expect(ids(a)).toEqual(ids(b));

      const others = [];
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        others.push(ids(await generate(admin, rulesBody(qual, { seed }))).join());
      }
      expect(new Set(others).size).toBeGreaterThan(1);
    });

    it("stores seed, rules, ids and versions; a generated seed is returned", async () => {
      await fillBank(qual);
      const res = await generate(admin, rulesBody(qual));
      expect(Number.isInteger(res.body.seed)).toBe(true);
      const stored = await TestPaper.findById(res.body._id).lean();
      expect(stored.seed).toBe(res.body.seed);
      expect(stored.rules.quotas).toHaveLength(3);
      expect(stored.items.every((i) => i.questionId && i.version === 1)).toBe(true);
      expect(stored.poolHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("regenerate-check reproduces the stored paper, then notices bank changes", async () => {
      await fillBank(qual);
      const gen = await generate(sme, rulesBody(qual, { seed: 77 }));
      const id = gen.body._id;
      const check = () =>
        request(app).post(`/api/v1/tests/${id}/regenerate-check`).set(bearer(reviewer.token));

      const ok = await check();
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        reproducible: true,
        poolUnchanged: true,
        missing: [],
        extra: [],
        stale: [],
      });

      await Question.updateOne({ _id: gen.body.items[0].questionId }, { status: "retired" });
      const after = await check();
      expect(after.body.poolUnchanged).toBe(false);
      expect(after.body.stale).toEqual([
        { questionId: gen.body.items[0].questionId, reason: "retired" },
      ]);
      expect(after.body.missing.some((k) => k.startsWith(gen.body.items[0].questionId))).toBe(true);
    });
  });

  describe("shortage reporting", () => {
    it("refuses with the shortage listed instead of silently returning fewer", async () => {
      await fillBank(qual);
      const res = await generate(admin, {
        qualificationId: String(qual._id),
        language: "en",
        quotas: [
          { nosId: "NOS-01", type: "viva", count: 5 },
          { nosId: "NOS-02", count: 2 },
        ],
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("TEST_BANK_SHORTAGE");
      expect(res.body.error.details.shortages).toEqual([
        { nosId: "NOS-01", type: "viva", requested: 5, available: 2 },
      ]);
      expect(await TestPaper.countDocuments()).toBe(0);
    });

    it("with allowPartial stores a flagged draft that cannot be approved", async () => {
      await fillBank(qual);
      const res = await generate(admin, {
        qualificationId: String(qual._id),
        language: "en",
        quotas: [{ nosId: "NOS-01", type: "viva", count: 5 }],
        allowPartial: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.complete).toBe(false);
      expect(res.body.shortages).toHaveLength(1);
      expect(res.body.items).toHaveLength(2);

      const approve = await request(app)
        .post(`/api/v1/tests/${res.body._id}/approve`)
        .set(bearer(reviewer.token));
      expect(approve.status).toBe(409);
      expect(approve.body.error.code).toBe("TEST_PAPER_INCOMPLETE");
    });

    it("reports a missed marks target", async () => {
      await fillBank(qual);
      const res = await generate(admin, rulesBody(qual, { totalMarks: 50 }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("TEST_MARKS_TARGET_NOT_MET");
      expect(res.body.error.details).toMatchObject({ totalMarks: 11, targetMarks: 50 });
    });

    it("reports a language with no questions", async () => {
      await fillBank(qual);
      const res = await generate(admin, rulesBody(qual, { language: "ta" }));
      expect(res.status).toBe(422);
      expect(res.body.error.details.shortages).toHaveLength(3);
    });
  });

  describe("approval", () => {
    it("lets ab_reviewer and aa_admin approve a draft once; sme cannot", async () => {
      await fillBank(qual);
      const gen = await generate(sme, rulesBody(qual, { seed: 3 }));
      const url = `/api/v1/tests/${gen.body._id}/approve`;

      expect((await request(app).post(url).set(bearer(sme.token))).status).toBe(403);
      const ok = await request(app).post(url).set(bearer(reviewer.token));
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: "approved", approvedBy: reviewer.userId });
      const again = await request(app).post(url).set(bearer(admin.token));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("TEST_ALREADY_APPROVED");

      const second = await generate(admin, rulesBody(qual, { seed: 4 }));
      const adm = await request(app)
        .post(`/api/v1/tests/${second.body._id}/approve`)
        .set(bearer(admin.token));
      expect(adm.status).toBe(200);
    });

    it("refuses to approve a paper whose question was retired since generation", async () => {
      await fillBank(qual);
      const gen = await generate(admin, rulesBody(qual, { seed: 3 }));
      await Question.updateOne({ _id: gen.body.items[0].questionId }, { status: "retired" });
      const res = await request(app)
        .post(`/api/v1/tests/${gen.body._id}/approve`)
        .set(bearer(reviewer.token));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TEST_PAPER_STALE");
      expect((await TestPaper.findById(gen.body._id)).status).toBe("draft");
    });

    it("returns 404 for unknown and 400 for malformed ids", async () => {
      const unknown = "64b000000000000000000000";
      expect(
        (await request(app).get(`/api/v1/tests/${unknown}`).set(bearer(admin.token))).status,
      ).toBe(404);
      expect(
        (await request(app).get("/api/v1/tests/not-an-id").set(bearer(admin.token))).status,
      ).toBe(400);
      expect(
        (await request(app).post(`/api/v1/tests/${unknown}/approve`).set(bearer(admin.token)))
          .status,
      ).toBe(404);
    });
  });

  describe("list and read", () => {
    it("lists without items, filters by status, and reads one", async () => {
      await fillBank(qual);
      const a = await generate(admin, rulesBody(qual, { seed: 1 }));
      await generate(admin, rulesBody(qual, { seed: 2 }));
      await request(app).post(`/api/v1/tests/${a.body._id}/approve`).set(bearer(reviewer.token));

      const all = await request(app).get("/api/v1/tests").set(bearer(reviewer.token));
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(2);
      expect(all.body.items[0].items).toBeUndefined();

      const approved = await request(app)
        .get("/api/v1/tests?status=approved&qualificationId=QUAL-GEN-01")
        .set(bearer(sme.token));
      expect(approved.body.items.map((p) => p._id)).toEqual([a.body._id]);

      expect(
        (await request(app).get("/api/v1/tests?bogus=1").set(bearer(admin.token))).status,
      ).toBe(400);

      const one = await request(app).get(`/api/v1/tests/${a.body._id}`).set(bearer(reviewer.token));
      expect(one.status).toBe(200);
      expect(one.body.items).toHaveLength(7);
      expect(JSON.stringify(one.body)).not.toContain("SECRET-");
    });

    it("shows question text only on request, to allowed roles", async () => {
      await fillBank(qual);
      const gen = await generate(admin, rulesBody(qual, { seed: 1 }));
      const res = await request(app)
        .get(`/api/v1/tests/${gen.body._id}?withQuestions=true`)
        .set(bearer(reviewer.token));
      expect(res.status).toBe(200);
      expect(res.body.items[0].stem).toMatch(/^SECRET-STEM-/);
    });
  });

  describe("roles", () => {
    it("denies generate, list, read, approve and check to everyone else", async () => {
      await fillBank(qual);
      const gen = await generate(admin, rulesBody(qual, { seed: 1 }));
      const id = gen.body._id;
      for (const who of [candidate, tp, mis]) {
        const h = bearer(who.token);
        expect(
          (await request(app).post("/api/v1/tests/generate").set(h).send(rulesBody(qual))).status,
        ).toBe(403);
        expect((await request(app).get("/api/v1/tests").set(h)).status).toBe(403);
        expect((await request(app).get(`/api/v1/tests/${id}`).set(h)).status).toBe(403);
        expect(
          (await request(app).get(`/api/v1/tests/${id}?withQuestions=true`).set(h)).status,
        ).toBe(403);
        expect((await request(app).post(`/api/v1/tests/${id}/approve`).set(h)).status).toBe(403);
        expect(
          (await request(app).post(`/api/v1/tests/${id}/regenerate-check`).set(h)).status,
        ).toBe(403);
      }
      expect((await request(app).get("/api/v1/tests")).status).toBe(401);
      expect((await generate(reviewer, rulesBody(qual))).status).toBe(403);
    });
  });

  describe("audit and privacy", () => {
    it("audits generate, approve and check with ids only, never question text", async () => {
      await fillBank(qual);
      const gen = await generate(sme, rulesBody(qual, { seed: 8 }));
      await request(app)
        .post(`/api/v1/tests/${gen.body._id}/regenerate-check`)
        .set(bearer(reviewer.token));
      await request(app).post(`/api/v1/tests/${gen.body._id}/approve`).set(bearer(reviewer.token));

      const rows = await AuditLog.find({ entity: "testPaper" }).sort({ createdAt: 1 }).lean();
      expect(rows.map((r) => r.action)).toEqual([
        "test.generate",
        "test.regenerate_check",
        "test.approve",
      ]);
      expect(rows[0].after).toMatchObject({ seed: 8, status: "draft" });
      expect(rows[0].after.items).toHaveLength(7);
      expect(rows[2].before.status).toBe("draft");
      expect(rows[2].after.status).toBe("approved");
      const text = JSON.stringify(rows);
      expect(text).not.toContain("SECRET-");
      expect(text).not.toContain("correctAnswer");
    });

    it("failed generation writes no audit row", async () => {
      const res = await generate(admin, rulesBody(qual));
      expect(res.status).toBe(422);
      expect(await AuditLog.countDocuments({ action: "test.generate" })).toBe(0);
    });
  });
});
