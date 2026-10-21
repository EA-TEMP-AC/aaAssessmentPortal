import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const batch = {
  id: "b1",
  qualification: "Field Technician (QP1)",
  sector: "Electronics",
  status: "assessor_assigned",
  assessmentStartDate: "2026-10-23",
  assessmentEndDate: "2026-10-23",
  candidateCount: 12,
  tpName: "TP One",
  centreName: "Centre A",
  assessorName: "Ravi",
};

it("shows the dashboard counts on Home and the next seven days", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(200, {
        today: "2026-10-21",
        from: "2026-10-21",
        to: "2026-10-21",
        batchesScheduled: 4,
        assessorsScheduled: 3,
        writingNow: 17,
        nextSevenDays: [batch],
      }),
    ),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/home");
  expect(
    await screen.findByText("Students writing the exam now"),
  ).toBeInTheDocument();
  expect(screen.getByText("17")).toBeInTheDocument();
  expect(await screen.findByText("Centre A")).toBeInTheDocument();
});

it("shows an error when the dashboard cannot load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(500, { error: { message: "Boom" } })),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/home");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it("keeps the dashboard off the assessor home", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(200, {})),
  );
  setSession(sessionFor("assessor"));
  renderApp("/home");
  expect(
    await screen.findByText(/Assigned batches and results/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Batches scheduled")).not.toBeInTheDocument();
});

it("searches upcoming batches and queues mails, listing what was skipped", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/batch-mails/send")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          batchIds: ["b1"],
          recipients: ["training_partner", "centre", "assessor"],
        });
        return jsonResponse(200, {
          queued: 1,
          skipped: [{ batchId: "b1", reason: "no_assessor_email" }],
        });
      }
      return jsonResponse(200, {
        page: 1,
        pageSize: 25,
        total: 1,
        items: [{ ...batch, assessorAssigned: true, tpAccepted: true }],
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  setSession(sessionFor("aa_admin"));
  renderApp("/batch-mails");
  expect(
    await screen.findByRole("heading", { name: "Batch mails" }),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("checkbox", { name: "Select batch b1" }),
  );
  await user.click(screen.getByRole("button", { name: "Send mails (1)" }));
  expect(await screen.findByText("1 mail(s) queued.")).toBeInTheDocument();
  expect(screen.getByText(/no assessor email/)).toBeInTheDocument();
});

it("shows an empty state for mails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(200, { page: 1, pageSize: 25, total: 0, items: [] }),
    ),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/batch-mails");
  expect(
    await screen.findByText("No upcoming batches match."),
  ).toBeInTheDocument();
});

it("lists login events and switches to punch details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("view=punch")) {
        return jsonResponse(200, {
          truncated: false,
          items: [
            {
              userId: "u1",
              userName: "Ravi",
              role: "assessor",
              batchId: "b1",
              date: "2026-10-21",
              firstLogin: "2026-10-21T04:00:00.000Z",
              lastLogout: null,
              events: 1,
            },
          ],
        });
      }
      return jsonResponse(200, {
        page: 1,
        pageSize: 50,
        total: 1,
        items: [
          {
            id: "e1",
            userId: "u1",
            userName: "Ravi",
            role: "assessor",
            type: "login",
            capturedAt: "2026-10-21T04:00:00.000Z",
            batchId: "b1",
            qualification: "Field Technician (QP1)",
            sector: "Electronics",
            platform: "android",
            locationCaptured: true,
            lateSync: false,
          },
        ],
      });
    }),
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/login-history");
  expect(
    await screen.findByRole("heading", { name: "Login history" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Captured")).toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Punch details" }));
  expect(await screen.findByText("First login")).toBeInTheDocument();
  expect(screen.getByText("Ravi")).toBeInTheDocument();
});

it("denies the mail screen to the NCVET viewer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(200, {})),
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/batch-mails");
  expect(
    screen.queryByRole("heading", { name: "Batch mails" }),
  ).not.toBeInTheDocument();
});
