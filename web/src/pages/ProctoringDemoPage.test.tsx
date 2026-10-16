import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import type { EngineOptions } from "../proctoring/engine";
import type { ProctorEngine } from "../proctoring/types";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

// The real engine needs a camera and MediaPipe, which jsdom does not have.
const engineMock = vi.hoisted(() => ({ options: null as EngineOptions | null, stop: vi.fn() }));
vi.mock("../proctoring/engine", () => ({
  createEngine: (options: EngineOptions): ProctorEngine => {
    engineMock.options = options;
    return {
      async start(o) {
        o.onStatus({ state: "starting" });
        o.onStatus({ state: "running" });
        options.onTick?.(10);
        options.onTick?.(20);
        options.onDetections?.([{ kind: "face", label: "face", confidence: 0.91 }], {
          brightness: 120,
          identical: false,
        });
        await options.transport?.sendFlag(o.sessionId, {
          clientEventId: "demo-f1",
          type: "phone_detected",
          capturedAt: "2026-10-16T05:00:00.000Z",
          detail: { label: "cell phone", count: 1, confidence: 0.8 },
        });
      },
      stop: engineMock.stop,
    };
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  engineMock.options = null;
  engineMock.stop.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { items: [] }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

function stubCamera(impl: () => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}

it("sends anyone but aa_admin to Home", async () => {
  setSession(sessionFor("mis"));
  renderApp("/proctoring-demo");
  expect(await screen.findByRole("heading", { level: 1 })).not.toHaveTextContent(/proctoring engine demo/i);
});

it("starts the engine, shows detections and flags, and calls no server", async () => {
  const trackStop = vi.fn();
  const stream = { getTracks: () => [{ stop: trackStop }], getVideoTracks: () => [] } as unknown as MediaStream;
  const getUserMedia = stubCamera(async () => stream);
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring-demo");
  const user = userEvent.setup();

  expect(await screen.findByRole("heading", { name: /proctoring engine demo/i })).toBeInTheDocument();
  expect(screen.getByText("No flags yet.")).toBeInTheDocument();
  const callsBefore = fetchMock.mock.calls.length;

  await user.click(screen.getByRole("button", { name: /start camera/i }));
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  expect(await screen.findByText("running")).toBeInTheDocument();
  expect(screen.getByText("face 91%")).toBeInTheDocument();
  expect(screen.getByText("phone_detected")).toBeInTheDocument();
  expect(screen.getByText("15.0 ms over 2 checks")).toBeInTheDocument();
  expect(fetchMock.mock.calls.length).toBe(callsBefore);

  await user.click(screen.getByRole("button", { name: /^stop$/i }));
  expect(engineMock.stop).toHaveBeenCalled();
  expect(trackStop).toHaveBeenCalled();
});

it("explains a refused camera permission", async () => {
  stubCamera(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring-demo");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /start camera/i }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/permission was refused/i));
  expect(engineMock.options).toBeNull();
});
