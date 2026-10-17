import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionVideoPanel } from "./SessionVideoPanel";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:video");
  URL.revokeObjectURL = vi.fn();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionVideoPanel sessionId={"a".repeat(24)} />
    </QueryClientProvider>,
  );
}

it("lists the tracks and loads a video only when asked (X-27)", async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/video")
      ? json(200, {
          recordVideo: true,
          retentionDays: 90,
          tracks: {
            camera: { pieces: 3, bytes: 3_000_000, complete: true },
            screen: { pieces: 0, bytes: 0, complete: false },
          },
        })
      : new Response(new Blob(["x"], { type: "video/webm" }), { status: 200 }),
  );
  show();
  expect(await screen.findByText("Exam video")).toBeInTheDocument();
  expect(screen.getByText(/deleted 90 days/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Load camera video" }));
  expect(await screen.findByLabelText("Camera recording")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /screen video/i })).not.toBeInTheDocument();
});

it("shows nothing when the role may not watch, or the batch does not record", async () => {
  fetchMock.mockResolvedValueOnce(json(403, { error: { code: "FORBIDDEN", message: "No" } }));
  show();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByText("Exam video")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("offers a download only when the batch allows it, and asks the server for a copy (X-28)", async () => {
  let canDownload = false;
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/video")
      ? json(200, {
          recordVideo: true,
          canDownload,
          retentionDays: 90,
          tracks: {
            camera: { pieces: 1, bytes: 1_000_000, complete: true },
            screen: { pieces: 0, bytes: 0, complete: false },
          },
        })
      : new Response(new Blob(["x"], { type: "video/webm" }), { status: 200 }),
  );
  const first = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionVideoPanel sessionId={"a".repeat(24)} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Exam video")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  first.unmount();

  canDownload = true;
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Download camera video" }));
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/video/camera?download=1"))).toBe(true),
  );
});
