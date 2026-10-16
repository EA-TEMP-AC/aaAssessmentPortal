import mongoose from "mongoose";
import { RETENTION_POLICY } from "../src/config/retention.js";
import { runRetentionDryRun } from "../src/modules/retention/retention.service.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

const now = new Date("2026-10-15T00:00:00Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

function rule(dataClass) {
  return RETENTION_POLICY.find((entry) => entry.dataClass === dataClass);
}

describe("retention policy", () => {
  it("lists every class once with a positive period and a real date field", () => {
    const names = RETENTION_POLICY.map((entry) => entry.dataClass);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of RETENTION_POLICY) {
      expect(Number.isInteger(entry.retentionDays) && entry.retentionDays > 0).toBe(true);
      expect(entry.collection).toBeTruthy();
      expect(entry.dateField).toBeTruthy();
      expect(typeof entry.containsPii).toBe("boolean");
    }
    expect(Object.isFrozen(RETENTION_POLICY)).toBe(true);
  });

  it("does not cover personal data classes with a zero or open-ended period", () => {
    for (const entry of RETENTION_POLICY.filter((item) => item.containsPii)) {
      expect(entry.retentionDays).toBeLessThanOrEqual(3650);
    }
  });
});

describe("retention dry run", () => {
  beforeAll(async () => {
    await startMongo();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("counts records past their period and deletes nothing", async () => {
    const db = mongoose.connection.db;
    const mail = rule("emailQueueDelivered").retentionDays;
    const learners = rule("inactiveLearners").retentionDays;
    await db.collection("emailQueue").insertMany([
      { status: "sent", updatedAt: daysAgo(mail + 5) },
      { status: "failed", updatedAt: daysAgo(mail + 50) },
      { status: "sent", updatedAt: daysAgo(mail - 5) },
      { status: "pending", updatedAt: daysAgo(mail + 500) },
    ]);
    await db.collection("learners").insertMany([
      { name: "old inactive", active: false, updatedAt: daysAgo(learners + 1) },
      { name: "old active", active: true, updatedAt: daysAgo(learners + 400) },
      { name: "new inactive", active: false, updatedAt: daysAgo(10) },
    ]);
    const before = {
      mail: await db.collection("emailQueue").countDocuments({}),
      learners: await db.collection("learners").countDocuments({}),
    };

    const report = await runRetentionDryRun({ now });

    const byClass = Object.fromEntries(report.classes.map((entry) => [entry.dataClass, entry]));
    expect(byClass.emailQueueDelivered.pastRetention).toBe(2);
    expect(byClass.emailQueueDelivered.oldest).toBe(daysAgo(mail + 50).toISOString());
    expect(byClass.inactiveLearners.pastRetention).toBe(1);
    expect(byClass.auditLogs.pastRetention).toBe(0);
    expect(byClass.auditLogs.oldest).toBeNull();
    expect(report).toMatchObject({ mode: "dry-run", deleted: 0, totalPastRetention: 3 });
    expect(report.classes).toHaveLength(RETENTION_POLICY.length);

    expect(await db.collection("emailQueue").countDocuments({})).toBe(before.mail);
    expect(await db.collection("learners").countDocuments({})).toBe(before.learners);
  });

  it("reports counts, not ids or field values, unless sample ids are requested", async () => {
    const db = mongoose.connection.db;
    const learners = rule("inactiveLearners").retentionDays;
    const { insertedId } = await db.collection("learners").insertOne({
      name: "Secret Name",
      phone: "9000000000",
      active: false,
      updatedAt: daysAgo(learners + 1),
    });

    const plain = await runRetentionDryRun({ now });
    expect(JSON.stringify(plain)).not.toContain("Secret Name");
    expect(JSON.stringify(plain)).not.toContain(insertedId.toString());

    const sampled = await runRetentionDryRun({ now, sampleIds: 5 });
    const entry = sampled.classes.find((item) => item.dataClass === "inactiveLearners");
    expect(entry.sampleIds).toEqual([insertedId.toString()]);
    expect(JSON.stringify(sampled)).not.toContain("Secret Name");
  });

  it("handles collections that do not exist yet and a custom policy", async () => {
    const report = await runRetentionDryRun({
      now,
      policy: [
        {
          dataClass: "ghost",
          collection: "doesNotExist",
          dateField: "createdAt",
          retentionDays: 1,
        },
      ],
    });
    expect(report.classes).toEqual([
      expect.objectContaining({ dataClass: "ghost", pastRetention: 0, containsPii: false }),
    ]);
  });

  it("lists id_proof and proctor_snapshot evidence past their period, and deletes nothing", async () => {
    const db = mongoose.connection.db;
    const idDays = rule("evidenceIdProof").retentionDays;
    const snapDays = rule("evidenceProctorSnapshot").retentionDays;
    expect(idDays).toBe(365);
    expect(snapDays).toBe(90);
    const { insertedIds } = await db.collection("evidence").insertMany([
      { kind: "id_proof", uploadedAt: daysAgo(idDays + 1) },
      { kind: "id_proof", uploadedAt: daysAgo(idDays - 1) },
      { kind: "proctor_snapshot", uploadedAt: daysAgo(snapDays + 30) },
      { kind: "proctor_snapshot", uploadedAt: daysAgo(snapDays + 1) },
      { kind: "proctor_snapshot", uploadedAt: daysAgo(snapDays - 1) },
      // Other kinds are not in these classes, however old.
      { kind: "photo", uploadedAt: daysAgo(5000) },
    ]);

    const report = await runRetentionDryRun({ now, sampleIds: 5 });
    const byClass = Object.fromEntries(report.classes.map((entry) => [entry.dataClass, entry]));
    expect(byClass.evidenceIdProof).toMatchObject({ pastRetention: 1, containsPii: true });
    expect(byClass.evidenceIdProof.sampleIds).toEqual([String(insertedIds[0])]);
    expect(byClass.evidenceProctorSnapshot.pastRetention).toBe(2);
    expect(byClass.evidenceProctorSnapshot.oldest).toBe(daysAgo(snapDays + 30).toISOString());
    expect(byClass.evidenceProctorSnapshot.sampleIds).toEqual([
      String(insertedIds[2]),
      String(insertedIds[3]),
    ]);
    expect(report.deleted).toBe(0);
    expect(await db.collection("evidence").countDocuments({})).toBe(6);
  });

  it("has no deleting code path", async () => {
    const mod = await import("../src/modules/retention/retention.service.js");
    expect(Object.keys(mod)).toEqual(["runRetentionDryRun"]);
  });
});
