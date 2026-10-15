import { Batch } from "../src/models/batch.model.js";
import { Project } from "../src/models/project.model.js";
import { Scheme } from "../src/models/scheme.model.js";
import { Signatory } from "../src/models/signatory.model.js";
import { SCHEME_READ_ROLES, SCHEME_WRITE_ROLES, USER_ROLES } from "../src/models/roles.js";
import {
  GHOST_ID,
  auditRows,
  bootE2e,
  call,
  createBatch,
  del,
  expectError,
  get,
  makeWorld,
  patch,
  post,
  resetE2e,
  sessionFor,
  shutdownE2e,
  tryCreateBatch,
} from "./helpers/e2e.js";

const READERS = SCHEME_READ_ROLES;
const WRITERS = SCHEME_WRITE_ROLES;
const DENIED = USER_ROLES.filter((role) => !READERS.includes(role));

function schemeBody(overrides = {}) {
  return { name: "Skill Scheme", code: "SCH-01", fundingBody: "State Skill Mission", ...overrides };
}

function projectBody(schemeId, overrides = {}) {
  return {
    name: "Project One",
    code: "PRJ-01",
    schemeId,
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    ...overrides,
  };
}

async function makeScheme(token, overrides) {
  const res = await post(token, "/schemes", schemeBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function makeProject(token, schemeId, overrides) {
  const res = await post(token, "/projects", projectBody(schemeId, overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe("scheme, project and signatory master", () => {
  beforeAll(async () => {
    await bootE2e();
    await Promise.all([Scheme.syncIndexes(), Project.syncIndexes(), Signatory.syncIndexes()]);
  });
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  describe("schemes", () => {
    it("creates, reads, lists, updates, and deactivates with audit before and after", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      expect(Object.keys(scheme).sort()).toEqual(
        ["active", "code", "createdAt", "fundingBody", "id", "name", "updatedAt"].sort(),
      );
      expect(scheme).toMatchObject({ ...schemeBody(), active: true });

      expect((await get(admin.token, `/schemes/${scheme.id}`)).body).toEqual(scheme);
      const list = await get(admin.token, "/schemes");
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(list.body.items[0].id).toBe(scheme.id);

      const updated = await patch(admin.token, `/schemes/${scheme.id}`, { name: "Renamed" });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe("Renamed");

      const off = await del(admin.token, `/schemes/${scheme.id}`);
      expect(off.status).toBe(200);
      expect(off.body.active).toBe(false);
      expect(await Scheme.countDocuments({})).toBe(1);

      const activeOnly = await get(admin.token, "/schemes", { active: "true" });
      expect(activeOnly.body.total).toBe(0);
      expect((await get(admin.token, "/schemes", { active: "false" })).body.total).toBe(1);

      const rows = await auditRows({ entity: "scheme" });
      expect(rows.map((row) => row.action)).toEqual([
        "scheme.create",
        "scheme.update",
        "scheme.deactivate",
      ]);
      expect(rows[0].after).toMatchObject({ code: "SCH-01" });
      expect(rows[1].before.name).toBe("Skill Scheme");
      expect(rows[1].after.name).toBe("Renamed");
      expect(rows[2].before.active).toBe(true);
      expect(rows[2].after.active).toBe(false);
    });

    it("keeps codes unique on create and update", async () => {
      const admin = await sessionFor("aa_admin");
      await makeScheme(admin.token);
      expectError(await post(admin.token, "/schemes", schemeBody()), 409, "DUPLICATE_RESOURCE");
      const other = await makeScheme(admin.token, { code: "SCH-02" });
      expectError(
        await patch(admin.token, `/schemes/${other.id}`, { code: "SCH-01" }),
        409,
        "DUPLICATE_RESOURCE",
      );
    });

    it("validates the body and refuses unknown keys", async () => {
      const admin = await sessionFor("aa_admin");
      for (const bad of [
        { code: undefined },
        { name: "" },
        { fundingBody: undefined },
        { aadhaar: "123412341234" },
        { active: "yes" },
      ]) {
        expectError(await post(admin.token, "/schemes", schemeBody(bad)), 400, "VALIDATION_ERROR");
      }
      const scheme = await makeScheme(admin.token);
      expectError(await patch(admin.token, `/schemes/${scheme.id}`, {}), 400, "VALIDATION_ERROR");
      expectError(
        await patch(admin.token, `/schemes/${scheme.id}`, { id: GHOST_ID }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(await get(admin.token, "/schemes/not-an-id"), 400, "VALIDATION_ERROR");
      expectError(await get(admin.token, `/schemes/${GHOST_ID}`), 404, "NOT_FOUND");
      expectError(await del(admin.token, `/schemes/${GHOST_ID}`), 404, "NOT_FOUND");
    });
  });

  describe("projects", () => {
    it("creates under an active scheme, filters by scheme, and deactivates", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      const otherScheme = await makeScheme(admin.token, { code: "SCH-02" });
      const project = await makeProject(admin.token, scheme.id);
      expect(Object.keys(project).sort()).toEqual(
        [
          "active",
          "code",
          "createdAt",
          "endDate",
          "id",
          "name",
          "schemeId",
          "startDate",
          "updatedAt",
        ].sort(),
      );
      await makeProject(admin.token, otherScheme.id, { code: "PRJ-02" });

      const filtered = await get(admin.token, "/projects", { schemeId: scheme.id });
      expect(filtered.body.total).toBe(1);
      expect(filtered.body.items[0].id).toBe(project.id);

      const off = await del(admin.token, `/projects/${project.id}`);
      expect(off.body.active).toBe(false);
      expect((await get(admin.token, `/projects/${project.id}`)).body.active).toBe(false);

      const rows = await auditRows({ entity: "project" });
      expect(rows.map((row) => row.action)).toEqual([
        "project.create",
        "project.create",
        "project.deactivate",
      ]);
      expect(rows[2].before.active).toBe(true);
      expect(rows[2].after.active).toBe(false);
    });

    it("allows no end date and clears it with null", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      const project = await makeProject(admin.token, scheme.id, { endDate: undefined });
      expect(project.endDate).toBeNull();
      const set = await patch(admin.token, `/projects/${project.id}`, { endDate: "2027-01-01" });
      expect(set.body.endDate).toBe("2027-01-01");
      const cleared = await patch(admin.token, `/projects/${project.id}`, { endDate: null });
      expect(cleared.body.endDate).toBeNull();
    });

    it("validates scheme, dates, and unique codes", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      const project = await makeProject(admin.token, scheme.id);

      const ghost = await post(admin.token, "/projects", projectBody(GHOST_ID, { code: "P-X" }));
      expectError(ghost, 400, "VALIDATION_ERROR");
      expect(ghost.body.error.details.schemeId).toBeDefined();

      const off = await makeScheme(admin.token, { code: "SCH-OFF", active: false });
      expectError(
        await post(admin.token, "/projects", projectBody(off.id, { code: "P-Y" })),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await patch(admin.token, `/projects/${project.id}`, { schemeId: off.id }),
        400,
        "VALIDATION_ERROR",
      );

      expectError(
        await post(admin.token, "/projects", projectBody(scheme.id, { endDate: "2026-03-31" })),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await post(admin.token, "/projects", projectBody(scheme.id, { startDate: "2026-02-30" })),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await patch(admin.token, `/projects/${project.id}`, { endDate: "2026-03-31" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await post(admin.token, "/projects", projectBody(scheme.id)),
        409,
        "DUPLICATE_RESOURCE",
      );
      expectError(
        await post(admin.token, "/projects", projectBody(scheme.id, { code: "P-Z", extra: 1 })),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("authorised signatories", () => {
    const base = {
      name: "A Signer",
      designation: "Director",
      validFrom: "2026-04-01",
      validTo: "2027-03-31",
    };

    it("handles agency, scheme, and project scope and audits without the name", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      const project = await makeProject(admin.token, scheme.id);

      const agency = await post(admin.token, "/signatories", { ...base, scope: "agency" });
      expect(agency.status, JSON.stringify(agency.body)).toBe(201);
      expect(Object.keys(agency.body).sort()).toEqual(
        [
          "active",
          "createdAt",
          "designation",
          "id",
          "name",
          "projectId",
          "schemeId",
          "scope",
          "updatedAt",
          "validFrom",
          "validTo",
        ].sort(),
      );
      expect(agency.body).toMatchObject({ scope: "agency", schemeId: null, projectId: null });

      const forScheme = await post(admin.token, "/signatories", {
        ...base,
        scope: "scheme",
        schemeId: scheme.id,
        validTo: undefined,
      });
      expect(forScheme.status).toBe(201);
      expect(forScheme.body.validTo).toBeNull();
      const forProject = await post(admin.token, "/signatories", {
        ...base,
        scope: "project",
        projectId: project.id,
      });
      expect(forProject.status).toBe(201);

      expect((await get(admin.token, "/signatories")).body.total).toBe(3);
      expect((await get(admin.token, "/signatories", { scope: "scheme" })).body.total).toBe(1);
      expect(
        (await get(admin.token, "/signatories", { projectId: project.id })).body.items[0].id,
      ).toBe(forProject.body.id);
      expect(
        (await get(admin.token, "/signatories", { schemeId: scheme.id })).body.items[0].id,
      ).toBe(forScheme.body.id);

      const edited = await patch(admin.token, `/signatories/${agency.body.id}`, {
        designation: "Chief Executive",
        name: "B Signer",
      });
      expect(edited.body).toMatchObject({ designation: "Chief Executive", name: "B Signer" });
      const off = await del(admin.token, `/signatories/${agency.body.id}`);
      expect(off.body.active).toBe(false);
      expect(await Signatory.countDocuments({})).toBe(3);

      const rows = await auditRows({ entity: "signatory" });
      expect(rows.map((row) => row.action)).toEqual([
        "signatory.create",
        "signatory.create",
        "signatory.create",
        "signatory.update",
        "signatory.deactivate",
      ]);
      expect(rows[3].before.designation).toBe("Director");
      expect(rows[3].after.designation).toBe("Chief Executive");
      expect(rows[4].after.active).toBe(false);
      const stored = JSON.stringify(rows);
      expect(stored).not.toContain("A Signer");
      expect(stored).not.toContain("B Signer");
    });

    it("enforces the scope rules, references, dates, and keys", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      const project = await makeProject(admin.token, scheme.id);
      const send = (extra) => post(admin.token, "/signatories", { ...base, ...extra });

      for (const bad of [
        { scope: "scheme" },
        { scope: "project" },
        { scope: "scheme", schemeId: scheme.id, projectId: project.id },
        { scope: "project", projectId: project.id, schemeId: scheme.id },
        { scope: "agency", schemeId: scheme.id },
        { scope: "agency", validTo: "2026-03-31" },
        { scope: "agency", validFrom: "2026-13-01" },
        { scope: "region" },
        { scope: "agency", signatureImage: "data:image/png;base64,AAAA" },
        { scope: "agency", aadhaar: "123412341234" },
        { scope: "agency", name: "" },
      ]) {
        expectError(await send(bad), 400, "VALIDATION_ERROR");
      }
      expectError(await send({ scope: "scheme", schemeId: GHOST_ID }), 400, "VALIDATION_ERROR");
      expectError(await send({ scope: "project", projectId: GHOST_ID }), 400, "VALIDATION_ERROR");

      await del(admin.token, `/projects/${project.id}`);
      expectError(await send({ scope: "project", projectId: project.id }), 400, "VALIDATION_ERROR");

      const row = (await send({ scope: "agency" })).body;
      expectError(
        await patch(admin.token, `/signatories/${row.id}`, { scope: "scheme" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await patch(admin.token, `/signatories/${row.id}`, { validTo: "2026-03-31" }),
        400,
        "VALIDATION_ERROR",
      );
      const moved = await patch(admin.token, `/signatories/${row.id}`, {
        scope: "scheme",
        schemeId: scheme.id,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const back = await patch(admin.token, `/signatories/${row.id}`, {
        scope: "agency",
        schemeId: null,
      });
      expect(back.body).toMatchObject({ scope: "agency", schemeId: null });
    });
  });

  describe("roles", () => {
    it("matches the declared role lists", () => {
      expect(WRITERS).toEqual(["aa_admin", "mis"]);
      expect(READERS).toEqual(["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"]);
    });

    it("lets writers write and readers read, and denies everyone else", async () => {
      const admin = await sessionFor("aa_admin");
      const scheme = await makeScheme(admin.token);
      const project = await makeProject(admin.token, scheme.id);
      const signer = (
        await post(admin.token, "/signatories", {
          name: "S",
          designation: "D",
          scope: "agency",
          validFrom: "2026-04-01",
        })
      ).body;
      const targetsFor = (role) => [
        ["/schemes", scheme, schemeBody({ code: `N-1-${role}` })],
        ["/projects", project, projectBody(scheme.id, { code: `N-2-${role}` })],
        [
          "/signatories",
          signer,
          { name: "T", designation: "D", scope: "agency", validFrom: "2026-04-01" },
        ],
      ];

      for (const role of USER_ROLES) {
        const session = await sessionFor(role, { email: `${role}-x@aa.example` });
        const targets = targetsFor(role);
        for (const [path, row, newBody] of targets) {
          const reads = [
            await get(session.token, path),
            await get(session.token, `${path}/${row.id}`),
          ];
          const writes = [
            await post(session.token, path, newBody),
            await patch(session.token, `${path}/${row.id}`, { active: true }),
          ];
          for (const res of reads) {
            if (READERS.includes(role)) expect(res.status, `${role} ${path}`).toBe(200);
            else expectError(res, 403, "FORBIDDEN");
          }
          for (const res of writes) {
            if (WRITERS.includes(role)) expect(res.status, `${role} ${path}`).toBeLessThan(300);
            else expectError(res, 403, "FORBIDDEN");
          }
        }
        if (!WRITERS.includes(role)) {
          for (const [path, row] of targets) {
            expectError(await del(session.token, `${path}/${row.id}`), 403, "FORBIDDEN");
          }
        }
      }
      expect(DENIED).toEqual(
        expect.arrayContaining(["sme", "assessor", "proctor", "candidate", "tp"]),
      );
    });

    it("requires a sign-in", async () => {
      expectError(await call("get", "/schemes"), 401, "UNAUTHORIZED");
      expectError(await call("post", "/projects", undefined, {}), 401, "UNAUTHORIZED");
    });
  });

  describe("batch links", () => {
    it("leaves schemeId and projectId null when not sent", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world);
      expect(batch).toMatchObject({ schemeId: null, projectId: null });
      const listed = await get(world.admin.token, "/batches");
      expect(listed.body.items[0]).toMatchObject({ schemeId: null, projectId: null });
      const stored = await Batch.findById(batch.id).lean();
      expect(stored.schemeId).toBeNull();
      expect(stored.projectId).toBeNull();
    });

    it("stores and returns a scheme, a project, and both", async () => {
      const world = await makeWorld();
      const scheme = await makeScheme(world.admin.token);
      const project = await makeProject(world.admin.token, scheme.id);

      const onlyScheme = await createBatch(world, { schemeId: scheme.id });
      expect(onlyScheme).toMatchObject({ schemeId: scheme.id, projectId: null });

      const both = await createBatch(world, { schemeId: scheme.id, projectId: project.id });
      expect(both).toMatchObject({ schemeId: scheme.id, projectId: project.id });
      expect((await get(world.admin.token, `/batches/${both.id}`)).body).toMatchObject({
        schemeId: scheme.id,
        projectId: project.id,
      });

      // Only a project: the scheme is taken from the project.
      const onlyProject = await createBatch(world, { projectId: project.id });
      expect(onlyProject).toMatchObject({ schemeId: scheme.id, projectId: project.id });

      const nulls = await createBatch(world, { schemeId: null, projectId: null });
      expect(nulls).toMatchObject({ schemeId: null, projectId: null });

      const rows = await auditRows({ action: "batch.create" });
      expect(rows[1].after).toMatchObject({ schemeId: scheme.id, projectId: project.id });
    });

    it("lets an ab_reviewer tag their own batch", async () => {
      const world = await makeWorld();
      const scheme = await makeScheme(world.admin.token);
      const batch = await createBatch(world, { schemeId: scheme.id }, world.reviewer.token);
      expect(batch.schemeId).toBe(scheme.id);
    });

    it("refuses unknown, inactive, and mismatched links and creates nothing", async () => {
      const world = await makeWorld();
      const token = world.admin.token;
      const scheme = await makeScheme(token);
      const otherScheme = await makeScheme(token, { code: "SCH-02" });
      const project = await makeProject(token, scheme.id);
      const offScheme = await makeScheme(token, { code: "SCH-OFF" });
      const offProject = await makeProject(token, scheme.id, { code: "PRJ-OFF" });
      await del(token, `/schemes/${offScheme.id}`);
      await del(token, `/projects/${offProject.id}`);

      const cases = [
        [{ schemeId: GHOST_ID }, "schemeId"],
        [{ projectId: GHOST_ID }, "projectId"],
        [{ schemeId: offScheme.id }, "schemeId"],
        [{ projectId: offProject.id }, "projectId"],
        [{ schemeId: otherScheme.id, projectId: project.id }, "projectId"],
        [{ schemeId: "nope" }, "schemeId"],
      ];
      for (const [overrides, field] of cases) {
        const res = await tryCreateBatch(world, overrides);
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.body.error.details[field], JSON.stringify(overrides)).toBeDefined();
      }

      // A project under a scheme that was deactivated later is refused as well.
      await del(token, `/schemes/${scheme.id}`);
      expectError(await tryCreateBatch(world, { projectId: project.id }), 400, "VALIDATION_ERROR");
      expect(await Batch.countDocuments({})).toBe(0);
    });

    it("keeps old batches readable after the scheme is deactivated", async () => {
      const world = await makeWorld();
      const scheme = await makeScheme(world.admin.token);
      const batch = await createBatch(world, { schemeId: scheme.id });
      await del(world.admin.token, `/schemes/${scheme.id}`);
      const read = await get(world.admin.token, `/batches/${batch.id}`);
      expect(read.body.schemeId).toBe(scheme.id);
    });

    it("filters GET /batches by schemeId and projectId, within the caller's scope", async () => {
      const world = await makeWorld();
      const token = world.admin.token;
      const scheme = await makeScheme(token);
      const otherScheme = await makeScheme(token, { code: "SCH-02" });
      const project = await makeProject(token, scheme.id);
      const otherProject = await makeProject(token, scheme.id, { code: "PRJ-02" });

      const a = await createBatch(world, { schemeId: scheme.id, projectId: project.id });
      const b = await createBatch(world, { projectId: otherProject.id });
      const c = await createBatch(world, { schemeId: otherScheme.id });
      await createBatch(world);

      const ids = async (query, who = token) =>
        (await get(who, "/batches", query)).body.items.map((item) => item.id).sort();

      expect(await ids({ schemeId: scheme.id })).toEqual([a.id, b.id].sort());
      expect(await ids({ schemeId: otherScheme.id })).toEqual([c.id]);
      expect(await ids({ projectId: project.id })).toEqual([a.id]);
      expect(await ids({ schemeId: scheme.id, projectId: otherProject.id })).toEqual([b.id]);
      expect(await ids({ schemeId: otherScheme.id, projectId: project.id })).toEqual([]);
      expect(await ids({ schemeId: GHOST_ID })).toEqual([]);
      expect(await ids({ schemeId: "" })).toHaveLength(4);
      expect((await get(token, "/batches", { schemeId: "nope" })).status).toBe(400);

      // A reviewer still sees only their own awarding body's batches.
      const mine = await createBatch(world, { schemeId: scheme.id, abId: world.otherAb.id }, token);
      expect(await ids({ schemeId: scheme.id }, world.reviewer.token)).toEqual([a.id, b.id].sort());
      expect(await ids({ schemeId: scheme.id }, world.otherReviewer.token)).toEqual([mine.id]);
    });
  });
});
