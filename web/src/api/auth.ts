import { apiRequest, ApiError } from "./client";
import { clearSession, getSnapshot, setSession } from "./session";
import { parseAuthSession, type ClientSession, type Device } from "./types";
import { APP_VERSION } from "../config/app";

export function createDevice(): Device {
  const deviceId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `web-${Date.now()}`;
  return {
    deviceId,
    platform: "web",
    appVersion: APP_VERSION,
  };
}

export async function login(email: string, password: string): Promise<ClientSession> {
  const device = createDevice();
  const body = await apiRequest<unknown>("/auth/login", {
    method: "POST",
    auth: false,
    retryOn401: false,
    body: { email, password, device },
  });
  const session = parseAuthSession(body);
  if (!session) {
    throw new ApiError(502, "INVALID_RESPONSE", "Sign-in response was not recognised.");
  }
  const stored: ClientSession = { ...session, device };
  setSession(stored);
  return stored;
}

export async function logout(): Promise<void> {
  const refreshToken = getSnapshot()?.refreshToken;
  try {
    await apiRequest<void>("/auth/logout", {
      method: "POST",
      auth: false,
      retryOn401: false,
      body: refreshToken ? { refreshToken } : {},
    });
  } finally {
    clearSession();
  }
}
