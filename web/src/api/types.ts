import { isRole, type Role } from "../routing/access";

export type Device = {
  deviceId: string;
  platform: string;
  appVersion: string;
};

export type AuthUser = {
  id: string;
  role: Role;
  name: string;
  mustChangePassword: boolean;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresInMs: number;
  offlineSessionMaxMs: number;
  user: AuthUser;
};

export type ClientSession = AuthSession & {
  device: Device;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseAuthSession(value: unknown): AuthSession | null {
  if (!isRecord(value) || !isRecord(value.user)) {
    return null;
  }

  const { accessToken, refreshToken, expiresInMs, offlineSessionMaxMs, user } =
    value;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  if (typeof refreshToken !== "string" || refreshToken.length === 0)
    return null;
  if (
    typeof expiresInMs !== "number" ||
    typeof offlineSessionMaxMs !== "number"
  )
    return null;
  if (typeof user.id !== "string" || user.id.length === 0) return null;
  if (typeof user.name !== "string" || user.name.length === 0) return null;
  if (typeof user.role !== "string" || !isRole(user.role)) return null;
  if (typeof user.mustChangePassword !== "boolean") return null;

  return {
    accessToken,
    refreshToken,
    expiresInMs,
    offlineSessionMaxMs,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  };
}
