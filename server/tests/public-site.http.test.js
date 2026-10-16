import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { OrganogramNode, PoshItem, PublicPerson } from "../src/models/public-site.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { resetRegistryIdCache } from "../src/modules/public-site/public-site.service.js";
import { resetPublicRateLimit } from "../src/modules/public-site/public-site.rate-limit.js";
import { RESOURCE_SLUGS } from "../src/modules/public-site/public-site.resources.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const ADMIN = "/api/v1/admin/public-site";
const PUBLIC = "/api/v1/public";
const PII = "9988776655";
const MODELS = { people: PublicPerson, posh: PoshItem };

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
    active: true,
    toa: { certNo: `TOA-${PII}`, issuedOn: "2026-01-01", expiresOn: "2029-01-01" },
  });
  await db.collection("proctors").insertOne({
    _id: proctorId,
    name: "Pavan Proctor",
    email: `pavan${PII}@example.com`,
    active: true,
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
        consentRecorded: true,
      },
      shown: ["id", "kind", "name", "roleLabel", "sector", "photoRef"],
    },
    "sample-papers": {
      body: {
        title: "Electrician paper 1",
        qualificationId: String(qualificationId),
        fileRef: "https://files.example/papers/el-1.pdf",
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
        consentRecorded: true,
      },
      shown: ["id", "kind", "title", "body", "memberName", "memberRole", "fileRef"],
    },
    "office-documents": {
      body: {
        category: "lease",
        title: "Lease agreement",
        fileRef: "https://files.example/docs/lease.pdf",
      },
      shown: ["id", "category", "title", "note", "fileRef", "proofOnFile"],
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
    resetRegistryIdCache();
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

    it("lets aa_admin publish, mis draft only, and everyone else nothing", async () => {
      const admin = await sessionFor("aa_admin");
      const mis = await sessionFor("mis");
      const item = await post(admin.token, "team-members", samples()["team-members"].body);

      // aa_admin and mis can list and read
      expect((await adminGet(admin.token, "team-members")).status).toBe(200);
      expect((await adminGet(mis.token, "team-members")).status).toBe(200);
      expect((await adminGet(admin.token, `team-members/${item.body.id}`)).status).toBe(200);
      expect((await adminGet(mis.token, `team-members/${item.body.id}`)).status).toBe(200);

      // mis can create draft
      const misDraft = await post(mis.token, "team-members", samples()["team-members"].body);
      expect(misDraft.status).toBe(201);
      expect(misDraft.body.published).toBe(false);

      // mis can edit draft
      const misEdit = await patch(mis.token, "team-members", misDraft.body.id, {
        name: "Edited Draft",
      });
      expect(misEdit.status).toBe(200);

      // mis CANNOT set published: true on create or update
      const misPublishCreate = await post(mis.token, "team-members", {
        ...samples()["team-members"].body,
        published: true,
      });
      expect(misPublishCreate.status).toBe(403);

      const misPublishPatch = await patch(mis.token, "team-members", misDraft.body.id, {
        published: true,
      });
      expect(misPublishPatch.status).toBe(403);

      // Once published by admin, mis cannot edit it
      await patch(admin.token, "team-members", item.body.id, { published: true });
      const misEditPublished = await patch(mis.token, "team-members", item.body.id, {
        name: "Forbidden Edit",
      });
      expect(misEditPublished.status).toBe(403);

      // Other roles get 403 on everything
      for (const role of USER_ROLES) {
        if (role === "aa_admin" || role === "mis") continue;
        const s = await sessionFor(role);
        expect((await adminGet(s.token, "team-members")).status, `${role} list`).toBe(403);
        expect(
          (await adminGet(s.token, `team-members/${item.body.id}`)).status,
          `${role} get`,
        ).toBe(403);
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
        consentRecorded: true,
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
            ? {
                kind: "proctor",
                registryId: String(proctorId),
                roleLabel: "DRAFT-ONLY",
                consentRecorded: true,
              }
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
        fileRef: "https://files.example/a",
        published: true,
      });
      await post(admin.token, "office-documents", {
        category: "electricity_bill",
        title: "E",
        fileRef: "https://files.example/b",
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
        consentRecorded: true,
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

  describe("B-16 publish rules and hardening", () => {
    it("refuses publishing people without consentRecorded with 409 CONSENT_REQUIRED", async () => {
      const admin = await sessionFor("aa_admin");

      // Creating people without consentRecorded fails validation (400)
      const missingConsent = await post(admin.token, "people", {
        kind: "assessor",
        registryId: String(assessorId),
        roleLabel: "Assessor",
      });
      expect(missingConsent.status).toBe(400);

      // Creating people draft with consentRecorded: false is allowed
      const draft = await post(admin.token, "people", {
        kind: "assessor",
        registryId: String(assessorId),
        roleLabel: "Assessor",
        consentRecorded: false,
        consentNote: "Consent pending confirmation",
      });
      expect(draft.status).toBe(201);
      expect(draft.body.consentRecorded).toBe(false);

      // Attempting to publish without consent returns 409 CONSENT_REQUIRED
      const tryPublish = await patch(admin.token, "people", draft.body.id, { published: true });
      expect(tryPublish.status).toBe(409);
      expect(tryPublish.body.error.code).toBe("CONSENT_REQUIRED");

      // Also directly creating with published: true and consentRecorded: false returns 409
      // (Using proctor to avoid duplicate registryId error)
      const directPublish = await post(admin.token, "people", {
        kind: "proctor",
        registryId: String(proctorId),
        roleLabel: "Proctor",
        consentRecorded: false,
        published: true,
      });
      expect(directPublish.status).toBe(409);
      expect(directPublish.body.error.code).toBe("CONSENT_REQUIRED");

      // Updating consentRecorded to true allows publishing
      const okPublish = await patch(admin.token, "people", draft.body.id, {
        consentRecorded: true,
        published: true,
      });
      expect(okPublish.status).toBe(200);
      expect(okPublish.body.published).toBe(true);
    });

    it("refuses publishing POSH committee members without consentRecorded with 409 CONSENT_REQUIRED", async () => {
      const admin = await sessionFor("aa_admin");

      // POSH committee member without consent cannot be published
      const poshFail = await post(admin.token, "posh", {
        kind: "committee_member",
        title: "Internal Committee",
        memberName: "Sunita S.",
        consentRecorded: false,
        published: true,
      });
      expect(poshFail.status).toBe(409);
      expect(poshFail.body.error.code).toBe("CONSENT_REQUIRED");

      // POSH policy can be published without consentRecorded
      const policyOk = await post(admin.token, "posh", {
        kind: "policy",
        title: "POSH Policy 2026",
        body: "Policy text",
        published: true,
      });
      expect(policyOk.status).toBe(201);
      expect(policyOk.body.published).toBe(true);

      // Committee member with consent can be published
      const memberOk = await post(admin.token, "posh", {
        kind: "committee_member",
        title: "External Member",
        memberName: "Dr. Rita",
        consentRecorded: true,
        published: true,
      });
      expect(memberOk.status).toBe(201);
      expect(memberOk.body.published).toBe(true);
    });

    it("automatically hides people from public endpoints when registry record is inactive or ToA expired", async () => {
      const admin = await sessionFor("aa_admin");
      const db = mongoose.connection.db;

      // Ensure assessor is active and valid
      await db
        .collection("assessors")
        .updateOne({ _id: assessorId }, { $set: { active: true, "toa.expiresOn": "2029-01-01" } });

      const person = await post(admin.token, "people", {
        kind: "assessor",
        registryId: String(assessorId),
        roleLabel: "Assessor",
        consentRecorded: true,
        published: true,
      });
      expect(person.status).toBe(201);

      // Public endpoint displays the assessor
      resetRegistryIdCache();
      let pubRes = await pub("people");
      expect(pubRes.body.items.map((r) => r.id)).toContain(person.body.id);

      // 1. Mark assessor inactive in registry
      await db.collection("assessors").updateOne({ _id: assessorId }, { $set: { active: false } });
      resetRegistryIdCache();
      pubRes = await pub("people");
      expect(pubRes.body.items.map((r) => r.id)).not.toContain(person.body.id);

      // Stored published flag in admin remains true
      const adminGetRes = await adminGet(admin.token, `people/${person.body.id}`);
      expect(adminGetRes.body.published).toBe(true);

      // 2. Reactivate assessor, but expire ToA
      await db
        .collection("assessors")
        .updateOne({ _id: assessorId }, { $set: { active: true, "toa.expiresOn": "2020-01-01" } });
      resetRegistryIdCache();
      pubRes = await pub("people");
      expect(pubRes.body.items.map((r) => r.id)).not.toContain(person.body.id);

      // 3. Renew ToA -> person is shown again
      await db
        .collection("assessors")
        .updateOne({ _id: assessorId }, { $set: { "toa.expiresOn": "2029-01-01" } });
      resetRegistryIdCache();
      pubRes = await pub("people");
      expect(pubRes.body.items.map((r) => r.id)).toContain(person.body.id);

      // 4. Test proctor inactive hiding
      const proctorPerson = await post(admin.token, "people", {
        kind: "proctor",
        registryId: String(proctorId),
        roleLabel: "Proctor",
        consentRecorded: true,
        published: true,
      });
      resetRegistryIdCache();
      pubRes = await pub("people");
      expect(pubRes.body.items.map((r) => r.id)).toContain(proctorPerson.body.id);

      await db.collection("proctors").updateOne({ _id: proctorId }, { $set: { active: false } });
      resetRegistryIdCache();
      pubRes = await pub("people");
      expect(pubRes.body.items.map((r) => r.id)).not.toContain(proctorPerson.body.id);
    });

    it("allows memberName and memberRole only for committee members", async () => {
      const admin = await sessionFor("aa_admin");
      const policyName = await post(admin.token, "posh", {
        kind: "policy",
        title: "Policy",
        memberName: "Meera",
      });
      expect(policyName.status).toBe(400);
      const policyRole = await post(admin.token, "posh", {
        kind: "policy",
        title: "Policy",
        memberRole: "Chair",
      });
      expect(policyRole.status).toBe(400);
      expect((await post(admin.token, "posh", { kind: "policy", title: "Policy" })).status).toBe(
        201,
      );
      const member = await post(admin.token, "posh", samples().posh.body);
      expect(member.status).toBe(201);
      expect((await patch(admin.token, "posh", member.body.id, { kind: "policy" })).status).toBe(
        400,
      );
    });

    it("accepts only http or https for photoRef, logoRef and fileRef", async () => {
      const admin = await sessionFor("aa_admin");
      const bad = ["javascript:alert(1)", "data:text/html,x", "papers/a.pdf", "ftp://x.example/a"];
      for (const value of bad) {
        expect(
          (
            await post(admin.token, "team-members", {
              ...samples()["team-members"].body,
              photoRef: value,
            })
          ).status,
        ).toBe(400);
        expect(
          (await post(admin.token, "industry-linkages", { name: "N", logoRef: value })).status,
        ).toBe(400);
        expect(
          (
            await post(admin.token, "office-documents", {
              category: "lease",
              title: "L",
              fileRef: value,
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (
          await post(admin.token, "team-members", {
            ...samples()["team-members"].body,
            photoRef: "https://img.example/a.jpg",
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await post(admin.token, "industry-linkages", {
            name: "N",
            logoRef: "http://x.example/l.png",
          })
        ).status,
      ).toBe(201);
    });

    it("caps the public page number at 100", async () => {
      expect((await pub("team-members?page=100")).status).toBe(200);
      expect((await pub("team-members?page=101")).status).toBe(400);
    });

    it("reuses the active registry id set for 60 seconds", async () => {
      const admin = await sessionFor("aa_admin");
      const person = await post(admin.token, "people", {
        ...samples().people.body,
        published: true,
      });
      expect(person.status).toBe(201);
      resetRegistryIdCache();
      expect((await pub("people")).body.total).toBe(1);
      await mongoose.connection.db
        .collection("assessors")
        .updateOne({ _id: assessorId }, { $set: { active: false } });
      expect((await pub("people")).body.total).toBe(1);
      resetRegistryIdCache();
      expect((await pub("people")).body.total).toBe(0);
    });

    it("replaces hard delete with unpublish and archived flag", async () => {
      const admin = await sessionFor("aa_admin");
      const created = await post(admin.token, "team-members", {
        name: "Archive Test Member",
        designation: "Consultant",
        published: true,
      });
      const id = created.body.id;

      // DELETE sets archived: true and published: false
      const del = await request(app).delete(`${ADMIN}/team-members/${id}`).set(bearer(admin.token));
      expect(del.status).toBe(204);

      // Admin get returns 404
      const getRes = await adminGet(admin.token, `team-members/${id}`);
      expect(getRes.status).toBe(404);

      // Hidden from default admin list
      const defaultList = await adminGet(admin.token, "team-members");
      expect(defaultList.body.items.map((r) => r.id)).not.toContain(id);

      // Present in admin list when ?archived=true
      const archivedList = await adminGet(admin.token, "team-members?archived=true");
      expect(archivedList.body.items.map((r) => r.id)).toContain(id);
      const archivedItem = archivedList.body.items.find((r) => r.id === id);
      expect(archivedItem.archived).toBe(true);
      expect(archivedItem.published).toBe(false);

      // Never visible on public endpoint
      const pubList = await pub("team-members");
      expect(pubList.body.items.map((r) => r.id)).not.toContain(id);
    });

    it("shows proofOnFile marker and nulls fileRef publicly for utility bill office documents", async () => {
      const admin = await sessionFor("aa_admin");

      // Create utility bill doc
      const elec = await post(admin.token, "office-documents", {
        category: "electricity_bill",
        title: "Office Electricity 2026",
        fileRef: "https://files.example/bills/electricity-jan.pdf",
        published: true,
      });
      expect(elec.status).toBe(201);
      // Admin sees fileRef
      expect(elec.body.fileRef).toBe("https://files.example/bills/electricity-jan.pdf");

      // Create non-utility doc
      const lease = await post(admin.token, "office-documents", {
        category: "lease",
        title: "Office Lease Agreement",
        fileRef: "https://files.example/docs/lease-2026.pdf",
        published: true,
      });
      expect(lease.status).toBe(201);
      expect(lease.body.fileRef).toBe("https://files.example/docs/lease-2026.pdf");

      // Check public endpoint
      const pubDocs = await pub("office-documents");
      const pubElec = pubDocs.body.items.find((d) => d.id === elec.body.id);
      expect(pubElec).toBeDefined();
      expect(pubElec.proofOnFile).toBe(true);
      expect(pubElec.fileRef).toBeNull();

      const pubLease = pubDocs.body.items.find((d) => d.id === lease.body.id);
      expect(pubLease).toBeDefined();
      expect(pubLease.proofOnFile).toBe(false);
      expect(pubLease.fileRef).toBe("https://files.example/docs/lease-2026.pdf");
    });
  });

  describe("60-second cache for people and POSH (D7)", () => {
    it("sends max-age=60 for people and posh and 300 for the others", async () => {
      for (const slug of ["people", "posh"]) {
        expect((await pub(slug)).headers["cache-control"]).toBe("public, max-age=60");
      }
      for (const slug of RESOURCE_SLUGS.filter((s) => !["people", "posh"].includes(s))) {
        expect((await pub(slug)).headers["cache-control"], slug).toBe("public, max-age=300");
      }
    });

    it.each(["people", "posh"])(
      "serves %s from memory and drops it when an admin changes it",
      async (slug) => {
        const admin = await sessionFor("aa_admin");
        const made = await post(admin.token, slug, { ...samples()[slug].body, published: true });
        expect(made.status, JSON.stringify(made.body)).toBe(201);
        expect((await pub(slug)).body.total).toBe(1);

        // A change made behind the API's back is not seen until the 60 seconds pass.
        await MODELS[slug].updateMany({}, { $set: { published: false } });
        expect((await pub(slug)).body.total).toBe(1);

        // An admin change through the API clears the cached pages at once.
        const patched = await patch(admin.token, slug, made.body.id, { published: false });
        expect(patched.status).toBe(200);
        expect((await pub(slug)).body.total).toBe(0);
        await patch(admin.token, slug, made.body.id, { published: true });
        expect((await pub(slug)).body.total).toBe(1);
      },
    );

    it("clears the cache on delete and keeps other sections out of it", async () => {
      const admin = await sessionFor("aa_admin");
      const made = await post(admin.token, "posh", { ...samples().posh.body, published: true });
      expect((await pub("posh")).body.total).toBe(1);
      const del = await request(app)
        .delete(`${ADMIN}/posh/${made.body.id}`)
        .set(bearer(admin.token));
      expect(del.status).toBe(204);
      expect((await pub("posh")).body.total).toBe(0);
    });

    it("keeps pages for different queries apart", async () => {
      const admin = await sessionFor("aa_admin");
      await post(admin.token, "people", { ...samples().people.body, published: true });
      expect((await pub("people?kind=proctor")).body.total).toBe(0);
      expect((await pub("people?kind=assessor")).body.total).toBe(1);
    });
  });
});
