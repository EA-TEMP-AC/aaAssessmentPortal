import { useEffect } from "react";
import { ApiError } from "../api/client";

export const SITE_NAME = "Assessment Agency";
/** Public responses are cached for 5 minutes (Cache-Control max-age=300), so do not refetch sooner. */
export const PUBLIC_STALE_MS = 5 * 60 * 1000;

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | ${SITE_NAME}`;
  }, [title]);
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Too many requests right now. Wait a minute and try again.";
  }
  if (error instanceof ApiError && error.status === 404) return "This section is not available.";
  return "This page could not be loaded. Check your connection and try again.";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

