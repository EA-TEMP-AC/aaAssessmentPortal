import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    sustainedSeconds: null,
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

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev1",
    clientEventId: "snap-1",
    batchId: "batch-1",
    abId: "ab-1",
    candidateId: "c1",
    sessionId: "s1",
    kind: "proctor_snapshot",
    contentType: "image/jpeg",
    size: 43_008,
    sha256: "a".repeat(64),
    uploaderId: "u9",
    uploaderRole: "candidate",
    capturedAt: "2026-11-20T04:59:58.000Z",
    uploadedAt: "2026-11-20T04:59:59.000Z",
    locationStatus: "not_provided",
    latitude: null,
    longitude: null,
    accuracy: null,
    locationUnavailableReason: null,
    hasLocation: false,
    deviceId: null,
    verification: null,
    verifyCount: 0,
    ...overrides,
  };
}

/** ev1 belongs to the phone flag; ev2 and ev3 have no flag (ev3 is the newer one). */
const EVIDENCE = [
  evidenceRow({ id: "ev3", capturedAt: "2026-11-20T05:00:30.000Z", size: 2048 }),
  evidenceRow({ id: "ev1" }),
  evidenceRow({ id: "ev2", capturedAt: "2026-11-20T04:55:00.000Z", size: 20_480 }),
];

/** The evidence list and file calls, for tests that write their own handler. */
function evidenceApi(u: URL): Response | undefined {
  if (u.pathname.endsWith("/evidence")) return jsonResponse(200, evidencePage(EVIDENCE));
  if (u.pathname.endsWith("/file")) {
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  }
  return undefined;
}

function evidencePage(items: unknown[]) {
  return { page: 1, pageSize: 100, total: items.length, items };
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
function api(extra: (u: URL, init?: RequestInit) => Response | Promise<Response> | undefined = () => undefined) {
  return stub((u, init) => {
    const extraResponse = extra(u, init);
    if (extraResponse) return extraResponse;
    if (u.pathname.endsWith("/proctoring/sessions")) return jsonResponse(200, page([item()]));
    if (u.pathname.endsWith("/proctoring/sessions/s1")) return jsonResponse(200, detail());
    if (u.pathname.endsWith("/review") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { decision: string; note?: string };
      return jsonResponse(200, flag({ review: { decision: body.decision, note: body.note ?? null, decidedAt: "2026-11-20T05:02:00.000Z", decidedBy: "u1", decidedByRole: "proctor" } }));
    }
    return evidenceApi(u) ?? jsonResponse(404);
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
  expect(entries[1]).toHaveTextContent("No image for this flag");
  // ab_reviewer is read only.
  expect(within(panel).queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  expect(within(panel).getAllByText("Not reviewed yet.")).toHaveLength(2);
});

it("loads each flag photo through the evidence file API and never prints a signed link", async () => {
  const user = userEvent.setup();
  const mock = api((u) => {
    if (u.pathname.endsWith("/evidence/ev1/file")) {
      return jsonResponse(200, { url: SIGNED, expiresAt: "2026-11-20T05:03:00.000Z", contentType: "image/jpeg" });
    }
    return undefined;
  });
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);

  const thumb = await within(panel).findByRole("button", { name: /Enlarge photo: Phone detected at/ });
  expect(thumb.querySelector("img")).toHaveAttribute("src", SIGNED);
  expect(calls(mock, "/evidence/ev1/file")).toHaveLength(1);
  expect(document.body.textContent).not.toContain("secret-signature");
});

it("shows the photo details next to the thumbnail, the sustained time and the browser details", async () => {
  const user = userEvent.setup();
  api((u) =>
    u.pathname.endsWith("/proctoring/sessions/s1")
      ? jsonResponse(
          200,
          detail({
            flags: [flag({ type: "camera_blocked", sustainedSeconds: 2, detail: { label: "dark frame", count: 1, confidence: 1 } })],
          }),
        )
      : undefined,
  );
  const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(640);
  const height = vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(480);
  setSession(sessionFor("ab_reviewer"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const entry = within(await within(panel).findByRole("list", { name: "Flag timeline" })).getAllByRole("listitem")[0];

  expect(entry).toHaveTextContent("Camera blocked");
  expect(entry).toHaveTextContent("Raised after the condition lasted at least 2 seconds.");
  expect(entry).toHaveTextContent("Sent by the browser: label dark frame, count 1, confidence 100%");
  const thumb = await within(entry).findByRole("button", { name: /Enlarge photo: Camera blocked at/ });
  fireEvent.load(thumb.querySelector("img") as HTMLImageElement);
  expect(within(entry).getByText("Captured")).toBeInTheDocument();
  expect(entry).toHaveTextContent("10:29:58");
  expect(entry).toHaveTextContent("IST");
  expect(entry).toHaveTextContent("42 KB");
  await waitFor(() => expect(entry).toHaveTextContent("640 × 480 px"));
  expect(entry).toHaveTextContent("Proctor snapshot");
  width.mockRestore();
  height.mockRestore();
});

it("opens a larger photo in a dialog with alt text, closes on Escape and returns focus", async () => {
  const user = userEvent.setup();
  api();
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const thumb = await within(panel).findByRole("button", { name: /Enlarge photo: Phone detected at/ });

  await user.click(thumb);
  const dialog = await screen.findByRole("dialog", { name: /Phone detected at/ });
  expect(within(dialog).getByRole("img", { name: /Camera photo: Phone detected at/ })).toHaveAttribute("src", "blob:snapshot");
  expect(within(dialog).getByText("Proctor snapshot")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(thumb).toHaveFocus();

  await user.click(thumb);
  await user.click(await screen.findByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("says so when a flag has no image", async () => {
  const user = userEvent.setup();
  api();
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const entries = within(await within(panel).findByRole("list", { name: "Flag timeline" })).getAllByRole("listitem");
  expect(within(entries[1]).getByText("No image for this flag")).toBeInTheDocument();
  expect(within(entries[1]).queryByRole("button", { name: /Enlarge photo/ })).not.toBeInTheDocument();
});

it("shows an error with a retry when a flag photo cannot be loaded", async () => {
  const user = userEvent.setup();
  let denied = true;
  api((u) => {
    if (u.pathname.endsWith("/evidence/ev1/file") && denied) {
      return jsonResponse(403, { error: { code: "FORBIDDEN", message: "You may not open this file" } });
    }
    return undefined;
  });
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  const entry = within(await within(panel).findByRole("list", { name: "Flag timeline" })).getAllByRole("listitem")[0];

  expect(await within(entry).findByRole("alert")).toHaveTextContent("You may not open this file");
  denied = false;
  await user.click(within(entry).getByRole("button", { name: "Try again" }));
  expect(await within(entry).findByRole("button", { name: /Enlarge photo/ })).toBeInTheDocument();
});

it("lists this session's snapshots with no flag, newest first, and leaves the flagged one out", async () => {
  const user = userEvent.setup();
  const mock = api();
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);

  const strip = await within(panel).findByRole("list", { name: "Snapshots without a flag" });
  const items = within(strip).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("2.0 KB");
  expect(items[1]).toHaveTextContent("20 KB");
  expect(await within(items[0]).findByRole("button", { name: /Enlarge photo: Snapshot taken at/ })).toBeInTheDocument();
  expect(String(calls(mock, "/evidence")[0][0])).toContain("sessionId=s1");
  expect(String(calls(mock, "/evidence")[0][0])).toContain("kind=proctor_snapshot");
  await waitFor(() => expect(calls(mock, "/evidence/ev2/file")).toHaveLength(1));
});

it("shows the empty and error states of the snapshot strip", async () => {
  const user = userEvent.setup();
  let fail = true;
  api((u) => {
    if (!u.pathname.endsWith("/evidence")) return undefined;
    return fail
      ? jsonResponse(500, { error: { code: "INTERNAL", message: "Something went wrong" } })
      : jsonResponse(200, evidencePage([evidenceRow({ id: "ev1" })]));
  });
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);

  const section = await within(panel).findByRole("region", { name: "Snapshots" });
  expect(await within(section).findByRole("alert")).toHaveTextContent("Something went wrong");
  fail = false;
  await user.click(within(section).getByRole("button", { name: "Try again" }));
  expect(await within(section).findByText("No snapshots without a flag in this session.")).toBeInTheDocument();
});

it("shows a loading state while the snapshots load", async () => {
  const user = userEvent.setup();
  api((u) => (u.pathname.endsWith("/evidence") ? new Promise<Response>(() => {}) : undefined));
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  expect(await within(panel).findByText("Loading snapshots…")).toBeInTheDocument();
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
    return evidenceApi(u) ?? jsonResponse(404);
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
