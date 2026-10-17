import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { stubFetch } from "../test/examFixtures";
import { fakeFaceChecks, makeVideosReady } from "../test/faceFixtures";
import { PrecheckScreen } from "./PrecheckScreen";

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
  makeVideosReady();
  stubFetch(() => jsonResponse(200, { status: "ok" }));
});

function show(requireScreenShare: boolean | undefined) {
  render(
    <PrecheckScreen
      heading="Batch 1"
      requireScreenShare={requireScreenShare}
      starting={false}
      startError={null}
      onStart={() => {}}
      onCancel={() => {}}
      faceChecks={fakeFaceChecks()}
    />,
  );
}

it("shows a Share screen check when the batch requires screen sharing (X-21)", () => {
  show(true);
  expect(screen.getByText("Screen sharing")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /share screen/i })).toBeInTheDocument();
});

it("shows no screen check when the batch does not require it", () => {
  show(false);
  expect(screen.queryByText("Screen sharing")).not.toBeInTheDocument();
  show(undefined);
  expect(screen.queryByText("Screen sharing")).not.toBeInTheDocument();
});
