import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { debugStripWanted, proctorDebug } from "../proctoring/debug";
import { ProctorDebugStrip } from "./ProctorDebugStrip";

afterEach(() => {
  proctorDebug.reset();
  window.history.pushState({}, "", "/");
});

it("is wanted only with ?debug=1 (this test build is a development build)", () => {
  expect(debugStripWanted()).toBe(false);
  window.history.pushState({}, "", "/?debug=1");
  expect(debugStripWanted()).toBe(true);
  window.history.pushState({}, "", "/?debug=0");
  expect(debugStripWanted()).toBe(false);
});

it("shows the engine status, tick time, counters and last error, and updates live", () => {
  render(<ProctorDebugStrip status={{ state: "degraded", message: "Detection model could not be loaded" }} />);
  const strip = screen.getByRole("complementary", { name: /Proctoring debug/ });
  expect(strip).toHaveTextContent("Engine: degraded (Detection model could not be loaded)");
  expect(strip).toHaveTextContent("Last tick: none yet");
  expect(strip).toHaveTextContent("Last error: none");

  act(() => {
    proctorDebug.tick(42.4);
    proctorDebug.flagSent();
    proctorDebug.flagFailed("500 INTERNAL");
    proctorDebug.snapshotUploaded();
  });
  expect(strip).toHaveTextContent("Last tick: 42 ms");
  expect(strip).toHaveTextContent("Flags sent: 1 (failed 1)");
  expect(strip).toHaveTextContent("Snapshots uploaded: 1 (failed 0)");
  expect(strip).toHaveTextContent("Last error: flag: 500 INTERNAL");
});
