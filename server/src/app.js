import express from "express";
import { auditMiddleware } from "./middleware/audit.middleware.js";
import { errorHandler } from "./middleware/error-handler.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import {
  holidaysRouter,
  workingDayConfigRouter,
} from "./modules/working-days/working-days.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(auditMiddleware);

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/audit-logs", auditRouter);
  app.use("/api/v1/admin/working-day-config", workingDayConfigRouter);
  app.use("/api/v1/admin/holidays", holidaysRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  });

  app.use(errorHandler);

  return app;
}
