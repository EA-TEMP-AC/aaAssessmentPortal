import { API_BASE_URL } from "../config/app";
import { explainBatchRule, joinErrorParts } from "./ruleErrors";
import {
  clearSession,
  getAccessToken,
  getSnapshot,
  updateSession,
} from "./session";
import { parseAuthSession, type ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Could not reach the server. Try again.";
  const explanation = explainBatchRule(error.code, error.details);
  if (!explanation) return error.message;
  return joinErrorParts([error.code, error.message, explanation]);
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: Method;
  body?: unknown;
  auth?: boolean;
  retryOn401?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string> | Headers;
  /** Return the unread Response as `body` (file downloads). Errors still throw ApiError. */
  raw?: boolean;
};

let unauthorizedHandler: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

function notifyUnauthorized() {
  unauthorizedHandler();
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * One refresh for a burst of 401s. A failed refresh clears the in-memory session
 * and sends the user to sign in. Callers retry the original request at most once.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function performRefresh(): Promise<boolean> {
  const current = getSnapshot();
  if (!current) {
    notifyUnauthorized();
    return false;
  }

  try {
    const body = await apiRequest<unknown>("/auth/refresh", {
      method: "POST",
      auth: false,
      retryOn401: false,
      body: {
        refreshToken: current.refreshToken,
        device: current.device,
      },
    });
    const next = parseAuthSession(body);
    if (!next) {
      throw new ApiError(
        502,
        "INVALID_RESPONSE",
        "Refresh response was not recognised.",
      );
    }
    updateSession(next);
    return true;
  } catch {
    clearSession();
    notifyUnauthorized();
    return false;
  }
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody> & {
      code?: unknown;
    };
    if (
      body.error &&
      typeof body.error.message === "string" &&
      body.error.message.length > 0
    ) {
      return new ApiError(
        response.status,
        typeof body.error.code === "string" ? body.error.code : "UNKNOWN",
        body.error.message,
        body.error.details,
      );
    }
    // The question import refuses with a flat body: { code, errors: [...] } (no `error` wrapper).
    if (typeof body.code === "string" && body.code.length > 0) {
      return new ApiError(
        response.status,
        body.code,
        "The request was refused.",
        body,
      );
    }
  } catch {
    // Non-JSON bodies fall through to a generic error.
  }
  return new ApiError(response.status, "UNKNOWN", "Request failed.");
}

export async function apiRequestResult<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: T }> {
  return performRequest<T>(path, options);
}

async function performRequest<T>(
  path: string,
  options: RequestOptions,
): Promise<{ status: number; body: T }> {
  const headers = new Headers(options.headers);
  let requestBody: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof FormData !== "undefined" && options.body instanceof FormData) {
      requestBody = options.body;
    } else if (typeof Blob !== "undefined" && options.body instanceof Blob) {
      requestBody = options.body;
    } else if (
      typeof options.body === "string" &&
      headers.has("Content-Type")
    ) {
      requestBody = options.body;
    } else {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      requestBody = JSON.stringify(options.body);
    }
  }
  if (options.auth !== false) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
    method: options.method ?? "GET",
    headers,
    body: requestBody,
    signal: options.signal,
  });

  if (
    response.status === 401 &&
    options.auth !== false &&
    options.retryOn401 !== false
  ) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return performRequest<T>(path, { ...options, retryOn401: false });
    }
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Your session has ended. Sign in again.",
    );
  }

  if (!response.ok) {
    const error = await readError(response);
    if (response.status === 401 && options.auth !== false) {
      clearSession();
      notifyUnauthorized();
    }
    throw error;
  }

  if (options.raw) {
    return { status: response.status, body: response as T };
  }

  if (response.status === 204) {
    return { status: response.status, body: undefined as T };
  }

  return { status: response.status, body: (await response.json()) as T };
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const result = await apiRequestResult<T>(path, options);
  return result.body;
}
