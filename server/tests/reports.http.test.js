import ExcelJS from "exceljs";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function sessionFor(role, extra = {}) {
  const email = `${role}-${oid()}@aa.example`;
  const { password } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken };
}

async function makeBatch(over = {}) {
  const assessorId = oid();
  const abId = oid();
  const batch = await Batch.create({
    abId,
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: istCalendarDate(new Date()),
    assessmentEndDate: istCalendarDate(new Date(Date.now() + 86_400_000)),
    tpId: oid(),
    centreId: oid(),
    candidateCount: 1,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "en",
    state: "Maharashtra",
    status: "in_progress",
    statusVersion: 3,
    assessorId,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...over,
  });
  await Candidate.create({ batchId: batch._id, learnerId: oid(), name: "Asha Devi", active: true });
  return { batch, abId, assessorId };
}

const binary = (res, done) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};

describe("GET /api/v1/reports/batches/:batchId/marks.xlsx (X-09)", () => {
  beforeAll(async () => {
    await startMongo();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("gives aa_admin the workbook and logs the read of the candidate names", async () => {
    const { batch } = await makeBatch();
    const admin = await sessionFor("aa_admin");
    const res = await request(app)
      .get(`/api/v1/reports/batches/${batch._id}/marks.xlsx`)
      .set(bearer(admin.token))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet("Marks");
    expect(sheet.getRow(4).getCell(2).value).toBe("Asha Devi");
    expect(sheet.getRow(4).getCell(3).value).toBe("Not attempted");
    expect(await AccessLog.countDocuments({ subjectType: "learner" })).toBe(1);
  });

  it("limits an assessor to their own batches and refuses candidates and tp", async () => {
    const { batch, assessorId } = await makeBatch();
    const other = await makeBatch();
    const own = await sessionFor("assessor", { linkedProfileId: assessorId });
    const url = (b) => `/api/v1/reports/batches/${b._id}/marks.xlsx`;
    expect(
      (await request(app).get(url(batch)).set(bearer(own.token)).buffer(true).parse(binary)).status,
    ).toBe(200);
    expect((await request(app).get(url(other.batch)).set(bearer(own.token))).status).toBe(404);
    for (const role of ["candidate", "tp", "proctor"]) {
      const s = await sessionFor(role);
      expect((await request(app).get(url(batch)).set(bearer(s.token))).status).toBe(403);
    }
    expect((await request(app).get(url(batch))).status).toBe(401);
  });

  it("rejects a bad id and unknown query keys", async () => {
    const admin = await sessionFor("aa_admin");
    const bad = await request(app)
      .get("/api/v1/reports/batches/nope/marks.xlsx")
      .set(bearer(admin.token));
    expect(bad.status).toBe(400);
    const { batch } = await makeBatch();
    const extra = await request(app)
      .get(`/api/v1/reports/batches/${batch._id}/marks.xlsx?x=1`)
      .set(bearer(admin.token));
    expect(extra.status).toBe(400);
  });
});
