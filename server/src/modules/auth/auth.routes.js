import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError } from "../../lib/errors.js";
import { login, logout, refresh } from "./auth.service.js";
import { loginBodySchema, logoutBodySchema, refreshBodySchema } from "./auth.schemas.js";
import { clientIp } from "../../lib/client-ip.js";

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginBodySchema.parse(req.body);
    try {
      const session = await login(body, clientIp(req));
      req.audit = {
        action: "auth.login",
        entity: "user",
        entityId: session.user.id,
        actorId: session.user.id,
        actorRole: session.user.role,
        meta: { device: body.device },
      };
      await res.status(200).json(session);
    } catch (err) {
      if (err instanceof AppError && err.code === "RATE_LIMITED") {
        req.audit = {
          action: "auth.login_rate_limited",
          entity: "user",
          logOnFailure: true,
          meta: { email: body.email.trim().toLowerCase() },
        };
      } else if (err instanceof AppError && err.code === "UNAUTHORIZED") {
        req.audit = {
          action: "auth.login_failed",
          entity: "user",
          logOnFailure: true,
          meta: { email: body.email.trim().toLowerCase() },
        };
      }
      throw err;
    }
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const body = refreshBodySchema.parse(req.body);
    try {
      const session = await refresh(body);
      req.audit = {
        action: "auth.refresh",
        entity: "user",
        entityId: session.user.id,
        actorId: session.user.id,
        actorRole: session.user.role,
        meta: { device: body.device, rotated: true },
      };
      await res.status(200).json(session);
    } catch (err) {
      if (err instanceof AppError && err.status === 401) {
        req.audit = {
          action: err.auditAction ?? "auth.refresh_failed",
          entity: "user",
          entityId: err.auditEntityId,
          actorId: err.auditActorId,
          actorRole: err.auditActorRole,
          logOnFailure: true,
          meta: { device: body.device },
        };
      }
      throw err;
    }
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const body = logoutBodySchema.parse(req.body ?? {});
    const outcome = await logout(body);
    req.audit = {
      action: "auth.logout",
      entity: outcome.entityId ? "refreshToken" : "session",
      entityId: outcome.entityId,
      actorId: outcome.actorId,
      actorRole: outcome.actorRole,
      meta: { result: outcome.result },
    };
    await res.status(204).send();
  }),
);
