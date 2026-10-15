import request from "supertest";
import { createApp } from "../src/app.js";
import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { Assessor } from "../src/models/assessor.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Learner } from "../src/models/learner.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function sessionFor(role, extra = {}) {
  const email = extra.email ?? `${role}@aa.example`;
  const { password } = await createUser({ role, email, name: role, ...extra.user });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function logs() {
  return AccessLog.find({}).sort({ createdAt: 1, _id: 1 }).lean();
}

async function rosterFixture(admin) {
  const ab = await AwardingBody.create({
    name: "AB",
    code: "AB-1",
    notificationEmails: ["ab@ab.example"],
    active: true,
  });
  const tp = await TrainingPartner.create({ name: "TP", code: "TP-1", active: true });
  const centre = await Centre.create({
    name: "Centre",
    code: "C-1",
    tpId: tp._id,
    state: "Maharashtra",
    active: true,
  });
  const qualification = await Qualification.create({
    code: "Q-1",
    name: "Electrician L4",
    sector: "Electronics",
    ratioClass: "manufacturing",
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    nos: [{ nosId: "NOS-01", code: "N01", name: "Safety", pcs: [] }],
  });
  await AaRecognition.create({
    sectors: ["Electronics"],
    panIndia: false,
    states: ["Maharashtra"],
    startDate: "2020-01-01",
    endDate: "2099-12-31",
  });
  const batch = await request(app)
    .post("/api/v1/batches")
    .set(bearer(admin))
    .send({
      abId: String(ab._id),
      qualificationId: String(qualification._id),
      type: "STT",
      mode: "offline",
      assessmentStartDate: "2099-06-15",
      assessmentEndDate: "2099-06-16",
      tpId: String(tp._id),
      centreId: String(centre._id),
      candidateCount: 5,
      assessmentLanguage: "Hindi",
    });
  expect(batch.status, JSON.stringify(batch.body)).toBe(201);
  return batch.body;
}

describe("access log", () => {
  beforeAll(async () => {
    await startMongo();
    await AccessLog.init();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  describe("recording", () => {
    it("logs a learner detail read: who, which learner, which fields, and no values", async () => {
      const admin = await sessionFor("aa_admin");
      const learner = await Learner.create({
        name: "Asha Devi",
        phone: "9876543210",
        externalRef: "TP-9",
      });

      const res = await request(app)
        .get(`/api/v1/learners/${learner._id}`)
        .set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe("9876543210");

      const rows = await logs();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: expect.anything(),
        actorRole: "aa_admin",
        subjectType: "learner",
        subjectId: String(learner._id),
        kind: "detail",
        fields: ["name", "phone", "externalRef"],
        route: "GET /api/v1/learners/:id",
      });
      expect(String(rows[0].actorId)).toBe(admin.userId);
      const serialized = JSON.stringify(rows);
      for (const value of ["Asha Devi", "9876543210", "TP-9"]) {
        expect(serialized).not.toContain(value);
      }
    });

    it("writes one row per learner on a list, sharing a request id", async () => {
      const admin = await sessionFor("aa_admin");
      const learners = await Learner.insertMany([
        { name: "One", phone: "9000000001" },
        { name: "Two", phone: "9000000002" },
        { name: "Three" },
      ]);

      const res = await request(app).get("/api/v1/learners?pageSize=2").set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);

      const rows = await logs();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.requestId)).size).toBe(1);
      expect(rows.every((row) => row.kind === "list" && row.route === "GET /api/v1/learners")).toBe(
        true,
      );
      const loggedIds = rows.map((row) => row.subjectId).sort();
      expect(loggedIds).toEqual(res.body.items.map((item) => item.id).sort());
      expect(learners.map((doc) => String(doc._id))).toEqual(expect.arrayContaining(loggedIds));
    });

    it("does not log the query string, so a search term never reaches the log", async () => {
      const admin = await sessionFor("aa_admin");
      await Learner.create({ name: "Findable" });
      await request(app).get("/api/v1/learners?active=true").set(bearer(admin.token));
      expect(JSON.stringify(await logs())).not.toContain("active=true");
    });

    it("logs users, assessors, proctors and the batch roster", async () => {
      const admin = await sessionFor("aa_admin");
      const assessor = await Assessor.create({ name: "Asr", email: "asr@example.com" });
      const proctor = await Proctor.create({ name: "Prc", email: "prc@example.com" });

      await request(app).get("/api/v1/users").set(bearer(admin.token)).expect(200);
      await request(app).get(`/api/v1/users/${admin.userId}`).set(bearer(admin.token)).expect(200);
      await request(app).get("/api/v1/assessors").set(bearer(admin.token)).expect(200);
      await request(app)
        .get(`/api/v1/assessors/${assessor._id}`)
        .set(bearer(admin.token))
        .expect(200);
      await request(app).get("/api/v1/assessors/available").set(bearer(admin.token)).expect(200);
      await request(app).get("/api/v1/proctors").set(bearer(admin.token)).expect(200);
      await request(app)
        .get(`/api/v1/proctors/${proctor._id}`)
        .set(bearer(admin.token))
        .expect(200);

      const rows = await logs();
      const seen = rows.map((row) => `${row.subjectType}:${row.kind}`);
      expect(seen).toEqual(
        expect.arrayContaining([
          "user:list",
          "user:detail",
          "assessor:list",
          "assessor:detail",
          "proctor:list",
          "proctor:detail",
        ]),
      );
      const userRow = rows.find((row) => row.subjectType === "user" && row.kind === "detail");
      expect(userRow.fields).toEqual(["email", "name"]);
      expect(userRow.subjectId).toBe(admin.userId);
      expect(JSON.stringify(rows)).not.toMatch(/example\.com/);

      const batch = await rosterFixture(admin.token);
      const learner = await Learner.create({ name: "Rostered", externalRef: "R-1" });
      await request(app)
        .post(`/api/v1/batches/${batch.id}/candidates`)
        .set(bearer(admin.token))
        .send({ learnerId: String(learner._id) })
        .expect(201);
      await AccessLog.collection.deleteMany({});
      const roster = await request(app)
        .get(`/api/v1/batches/${batch.id}/candidates`)
        .set(bearer(admin.token));
      expect(roster.status).toBe(200);
      const rosterRows = await logs();
      expect(rosterRows).toHaveLength(1);
      expect(rosterRows[0]).toMatchObject({
        subjectType: "learner",
        subjectId: String(learner._id),
        kind: "list",
        route: `GET /api/v1/batches/:id/candidates`,
      });
      expect(await Candidate.countDocuments({})).toBe(1);
    });

    it("does not log reads that are refused or empty", async () => {
      await sessionFor("aa_admin");
      const tp = await sessionFor("tp");
      const denied = await request(app).get("/api/v1/learners").set(bearer(tp.token));
      expect(denied.status).toBe(403);
      await request(app).get("/api/v1/learners").expect(401);
      await request(app).get("/api/v1/learners/not-an-id").set(bearer(tp.token));
      const admin = await sessionFor("mis", { email: "mis@aa.example" });
      const empty = await request(app).get("/api/v1/learners").set(bearer(admin.token));
      expect(empty.body.items).toEqual([]);
      expect(await AccessLog.countDocuments({})).toBe(0);
    });

    it("refuses to serve personal data when the log cannot be written", async () => {
      const admin = await sessionFor("aa_admin");
      const learner = await Learner.create({ name: "Hidden", phone: "9555555555" });
      const spy = vi.spyOn(AccessLog, "insertMany").mockRejectedValueOnce(new Error("disk full"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(app)
        .get(`/api/v1/learners/${learner._id}`)
        .set(bearer(admin.token));
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain("9555555555");
      spy.mockRestore();
      quiet.mockRestore();
    });

    it("is append-only", async () => {
      const admin = await sessionFor("aa_admin");
      await request(app).get("/api/v1/users").set(bearer(admin.token));
      const row = await AccessLog.findOne({});
      row.kind = "detail";
      await expect(row.save()).rejects.toThrow(/append-only/);
      await expect(AccessLog.updateOne({}, { kind: "list" })).rejects.toThrow(/append-only/);
      await expect(AccessLog.deleteMany({})).rejects.toThrow(/append-only/);
    });
  });

  describe("GET /audit/access-log", () => {
    async function seed() {
      const admin = await sessionFor("aa_admin");
      const mis = await sessionFor("mis");
      const [a, b] = await Learner.insertMany([
        { name: "A", phone: "9000000001" },
        { name: "B", phone: "9000000002" },
      ]);
      await request(app).get(`/api/v1/learners/${a._id}`).set(bearer(admin.token)).expect(200);
      await request(app).get(`/api/v1/learners/${b._id}`).set(bearer(mis.token)).expect(200);
      await request(app).get("/api/v1/users").set(bearer(admin.token)).expect(200);
      return { admin, mis, a, b };
    }

    it("is aa_admin only", async () => {
      await request(app).get("/api/v1/audit/access-log").expect(401);
      for (const role of USER_ROLES.filter((item) => item !== "aa_admin")) {
        const session = await sessionFor(role);
        const res = await request(app).get("/api/v1/audit/access-log").set(bearer(session.token));
        expect(res.status, role).toBe(403);
      }
      const admin = await sessionFor("aa_admin");
      const ok = await request(app).get("/api/v1/audit/access-log").set(bearer(admin.token));
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    it("returns rows newest first with no personal values", async () => {
      const { admin } = await seed();
      const res = await request(app).get("/api/v1/audit/access-log").set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        [
          "actorId",
          "actorRole",
          "createdAt",
          "fields",
          "id",
          "ip",
          "kind",
          "requestId",
          "route",
          "subjectId",
          "subjectType",
        ].sort(),
      );
      const times = res.body.items.map((item) => item.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("9000000001");
      expect(text).not.toMatch(/@aa\.example/);
    });

    it("filters by subject, actor, role, kind and time", async () => {
      const { admin, mis, a } = await seed();
      const get = (query) =>
        request(app).get(`/api/v1/audit/access-log?${query}`).set(bearer(admin.token));

      const bySubject = await get(`subjectType=learner&subjectId=${a._id}`);
      expect(bySubject.body.total).toBe(1);
      expect(bySubject.body.items[0]).toMatchObject({
        subjectId: String(a._id),
        actorRole: "aa_admin",
      });

      expect((await get(`actorId=${mis.userId}`)).body.total).toBe(1);
      expect((await get("actorRole=aa_admin")).body.total).toBe(3);
      expect((await get("kind=list")).body.total).toBe(2);
      expect((await get("subjectType=user")).body.total).toBe(2);

      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect((await get(`from=${encodeURIComponent(future)}`)).body.total).toBe(0);
      const past = new Date(Date.now() - 3_600_000).toISOString();
      expect(
        (await get(`from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`)).body.total,
      ).toBe(4);
    });

    it("pages results", async () => {
      const { admin } = await seed();
      const first = await request(app)
        .get("/api/v1/audit/access-log?pageSize=3&page=1")
        .set(bearer(admin.token));
      const second = await request(app)
        .get("/api/v1/audit/access-log?pageSize=3&page=2")
        .set(bearer(admin.token));
      expect(first.body.items).toHaveLength(3);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.total).toBe(4);
      const ids = [...first.body.items, ...second.body.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(4);
    });

    it("rejects bad filters", async () => {
      const admin = await sessionFor("aa_admin");
      for (const query of [
        "subjectType=ghost",
        "kind=write",
        "actorId=nope",
        "actorRole=root",
        "from=yesterday-ish",
        "pageSize=500",
        "page=0",
        "unknown=1",
        "from=2030-01-02&to=2030-01-01",
      ]) {
        const res = await request(app)
          .get(`/api/v1/audit/access-log?${query}`)
          .set(bearer(admin.token));
        expect(res.status, query).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("does not log its own reads", async () => {
      const admin = await sessionFor("aa_admin");
      await request(app).get("/api/v1/audit/access-log").set(bearer(admin.token)).expect(200);
      expect(await AccessLog.countDocuments({})).toBe(0);
    });
  });
});
