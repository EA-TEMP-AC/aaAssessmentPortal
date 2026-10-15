import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AaRecognition, RECOGNITION_KEY } from "../src/models/aa-recognition.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { NqrQualification } from "../src/models/nqr-qualification.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { SectorConfig } from "../src/models/sector-config.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { computeCoverage } from "../src/modules/question-bank/sector-coverage.service.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const base = "/api/v1/question-bank";
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function sessionFor(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: String(user._id) };
}

function importCsv(token, csv, query = "") {
  return request(app)
    .post(`${base}/nqr-qualifications/import${query}`)
    .set(bearer(token))
    .set("Content-Type", "text/csv")
    .send(csv);
}

/** Held qualification with one approved question, so its NQR code counts as covered. */
async function holdCoveredQualification(code, userId) {
  const qual = await Qualification.create({
    code,
    name: `Held ${code}`,
    sector: "Electronics",
    ratioClass: "manufacturing",
    passMarkUnit: "percent",
    passMarks: { theory: 60, practical: 60, viva: 60 },
    nos: [{ nosId: "N1", code: "N1", name: "n", pcs: [{ pcId: "P1", code: "P1", name: "p" }] }],
  });
  await Question.create({
    qualificationId: qual._id,
    nosId: "N1",
    pcId: "P1",
    type: "short_answer",
    language: "en",
    stem: "Explain safe soldering practice",
    marks: 1,
    status: "approved",
    isLatest: true,
    createdBy: userId,
  });
  return qual;
}

async function seedNqr(sector, count, prefix) {
  await NqrQualification.insertMany(
    Array.from({ length: count }, (_, i) => ({
      code: `${prefix}-${i}`,
      name: `Qual ${i}`,
      sector,
    })),
  );
}

describe("computeCoverage", () => {
  it("reads the threshold from compliance.js", () => {
    expect(compliance.SECTOR_MIN_COVERAGE_PERCENT).toBe(5);
  });

  it("meets the minimum at exactly 5 percent and not just below", () => {
    expect(computeCoverage(100, 5)).toEqual({ percentCovered: 5, meetsMinimum: true });
    expect(computeCoverage(100, 4)).toEqual({ percentCovered: 4, meetsMinimum: false });
    expect(computeCoverage(20, 1)).toEqual({ percentCovered: 5, meetsMinimum: true });
    expect(computeCoverage(21, 1).meetsMinimum).toBe(false);
    expect(computeCoverage(3, 1).meetsMinimum).toBe(true);
  });

  it("is not fooled by a percentage that rounds up to 5", () => {
    const r = computeCoverage(100_000, 4_996);
    expect(r.percentCovered).toBe(5);
    expect(r.meetsMinimum).toBe(false);
  });

  it("gives an empty sector no percentage and no pass", () => {
    expect(computeCoverage(0, 0)).toEqual({ percentCovered: null, meetsMinimum: false });
  });

  it("honours a different minimum passed in", () => {
    expect(computeCoverage(10, 1, 10).meetsMinimum).toBe(true);
    expect(computeCoverage(10, 1, 11).meetsMinimum).toBe(false);
  });
});

describe("Sector coverage API (Q-05)", () => {
  let admin;
  let sme;
  let reviewer;

  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      SectorConfig.syncIndexes(),
      NqrQualification.syncIndexes(),
      Qualification.syncIndexes(),
      AuditLog.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    await AaRecognition.create({
      key: RECOGNITION_KEY,
      sectors: ["Electronics", "Construction"],
      panIndia: true,
      states: [],
      startDate: "2026-04-01",
      endDate: "2029-03-31",
    });
    admin = await sessionFor("aa_admin");
    sme = await sessionFor("sme");
    reviewer = await sessionFor("ab_reviewer");
  });

  async function configure(sector) {
    const res = await request(app)
      .post(`${base}/sector-config`)
      .set(bearer(admin.token))
      .send({ sector });
    return res.body.id;
  }

  describe("sector config", () => {
    it("creates a row for a recognised sector and audits it", async () => {
      const res = await request(app)
        .post(`${base}/sector-config`)
        .set(bearer(admin.token))
        .send({ sector: "Electronics" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ sector: "Electronics", active: true });
      const audit = await AuditLog.findOne({ action: "sector_config.create" }).lean();
      expect(audit.after.sector).toBe("Electronics");
    });

    it("refuses a sector that is not on the recognition record", async () => {
      const res = await request(app)
        .post(`${base}/sector-config`)
        .set(bearer(admin.token))
        .send({ sector: "Mining" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SECTOR_NOT_RECOGNISED");
    });

    it("refuses a ratio class, an unknown key and a duplicate", async () => {
      const ratio = await request(app)
        .post(`${base}/sector-config`)
        .set(bearer(admin.token))
        .send({ sector: "manufacturing" });
      expect(ratio.status).toBe(400);
      const extra = await request(app)
        .post(`${base}/sector-config`)
        .set(bearer(admin.token))
        .send({ sector: "Electronics", threshold: 1 });
      expect(extra.status).toBe(400);
      await configure("Electronics");
      const dup = await request(app)
        .post(`${base}/sector-config`)
        .set(bearer(admin.token))
        .send({ sector: "Electronics" });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe("DUPLICATE_RESOURCE");
    });

    it("drops a deactivated sector from the list and audits before and after", async () => {
      const id = await configure("Electronics");
      const patch = await request(app)
        .patch(`${base}/sector-config/${id}`)
        .set(bearer(admin.token))
        .send({ active: false });
      expect(patch.status).toBe(200);
      const audit = await AuditLog.findOne({ action: "sector_config.update" }).lean();
      expect(audit.before.active).toBe(true);
      expect(audit.after.active).toBe(false);
      const list = await request(app).get(`${base}/sector-coverage`).set(bearer(admin.token));
      expect(list.body.items).toEqual([]);
    });
  });

  describe("NQR CSV import", () => {
    it("imports valid rows and audits counts without the file text", async () => {
      const csv = "code,name,sector\nQ1,Solderer,Electronics\nQ2,Mason,Construction\n";
      const res = await importCsv(admin.token, csv);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ success: true, importedCount: 2, createdCount: 2 });
      expect(await NqrQualification.countDocuments()).toBe(2);
      const audit = await AuditLog.findOne({ action: "nqr_qualification.import" }).lean();
      expect(audit.meta).toMatchObject({ totalRows: 2, importedCount: 2, partial: false });
      expect(JSON.stringify(audit)).not.toContain("Solderer");
    });

    it("imports nothing when any row fails, reports each row, and audits the failure", async () => {
      const csv =
        "code,name,sector\nQ1,Solderer,Electronics\nQ2,Mason,Not a sector\n,NoCode,Mining\n";
      const res = await importCsv(admin.token, csv);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("IMPORT_VALIDATION_FAILED");
      expect(res.body.importedCount).toBe(0);
      expect(res.body.errors.map((e) => e.row)).toEqual([3, 4]);
      expect(await NqrQualification.countDocuments()).toBe(0);
      expect(await AuditLog.countDocuments({ action: "nqr_qualification.import" })).toBe(1);
    });

    it("imports the valid rows when partial=true", async () => {
      const csv = "code,name,sector\nQ1,Solderer,Electronics\nQ2,Mason,Bogus\n";
      const res = await importCsv(admin.token, csv, "?partial=true");
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ importedCount: 1, errorCount: 1 });
      expect(await NqrQualification.countDocuments()).toBe(1);
    });

    it("updates an existing code instead of duplicating it", async () => {
      await importCsv(admin.token, "code,name,sector\nQ1,Old,Electronics\n");
      const res = await importCsv(admin.token, "code,name,sector\nQ1,New,Construction\n");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 0, updatedCount: 1 });
      const row = await NqrQualification.findOne({ code: "Q1" }).lean();
      expect(row).toMatchObject({ name: "New", sector: "Construction" });
    });

    it("flags a code repeated inside the file", async () => {
      const res = await importCsv(
        admin.token,
        "code,name,sector\nQ1,A,Electronics\nQ1,B,Electronics\n",
      );
      expect(res.status).toBe(400);
      expect(res.body.errors[0].row).toBe(3);
    });

    it("neutralises formula characters", async () => {
      const csv =
        'code,name,sector\nQ1,"=HYPERLINK(""http://x"")",Electronics\n+Q2,@cmd,Electronics\n';
      const res = await importCsv(admin.token, csv);
      expect(res.status).toBe(201);
      const rows = await NqrQualification.find().lean();
      for (const r of rows) {
        expect(/^[=+\-@]/.test(r.code)).toBe(false);
        expect(/^[=+\-@]/.test(r.name)).toBe(false);
      }
      expect(rows.find((r) => r.code === "Q1").name).toBe(`'=HYPERLINK("http://x")`);
    });

    it("rejects national-id, unknown and missing columns", async () => {
      for (const header of ["code,name,sector,aadhaar", "code,name,sector,notes", "code,name"]) {
        const res = await importCsv(admin.token, `${header}\nQ1,A,Electronics\n`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
      expect(await NqrQualification.countDocuments()).toBe(0);
    });

    it("rejects a header-only file, a non-CSV body and no body", async () => {
      expect((await importCsv(admin.token, "code,name,sector\n")).status).toBe(400);
      expect((await importCsv(admin.token, '{"a":1}')).status).toBe(400);
      const noBody = await request(app)
        .post(`${base}/nqr-qualifications/import`)
        .set(bearer(admin.token));
      expect(noBody.status).toBe(400);
    });
  });

  describe("coverage report", () => {
    it("reports an empty sector as not meeting the minimum", async () => {
      const id = await configure("Construction");
      const list = await request(app).get(`${base}/sector-coverage`).set(bearer(admin.token));
      expect(list.status).toBe(200);
      expect(list.body.minimumPercent).toBe(5);
      expect(list.body.items[0]).toMatchObject({
        sector: "Construction",
        nqrQualificationCount: 0,
        coveredCount: 0,
        percentCovered: null,
        meetsMinimum: false,
      });
      const detail = await request(app)
        .get(`${base}/sector-coverage/${id}`)
        .set(bearer(admin.token));
      expect(detail.body.uncovered).toMatchObject({ total: 0, items: [] });
    });

    it("meets the minimum at exactly 5 of 100 and fails at 4 of 100", async () => {
      const id = await configure("Electronics");
      await seedNqr("Electronics", 100, "E");
      for (let i = 0; i < 4; i += 1) {
        await holdCoveredQualification(`E-${i}`, admin.userId);
      }
      const get = () => request(app).get(`${base}/sector-coverage/${id}`).set(bearer(admin.token));
      let detail = await get();
      expect(detail.body).toMatchObject({
        nqrQualificationCount: 100,
        coveredCount: 4,
        percentCovered: 4,
        meetsMinimum: false,
      });
      await holdCoveredQualification("E-4", admin.userId);
      detail = await get();
      expect(detail.body).toMatchObject({ coveredCount: 5, percentCovered: 5, meetsMinimum: true });
      expect(detail.body.uncovered.total).toBe(95);
    });

    it("counts only approved latest questions and pages the uncovered list", async () => {
      const id = await configure("Electronics");
      await seedNqr("Electronics", 3, "E");
      const draft = await holdCoveredQualification("E-0", admin.userId);
      await Question.updateMany({ qualificationId: draft._id }, { status: "draft" });
      const old = await holdCoveredQualification("E-1", admin.userId);
      await Question.updateMany({ qualificationId: old._id }, { isLatest: false });
      await holdCoveredQualification("E-2", admin.userId);

      const res = await request(app)
        .get(`${base}/sector-coverage/${id}?limit=1&page=2`)
        .set(bearer(admin.token));
      expect(res.body.coveredCount).toBe(1);
      expect(res.body.uncovered).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(res.body.uncovered.items).toEqual([{ code: "E-1", name: "Qual 1" }]);
    });

    it("ignores NQR rows of sectors with no config", async () => {
      await configure("Electronics");
      await seedNqr("Electronics", 2, "E");
      await seedNqr("Construction", 5, "C");
      const list = await request(app).get(`${base}/sector-coverage`).set(bearer(admin.token));
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].nqrQualificationCount).toBe(2);
    });

    it("returns 404 for an unknown sector id and 400 for a malformed one", async () => {
      const missing = await request(app)
        .get(`${base}/sector-coverage/66f0000000000000000000aa`)
        .set(bearer(admin.token));
      expect(missing.status).toBe(404);
      const bad = await request(app).get(`${base}/sector-coverage/xyz`).set(bearer(admin.token));
      expect(bad.status).toBe(400);
    });
  });

  describe("roles", () => {
    it("lets aa_admin, sme and ab_reviewer read, and only aa_admin write", async () => {
      const id = await configure("Electronics");
      for (const s of [admin, sme, reviewer]) {
        const list = await request(app).get(`${base}/sector-coverage`).set(bearer(s.token));
        expect(list.status).toBe(200);
        const one = await request(app).get(`${base}/sector-coverage/${id}`).set(bearer(s.token));
        expect(one.status).toBe(200);
      }
      for (const s of [sme, reviewer]) {
        const create = await request(app)
          .post(`${base}/sector-config`)
          .set(bearer(s.token))
          .send({ sector: "Construction" });
        expect(create.status).toBe(403);
        const patch = await request(app)
          .patch(`${base}/sector-config/${id}`)
          .set(bearer(s.token))
          .send({ active: false });
        expect(patch.status).toBe(403);
        expect((await importCsv(s.token, "code,name,sector\nQ1,A,Electronics\n")).status).toBe(403);
      }
      expect(await NqrQualification.countDocuments()).toBe(0);
      expect(await SectorConfig.countDocuments()).toBe(1);
    });

    it("denies every other role and anonymous callers", async () => {
      const others = USER_ROLES.filter((r) => !["aa_admin", "sme", "ab_reviewer"].includes(r));
      for (const role of others) {
        const s = await sessionFor(role);
        const list = await request(app).get(`${base}/sector-coverage`).set(bearer(s.token));
        expect(list.status).toBe(403);
        expect((await importCsv(s.token, "code,name,sector\nQ1,A,Electronics\n")).status).toBe(403);
      }
      expect((await request(app).get(`${base}/sector-coverage`)).status).toBe(401);
    });
  });
});
