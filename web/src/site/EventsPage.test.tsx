import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { renderApp } from "../test/render";

const EVENTS: Record<string, unknown[]> = {
  "2026-10": [
    {
      id: "1",
      title: "Assessor workshop",
      date: "2026-10-05",
      endDate: "2026-10-06",
      location: "Pune",
      description: "Training day",
    },
  ],
  "2026-11": [],
};

function install() {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const items = EVENTS[url.searchParams.get("month") ?? ""] ?? [];
    return jsonResponse(200, { page: 1, pageSize: 100, total: items.length, items });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

it("shows the requested month as a list with dates, and a grid hidden from screen readers", async () => {
  const mock = install();
  renderApp("/site/events?month=2026-10");
  expect(await screen.findByRole("heading", { level: 3, name: "Assessor workshop" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "October 2026" })).toBeInTheDocument();
  const list = screen.getByRole("region", { name: "Events in October 2026" });
  expect(within(list).getByText(/Pune/)).toBeInTheDocument();
  expect(within(list).getByText(/ to /)).toBeInTheDocument();
  expect(document.querySelector("table")).toHaveAttribute("aria-hidden", "true");
  const url = new URL(String(mock.mock.calls[0]![0]), "http://localhost");
  expect(url.searchParams.get("month")).toBe("2026-10");
  expect(document.title).toBe("Events, October 2026 | Assessment Agency");
});

it("navigates to the next and previous month and shows an empty state", async () => {
  const mock = install();
  renderApp("/site/events?month=2026-10");
  await screen.findByRole("heading", { name: "Assessor workshop" });
  await userEvent.click(screen.getByRole("link", { name: /November 2026/ }));
  expect(await screen.findByText("No events are listed for November 2026.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "November 2026" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: /October 2026/ }));
  expect(await screen.findByRole("heading", { name: "Assessor workshop" })).toBeInTheDocument();
  // October is served from the 5 minute cache, so only two requests were made.
  expect(mock).toHaveBeenCalledTimes(2);
});

it("replaces a bad month value and shows an error with retry", async () => {
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      expect(url.searchParams.get("month")).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      if (fail) return jsonResponse(500, { error: { code: "INTERNAL", message: "boom" } });
      return jsonResponse(200, { page: 1, pageSize: 100, total: 0, items: [] });
    }),
  );
  renderApp("/site/events?month=nonsense");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/No events are listed/)).toBeInTheDocument();
});
