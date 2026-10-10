import mongoose from "mongoose";
import { createApp } from "./app.js";
import { env } from "./config/env.js";

async function main() {
  const app = createApp();

  if (env.MONGO_URI) {
    await mongoose.connect(env.MONGO_URI);
    console.log("Connected to MongoDB");
  } else {
    console.warn("MONGO_URI not set; starting without database connection");
  }

  app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
