import request from "supertest";
import { createApp } from "../src/app.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { SecurityAudit, SecurityFinding } from "../src/models/security-audit.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const BASE = "/api/v1/security";

async function sessionFor(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const today = () => istCalendarDate(new Date());
function dayOffset(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  return istCalendarDate(d);
}

const auditBody = (extra = {}) => ({
  type: "vapt",
  auditor: "Confidential Auditor Pvt Ltd",
  auditDate: "2026-09-01",
  scope: "Public website and API",
  fixesDueDate: "2026-12-31",
  ...extra,
});

const findingBody = (extra = {}) => ({
  severity: "high",
  description: "SECRET-WEAKNESS-TEXT stored XSS in the notice page",
  owner: "Confidential Owner Name",
  dueDate: dayOffset(30),
  evidenceRef: "TICKET-1042",
  ...extra,
});

describe("Security audit tracker (S-02)", () => {
  let admin;
  let mis;
  let viewer;

  const post = (session, path, body) =>
    request(app).post(`${BASE}${path}`).set(bearer(session.token)).send(body);
  const patch = (session, path, body) =>
    request(app).patch(`${BASE}${path}`).set(bearer(session.token)).send(body);
  const get = (session, path) => request(app).get(`${BASE}${path}`).set(bearer(session.token));
  const del = (session, path) => request(app).delete(`${BASE}${path}`).set(bearer(session.token));

  async function newAudit(extra) {
    const res = await post(admin, "/audits", auditBody(extra));
    expect(res.status).toBe(201);
    return res.body;
  }
  async function newFinding(auditId, extra) {
    const res = await post(admin, `/audits/${auditId}/findings`, findingBody(extra));
    expect(res.status).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    await startMongo();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    admin = await sessionFor("aa_admin");
    mis = await sessionFor("mis");
    viewer = await sessionFor("ncvet_viewer");
  });

  describe("audits", () => {
    it("aa_admin creates, reads, lists, updates and archives an audit", async () => {
      const created = await newAudit();
      expect(created).toMatchObject({
        type: "vapt",
        auditor: "Confidential Auditor Pvt Ltd",
        auditDate: "2026-09-01",
        scope: "Public website and API",
        status: "open",
        fixesDueDate: "2026-12-31",
        closedDate: null,
      });
      expect(created.id).toMatch(/^[a-f0-9]{24}$/);

      expect((await get(admin, `/audits/${created.id}`)).body).toEqual(created);

      const list = await get(admin, "/audits");
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(list.body.items[0].id).toBe(created.id);

      const updated = await patch(admin, `/audits/${created.id}`, { scope: "Everything" });
      expect(updated.status).toBe(200);
      expect(updated.body.scope).toBe("Everything");

      const removed = await del(admin, `/audits/${created.id}`);
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ id: created.id, archived: true });
      expect((await get(admin, `/audits/${created.id}`)).status).toBe(404);
      expect((await get(admin, "/audits")).body.total).toBe(0);
      // Archived, never deleted.
      expect(await SecurityAudit.countDocuments({})).toBe(1);
    });

    it("sets the closed date on closing and clears it on reopening", async () => {
      const audit = await newAudit();
      const closed = await patch(admin, `/audits/${audit.id}`, { status: "closed" });
      expect(closed.body).toMatchObject({ status: "closed", closedDate: today() });

      const reopened = await patch(admin, `/audits/${audit.id}`, { status: "open" });
      expect(reopened.body).toMatchObject({ status: "open", closedDate: null });

      const given = await patch(admin, `/audits/${audit.id}`, {
        status: "closed",
        closedDate: "2026-10-01",
      });
      expect(given.body.closedDate).toBe("2026-10-01");
    });

    it("refuses a future closed date and a closed date on an open audit", async () => {
      const audit = await newAudit();
      const future = await patch(admin, `/audits/${audit.id}`, {
        status: "closed",
        closedDate: dayOffset(5),
      });
      expect(future.status).toBe(400);
      const open = await patch(admin, `/audits/${audit.id}`, { closedDate: "2026-10-01" });
      expect(open.status).toBe(400);
    });

    it("filters the list by status and type", async () => {
      const a = await newAudit();
      await newAudit({ type: "code_review" });
      await patch(admin, `/audits/${a.id}`, { status: "closed" });
      expect((await get(admin, "/audits?status=closed")).body.total).toBe(1);
      expect((await get(admin, "/audits?status=open")).body.total).toBe(1);
      expect((await get(admin, "/audits?type=code_review")).body.total).toBe(1);
      expect((await get(admin, "/audits?type=nope")).status).toBe(400);
    });

    it("rejects bad input: unknown keys, bad dates, bad types, due date before the audit", async () => {
      const cases = [
        auditBody({ extra: 1 }),
        auditBody({ type: "magic" }),
        auditBody({ auditDate: "2026-13-40" }),
        auditBody({ auditor: "" }),
        auditBody({ fixesDueDate: "2026-08-01" }),
        auditBody({ status: "closed" }),
      ];
      for (const body of cases) {
        const res = await post(admin, "/audits", body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
      const audit = await newAudit();
      expect((await patch(admin, `/audits/${audit.id}`, {})).status).toBe(400);
      expect((await patch(admin, `/audits/${audit.id}`, { bogus: 1 })).status).toBe(400);
      expect(
        (await patch(admin, `/audits/${audit.id}`, { fixesDueDate: "2026-01-01" })).status,
      ).toBe(400);
      const cleared = await patch(admin, `/audits/${audit.id}`, { fixesDueDate: null });
      expect(cleared.body.fixesDueDate).toBeNull();
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect((await get(admin, "/audits/66f0a1b2c3d4e5f607182930")).status).toBe(404);
      expect((await get(admin, "/audits/not-an-id")).status).toBe(400);
    });

    it("will not archive an audit that still has findings", async () => {
      const audit = await newAudit();
      const finding = await newFinding(audit.id);
      const blocked = await del(admin, `/audits/${audit.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("INVALID_TRANSITION");
      await del(admin, `/findings/${finding.id}`);
      expect((await del(admin, `/audits/${audit.id}`)).status).toBe(200);
    });
  });

  describe("findings", () => {
    let audit;
    beforeEach(async () => {
      audit = await newAudit();
    });

    it("creates, reads, lists and updates a finding", async () => {
      const created = await newFinding(audit.id);
      expect(created).toMatchObject({
        auditId: audit.id,
        severity: "high",
        owner: "Confidential Owner Name",
        status: "open",
        closedDate: null,
        evidenceRef: "TICKET-1042",
        overdue: false,
      });

      expect((await get(admin, `/findings/${created.id}`)).body).toEqual(created);
      const forAudit = await get(admin, `/audits/${audit.id}/findings`);
      expect(forAudit.body.total).toBe(1);
      expect((await get(admin, "/findings")).body.total).toBe(1);

      const updated = await patch(admin, `/findings/${created.id}`, {
        severity: "critical",
        owner: "Someone Else",
      });
      expect(updated.body).toMatchObject({ severity: "critical", owner: "Someone Else" });
    });

    it("closing sets the date, reopening clears it, and the evidence reference is kept", async () => {
      const f = await newFinding(audit.id);
      const closed = await patch(admin, `/findings/${f.id}`, {
        status: "closed",
        evidenceRef: "RETEST-REPORT-7",
      });
      expect(closed.body).toMatchObject({
        status: "closed",
        closedDate: today(),
        evidenceRef: "RETEST-REPORT-7",
      });
      const reopened = await patch(admin, `/findings/${f.id}`, { status: "open" });
      expect(reopened.body).toMatchObject({ status: "open", closedDate: null });
      const cleared = await patch(admin, `/findings/${f.id}`, { evidenceRef: null });
      expect(cleared.body.evidenceRef).toBeNull();
    });

    it("flags an open finding past its due date as overdue, and filters on it", async () => {
      const late = await newFinding(audit.id, { dueDate: dayOffset(-3) });
      const onTime = await newFinding(audit.id, { dueDate: dayOffset(3) });
      const dueToday = await newFinding(audit.id, { dueDate: today() });
      expect(late.overdue).toBe(true);
      expect(onTime.overdue).toBe(false);
      expect(dueToday.overdue).toBe(false);

      const overdue = await get(admin, "/findings?overdue=true");
      expect(overdue.body.items.map((i) => i.id)).toEqual([late.id]);
      const notOverdue = await get(admin, "/findings?overdue=false");
      expect(notOverdue.body.total).toBe(2);

      await patch(admin, `/findings/${late.id}`, { status: "closed" });
      expect((await get(admin, `/findings/${late.id}`)).body.overdue).toBe(false);
      expect((await get(admin, "/findings?overdue=true")).body.total).toBe(0);
    });

    it("filters by severity, status and audit", async () => {
      const other = await newAudit();
      await newFinding(audit.id, { severity: "low" });
      await newFinding(audit.id, { severity: "critical" });
      await newFinding(other.id, { severity: "critical" });
      expect((await get(admin, "/findings?severity=critical")).body.total).toBe(2);
      expect((await get(admin, `/findings?severity=critical&auditId=${other.id}`)).body.total).toBe(
        1,
      );
      expect((await get(admin, `/audits/${audit.id}/findings`)).body.total).toBe(2);
      expect((await get(admin, "/findings?status=closed")).body.total).toBe(0);
      expect((await get(admin, "/findings?severity=urgent")).status).toBe(400);
    });

    it("rejects bad input", async () => {
      const cases = [
        findingBody({ severity: "urgent" }),
        findingBody({ description: "" }),
        findingBody({ owner: "" }),
        findingBody({ dueDate: "tomorrow" }),
        findingBody({ status: "closed" }),
        findingBody({ auditId: audit.id }),
        findingBody({ evidenceRef: "x".repeat(501) }),
      ];
      for (const body of cases) {
        const res = await post(admin, `/audits/${audit.id}/findings`, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      const unknownAudit = await post(
        admin,
        "/audits/66f0a1b2c3d4e5f607182930/findings",
        findingBody(),
      );
      expect(unknownAudit.status).toBe(404);
    });

    it("refuses a new finding on a closed audit", async () => {
      await patch(admin, `/audits/${audit.id}`, { status: "closed" });
      const res = await post(admin, `/audits/${audit.id}/findings`, findingBody());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INVALID_TRANSITION");
    });

    it("archives a finding and hides it from reads and lists", async () => {
      const f = await newFinding(audit.id);
      const res = await del(admin, `/findings/${f.id}`);
      expect(res.body).toEqual({ id: f.id, archived: true });
      expect((await get(admin, `/findings/${f.id}`)).status).toBe(404);
      expect((await get(admin, "/findings")).body.total).toBe(0);
      expect(await SecurityFinding.countDocuments({})).toBe(1);
    });
  });

  describe("summary", () => {
    it("counts open findings by severity and the overdue ones", async () => {
      const a = await newAudit({ fixesDueDate: dayOffset(-10), auditDate: "2026-01-01" });
      const b = await newAudit({ fixesDueDate: dayOffset(10) });
      await newFinding(a.id, { severity: "critical", dueDate: dayOffset(-1) });
      await newFinding(a.id, { severity: "high", dueDate: dayOffset(-20) });
      await newFinding(a.id, { severity: "high", dueDate: dayOffset(20) });
      await newFinding(b.id, { severity: "low", dueDate: dayOffset(5) });
      const closed = await newFinding(b.id, { severity: "critical", dueDate: dayOffset(-5) });
      await patch(admin, `/findings/${closed.id}`, { status: "closed" });
      const archived = await newFinding(b.id, { severity: "medium", dueDate: dayOffset(-5) });
      await del(admin, `/findings/${archived.id}`);

      const res = await get(admin, "/audits/summary");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        asOf: today(),
        openAudits: 2,
        openFindingsBySeverity: { critical: 1, high: 2, medium: 0, low: 1, info: 0 },
        openFindingsTotal: 4,
        overdueCount: 2,
        overdueAudits: 1,
      });
    });

    it("is all zeros when nothing is recorded", async () => {
      const res = await get(viewer, "/audits/summary");
      expect(res.status).toBe(200);
      expect(res.body.openFindingsTotal).toBe(0);
      expect(res.body.overdueCount).toBe(0);
      expect(Object.values(res.body.openFindingsBySeverity)).toEqual([0, 0, 0, 0, 0]);
    });

    it("is not captured by the :id route", async () => {
      expect((await get(admin, "/audits/summary")).body.openFindingsBySeverity).toBeDefined();
    });
  });

  describe("roles", () => {
    it("mis and ncvet_viewer read everything and write nothing", async () => {
      const audit = await newAudit();
      const finding = await newFinding(audit.id);
      for (const session of [mis, viewer]) {
        expect((await get(session, "/audits")).status).toBe(200);
        expect((await get(session, `/audits/${audit.id}`)).status).toBe(200);
        expect((await get(session, `/audits/${audit.id}/findings`)).status).toBe(200);
        expect((await get(session, "/findings")).status).toBe(200);
        expect((await get(session, `/findings/${finding.id}`)).status).toBe(200);
        expect((await get(session, "/audits/summary")).status).toBe(200);

        expect((await post(session, "/audits", auditBody())).status).toBe(403);
        expect((await patch(session, `/audits/${audit.id}`, { scope: "x" })).status).toBe(403);
        expect((await del(session, `/audits/${audit.id}`)).status).toBe(403);
        expect((await post(session, `/audits/${audit.id}/findings`, findingBody())).status).toBe(
          403,
        );
        expect((await patch(session, `/findings/${finding.id}`, { severity: "low" })).status).toBe(
          403,
        );
        expect((await del(session, `/findings/${finding.id}`)).status).toBe(403);
      }
      expect(await SecurityAudit.countDocuments({})).toBe(1);
      expect((await get(admin, `/findings/${finding.id}`)).body.severity).toBe("high");
    });

    it("everyone else is denied, and anonymous callers get 401", async () => {
      const audit = await newAudit();
      for (const role of ["sme", "assessor", "proctor", "candidate", "tp", "ab_reviewer"]) {
        const session = await sessionFor(role);
        for (const path of [
          "/audits",
          `/audits/${audit.id}`,
          "/audits/summary",
          "/findings",
          "/content-anomalies",
        ]) {
          expect((await get(session, path)).status, `${role} ${path}`).toBe(403);
        }
        expect((await post(session, "/audits", auditBody())).status, role).toBe(403);
      }
      expect((await request(app).get(`${BASE}/audits`)).status).toBe(401);
      expect((await request(app).get(`${BASE}/audits/summary`)).status).toBe(401);
    });
  });

  describe("audit trail", () => {
    it("writes an audit row, with before and after, for every change", async () => {
      const audit = await newAudit();
      const finding = await newFinding(audit.id);
      await patch(admin, `/findings/${finding.id}`, { status: "closed" });
      await del(admin, `/findings/${finding.id}`);
      await patch(admin, `/audits/${audit.id}`, { status: "closed" });
      await del(admin, `/audits/${audit.id}`);

      const rows = await AuditLog.find({
        entity: { $in: ["securityAudit", "securityFinding"] },
      })
        .sort({ createdAt: 1 })
        .lean();
      expect(rows.map((r) => r.action)).toEqual([
        "securityAudit.create",
        "securityFinding.create",
        "securityFinding.update",
        "securityFinding.archive",
        "securityAudit.update",
        "securityAudit.archive",
      ]);
      for (const row of rows) {
        expect(String(row.actorId)).toBe(admin.userId);
        expect(row.actorRole).toBe("aa_admin");
      }
      const update = rows[2];
      expect(update.before.status).toBe("open");
      expect(update.after.status).toBe("closed");
      expect(update.after.closedDate).toBe(today());
      expect(rows[0].before).toBeUndefined();
      expect(rows[0].after.type).toBe("vapt");
    });

    it("keeps auditor, owner and the weakness description out of the audit rows", async () => {
      const audit = await newAudit();
      const finding = await newFinding(audit.id);
      await patch(admin, `/findings/${finding.id}`, {
        description: "SECRET-WEAKNESS-TEXT changed",
        owner: "Confidential Owner Name",
      });
      await patch(admin, `/audits/${audit.id}`, { auditor: "Confidential Auditor Pvt Ltd" });
      const text = JSON.stringify(await AuditLog.find({}).lean());
      expect(text).not.toContain("Confidential Auditor");
      expect(text).not.toContain("Confidential Owner");
      expect(text).not.toContain("SECRET-WEAKNESS-TEXT");
      expect(text).toContain("[redacted]");
    });

    it("writes no audit row for reads or refused writes", async () => {
      const audit = await newAudit();
      const before = await AuditLog.countDocuments({});
      await get(admin, "/audits");
      await get(admin, `/audits/${audit.id}`);
      await post(mis, "/audits", auditBody());
      await post(admin, "/audits", auditBody({ type: "bad" }));
      expect(await AuditLog.countDocuments({})).toBe(before);
    });
  });
});
