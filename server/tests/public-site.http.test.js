import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { OrganogramNode } from "../src/models/public-site.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { resetPublicRateLimit } from "../src/modules/public-site/public-site.rate-limit.js";
import { RESOURCE_SLUGS } from "../src/modules/public-site/public-site.resources.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const ADMIN = "/api/v1/admin/public-site";
const PUBLIC = "/api/v1/public";
const PII = "9988776655";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const post = (token, slug, body) =>
  request(app).post(`${ADMIN}/${slug}`).set(bearer(token)).send(body);
const patch = (token, slug, id, body) =>
  request(app).patch(`${ADMIN}/${slug}/${id}`).set(bearer(token)).send(body);
const adminGet = (token, path) => request(app).get(`${ADMIN}/${path}`).set(bearer(token));
const pub = (path) => request(app).get(`${PUBLIC}/${path}`);

async function sessionFor(role) {
  const email = `${role}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken };
}

let assessorId;
let proctorId;
let qualificationId;

async function seedRegistry() {
  const db = mongoose.connection.db;
  assessorId = oid();
  proctorId = oid();
  qualificationId = oid();
  await db.collection("assessors").insertOne({
    _id: assessorId,
    name: "Asha Assessor",
    code: "AS-77",
    email: `asha${PII}@example.com`,
    phone: PII,
    qualifications: [`B.Tech ${PII}`],
    yearsOfExperience: 12,
    toa: { certNo: `TOA-${PII}` },
  });
  await db.collection("proctors").insertOne({
    _id: proctorId,
    name: "Pavan Proctor",
    email: `pavan${PII}@example.com`,
  });
  await db.collection("qualifications").insertOne({
    _id: qualificationId,
    code: "Q-EL-4",
    name: "Electrician",
    sector: "Electronics",
    nos: [{ nosId: "secret-nos" }],
    passMarks: { theory: 40 },
  });
}

/** A valid create body for each resource, with the fields the public may see marked in `shown`. */
function samples() {
  return {
    "team-members": {
      body: { name: "Tara Lead", designation: "Head of Operations", department: "Ops", bio: "Bio" },
      shown: ["id", "name", "designation", "department", "bio", "photoRef"],
    },
    organogram: {
      body: { name: "Om Director", title: "Director" },
      shown: ["id", "name", "title", "parentId", "photoRef"],
    },
    people: {
      body: {
        kind: "assessor",
        registryId: String(assessorId),
        roleLabel: "Lead assessor",
        sector: "Electronics",
      },
      shown: ["id", "kind", "name", "roleLabel", "sector", "photoRef"],
    },
    "sample-papers": {
      body: {
        title: "Electrician paper 1",
        qualificationId: String(qualificationId),
        fileRef: "papers/el-1.pdf",
      },
      shown: ["id", "title", "fileRef", "qualification"],
    },
    "industry-linkages": {
      body: {
        name: "Acme Industries",
        description: "Placement partner",
        websiteUrl: "https://acme.example",
      },
      shown: ["id", "name", "description", "websiteUrl", "logoRef"],
    },
    grievance: {
      body: {
        title: "Grievance officer",
        body: "Write to us",
        contactEmail: "grievance@aa.example",
        contactPhone: "0120-555",
      },
      shown: ["id", "title", "body", "contactName", "contactEmail", "contactPhone", "fileRef"],
    },
    posh: {
      body: {
        kind: "committee_member",
        title: "Committee",
        memberName: "Meera",
        memberRole: "Chair",
      },
      shown: ["id", "kind", "title", "body", "memberName", "memberRole", "fileRef"],
    },
    "office-documents": {
      body: { category: "lease", title: "Lease agreement", fileRef: "docs/lease.pdf" },
      shown: ["id", "category", "title", "note", "fileRef"],
    },
    events: {
      body: { title: "Assessor workshop", date: "2026-11-12", location: "Pune" },
      shown: ["id", "title", "description", "date", "endDate", "location"],
    },
  };
}

describe("public site content", () => {
  beforeAll(async () => {
    await startMongo();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    resetPublicRateLimit();
    await seedRegistry();
  });

  it("covers every resource in the sample table", () => {
    expect(Object.keys(samples()).sort()).toEqual([...RESOURCE_SLUGS].sort());
  });

  describe("admin CRUD", () => {
    it.each(RESOURCE_SLUGS)("creates, reads, updates and deletes %s, audited", async (slug) => {
      const admin = await sessionFor("aa_admin");
      const { body } = samples()[slug];

      const created = await post(admin.token, slug, body);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      // Nothing is public until it is published.
      expect(created.body).toMatchObject({ published: false, sortOrder: 0 });
      const id = created.body.id;

      expect((await adminGet(admin.token, `${slug}/${id}`)).body.id).toBe(id);
      const list = await adminGet(admin.token, slug);
      expect(list.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });

      const saved = await patch(admin.token, slug, id, { published: true, sortOrder: 5 });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toMatchObject({ published: true, sortOrder: 5 });
      expect((await adminGet(admin.token, `${slug}?published=true`)).body.total).toBe(1);
      expect((await adminGet(admin.token, `${slug}?published=false`)).body.total).toBe(0);

      const gone = await request(app).delete(`${ADMIN}/${slug}/${id}`).set(bearer(admin.token));
      expect(gone.status).toBe(204);
      expect((await adminGet(admin.token, `${slug}/${id}`)).status).toBe(404);

      const rows = await AuditLog.find({ entity: "publicSite", entityId: id })
        .sort({ _id: 1 })
        .lean();
      expect(rows.map((row) => row.action)).toEqual([
        `public_site.${slug}.create`,
        `public_site.${slug}.update`,
        `public_site.${slug}.delete`,
      ]);
      expect(rows[1].before.published).toBe(false);
      expect(rows[1].after.published).toBe(true);
      expect(rows[2].before.id).toBe(id);
    });

    it("rejects unknown fields, missing fields, bad ids and unknown resources", async () => {
      const admin = await sessionFor("aa_admin");
      expect((await post(admin.token, "team-members", { name: "X" })).status).toBe(400);
      expect(
        (await post(admin.token, "team-members", { name: "X", designation: "Y", aadhaar: PII }))
          .status,
      ).toBe(400);
      expect((await post(admin.token, "events", { title: "T", date: "2026-02-30" })).status).toBe(
        400,
      );
      expect(
        (
          await post(admin.token, "events", {
            title: "T",
            date: "2026-03-05",
            endDate: "2026-03-01",
          })
        ).status,
      ).toBe(400);
      expect(
        (await post(admin.token, "posh", { kind: "committee_member", title: "No name" })).status,
      ).toBe(400);
      expect(
        (
          await post(admin.token, "industry-linkages", {
            name: "N",
            websiteUrl: "javascript:alert(1)",
          })
        ).status,
      ).toBe(400);
      expect((await patch(admin.token, "team-members", oid(), {})).status).toBe(400);
      expect((await patch(admin.token, "team-members", oid(), { name: "Z" })).status).toBe(404);
      expect((await adminGet(admin.token, "team-members/nope")).status).toBe(400);
      expect((await post(admin.token, "unknown", { a: 1 })).status).toBe(404);
      expect((await adminGet(admin.token, "team-members?pageSize=101")).status).toBe(400);
      expect(await AuditLog.countDocuments({ entity: "publicSite" })).toBe(0);
    });

    it("lets aa_admin write, mis read only, and everyone else nothing", async () => {
      const admin = await sessionFor("aa_admin");
      const item = await post(admin.token, "team-members", samples()["team-members"].body);
      for (const role of USER_ROLES) {
        const s = role === "aa_admin" ? admin : await sessionFor(role);
        const readOk = role === "aa_admin" || role === "mis";
        expect((await adminGet(s.token, "team-members")).status, `${role} list`).toBe(
          readOk ? 200 : 403,
        );
        expect(
          (await adminGet(s.token, `team-members/${item.body.id}`)).status,
          `${role} get`,
        ).toBe(readOk ? 200 : 403);
        if (role === "aa_admin") continue;
        expect(
          (await post(s.token, "team-members", samples()["team-members"].body)).status,
          role,
        ).toBe(403);
        expect(
          (await patch(s.token, "team-members", item.body.id, { name: "Q" })).status,
          role,
        ).toBe(403);
        expect(
          (await request(app).delete(`${ADMIN}/team-members/${item.body.id}`).set(bearer(s.token)))
            .status,
          role,
        ).toBe(403);
      }
      expect((await request(app).get(`${ADMIN}/team-members`)).status).toBe(401);
      expect((await request(app).post(`${ADMIN}/team-members`).send({})).status).toBe(401);
    });
  });

  describe("assessors and proctors", () => {
    it("links to the registry, copies only the name, and never exposes registry data", async () => {
      const admin = await sessionFor("aa_admin");
      const a = await post(admin.token, "people", samples().people.body);
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      expect(a.body).toMatchObject({
        name: "Asha Assessor",
        kind: "assessor",
        registryId: String(assessorId),
      });
      const p = await post(admin.token, "people", {
        kind: "proctor",
        registryId: String(proctorId),
        name: "Pavan P.",
        roleLabel: "Proctor",
      });
      expect(p.body.name).toBe("Pavan P.");
      for (const id of [a.body.id, p.body.id])
        await patch(admin.token, "people", id, { published: true });

      // Neither the admin copy nor the public list holds anything else from the registry record.
      expect(JSON.stringify(a.body)).not.toContain(PII);
      expect(JSON.stringify(a.body)).not.toMatch(
        /AS-77|email|phone|toa|qualifications|yearsOfExperience/,
      );
      const listed = await pub("people");
      expect(JSON.stringify(listed.body)).not.toContain(PII);
      expect(JSON.stringify(listed.body)).not.toMatch(
        /AS-77|email|phone|toa|registryId|qualifications/,
      );
      expect(listed.body.items.map((row) => row.kind).sort()).toEqual(["assessor", "proctor"]);
      expect((await pub("people?kind=proctor")).body.items.map((row) => row.name)).toEqual([
        "Pavan P.",
      ]);
    });

    it("refuses an id that is not in the matching registry, a duplicate, and a change of link", async () => {
      const admin = await sessionFor("aa_admin");
      const bad = await post(admin.token, "people", {
        ...samples().people.body,
        registryId: String(oid()),
      });
      expect(bad.status).toBe(400);
      const wrongKind = await post(admin.token, "people", {
        ...samples().people.body,
        kind: "proctor",
      });
      expect(wrongKind.status).toBe(400);
      const ok = await post(admin.token, "people", samples().people.body);
      expect(ok.status).toBe(201);
      expect((await post(admin.token, "people", samples().people.body)).status).toBe(400);
      expect((await patch(admin.token, "people", ok.body.id, { kind: "proctor" })).status).toBe(
        400,
      );
      expect(
        (await patch(admin.token, "people", ok.body.id, { registryId: String(proctorId) })).status,
      ).toBe(400);
      expect((await patch(admin.token, "people", ok.body.id, { roleLabel: "Senior" })).status).toBe(
        200,
      );
      expect(
        (await post(admin.token, "people", { ...samples().people.body, email: "a@b.co" })).status,
      ).toBe(400);
    });
  });

  describe("organogram", () => {
    it("links nodes, refuses loops, and shows a parent publicly only while it is published", async () => {
      const admin = await sessionFor("aa_admin");
      const root = await post(admin.token, "organogram", {
        name: "Om",
        title: "Director",
        published: true,
      });
      const child = await post(admin.token, "organogram", {
        name: "Nina",
        title: "Manager",
        parentId: root.body.id,
        published: true,
      });
      expect(child.status).toBe(201);
      expect(
        (await post(admin.token, "organogram", { name: "X", title: "Y", parentId: String(oid()) }))
          .status,
      ).toBe(400);
      expect(
        (await patch(admin.token, "organogram", root.body.id, { parentId: root.body.id })).status,
      ).toBe(400);
      expect(
        (await patch(admin.token, "organogram", root.body.id, { parentId: child.body.id })).status,
      ).toBe(400);

      const shown = (await pub("organogram")).body.items.find((row) => row.name === "Nina");
      expect(shown.parentId).toBe(root.body.id);
      await patch(admin.token, "organogram", root.body.id, { published: false });
      const hidden = await pub("organogram");
      expect(hidden.body.items.map((row) => row.name)).toEqual(["Nina"]);
      expect(hidden.body.items[0].parentId).toBeNull();

      await request(app).delete(`${ADMIN}/organogram/${root.body.id}`).set(bearer(admin.token));
      expect((await OrganogramNode.findById(child.body.id).lean()).parentId).toBeNull();
    });
  });

  describe("public endpoints", () => {
    it.each(RESOURCE_SLUGS)(
      "%s: needs no login, shows published items only, whitelisted fields",
      async (slug) => {
        const admin = await sessionFor("aa_admin");
        const { body, shown } = samples()[slug];
        const live = await post(admin.token, slug, { ...body, published: true, sortOrder: 2 });
        expect(live.status, JSON.stringify(live.body)).toBe(201);
        // A second, unpublished item. For a unique link, use the proctor.
        const draftBody =
          slug === "people"
            ? { kind: "proctor", registryId: String(proctorId), roleLabel: "DRAFT-ONLY" }
            : { ...body, [body.title ? "title" : "name"]: "DRAFT-ONLY" };
        const draft = await post(admin.token, slug, draftBody);
        expect(draft.status, JSON.stringify(draft.body)).toBe(201);

        const res = await pub(slug);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
        expect(res.body.items).toHaveLength(1);
        expect(Object.keys(res.body.items[0]).sort()).toEqual([...shown].sort());
        expect(res.body.items[0].id).toBe(live.body.id);
        const text = JSON.stringify(res.body);
        expect(text).not.toContain("DRAFT-ONLY");
        expect(text).not.toMatch(
          /"(published|sortOrder|createdBy|updatedBy|createdAt|updatedAt|registryId|qualificationId)"/,
        );
        expect(text).not.toContain(PII);

        // The draft is public once published, and gone again when withdrawn.
        await patch(admin.token, slug, draft.body.id, { published: true });
        expect((await pub(slug)).body.total).toBe(2);
        await patch(admin.token, slug, draft.body.id, { published: false });
        expect((await pub(slug)).body.total).toBe(1);
      },
    );

    it("sets caching headers and sends nothing private", async () => {
      const res = await pub("team-members");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=300");
      expect(res.headers["set-cookie"]).toBeUndefined();
      const admin = await sessionFor("aa_admin");
      const adminRes = await adminGet(admin.token, "team-members");
      expect(adminRes.headers["cache-control"]).toBe("no-store");
    });

    it("sorts by sortOrder, then creation, and pages", async () => {
      const admin = await sessionFor("aa_admin");
      for (const [name, sortOrder] of [
        ["C", 3],
        ["A", 1],
        ["B", 2],
        ["A2", 1],
      ]) {
        await post(admin.token, "team-members", {
          name,
          designation: "D",
          published: true,
          sortOrder,
        });
      }
      const all = await pub("team-members");
      expect(all.body.items.map((row) => row.name)).toEqual(["A", "A2", "B", "C"]);
      const second = await pub("team-members?page=2&pageSize=3");
      expect(second.body).toMatchObject({ page: 2, pageSize: 3, total: 4 });
      expect(second.body.items.map((row) => row.name)).toEqual(["C"]);
      expect((await pub("team-members?pageSize=101")).status).toBe(400);
      expect((await pub("team-members?page=0")).status).toBe(400);
      expect((await pub("team-members?published=false")).status).toBe(400);
      expect((await pub("team-members?foo=1")).status).toBe(400);
    });

    it("embeds the qualification for a sample paper without exposing the qualification record", async () => {
      const admin = await sessionFor("aa_admin");
      await post(admin.token, "sample-papers", {
        ...samples()["sample-papers"].body,
        published: true,
      });
      const res = await pub("sample-papers");
      expect(res.body.items[0].qualification).toEqual({
        code: "Q-EL-4",
        name: "Electrician",
        sector: "Electronics",
      });
      expect(JSON.stringify(res.body)).not.toMatch(/nos|passMarks|secret-nos/);
      const bad = await post(admin.token, "sample-papers", {
        ...samples()["sample-papers"].body,
        qualificationId: String(oid()),
      });
      expect(bad.status).toBe(400);
    });

    it("filters the calendar by month and lists events by date", async () => {
      const admin = await sessionFor("aa_admin");
      const make = (title, date, endDate) =>
        post(admin.token, "events", {
          title,
          date,
          ...(endDate ? { endDate } : {}),
          published: true,
        });
      await make("Late Nov", "2026-11-25");
      await make("Early Nov", "2026-11-02");
      await make("Spans", "2026-10-30", "2026-11-03");
      await make("December", "2026-12-01");
      const nov = await pub("events?month=2026-11");
      expect(nov.body.items.map((row) => row.title)).toEqual(["Spans", "Early Nov", "Late Nov"]);
      expect((await pub("events?month=2026-12")).body.items.map((row) => row.title)).toEqual([
        "December",
      ]);
      expect((await pub("events?month=2027-01")).body.items).toEqual([]);
      expect((await pub("events")).body.total).toBe(4);
      expect((await pub("events?month=2026-13")).status).toBe(400);
    });

    it("filters office documents by category and posh by kind", async () => {
      const admin = await sessionFor("aa_admin");
      await post(admin.token, "office-documents", {
        category: "lease",
        title: "L",
        fileRef: "a",
        published: true,
      });
      await post(admin.token, "office-documents", {
        category: "electricity_bill",
        title: "E",
        fileRef: "b",
        published: true,
      });
      expect((await pub("office-documents?category=lease")).body.items.map((r) => r.title)).toEqual(
        ["L"],
      );
      expect((await pub("office-documents?category=other")).body.total).toBe(0);
      expect((await pub("office-documents?category=bogus")).status).toBe(400);
      await post(admin.token, "posh", { kind: "policy", title: "Policy", published: true });
      await post(admin.token, "posh", {
        kind: "committee_member",
        title: "C",
        memberName: "M",
        published: true,
      });
      expect((await pub("posh?kind=policy")).body.items.map((r) => r.title)).toEqual(["Policy"]);
    });

    it("returns 404 for an unknown section and is empty when nothing is published", async () => {
      expect((await pub("nothing")).status).toBe(404);
      for (const slug of RESOURCE_SLUGS) {
        const res = await pub(slug);
        expect(res.body, slug).toEqual({ page: 1, pageSize: 20, total: 0, items: [] });
      }
    });

    it("does not offer writes on the public path", async () => {
      for (const method of ["post", "patch", "put", "delete"]) {
        const res = await request(app)
          [method](`${PUBLIC}/team-members`)
          .send({ name: "X", designation: "Y" });
        expect([404, 405]).toContain(res.status);
      }
    });

    it("rate limits per client and answers 429 with Retry-After", async () => {
      for (let i = 0; i < compliance.PUBLIC_RATE_LIMIT_MAX; i += 1) {
        expect((await pub("events")).status).toBe(200);
      }
      const blocked = await pub("events");
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      resetPublicRateLimit();
      expect((await pub("events")).status).toBe(200);
    });
  });
});
