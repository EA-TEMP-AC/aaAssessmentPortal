import type { AuthUser, ClientSession } from "../api/types";
import type { Role } from "../routing/access";

export function sessionFor(role: Role, user: Partial<AuthUser> = {}): ClientSession {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresInMs: 900000,
    offlineSessionMaxMs: 259200000,
    user: {
      id: "66f000000000000000000001",
      role,
      name: "Test User",
      mustChangePassword: false,
      ...user,
    },
    device: {
      deviceId: "dev-test",
      platform: "web",
      appVersion: "0.0.1",
    },
  };
}

export function jsonResponse(status: number, body?: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const loginSuccessBody = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInMs: 900000,
  offlineSessionMaxMs: 259200000,
  user: {
    id: "66f000000000000000000001",
    role: "aa_admin",
    name: "AA Admin",
    mustChangePassword: false,
  },
};
