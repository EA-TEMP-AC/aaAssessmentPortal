import { describe, expect, it } from "vitest";
import { createVoiceMeter, nextFloor, rms, voiceSignal } from "./audio";

describe("voice loudness (X-14)", () => {
  it("measures root mean square", () => {
    expect(rms([])).toBe(0);
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });

  it("starts the quiet level at the first reading and follows slowly", () => {
    expect(nextFloor(null, 0.01)).toBe(0.01);
    expect(nextFloor(0.01, 0.5)).toBeCloseTo(0.01 + 0.49 * 0.01);
  });

  it("passes only a level well above the quiet level", () => {
    expect(voiceSignal(0.2, 0.01)).toBe(0.2);
    expect(voiceSignal(0.2, 0.1)).toBe(0); // a loud room is not talking
    expect(voiceSignal(0.02, 0.005)).toBe(0.02);
  });

  it("has no meter without a live audio track or a Web Audio context", () => {
    const noAudio = { getAudioTracks: () => [] } as unknown as MediaStream;
    expect(createVoiceMeter(noAudio)).toBeNull();
    const live = { getAudioTracks: () => [{ readyState: "live" }] } as unknown as MediaStream;
    expect(createVoiceMeter(live, undefined, () => null)).toBeNull();
  });

  it("reads the analyser, and nothing counts as talking on the first reading", () => {
    let amplitude = 0.01;
    const context = {
      createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
      createAnalyser: () => ({
        fftSize: 0,
        getFloatTimeDomainData: (a: Float32Array) => a.fill(amplitude),
      }),
      close: async () => {},
    };
    const live = { getAudioTracks: () => [{ readyState: "live" }] } as unknown as MediaStream;
    const meter = createVoiceMeter(live, undefined, () => context)!;
    expect(meter.read()).toBe(0);
    amplitude = 0.01;
    expect(meter.read()).toBe(0);
    amplitude = 0.3;
    expect(meter.read()).toBeCloseTo(0.3);
    meter.release();
  });
});
