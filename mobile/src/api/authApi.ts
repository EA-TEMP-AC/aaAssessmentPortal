import type { DeviceInfo } from "../domain/device";
import { ACCESS_TOKEN_TTL_MS, OFFLINE_SESSION_MAX_MS } from "../config/compliance";
import { ApiError, readErrorBody, readJson } from "./http";

export type SessionUser = {
  id: string;
  role: string;
  name: string;
  mustChangePassword: boolean;
};

/** Body shared by POST /auth/login and POST /auth/refresh (API_CONTRACT, DECISIONS B-01). */
export type AuthSessionResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInMs: number;
  offlineSessionMaxMs: number;
  user: SessionUser;
};

export type AuthApi = {
  login(email: string, password: string, device: DeviceInfo): Promise<AuthSessionResponse>;
  refresh(refreshToken: string, device: DeviceInfo): Promise<AuthSessionResponse>;
  logout(refreshToken: string): Promise<void>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(200, "VALIDATION_ERROR", `Session response missing ${field}`);
  }
  return value;
}

export function parseAuthSession(payload: unknown): AuthSessionResponse {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(200, "VALIDATION_ERROR", "Session response was empty");
  }
  const body = payload as Record<string, unknown>;
  const userRaw = body.user;
  if (!userRaw || typeof userRaw !== "object") {
    throw new ApiError(200, "VALIDATION_ERROR", "Session response missing user");
  }
  const user = userRaw as Record<string, unknown>;
  const expiresInMs = typeof body.expiresInMs === "number" && body.expiresInMs > 0
    ? body.expiresInMs
    : ACCESS_TOKEN_TTL_MS;
  const offlineSessionMaxMs =
    typeof body.offlineSessionMaxMs === "number" && body.offlineSessionMaxMs > 0
      ? body.offlineSessionMaxMs
      : OFFLINE_SESSION_MAX_MS;
  return {
    accessToken: requireString(body.accessToken, "accessToken"),
    refreshToken: requireString(body.refreshToken, "refreshToken"),
    expiresInMs,
    offlineSessionMaxMs,
    user: {
      id: requireString(user.id, "user.id"),
      role: requireString(user.role, "user.role"),
      name: requireString(user.name, "user.name"),
      mustChangePassword: user.mustChangePassword === true,
    },
  };
}

export function createAuthApi(options: { baseUrl: string; fetchImpl?: FetchLike }): AuthApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function post(path: string, body: unknown, okStatus: number): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network request failed";
      throw new ApiError(0, "NETWORK", message);
    }

    if (response.status === 204 && okStatus === 204) return null;
    const payload = await readJson(response);
    if (response.status !== okStatus) {
      const error = readErrorBody(payload, `Request failed (${response.status})`);
      throw new ApiError(response.status, error.code, error.message);
    }
    return payload;
  }

  return {
    async login(email, password, device) {
      const payload = await post("/auth/login", { email, password, device }, 200);
      return parseAuthSession(payload);
    },
    async refresh(refreshToken, device) {
      const payload = await post("/auth/refresh", { refreshToken, device }, 200);
      return parseAuthSession(payload);
    },
    async logout(refreshToken) {
      await post("/auth/logout", { refreshToken }, 204);
    },
  };
}
