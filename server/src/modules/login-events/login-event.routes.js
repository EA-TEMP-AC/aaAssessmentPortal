import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { clientIp } from "../../lib/client-ip.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { loginEventBodySchema } from "./login-event.schemas.js";
import {
  LOGIN_EVENT_ROLE_BY_ACTOR,
  presentLoginEvent,
  recordLoginEvent,
} from "./login-event.service.js";

/**
 * POST /api/v1/<actorType>/login-event. docs/SCHEMA.md §3.11.
 * The audit row carries the event and never the mail body or recipients.
 */
function loginEventRouter(actorType) {
  const router = Router();
  router.use(requireAuth);
  router.post(
    "/login-event",
    requireRoles(LOGIN_EVENT_ROLE_BY_ACTOR[actorType]),
    asyncHandler(async (req, res) => {
      const body = loginEventBodySchema.parse(req.body);
      const saved = await recordLoginEvent(req.user, actorType, body, { ip: clientIp(req) });
      const event = presentLoginEvent(saved.event, { replayed: saved.replayed });
      req.audit = {
        action: saved.replayed ? "loginEvent.replay" : "loginEvent.create",
        entity: "loginEvent",
        entityId: event.id,
        abId: saved.abId,
        batchId: event.batchId,
        after: event,
      };
      await res.status(200).json(event);
    }),
  );
  return router;
}

export const assessorLoginEventRouter = loginEventRouter("assessor");
export const proctorLoginEventRouter = loginEventRouter("proctor");
export const studentLoginEventRouter = loginEventRouter("student");
