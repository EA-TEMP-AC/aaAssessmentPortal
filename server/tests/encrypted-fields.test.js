import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { looksEncrypted } from "../src/lib/field-crypto.js";
import { Assessor } from "../src/models/assessor.model.js";
import { Learner } from "../src/models/learner.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { User } from "../src/models/user.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

function raw(model, id) {
  return model.collection.findOne({ _id: id });
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function adminToken() {
  const { password } = await createUser({ email: "admin@aa.example" });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: "admin@aa.example", password, device: webDevice });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

describe("field-level encryption at rest", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([User.init(), Assessor.init(), Proctor.init(), Learner.init()]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("stores a user's email as ciphertext with a lookup hash, and reads it back", async () => {
    const { user } = await createUser({ email: "Asha@Example.com" });
    const stored = await raw(User, user._id);
    expect(looksEncrypted(stored.email)).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/asha@example/i);
    expect(stored.emailHash).toMatch(/^[0-9a-f]{64}$/);

    expect(user.email).toBe("asha@example.com");
    const hydrated = await User.findById(user._id);
    expect(hydrated.email).toBe("asha@example.com");
    expect(hydrated.toObject().email).toBe("asha@example.com");
    expect(hydrated.toJSON()).not.toHaveProperty("emailHash");
    const lean = await User.findById(user._id).lean();
    expect(lean.email).toBe("asha@example.com");
    expect(lean).not.toHaveProperty("emailHash");
  });

  it("finds users by email through the hash, ignoring case and spaces", async () => {
    const { user } = await createUser({ email: "asha@example.com" });
    for (const probe of ["asha@example.com", "ASHA@example.com", "  asha@example.com "]) {
      const found = await User.findOne({ email: probe }).lean();
      expect(found?._id.toString()).toBe(user._id.toString());
    }
    expect(await User.findOne({ email: "nobody@example.com" })).toBeNull();
    expect(
      await User.countDocuments({ email: { $in: ["asha@example.com", "x@example.com"] } }),
    ).toBe(1);
    expect(
      await User.countDocuments({ $or: [{ email: "asha@example.com" }, { role: "mis" }] }),
    ).toBe(1);
  });

  it("keeps email unique through the hash column", async () => {
    await createUser({ email: "dup@example.com" });
    await expect(createUser({ email: "DUP@example.com" })).rejects.toMatchObject({ code: 11000 });
    expect(await User.countDocuments({})).toBe(1);
  });

  it("encrypts on update and keeps the hash in step", async () => {
    const { user } = await createUser({ email: "old@example.com" });
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $set: { email: "New@Example.com", name: "Renamed" } },
      { new: true },
    ).lean();
    expect(updated.email).toBe("new@example.com");

    const stored = await raw(User, user._id);
    expect(looksEncrypted(stored.email)).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/new@example/i);
    expect(await User.findOne({ email: "old@example.com" })).toBeNull();
    expect((await User.findOne({ email: "new@example.com" }))._id.toString()).toBe(
      user._id.toString(),
    );

    await User.updateOne({ _id: user._id }, { email: "top@example.com" });
    expect(await User.findOne({ email: "top@example.com" })).not.toBeNull();
  });

  it("upserts through the hash (the seed does this)", async () => {
    const update = {
      $set: { email: "seed@aa.example", name: "Seed", role: "mis", passwordHash: "x" },
    };
    await User.updateOne({ email: "seed@aa.example" }, update, { upsert: true });
    await User.updateOne({ email: "seed@aa.example" }, update, { upsert: true });
    expect(await User.countDocuments({})).toBe(1);
    const stored = await User.collection.findOne({});
    expect(looksEncrypted(stored.email)).toBe(true);
    expect((await User.findOne({ email: "seed@aa.example" }).lean()).email).toBe("seed@aa.example");
  });

  it("encrypts when the document is saved after a change", async () => {
    const { user } = await createUser({ email: "save@example.com" });
    const doc = await User.findById(user._id);
    doc.email = "saved-again@example.com";
    await doc.save();
    const stored = await raw(User, user._id);
    expect(looksEncrypted(stored.email)).toBe(true);
    expect(doc.email).toBe("saved-again@example.com");
    expect(await User.countDocuments({ email: "saved-again@example.com" })).toBe(1);

    const other = await User.findById(user._id);
    other.name = "Only the name changed";
    await other.save();
    expect(await User.countDocuments({ email: "saved-again@example.com" })).toBe(1);
  });

  it("lets two assessors omit email, and clears email and hash together", async () => {
    await Assessor.create({ name: "A One", code: "A1" });
    await Assessor.create({ name: "A Two", code: "A2" });
    const withEmail = await Assessor.create({
      name: "A Three",
      code: "A3",
      email: "A3@Example.com",
    });
    expect(looksEncrypted((await raw(Assessor, withEmail._id)).email)).toBe(true);
    await expect(
      Assessor.create({ name: "A Four", code: "A4", email: "a3@example.com" }),
    ).rejects.toMatchObject({ code: 11000 });

    await Assessor.findOneAndUpdate({ _id: withEmail._id }, { $unset: { email: "" } });
    const cleared = await raw(Assessor, withEmail._id);
    expect(cleared).not.toHaveProperty("email");
    expect(cleared).not.toHaveProperty("emailHash");
    await Assessor.findOneAndUpdate({ _id: withEmail._id }, { $set: { email: null } });
    expect(await raw(Assessor, withEmail._id)).not.toHaveProperty("emailHash");
  });

  it("encrypts proctor email the same way", async () => {
    const proctor = await Proctor.create({ name: "P", email: "p@example.com" });
    expect(looksEncrypted((await raw(Proctor, proctor._id)).email)).toBe(true);
    expect((await Proctor.findOne({ email: "P@example.com" }).lean()).email).toBe("p@example.com");
  });

  it("encrypts a learner's phone and refuses to search on it", async () => {
    const learner = await Learner.create({ name: "Asha", phone: " 9000000001 " });
    const stored = await raw(Learner, learner._id);
    expect(looksEncrypted(stored.phone)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("9000000001");
    expect((await Learner.findById(learner._id).lean()).phone).toBe("9000000001");
    expect(() => Learner.find({ phone: "9000000001" })).not.toThrow();
    await expect(Learner.find({ phone: "9000000001" })).rejects.toThrow(/encrypted/);
    await expect(Learner.find({ phone: /^9000/ })).rejects.toThrow(/encrypted/);
  });

  it("encrypts a value that only looks like ciphertext instead of trusting it", async () => {
    const lookalike = "enc:v1:t1:AAAA:BBBB:CCCC";
    const learner = await Learner.create({ name: "Odd", phone: lookalike });
    const stored = await raw(Learner, learner._id);
    expect(stored.phone).not.toBe(lookalike);
    expect((await Learner.findById(learner._id).lean()).phone).toBe(lookalike);
  });

  it("reads rows that were stored before encryption was switched on", async () => {
    const { insertedId } = await Learner.collection.insertOne({
      name: "Legacy",
      phone: "9111111111",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await Learner.findById(insertedId).lean()).phone).toBe("9111111111");
    expect((await Learner.findById(insertedId)).phone).toBe("9111111111");
  });

  it("fails loudly, without leaking data, when a value cannot be decrypted", async () => {
    const learner = await Learner.create({ name: "Broken", phone: "9222222222" });
    const stored = await raw(Learner, learner._id);
    const parts = stored.phone.split(":");
    parts[5] = Buffer.from("tampered").toString("base64url");
    await Learner.collection.updateOne({ _id: learner._id }, { $set: { phone: parts.join(":") } });
    await expect(Learner.findById(learner._id).lean()).rejects.toThrow(/failed authentication/);
  });

  it("encrypts through insertMany", async () => {
    const [one] = await Learner.insertMany([{ name: "Bulk", phone: "9333333333" }]);
    expect(looksEncrypted((await raw(Learner, one._id)).phone)).toBe(true);
  });

  it("refuses operators that would corrupt ciphertext", async () => {
    const { user } = await createUser({ email: "op@example.com" });
    await expect(User.updateOne({ _id: user._id }, { $inc: { email: 1 } })).rejects.toThrow(
      /not supported/,
    );
    await expect(User.find({ email: { $regex: "^op" } })).rejects.toThrow(/not supported/);
  });

  describe("through the API", () => {
    it("encrypts phone and email on write, returns plain text, and logs in by email", async () => {
      const token = await adminToken();

      const learner = await request(app)
        .post("/api/v1/learners")
        .set(bearer(token))
        .send({ name: "Asha Devi", phone: "9876543210", externalRef: "TP-1" });
      expect(learner.status, JSON.stringify(learner.body)).toBe(201);
      expect(learner.body.phone).toBe("9876543210");
      const storedLearner = await Learner.collection.findOne({
        _id: new mongoose.Types.ObjectId(learner.body.id),
      });
      expect(looksEncrypted(storedLearner.phone)).toBe(true);

      const patched = await request(app)
        .patch(`/api/v1/learners/${learner.body.id}`)
        .set(bearer(token))
        .send({ phone: "9000000009" });
      expect(patched.body.phone).toBe("9000000009");
      const cleared = await request(app)
        .patch(`/api/v1/learners/${learner.body.id}`)
        .set(bearer(token))
        .send({ phone: null });
      expect(cleared.body.phone).toBeNull();

      const created = await request(app).post("/api/v1/users").set(bearer(token)).send({
        email: "Staff@Example.com",
        name: "Staff",
        role: "mis",
        password: "Temporary-Pass-1",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.email).toBe("staff@example.com");
      const storedUser = await User.collection.findOne({
        _id: new mongoose.Types.ObjectId(created.body.id),
      });
      expect(looksEncrypted(storedUser.email)).toBe(true);

      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "STAFF@example.com", password: "Temporary-Pass-1", device: webDevice });
      expect(login.status).toBe(200);
      expect(login.body.user.id).toBe(created.body.id);

      const duplicate = await request(app).post("/api/v1/users").set(bearer(token)).send({
        email: "staff@example.com",
        name: "Again",
        role: "mis",
        password: "Temporary-Pass-1",
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("DUPLICATE_RESOURCE");

      const duplicateAssessor = async (email) =>
        request(app)
          .post("/api/v1/assessors")
          .set(bearer(token))
          .send({ name: "Assessor", email, undertaking: true });
      const first = await duplicateAssessor("as@example.com");
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const second = await duplicateAssessor("AS@example.com");
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("DUPLICATE_RESOURCE");
      expect(JSON.stringify(first.body)).not.toContain("emailHash");
    });
  });
});
