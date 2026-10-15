import mongoose from "mongoose";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { runScrubLogs } from "../src/scripts/scrub-logs.js";

describe("scrub-logs script", () => {
  beforeAll(async () => {
    await startMongo();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("masks historical raw emails and phones across audit, access, and email queue", async () => {
    const db = mongoose.connection.db;

    // 1. Seed auditLogs with plain text email & phone
    await db.collection("auditLogs").insertOne({
      action: "user.update",
      actorId: "000000000000000000000001",
      actorRole: "aa_admin",
      entity: "user",
      entityId: "000000000000000000000002",
      before: { email: "raw_old@example.com", phone: "9876543210" },
      after: { email: "raw_new@example.com", phone: "9123456789" },
      meta: { contactEmail: "admin@domain.com" },
      requestBody: { rawNote: "Call 9876543210 or email test@corp.org" },
      ip: "127.0.0.1",
      userAgent: "TestAgent",
      createdAt: new Date(),
    });

    // 2. Seed accessLogs with raw email / phone in subjectId
    await db.collection("accessLogs").insertOne({
      userId: "000000000000000000000001",
      role: "aa_admin",
      action: "read",
      resource: "users",
      subjectId: "john.doe@example.com",
      status: "success",
      ip: "127.0.0.1",
      userAgent: "TestAgent",
      createdAt: new Date(),
    });

    // 3. Seed emailQueue: one sent, one failed, one pending
    await db.collection("emailQueue").insertMany([
      {
        to: ["sent_recipient@example.com"],
        subject: "Sent notice",
        status: "sent",
        attempts: 1,
        createdAt: new Date(),
      },
      {
        to: ["failed_recipient@example.com"],
        subject: "Failed notice",
        status: "failed",
        attempts: 5,
        createdAt: new Date(),
      },
      {
        to: ["pending_recipient@example.com"],
        subject: "Pending notice",
        status: "pending",
        attempts: 0,
        createdAt: new Date(),
      },
    ]);

    // Test Dry Run
    const dryRunResult = await runScrubLogs({ dryRun: true });
    expect(dryRunResult.auditLogsScrubbed).toBe(1);
    expect(dryRunResult.accessLogsScrubbed).toBe(1);
    expect(dryRunResult.emailQueueScrubbed).toBe(2);

    // Verify nothing changed in dry run
    const auditBefore = await db.collection("auditLogs").findOne();
    expect(auditBefore.before.email).toBe("raw_old@example.com");

    const accessBefore = await db.collection("accessLogs").findOne();
    expect(accessBefore.subjectId).toBe("john.doe@example.com");

    const emailSentBefore = await db.collection("emailQueue").findOne({ status: "sent" });
    expect(emailSentBefore.to[0]).toBe("sent_recipient@example.com");

    // Test Real Run
    const liveRunResult = await runScrubLogs({ dryRun: false });
    expect(liveRunResult.auditLogsScrubbed).toBe(1);
    expect(liveRunResult.accessLogsScrubbed).toBe(1);
    expect(liveRunResult.emailQueueScrubbed).toBe(2);

    // Verify records are now masked
    const auditAfter = await db.collection("auditLogs").findOne();
    expect(auditAfter.before.email).toBe("r***@example.com");
    expect(auditAfter.before.phone).toBe("***-***-3210");
    expect(auditAfter.after.email).toBe("r***@example.com");
    expect(auditAfter.after.phone).toBe("***-***-6789");
    expect(auditAfter.meta.contactEmail).toBe("a***@domain.com");
    expect(auditAfter.requestBody.rawNote).toContain("t***@corp.org");

    const accessAfter = await db.collection("accessLogs").findOne();
    expect(accessAfter.subjectId).toBe("j***@example.com");

    const emailSentAfter = await db.collection("emailQueue").findOne({ status: "sent" });
    expect(emailSentAfter.to[0]).toBe("s***@example.com");

    const emailFailedAfter = await db.collection("emailQueue").findOne({ status: "failed" });
    expect(emailFailedAfter.to[0]).toBe("f***@example.com");

    const emailPendingAfter = await db.collection("emailQueue").findOne({ status: "pending" });
    // Pending recipient must NOT be masked
    expect(emailPendingAfter.to[0]).toBe("pending_recipient@example.com");

    // Idempotent re-run
    const rerunResult = await runScrubLogs({ dryRun: false });
    expect(rerunResult.auditLogsScrubbed).toBe(0);
    expect(rerunResult.accessLogsScrubbed).toBe(0);
    expect(rerunResult.emailQueueScrubbed).toBe(0);
  });
});
