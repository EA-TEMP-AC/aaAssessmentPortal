import { vi } from "vitest";
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_BASE_MS,
  EMAIL_RETRY_MAX_DELAY_MS,
  EMAIL_SENDING_STALE_MS,
  emailBackoffDelayMs,
} from "../src/config/email.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import {
  claimNextEmail,
  enqueueEmail,
  enqueueEmailSafely,
  processNextEmail,
  reclaimStaleEmails,
} from "../src/modules/email/email-queue.service.js";
import { processDueEmails } from "../src/modules/email/email-worker.js";
import {
  createSmtpTransport,
  createUnconfiguredTransport,
} from "../src/modules/email/email-transport.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";

function failingTransport(code = "EAUTH") {
  return {
    async send() {
      const err = new Error("535 auth failed password=smtp-secret-value");
      err.code = code;
      throw err;
    },
  };
}

async function queueJob(overrides = {}) {
  return enqueueEmail({
    to: ["ab@example.com"],
    subject: "Assessor login",
    text: "capturedAt 2026-11-22T10:00:00.000Z",
    kind: "ab_assessor_login",
    ...overrides,
  });
}

describe("email queue", () => {
  beforeAll(async () => {
    await startMongo();
    await EmailQueue.init();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it("backs off and stops at the attempt cap", () => {
    expect(emailBackoffDelayMs(1)).toBe(EMAIL_RETRY_BASE_MS);
    expect(emailBackoffDelayMs(2)).toBe(EMAIL_RETRY_BASE_MS * 2);
    expect(emailBackoffDelayMs(3)).toBe(EMAIL_RETRY_BASE_MS * 4);
    expect(emailBackoffDelayMs(20)).toBe(EMAIL_RETRY_MAX_DELAY_MS);
  });

  it("retries with backoff, then marks the job failed", async () => {
    const now = new Date("2026-10-11T00:00:00.000Z");
    await queueJob({ nextAttemptAt: now });
    const transport = failingTransport();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const first = await processNextEmail(transport, now);
      expect(first).toMatchObject({ claimed: true, status: "pending", attempts: 1 });
      expect(first.delayMs).toBe(emailBackoffDelayMs(1));

      const tooSoon = await processNextEmail(transport, now);
      expect(tooSoon.claimed).toBe(false);

      let cursor = new Date(now.getTime() + first.delayMs);
      for (let attempt = 2; attempt <= EMAIL_MAX_ATTEMPTS; attempt += 1) {
        const result = await processNextEmail(transport, cursor);
        expect(result.claimed).toBe(true);
        expect(result.attempts).toBe(attempt);
        if (attempt < EMAIL_MAX_ATTEMPTS) {
          expect(result.status).toBe("pending");
          expect(result.delayMs).toBe(emailBackoffDelayMs(attempt));
          cursor = new Date(cursor.getTime() + result.delayMs);
        } else {
          expect(result.status).toBe("failed");
        }
      }
    } finally {
      spy.mockRestore();
    }

    const job = await EmailQueue.findOne().lean();
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(EMAIL_MAX_ATTEMPTS);
    expect(job.lastError).toBe("Email send failed (EAUTH)");
    expect(job.lastError).not.toContain("smtp-secret-value");

    const logged = [];
    const logSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      const again = await processNextEmail(transport, new Date("2026-12-01T00:00:00.000Z"));
      expect(again.claimed).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
    expect(logged.join(" ")).not.toContain("smtp-secret-value");
  });

  it("does not echo a credential stuffed into the error code", async () => {
    await queueJob({ text: "Temporary password: Tmp-secret-body" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let result;
    let logged = "";
    try {
      result = await processNextEmail(failingTransport("smtp-secret-value"), new Date());
      logged = spy.mock.calls.flat().join(" ");
    } finally {
      spy.mockRestore();
    }
    expect(result.status).toBe("pending");
    const job = await EmailQueue.findOne().lean();
    expect(job.lastError).toBe("Email send failed (SEND_FAILED)");
    expect(job.lastError).not.toContain("smtp-secret-value");
    expect(job.lastError).not.toContain("Tmp-secret-body");
    expect(logged).not.toContain("smtp-secret-value");
    expect(logged).not.toContain("Tmp-secret-body");
  });

  it("clears text after send and keeps the job metadata", async () => {
    const now = new Date("2026-10-11T03:30:00.000Z");
    const secret = "Tmp-clear-after-send";
    await queueJob({
      nextAttemptAt: now,
      kind: "password_reset",
      subject: "Your assessment portal password was reset",
      text: `Temporary password: ${secret}`,
    });
    const logged = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });

    try {
      const result = await processNextEmail(
        {
          async send(message) {
            expect(message.text).toContain(secret);
          },
        },
        now,
      );
      expect(result.status).toBe("sent");
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }

    const job = await EmailQueue.findOne().lean();
    expect(job.status).toBe("sent");
    expect(job.attempts).toBe(1);
    expect(job.kind).toBe("password_reset");
    expect(job.subject).toBe("Your assessment portal password was reset");
    expect(job.text).toBeUndefined();
    expect(job.to).toEqual(["a***@example.com"]);
    expect(JSON.stringify(job)).not.toContain(secret);
    expect(logged.join("\n")).not.toContain(secret);
  });

  it("clears text after the attempt cap and does not log the plaintext", async () => {
    const now = new Date("2026-10-11T03:40:00.000Z");
    const secret = "Tmp-clear-after-fail";
    await queueJob({
      nextAttemptAt: now,
      kind: "password_reset",
      subject: "Your assessment portal password was reset",
      text: `Temporary password: ${secret}`,
    });
    const logged = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });

    try {
      let cursor = now;
      for (let attempt = 1; attempt <= EMAIL_MAX_ATTEMPTS; attempt += 1) {
        const result = await processNextEmail(failingTransport(), cursor);
        expect(result.claimed).toBe(true);
        expect(result.attempts).toBe(attempt);
        if (attempt < EMAIL_MAX_ATTEMPTS) {
          const pending = await EmailQueue.findOne().lean();
          expect(pending.status).toBe("pending");
          expect(pending.text).toContain(secret);
          expect(pending.to).toEqual(["ab@example.com"]);
          cursor = new Date(cursor.getTime() + result.delayMs);
        } else {
          expect(result.status).toBe("failed");
        }
      }
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }

    const job = await EmailQueue.findOne().lean();
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(EMAIL_MAX_ATTEMPTS);
    expect(job.kind).toBe("password_reset");
    expect(job.subject).toBe("Your assessment portal password was reset");
    expect(job.text).toBeUndefined();
    expect(job.to).toEqual(["a***@example.com"]);
    expect(JSON.stringify(job)).not.toContain(secret);

    expect(logged.join("\n")).not.toContain(secret);
  });

  it("sends once and marks the job sent", async () => {
    const now = new Date("2026-10-11T03:00:00.000Z");
    await queueJob({ nextAttemptAt: now });
    const sent = [];
    const result = await processNextEmail(
      {
        async send(message) {
          sent.push(message);
        },
      },
      now,
    );

    expect(result.status).toBe("sent");
    expect(sent).toEqual([
      {
        to: ["ab@example.com"],
        subject: "Assessor login",
        text: "capturedAt 2026-11-22T10:00:00.000Z",
      },
    ]);
    const job = await EmailQueue.findById(result.id).lean();
    expect(job.status).toBe("sent");
    expect(job.attempts).toBe(1);
    expect(job.sentAt.toISOString()).toBe(now.toISOString());

    const second = await processNextEmail(
      {
        async send() {
          throw new Error("should not send twice");
        },
      },
      now,
    );
    expect(second.claimed).toBe(false);
  });

  it("lets two workers claim different jobs and only one claim a single job", async () => {
    const now = new Date("2026-10-11T04:00:00.000Z");
    await queueJob({ subject: "One", text: "one", nextAttemptAt: now });
    await queueJob({ subject: "Two", text: "two", nextAttemptAt: now });

    const [first, second] = await Promise.all([claimNextEmail(now), claimNextEmail(now)]);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first._id.toString()).not.toBe(second._id.toString());
    expect(first.status).toBe("sending");
    expect(second.status).toBe("sending");
    expect(first.attempts).toBe(1);
    expect(second.attempts).toBe(1);

    const third = await claimNextEmail(now);
    expect(third).toBeNull();
  });

  it("delivers a single job from only one of two parallel workers", async () => {
    const now = new Date("2026-10-11T05:00:00.000Z");
    await queueJob({ nextAttemptAt: now });
    let sends = 0;
    const transport = {
      async send() {
        sends += 1;
      },
    };

    const [a, b] = await Promise.all([
      processNextEmail(transport, now),
      processNextEmail(transport, now),
    ]);

    expect(sends).toBe(1);
    const claimed = [a, b].filter((result) => result.claimed);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe("sent");
    const jobs = await EmailQueue.find().lean();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("sent");
    expect(jobs[0].attempts).toBe(1);
  });

  it("leaves a future job unclaimed", async () => {
    const now = new Date("2026-10-11T06:00:00.000Z");
    await queueJob({ nextAttemptAt: new Date(now.getTime() + 60_000) });
    const result = await processNextEmail(
      {
        async send() {
          throw new Error("not due");
        },
      },
      now,
    );
    expect(result.claimed).toBe(false);
    const job = await EmailQueue.findOne().lean();
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
  });

  it("isolates a queue insert failure from the caller", async () => {
    const original = EmailQueue.create;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    EmailQueue.create = async () => {
      const err = new Error("insert failed password=queue-secret-leak");
      err.code = "queue-secret-leak";
      throw err;
    };
    try {
      await expect(
        enqueueEmailSafely({
          to: ["learner1@example.com"],
          subject: "Reset",
          text: "Temporary password: Tmp-hidden",
          kind: "password_reset",
        }),
      ).resolves.toEqual({ queued: false });
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).not.toContain("queue-secret-leak");
      expect(logged).not.toContain("Tmp-hidden");
    } finally {
      EmailQueue.create = original;
      spy.mockRestore();
    }
  });

  describe("stale sending jobs (Q43)", () => {
    const claimedAt = new Date("2026-10-11T06:00:00.000Z");
    const after = (ms) => new Date(claimedAt.getTime() + ms);

    it("uses a ten-minute limit", () => {
      expect(EMAIL_SENDING_STALE_MS).toBe(10 * 60 * 1000);
    });

    it("returns a job stuck in sending for more than 10 minutes to pending, and sends it", async () => {
      const job = await queueJob({ nextAttemptAt: claimedAt });
      // A worker claims the job and dies before it records a result.
      const claimed = await claimNextEmail(claimedAt);
      expect(claimed.status).toBe("sending");
      const sent = [];
      const transport = {
        async send(mail) {
          sent.push(mail);
        },
      };

      // Still inside the limit: nothing is reclaimed and nothing is sent.
      const early = after(EMAIL_SENDING_STALE_MS - 1);
      expect(await reclaimStaleEmails(early)).toEqual({ requeued: 0, failed: 0 });
      expect(await processDueEmails(transport, early)).toEqual([]);
      expect((await EmailQueue.findById(job._id).lean()).status).toBe("sending");

      const late = after(EMAIL_SENDING_STALE_MS + 1);
      expect(await reclaimStaleEmails(late)).toEqual({ requeued: 1, failed: 0 });
      const pending = await EmailQueue.findById(job._id).lean();
      expect(pending).toMatchObject({
        status: "pending",
        attempts: 1,
        lastError: "Email send interrupted (STALE_CLAIM)",
        text: "capturedAt 2026-11-22T10:00:00.000Z",
      });
      expect(pending.nextAttemptAt).toEqual(late);

      // A second pass has nothing left to reclaim.
      expect(await reclaimStaleEmails(late)).toEqual({ requeued: 0, failed: 0 });

      const results = await processDueEmails(transport, late);
      expect(results).toEqual([{ claimed: true, status: "sent", id: job._id.toString() }]);
      expect(sent).toHaveLength(1);
      const done = await EmailQueue.findById(job._id).lean();
      expect(done.status).toBe("sent");
      expect(done.attempts).toBe(2);
      expect(done.text).toBeUndefined();
    });

    it("lets the worker tick reclaim a stale job on its own", async () => {
      const job = await queueJob({ nextAttemptAt: claimedAt });
      await claimNextEmail(claimedAt);
      let sends = 0;
      const transport = {
        async send() {
          sends += 1;
        },
      };

      const results = await processDueEmails(transport, after(EMAIL_SENDING_STALE_MS + 60_000));

      expect(results.map((result) => result.status)).toEqual(["sent"]);
      expect(sends).toBe(1);
      expect((await EmailQueue.findById(job._id).lean()).status).toBe("sent");
    });

    it("fails a stale job that had already used its last attempt, and clears its text", async () => {
      const job = await queueJob({ text: "Temporary password: Tmp-secret-value" });
      await EmailQueue.updateOne(
        { _id: job._id },
        { $set: { status: "sending", attempts: EMAIL_MAX_ATTEMPTS, claimedAt } },
      );

      expect(await reclaimStaleEmails(after(EMAIL_SENDING_STALE_MS + 1))).toEqual({
        requeued: 0,
        failed: 1,
      });

      const failed = await EmailQueue.findById(job._id).lean();
      expect(failed.status).toBe("failed");
      expect(failed.lastError).toBe("Email send interrupted (STALE_CLAIM)");
      expect(failed.text).toBeUndefined();
    });

    it("reclaims a stuck job at most twice, then fails it and clears its text (Q155)", async () => {
      const job = await queueJob({
        text: "Temporary password: Tmp-secret-value",
        nextAttemptAt: claimedAt,
      });
      expect((await EmailQueue.findById(job._id).lean()).reclaims).toBe(0);

      let now = claimedAt;
      for (const expected of [1, 2]) {
        const claimed = await claimNextEmail(now);
        expect(claimed.status).toBe("sending");
        now = new Date(now.getTime() + EMAIL_SENDING_STALE_MS + 1);
        expect(await reclaimStaleEmails(now)).toEqual({ requeued: 1, failed: 0 });
        const back = await EmailQueue.findById(job._id).lean();
        expect(back).toMatchObject({ status: "pending", reclaims: expected });
        expect(back.text).toBe("Temporary password: Tmp-secret-value");
      }

      // Claimed a third time and stuck again: no more reclaims.
      expect((await claimNextEmail(now)).status).toBe("sending");
      now = new Date(now.getTime() + EMAIL_SENDING_STALE_MS + 1);
      expect(await reclaimStaleEmails(now)).toEqual({ requeued: 0, failed: 1 });
      const failed = await EmailQueue.findById(job._id).lean();
      expect(failed).toMatchObject({
        status: "failed",
        reclaims: 2,
        attempts: 3,
        lastError: "Email send interrupted (STALE_CLAIM)",
      });
      expect(failed.text).toBeUndefined();

      // A failed job is never sent or reclaimed again.
      const sent = [];
      const transport = {
        async send(mail) {
          sent.push(mail);
        },
      };
      expect(await processDueEmails(transport, new Date(now.getTime() + 3_600_000))).toEqual([]);
      expect(sent).toHaveLength(0);
    });

    it("counts a job saved before reclaims existed as never reclaimed", async () => {
      const job = await queueJob();
      await EmailQueue.collection.updateOne(
        { _id: job._id },
        { $set: { status: "sending", attempts: 1, claimedAt }, $unset: { reclaims: "" } },
      );
      expect(await reclaimStaleEmails(after(EMAIL_SENDING_STALE_MS + 1))).toEqual({
        requeued: 1,
        failed: 0,
      });
      expect((await EmailQueue.findById(job._id).lean()).reclaims).toBe(1);
    });

    it("does not count a normal retry as a reclaim", async () => {
      const job = await queueJob({ nextAttemptAt: claimedAt });
      const transport = {
        async send() {
          throw new Error("smtp down");
        },
      };
      await processDueEmails(transport, claimedAt);
      expect(await EmailQueue.findById(job._id).lean()).toMatchObject({
        status: "pending",
        reclaims: 0,
      });
    });

    it("leaves pending, sent, and failed jobs alone however old they are", async () => {
      const old = new Date("2026-01-01T00:00:00.000Z");
      const pending = await queueJob({ subject: "pending", nextAttemptAt: after(3_600_000) });
      const sentJob = await queueJob({ subject: "sent" });
      const failedJob = await queueJob({ subject: "failed" });
      await EmailQueue.updateOne({ _id: pending._id }, { $set: { claimedAt: old } });
      await EmailQueue.updateOne(
        { _id: sentJob._id },
        { $set: { status: "sent", claimedAt: old } },
      );
      await EmailQueue.updateOne(
        { _id: failedJob._id },
        { $set: { status: "failed", claimedAt: old } },
      );

      expect(await reclaimStaleEmails(after(0))).toEqual({ requeued: 0, failed: 0 });
      const statuses = await EmailQueue.find().sort({ subject: 1 }).lean();
      expect(statuses.map((row) => [row.subject, row.status])).toEqual([
        ["failed", "failed"],
        ["pending", "pending"],
        ["sent", "sent"],
      ]);
    });
  });

  it("keeps the SMTP password off the transport object", async () => {
    const transport = createSmtpTransport({
      host: "127.0.0.1",
      port: 2525,
      secure: false,
      user: "mailer",
      password: "smtp-secret-value",
      from: "noreply@aa.example",
    });
    expect(Object.keys(transport)).toEqual(["send"]);
    expect(JSON.stringify(transport)).not.toContain("smtp-secret-value");

    const unconfigured = createUnconfiguredTransport();
    await expect(
      unconfigured.send({ to: ["a@example.com"], subject: "s", text: "t" }),
    ).rejects.toMatchObject({
      code: "SMTP_NOT_CONFIGURED",
    });
  });
});
