import request from "supertest";
import {
  API,
  CAPTURED_AT,
  GHOST_ID,
  addRoster,
  app,
  auditRows,
  bearer,
  bootE2e,
  call,
  createBatch,
  createLearners,
  createProctor,
  expectError,
  expectStatus,
  get,
  loginEventBody,
  makeAssessor,
  makeWorld,
  oid,
  patch,
  post,
  resetE2e,
  sessionFor,
  shutdownE2e,
} from "./helpers/e2e.js";

/**
 * T-01 flow 8. Roles matrix for every Phase 1 route.
 * The allowed roles come from docs/SCHEMA.md §5 (Permission matrix), with the contract's own
 * role lists for routes that §5 does not name. For each route:
 *   - no token, a bad token, and a non-Bearer header are 401 UNAUTHORIZED;
 *   - every role that §5 marks D is 403 FORBIDDEN;
 *   - every allowed role gets past the role gate (never 401, never a server error).
 * Calls use an id that matches nothing and an empty body, so an allowed role gets 400 or 404 and
 * nothing is written.
 *
 * Where SCHEMA §5 and the routes disagree on purpose, the pair is listed in DECIDED (a human
 * decision in DECISIONS.md changed the matrix) or in OPEN_CONFLICTS (the routes follow a proposal
 * that is still an open question). Open conflicts are registered as todo so they show in every run.
 */
const ROLES = [
  "aa_admin",
  "mis",
  "sme",
  "assessor",
  "proctor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
];
const ADMINS = ["aa_admin", "mis"];
const BATCH_READERS = ROLES.filter((role) => role !== "sme");
const ID = GHOST_ID;

/**
 * @param {string} method
 * @param {string} path
 * @param {string[]} allowed roles that may use the route (SCHEMA §5)
 * @param {{ source?: string, decided?: Record<string, string>, conflicts?: Record<string, string>, scoped?: boolean }} [extra]
 *   decided: role allowed by a recorded decision although §5 says D.
 *   conflicts: role the routes allow although §5 says D, with the open question behind it.
 *   scoped: a row-scope check may answer 403 to an allowed role.
 */
function route(method, path, allowed, extra = {}) {
  return { method, path, allowed, ...extra };
}

const SECTION5 = {
  users: "§5 Users CRUD / password reset",
  master: "§5 Learners / master data CRUD",
  batch: "§5 Batch create / list / get",
  action: "§5 Accept/reject/assign/reassign/cancel/complete/reassess",
};

const Q50 =
  "Q50/Q63 (open): master-data reads are scoped per role by B-07a; §5 marks this role D or R";

const ROUTES = [
  // Users
  route("post", "/users", ADMINS, { source: SECTION5.users }),
  route("get", "/users", ADMINS, { source: SECTION5.users }),
  route("get", `/users/${ID}`, ADMINS, { source: SECTION5.users }),
  route("patch", `/users/${ID}`, ADMINS, { source: SECTION5.users }),
  route("post", `/users/${ID}/password-reset`, ADMINS, { source: SECTION5.users }),

  // Master data writes: aa_admin and mis only
  ...[
    "awarding-bodies",
    "training-partners",
    "centres",
    "qualifications",
    "assessors",
    "proctors",
  ].flatMap((name) => [
    route("post", `/${name}`, ADMINS, { source: SECTION5.master }),
    route("patch", `/${name}/${ID}`, ADMINS, { source: SECTION5.master }),
    route("delete", `/${name}/${ID}`, ADMINS, { source: SECTION5.master }),
  ]),
  route("post", "/learners", ADMINS, { source: SECTION5.master }),
  route("patch", `/learners/${ID}`, ADMINS, { source: SECTION5.master }),

  // Master data reads: §5 gives aa_admin and mis A, ab_reviewer and ncvet_viewer R, the rest D.
  route("get", "/awarding-bodies", ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
  }),
  route("get", `/awarding-bodies/${ID}`, ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
    scoped: true,
  }),
  route("get", "/qualifications", ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
  }),
  route("get", `/qualifications/${ID}`, ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
  }),
  ...["training-partners", "centres"].flatMap((name) => [
    route("get", `/${name}`, ["aa_admin", "mis", "ncvet_viewer"], {
      source: SECTION5.master,
      conflicts: { tp: Q50, ab_reviewer: `${Q50} (§5 R, routes 403)` },
      scoped: true,
    }),
    route("get", `/${name}/${ID}`, ["aa_admin", "mis", "ncvet_viewer"], {
      source: SECTION5.master,
      conflicts: { tp: Q50, ab_reviewer: `${Q50} (§5 R, routes 403)` },
      scoped: true,
    }),
  ]),
  route("get", "/learners", ["aa_admin", "mis", "ncvet_viewer"], {
    source: SECTION5.master,
    conflicts: { candidate: Q50, ab_reviewer: `${Q50} (§5 R, routes 403)` },
    scoped: true,
  }),
  route("get", `/learners/${ID}`, ["aa_admin", "mis", "ncvet_viewer"], {
    source: SECTION5.master,
    conflicts: { candidate: Q50, ab_reviewer: `${Q50} (§5 R, routes 403)` },
    scoped: true,
  }),
  route("get", "/assessors", ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
    conflicts: { assessor: `${Q50}: an assessor reads their own record` },
    scoped: true,
  }),
  route("get", `/assessors/${ID}`, ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
    conflicts: { assessor: `${Q50}: an assessor reads their own record` },
    scoped: true,
  }),
  route("get", "/assessors/available", ["aa_admin", "mis", "ncvet_viewer"], {
    source: "roles.js ASSESSOR_AVAILABLE_ROLES (assigners and monitoring)",
    conflicts: { ab_reviewer: `${Q50} (§5 R, routes 403)` },
  }),
  route("get", "/proctors", ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
    conflicts: { proctor: `${Q50}: a proctor reads their own record` },
    scoped: true,
  }),
  route("get", `/proctors/${ID}`, ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: SECTION5.master,
    conflicts: { proctor: `${Q50}: a proctor reads their own record` },
    scoped: true,
  }),

  // Batches
  route("post", "/batches", ["aa_admin", "ab_reviewer"], { source: SECTION5.batch, scoped: true }),
  route("get", "/batches", BATCH_READERS, { source: SECTION5.batch }),
  route("get", `/batches/${ID}`, BATCH_READERS, { source: SECTION5.batch }),
  route("get", `/batches/${ID}/login-events`, BATCH_READERS, { source: SECTION5.batch }),
  route("get", `/batches/${ID}/attendance`, BATCH_READERS, { source: SECTION5.batch }),
  route("get", `/batches/${ID}/checklist`, BATCH_READERS, { source: SECTION5.batch }),
  route("get", "/compliance/dashboard", BATCH_READERS, {
    source: "API_CONTRACT Compliance stubs; same readers as the batch list",
  }),
  ...["accept", "reject", "assign", "reassign", "cancel", "complete"].map((action) =>
    route("post", `/batches/${ID}/${action}`, ["aa_admin"], { source: SECTION5.action }),
  ),
  route("post", `/batches/${ID}/reassessments`, ["aa_admin", "ab_reviewer"], {
    source: SECTION5.action,
    decided: { ab_reviewer: "Q22, decided 2026-10-13: the batch's own awarding body may reassess" },
    scoped: true,
  }),
  route("post", `/batches/${ID}/submit-result`, ["aa_admin"], {
    source: "§5 Submit result",
  }),
  route("post", `/batches/${ID}/validate`, ["ab_reviewer"], {
    source: "§5 Validate / publish",
    scoped: true,
  }),
  route("post", `/batches/${ID}/publish`, ["ab_reviewer"], {
    source: "§5 Validate / publish",
    scoped: true,
  }),
  route("post", `/batches/${ID}/return-for-correction`, ["ab_reviewer"], {
    source: "API_CONTRACT B-05b; Q130 (2026-10-12): only the awarding body reviewer returns",
    scoped: true,
  }),

  // Candidates
  route("post", `/batches/${ID}/candidates`, ADMINS, { source: "§5 Candidates CUD / CSV" }),
  route("post", `/batches/${ID}/candidates/import`, ADMINS, { source: "§5 Candidates CUD / CSV" }),
  route("patch", `/batches/${ID}/candidates/${ID}`, ADMINS, { source: "§5 Candidates CUD / CSV" }),
  route(
    "get",
    `/batches/${ID}/candidates`,
    ["aa_admin", "mis", "assessor", "tp", "ab_reviewer", "ncvet_viewer"],
    {
      source: "§5 Candidates (R)",
      decided: { candidate: "Q70 (resolved, B-07b): a candidate reads their own roster row" },
      scoped: true,
    },
  ),

  // Results
  route("put", `/batches/${ID}/results`, ["aa_admin"], { source: "§5 Results PUT" }),
  route(
    "get",
    `/batches/${ID}/results`,
    ["aa_admin", "mis", "assessor", "candidate", "tp", "ab_reviewer", "ncvet_viewer"],
    { source: "§5 Results read", scoped: true },
  ),
  route("get", `/results/${ID}/change-log`, ["aa_admin", "ab_reviewer", "mis"], {
    source: "API_CONTRACT GET /results/:id/change-log",
    scoped: true,
  }),

  // Learner feedback and assessor payments (B-10, B-11)
  route("put", `/batches/${ID}/learner-feedback`, ADMINS, { source: "§5 Learner feedback write" }),
  route(
    "get",
    `/batches/${ID}/learner-feedback`,
    ["aa_admin", "mis", "assessor", "proctor", "ab_reviewer", "ncvet_viewer"],
    { source: "API_CONTRACT GET /batches/:id/learner-feedback", scoped: true },
  ),
  route("put", `/batches/${ID}/assessor-payment`, ADMINS, {
    source: "§5 Assessor payment read/write",
  }),
  route("get", "/assessor-payments", ["aa_admin", "mis", "ncvet_viewer", "assessor"], {
    source: "§5 Assessor payment read/write",
  }),
  route(
    "get",
    `/batches/${ID}/assessor-payments`,
    ["aa_admin", "mis", "ncvet_viewer", "assessor"],
    {
      source: "§5 Assessor payment read/write",
      scoped: true,
    },
  ),

  // Assessor field app
  route("post", "/assessor/login-event", ["assessor"], { source: "§5 Login-event write" }),
  route("post", "/proctor/login-event", ["proctor"], { source: "§5 Login-event write" }),
  route("post", "/student/login-event", ["candidate"], {
    source: "§5 Login-event write (D†) and API_CONTRACT: student path is for candidate",
  }),
  route("post", `/assessor/batches/${ID}/attendance`, ["assessor"], {
    source: "§5 Attendance / checklist write",
  }),
  route("post", `/assessor/batches/${ID}/checklist`, ["assessor"], {
    source: "§5 Attendance / checklist write",
  }),

  // Audit, working days, recognition
  route("get", "/audit-logs", ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"], {
    source: "§5 Audit read",
  }),
  route("get", "/admin/working-day-config", ADMINS, { source: "§5 Holidays / working-day" }),
  route("put", "/admin/working-day-config", ADMINS, { source: "§5 Holidays / working-day" }),
  route("get", "/admin/holidays", ADMINS, { source: "§5 Holidays / working-day" }),
  route("post", "/admin/holidays", ADMINS, { source: "§5 Holidays / working-day" }),
  route("delete", `/admin/holidays/${ID}`, ADMINS, { source: "§5 Holidays / working-day" }),
  route("get", "/admin/recognition", ["aa_admin", "mis", "ncvet_viewer"], {
    source: "§5 Recognition GET/PUT",
  }),
  route("put", "/admin/recognition", ADMINS, { source: "§5 Recognition GET/PUT" }),
];

describe("e2e: roles matrix", () => {
  let sessions;

  // The calls below never write, so one set of sessions serves the whole file. A fresh set per test
  // would cost nine bcrypt hashes and logins each time.
  beforeAll(async () => {
    await bootE2e();
    await resetE2e();
    sessions = {};
    for (const role of ROLES) {
      sessions[role] = await sessionFor(role, {
        linkedProfileId: ["assessor", "proctor", "candidate"].includes(role) ? oid() : undefined,
        abId: role === "ab_reviewer" ? oid() : undefined,
        tpId: role === "tp" ? oid() : undefined,
      });
    }
  });
  afterAll(shutdownE2e);

  it("covers every role in SCHEMA §5 and no role twice", () => {
    expect(new Set(ROLES).size).toBe(ROLES.length);
    expect(ROLES).toHaveLength(9);
    for (const entry of ROUTES) {
      for (const role of entry.allowed) expect(ROLES, `${entry.path} role`).toContain(role);
    }
  });

  describe("401 without a valid access token", () => {
    it.each(ROUTES.map((entry) => [`${entry.method.toUpperCase()} ${entry.path}`, entry]))(
      "%s",
      async (_label, entry) => {
        const none = await call(entry.method, entry.path, undefined, {});
        expect(none.status, "no header").toBe(401);
        expect(none.body.error.code).toBe("UNAUTHORIZED");

        const garbage = await call(entry.method, entry.path, "not-a-token", {});
        expect(garbage.status, "garbage token").toBe(401);

        const wrongScheme = await request(app)
          [entry.method](`${API}${entry.path}`)
          .set("Authorization", `Basic ${sessions.aa_admin.token}`);
        expect(wrongScheme.status, "Basic scheme").toBe(401);
      },
    );

    it("rejects the token of a user who was deactivated after signing in", async () => {
      const victim = await sessionFor("mis", { email: "victim@aa.example" });
      const before = await call("get", "/batches", victim.token);
      expect(before.status).toBe(200);
      const off = await patch(sessions.aa_admin.token, `/users/${victim.userId}`, {
        active: false,
      });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const after = await call("get", "/batches", victim.token);
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("role gate", () => {
    it.each(ROUTES.map((entry) => [`${entry.method.toUpperCase()} ${entry.path}`, entry]))(
      "%s",
      async (_label, entry) => {
        for (const role of ROLES) {
          const res = await call(entry.method, entry.path, sessions[role].token, {});
          const where = `${role} on ${entry.method.toUpperCase()} ${entry.path} (${entry.source ?? "§5"})`;
          const allowed =
            entry.allowed.includes(role) ||
            Boolean(entry.decided?.[role]) ||
            Boolean(entry.conflicts?.[role]);
          if (entry.conflicts?.[role]) continue; // asserted nowhere: see the todo list below
          if (!allowed) {
            expect(res.status, where).toBe(403);
            expect(res.body.error.code, where).toBe("FORBIDDEN");
          } else {
            expect(res.status, `${where} must get past the role gate`).not.toBe(401);
            expect(res.status, `${where} must not crash`).toBeLessThan(500);
            if (!entry.scoped) expect(res.status, `${where} must not be 403`).not.toBe(403);
          }
        }
      },
    );
  });

  it("does not mount the deferred dispute routes for anyone", async () => {
    for (const action of ["dispute", "resolve-dispute"]) {
      for (const role of ["aa_admin", "ab_reviewer"]) {
        const res = await call("post", `/batches/${ID}/${action}`, sessions[role].token, {
          reason: "x",
        });
        expect(res.status, `${role} ${action}`).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("lets any signed-in role use the auth routes for its own session", async () => {
    for (const role of ROLES) {
      const res = await call("post", "/auth/change-password", sessions[role].token, {});
      expect(res.status, role).toBe(400);
      expect(res.body.error.code, role).toBe("VALIDATION_ERROR");
    }
    const noToken = await call("post", "/auth/change-password", undefined, {});
    expect(noToken.status).toBe(401);
    // Logout is open: it takes a refresh token, not an access token, and always answers 204.
    expect((await call("post", "/auth/logout", undefined, {})).status).toBe(204);
    expect((await request(app).get(`${API}/health`).set(bearer("x"))).status).toBe(200);
  });

  // §5 says D (or R) for these role and route pairs, the routes do the opposite, and the
  // DECISIONS.md open questions that would settle it are not answered yet. Not a regression.
  for (const entry of ROUTES) {
    for (const [role, why] of Object.entries(entry.conflicts ?? {})) {
      it.todo(`OPEN CONFLICT ${role} ${entry.method.toUpperCase()} ${entry.path}: ${why}`);
    }
  }
});

/**
 * Row scope (SCHEMA §5, "Batch row scope"): aa_admin, mis and ncvet_viewer see every batch;
 * ab_reviewer sees their abId, tp their tpId, assessor and proctor their own assignment, and
 * candidate the batches whose roster holds their learner. Audit reads follow the same split.
 */
describe("e2e: roles matrix, row scope", () => {
  let world;
  let batchA;
  let batchB;
  let s;

  beforeAll(async () => {
    await bootE2e();
    await resetE2e();
    world = await makeWorld();
    const [l1, l2, l3] = await createLearners(world, 3);
    const proctorA = await createProctor(world);
    const proctorB = await createProctor(world);
    const x = await makeAssessor(world);
    const y = await makeAssessor(world);

    batchA = await createBatch(world, { candidateCount: 2 });
    await addRoster(world, batchA.id, [l1, l2]);
    batchB = await createBatch(world, {
      abId: world.otherAb.id,
      tpId: world.otherTp.id,
      centreId: world.otherTpCentre.id,
      candidateCount: 1,
    });
    await addRoster(world, batchB.id, [l3]);
    for (const [batch, assessor, proctor] of [
      [batchA, x.assessor, proctorA],
      [batchB, y.assessor, proctorB],
    ]) {
      expectStatus(await post(world.admin.token, `/batches/${batch.id}/accept`), 200);
      expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/assign`, {
          assessorId: assessor.id,
          proctorId: proctor.id,
        }),
        200,
      );
    }
    s = {
      mis: await sessionFor("mis"),
      ncvet_viewer: await sessionFor("ncvet_viewer"),
      reviewerA: world.reviewer,
      reviewerB: world.otherReviewer,
      tpA: await sessionFor("tp", { email: "tpa@aa.example", tpId: world.tp.id }),
      tpB: await sessionFor("tp", { email: "tpb@aa.example", tpId: world.otherTp.id }),
      assessorA: x.session,
      assessorB: y.session,
      proctorA: await sessionFor("proctor", {
        email: "pa@aa.example",
        linkedProfileId: proctorA.id,
      }),
      proctorB: await sessionFor("proctor", {
        email: "pb@aa.example",
        linkedProfileId: proctorB.id,
      }),
      candidateA: await sessionFor("candidate", { email: "ca@aa.example", linkedProfileId: l1.id }),
      candidateB: await sessionFor("candidate", { email: "cb@aa.example", linkedProfileId: l3.id }),
      sme: await sessionFor("sme"),
    };
    // One login on batch A so there is an event, an audit trail and a status change to read.
    expectStatus(
      await post(s.assessorA.token, "/assessor/login-event", loginEventBody(batchA.id)),
      200,
    );
  });
  afterAll(shutdownE2e);

  const idsOf = (body) => body.items.map((item) => item.id).sort();

  it("lists only the batches in scope", async () => {
    const both = [batchA.id, batchB.id].sort();
    const expected = {
      admin: both,
      mis: both,
      ncvet_viewer: both,
      reviewerA: [batchA.id],
      reviewerB: [batchB.id],
      tpA: [batchA.id],
      tpB: [batchB.id],
      assessorA: [batchA.id],
      assessorB: [batchB.id],
      proctorA: [batchA.id],
      proctorB: [batchB.id],
      candidateA: [batchA.id],
      candidateB: [batchB.id],
    };
    const sessions = { ...s, admin: world.admin };
    for (const [who, ids] of Object.entries(expected)) {
      const res = expectStatus(await get(sessions[who].token, "/batches"), 200);
      expect(idsOf(res), who).toEqual(ids);
      expect(res.total, who).toBe(ids.length);
    }
    expectError(await get(s.sme.token, "/batches"), 403, "FORBIDDEN");
    // The dashboard counts the same rows.
    const dash = expectStatus(await get(s.tpA.token, "/compliance/dashboard"), 200);
    expect(Object.values(dash.statusCounts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("answers 403 for a batch outside the caller's scope, 404 for one that does not exist", async () => {
    const outside = [
      ["reviewerA", batchB],
      ["reviewerB", batchA],
      ["tpA", batchB],
      ["tpB", batchA],
      ["assessorA", batchB],
      ["assessorB", batchA],
      ["proctorA", batchB],
      ["proctorB", batchA],
      ["candidateA", batchB],
      ["candidateB", batchA],
    ];
    const children = ["", "/login-events", "/attendance", "/checklist"];
    for (const [who, batch] of outside) {
      for (const child of children) {
        const res = await get(s[who].token, `/batches/${batch.id}${child}`);
        expect(res.status, `${who} ${child || "batch"}`).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      }
      const own = batch === batchA ? batchB : batchA;
      expect((await get(s[who].token, `/batches/${own.id}`)).status, `${who} own`).toBe(200);
      expectError(await get(s[who].token, `/batches/${GHOST_ID}`), 404, "NOT_FOUND");
    }
    // Roster, results, feedback and payments follow the same rule where the role may call them.
    expectError(await get(s.tpA.token, `/batches/${batchB.id}/candidates`), 403, "FORBIDDEN");
    expectError(await get(s.tpA.token, `/batches/${batchB.id}/results`), 403, "FORBIDDEN");
    expectError(
      await get(s.reviewerA.token, `/batches/${batchB.id}/learner-feedback`),
      403,
      "FORBIDDEN",
    );
    expectError(
      await get(s.assessorA.token, `/batches/${batchB.id}/learner-feedback`),
      403,
      "FORBIDDEN",
    );
    // An assessor's payment list is filtered to their own rows, so another batch gives an empty page.
    const payments = expectStatus(
      await get(s.assessorA.token, `/batches/${batchB.id}/assessor-payments`),
      200,
    );
    expect(payments).toMatchObject({ total: 0, items: [] });
    // A candidate sees only their own roster row.
    const roster = expectStatus(
      await get(s.candidateA.token, `/batches/${batchA.id}/candidates`),
      200,
    );
    expect(roster.items).toHaveLength(1);
    const full = expectStatus(await get(s.tpA.token, `/batches/${batchA.id}/candidates`), 200);
    expect(full.items).toHaveLength(2);
    const events = expectStatus(
      await get(s.assessorA.token, `/batches/${batchA.id}/login-events`),
      200,
    );
    expect(events.items).toHaveLength(1);
  });

  it("refuses writes on a batch that belongs to someone else", async () => {
    const refused = [
      ["reviewerB validates A", s.reviewerB, `/batches/${batchA.id}/validate`, {}],
      ["reviewerB publishes A", s.reviewerB, `/batches/${batchA.id}/publish`, {}],
      [
        "reviewerB returns A",
        s.reviewerB,
        `/batches/${batchA.id}/return-for-correction`,
        { reason: "Not mine" },
      ],
      [
        "reviewerB reassesses A",
        s.reviewerB,
        `/batches/${batchA.id}/reassessments`,
        { assessmentStartDate: "2099-07-01", assessmentEndDate: "2099-07-01" },
      ],
      ["assessorB logs in on A", s.assessorB, "/assessor/login-event", loginEventBody(batchA.id)],
      [
        "assessorB records attendance on A",
        s.assessorB,
        `/assessor/batches/${batchA.id}/attendance`,
        { capturedAt: CAPTURED_AT, records: [{ candidateId: GHOST_ID, present: true }] },
      ],
      [
        "assessorB sends a checklist for A",
        s.assessorB,
        `/assessor/batches/${batchA.id}/checklist`,
        {
          clientEventId: "evt-scope-1",
          capturedAt: CAPTURED_AT,
          items: [{ key: "multimeter", available: true }],
        },
      ],
      [
        "proctorB logs in on A",
        s.proctorB,
        "/proctor/login-event",
        loginEventBody(batchA.id, { clientEventId: "evt-scope-2" }),
      ],
      [
        "candidateB logs in on A",
        s.candidateB,
        "/student/login-event",
        loginEventBody(batchA.id, { clientEventId: "evt-scope-3" }),
      ],
    ];
    for (const [label, session, path, body] of refused) {
      const res = await post(session.token, path, body);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.error.code, label).toBe("FORBIDDEN");
    }
    expect((await get(world.admin.token, `/batches/${batchA.id}`)).body).toMatchObject({
      status: "in_progress",
      statusVersion: 4,
    });
  });

  it("limits audit reads to the reviewer's own awarding body and gives monitoring roles all of it", async () => {
    const all = expectStatus(await get(world.admin.token, "/audit-logs"), 200);
    const viaMis = expectStatus(await get(s.mis.token, "/audit-logs"), 200);
    const viaNcvet = expectStatus(await get(s.ncvet_viewer.token, "/audit-logs"), 200);
    expect(viaMis.total).toBe(all.total);
    expect(viaNcvet.total).toBe(all.total);

    const rowsOfB = expectStatus(
      await get(world.admin.token, "/audit-logs", { entity: "batch", entityId: batchB.id }),
      200,
    );
    expect(rowsOfB.total).toBeGreaterThan(0);

    const reviewerA = expectStatus(await get(s.reviewerA.token, "/audit-logs"), 200);
    expect(reviewerA.total).toBeGreaterThan(0);
    expect(reviewerA.total).toBeLessThan(all.total);
    for (const item of reviewerA.items) {
      const mine = [item.abId, item.batchId].some((id) => id === world.ab.id || id === batchA.id);
      expect(mine, item.action).toBe(true);
      expect(item.batchId).not.toBe(batchB.id);
      expect(item.abId).not.toBe(world.otherAb.id);
    }
    const peek = expectStatus(
      await get(s.reviewerA.token, "/audit-logs", { entity: "batch", entityId: batchB.id }),
      200,
    );
    expect(peek.total).toBe(0);
    const rowsOfA = expectStatus(
      await get(s.reviewerA.token, "/audit-logs", { entity: "batch", entityId: batchA.id }),
      200,
    );
    expect(rowsOfA.total).toBeGreaterThan(0);

    // A reviewer without an abId sees nothing at all.
    const lost = await sessionFor("ab_reviewer", { email: "lost@aa.example" });
    expect(expectStatus(await get(lost.token, "/audit-logs"), 200).total).toBe(0);
    for (const who of ["tpA", "assessorA", "proctorA", "candidateA", "sme"]) {
      expectError(await get(s[who].token, "/audit-logs"), 403, "FORBIDDEN");
    }
    expect((await auditRows()).length).toBeGreaterThanOrEqual(all.total);
  });

  it("does not leak the other awarding body's rows on any page", async () => {
    let page = 1;
    let seen = 0;
    for (;;) {
      const res = expectStatus(await get(s.reviewerB.token, "/audit-logs", { page }), 200);
      for (const item of res.items) {
        expect(item.batchId).not.toBe(batchA.id);
        expect(item.abId).not.toBe(world.ab.id);
      }
      seen += res.items.length;
      if (seen >= res.total || res.items.length === 0) break;
      page += 1;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
