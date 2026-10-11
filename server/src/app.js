import express from "express";
import { auditMiddleware } from "./middleware/audit.middleware.js";
import { errorHandler } from "./middleware/error-handler.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { batchesRouter } from "./modules/batches/batch.routes.js";
import { complianceRouter } from "./modules/compliance/compliance.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import {
  awardingBodiesRouter,
  centresRouter,
  learnersRouter,
  qualificationsRouter,
  trainingPartnersRouter,
} from "./modules/master-data/master-data.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
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
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/awarding-bodies", awardingBodiesRouter);
  app.use("/api/v1/training-partners", trainingPartnersRouter);
  app.use("/api/v1/centres", centresRouter);
  app.use("/api/v1/qualifications", qualificationsRouter);
  app.use("/api/v1/learners", learnersRouter);
  app.use("/api/v1/audit-logs", auditRouter);
  app.use("/api/v1/admin/working-day-config", workingDayConfigRouter);
  app.use("/api/v1/admin/holidays", holidaysRouter);
  app.use("/api/v1/batches", batchesRouter);
  app.use("/api/v1/compliance", complianceRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  });

  app.use(errorHandler);

  return app;
}
