import { expect, it, vi } from "vitest";
import { holdScreen, releaseHeldScreen, requestScreen, takeHeldScreen } from "./screenShare";

function fakeScreen(displaySurface?: string) {
  const stop = vi.fn();
  const track = { stop, getSettings: () => ({ displaySurface }) };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stop };
}

it("accepts the whole screen, and a browser that does not say what was shared", async () => {
  const monitor = fakeScreen("monitor");
  expect(await requestScreen(async () => monitor.stream)).toEqual({ state: "ok", stream: monitor.stream });
  const unknown = fakeScreen(undefined);
  expect((await requestScreen(async () => unknown.stream)).state).toBe("ok");
});

it("refuses a window or a tab and stops it", async () => {
  const win = fakeScreen("window");
  expect((await requestScreen(async () => win.stream)).state).toBe("not_entire");
  expect(win.stop).toHaveBeenCalled();
});

it("reports a refusal and a browser that cannot share", async () => {
  expect((await requestScreen(async () => Promise.reject(new Error("denied")))).state).toBe("denied");
  Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
  expect((await requestScreen()).state).toBe("unavailable");
});

it("holds the stream for the exam, and stops it when released", () => {
  const a = fakeScreen("monitor");
  holdScreen(a.stream);
  expect(takeHeldScreen()).toBe(a.stream);
  expect(takeHeldScreen()).toBeNull();
  const b = fakeScreen("monitor");
  holdScreen(b.stream);
  releaseHeldScreen();
  expect(b.stop).toHaveBeenCalled();
  expect(takeHeldScreen()).toBeNull();
});
