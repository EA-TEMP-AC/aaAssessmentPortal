import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { FlagCapture } from "../../api/proctoring";
import { FlagCaptureDetails } from "./FlagCaptureDetails";
import { clockGapSeconds } from "./format";

function capture(overrides: Partial<FlagCapture> = {}): FlagCapture {
  return {
    flagId: "f1",
    type: "face_not_present",
    reason: "Face not visible for 2 seconds",
    severity: "medium",
    capturedAt: "2026-11-20T05:00:05.000Z",
    receivedAt: "2026-11-20T05:00:06.000Z",
    evidenceId: "ev1",
    locationStatus: "captured",
    locationVisible: true,
    location: { latitude: 19.076123, longitude: 72.877456, accuracy: 12 },
    question: null,
    ...overrides,
  };
}

function show(load: (id: string) => Promise<FlagCapture>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FlagCaptureDetails flagId="f1" load={load} />
    </QueryClientProvider>,
  );
}

describe("FlagCaptureDetails", () => {
  it("shows the question on screen and the answer saved at that moment (X-23)", async () => {
    show(async () =>
      capture({
        question: {
          number: 2,
          text: "Which tool measures current?",
          options: [
            { key: "A", text: "Ammeter" },
            { key: "B", text: "Voltmeter" },
          ],
          answer: "B",
        },
      }),
    );
    expect(await screen.findByText("Question 2")).toBeInTheDocument();
    expect(screen.getByText(/Which tool measures current/)).toBeInTheDocument();
    expect(screen.getByText("Answer saved at that moment")).toBeInTheDocument();
    expect(screen.getAllByText("B. Voltmeter").length).toBeGreaterThan(0);
  });

  it("says when nothing was answered, and hides the text from roles that may not read it", async () => {
    show(async () => capture({ question: { number: 3, text: null, options: null, answer: null } }));
    expect(await screen.findByText("Question 3")).toBeInTheDocument();
    expect(screen.getByText("Not answered yet")).toBeInTheDocument();
  });

  it("shows the server's reason, severity, both times and the location", async () => {
    show(async () => capture());
    expect(await screen.findByText("Face not visible for 2 seconds")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Server time")).toBeInTheDocument();
    expect(screen.getByText("Browser time (drawn on the photo)")).toBeInTheDocument();
    expect(screen.getAllByText(/20 Nov, 10:30:0\d am IST/)).toHaveLength(2);
    expect(screen.getByText("19.076123, 72.877456 (accuracy 12 m)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says Location not shared when none was kept", async () => {
    show(async () => capture({ locationStatus: "not_shared", location: null }));
    expect(await screen.findByText("Location not shared")).toBeInTheDocument();
  });

  it("does not show coordinates to a role that may not see them", async () => {
    show(async () => capture({ locationVisible: false, location: null }));
    expect(await screen.findByText(/your role cannot see the coordinates/i)).toBeInTheDocument();
    expect(screen.queryByText(/19\.076/)).not.toBeInTheDocument();
  });

  it("calls out a gap between the browser time and the server time", async () => {
    show(async () => capture({ capturedAt: "2026-11-20T04:30:00.000Z", receivedAt: "2026-11-20T05:00:06.000Z" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/30 minutes apart/);
  });

  it("measures the gap in seconds, either way round", () => {
    expect(clockGapSeconds({ capturedAt: "2026-11-20T05:00:00Z", receivedAt: "2026-11-20T05:00:30Z" })).toBe(30);
    expect(clockGapSeconds({ capturedAt: "2026-11-20T05:00:30Z", receivedAt: "2026-11-20T05:00:00Z" })).toBe(30);
  });

  it("shows loading, then an error with Try again that loads again", async () => {
    const load = vi
      .fn<(id: string) => Promise<FlagCapture>>()
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error"))
      .mockResolvedValue(capture());
    show(load);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(await screen.findByText("Face not visible for 2 seconds")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
