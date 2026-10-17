import { describe, expect, it, vi } from "vitest";
import { startVideoRecorder } from "./videoRecorder";

class FakeRecorder extends EventTarget {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  started: number | null = null;
  start(ms: number) {
    this.started = ms;
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) } as BlobEvent);
  }
}

function setup(sendImpl?: (track: string, seq: number) => Promise<void>) {
  const recorders: FakeRecorder[] = [];
  const send = vi.fn(async (track: string, seq: number) => sendImpl?.(track, seq));
  const onFailure = vi.fn();
  const camera = { getVideoTracks: () => [] } as unknown as MediaStream;
  const screen = {} as MediaStream;
  const recorder = startVideoRecorder({
    camera,
    screen,
    chunkSeconds: 10,
    send: send as never,
    onFailure,
    wait: async () => {},
    recorderFactory: () => {
      const r = new FakeRecorder();
      recorders.push(r);
      return r as unknown as MediaRecorder;
    },
  });
  return { recorder, recorders, send, onFailure };
}

describe("video recorder (X-27)", () => {
  it("starts a recorder per track with the chunk length and sends numbered pieces in order", async () => {
    const { recorder, recorders, send } = setup();
    expect(recorders.map((r) => r.started)).toEqual([10_000, 10_000]);
    recorders[0].emit("a");
    recorders[0].emit("b");
    recorders[1].emit("s");
    await recorder.stop();
    const calls = send.mock.calls.map((c) => `${c[0]}-${c[1]}`);
    // Each track keeps its own order; the two tracks may interleave.
    expect(calls.filter((c) => c.startsWith("camera"))).toEqual(["camera-0", "camera-1"]);
    expect(calls.filter((c) => c.startsWith("screen"))).toEqual(["screen-0"]);
  });

  it("retries a piece, and tells the page once when it cannot be sent", async () => {
    const { recorder, recorders, send, onFailure } = setup(async () => {
      throw new Error("offline");
    });
    recorders[0].emit("a");
    recorders[0].emit("b");
    await recorder.stop();
    // 1 first try + 3 retries for each of the two pieces.
    expect(send).toHaveBeenCalledTimes(8);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("camera", "could not send");
  });

  it("recovers when a retry works, with no failure reported", async () => {
    let tries = 0;
    const { recorder, recorders, onFailure } = setup(async () => {
      tries += 1;
      if (tries === 1) throw new Error("blip");
    });
    recorders[0].emit("a");
    await recorder.stop();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("reports a missing screen and a recorder that cannot start", () => {
    const onFailure = vi.fn();
    startVideoRecorder({
      camera: { getVideoTracks: () => [] } as unknown as MediaStream,
      screen: null,
      chunkSeconds: 10,
      send: async () => {},
      onFailure,
      recorderFactory: () => {
        throw new Error("no");
      },
    });
    expect(onFailure).toHaveBeenCalledWith("camera", "could not start");
    expect(onFailure).toHaveBeenCalledWith("screen", "no screen");
  });
});
