import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { AuditLog } from "../../src/models/audit-log.model.js";
import { resetLoginRateLimit } from "../../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./db.js";
import { createUser, webDevice } from "./fixtures.js";

/**
 * Shared pieces for the e2e-*.test.js scenario files (T-01).
 * Everything goes through the HTTP API. The only direct database writes are
 * test levers that the API has no call for (moving a due instant into the past,
 * setting a `publishedAt`) and reads that check what was stored.
 */

export const app = createApp();
export const API = "/api/v1";

/** A well-formed id that matches no document. */
export const GHOST_ID = "000000000000000000000001";

export const oid = () => String(new mongoose.Types.ObjectId());

export const fieldDevice = { deviceId: "dev-field-1", platform: "android", appVersion: "1.0.0" };

/** Assessment window used by most scenarios. Far ahead, so recognition and ToA dates always cover it. */
export const WINDOW = Object.freeze({ start: "2099-06-15", end: "2099-06-16" });
/** 10:30 IST on the first assessment day. */
export const CAPTURED_AT = "2099-06-15T05:00:00.000Z";
/** 15:00 IST on the second assessment day. */
export const CAPTURED_LATER_AT = "2099-06-16T09:30:00.000Z";

export function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

export function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error?.code, JSON.stringify(res.body)).toBe(code);
}

export function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}

/**
 * One request. `body` is sent for write methods; for `get`, `body` is the query.
 * @param {"get"|"post"|"put"|"patch"|"delete"} method
 */
export function call(method, path, token, body) {
  let req = request(app)[method](`${API}${path}`);
  if (token) req = req.set(bearer(token));
  if (body !== undefined) req = method === "get" ? req.query(body) : req.send(body);
  return req;
}

/** Roster import as a plain CSV body. */
export function postCsv(token, path, text) {
  return request(app)
    .post(`${API}${path}`)
    .set(bearer(token))
    .set("Content-Type", "text/csv")
    .send(text);
}

export const get = (token, path, query) => call("get", path, token, query);
export const post = (token, path, body = {}) => call("post", path, token, body);
export const put = (token, path, body = {}) => call("put", path, token, body);
export const patch = (token, path, body = {}) => call("patch", path, token, body);
export const del = (token, path) => call("delete", path, token);

/** Mongo + indexes once per file. Unique indexes matter: locks and rosters rely on them. */
export async function bootE2e() {
  await startMongo();
  await mongoose.syncIndexes();
}

export async function shutdownE2e() {
  await stopMongo();
}

export async function resetE2e() {
  await clearCollections();
  resetLoginRateLimit();
  idCounter = 0;
}

let idCounter = 0;
export function nextId(prefix = "id") {
  idCounter += 1;
  return `${prefix}-${String(idCounter).padStart(4, "0")}`;
}

/**
 * Create a user in the database and sign in through the API.
 * @param {string} role
 * @param {{ email?: string, name?: string, password?: string, linkedProfileId?: unknown, abId?: unknown, tpId?: unknown, mustChangePassword?: boolean, device?: object }} [extra]
 */
export async function sessionFor(role, extra = {}) {
  const email = extra.email ?? `${role}@aa.example`;
  const { password } = await createUser({
    role,
    email,
    name: extra.name ?? role,
    password: extra.password,
    linkedProfileId: extra.linkedProfileId,
    abId: extra.abId,
    tpId: extra.tpId,
    mustChangePassword: extra.mustChangePassword,
  });
  const device = extra.device ?? webDevice;
  const res = await request(app).post(`${API}/auth/login`).send({ email, password, device });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return {
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
    user: res.body.user,
    email,
    password,
    device,
  };
}

/** Every credential a session holds, for "no secret in an audit row" checks. */
export function secretsOf(...sessions) {
  return sessions.flatMap((s) => [s.token, s.refreshToken, s.password]).filter(Boolean);
}

// ---- Independent working-day oracle -------------------------------------------------------
// Written from SCHEMA §2.1 without importing the application's calendar code, so a test
// compares the API with the written rule rather than with itself.

const IST_OFFSET_MS = 5.5 * 3600_000;

export function istDateOf(instant) {
  return new Date(new Date(instant).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftCivil(civil, days) {
  const [y, m, d] = civil.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isWorkingCivil(civil, holidays, weekend) {
  const [y, m, d] = civil.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return !weekend.includes(dow) && !holidays.includes(civil);
}

function endOfIstDay(civil) {
  return new Date(
    Date.parse(`${civil}T00:00:00.000Z`) + 86_400_000 - 1 - IST_OFFSET_MS,
  ).toISOString();
}

/**
 * End of IST day `n` working days after the anchor's IST date (anchor is not day 1).
 * @param {string|Date} anchor `YYYY-MM-DD` or an instant
 */
export function dueAfter(anchor, n, { holidays = [], weekend = [0, 6] } = {}) {
  let cursor = /^\d{4}-\d{2}-\d{2}$/.test(String(anchor)) ? anchor : istDateOf(anchor);
  for (let seen = 0; seen < n;) {
    cursor = shiftCivil(cursor, 1);
    if (isWorkingCivil(cursor, holidays, weekend)) seen += 1;
  }
  return endOfIstDay(cursor);
}

/** End of IST day `n` working days before the anchor date (anchor is exclusive). */
export function dueBefore(anchor, n, { holidays = [], weekend = [0, 6] } = {}) {
  let cursor = anchor;
  for (let seen = 0; seen < n;) {
    cursor = shiftCivil(cursor, -1);
    if (isWorkingCivil(cursor, holidays, weekend)) seen += 1;
  }
  return endOfIstDay(cursor);
}

/**
 * Run `fn` with `Date` frozen at `iso`. Only `Date` is faked, so timers and sockets still work.
 * Sign in inside `fn` as well: a token minted at another clock may look expired.
 */
export async function withFrozenDate(iso, fn) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

// ---- Master data through the API ----------------------------------------------------------

export const NOS_IDS = Object.freeze(["NOS-01", "NOS-02"]);

export function qualificationBody(overrides = {}) {
  return {
    code: "Q-ELEC-L4",
    name: "Electrician L4",
    sector: "Electronics",
    ratioClass: "manufacturing",
    passCriteriaMode: "nos_wise",
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    maxMarks: null,
    nos: [
      { nosId: "NOS-01", code: "N01", name: "Safety", pcs: [] },
      { nosId: "NOS-02", code: "N02", name: "Wiring", pcs: [] },
    ],
    ...overrides,
  };
}

async function created(res) {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/**
 * An AA with every master record a batch needs, plus an `aa_admin` and the `ab_reviewer`
 * of the main awarding body, all created through the API.
 * @param {{ qualification?: object, recognition?: object|false, abEmails?: string[] }} [options]
 */
export async function makeWorld(options = {}) {
  const admin = await sessionFor("aa_admin");
  const ab = await created(
    await post(admin.token, "/awarding-bodies", {
      name: "AB One",
      code: "AB-01",
      notificationEmails: options.abEmails ?? ["one@ab.example", "two@ab.example"],
    }),
  );
  const otherAb = await created(
    await post(admin.token, "/awarding-bodies", {
      name: "AB Two",
      code: "AB-02",
      notificationEmails: ["three@ab.example"],
    }),
  );
  const tp = await created(
    await post(admin.token, "/training-partners", { name: "TP One", code: "TP-01" }),
  );
  const otherTp = await created(
    await post(admin.token, "/training-partners", { name: "TP Two", code: "TP-02" }),
  );
  const centre = await created(
    await post(admin.token, "/centres", {
      name: "Centre One",
      code: "C-01",
      tpId: tp.id,
      state: "Maharashtra",
    }),
  );
  const centre2 = await created(
    await post(admin.token, "/centres", {
      name: "Centre Two",
      code: "C-02",
      tpId: tp.id,
      state: "Maharashtra",
    }),
  );
  const otherTpCentre = await created(
    await post(admin.token, "/centres", {
      name: "Centre Three",
      code: "C-03",
      tpId: otherTp.id,
      state: "Maharashtra",
    }),
  );
  const qualification = await created(
    await post(admin.token, "/qualifications", qualificationBody(options.qualification)),
  );
  if (options.recognition !== false) {
    const res = await put(admin.token, "/admin/recognition", {
      sectors: ["Electronics", "Construction"],
      panIndia: false,
      states: ["Maharashtra", "Gujarat"],
      startDate: "2020-01-01",
      endDate: "2099-12-31",
      ...options.recognition,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const reviewer = await sessionFor("ab_reviewer", { abId: ab.id, email: "reviewer@aa.example" });
  const otherReviewer = await sessionFor("ab_reviewer", {
    abId: otherAb.id,
    email: "reviewer2@aa.example",
  });
  return {
    admin,
    reviewer,
    otherReviewer,
    ab,
    otherAb,
    tp,
    otherTp,
    centre,
    centre2,
    otherTpCentre,
    qualification,
  };
}

export async function addQualification(world, overrides) {
  return created(await post(world.admin.token, "/qualifications", qualificationBody(overrides)));
}

export async function createLearners(world, count, prefix = "L") {
  const learners = [];
  for (let i = 1; i <= count; i += 1) {
    const ref = nextId(`${prefix}`);
    learners.push(
      await created(
        await post(world.admin.token, "/learners", { name: `Learner ${ref}`, externalRef: ref }),
      ),
    );
  }
  return learners;
}

export function assessorBody(overrides = {}) {
  const tag = nextId("ASR");
  return {
    name: `Assessor ${tag}`,
    code: tag,
    email: `${tag.toLowerCase()}@assessors.example`,
    qualifications: ["Electrician L4"],
    languages: ["Hindi"],
    toa: { certNo: `TOA-${tag}`, issuedOn: "2024-01-01", expiresOn: "2100-01-01" },
    otherAaCount: 1,
    undertaking: true,
    ...overrides,
  };
}

export async function createAssessor(world, overrides) {
  return created(await post(world.admin.token, "/assessors", assessorBody(overrides)));
}

/** An assessor profile plus a signed-in `assessor` user linked to it. */
export async function makeAssessor(world, overrides, sessionExtra = {}) {
  const assessor = await createAssessor(world, overrides);
  const session = await sessionFor("assessor", {
    email: `${assessor.code.toLowerCase()}@aa.example`,
    linkedProfileId: assessor.id,
    device: fieldDevice,
    ...sessionExtra,
  });
  return { assessor, session };
}

export async function createProctor(world, overrides = {}) {
  const tag = nextId("PRC");
  return created(
    await post(world.admin.token, "/proctors", {
      name: `Proctor ${tag}`,
      code: tag,
      languages: ["Hindi"],
      ...overrides,
    }),
  );
}

// ---- Batches through the API --------------------------------------------------------------

export function batchBody(world, overrides = {}) {
  return {
    abId: world.ab.id,
    qualificationId: world.qualification.id,
    type: "STT",
    mode: "offline",
    assessmentStartDate: WINDOW.start,
    assessmentEndDate: WINDOW.end,
    tpId: world.tp.id,
    centreId: world.centre.id,
    candidateCount: 3,
    assessmentLanguage: "Hindi",
    ...overrides,
  };
}

/** POST /batches, not asserted. Signed as `aa_admin` unless `token` is given. */
export function tryCreateBatch(world, overrides, token) {
  return post(token ?? world.admin.token, "/batches", batchBody(world, overrides));
}

export async function createBatch(world, overrides, token) {
  return created(await tryCreateBatch(world, overrides, token));
}

/** Add learners to the roster. Returns the candidate rows, in order. */
export async function addRoster(world, batchId, learners) {
  const rows = [];
  for (const learner of learners) {
    rows.push(
      await created(
        await post(world.admin.token, `/batches/${batchId}/candidates`, { learnerId: learner.id }),
      ),
    );
  }
  return rows;
}

export function loginEventBody(batchId, overrides = {}) {
  return {
    clientEventId: nextId("evt"),
    batchId,
    type: "login",
    capturedAt: CAPTURED_AT,
    lat: 19.076012345,
    lng: 72.877654321,
    accuracy: 12.5,
    locationStatus: "captured",
    device: fieldDevice,
    ...overrides,
  };
}

export const PASS_NOS = Object.freeze([
  { nosId: "NOS-01", theory: 70, practical: 80, viva: 75 },
  { nosId: "NOS-02", theory: 60, practical: 65, viva: 55 },
]);
export const FAIL_NOS = Object.freeze([
  { nosId: "NOS-01", theory: 70, practical: 80, viva: 75 },
  { nosId: "NOS-02", theory: 49, practical: 65, viva: 55 },
]);

export const STAGES = Object.freeze([
  "allocated",
  "accepted",
  "assigned",
  "in_progress",
  "completed",
  "drafted",
  "submitted",
  "validated",
  "published",
]);

/**
 * A batch with its roster, assessor and sessions, driven stage by stage through the API.
 * Default roster of three: Pass, Absent, Fail.
 * @param {object} world
 * @param {{ until?: string, batch?: object, learners?: object[], learnerCount?: number, assessor?: object, qualificationId?: string, presence?: boolean[], rows?: Function }} [options]
 */
export async function prepareBatch(world, options = {}) {
  const learners = options.learners ?? (await createLearners(world, options.learnerCount ?? 3));
  const batch = await createBatch(world, {
    ...(options.qualificationId ? { qualificationId: options.qualificationId } : {}),
    candidateCount: learners.length,
    ...options.batch,
  });
  const roster = await addRoster(world, batch.id, learners);
  const ctx = {
    world,
    batch,
    learners,
    roster,
    presence: options.presence ?? learners.map((_, i) => i !== 1),
    rows: options.rows,
    assessor: options.assessor?.assessor ?? null,
    assessorSession: options.assessor?.session ?? null,
    options,
  };
  await advanceBatch(ctx, options.until ?? "allocated");
  return ctx;
}

function reached(ctx, stage) {
  return (ctx.stage ?? -1) >= STAGES.indexOf(stage);
}

/** Move a prepared batch forward to `until` (inclusive). Safe to call with a stage already reached. */
export async function advanceBatch(ctx, until) {
  const { world } = ctx;
  const target = STAGES.indexOf(until);
  const admin = world.admin.token;
  const id = ctx.batch.id;
  const step = async (stage, work) => {
    if (STAGES.indexOf(stage) > target || reached(ctx, stage)) return;
    await work();
    ctx.stage = STAGES.indexOf(stage);
  };
  ctx.stage ??= 0;

  await step("accepted", async () => {
    ctx.batch = expectStatus(await post(admin, `/batches/${id}/accept`, {}), 200);
  });
  await step("assigned", async () => {
    if (!ctx.assessor) {
      const made = await makeAssessor(world, {
        languages: [ctx.batch.assessmentLanguage],
        ...ctx.options.assessorOverrides,
      });
      ctx.assessor = made.assessor;
      ctx.assessorSession = made.session;
    }
    ctx.batch = expectStatus(
      await post(admin, `/batches/${id}/assign`, { assessorId: ctx.assessor.id }),
      200,
    );
  });
  await step("in_progress", async () => {
    const res = await post(
      ctx.assessorSession.token,
      "/assessor/login-event",
      loginEventBody(id, { capturedAt: ctx.options.capturedAt ?? CAPTURED_AT }),
    );
    expectStatus(res, 200);
    ctx.batch = expectStatus(await get(admin, `/batches/${id}`), 200);
  });
  await step("completed", async () => {
    const capturedAt = ctx.options.capturedAt ?? CAPTURED_AT;
    expectStatus(
      await post(ctx.assessorSession.token, `/assessor/batches/${id}/attendance`, {
        capturedAt,
        records: ctx.roster.map((row, i) => ({
          candidateId: row.id,
          present: ctx.presence[i],
          idVerified: ctx.presence[i],
        })),
      }),
      200,
    );
    expectStatus(
      await post(ctx.assessorSession.token, `/assessor/batches/${id}/checklist`, {
        clientEventId: nextId("chk"),
        capturedAt: ctx.options.laterCapturedAt ?? CAPTURED_LATER_AT,
        items: [{ key: "multimeter", label: "Digital multimeter", available: true }],
        completeAssessment: true,
      }),
      200,
    );
    ctx.batch = expectStatus(await get(admin, `/batches/${id}`), 200);
  });
  await step("drafted", async () => {
    const rows =
      ctx.rows?.(ctx) ??
      ctx.roster.map((row, i) => ({
        candidateId: row.id,
        nos: ctx.presence[i] ? (i === 0 ? [...PASS_NOS] : [...FAIL_NOS]) : [],
      }));
    ctx.draft = expectStatus(await put(admin, `/batches/${id}/results`, { rows }), 200);
  });
  await step("submitted", async () => {
    ctx.result = expectStatus(await post(admin, `/batches/${id}/submit-result`, {}), 200);
    ctx.batch = expectStatus(await get(admin, `/batches/${id}`), 200);
  });
  await step("validated", async () => {
    ctx.result = expectStatus(await post(world.reviewer.token, `/batches/${id}/validate`, {}), 200);
    ctx.batch = expectStatus(await get(admin, `/batches/${id}`), 200);
  });
  await step("published", async () => {
    ctx.result = expectStatus(await post(world.reviewer.token, `/batches/${id}/publish`, {}), 200);
    ctx.batch = expectStatus(await get(admin, `/batches/${id}`), 200);
  });
  return ctx;
}

export async function auditRows(filter = {}) {
  return AuditLog.find(filter).sort({ createdAt: 1, _id: 1 }).lean();
}
