import { useSyncExternalStore } from "react";
import type { AccessSettings } from "./settings";
import type { AuthSession, ClientSession } from "./types";

let current: ClientSession | null = null;
let accessSettings: AccessSettings | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ClientSession | null {
  return current;
}

export function setSession(session: ClientSession) {
  current = session;
  accessSettings = null;
  emit();
}

export function updateSession(next: AuthSession) {
  if (!current) return;
  current = { ...next, device: current.device };
  emit();
}

export function clearSession() {
  if (!current) return;
  current = null;
  accessSettings = null;
  emit();
}

/** Access settings kept with the session for `ncvet_viewer`; `null` until loaded or when the load failed. */
export function getAccessSettingsSnapshot(): AccessSettings | null {
  return accessSettings;
}

export function setAccessSettings(next: AccessSettings | null) {
  if (!current) return;
  accessSettings = next;
  emit();
}

export function getAccessToken(): string | null {
  return current?.accessToken ?? null;
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSessionAccessSettings(): AccessSettings | null {
  return useSyncExternalStore(subscribe, getAccessSettingsSnapshot, getAccessSettingsSnapshot);
}
