export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function readErrorBody(payload: unknown, fallback: string): { code: string; message: string } {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
    if (error && typeof error.code === "string") {
      return {
        code: error.code,
        message: typeof error.message === "string" ? error.message : error.code,
      };
    }
  }
  return { code: "UNKNOWN", message: fallback };
}

/** The server refused the request for good. Sending the same event again cannot succeed. */
export type RejectedResult = { kind: "rejected"; status: number; code: string; message: string };

/**
 * Open question 136: 400, 403, 404, and 409 INVALID_TRANSITION are permanent.
 * 401 (sign in again), 409 CONFLICT_IDEMPOTENT (kept as a conflict), 429, 5xx,
 * and any other status stay with their own handling.
 */
export function isPermanentRejection(status: number, code: string): boolean {
  if (status === 400 || status === 403 || status === 404) return true;
  return status === 409 && code === "INVALID_TRANSITION";
}
