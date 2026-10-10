import { useSyncExternalStore } from "react";
import type { AuthSession, ClientSession } from "./types";

let current: ClientSession | null = null;
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
  emit();
}

export function getAccessToken(): string | null {
  return current?.accessToken ?? null;
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
