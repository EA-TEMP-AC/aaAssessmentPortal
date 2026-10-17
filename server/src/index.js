import mongoose from "mongoose";
import { createApp } from "./app.js";
import { assertProductionSecrets, env } from "./config/env.js";
import { assertFieldEncryptionConfig } from "./lib/field-crypto.js";
import { assertEvidenceStorageConfig } from "./modules/evidence/storage/storage.js";
import { ensureCandidateIndexes } from "./models/candidate.model.js";
import { startSlaBreachScheduler } from "./modules/batches/sla-breach-job.js";
import { startAttemptSweepScheduler } from "./modules/attempts/attempt-sweep-job.js";
import { startExamVideoCleanup } from "./modules/proctoring/video.service.js";
import { startReviewReminderScheduler } from "./modules/question-bank/review-reminder-job.js";
import { startEmailWorker } from "./modules/email/email-worker.js";
import { smtpIsConfigured } from "./modules/email/email-transport.js";

async function main() {
  assertProductionSecrets();
  assertFieldEncryptionConfig();
  assertEvidenceStorageConfig();

  const app = createApp();

  if (env.MONGO_URI) {
    await mongoose.connect(env.MONGO_URI);
    console.log("Connected to MongoDB");
    if (await ensureCandidateIndexes()) {
      console.log("Replaced the candidates externalRef index");
    }
  } else {
    console.warn("MONGO_URI not set; starting without database connection");
  }

  if (env.NODE_ENV !== "test") {
    if (env.MONGO_URI) {
      startSlaBreachScheduler({ runOnStart: true });
      console.log("SLA breach job scheduled");
      startReviewReminderScheduler({ runOnStart: true });
      console.log("Question review reminder job scheduled");
      startAttemptSweepScheduler({ runOnStart: true });
      console.log("Attempt sweep job scheduled");
      startExamVideoCleanup();
      console.log("Exam video cleanup job scheduled");
    }
    if (smtpIsConfigured()) {
      startEmailWorker();
      console.log("Email queue worker started");
    } else {
      console.warn("SMTP_HOST is not set; email queue worker is not running");
    }
  }

  app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
