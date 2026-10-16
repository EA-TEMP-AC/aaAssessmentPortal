import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

// The real model needs WebGL and a camera, which jsdom does not have.
const mock = vi.hoisted(() => ({
  script: {} as Record<string, unknown[]>,
  instances: [] as { clear: () => void; calls: string[] }[],
}));
vi.mock("../proctoring/face/faceApiMatcher", async () => {
  const { FakeFaceMatcher } = await import("../proctoring/face/fakeMatcher");
  return {
    FaceApiMatcher: class extends FakeFaceMatcher {
      constructor() {
        super(mock.script as never);
        mock.instances.push(this);
      }
    },
  };
});

const fetchMock = vi.fn();
const descriptors = Object.getOwnPropertyDescriptors(HTMLMediaElement.prototype);

beforeEach(() => {
  mock.script = {};
  mock.instances = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
});

afterEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", descriptors.readyState);
  Reflect.deleteProperty(HTMLVideoElement.prototype, "videoWidth");
  Reflect.deleteProperty(HTMLVideoElement.prototype, "videoHeight");
});

it("sends anyone but aa_admin to Home", async () => {
  setSession(sessionFor("mis"));
  renderApp("/face-match-demo");
  expect(await screen.findByRole("heading", { level: 1 })).not.toHaveTextContent(/face match demo/i);
});

it("runs ID card, selfie and live check without calling the server", async () => {
  mock.script = {
    compareLargest: [{ found: true, distance: 0.72 }],
    compare: [{ state: "mismatch", distance: 0.81 }],
  };
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp("/face-match-demo");
  await screen.findByRole("heading", { name: /face match demo/i });

  await user.click(screen.getByRole("button", { name: "Start camera" }));
  await user.click(await screen.findByRole("button", { name: "Capture ID card" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Take selfie" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Take selfie" }));

  expect(await screen.findByText("mismatch")).toBeInTheDocument();
  expect(screen.getByText(/distance 0\.720/)).toBeInTheDocument();
  expect(screen.getByText(/would raise flag: id_mismatch/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Start live check" }));
  expect(await screen.findByText(/^0.810/)).toBeInTheDocument();
  expect(screen.getByText(/1 of 3/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Stop and clear" }));
  expect(mock.instances[0].calls).toContain("clear");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows an actionable message when the ID card has no readable face", async () => {
  mock.script = { compareLargest: [{ found: false }] };
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp("/face-match-demo");
  await user.click(await screen.findByRole("button", { name: "Start camera" }));
  await user.click(await screen.findByRole("button", { name: "Capture ID card" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Take selfie" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Take selfie" }));

  expect(await screen.findByText(/hold the card flat, closer/i)).toBeInTheDocument();
  expect(screen.getByText(/not a mismatch/i)).toBeInTheDocument();
  expect(screen.queryByText(/would raise flag/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retake ID card" })).toBeInTheDocument();
});

it("tells the candidate to face the camera when no selfie face is found", async () => {
  mock.script = { setReference: [{ ok: false, reason: "no_face" }] };
  setSession(sessionFor("aa_admin"));
  const user = userEvent.setup();
  renderApp("/face-match-demo");
  await user.click(await screen.findByRole("button", { name: "Start camera" }));
  await user.click(await screen.findByRole("button", { name: "Capture ID card" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Take selfie" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(/more light.*face the camera/i);
});
