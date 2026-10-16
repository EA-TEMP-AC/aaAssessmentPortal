import { ApiError, apiRequest } from "./client";
import {
  isSectorName,
  isStateName,
  type SectorName,
  type StateName,
} from "./annexure";

/**
 * GET|PUT /admin/recognition. API_CONTRACT v0.5.
 * A 404 means no recognition row yet (open question 86).
 */

export type Recognition = {
  id: string;
  sectors: SectorName[];
  panIndia: boolean;
  states: StateName[];
  startDate: string;
  endDate: string;
};

export type RecognitionWrite = {
  sectors: SectorName[];
  panIndia: boolean;
  states: StateName[];
  startDate: string;
  endDate: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function responseError(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "Recognition response was not recognised.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueNames<T extends string>(
  value: unknown,
  isName: (item: string) => item is T,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const names: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isName(item) || names.includes(item))
      return null;
    names.push(item);
  }
  return names;
}

export function parseRecognition(value: unknown): Recognition {
  if (!isRecord(value)) throw responseError();
  const id =
    typeof value.id === "string" && value.id.length > 0 ? value.id : null;
  const sectors = uniqueNames(value.sectors, isSectorName);
  const states = uniqueNames(value.states, isStateName);
  const panIndia = typeof value.panIndia === "boolean" ? value.panIndia : null;
  const startDate =
    typeof value.startDate === "string" && isIsoDate(value.startDate)
      ? value.startDate
      : null;
  const endDate =
    typeof value.endDate === "string" && isIsoDate(value.endDate)
      ? value.endDate
      : null;
  if (
    !id ||
    !sectors ||
    sectors.length === 0 ||
    !states ||
    panIndia === null ||
    !startDate ||
    !endDate
  ) {
    throw responseError();
  }
  if (endDate < startDate) throw responseError();
  if (panIndia && states.length > 0) throw responseError();
  if (!panIndia && states.length === 0) throw responseError();
  return { id, sectors, panIndia, states, startDate, endDate };
}

export async function getRecognition(
  signal?: AbortSignal,
): Promise<Recognition | null> {
  try {
    const body = await apiRequest<unknown>("/admin/recognition", { signal });
    return parseRecognition(body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function saveRecognition(
  input: RecognitionWrite,
): Promise<Recognition> {
  const body = await apiRequest<unknown>("/admin/recognition", {
    method: "PUT",
    body: input,
  });
  return parseRecognition(body);
}
