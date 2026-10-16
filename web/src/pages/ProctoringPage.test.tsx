import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";
import { PROCTORING_REFRESH_MS } from "./ProctoringPage";

const CAN_SEE: readonly Role[] = ["aa_admin", "proctor", "assessor", "ab_reviewer", "ncvet_viewer"];
const SIGNED = "https://bucket.example.test/evidence/snap?X-Signature=secret-signature";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    attemptId: "a1",
    batchId: "batch-1",
    abId: "ab-1",
    candidateId: "c1",
    candidateName: "Asha Devi",
    status: "active",
    attemptStatus: "in_progress",
    startedAt: "2026-11-20T04:50:00.000Z",
    lastSeenAt: "2026-11-20T05:00:00.000Z",
    flagCounts: { low: 2, medium: 0, high: 1 },
    unreviewedCount: 3,
    warningCount: 0,
    invalidationRecommended: false,
    invalidationRecommendedAt: null,
    ...overrides,
  };
}

function flag(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    sessionId: "s1",
    clientEventId: "e1",
    type: "phone_detected",
    severity: "high",
    capturedAt: "2026-11-20T05:00:00.000Z",
    receivedAt: "2026-11-20T05:00:01.000Z",
    detail: { label: "cell phone", confidence: 0.82 },
    evidenceId: "ev1",
    review: null,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...item(),
    serverTime: "2026-11-20T05:01:00.000Z",
    warnings: [],
    flags: [
      flag(),
      flag({ id: "f2", type: "tab_hidden", severity: "low", evidenceId: null, detail: null, capturedAt: "2026-11-20T05:01:00.000Z" }),
    ],
    ...overrides,
  };
}

function page(items: unknown[]) {
  return { page: 1, pageSize: 50, total: items.length, serverTime: "2026-11-20T05:01:00.000Z", items };
}

function url(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

type Handler = (u: URL, init?: RequestInit) => Response | Promise<Response>;

function stub(handler: Handler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(url(input), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Default API: one session with two flags; review echoes the decision. */
function api(extra: Handler = () => jsonResponse(404)) {
  return stub((u, init) => {
    if (u.pathname.endsWith("/proctoring/sessions")) return jsonResponse(200, page([item()]));
    if (u.pathname.endsWith("/proctoring/sessions/s1")) return jsonResponse(200, detail());
    if (u.pathname.endsWith("/review") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { decision: string; note?: string };
      return jsonResponse(200, flag({ review: { decision: body.decision, note: body.note ?? null, decidedAt: "2026-11-20T05:02:00.000Z", decidedBy: "u1", decidedByRole: "proctor" } }));
    }
    return extra(u, init);
  });
}

function calls(mock: ReturnType<typeof stub>, suffix: string) {
  return mock.mock.calls.filter((call) => url(call[0]).pathname.endsWith(suffix));
}

const createObjectURL = vi.fn(() => "blob:snapshot");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.useRealTimers();
});

async function openSession(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Open session of Asha Devi" }));
  return screen.findByRole("region", { name: "Session of Asha Devi" });
}

it.each(ROLES)("opens the proctoring page only for allowed roles (%s)", async (role) => {
  const mock = stub(() => jsonResponse(200, page([])));
  setSession(sessionFor(role));
  renderApp("/proctoring");

  if (CAN_SEE.includes(role)) {
    expect(await screen.findByRole("heading", { name: "Proctoring", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Proctoring" })).toHaveAttribute("aria-current", "page");
  } else {
    expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Proctoring" })).not.toBeInTheDocument();
    expect(calls(mock, "/proctoring/sessions")).toHaveLength(0);
  }
});

it("lists sessions with severity counts as text and shows feed lost", async () => {
  stub(() =>
    jsonResponse(200, page([item(), item({ id: "s2", candidateName: "Bina Rao", status: "feed_lost", flagCounts: { low: 0, medium: 1, high: 0 }, invalidationRecommended: true })])),
  );
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");

  const table = await screen.findByRole("table", { name: "Proctoring sessions" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  const first = within(rows[1]).getAllByRole("cell").map((c) => c.textContent ?? "");
  expect(first[0]).toBe("Asha Devi");
  expect(first[2]).toBe("Active");
  expect(first[3]).toContain("IST");
  expect(first[4]).toBe("High 1, Medium 0, Low 2");
  expect(first[5]).toBe("3");
  const second = within(rows[2]).getAllByRole("cell").map((c) => c.textContent ?? "");
  expect(second[2]).toContain("Feed lost");
  expect(second[2]).toContain("Invalidation recommended");
  expect(screen.getByText("2 sessions.")).toBeInTheDocument();
});

it("refreshes the list every 10 seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const mock = api();
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring");
  await screen.findByRole("table", { name: "Proctoring sessions" });
  const before = calls(mock, "/proctoring/sessions").length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PROCTORING_REFRESH_MS + 50);
  });
  await waitFor(() => expect(calls(mock, "/proctoring/sessions").length).toBeGreaterThan(before));
});

it("filters by batch, status and severity", async () => {
  const user = userEvent.setup();
  const mock = api();
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring");
  await screen.findByRole("table", { name: "Proctoring sessions" });

  await user.type(screen.getByLabelText("Batch ID"), "  66f0000000000000000000b1 ");
  await user.selectOptions(screen.getByLabelText("Status"), "feed_lost");
  await user.selectOptions(screen.getByLabelText("Lowest severity"), "high");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  await waitFor(() => {
    const last = url(calls(mock, "/proctoring/sessions").at(-1)![0]);
    expect(last.searchParams.get("batchId")).toBe("66f0000000000000000000b1");
    expect(last.searchParams.get("status")).toBe("feed_lost");
    expect(last.searchParams.get("minSeverity")).toBe("high");
  });
});

it("shows empty and error states", async () => {
  stub(() => jsonResponse(200, page([])));
  setSession(sessionFor("ncvet_viewer"));
  const { unmount } = renderApp("/proctoring");
  expect(await screen.findByText("No proctoring sessions yet.")).toBeInTheDocument();
  unmount();

  stub(() => jsonResponse(500, { error: { code: "INTERNAL", message: "Internal server error" } }));
  renderApp("/proctoring");
  expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("shows the flag timeline with time, type and severity in words", async () => {
  const user = userEvent.setup();
  api();
  setSession(sessionFor("ab_reviewer"));
  renderApp("/proctoring");
  const panel = await openSession(user);

  const timeline = await within(panel).findByRole("list", { name: "Flag timeline" });
  const entries = within(timeline).getAllByRole("listitem");
  expect(entries).toHaveLength(2);
  expect(entries[0]).toHaveTextContent("Phone detected");
  expect(entries[0]).toHaveTextContent("Severity: High");
  expect(entries[0]).toHaveTextContent("IST");
  expect(entries[0]).toHaveTextContent("confidence 82%");
  expect(entries[1]).toHaveTextContent("Tab hidden");
  expect(entries[1]).toHaveTextContent("Severity: Low");
  expect(entries[1]).toHaveTextContent("No snapshot.");
  // ab_reviewer is read only.
  expect(within(panel).queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  expect(within(panel).getAllByText("Not reviewed yet.")).toHaveLength(2);
});

it("loads a snapshot through the evidence file API and never prints a signed link", async () => {
  const user = userEvent.setup();
  const mock = api((u) => {
    if (u.pathname.endsWith("/evidence/ev1/file")) {
      return jsonResponse(200, { url: SIGNED, expiresAt: "2026-11-20T05:03:00.000Z", contentType: "image/jpeg" });
    }
    return jsonResponse(404);
  });
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);

  expect(calls(mock, "/evidence/ev1/file")).toHaveLength(0);
  await user.click(await within(panel).findByRole("button", { name: "Show snapshot" }));
  const img = await within(panel).findByRole("img", { name: /Snapshot for phone detected/ });
  expect(img).toHaveAttribute("src", SIGNED);
  expect(calls(mock, "/evidence/ev1/file")).toHaveLength(1);
  expect(document.body.textContent).not.toContain("secret-signature");

  await user.click(within(panel).getByRole("button", { name: "Hide snapshot" }));
  expect(within(panel).queryByRole("img")).not.toBeInTheDocument();
});

it("shows a snapshot from bytes as a blob image", async () => {
  const user = userEvent.setup();
  api((u) => {
    if (u.pathname.endsWith("/evidence/ev1/file")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    return jsonResponse(404);
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  await user.click(await within(panel).findByRole("button", { name: "Show snapshot" }));
  expect(await within(panel).findByRole("img", { name: /Snapshot/ })).toHaveAttribute("src", "blob:snapshot");
});

it("lets a proctor dismiss and warn, but not recommend invalidation", async () => {
  const user = userEvent.setup();
  const mock = api();
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const entries = within(await within(panel).findByRole("list", { name: "Flag timeline" })).getAllByRole("listitem");

  expect(within(panel).queryByRole("button", { name: "Recommend invalidation" })).not.toBeInTheDocument();

  await user.click(within(entries[0]).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(calls(mock, "/flags/f1/review")).toHaveLength(1));
  expect(JSON.parse(String(calls(mock, "/flags/f1/review")[0][1]?.body))).toEqual({ decision: "dismiss" });
  expect(await within(panel).findByText(/Decision saved for phone detected: Dismissed/)).toBeInTheDocument();

  await user.click(within(entries[1]).getByRole("button", { name: "Warn" }));
  const box = within(entries[1]).getByLabelText("Warning message for the candidate");
  expect(box).toHaveFocus();
  await user.type(box, "Please stay on the exam tab.");
  await user.click(within(entries[1]).getByRole("button", { name: "Send warning" }));
  await waitFor(() => expect(calls(mock, "/flags/f2/review")).toHaveLength(1));
  expect(JSON.parse(String(calls(mock, "/flags/f2/review")[0][1]?.body))).toEqual({
    decision: "warn",
    note: "Please stay on the exam tab.",
  });
});

it("asks aa_admin to confirm before recommending invalidation", async () => {
  const user = userEvent.setup();
  const mock = api();
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const entries = within(await within(panel).findByRole("list", { name: "Flag timeline" })).getAllByRole("listitem");

  await user.click(within(entries[0]).getByRole("button", { name: "Recommend invalidation" }));
  expect(within(entries[0]).getByText(/does not change the attempt or the result/)).toBeInTheDocument();
  await user.click(within(entries[0]).getByRole("button", { name: "Cancel" }));
  expect(calls(mock, "/flags/f1/review")).toHaveLength(0);

  await user.click(within(entries[0]).getByRole("button", { name: "Recommend invalidation" }));
  const confirm = within(entries[0]).getByRole("button", { name: "Confirm recommendation" });
  expect(confirm).toHaveFocus();
  await user.click(confirm);
  await waitFor(() => expect(calls(mock, "/flags/f1/review")).toHaveLength(1));
  expect(JSON.parse(String(calls(mock, "/flags/f1/review")[0][1]?.body))).toEqual({
    decision: "invalidate_recommended",
  });
});

it("shows a review error and an existing decision", async () => {
  const user = userEvent.setup();
  stub((u, init) => {
    if (u.pathname.endsWith("/proctoring/sessions")) return jsonResponse(200, page([item()]));
    if (u.pathname.endsWith("/proctoring/sessions/s1")) {
      return jsonResponse(
        200,
        detail({
          flags: [
            flag(),
            flag({ id: "f2", review: { decision: "warn", note: "Sit alone", decidedAt: "2026-11-20T05:02:00.000Z", decidedBy: "u1", decidedByRole: "proctor" } }),
          ],
        }),
      );
    }
    if (init?.method === "PATCH") {
      return jsonResponse(409, { error: { code: "PROCTORING_FLAG_REVIEWED", message: "This flag already has a decision" } });
    }
    return jsonResponse(404);
  });
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const entries = within(await within(panel).findByRole("list", { name: "Flag timeline" })).getAllByRole("listitem");
  expect(entries[1]).toHaveTextContent("Decision: Warned by Proctor");
  expect(entries[1]).toHaveTextContent("Note: Sit alone");

  await user.click(within(entries[0]).getByRole("button", { name: "Dismiss" }));
  expect(await within(entries[0]).findByRole("alert")).toHaveTextContent("This flag already has a decision");
});

it("closes the session panel with Escape and returns focus", async () => {
  const user = userEvent.setup();
  api();
  setSession(sessionFor("assessor"));
  renderApp("/proctoring");
  const opener = await screen.findByRole("button", { name: "Open session of Asha Devi" });
  await user.click(opener);
  const panel = await screen.findByRole("region", { name: "Session of Asha Devi" });
  expect(panel).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Session of Asha Devi" })).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
