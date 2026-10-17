import request from "supertest";
import { createApp } from "../src/app.js";
import { QuestionImage } from "../src/models/question-image.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
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

async function createSampleQualification(code = "QUAL-AUTO-01") {
  return Qualification.create({
    code,
    name: "Automotive Service Technician",
    sector: "Automotive",
    ratioClass: "manufacturing",
    defaultBatchType: "STT",
    passCriteriaMode: "nos_wise",
    passMarkUnit: "percent",
    passMarks: { theory: 60, practical: 70, viva: 60 },
    nos: [
      {
        nosId: "NOS-01",
        code: "ASC/N0101",
        name: "Engine Maintenance",
        pcs: [
          { pcId: "PC-01", code: "PC1.1", name: "Inspect engine oil", passMark: 60, maxMark: 100 },
          { pcId: "PC-02", code: "PC1.2", name: "Replace spark plugs", passMark: 60, maxMark: 100 },
        ],
      },
      {
        nosId: "NOS-02",
        code: "ASC/N0102",
        name: "Electrical Systems",
        pcs: [
          {
            pcId: "PC-03",
            code: "PC2.1",
            name: "Check battery voltage",
            passMark: 60,
            maxMark: 100,
          },
        ],
      },
    ],
  });
}

// A real 1x1 PNG and a few JPEG start bytes: the type is read from the bytes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

const upload = (who, bytes, type = "image/png") =>
  request(app)
    .post("/api/v1/question-bank/images")
    .set(bearer(who.token))
    .set("Content-Type", type)
    .send(bytes);

describe("Images in questions (X-25)", () => {
  let qual;
  let sme;
  let admin;
  let candidate;
  let tp;

  beforeAll(async () => {
    await startMongo();
    await Question.syncIndexes();
  });
  afterAll(stopMongo);
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    qual = await createSampleQualification();
    sme = await sessionFor("sme");
    admin = await sessionFor("aa_admin");
    candidate = await sessionFor("candidate");
    tp = await sessionFor("tp");
  });

  const payload = (images) => ({
    qualificationId: String(qual._id),
    nosId: "NOS-01",
    pcId: "PC-01",
    type: "short_answer",
    language: "en",
    stem: "Describe what the picture shows.",
    marks: 2,
    ...(images ? { images } : {}),
  });

  it("saves a PNG and a JPEG, reads the type from the bytes, and serves them back", async () => {
    for (const [bytes, type] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
    ]) {
      const res = await upload(sme, bytes, type);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ contentType: type, size: bytes.length });
      const file = await request(app)
        .get(`/api/v1/question-bank/images/${res.body.id}/file`)
        .set(bearer(admin.token))
        .buffer(true)
        .parse((r, cb) => {
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toContain(type);
      expect(Buffer.compare(file.body, bytes)).toBe(0);
    }
  });

  it("refuses other file types, an empty body, a big picture and non-writers", async () => {
    // A PDF sent as image/png is refused: the bytes decide, not the header.
    expect((await upload(sme, Buffer.from("%PDF-1.4 test"))).status).toBe(400);
    expect((await upload(sme, Buffer.alloc(0))).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect([400, 413]).toContain((await upload(sme, big)).status);
    for (const who of [candidate, tp]) expect((await upload(who, PNG)).status).toBe(403);
    expect(await QuestionImage.countDocuments()).toBe(0);
  });

  it("attaches pictures with a description to a question, keeps them on a new version", async () => {
    const one = (await upload(sme, PNG)).body.id;
    const two = (await upload(sme, JPEG, "image/jpeg")).body.id;
    const created = await request(app)
      .post("/api/v1/question-bank/questions")
      .set(bearer(sme.token))
      .send(
        payload([
          { imageId: one, alt: "A wiring diagram" },
          { imageId: two, alt: "A meter" },
        ]),
      );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.images).toEqual([
      { imageId: one, alt: "A wiring diagram" },
      { imageId: two, alt: "A meter" },
    ]);
    const edited = await request(app)
      .put(`/api/v1/question-bank/questions/${created.body._id}`)
      .set(bearer(sme.token))
      .send({ stem: "Describe what the first picture shows." });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.images).toHaveLength(2);
  });

  it("refuses an unknown picture, a repeat, no description and more than three", async () => {
    const one = (await upload(sme, PNG)).body.id;
    const post = (images) =>
      request(app)
        .post("/api/v1/question-bank/questions")
        .set(bearer(sme.token))
        .send(payload(images));
    expect((await post([{ imageId: "a".repeat(24), alt: "x" }])).status).toBe(400);
    expect(
      (
        await post([
          { imageId: one, alt: "x" },
          { imageId: one, alt: "y" },
        ])
      ).status,
    ).toBe(400);
    expect((await post([{ imageId: one, alt: "" }])).status).toBe(400);
    expect((await post([{ imageId: one }])).status).toBe(400);
    const four = Array.from({ length: 4 }, () => ({ imageId: one, alt: "x" }));
    expect((await post(four)).status).toBe(400);
  });

  it("a candidate can fetch a picture only while an open attempt holds a question using it", async () => {
    const id = (await upload(sme, PNG)).body.id;
    const res = await request(app)
      .get(`/api/v1/question-bank/images/${id}/file`)
      .set(bearer(candidate.token));
    expect(res.status).toBe(403);
    expect((await request(app).get(`/api/v1/question-bank/images/${id}/file`)).status).toBe(401);
    expect(
      (
        await request(app)
          .get(`/api/v1/question-bank/images/${"b".repeat(24)}/file`)
          .set(bearer(admin.token))
      ).status,
    ).toBe(404);
  });
});
