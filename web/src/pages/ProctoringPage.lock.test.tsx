import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

// B-20: the lock state and the Unlock button on the proctoring session page.

function item(over: Record<string, unknown> = {}) {
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
    flagCounts: { low: 0, medium: 0, high: 3 },
    unreviewedCount: 3,
    warningCount: 0,
    invalidationRecommended: false,
    paused: true,
    ...over,
  };
}

function lock(over: Record<string, unknown> = {}) {
  return {
    paused: true,
    pausedAt: "2026-11-20T05:00:30.000Z",
    timesPaused: 1,
    countedFlags: 3,
    lastUnlockedAt: null,
    policy: { action: "pause", pauseAfterFlags: 3, countSeverities: ["high"] },
    ...over,
  };
}

function setup(opts: { paused?: boolean; unlockStatus?: number } = {}) {
  let paused = opts.paused ?? true;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/unlock") && method === "POST") {
      if (opts.unlockStatus && opts.unlockStatus !== 200) {
        return jsonResponse(opts.unlockStatus, {
          error: {
            code: "PROCTORING_NOT_PAUSED",
            message: "This attempt is not paused",
          },
        });
      }
      paused = false;
      return jsonResponse(200, {
        sessionId: "s1",
        attemptId: "a1",
        lock: lock({ paused: false, countedFlags: 0 }),
      });
    }
    if (u.pathname.endsWith("/proctoring/sessions/s1")) {
      return jsonResponse(200, {
        ...item({ paused }),
        warnings: [],
        flags: [],
        lock: lock({ paused, countedFlags: paused ? 3 : 0 }),
      });
    }
    if (u.pathname.endsWith("/proctoring/sessions")) {
      return jsonResponse(200, {
        page: 1,
        pageSize: 50,
        total: 1,
        items: [item({ paused })],
      });
    }
    if (u.pathname.endsWith("/evidence"))
      return jsonResponse(200, { page: 1, pageSize: 100, total: 0, items: [] });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const unlockCalls = (mock: ReturnType<typeof setup>) =>
  mock.mock.calls.filter((c) => String(c[0]).endsWith("/unlock"));

afterEach(() => vi.unstubAllGlobals());

async function openSession(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Open session of Asha Devi" }),
  );
  return screen.findByRole("region", { name: "Session of Asha Devi" });
}

it("marks a paused exam in the list and shows the lock state with an Unlock button", async () => {
  const user = userEvent.setup();
  setup();
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");

  const table = await screen.findByRole("table", {
    name: "Proctoring sessions",
  });
  expect(within(table).getByText("Exam paused")).toBeInTheDocument();

  const panel = await openSession(user);
  expect(await within(panel).findByRole("heading", { name: "Exam lock" })).toBeInTheDocument();
  expect(within(panel).getByText(/The exam is paused since/)).toHaveTextContent(
    "Your test is paused. Please contact your proctor.",
  );
  expect(
    within(panel).getByText(/Pause after 3 high flags\. Counted flags now: 3/),
  ).toBeInTheDocument();
  expect(
    within(panel).getByRole("button", { name: "Unlock exam" }),
  ).toBeInTheDocument();
});

it.each(["aa_admin", "proctor"] as const)(
  "lets %s unlock, then shows the exam as not paused",
  async (role) => {
    const user = userEvent.setup();
    const mock = setup();
    setSession(sessionFor(role));
    renderApp("/proctoring");
    const panel = await openSession(user);

    await user.click(
      await within(panel).findByRole("button", { name: "Unlock exam" }),
    );

    await waitFor(() => expect(unlockCalls(mock)).toHaveLength(1));
    expect((unlockCalls(mock)[0][1] as RequestInit).method).toBe("POST");
    expect(
      await within(panel).findByText("The exam is not paused."),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Unlock exam" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        "The exam was unlocked. The candidate can carry on.",
      ),
    ).toBeInTheDocument();
  },
);

it.each(["assessor", "ab_reviewer", "ncvet_viewer"] as const)(
  "shows the lock state but no Unlock button to %s",
  async (role) => {
    const user = userEvent.setup();
    const mock = setup();
    setSession(sessionFor(role));
    renderApp("/proctoring");
    const panel = await openSession(user);
    expect(
      await within(panel).findByText(/The exam is paused since/),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Unlock exam" }),
    ).not.toBeInTheDocument();
    expect(unlockCalls(mock)).toHaveLength(0);
  },
);

it("shows no Unlock button when the exam is not paused", async () => {
  const user = userEvent.setup();
  setup({ paused: false });
  setSession(sessionFor("aa_admin"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  expect(
    await within(panel).findByText("The exam is not paused."),
  ).toBeInTheDocument();
  expect(
    within(panel).queryByRole("button", { name: "Unlock exam" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Exam paused")).not.toBeInTheDocument();
});

it("shows the server's message when the unlock is refused", async () => {
  const user = userEvent.setup();
  setup({ unlockStatus: 409 });
  setSession(sessionFor("proctor"));
  renderApp("/proctoring");
  const panel = await openSession(user);
  await user.click(
    await within(panel).findByRole("button", { name: "Unlock exam" }),
  );
  expect(await within(panel).findByRole("alert")).toHaveTextContent(
    "This attempt is not paused",
  );
  expect(
    within(panel).getByRole("button", { name: "Unlock exam" }),
  ).toBeEnabled();
});
