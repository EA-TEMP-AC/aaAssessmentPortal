import { expect, it } from "vitest";
import { parseProctorConfig } from "./proctoringSession";

it("keeps the switched-off flag types and the video settings from the server (X-16, X-27)", () => {
  const config = parseProctorConfig({
    snapshotIntervalSeconds: 30,
    detectionIntervalMs: 1000,
    flagCooldownSeconds: 15,
    sustainedSeconds: {},
    disabledFlags: ["voice_detected", 7],
    recordVideo: true,
    videoChunkSeconds: 10,
  });
  expect(config.disabledFlags).toEqual(["voice_detected"]);
  expect(config.recordVideo).toBe(true);
  expect(config.videoChunkSeconds).toBe(10);
  const plain = parseProctorConfig({});
  expect(plain.disabledFlags).toBeUndefined();
  expect(plain.recordVideo).toBeUndefined();
});
