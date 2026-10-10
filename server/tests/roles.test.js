import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { forbidden } from "../src/lib/errors.js";
import { requireRoles } from "../src/middleware/require-roles.js";
import { batchQueryFilter, batchScopeFor, isInBatchScope } from "../src/middleware/scope.js";
import { USER_ROLES } from "../src/models/roles.js";
import { User } from "../src/models/user.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

function runRoleGate(role, allowed) {
  const gate = requireRoles(...allowed);
  const req = { user: { role } };
  let forwarded;
  gate(req, {}, (err) => {
    forwarded = err;
  });
  return forwarded;
}

describe("role middleware and row scope", () => {
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

  it("allows only the roles passed to requireRoles", () => {
    for (const role of USER_ROLES) {
      const allowed = runRoleGate(role, ["aa_admin"]);
      if (role === "aa_admin") {
        expect(allowed).toBeUndefined();
      } else {
        expect(allowed).toMatchObject({ status: 403, code: "FORBIDDEN" });
      }
    }

    expect(runRoleGate("sme", ["sme", "mis"])).toBeUndefined();
    expect(runRoleGate("candidate", ["sme", "mis"])).toMatchObject({ code: "FORBIDDEN" });
    expect(() => requireRoles("not_a_role")).toThrow(/Unknown role/);
  });

  it("builds batch row scope for every role", () => {
    const abId = new mongoose.Types.ObjectId();
    const tpId = new mongoose.Types.ObjectId();
    const assessorId = new mongoose.Types.ObjectId();
    const proctorId = new mongoose.Types.ObjectId();
    const learnerId = new mongoose.Types.ObjectId();
    const batchId = new mongoose.Types.ObjectId();

    expect(batchScopeFor({ role: "aa_admin" }).kind).toBe("all");
    expect(batchScopeFor({ role: "mis" }).kind).toBe("all");
    expect(batchScopeFor({ role: "ncvet_viewer" }).kind).toBe("all");
    expect(batchQueryFilter({ role: "mis" })).toEqual({});

    expect(batchScopeFor({ role: "sme" })).toEqual({ kind: "none" });
    expect(batchQueryFilter({ role: "sme" })).toEqual({ _id: { $in: [] } });

    const reviewer = { role: "ab_reviewer", abId };
    expect(batchQueryFilter(reviewer)).toEqual({ abId });
    expect(isInBatchScope(reviewer, { abId })).toBe(true);
    expect(isInBatchScope(reviewer, { abId: new mongoose.Types.ObjectId() })).toBe(false);
    expect(batchQueryFilter({ role: "ab_reviewer", abId: null })).toEqual({ _id: { $in: [] } });

    const tp = { role: "tp", tpId };
    expect(batchQueryFilter(tp)).toEqual({ tpId });
    expect(isInBatchScope(tp, { tpId })).toBe(true);

    const assessor = { role: "assessor", linkedProfileId: assessorId };
    expect(batchQueryFilter(assessor)).toEqual({ assessorId });
    expect(isInBatchScope(assessor, { assessorId })).toBe(true);
    expect(isInBatchScope(assessor, { assessorId: proctorId })).toBe(false);

    const proctor = { role: "proctor", linkedProfileId: proctorId };
    expect(batchQueryFilter(proctor)).toEqual({ proctorId });
    expect(isInBatchScope(proctor, { proctorId })).toBe(true);

    const candidate = { role: "candidate", linkedProfileId: learnerId };
    expect(batchScopeFor(candidate)).toEqual({ kind: "learner", learnerId });
    expect(batchQueryFilter(candidate, { candidateBatchIds: [batchId] })).toEqual({
      _id: { $in: [batchId] },
    });
    expect(isInBatchScope(candidate, { _id: batchId }, { learnerIds: [learnerId] })).toBe(true);
    expect(isInBatchScope(candidate, { _id: batchId }, { learnerIds: [] })).toBe(false);
  });

  it("rejects missing, invalid, and inactive tokens", async () => {
    const { user, password } = await createUser({
      email: "admin@aa.example",
      password: "Correct-Horse-9",
    });

    const missing = await request(app).get("/api/v1/audit-logs");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHORIZED");

    const bad = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", "Bearer not-a-token");
    expect(bad.status).toBe(401);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@aa.example",
      password,
      device: webDevice,
    });
    await User.updateOne({ _id: user._id }, { active: false });
    const inactive = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(inactive.status).toBe(401);
  });

  it("uses the database role, not a role claim on the access token", async () => {
    const { user } = await createUser({
      email: "sme@aa.example",
      role: "sme",
      name: "SME",
      password: "Correct-Horse-9",
    });
    const forged = jwt.sign({ sub: user._id.toString(), role: "aa_admin" }, env.JWT_ACCESS_SECRET, {
      algorithm: "HS256",
      expiresIn: 60,
    });

    const res = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(forbidden().code).toBe("FORBIDDEN");
  });

  it("denies audit reads for roles without audit access", async () => {
    const denied = ["sme", "assessor", "proctor", "candidate", "tp"];
    for (const role of denied) {
      const { password } = await createUser({
        email: `${role}@aa.example`,
        role,
        name: role,
        password: "Correct-Horse-9",
      });
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: `${role}@aa.example`, password, device: webDevice });
      expect(login.status).toBe(200);
      const res = await request(app)
        .get("/api/v1/audit-logs")
        .set("Authorization", `Bearer ${login.body.accessToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });
});
