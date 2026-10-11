import type { DeviceInfo } from "../domain/device";
import { createEventQueue, type EventQueue } from "../queue/eventQueue";
import type { NewLoginEvent } from "../queue/types";
import { MemoryStorage } from "../storage/memoryStorage";

export const device: DeviceInfo = {
  deviceId: "dev-test",
  platform: "android",
  appVersion: "0.0.1",
};

export function newEvent(overrides: Partial<NewLoginEvent> = {}): NewLoginEvent {
  return {
    type: "login",
    role: "assessor",
    userId: "user-1",
    batchId: null,
    capturedAt: "2026-10-10T08:00:00.000Z",
    gps: {
      status: "captured",
      lat: 12.9716,
      lng: 77.5946,
      capturedAt: "2026-10-10T08:00:00.000Z",
    },
    device,
    ...overrides,
  };
}

export function queueWith(createId?: () => string): { storage: MemoryStorage; queue: EventQueue } {
  const storage = new MemoryStorage();
  return {
    storage,
    queue: createEventQueue(storage, createId ? { createId } : undefined),
  };
}
