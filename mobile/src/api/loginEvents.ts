import type { DeviceInfo } from "../domain/device";
import { MAX_CLOCK_SKEW_MS } from "../config/compliance";
import type { GpsCapture, QueuedLoginEvent } from "../queue/types";
import { isPermanentRejection, readErrorBody, readJson, type RejectedResult } from "./http";

export type LoginEventSuccess = {
  kind: "success";
  replayed: boolean;
  lateSync: boolean;
  clockSkewFlag: boolean;
  abEmailQueuedAt: string | null;
  abEmailSentAt: string | null;
};

export type LoginEventPostResult =
  | LoginEventSuccess
  | { kind: "conflict"; code: "CONFLICT_IDEMPOTENT"; message: string }
  | RejectedResult
  | { kind: "retryable"; message: string }
  | { kind: "unauthorized"; message: string };

export type LoginEventApi = {
  post(event: QueuedLoginEvent, accessToken: string): Promise<LoginEventPostResult>;
};

export type LoginEventBody = {
  clientEventId: string;
  batchId: string | null;
  type: QueuedLoginEvent["type"];
  capturedAt: string;
  locationStatus: GpsCapture["status"];
  lat?: number;
  lng?: number;
  locationUnavailableReason?: string;
  locationUnavailableDetail?: string;
  device: DeviceInfo;
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar date in IST (UTC+05:30) as YYYY-MM-DD. SCHEMA lateSync compares these dates. */
export function istCalendarDate(epochMs: number): string {
  const shifted = new Date(epochMs + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * SCHEMA §3.11: lateSync when the IST date of receivedAt is after the IST date of capturedAt.
 * The assessment-window clause needs the batch dates, which M-02 downloads. See DECISIONS.md.
 */
export function isLateSyncByIstDate(capturedAtIso: string, receivedAtMs: number): boolean {
  const capturedMs = Date.parse(capturedAtIso);
  if (Number.isNaN(capturedMs)) return false;
  return istCalendarDate(receivedAtMs) > istCalendarDate(capturedMs);
}

export function toLoginEventBody(event: QueuedLoginEvent): LoginEventBody {
  const body: LoginEventBody = {
    clientEventId: event.clientEventId,
    batchId: event.batchId,
    type: event.type,
    capturedAt: event.capturedAt,
    locationStatus: event.gps.status,
    device: event.device,
  };
  if (event.gps.status === "captured") {
    body.lat = event.gps.lat;
    body.lng = event.gps.lng;
    return body;
  }
  body.locationUnavailableReason = event.gps.reason;
  if (event.gps.detail) body.locationUnavailableDetail = event.gps.detail;
  return body;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function optionalIso(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function successFromPayload(payload: unknown): LoginEventSuccess {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    kind: "success",
    replayed: body.replayed === true,
    lateSync: body.lateSync === true,
    clockSkewFlag: body.clockSkewFlag === true,
    abEmailQueuedAt: optionalIso(body.abEmailQueuedAt),
    abEmailSentAt: optionalIso(body.abEmailSentAt),
  };
}

export function createLiveLoginEventApi(options: { baseUrl: string; fetchImpl?: FetchLike }): LoginEventApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return {
    async post(event, accessToken) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${event.path}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(toLoginEventBody(event)),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network request failed";
        return { kind: "retryable", message };
      }

      const payload = await readJson(response);
      if (response.status === 200) {
        if (!payload || typeof payload !== "object") {
          return { kind: "retryable", message: "Login event response was empty" };
        }
        return successFromPayload(payload);
      }

      const error = readErrorBody(payload, `Login event failed (${response.status})`);
      if (response.status === 401) {
        return { kind: "unauthorized", message: error.message };
      }
      if (response.status === 409 && error.code === "CONFLICT_IDEMPOTENT") {
        return { kind: "conflict", code: "CONFLICT_IDEMPOTENT", message: error.message };
      }
      if (isPermanentRejection(response.status, error.code)) {
        return { kind: "rejected", status: response.status, code: error.code, message: error.message };
      }
      return { kind: "retryable", message: `${error.code}: ${error.message}` };
    },
  };
}

type StoredMockResult = {
  canonical: string;
  success: Omit<LoginEventSuccess, "kind" | "replayed">;
};

/**
 * In-memory stand-in for POST /assessor|proctor|student/login-event.
 * Same clientEventId + same payload → 200 replayed. Same id + different payload → 409 CONFLICT_IDEMPOTENT.
 * The map lives with the API instance (one per app process). The device queue is what survives restarts.
 */
export function createMockLoginEventApi(options?: { now?: () => number }): LoginEventApi {
  const now = options?.now ?? (() => Date.now());
  const seen = new Map<string, StoredMockResult>();

  return {
    async post(event) {
      const body = toLoginEventBody(event);
      const canonical = stableStringify(body);
      const previous = seen.get(event.clientEventId);
      if (previous) {
        if (previous.canonical !== canonical) {
          return {
            kind: "conflict",
            code: "CONFLICT_IDEMPOTENT",
            message: "Same clientEventId with a different payload",
          };
        }
        return { kind: "success", replayed: true, ...previous.success };
      }

      const receivedAt = now();
      const capturedMs = Date.parse(event.capturedAt);
      const clockSkewFlag = Number.isFinite(capturedMs) && Math.abs(receivedAt - capturedMs) > MAX_CLOCK_SKEW_MS;
      const lateSync = isLateSyncByIstDate(event.capturedAt, receivedAt);
      const abEmailQueuedAt =
        event.path === "/assessor/login-event" && event.type === "login"
          ? new Date(receivedAt).toISOString()
          : null;
      const success = {
        lateSync,
        clockSkewFlag,
        abEmailQueuedAt,
        abEmailSentAt: null,
      };
      seen.set(event.clientEventId, { canonical, success });
      return { kind: "success", replayed: false, ...success };
    },
  };
}

export function createLoginEventApi(options: {
  mode: "mock" | "live";
  baseUrl: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): LoginEventApi {
  if (options.mode === "live") {
    return createLiveLoginEventApi({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl });
  }
  return createMockLoginEventApi({ now: options.now });
}
