import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Holiday } from "../src/models/holiday.model.js";
import { WorkingDayConfig } from "../src/models/working-day-config.model.js";
import { USER_ROLES, WORKING_DAY_ROLES } from "../src/models/roles.js";
import { acceptDueAt } from "../src/lib/working-days.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const deniedRoles = USER_ROLES.filter((role) => !WORKING_DAY_ROLES.includes(role));

async function sessionFor(role) {
  const email = `${role}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

describe("working-day admin contract", () => {
  beforeAll(async () => {
    await startMongo();
    await Holiday.init();
    await WorkingDayConfig.init();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("lets aa_admin and mis read and write config and holidays, with audit", async () => {
    expect(WORKING_DAY_ROLES).toEqual(["aa_admin", "mis"]);

    const admin = await sessionFor("aa_admin");
    const initial = await request(app)
      .get("/api/v1/admin/working-day-config")
      .set(bearer(admin.token));
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ weekendDays: [6, 0], timezone: "Asia/Kolkata" });

    const saved = await request(app)
      .put("/api/v1/admin/working-day-config")
      .set(bearer(admin.token))
      .send({ weekendDays: [5] });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      id: expect.any(String),
      weekendDays: [5],
      timezone: "Asia/Kolkata",
    });

    const adminAudit = await AuditLog.findOne({
      action: "workingDayConfig.update",
      entityId: saved.body.id,
    }).lean();
    expect(adminAudit.actorId.toString()).toBe(admin.userId);
    expect(adminAudit.actorRole).toBe("aa_admin");
    expect(adminAudit.entity).toBe("workingDayConfig");
    expect(adminAudit.before).toBeUndefined();
    expect(adminAudit.after.weekendDays).toEqual([5]);

    const mis = await sessionFor("mis");
    const updated = await request(app)
      .put("/api/v1/admin/working-day-config")
      .set(bearer(mis.token))
      .send({ weekendDays: [0, 6] });
    expect(updated.status).toBe(200);
    expect(updated.body.weekendDays).toEqual([0, 6]);
    expect(updated.body.id).toBe(saved.body.id);

    const misAudit = await AuditLog.findOne({
      action: "workingDayConfig.update",
      actorRole: "mis",
    }).lean();
    expect(misAudit.before.weekendDays).toEqual([5]);
    expect(misAudit.after.weekendDays).toEqual([0, 6]);
    expect(misAudit.actorId.toString()).toBe(mis.userId);

    const empty = await request(app).get("/api/v1/admin/holidays").set(bearer(mis.token));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [] });

    const created = await request(app)
      .post("/api/v1/admin/holidays")
      .set(bearer(admin.token))
      .send({ date: "2026-10-02", name: "  Gandhi Jayanti  ", region: null });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      date: "2026-10-02",
      name: "Gandhi Jayanti",
      region: null,
    });

    const createAudit = await AuditLog.findOne({
      action: "holiday.create",
      entityId: created.body.id,
    }).lean();
    expect(createAudit.entity).toBe("holiday");
    expect(createAudit.actorRole).toBe("aa_admin");
    expect(createAudit.after).toMatchObject({
      date: "2026-10-02",
      name: "Gandhi Jayanti",
      region: null,
    });

    const removed = await request(app)
      .delete(`/api/v1/admin/holidays/${created.body.id}`)
      .set(bearer(mis.token));
    expect(removed.status).toBe(204);
    expect(await Holiday.countDocuments()).toBe(0);

    const deleteAudit = await AuditLog.findOne({
      action: "holiday.delete",
      entityId: created.body.id,
    }).lean();
    expect(deleteAudit.actorRole).toBe("mis");
    expect(deleteAudit.actorId.toString()).toBe(mis.userId);
    expect(deleteAudit.before).toMatchObject({ date: "2026-10-02", name: "Gandhi Jayanti" });
  });

  it("rejects unauthenticated calls and roles outside the working-day matrix", async () => {
    const paths = [
      () => request(app).get("/api/v1/admin/working-day-config"),
      () =>
        request(app)
          .put("/api/v1/admin/working-day-config")
          .send({ weekendDays: [6, 0] }),
      () => request(app).get("/api/v1/admin/holidays"),
      () =>
        request(app)
          .post("/api/v1/admin/holidays")
          .send({ date: "2026-10-02", name: "Gandhi Jayanti", region: null }),
      () => request(app).delete("/api/v1/admin/holidays/66f0000000000000000000aa"),
    ];

    for (const call of paths) {
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    }
    expect(await AuditLog.countDocuments({ action: /^workingDayConfig|^holiday/ })).toBe(0);

    for (const role of deniedRoles) {
      const { token } = await sessionFor(role);
      const getConfig = await request(app)
        .get("/api/v1/admin/working-day-config")
        .set(bearer(token));
      expect(getConfig.status).toBe(403);
      expect(getConfig.body.error.code).toBe("FORBIDDEN");

      const postHoliday = await request(app)
        .post("/api/v1/admin/holidays")
        .set(bearer(token))
        .send({ date: "2026-10-02", name: "Gandhi Jayanti", region: null });
      expect(postHoliday.status).toBe(403);
      expect(postHoliday.body.error.code).toBe("FORBIDDEN");

      if (role === "sme") {
        const putConfig = await request(app)
          .put("/api/v1/admin/working-day-config")
          .set(bearer(token))
          .send({ weekendDays: [6, 0] });
        expect(putConfig.status).toBe(403);

        const remove = await request(app)
          .delete("/api/v1/admin/holidays/66f0000000000000000000aa")
          .set(bearer(token));
        expect(remove.status).toBe(403);
      }
    }

    expect(await Holiday.countDocuments()).toBe(0);
    expect(await WorkingDayConfig.countDocuments()).toBe(0);
  });

  it("returns validation errors for config, holidays, and list filters", async () => {
    const { token } = await sessionFor("aa_admin");
    const auth = bearer(token);
    const auditsBefore = await AuditLog.countDocuments({
      action: { $in: ["workingDayConfig.update", "holiday.create", "holiday.delete"] },
    });

    const cases = [
      request(app).put("/api/v1/admin/working-day-config").set(auth).send({}),
      request(app)
        .put("/api/v1/admin/working-day-config")
        .set(auth)
        .send({ weekendDays: [6, 6] }),
      request(app)
        .put("/api/v1/admin/working-day-config")
        .set(auth)
        .send({ weekendDays: [0, 1, 2, 3, 4, 5, 6] }),
      request(app)
        .put("/api/v1/admin/working-day-config")
        .set(auth)
        .send({ weekendDays: [7] }),
      request(app)
        .put("/api/v1/admin/working-day-config")
        .set(auth)
        .send({ weekendDays: [6, 0], timezone: "UTC" }),
      request(app).post("/api/v1/admin/holidays").set(auth).send({ date: "2026-02-31", name: "X" }),
      request(app).post("/api/v1/admin/holidays").set(auth).send({ date: "02-10-2026", name: "X" }),
      request(app).post("/api/v1/admin/holidays").set(auth).send({ date: "2026-10-02" }),
      request(app)
        .post("/api/v1/admin/holidays")
        .set(auth)
        .send({ date: "2026-10-02", name: "   " }),
      request(app)
        .post("/api/v1/admin/holidays")
        .set(auth)
        .send({ date: "2026-10-02", name: "Ok", region: 12 }),
      request(app).get("/api/v1/admin/holidays?from=2026-10-03&to=2026-10-01").set(auth),
      request(app).delete("/api/v1/admin/holidays/not-an-id").set(auth),
    ];

    for (const pending of cases) {
      const res = await pending;
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }

    const missing = await request(app)
      .delete("/api/v1/admin/holidays/66f0000000000000000000aa")
      .set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({ code: "NOT_FOUND", message: "Unknown id" });

    expect(
      await AuditLog.countDocuments({
        action: { $in: ["workingDayConfig.update", "holiday.create", "holiday.delete"] },
      }),
    ).toBe(auditsBefore);
  });

  it("rejects a duplicate date and region and lists holidays by date", async () => {
    const { token } = await sessionFor("aa_admin");
    const auth = bearer(token);

    const first = await request(app)
      .post("/api/v1/admin/holidays")
      .set(auth)
      .send({ date: "2026-10-02", name: "Gandhi Jayanti" });
    expect(first.status).toBe(201);
    expect(first.body.region).toBeNull();

    const duplicate = await request(app)
      .post("/api/v1/admin/holidays")
      .set(auth)
      .send({ date: "2026-10-02", name: "Again", region: null });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_RESOURCE");

    const regional = await request(app).post("/api/v1/admin/holidays").set(auth).send({
      date: "2026-10-02",
      name: "State holiday",
      region: " MH ",
    });
    expect(regional.status).toBe(201);
    expect(regional.body.region).toBe("MH");

    const earlier = await request(app)
      .post("/api/v1/admin/holidays")
      .set(auth)
      .send({ date: "2026-01-26", name: "Republic Day", region: null });
    expect(earlier.status).toBe(201);

    const listed = await request(app).get("/api/v1/admin/holidays").set(auth);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item) => item.date)).toEqual([
      "2026-01-26",
      "2026-10-02",
      "2026-10-02",
    ]);

    const ranged = await request(app)
      .get("/api/v1/admin/holidays?from=2026-10-01&to=2026-10-02&region=MH")
      .set(auth);
    expect(ranged.status).toBe(200);
    expect(ranged.body.items).toEqual([
      {
        id: regional.body.id,
        date: "2026-10-02",
        name: "State holiday",
        region: "MH",
      },
    ]);

    expect(await Holiday.countDocuments()).toBe(3);
    expect(await AuditLog.countDocuments({ action: "holiday.create" })).toBe(3);
  });

  it("does not recompute stored batch due instants when holidays or weekends change", async () => {
    const { token } = await sessionFor("aa_admin");
    const auth = bearer(token);
    const acceptDue = new Date("2026-10-08T18:29:59.999Z");
    const assignDue = new Date("2026-11-11T18:29:59.999Z");
    const resultDue = new Date("2026-10-13T18:29:59.999Z");

    await mongoose.connection.collection("batches").insertOne({
      note: "leave-me",
      sla: {
        acceptDueAt: acceptDue,
        assignDueAt: assignDue,
        resultDueAt: resultDue,
        breached: ["accept"],
      },
    });

    const created = await request(app)
      .post("/api/v1/admin/holidays")
      .set(auth)
      .send({ date: "2026-10-07", name: "Extra", region: null });
    expect(created.status).toBe(201);

    const removed = await request(app)
      .delete(`/api/v1/admin/holidays/${created.body.id}`)
      .set(auth);
    expect(removed.status).toBe(204);

    const saved = await request(app)
      .put("/api/v1/admin/working-day-config")
      .set(auth)
      .send({ weekendDays: [5] });
    expect(saved.status).toBe(200);

    const stored = await mongoose.connection.collection("batches").findOne({ note: "leave-me" });
    expect(stored.sla.acceptDueAt.getTime()).toBe(acceptDue.getTime());
    expect(stored.sla.assignDueAt.getTime()).toBe(assignDue.getTime());
    expect(stored.sla.resultDueAt.getTime()).toBe(resultDue.getTime());
    expect(stored.sla.breached).toEqual(["accept"]);
    expect(stored.note).toBe("leave-me");

    const allocatedAt = new Date("2026-10-08T04:30:00.000Z");
    expect((await acceptDueAt(allocatedAt)).toISOString()).toBe("2026-10-11T18:29:59.999Z");
  });
});
