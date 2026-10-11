import type { KeyValueStore } from "../storage/types";

const DEVICE_ID_KEY = "aa.deviceId.v1";

export async function ensureDeviceId(store: KeyValueStore, createId: () => string): Promise<string> {
  const existing = await store.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = createId();
  await store.setItem(DEVICE_ID_KEY, id);
  return id;
}
