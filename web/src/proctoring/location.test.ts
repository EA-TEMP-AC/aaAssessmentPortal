import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocationProvider, LOCATION_CACHE_MS } from "./location";

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

function position(latitude: number, longitude: number, accuracy: number) {
  return { coords: { latitude, longitude, accuracy } } as GeolocationPosition;
}

function fakeGeo(answer: "allow" | "refuse" | "throw" | "silent") {
  const getCurrentPosition = vi.fn((ok: Success, fail: Failure) => {
    if (answer === "allow") ok(position(19.0761234567, 72.8774561234, 12.4));
    else if (answer === "refuse") fail({ code: 1 } as GeolocationPositionError);
    else if (answer === "throw") throw new Error("blocked by policy");
  });
  const watchPosition = vi.fn();
  return { geo: { getCurrentPosition, watchPosition } as unknown as Geolocation, getCurrentPosition, watchPosition };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-16T05:00:00.000Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("location provider", () => {
  it("allowed: returns the position rounded to 6 places and whole metres", async () => {
    const { geo } = fakeGeo("allow");
    const provider = createLocationProvider({ geolocation: geo });
    expect(await provider.get()).toEqual({ latitude: 19.076123, longitude: 72.877456, accuracy: 12 });
  });

  it("refused: gives null and does not throw", async () => {
    const { geo } = fakeGeo("refuse");
    expect(await createLocationProvider({ geolocation: geo }).get()).toBeNull();
  });

  it("a browser that throws gives null", async () => {
    const { geo } = fakeGeo("throw");
    expect(await createLocationProvider({ geolocation: geo }).get()).toBeNull();
  });

  it("no geolocation in the browser gives null", async () => {
    expect(await createLocationProvider({ geolocation: null }).get()).toBeNull();
  });

  it("an ignored prompt gives null after the timeout", async () => {
    const { geo } = fakeGeo("silent");
    const result = createLocationProvider({ geolocation: geo, timeoutMs: 1000 }).get();
    await vi.advanceTimersByTimeAsync(2100);
    expect(await result).toBeNull();
  });

  it("asks once and keeps the answer for 60 seconds", async () => {
    const { geo, getCurrentPosition } = fakeGeo("allow");
    const provider = createLocationProvider({ geolocation: geo });
    await provider.get();
    await vi.advanceTimersByTimeAsync(LOCATION_CACHE_MS - 1000);
    await provider.get();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await provider.get();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("does not ask again for 60 seconds after a refusal", async () => {
    const { geo, getCurrentPosition } = fakeGeo("refuse");
    const provider = createLocationProvider({ geolocation: geo });
    await provider.get();
    await provider.get();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("two photos at the same moment share one request", async () => {
    const { geo, getCurrentPosition } = fakeGeo("allow");
    const provider = createLocationProvider({ geolocation: geo });
    const [a, b] = await Promise.all([provider.get(), provider.get()]);
    expect(a).toEqual(b);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("never tracks: watchPosition is not used", async () => {
    const { geo, watchPosition } = fakeGeo("allow");
    const provider = createLocationProvider({ geolocation: geo });
    await provider.get();
    await vi.advanceTimersByTimeAsync(LOCATION_CACHE_MS * 3);
    await provider.get();
    expect(watchPosition).not.toHaveBeenCalled();
  });
});
