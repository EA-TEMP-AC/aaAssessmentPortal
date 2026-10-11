import mongoose from "mongoose";
import { createApp } from "./app.js";
import { assertProductionSecrets, env } from "./config/env.js";
import { startEmailWorker } from "./modules/email/email-worker.js";
import { smtpIsConfigured } from "./modules/email/email-transport.js";

async function main() {
  assertProductionSecrets();

  const app = createApp();

  if (env.MONGO_URI) {
    await mongoose.connect(env.MONGO_URI);
    console.log("Connected to MongoDB");
  } else {
    console.warn("MONGO_URI not set; starting without database connection");
  }

  if (env.NODE_ENV !== "test") {
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
