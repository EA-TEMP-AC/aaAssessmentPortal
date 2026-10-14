import { z } from "zod";

const deviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(50),
  appVersion: z.string().trim().min(1).max(50),
});

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
  device: deviceSchema,
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).max(500),
  device: deviceSchema,
});

/** `refreshToken` names this session's token, which is kept; the user's others are revoked. */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
    refreshToken: z.string().min(1).max(500).optional(),
  })
  .strict();

export const logoutBodySchema = z
  .object({
    refreshToken: z.string().min(1).max(500).optional(),
  })
  .strict();
