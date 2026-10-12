export type LoginEventsMode = "mock" | "live";

export type MobileEnv = {
  apiBaseUrl: string;
  loginEventsMode: LoginEventsMode;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000/api/v1";

/**
 * Server B-06 and B-06b have shipped the live login-event routes.
 * Defaults to live. EXPO_PUBLIC_LOGIN_EVENTS_MODE=mock forces mock mode for testing.
 */
export function readMobileEnv(source: Record<string, string | undefined>): MobileEnv {
  const configured = source.EXPO_PUBLIC_API_BASE_URL?.trim();
  const apiBaseUrl = (configured || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  const loginEventsMode: LoginEventsMode =
    source.EXPO_PUBLIC_LOGIN_EVENTS_MODE === "mock" ? "mock" : "live";
  return { apiBaseUrl, loginEventsMode };
}

export function mobileEnvFromProcess(): MobileEnv {
  return readMobileEnv({
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_LOGIN_EVENTS_MODE: process.env.EXPO_PUBLIC_LOGIN_EVENTS_MODE,
  });
}
