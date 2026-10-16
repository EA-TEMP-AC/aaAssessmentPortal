import { afterEach, expect, it, vi } from "vitest";
import { fakeStream } from "../test/examFixtures";
import {
  ENGINE_NOT_INSTALLED,
  getProctorEngine,
  installProctorEngine,
  type ProctorConfig,
  type ProctorEngine,
} from "./proctorBridge";

const config: ProctorConfig = {
  snapshotIntervalSeconds: 120,
  detectionIntervalMs: 500,
  flagCooldownSeconds: 30,
  sustainedSeconds: { face_not_present: 5 },
};

afterEach(() => installProctorEngine(null));

it("returns a no-op engine that reports degraded until a real engine is installed", async () => {
  const onStatus = vi.fn();
  const engine = getProctorEngine();
  await engine.start({
    stream: fakeStream().stream,
    sessionId: "s1",
    attemptId: "a1",
    batchId: "b1",
    config,
    onStatus,
  });
  expect(onStatus).toHaveBeenCalledWith({ state: "degraded", message: ENGINE_NOT_INSTALLED });
  expect(ENGINE_NOT_INSTALLED).toBe("Proctoring engine not installed");
  engine.stop();
  expect(onStatus).toHaveBeenLastCalledWith({ state: "stopped" });
});

it("hands out the installed engine and can go back to the no-op one", async () => {
  const fake: ProctorEngine = { start: vi.fn(async () => {}), stop: vi.fn() };
  installProctorEngine(() => fake);
  expect(getProctorEngine()).toBe(fake);

  installProctorEngine(null);
  const onStatus = vi.fn();
  await getProctorEngine().start({
    stream: fakeStream().stream,
    sessionId: "s1",
    attemptId: "a1",
    batchId: "b1",
    config,
    onStatus,
  });
  expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "degraded" }));
});
