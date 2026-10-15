import express from "express";
import { auditMiddleware } from "./middleware/audit.middleware.js";
import { errorHandler } from "./middleware/error-handler.js";
import { assessorPaymentsRouter } from "./modules/assessor-payments/assessor-payment.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { assessorsRouter } from "./modules/assessors/assessor.routes.js";
import { assessorFieldRouter } from "./modules/attendance/attendance.routes.js";
import { batchesRouter } from "./modules/batches/batch.routes.js";
import { complianceRouter } from "./modules/compliance/compliance.routes.js";
import { proctorsRouter } from "./modules/proctors/proctor.routes.js";
import {
  assessorLoginEventRouter,
  proctorLoginEventRouter,
  studentLoginEventRouter,
} from "./modules/login-events/login-event.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import {
  awardingBodiesRouter,
  centresRouter,
  learnersRouter,
  qualificationsRouter,
  trainingPartnersRouter,
} from "./modules/master-data/master-data.routes.js";
import { resultsRouter } from "./modules/results/result.routes.js";
import { recognitionRouter } from "./modules/recognition/recognition.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import {
  publicSiteAdminRouter,
  publicSiteRouter,
} from "./modules/public-site/public-site.routes.js";
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
  app.use("/api/v1/settings", settingsRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/admin/public-site", publicSiteAdminRouter);
  app.use("/api/v1/public", publicSiteRouter);
  app.use("/api/v1/awarding-bodies", awardingBodiesRouter);
  app.use("/api/v1/training-partners", trainingPartnersRouter);
  app.use("/api/v1/centres", centresRouter);
  app.use("/api/v1/qualifications", qualificationsRouter);
  app.use("/api/v1/learners", learnersRouter);
  app.use("/api/v1/assessors", assessorsRouter);
  app.use("/api/v1/proctors", proctorsRouter);
  app.use("/api/v1/audit-logs", auditRouter);
  app.use("/api/v1/admin/working-day-config", workingDayConfigRouter);
  app.use("/api/v1/admin/holidays", holidaysRouter);
  app.use("/api/v1/admin/recognition", recognitionRouter);
  app.use("/api/v1/batches", batchesRouter);
  app.use("/api/v1/assessor-payments", assessorPaymentsRouter);
  app.use("/api/v1/results", resultsRouter);
  app.use("/api/v1/compliance", complianceRouter);
  app.use("/api/v1/assessor", assessorLoginEventRouter);
  app.use("/api/v1/assessor", assessorFieldRouter);
  app.use("/api/v1/proctor", proctorLoginEventRouter);
  app.use("/api/v1/student", studentLoginEventRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  });

  app.use(errorHandler);

  return app;
}
