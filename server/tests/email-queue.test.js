import { vi } from "vitest";
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_BASE_MS,
  EMAIL_RETRY_MAX_DELAY_MS,
  emailBackoffDelayMs,
} from "../src/config/email.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import {
  claimNextEmail,
  enqueueEmail,
  enqueueEmailSafely,
  processNextEmail,
} from "../src/modules/email/email-queue.service.js";
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
