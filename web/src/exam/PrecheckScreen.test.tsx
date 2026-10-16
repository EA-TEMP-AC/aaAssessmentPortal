import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { fakeStream, frame, stubFetch } from "../test/examFixtures";
import { fakeFaceChecks, makeVideosReady } from "../test/faceFixtures";
import { isBlackFrame } from "./precheck";
import { PrecheckScreen, type FrameCheckOptions } from "./PrecheckScreen";

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  makeVideosReady();
  stubFetch((u) => (u.pathname.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(404)));
});

function setup(frameCheck: FrameCheckOptions, props: Partial<Parameters<typeof PrecheckScreen>[0]> = {}) {
  const onStart = vi.fn();
  const view = render(
    <PrecheckScreen
      heading="Batch 1"
      starting={false}
      startError={null}
      onStart={onStart}
      onCancel={() => {}}
      frameCheck={{ attempts: 3, intervalMs: 1, ...frameCheck }}
      faceChecks={fakeFaceChecks()}
      {...props}
    />,
  );
  return { onStart, unmount: view.unmount };
}

function startButton() {
  return screen.getByRole("button", { name: "Start exam" });
}

it("keeps Start disabled until the camera check passes and the notice is agreed", async () => {
  const user = userEvent.setup();
  const { stream } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { onStart } = setup({ sample: () => frame(140) });

  expect(screen.getByText(/no video is uploaded/i)).toBeInTheDocument();
  expect(screen.getByText(/a person reviews every flag/i)).toBeInTheDocument();
  expect(screen.getByText(/face on your ID card is compared with your selfie/i)).toBeInTheDocument();
  expect(screen.getByText(/nothing is sent except flags and a few photos/i)).toBeInTheDocument();
  expect(startButton()).toBeDisabled();
  expect(await screen.findByText(/Connected to the exam server/)).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  expect(startButton()).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Check camera" }));
  expect(await screen.findByText("Camera check passed.")).toBeInTheDocument();
  expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
  expect(screen.getByLabelText("Camera preview")).toBeVisible();
  // The ID card and selfie steps are part of the gate.
  expect(startButton()).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  expect(await screen.findByText(/look alike/)).toBeInTheDocument();
  expect(startButton()).toBeEnabled();

  await user.click(startButton());
  expect(onStart).toHaveBeenCalledWith(stream, expect.objectContaining({ idOutcome: "match" }));
});

it("fails the check on a black picture and keeps Start disabled", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  setup({ sample: () => frame(3) });

  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/camera picture is black/i);
  expect(startButton()).toBeDisabled();
  expect(screen.getByText(/pass the camera check/)).toBeInTheDocument();
});

it("explains a refused camera permission", async () => {
  const user = userEvent.setup();
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  setup({ sample: () => frame(140) });

  await user.click(screen.getByRole("button", { name: "Check camera" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Camera permission was refused/);
  expect(startButton()).toBeDisabled();
});

it("treats the microphone as optional and stops it straight away", async () => {
  const user = userEvent.setup();
  const mic = fakeStream();
  getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) =>
    constraints.audio ? mic.stream : fakeStream().stream,
  );
  setup({ sample: () => frame(140) });

  await user.click(screen.getByRole("button", { name: "Check microphone" }));
  expect(await screen.findByText("Microphone permission is allowed.")).toBeInTheDocument();
  expect(mic.track.stop).toHaveBeenCalled();

  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  await user.click(screen.getByRole("button", { name: "Check microphone" }));
  expect(await screen.findByText("Microphone permission was refused. You can still take the exam.")).toBeInTheDocument();
});

it("stops the camera when the screen closes without starting", async () => {
  const user = userEvent.setup();
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { onStart, unmount } = setup({ sample: () => frame(140) });
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("Camera check passed.");
  expect(track.stop).not.toHaveBeenCalled();
  unmount();
  expect(onStart).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalled();
});

it("reports an unreachable server", async () => {
  stubFetch(() => {
    throw new TypeError("offline");
  });
  setup({ sample: () => frame(140) });
  expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
});

it("tells black frames from lit ones", () => {
  expect(isBlackFrame(frame(0))).toBe(true);
  expect(isBlackFrame(frame(15))).toBe(true);
  expect(isBlackFrame(frame(80))).toBe(false);
  expect(isBlackFrame(new Uint8ClampedArray())).toBe(true);
});
