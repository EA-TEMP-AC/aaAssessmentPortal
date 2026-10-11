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
