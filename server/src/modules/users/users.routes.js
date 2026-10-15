import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { USER_ADMIN_ROLES } from "../../models/roles.js";
import { recordAccess } from "../audit/access-log.service.js";
import { assertPasswordResetAllowed } from "./password-reset-rate-limit.js";
import {
  createUserBodySchema,
  listUsersQuerySchema,
  passwordResetBodySchema,
  patchUserBodySchema,
  resendCredentialsBodySchema,
  userIdParamSchema,
} from "./users.schemas.js";
import {
  createUser,
  getUser,
  listUsers,
  resendCredentials,
  resetUserPassword,
  updateUser,
} from "./users.service.js";

export const usersRouter = Router();

const USER_PII_FIELDS = ["email", "name"];

usersRouter.use(requireAuth, requireRoles(...USER_ADMIN_ROLES));

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createUserBodySchema.parse(req.body);
    const user = await createUser(req.user, body);
    req.audit = {
      action: "user.create",
      entity: "user",
      entityId: user.id,
      after: user,
    };
    await res.status(201).json(user);
  }),
);

usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    const body = await listUsers(query);
    await recordAccess(req, {
      subjectType: "user",
      subjectIds: body.items.map((item) => item.id),
      kind: "list",
      fields: USER_PII_FIELDS,
    });
    await res.status(200).json(body);
  }),
);

usersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = userIdParamSchema.parse(req.params);
    const body = await getUser(id);
    await recordAccess(req, {
      subjectType: "user",
      subjectIds: [body.id],
      kind: "detail",
      fields: USER_PII_FIELDS,
    });
    await res.status(200).json(body);
  }),
);

usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = userIdParamSchema.parse(req.params);
    const body = patchUserBodySchema.parse(req.body);
    const saved = await updateUser(req.user, id, body);
    req.audit = {
      action: "user.update",
      entity: "user",
      entityId: saved.user.id,
      before: saved.before,
      after: saved.user,
    };
    await res.status(200).json(saved.user);
  }),
);

usersRouter.post(
  "/:id/password-reset",
  asyncHandler(async (req, res) => {
    const { id } = userIdParamSchema.parse(req.params);
    const body = passwordResetBodySchema.parse(req.body);
    const mode = body.sendEmail ? "email" : "set_password";
    try {
      assertPasswordResetAllowed(req.user._id.toString());
    } catch (err) {
      if (err instanceof AppError && err.code === "RATE_LIMITED") {
        req.audit = {
          action: "user.password_reset_rate_limited",
          entity: "user",
          entityId: id,
          logOnFailure: true,
          meta: { mode },
        };
      }
      throw err;
    }

    const result = await resetUserPassword(req.user, id, body);
    req.audit = {
      action: "user.password_reset",
      entity: "user",
      entityId: id,
      before: result.before,
      after: result.after,
      meta: result.meta,
    };
    if (result.httpStatus === 204) {
      await res.status(204).send();
      return;
    }
    await res.status(result.httpStatus).json(result.body);
  }),
);

usersRouter.post(
  "/:id/resend-credentials",
  requireRoles("aa_admin"),
  asyncHandler(async (req, res) => {
    const { id } = userIdParamSchema.parse(req.params);
    resendCredentialsBodySchema.parse(req.body ?? {});
    const result = await resendCredentials(req.user, id);
    req.audit = {
      action: "user.resend_credentials",
      entity: "user",
      entityId: id,
      before: result.before,
      after: result.after,
      meta: result.meta,
    };
    await res.status(202).json(result.body);
  }),
);
