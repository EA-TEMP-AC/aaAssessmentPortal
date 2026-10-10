import express from "express";
import { healthRouter } from "./modules/health/health.routes.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1/health", healthRouter);

  return app;
}
