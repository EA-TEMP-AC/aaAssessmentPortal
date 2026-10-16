import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { fakeStream, frame, stubFetch } from "../test/examFixtures";
import { fakeFaceChecks, makeVideosReady } from "../test/faceFixtures";
import { FakeFaceMatcher } from "../proctoring/face";
import { FALLBACK_LABEL, PrecheckScreen } from "./PrecheckScreen";

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  makeVideosReady();
  stubFetch((u) => (u.pathname.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(404)));
});

async function setup(matcher: FakeFaceMatcher) {
  const user = userEvent.setup();
  const { stream } = fakeStream();
  getUserMedia.mockResolvedValue(stream);
  const onStart = vi.fn();
  const faceChecks = fakeFaceChecks(matcher);
  const view = render(
    <PrecheckScreen
      heading="Batch 1"
      starting={false}
      startError={null}
      onStart={onStart}
      onCancel={() => {}}
      frameCheck={{ sample: () => frame(140), attempts: 2, intervalMs: 1 }}
      faceChecks={faceChecks}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Check camera" }));
  await screen.findByText("Camera check passed.");
  await user.click(screen.getByRole("checkbox", { name: /proctoring notice/i }));
  return { user, stream, onStart, faceChecks, unmount: view.unmount };
}

const start = () => screen.getByRole("button", { name: "Start exam" });

it("shows the ID card and selfie steps in order after the camera check", async () => {
  const { user } = await setup(new FakeFaceMatcher());
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings.slice(0, 3)).toEqual(["Step 1: camera", "Step 2: show your ID card", "Step 3: take a selfie"]);
  expect(screen.getByLabelText("ID card preview")).toBeInTheDocument();
  expect(screen.getByLabelText("Selfie preview")).toBeInTheDocument();
  expect(start()).toBeDisabled();
  expect(screen.getByText(/show your ID card and take a selfie/)).toBeInTheDocument();
  // Only the ID card, not the selfie: still blocked.
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  expect(await screen.findByText("ID card captured. Now take a selfie.")).toBeInTheDocument();
  expect(start()).toBeDisabled();
});

it("works in either order and reports a match", async () => {
  const matcher = new FakeFaceMatcher();
  const { user, onStart, stream } = await setup(matcher);
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  expect(await screen.findByText("Selfie taken.")).toBeInTheDocument();
  expect(start()).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  expect(await screen.findByText(/look alike/)).toBeInTheDocument();
  expect(start()).toBeEnabled();
  await user.click(start());
  const face = onStart.mock.calls[0][1];
  expect(onStart.mock.calls[0][0]).toBe(stream);
  expect(face.matcher).toBe(matcher);
  expect(face.idOutcome).toBe("match");
  expect(face.idJpeg).toBeInstanceOf(Blob);
  expect(face.selfieJpeg).toBeInstanceOf(Blob);
  // Handing over the matcher keeps the reference for the exam.
  expect(matcher.calls).not.toContain("clear");
});

it("says a mismatch in plain words, lets the candidate continue and passes the outcome on", async () => {
  const matcher = new FakeFaceMatcher({ compareLargest: [{ found: true, distance: 0.91 }] });
  const { user, onStart } = await setup(matcher);
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  expect(
    await screen.findByText(
      "The photo on the card and your face do not look alike. You can continue, and a proctor will review.",
    ),
  ).toBeInTheDocument();
  expect(start()).toBeEnabled();
  await user.click(start());
  expect(onStart.mock.calls[0][1]).toMatchObject({ idOutcome: "mismatch", idDistance: 0.91 });
});

it("offers Retry for an unreadable card, then the by-hand fallback after 3 failed tries", async () => {
  const matcher = new FakeFaceMatcher({ compareLargest: [{ found: false }] });
  const { user, onStart } = await setup(matcher);
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  expect(await screen.findByText(/could not read the photo on the card/)).toBeInTheDocument();
  expect(start()).toBeDisabled();
  expect(screen.queryByRole("button", { name: FALLBACK_LABEL })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Retry" }));
  await user.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: FALLBACK_LABEL })).toBeInTheDocument();
  expect(start()).toBeDisabled();

  await user.click(screen.getByRole("button", { name: FALLBACK_LABEL }));
  expect(start()).toBeEnabled();
  await user.click(start());
  const face = onStart.mock.calls[0][1];
  expect(face.idOutcome).toBe("unreadable");
  expect(face.idJpeg).toBeInstanceOf(Blob);
  expect(face.selfieJpeg).toBeInstanceOf(Blob);
});

it("lets a candidate whose selfie keeps failing use the by-hand fallback", async () => {
  const matcher = new FakeFaceMatcher({ setReference: [{ ok: false, reason: "no_face" }] });
  const { user, onStart } = await setup(matcher);
  for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole("button", { name: "Take selfie" }));
  expect(await screen.findByRole("button", { name: FALLBACK_LABEL })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: FALLBACK_LABEL }));
  await user.click(start());
  expect(onStart.mock.calls[0][1]).toMatchObject({ matcher: null, idOutcome: "unreadable", selfieJpeg: null });
});

it("offers the fallback straight away when the face model cannot load", async () => {
  const matcher = new FakeFaceMatcher({ loadError: new Error("no model") });
  const { user, onStart } = await setup(matcher);
  expect(await screen.findByText(/face check could not run on this device/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Capture ID card" })).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: FALLBACK_LABEL }));
  expect(start()).toBeEnabled();
  await user.click(start());
  expect(onStart.mock.calls[0][1]).toMatchObject({ matcher: null, idOutcome: "unreadable", idJpeg: null });
});

it("wipes the reference when the screen closes without starting", async () => {
  const matcher = new FakeFaceMatcher();
  const { user, unmount } = await setup(matcher);
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  await screen.findByText("Selfie taken.");
  unmount();
  expect(matcher.calls).toContain("clear");
});

it("keeps the photos and descriptors out of storage and the network on the way", async () => {
  const fetchMock = stubFetch((u) =>
    u.pathname.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(404),
  );
  const storageSet = vi.spyOn(Storage.prototype, "setItem");
  const { user } = await setup(new FakeFaceMatcher());
  fetchMock.mockClear();
  await user.click(screen.getByRole("button", { name: "Capture ID card" }));
  await user.click(screen.getByRole("button", { name: "Take selfie" }));
  await screen.findByText(/look alike/);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(storageSet).not.toHaveBeenCalled();
});
