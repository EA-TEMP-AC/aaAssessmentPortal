import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { Assessor } from "../src/models/assessor.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Evidence } from "../src/models/evidence.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { createLocalStorage } from "../src/modules/evidence/storage/local.driver.js";
import { createS3Storage } from "../src/modules/evidence/storage/s3.driver.js";
import { setEvidenceStorage } from "../src/modules/evidence/storage/storage.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const MB = 1024 * 1024;
const CAPTURED_AT = "2026-11-20T05:00:00.000Z";

const jpeg = (extra = 64) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]);
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 3),
  ]);
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const mp4 = (extra = 64) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(extra, 1)]);
const exe = () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100, 9)]);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

let storageDir;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}) {
  const email = `${role}-${oid()}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: String(user._id) };
}

async function world(overrides = {}) {
  const ab = await AwardingBody.create({
    name: "AB One",
    code: `AB-${++abCounter}`,
    notificationEmails: [`ab${abCounter + 1}@ab.example`],
    active: true,
  });
  const assessor = await Assessor.create({ name: "Ravi Assessor", code: `ASR-${++abCounter}` });
  const proctor = await Proctor.create({ name: "Priya Proctor", code: `PRC-${abCounter}` });
  const batch = await Batch.create({
    abId: ab._id,
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId: oid(),
    centreId: oid(),
    candidateCount: 1,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Hindi",
    state: "Maharashtra",
    status: "in_progress",
    statusVersion: 3,
    assessorId: assessor._id,
    proctorId: proctor._id,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...overrides,
  });
  const learnerId = oid();
  const candidate = await Candidate.create({
    batchId: batch._id,
    learnerId,
    name: "Asha Devi",
    active: true,
  });
  const assessorSession = await sessionFor("assessor", { linkedProfileId: assessor._id });
  const proctorSession = await sessionFor("proctor", { linkedProfileId: proctor._id });
  const admin = await sessionFor("aa_admin");
  return {
    ab,
    assessor,
    proctor,
    batch,
    candidate,
    learnerId,
    assessorSession,
    proctorSession,
    admin,
  };
}

let eventCounter = 0;
let abCounter = 0;
function upload(
  token,
  batchId,
  { file = jpeg(), filename = "photo.jpg", type = "image/jpeg", fields = {} } = {},
) {
  const all = {
    clientEventId: `evt-${++eventCounter}`,
    kind: "photo",
    capturedAt: CAPTURED_AT,
    latitude: "19.0760",
    longitude: "72.8777",
    accuracy: "12.5",
    deviceId: "dev-9f3a",
    ...fields,
  };
  let req = request(app).post(`/api/v1/batches/${batchId}/evidence`).set(bearer(token));
  for (const [key, value] of Object.entries(all)) {
    if (value !== undefined && value !== null) req = req.field(key, String(value));
  }
  if (file) req = req.attach("file", file, { filename, contentType: type });
  return req;
}

describe("evidence vault", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([Evidence.syncIndexes(), AuditLog.syncIndexes(), AccessLog.syncIndexes()]);
    storageDir = mkdtempSync(path.join(os.tmpdir(), "aa-evidence-test-"));
    setEvidenceStorage(createLocalStorage({ dir: storageDir }));
  });

  afterAll(async () => {
    setEvidenceStorage(undefined);
    rmSync(storageDir, { recursive: true, force: true });
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    rmSync(path.join(storageDir, "evidence"), { recursive: true, force: true });
  });

  describe("upload", () => {
    it("stores the file under a random key and records checksum, size and both clocks", async () => {
      const w = await world();
      const file = jpeg(500);
      const res = await upload(w.assessorSession.token, w.batch._id, {
        file,
        filename: "../../my secret name.jpg",
        fields: { candidateId: String(w.candidate._id) },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        batchId: String(w.batch._id),
        candidateId: String(w.candidate._id),
        kind: "photo",
        contentType: "image/jpeg",
        size: file.length,
        sha256: sha(file),
        uploaderId: w.assessorSession.userId,
        uploaderRole: "assessor",
        capturedAt: CAPTURED_AT,
        locationStatus: "captured",
        latitude: 19.076,
        longitude: 72.8777,
        accuracy: 12.5,
        hasLocation: true,
        deviceId: "dev-9f3a",
        replayed: false,
      });
      expect(Math.abs(Date.now() - Date.parse(res.body.uploadedAt))).toBeLessThan(60_000);
      expect(res.body.uploadedAt).not.toBe(res.body.capturedAt);
      expect(res.body.storageKey).toBeUndefined();
      expect(res.body.payloadHash).toBeUndefined();

      const row = await Evidence.findById(res.body.id).lean();
      expect(row.storageKey).toMatch(/^evidence\/[0-9a-f-]{36}\.jpg$/);
      expect(row.storageKey).not.toContain("secret");
      const stored = readdirSync(path.join(storageDir, "evidence"));
      expect(stored).toHaveLength(1);
      expect(stored[0]).not.toContain("secret");
    });

    it("audits the upload with metadata and no file contents", async () => {
      const w = await world();
      const res = await upload(w.proctorSession.token, w.batch._id, {
        file: pdf(),
        type: "application/pdf",
        fields: { kind: "attendance" },
      });
      expect(res.status).toBe(201);
      const rows = await AuditLog.find({ action: "evidence.upload" }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].entityId).toBe(res.body.id);
      expect(rows[0].actorRole).toBe("proctor");
      expect(JSON.stringify(rows[0])).not.toContain("%PDF");
      expect(rows[0].meta.sha256).toBe(res.body.sha256);
    });

    it("keeps exact latitude, longitude and deviceId out of the audit row", async () => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id);
      expect(res.status).toBe(201);
      expect(res.body.latitude).toBe(19.076);
      const row = await AuditLog.findOne({ action: "evidence.upload" }).lean();
      const json = JSON.stringify(row);
      expect(json).not.toContain("19.076");
      expect(json).not.toContain("72.8777");
      expect(json).not.toContain("dev-9f3a");
      expect(row.after.hasLocation).toBe(true);
      expect(row.meta.requestBody).toBeUndefined();
    });

    it("returns the stored row for a repeated clientEventId and stores the file once", async () => {
      const w = await world();
      const file = jpeg(200);
      const first = await upload(w.assessorSession.token, w.batch._id, {
        file,
        fields: { clientEventId: "offline-1" },
      });
      const second = await upload(w.assessorSession.token, w.batch._id, {
        file,
        fields: { clientEventId: "offline-1" },
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.replayed).toBe(true);
      expect(await Evidence.countDocuments()).toBe(1);
      expect(readdirSync(path.join(storageDir, "evidence"))).toHaveLength(1);
      expect(await AuditLog.countDocuments({ action: "evidence.upload" })).toBe(1);
    });

    it("rejects the same clientEventId with a different file or different metadata", async () => {
      const w = await world();
      await upload(w.assessorSession.token, w.batch._id, {
        file: jpeg(200),
        fields: { clientEventId: "offline-2" },
      });
      const otherFile = await upload(w.assessorSession.token, w.batch._id, {
        file: jpeg(300),
        fields: { clientEventId: "offline-2" },
      });
      expectError(otherFile, 409, "CONFLICT_IDEMPOTENT");
      const otherMeta = await upload(w.assessorSession.token, w.batch._id, {
        file: jpeg(200),
        fields: { clientEventId: "offline-2", kind: "other" },
      });
      expectError(otherMeta, 409, "CONFLICT_IDEMPOTENT");
      const otherUser = await upload(w.admin.token, w.batch._id, {
        file: jpeg(200),
        fields: { clientEventId: "offline-2" },
      });
      expectError(otherUser, 409, "CONFLICT_IDEMPOTENT");
      expect(await Evidence.countDocuments()).toBe(1);
    });

    it("accepts a replay after the batch has been cancelled", async () => {
      const w = await world();
      const file = jpeg(100);
      await upload(w.assessorSession.token, w.batch._id, {
        file,
        fields: { clientEventId: "offline-3" },
      });
      await Batch.updateOne({ _id: w.batch._id }, { $set: { status: "cancelled" } });
      const again = await upload(w.assessorSession.token, w.batch._id, {
        file,
        fields: { clientEventId: "offline-3" },
      });
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
    });

    it("stores an id_proof with S3 server-side encryption on (D3)", async () => {
      const w = await world();
      const sent = [];
      const local = createLocalStorage({ dir: storageDir });
      setEvidenceStorage(
        createS3Storage({
          bucket: "aa-evidence",
          client: {
            send: async (command) => {
              sent.push(command.input);
              await local.put({ key: command.input.Key, body: command.input.Body });
              return {};
            },
          },
        }),
      );
      try {
        const res = await upload(w.assessorSession.token, w.batch._id, {
          fields: { kind: "id_proof" },
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ Bucket: "aa-evidence", ServerSideEncryption: "AES256" });
      } finally {
        setEvidenceStorage(createLocalStorage({ dir: storageDir }));
      }
    });

    it("accepts png, pdf and mp4 by their bytes", async () => {
      const w = await world();
      const token = w.assessorSession.token;
      const p = await upload(token, w.batch._id, {
        file: png(),
        filename: "a.png",
        type: "image/png",
      });
      const d = await upload(token, w.batch._id, {
        file: pdf(),
        filename: "a.pdf",
        type: "application/pdf",
        fields: { kind: "id_proof" },
      });
      const v = await upload(token, w.batch._id, {
        file: mp4(),
        filename: "a.mp4",
        type: "video/mp4",
        fields: { kind: "video" },
      });
      expect([p.status, d.status, v.status]).toEqual([201, 201, 201]);
      expect(p.body.contentType).toBe("image/png");
      expect(d.body.contentType).toBe("application/pdf");
      expect(v.body.contentType).toBe("video/mp4");
    });
  });

  describe("file type", () => {
    it("rejects an executable renamed to .jpg even when it claims image/jpeg", async () => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id, {
        file: exe(),
        filename: "photo.jpg",
      });
      expectError(res, 415, "UNSUPPORTED_FILE_TYPE");
      expect(await Evidence.countDocuments()).toBe(0);
    });

    it("rejects a text file renamed to .pdf and an mp4 with a QuickTime brand", async () => {
      const w = await world();
      const token = w.assessorSession.token;
      expectError(
        await upload(token, w.batch._id, {
          file: Buffer.from("hello"),
          filename: "x.pdf",
          type: "application/pdf",
        }),
        415,
        "UNSUPPORTED_FILE_TYPE",
      );
      const quicktime = Buffer.concat([
        Buffer.from([0, 0, 0, 0x14]),
        Buffer.from("ftypqt  "),
        Buffer.alloc(32),
      ]);
      expectError(
        await upload(token, w.batch._id, {
          file: quicktime,
          filename: "x.mp4",
          type: "video/mp4",
          fields: { kind: "video" },
        }),
        415,
        "UNSUPPORTED_FILE_TYPE",
      );
    });

    it("rejects a real file whose declared type is another supported type", async () => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id, {
        file: pdf(),
        type: "image/jpeg",
      });
      expectError(res, 415, "FILE_TYPE_MISMATCH");
    });

    it("rejects a kind that does not suit the file", async () => {
      const w = await world();
      const token = w.assessorSession.token;
      expectError(
        await upload(token, w.batch._id, {
          file: mp4(),
          type: "video/mp4",
          fields: { kind: "photo" },
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await upload(token, w.batch._id, { file: jpeg(), fields: { kind: "video" } }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("requires a file and refuses an empty one", async () => {
      const w = await world();
      expectError(
        await upload(w.assessorSession.token, w.batch._id, { file: null }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await upload(w.assessorSession.token, w.batch._id, { file: Buffer.alloc(0) }),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("size limits", () => {
    it("refuses by Content-Length before reading the body", async () => {
      const w = await world();
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      try {
        const status = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              port: server.address().port,
              method: "POST",
              path: `/api/v1/batches/${w.batch._id}/evidence`,
              headers: {
                ...bearer(w.assessorSession.token),
                "Content-Type": "multipart/form-data; boundary=x",
                "Content-Length": String(300 * MB),
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode);
              req.destroy();
            },
          );
          req.on("error", (err) => (err.code === "ECONNRESET" ? undefined : reject(err)));
          req.flushHeaders(); // headers only: the body is never sent
        });
        expect(status).toBe(413);
      } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
      expect(await Evidence.countDocuments()).toBe(0);
    });

    it("allows an image of exactly 25 MB and refuses one byte more", async () => {
      const w = await world();
      const token = w.assessorSession.token;
      const exact = Buffer.concat([jpeg(0), Buffer.alloc(25 * MB - 4, 1)]);
      expect(exact.length).toBe(25 * MB);
      expect((await upload(token, w.batch._id, { file: exact })).status).toBe(201);
      const over = Buffer.concat([jpeg(0), Buffer.alloc(25 * MB - 3, 1)]);
      expectError(await upload(token, w.batch._id, { file: over }), 413, "FILE_TOO_LARGE");
    });

    it("refuses a PDF over 25 MB but allows a video of 30 MB", async () => {
      const w = await world();
      const token = w.assessorSession.token;
      const bigPdf = Buffer.concat([pdf(), Buffer.alloc(25 * MB, 1)]);
      expectError(
        await upload(token, w.batch._id, {
          file: bigPdf,
          type: "application/pdf",
          fields: { kind: "other" },
        }),
        413,
        "FILE_TOO_LARGE",
      );
      const video = Buffer.concat([mp4(0), Buffer.alloc(30 * MB, 2)]);
      const ok = await upload(token, w.batch._id, {
        file: video,
        type: "video/mp4",
        fields: { kind: "video" },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });

    it("refuses a video over 200 MB", async () => {
      const w = await world();
      const huge = Buffer.concat([mp4(0), Buffer.alloc(200 * MB, 2)]);
      const res = await upload(w.assessorSession.token, w.batch._id, {
        file: huge,
        type: "video/mp4",
        fields: { kind: "video" },
      });
      expectError(res, 413, "FILE_TOO_LARGE");
      expect(await Evidence.countDocuments()).toBe(0);
    }, 60_000);
  });

  describe("location", () => {
    it("stores no location as not_provided", async () => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id, {
        fields: { latitude: undefined, longitude: undefined, accuracy: undefined },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        locationStatus: "not_provided",
        latitude: null,
        hasLocation: false,
      });
    });

    it("accepts unavailable with a reason and keeps the coordinates empty", async () => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id, {
        fields: {
          latitude: undefined,
          longitude: undefined,
          accuracy: undefined,
          locationStatus: "unavailable",
          locationUnavailableReason: "permission_denied",
        },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        locationStatus: "unavailable",
        locationUnavailableReason: "permission_denied",
        latitude: null,
        longitude: null,
        hasLocation: false,
      });
    });

    it.each([
      [
        "unavailable without a reason",
        {
          latitude: undefined,
          longitude: undefined,
          accuracy: undefined,
          locationStatus: "unavailable",
        },
      ],
      [
        "unavailable with coordinates",
        { locationStatus: "unavailable", locationUnavailableReason: "no_signal" },
      ],
      ["latitude without longitude", { longitude: undefined }],
      ["longitude without latitude", { latitude: undefined }],
      ["accuracy alone", { latitude: undefined, longitude: undefined }],
      ["a reason with a fix", { locationUnavailableReason: "no_signal" }],
      ["latitude out of range", { latitude: "91" }],
      ["longitude out of range", { longitude: "-181" }],
      ["negative accuracy", { accuracy: "-1" }],
      ["a non-numeric latitude", { latitude: "north" }],
    ])("rejects %s", async (_name, fields) => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id, { fields });
      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("rejects server-owned and unknown fields", async () => {
      const w = await world();
      const res = await upload(w.assessorSession.token, w.batch._id, {
        fields: { uploadedAt: CAPTURED_AT, sha256: "x" },
      });
      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("requires a capturedAt with an offset", async () => {
      const w = await world();
      expectError(
        await upload(w.assessorSession.token, w.batch._id, {
          fields: { capturedAt: "2026-11-20 10:00" },
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await upload(w.assessorSession.token, w.batch._id, { fields: { capturedAt: undefined } }),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("batch switches (X-30)", () => {
    it("drops the assessor's location when the batch switches assessor geolocation off", async () => {
      const w = await world();
      await Batch.updateOne(
        { _id: w.batch._id },
        { $set: { settings: { assessorGeolocation: false } } },
      );
      const res = await upload(w.assessorSession.token, w.batch._id);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        locationStatus: "not_provided",
        latitude: null,
        hasLocation: false,
      });
      await Batch.updateOne(
        { _id: w.batch._id },
        { $set: { "settings.assessorGeolocation": true } },
      );
      const again = await upload(w.assessorSession.token, w.batch._id);
      expect(again.body).toMatchObject({ locationStatus: "captured", hasLocation: true });
    });

    it("refuses video evidence only when both practical and viva video are off", async () => {
      const w = await world();
      const send = () =>
        upload(w.assessorSession.token, w.batch._id, {
          file: mp4(),
          filename: "a.mp4",
          type: "video/mp4",
          fields: { kind: "video" },
        });
      expect((await send()).status).toBe(201);
      await Batch.updateOne(
        { _id: w.batch._id },
        { $set: { settings: { allowPracticalVideo: false, allowVivaVideo: true } } },
      );
      expect((await send()).status).toBe(201);
      await Batch.updateOne(
        { _id: w.batch._id },
        { $set: { settings: { allowPracticalVideo: false, allowVivaVideo: false } } },
      );
      expectError(await send(), 409, "BATCH_FEATURE_OFF");
    });

    it("tags a video with its part and student, and respects each part's switch (X-40)", async () => {
      const w = await world();
      const send = (part, extra = {}) =>
        upload(w.assessorSession.token, w.batch._id, {
          file: mp4(),
          filename: "a.mp4",
          type: "video/mp4",
          fields: { kind: "video", part, candidateId: String(w.candidate._id), ...extra },
        });
      const ok = await send("practical");
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.part).toBe("practical");
      expect(ok.body.candidateId).toBe(String(w.candidate._id));
      await Batch.updateOne(
        { _id: w.batch._id },
        { $set: { settings: { allowPracticalVideo: false, allowVivaVideo: true } } },
      );
      expectError(await send("practical"), 409, "BATCH_FEATURE_OFF");
      expect((await send("viva")).status).toBe(201);
      // A part needs a student, only a video has a part, and a question needs a part.
      expectError(await send("viva", { candidateId: undefined }), 400, "VALIDATION_ERROR");
      expectError(
        await upload(w.assessorSession.token, w.batch._id, {
          fields: { part: "viva", candidateId: String(w.candidate._id) },
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(await send("viva", { questionId: String(oid()) }), 400, "VALIDATION_ERROR");
    });

    it("takes one video of a group of students (X-42)", async () => {
      const w = await world();
      const second = await Candidate.create({
        batchId: w.batch._id,
        learnerId: oid(),
        name: "Ravi Kumar",
        active: true,
      });
      const send = (ids, extra = {}) =>
        upload(w.assessorSession.token, w.batch._id, {
          file: mp4(),
          filename: "g.mp4",
          type: "video/mp4",
          fields: { kind: "video", part: "practical", candidateIds: ids, ...extra },
        });
      const both = `${w.candidate._id},${second._id}`;
      const ok = await send(both);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.candidateId).toBeNull();
      expect([...ok.body.candidateIds].sort()).toEqual(
        [String(w.candidate._id), String(second._id)].sort(),
      );
      // Listing a student's evidence includes the group video.
      const list = await request(app)
        .get(`/api/v1/evidence?candidateId=${second._id}`)
        .set(bearer(w.admin.token));
      expect(list.body.items.map((i) => i.id)).toContain(ok.body.id);
      expect(list.body.items[0].candidateNames).toContain("Ravi Kumar");
      // One student is not a group, a stranger is refused, and id and ids do not mix.
      expectError(await send(String(w.candidate._id)), 400, "VALIDATION_ERROR");
      expectError(await send(`${w.candidate._id},${oid()}`), 400, "VALIDATION_ERROR");
      expectError(
        await send(both, { candidateId: String(w.candidate._id) }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("takes OJT pictures only when the batch switch is on, and never from a candidate", async () => {
      const w = await world();
      const send = (token = w.assessorSession.token) =>
        upload(token, w.batch._id, {
          fields: {
            kind: "ojt_image",
            latitude: undefined,
            longitude: undefined,
            accuracy: undefined,
          },
        });
      expectError(await send(), 409, "BATCH_FEATURE_OFF");
      await Batch.updateOne({ _id: w.batch._id }, { $set: { settings: { allowOjtImages: true } } });
      const ok = await send();
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.kind).toBe("ojt_image");
      // A PDF is not a picture.
      const pdfRes = await upload(w.assessorSession.token, w.batch._id, {
        file: pdf(),
        filename: "a.pdf",
        type: "application/pdf",
        fields: {
          kind: "ojt_image",
          latitude: undefined,
          longitude: undefined,
          accuracy: undefined,
        },
      });
      expect(pdfRes.status).toBe(400);
    });
  });

  describe("who may upload", () => {
    it("lets aa_admin, the batch assessor and the batch proctor upload", async () => {
      const w = await world();
      for (const s of [w.admin, w.assessorSession, w.proctorSession]) {
        expect((await upload(s.token, w.batch._id)).status).toBe(201);
      }
    });

    it("refuses another assessor, another proctor and unrelated roles", async () => {
      const w = await world();
      const otherAssessor = await Assessor.create({ name: "Other", code: `ASR-${++abCounter}` });
      const otherProctor = await Proctor.create({ name: "Other", code: `PRC-${++abCounter}` });
      const a = await sessionFor("assessor", { linkedProfileId: otherAssessor._id });
      const p = await sessionFor("proctor", { linkedProfileId: otherProctor._id });
      expectError(await upload(a.token, w.batch._id), 403, "FORBIDDEN");
      expectError(await upload(p.token, w.batch._id), 403, "FORBIDDEN");
      for (const role of ["candidate", "tp", "mis", "ncvet_viewer", "sme"]) {
        const s = await sessionFor(role);
        expectError(await upload(s.token, w.batch._id), 403, "FORBIDDEN");
      }
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      expectError(await upload(reviewer.token, w.batch._id), 403, "FORBIDDEN");
      expect(await Evidence.countDocuments()).toBe(0);
    });

    it("needs a login and a known batch", async () => {
      const w = await world();
      const anon = await request(app).post(`/api/v1/batches/${w.batch._id}/evidence`);
      expect(anon.status).toBe(401);
      expectError(await upload(w.admin.token, oid()), 404, "NOT_FOUND");
    });

    it("refuses a candidateId from another batch", async () => {
      const w = await world();
      const stranger = await Candidate.create({
        batchId: oid(),
        learnerId: oid(),
        name: "Other",
        active: true,
      });
      const res = await upload(w.assessorSession.token, w.batch._id, {
        fields: { candidateId: String(stranger._id) },
      });
      expectError(res, 400, "VALIDATION_ERROR");
    });
  });

  describe("batch status", () => {
    it.each(["cancelled", "rejected"])("refuses uploads to a %s batch", async (status) => {
      const w = await world({ status });
      expectError(await upload(w.admin.token, w.batch._id), 409, "INVALID_TRANSITION");
      expect(await Evidence.countDocuments()).toBe(0);
    });

    it.each([
      "allocated",
      "accepted",
      "assessor_assigned",
      "assessment_completed",
      "result_submitted",
      "ab_validated",
      "published",
      "disputed",
    ])("accepts uploads to a %s batch", async (status) => {
      const w = await world({ status });
      expect((await upload(w.admin.token, w.batch._id)).status).toBe(201);
    });

    it("keeps the evidence readable after the batch is cancelled", async () => {
      const w = await world();
      const saved = await upload(w.assessorSession.token, w.batch._id);
      await Batch.updateOne({ _id: w.batch._id }, { $set: { status: "cancelled" } });
      const res = await request(app)
        .get(`/api/v1/evidence/${saved.body.id}`)
        .set(bearer(w.admin.token));
      expect(res.status).toBe(200);
    });
  });

  describe("reads", () => {
    it("scopes assessor and proctor to their own uploads", async () => {
      const w = await world();
      const mine = await upload(w.assessorSession.token, w.batch._id);
      const theirs = await upload(w.proctorSession.token, w.batch._id);

      const list = await request(app).get("/api/v1/evidence").set(bearer(w.assessorSession.token));
      expect(list.status).toBe(200);
      expect(list.body.items.map((i) => i.id)).toEqual([mine.body.id]);
      // X-11: rows also carry the batch in words and the candidate's name (null when not known).
      expect(list.body.items[0]).toHaveProperty("batchLabel");
      expect(list.body.items[0]).toHaveProperty("candidateName");
      expect(list.body.total).toBe(1);

      expect(
        (
          await request(app)
            .get(`/api/v1/evidence/${mine.body.id}`)
            .set(bearer(w.assessorSession.token))
        ).status,
      ).toBe(200);
      expectError(
        await request(app)
          .get(`/api/v1/evidence/${theirs.body.id}`)
          .set(bearer(w.assessorSession.token)),
        403,
        "FORBIDDEN",
      );
      expectError(
        await request(app)
          .get(`/api/v1/evidence/${theirs.body.id}/file`)
          .set(bearer(w.assessorSession.token)),
        403,
        "FORBIDDEN",
      );
      expect(await AccessLog.countDocuments()).toBe(0);
    });

    it("keeps the role scope when ?uploaderId= names another user", async () => {
      const w = await world();
      const mine = await upload(w.assessorSession.token, w.batch._id);
      await upload(w.proctorSession.token, w.batch._id);

      const other = await request(app)
        .get(`/api/v1/evidence?uploaderId=${w.proctorSession.userId}`)
        .set(bearer(w.assessorSession.token));
      expect(other.status).toBe(200);
      expect(other.body.items).toEqual([]);
      expect(other.body.total).toBe(0);

      const own = await request(app)
        .get(`/api/v1/evidence?uploaderId=${w.assessorSession.userId}`)
        .set(bearer(w.assessorSession.token));
      expect(own.body.items.map((i) => i.id)).toEqual([mine.body.id]);

      const proctorSide = await request(app)
        .get(`/api/v1/evidence?uploaderId=${w.assessorSession.userId}`)
        .set(bearer(w.proctorSession.token));
      expect(proctorSide.body.total).toBe(0);

      const admin = await request(app)
        .get(`/api/v1/evidence?uploaderId=${w.proctorSession.userId}`)
        .set(bearer(w.admin.token));
      expect(admin.body.total).toBe(1);
    });

    it("lets aa_admin, mis and ncvet_viewer read everything", async () => {
      const w = await world();
      await upload(w.assessorSession.token, w.batch._id);
      await upload(w.proctorSession.token, w.batch._id);
      for (const role of ["aa_admin", "mis", "ncvet_viewer"]) {
        const s = await sessionFor(role);
        const res = await request(app).get("/api/v1/evidence").set(bearer(s.token));
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
      }
    });

    it("limits ab_reviewer to its own awarding body", async () => {
      const w = await world();
      const saved = await upload(w.assessorSession.token, w.batch._id);
      const other = await AwardingBody.create({
        name: "AB Two",
        code: `AB-${++abCounter}`,
        notificationEmails: [`ab${abCounter + 1}@ab.example`],
        active: true,
      });
      const own = await sessionFor("ab_reviewer", { abId: w.ab._id });
      const foreign = await sessionFor("ab_reviewer", { abId: other._id });
      const noAb = await sessionFor("ab_reviewer");

      expect((await request(app).get("/api/v1/evidence").set(bearer(own.token))).body.total).toBe(
        1,
      );
      expect(
        (await request(app).get("/api/v1/evidence").set(bearer(foreign.token))).body.total,
      ).toBe(0);
      expect((await request(app).get("/api/v1/evidence").set(bearer(noAb.token))).body.total).toBe(
        0,
      );
      expect(
        (await request(app).get(`/api/v1/evidence/${saved.body.id}`).set(bearer(own.token))).status,
      ).toBe(200);
      expectError(
        await request(app).get(`/api/v1/evidence/${saved.body.id}`).set(bearer(foreign.token)),
        403,
        "FORBIDDEN",
      );
      expectError(
        await request(app).get(`/api/v1/evidence/${saved.body.id}/file`).set(bearer(foreign.token)),
        403,
        "FORBIDDEN",
      );
    });

    it("never serves candidate, tp or sme", async () => {
      const w = await world();
      const saved = await upload(w.assessorSession.token, w.batch._id);
      for (const role of ["candidate", "tp", "sme"]) {
        const s = await sessionFor(role);
        expectError(
          await request(app).get("/api/v1/evidence").set(bearer(s.token)),
          403,
          "FORBIDDEN",
        );
        expectError(
          await request(app).get(`/api/v1/evidence/${saved.body.id}`).set(bearer(s.token)),
          403,
          "FORBIDDEN",
        );
        expectError(
          await request(app).get(`/api/v1/evidence/${saved.body.id}/file`).set(bearer(s.token)),
          403,
          "FORBIDDEN",
        );
      }
    });

    it("filters by batch, candidate, kind, uploader, date range and location, with pages", async () => {
      const w = await world();
      const second = await world({ type: "LTT" });
      const t = w.assessorSession.token;
      await upload(t, w.batch._id, {
        fields: { capturedAt: "2026-11-20T04:00:00.000Z", candidateId: String(w.candidate._id) },
      });
      await upload(t, w.batch._id, {
        file: pdf(),
        type: "application/pdf",
        fields: {
          kind: "attendance",
          capturedAt: "2026-11-21T04:00:00.000Z",
          latitude: undefined,
          longitude: undefined,
          accuracy: undefined,
        },
      });
      await upload(w.admin.token, second.batch._id, {
        fields: { capturedAt: "2026-11-22T04:00:00.000Z" },
      });
      const get = (qs) => request(app).get(`/api/v1/evidence?${qs}`).set(bearer(w.admin.token));

      expect((await get(`batchId=${w.batch._id}`)).body.total).toBe(2);
      expect((await get(`batchId=${second.batch._id}`)).body.total).toBe(1);
      expect((await get(`candidateId=${w.candidate._id}`)).body.total).toBe(1);
      expect((await get("kind=attendance")).body.total).toBe(1);
      expect((await get(`uploaderId=${w.assessorSession.userId}`)).body.total).toBe(2);
      expect((await get("hasLocation=true")).body.total).toBe(2);
      expect((await get("hasLocation=false")).body.total).toBe(1);
      expect((await get("from=2026-11-21T00:00:00Z&to=2026-11-21T23:59:59Z")).body.total).toBe(1);
      const paged = await get("pageSize=2&page=2");
      expect(paged.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(paged.body.items).toHaveLength(1);
      const all = await get("");
      expect(all.body.items.map((i) => i.capturedAt)).toEqual([
        "2026-11-22T04:00:00.000Z",
        "2026-11-21T04:00:00.000Z",
        "2026-11-20T04:00:00.000Z",
      ]);
      expectError(await get("kind=nope"), 400, "VALIDATION_ERROR");
      expectError(await get("from=2026-12-01&to=2026-11-01"), 400, "VALIDATION_ERROR");
      expectError(await get("surprise=1"), 400, "VALIDATION_ERROR");
    });

    it("returns 404 for an unknown id and 400 for a malformed one", async () => {
      const w = await world();
      expectError(
        await request(app).get(`/api/v1/evidence/${oid()}`).set(bearer(w.admin.token)),
        404,
        "NOT_FOUND",
      );
      expectError(
        await request(app).get("/api/v1/evidence/abc").set(bearer(w.admin.token)),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("download and access log", () => {
    it("streams the file from local disk and logs the download", async () => {
      const w = await world();
      const file = jpeg(300);
      const saved = await upload(w.assessorSession.token, w.batch._id, {
        file,
        fields: { candidateId: String(w.candidate._id) },
      });
      const res = await request(app)
        .get(`/api/v1/evidence/${saved.body.id}/file`)
        .set(bearer(w.admin.token))
        .buffer(true)
        .parse((r, cb) => {
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-disposition"]).toContain(`evidence-${saved.body.id}.jpg`);
      expect(sha(res.body)).toBe(sha(file));

      const logs = await AccessLog.find().sort({ subjectType: 1 }).lean();
      expect(logs.map((l) => [l.subjectType, l.subjectId])).toEqual([
        ["evidence", saved.body.id],
        ["learner", String(w.learnerId)],
      ]);
      expect(logs[0]).toMatchObject({ kind: "detail", actorRole: "aa_admin", fields: ["file"] });
      expect(logs[0].actorId.toString()).toBe(w.admin.userId);
    });

    it("passes the inline flag to the link only for images and PDFs", async () => {
      const w = await world();
      const img = await upload(w.assessorSession.token, w.batch._id, {
        file: jpeg(300),
        fields: { candidateId: String(w.candidate._id) },
      });
      const local = createLocalStorage({ dir: storageDir });
      const seen = [];
      try {
        setEvidenceStorage({
          ...local,
          get: local.get,
          put: local.put,
          async signedUrl(key, options) {
            seen.push(options.inline);
            return "https://bucket.example/signed";
          },
        });
        const get = (query) =>
          request(app)
            .get(`/api/v1/evidence/${img.body.id}/file${query}`)
            .set(bearer(w.admin.token));
        expect((await get("")).body.url).toBe("https://bucket.example/signed");
        expect((await get("?inline=true")).status).toBe(200);
        expect((await get("?inline=false")).status).toBe(200);
        expect((await get("?inline=maybe")).status).toBe(400);
        expect((await get("?other=1")).status).toBe(400);
        expect(seen).toEqual([false, true, false]);
        await Evidence.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(img.body.id) },
          { $set: { contentType: "video/mp4" } },
        );
        expect((await get("?inline=true")).status).toBe(200);
        expect(seen.at(-1)).toBe(false);
      } finally {
        setEvidenceStorage(local);
      }
    });

    it("writes one entry per download", async () => {
      const w = await world();
      const saved = await upload(w.assessorSession.token, w.batch._id);
      const get = () =>
        request(app)
          .get(`/api/v1/evidence/${saved.body.id}/file`)
          .set(bearer(w.assessorSession.token));
      await get();
      await get();
      expect(await AccessLog.countDocuments({ subjectType: "evidence" })).toBe(2);
    });

    it("serves nothing when the access log cannot be written", async () => {
      const w = await world();
      const saved = await upload(w.assessorSession.token, w.batch._id);
      const spy = vi.spyOn(AccessLog, "insertMany").mockRejectedValueOnce(new Error("down"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await request(app)
        .get(`/api/v1/evidence/${saved.body.id}/file`)
        .set(bearer(w.admin.token));
      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/json/);
      spy.mockRestore();
      quiet.mockRestore();
    });

    it("can be read back through the access-log endpoint", async () => {
      const w = await world();
      const saved = await upload(w.assessorSession.token, w.batch._id);
      await request(app).get(`/api/v1/evidence/${saved.body.id}/file`).set(bearer(w.admin.token));
      const res = await request(app)
        .get(`/api/v1/audit/access-log?subjectType=evidence&subjectId=${saved.body.id}`)
        .set(bearer(w.admin.token));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });
  });

  describe("verify and integrity", () => {
    async function stored(w) {
      const file = jpeg(400);
      const saved = await upload(w.assessorSession.token, w.batch._id, { file });
      const row = await Evidence.findById(saved.body.id).lean();
      return { file, saved, fullPath: path.join(storageDir, row.storageKey) };
    }
    const verify = (token, id) =>
      request(app).post(`/api/v1/evidence/${id}/verify`).set(bearer(token));

    it("confirms an untouched file and records the result and an audit row", async () => {
      const w = await world();
      const { saved } = await stored(w);
      const res = await verify(w.admin.token, saved.body.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.verification).toMatchObject({
        result: "ok",
        byUserId: w.admin.userId,
        expectedSha256: saved.body.sha256,
        actualSha256: saved.body.sha256,
      });
      expect(res.body.verifyCount).toBe(1);
      const row = await Evidence.findById(saved.body.id).lean();
      expect(row.lastVerification.result).toBe("ok");
      const audit = await AuditLog.findOne({ action: "evidence.verify" }).lean();
      expect(audit.meta.result).toBe("ok");
    });

    it("detects a changed file", async () => {
      const w = await world();
      const { saved, fullPath } = await stored(w);
      writeFileSync(fullPath, Buffer.concat([jpeg(400).subarray(0, 100), Buffer.from("tampered")]));
      const res = await verify(w.admin.token, saved.body.id);
      expect(res.status).toBe(200);
      expect(res.body.verification.result).toBe("mismatch");
      expect(res.body.verification.actualSha256).not.toBe(saved.body.sha256);
      expect(res.body.verification.expectedSha256).toBe(saved.body.sha256);
      // The recorded checksum is never rewritten to match the tampered file.
      expect((await Evidence.findById(saved.body.id).lean()).sha256).toBe(saved.body.sha256);
    });

    it("detects a one-byte change of the same length", async () => {
      const w = await world();
      const { file, saved, fullPath } = await stored(w);
      const flipped = Buffer.from(file);
      flipped[200] ^= 0xff;
      writeFileSync(fullPath, flipped);
      expect((await verify(w.admin.token, saved.body.id)).body.verification.result).toBe(
        "mismatch",
      );
    });

    it("reports a missing file", async () => {
      const w = await world();
      const { saved, fullPath } = await stored(w);
      rmSync(fullPath);
      const res = await verify(w.admin.token, saved.body.id);
      expect(res.status).toBe(200);
      expect(res.body.verification.result).toBe("missing");
      const download = await request(app)
        .get(`/api/v1/evidence/${saved.body.id}/file`)
        .set(bearer(w.admin.token));
      expectError(download, 404, "NOT_FOUND");
    });

    it("is for aa_admin only", async () => {
      const w = await world();
      const { saved } = await stored(w);
      for (const token of [w.assessorSession.token, w.proctorSession.token]) {
        expectError(await verify(token, saved.body.id), 403, "FORBIDDEN");
      }
      for (const role of ["mis", "ncvet_viewer", "ab_reviewer", "candidate", "tp"]) {
        const s = await sessionFor(role, { abId: w.ab._id });
        expectError(await verify(s.token, saved.body.id), 403, "FORBIDDEN");
      }
      expectError(await verify(w.admin.token, oid()), 404, "NOT_FOUND");
    });

    it("offers no way to change or delete a file through the API", async () => {
      const w = await world();
      const { saved } = await stored(w);
      for (const method of ["put", "patch", "delete"]) {
        const res = await request(app)
          [method](`/api/v1/evidence/${saved.body.id}`)
          .set(bearer(w.admin.token));
        expect(res.status).toBe(404);
        const file = await request(app)
          [method](`/api/v1/evidence/${saved.body.id}/file`)
          .set(bearer(w.admin.token));
        expect(file.status).toBe(404);
      }
      expect(await Evidence.countDocuments()).toBe(1);
    });

    it("rejects edits and deletes of an evidence row at the model", async () => {
      const w = await world();
      const { saved } = await stored(w);
      const id = saved.body.id;
      await expect(
        Evidence.updateOne({ _id: id }, { $set: { sha256: "0".repeat(64) } }),
      ).rejects.toThrow("immutable");
      await expect(Evidence.findOneAndUpdate({ _id: id }, { $set: { size: 1 } })).rejects.toThrow(
        "immutable",
      );
      await expect(Evidence.updateMany({}, { $set: { kind: "other" } })).rejects.toThrow(
        "immutable",
      );
      await expect(Evidence.deleteOne({ _id: id })).rejects.toThrow("immutable");
      await expect(Evidence.deleteMany({})).rejects.toThrow("immutable");
      await expect(Evidence.findByIdAndDelete(id)).rejects.toThrow("immutable");
      const doc = await Evidence.findById(id);
      doc.size = 5;
      await expect(doc.save()).rejects.toThrow("immutable");
      expect(await Evidence.countDocuments()).toBe(1);
    });
  });
});
