import { render, screen, within } from "@testing-library/react";
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

const startButton = () => screen.getByRole("button", { name: "Start exam" });
const nextButton = () => screen.getByRole("button", { name: "Next: photo ID and photo" });
const rowOf = (label: string) => within(screen.getByText(label).closest("li") as HTMLElement);

async function toPhotoTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("The camera works.");
  await screen.findByText(/Connected to the exam server/);
  await user.click(nextButton());
}

it("keeps Next disabled until the required browser checks pass", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  setup({ sample: () => frame(140) });

  expect(nextButton()).toBeDisabled();
  expect(nextButton()).toHaveAccessibleDescription(/camera access/);
  // The microphone is optional: it is not on the list of things to pass.
  expect(nextButton()).not.toHaveAccessibleDescription(/microphone/);
  expect(screen.getByText("Microphone (optional)")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Photo ID and photo/ })).toBeDisabled();
  expect(screen.getByRole("tab", { name: /Browser checks/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Step 1 of 2: Browser checks");

  expect(await screen.findByText(/Connected to the exam server/)).toBeInTheDocument();
  expect(nextButton()).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  expect(await screen.findByText("The camera works.")).toBeInTheDocument();
  expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
  expect(screen.getByLabelText("Camera preview")).toBeVisible();
  expect(nextButton()).toBeEnabled();
});

it("shows a pass or fail row with a reason for the browser, connection, camera and network", async () => {
  getUserMedia.mockResolvedValue(fakeStream().stream);
  setup({ sample: () => frame(140) });
  expect(rowOf("Browser supported").getByText("Pass.")).toBeInTheDocument();
  expect(rowOf("Browser supported").getByText("Your browser can run the exam.")).toBeInTheDocument();
  expect(rowOf("Secure connection").getByText("Pass.")).toBeInTheDocument();
  expect(rowOf("Camera access").getByText("Not checked.")).toBeInTheDocument();
  expect(await rowOf("Network speed").findByText(/Connected to the exam server \(\d+ ms\)/)).toBeInTheDocument();
  expect(rowOf("Network speed").getByText("Pass.")).toBeInTheDocument();
});

it("fails the browser row with a plain reason when the camera API is missing, and retries", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  setup({ sample: () => frame(140) });
  const row = rowOf("Browser supported");
  expect(row.getByText("Fail.")).toBeInTheDocument();
  expect(row.getByRole("alert")).toHaveTextContent(/cannot use the camera/);
  expect(nextButton()).toBeDisabled();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  await user.click(row.getByRole("button", { name: "Retry browser supported check" }));
  expect(row.getByText("Pass.")).toBeInTheDocument();
});

it("fails the network row when the server cannot be reached and retries", async () => {
  const user = userEvent.setup();
  let up = false;
  stubFetch(() => {
    if (!up) throw new TypeError("offline");
    return jsonResponse(200, { status: "ok" });
  });
  getUserMedia.mockResolvedValue(fakeStream().stream);
  setup({ sample: () => frame(140) });
  const row = rowOf("Network speed");
  expect(await row.findByText("Fail.")).toBeInTheDocument();
  expect(row.getByRole("alert")).toHaveTextContent(/could not be reached/);
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("The camera works.");
  expect(nextButton()).toBeDisabled();
  up = true;
  await user.click(row.getByRole("button", { name: "Retry network check" }));
  expect(await row.findByText("Pass.")).toBeInTheDocument();
  expect(nextButton()).toBeEnabled();
});

it("moves between the two tabs with the keyboard and keeps the first tab's results", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  setup({ sample: () => frame(140) });
  const first = screen.getByRole("tab", { name: /Browser checks/ });
  first.focus();
  await user.keyboard("{ArrowRight}");
  // Locked: the camera check has not passed.
  expect(first).toHaveAttribute("aria-selected", "true");

  await toPhotoTab(user);
  expect(screen.getByRole("tab", { name: /Photo ID and photo/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { name: "Photo ID and photo", level: 2 })).toHaveFocus();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Step 2 of 2: Photo ID and photo");

  screen.getByRole("tab", { name: /Photo ID and photo/ }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: /Browser checks/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("The camera works.")).toBeVisible();
});

it("keeps Start disabled until the ID card, selfie and notice are done", async () => {
  const user = userEvent.setup();
  const { stream } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { onStart } = setup({ sample: () => frame(140) });
  await toPhotoTab(user);

  expect(screen.getByText(/no video is uploaded/i)).toBeInTheDocument();
  expect(screen.getByText(/a person reviews every flag/i)).toBeInTheDocument();
  expect(screen.getByText(/face on your ID card is compared with your selfie/i)).toBeInTheDocument();
  expect(screen.getByText(/nothing is sent except flags and a few photos/i)).toBeInTheDocument();
  expect(screen.getByText(/exam opens in its own window/i)).toBeInTheDocument();
  expect(screen.queryByText(/full screen/i)).not.toBeInTheDocument();
  expect(startButton()).toBeDisabled();

  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  expect(startButton()).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  expect(await screen.findByText(/look alike/)).toBeInTheDocument();
  expect(startButton()).toBeEnabled();

  await user.click(startButton());
  expect(onStart).toHaveBeenCalledWith(stream, expect.objectContaining({ idOutcome: "match" }));
});

it("fails the camera row on a black picture and does not allow Next", async () => {
  const user = userEvent.setup();
  getUserMedia.mockResolvedValue(fakeStream().stream);
  setup({ sample: () => frame(3) });

  await user.click(screen.getByRole("button", { name: "Check camera" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/camera picture is black/i);
  expect(nextButton()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry camera check" })).toBeEnabled();
});

it("explains a refused camera permission", async () => {
  const user = userEvent.setup();
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  setup({ sample: () => frame(140) });

  await user.click(screen.getByRole("button", { name: "Check camera" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Camera permission was refused/);
  expect(nextButton()).toBeDisabled();
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
  await user.click(screen.getByRole("button", { name: "Retry microphone check" }));
  expect(await screen.findByText("Microphone permission was refused. You can still take the exam.")).toBeInTheDocument();
  // A refused microphone raises no alert and blocks nothing.
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("stops the camera when the screen closes without starting", async () => {
  const user = userEvent.setup();
  const { stream, track } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const { onStart, unmount } = setup({ sample: () => frame(140) });
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("The camera works.");
  expect(track.stop).not.toHaveBeenCalled();
  unmount();
  expect(onStart).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalled();
});

it("tells black frames from lit ones", () => {
  expect(isBlackFrame(frame(0))).toBe(true);
  expect(isBlackFrame(frame(15))).toBe(true);
  expect(isBlackFrame(frame(80))).toBe(false);
  expect(isBlackFrame(new Uint8ClampedArray())).toBe(true);
});
