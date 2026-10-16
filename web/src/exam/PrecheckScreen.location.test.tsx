import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { stubFetch } from "../test/examFixtures";
import { fakeFaceChecks, makeVideosReady } from "../test/faceFixtures";
import { LOCATION_NOTICE, PrecheckScreen } from "./PrecheckScreen";

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
  makeVideosReady();
  stubFetch(() => jsonResponse(200, { status: "ok" }));
});

function show(captureLocation: boolean | undefined) {
  render(
    <PrecheckScreen
      heading="Batch 1"
      captureLocation={captureLocation}
      starting={false}
      startError={null}
      onStart={() => {}}
      onCancel={() => {}}
      faceChecks={fakeFaceChecks()}
    />,
  );
}

it("tells the candidate that location goes with flag photos when the batch captures it", () => {
  show(true);
  expect(screen.getByText(new RegExp(LOCATION_NOTICE.slice(0, -1)))).toBeInTheDocument();
  expect(screen.getByText(/your browser asks for permission first/i)).toBeInTheDocument();
});

it("says nothing about location when the batch does not capture it", () => {
  show(false);
  expect(screen.queryByText(/location/i)).not.toBeInTheDocument();
  show(undefined);
  expect(screen.queryByText(/location/i)).not.toBeInTheDocument();
});
