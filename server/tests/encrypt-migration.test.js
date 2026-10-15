import crypto from "node:crypto";
import { configureFieldCrypto, keyIdOf, looksEncrypted } from "../src/lib/field-crypto.js";
import { Assessor } from "../src/models/assessor.model.js";
import { Learner } from "../src/models/learner.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { User } from "../src/models/user.model.js";
import { migrateEncryption } from "../src/scripts/encrypt-existing-data.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

const now = new Date("2026-01-01T00:00:00Z");

async function insertLegacy() {
  const users = await User.collection.insertMany([
    {
      email: "one@example.com",
      name: "One",
      role: "mis",
      active: true,
      passwordHash: "x",
      updatedAt: now,
    },
    {
      email: "two@example.com",
      name: "Two",
      role: "mis",
      active: true,
      passwordHash: "x",
      updatedAt: now,
    },
  ]);
  await Assessor.collection.insertMany([
    { name: "A", email: "a@example.com", updatedAt: now },
    { name: "No email", updatedAt: now },
  ]);
  await Proctor.collection.insertOne({ name: "P", email: "p@example.com", updatedAt: now });
  await Learner.collection.insertMany([
    { name: "L1", phone: "9000000001", updatedAt: now },
    { name: "L2", updatedAt: now },
  ]);
  return users;
}

describe("encryption migration", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([User.init(), Assessor.init(), Proctor.init(), Learner.init()]);
  });

  afterAll(async () => {
    configureFieldCrypto(null);
    await stopMongo();
  });

  beforeEach(async () => {
    configureFieldCrypto(null);
    await clearCollections();
  });

  it("encrypts existing rows, fills the hashes and is safe to run twice", async () => {
    await insertLegacy();

    const dry = await migrateEncryption({ dryRun: true });
    expect(dry.users).toMatchObject({ scanned: 2, encrypted: 2, hashed: 2, errors: [] });
    expect((await User.collection.findOne({ name: "One" })).email).toBe("one@example.com");

    const first = await migrateEncryption();
    expect(first.users).toMatchObject({ scanned: 2, encrypted: 2, hashed: 2, conflicts: 0 });
    expect(first.assessors).toMatchObject({ scanned: 2, encrypted: 1, unchanged: 1 });
    expect(first.proctors).toMatchObject({ scanned: 1, encrypted: 1 });
    expect(first.learners).toMatchObject({ scanned: 2, encrypted: 1, unchanged: 1 });

    const stored = await User.collection.findOne({ name: "One" });
    expect(looksEncrypted(stored.email)).toBe(true);
    expect(stored.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.updatedAt).toEqual(now);
    expect(looksEncrypted((await Learner.collection.findOne({ name: "L1" })).phone)).toBe(true);
    expect(await Learner.collection.findOne({ name: "L2" })).not.toHaveProperty("phone");

    expect((await User.findOne({ email: "ONE@example.com" }).lean()).name).toBe("One");
    expect((await Learner.findOne({ name: "L1" }).lean()).phone).toBe("9000000001");

    const second = await migrateEncryption();
    for (const stats of Object.values(second)) {
      expect(stats).toMatchObject({
        encrypted: 0,
        rotated: 0,
        hashed: 0,
        conflicts: 0,
        errors: [],
      });
    }
    expect(second.users.unchanged).toBe(2);
    expect(await User.collection.findOne({ name: "One" })).toEqual(stored);
  });

  it("replaces the old unique index on the plain path with the hash index", async () => {
    await User.collection.createIndex({ email: 1 }, { unique: true, name: "email_1" });
    await insertLegacy();

    const report = await migrateEncryption();
    expect(report.users.indexesDropped).toEqual(["email_1"]);
    const keys = (await User.collection.indexes()).map((index) => Object.keys(index.key)[0]);
    expect(keys).toContain("emailHash");
    expect(keys).not.toContain("email");
    expect((await migrateEncryption()).users.indexesDropped).toEqual([]);
  });

  it("repairs a missing hash on an already encrypted row", async () => {
    await insertLegacy();
    await migrateEncryption();
    await User.collection.updateMany({}, { $unset: { emailHash: "" } });

    const report = await migrateEncryption();
    expect(report.users).toMatchObject({ encrypted: 0, rotated: 0, hashed: 2 });
    expect(await User.findOne({ email: "two@example.com" })).not.toBeNull();
  });

  it("re-encrypts rows written under an older key id after a rotation", async () => {
    const k1 = crypto.randomBytes(32).toString("base64");
    const k2 = crypto.randomBytes(32).toString("base64");
    const hashKey = crypto.randomBytes(32).toString("base64");

    configureFieldCrypto({ keys: `k1:${k1}`, currentId: "k1", hashKey });
    await insertLegacy();
    await migrateEncryption();
    expect(keyIdOf((await User.collection.findOne({ name: "One" })).email)).toBe("k1");
    const hashBefore = (await User.collection.findOne({ name: "One" })).emailHash;

    configureFieldCrypto({ keys: `k1:${k1},k2:${k2}`, currentId: "k2", hashKey });
    const rotated = await migrateEncryption();
    expect(rotated.users).toMatchObject({ rotated: 2, encrypted: 0, hashed: 0 });
    expect(keyIdOf((await User.collection.findOne({ name: "One" })).email)).toBe("k2");
    expect((await User.collection.findOne({ name: "One" })).emailHash).toBe(hashBefore);

    configureFieldCrypto({ keys: `k2:${k2}`, currentId: "k2", hashKey });
    expect((await User.findOne({ email: "one@example.com" }).lean()).name).toBe("One");
  });

  it("reports unreadable rows without touching them and keeps the old index", async () => {
    await insertLegacy();
    await migrateEncryption();
    const k9 = crypto.randomBytes(32).toString("base64");
    configureFieldCrypto({
      keys: `k9:${k9}`,
      currentId: "k9",
      hashKey: crypto.randomBytes(32).toString("base64"),
    });
    await User.collection.createIndex({ email: 1 }, { name: "email_1" });
    const before = await User.collection.find({}).toArray();

    const report = await migrateEncryption();
    expect(report.users.errors).toHaveLength(2);
    expect(report.users.errors[0]).toMatchObject({ path: "email", code: "UNKNOWN_KEY" });
    expect(JSON.stringify(report)).not.toContain("example.com");
    expect(report.users.indexesDropped).toEqual([]);
    expect(await User.collection.find({}).toArray()).toEqual(before);
  });
});
