export type LoginEventsMode = "mock" | "live";

export type MobileEnv = {
  apiBaseUrl: string;
  loginEventsMode: LoginEventsMode;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000/api/v1";

/**
 * Login-event routes are not implemented on the server yet (B-06).
 * EXPO_PUBLIC_LOGIN_EVENTS_MODE=live calls the contract paths; any other value uses the mock.
 */
export function readMobileEnv(source: Record<string, string | undefined>): MobileEnv {
  const configured = source.EXPO_PUBLIC_API_BASE_URL?.trim();
  const apiBaseUrl = (configured || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  const loginEventsMode: LoginEventsMode =
    source.EXPO_PUBLIC_LOGIN_EVENTS_MODE === "live" ? "live" : "mock";
  return { apiBaseUrl, loginEventsMode };
}

export function mobileEnvFromProcess(): MobileEnv {
  return readMobileEnv({
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_LOGIN_EVENTS_MODE: process.env.EXPO_PUBLIC_LOGIN_EVENTS_MODE,
  });
}
