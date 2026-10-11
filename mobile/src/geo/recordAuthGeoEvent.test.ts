import { describe, expect, it } from "@jest/globals";
import { createGpsCapture, type LocationClient } from "./capture";
import { recordAuthGeoEvent } from "./recordAuthGeoEvent";
import { device, queueWith } from "../testing/fixtures";

function client(partial: Partial<LocationClient> & Pick<LocationClient, "requestForegroundPermissionsAsync">): LocationClient {
  return {
    Accuracy: { High: 4 },
    getCurrentPositionAsync: async () => {
      throw new Error("not used");
    },
    ...partial,
  };
}

describe("geo capture", () => {
  it("records permission denial without coordinates", async () => {
    const capture = createGpsCapture(
      client({
        requestForegroundPermissionsAsync: async () => ({ status: "denied" }),
      }),
    );
    const gps = await capture();
    expect(gps).toEqual({ status: "unavailable", reason: "permission_denied" });
  });

  it("records a location failure without inventing coordinates", async () => {
    const capture = createGpsCapture(
      client({
        requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
        getCurrentPositionAsync: async () => {
          throw new Error("Location timeout");
        },
      }),
    );
    const gps = await capture();
    expect(gps.status).toBe("unavailable");
    if (gps.status === "unavailable") {
      expect(gps.reason).toBe("timeout");
      expect("lat" in gps).toBe(false);
    }
  });

  it("keeps the coordinates the device returned", async () => {
    const capture = createGpsCapture(
      client({
        requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
        getCurrentPositionAsync: async () => ({
          timestamp: Date.parse("2026-10-10T08:00:04.000Z"),
          coords: { latitude: 28.6139, longitude: 77.209 },
        }),
      }),
    );
    await expect(capture()).resolves.toEqual({
      status: "captured",
      lat: 28.6139,
      lng: 77.209,
      capturedAt: "2026-10-10T08:00:04.000Z",
    });
  });
});

describe("recordAuthGeoEvent", () => {
  it("queues logout with the device time when GPS is unavailable", async () => {
    const { queue } = queueWith();
    const event = await recordAuthGeoEvent({
      queue,
      type: "logout",
      role: "candidate",
      userId: "learner-1",
      batchId: null,
      device,
      now: () => Date.parse("2026-10-10T08:00:00.000Z"),
      capture: async () => ({ status: "unavailable", reason: "position_unavailable", detail: "no fix" }),
    });
    expect(event?.path).toBe("/student/login-event");
    expect(event?.capturedAt).toBe("2026-10-10T08:00:00.000Z");
    expect(event?.gps).toEqual({
      status: "unavailable",
      reason: "position_unavailable",
      detail: "no fix",
    });
    expect(JSON.stringify(event)).not.toMatch(/"lat"|"lng"/);
  });

  it("uses the fix timestamp when GPS is captured", async () => {
    const { queue } = queueWith();
    const event = await recordAuthGeoEvent({
      queue,
      type: "login",
      role: "assessor",
      userId: "user-1",
      batchId: null,
      device,
      now: () => Date.parse("2026-10-10T08:00:00.000Z"),
      capture: async () => ({
        status: "captured",
        lat: 19.076,
        lng: 72.8777,
        capturedAt: "2026-10-10T08:00:05.000Z",
      }),
    });
    expect(event?.capturedAt).toBe("2026-10-10T08:00:05.000Z");
    expect(event?.gps).toMatchObject({ lat: 19.076, lng: 72.8777 });
  });

  it("does not queue an event for a role without a login-event path", async () => {
    const { queue } = queueWith();
    const event = await recordAuthGeoEvent({
      queue,
      type: "login",
      role: "aa_admin",
      userId: "admin-1",
      batchId: null,
      device,
      now: () => Date.parse("2026-10-10T08:00:00.000Z"),
      capture: async () => {
        throw new Error("should not capture");
      },
    });
    expect(event).toBeNull();
    expect(await queue.list()).toEqual([]);
  });
});
