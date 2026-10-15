import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function methodOf(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function requestBody(init?: RequestInit): unknown {
  if (!init?.body) return null;
  return JSON.parse(String(init.body));
}

const DEFAULT_SETTINGS: {
  abReviewerCanReadAssessorPayments: boolean;
  ncvetViewerCanSeeAbQueue: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
} = {
  abReviewerCanReadAssessorPayments: false,
  ncvetViewerCanSeeAbQueue: false,
  updatedBy: null,
  updatedAt: null,
};

function installFetch(handler?: (url: URL, init?: RequestInit) => Response | Promise<Response | undefined | void> | undefined | void) {
  let settings = { ...DEFAULT_SETTINGS };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (handler) {
      const custom = await handler(url, init);
      if (custom) return custom;
    }
    if (url.pathname.endsWith("/settings/access")) {
      if (methodOf(init) === "PUT") {
        const body = requestBody(init) as Record<string, unknown>;
        settings = { ...settings, ...body, updatedAt: "2026-10-15T00:00:00.000Z" };
        return jsonResponse(200, settings);
      }
      return jsonResponse(200, settings);
    }
    return jsonResponse(404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it.each(["ab_reviewer", "mis", "candidate", "tp", "sme", "assessor", "proctor"] as const)(
  "redirects %s to Home without making a request to /settings/access",
  async (role) => {
    const fetchMock = installFetch();
    setSession(sessionFor(role));
    renderApp("/settings/access");

    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Access settings|Settings/i })).not.toBeInTheDocument();
    const calls = fetchMock.mock.calls.map((call) => requestUrl(call[0]).pathname);
    expect(calls.filter((path) => path.endsWith("/settings/access"))).toHaveLength(0);
  },
);

it("redirects ncvet_viewer to Home away from /settings/access", async () => {
  installFetch();
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/settings/access");

  expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Access settings|Settings/i })).not.toBeInTheDocument();
});

it("renders access settings page for aa_admin and loads toggle states", async () => {
  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/settings/access") && methodOf(init) === "GET") {
      return jsonResponse(200, {
        abReviewerCanReadAssessorPayments: true,
        ncvetViewerCanSeeAbQueue: false,
        updatedBy: null,
        updatedAt: null,
      });
    }
  });

  setSession(sessionFor("aa_admin"));
  renderApp("/settings/access");

  expect(await screen.findByRole("heading", { name: "Access settings" })).toBeInTheDocument();

  const paymentsToggle = await screen.findByRole("checkbox", {
    name: "AB reviewers can read assessor payments",
  });
  const queueToggle = screen.getByRole("checkbox", {
    name: "NCVET viewers can see the AB queue",
  });

  expect(paymentsToggle).toBeChecked();
  expect(queueToggle).not.toBeChecked();

  // Navigation contains Settings link for aa_admin
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/access");
});

it("saves a toggle change with PUT /settings/access, showing saving, disabled, and success states", async () => {
  const user = userEvent.setup();
  let putBody: unknown = null;

  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/settings/access") && methodOf(init) === "PUT") {
      putBody = requestBody(init);
    }
  });

  setSession(sessionFor("aa_admin"));
  renderApp("/settings/access");

  const queueToggle = await screen.findByRole("checkbox", {
    name: "NCVET viewers can see the AB queue",
  });
  expect(queueToggle).not.toBeChecked();

  await user.click(queueToggle);

  expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  expect(putBody).toEqual({ ncvetViewerCanSeeAbQueue: true });
  expect(queueToggle).toBeChecked();
});

it("shows server error in plain words when save fails and restores toggles", async () => {
  const user = userEvent.setup();

  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/settings/access") && methodOf(init) === "PUT") {
      return jsonResponse(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "At least one setting is required",
        },
      });
    }
  });

  setSession(sessionFor("aa_admin"));
  renderApp("/settings/access");

  const paymentsToggle = await screen.findByRole("checkbox", {
    name: "AB reviewers can read assessor payments",
  });
  expect(paymentsToggle).not.toBeChecked();

  await user.click(paymentsToggle);

  const errorAlert = await screen.findByRole("alert");
  expect(errorAlert).toHaveTextContent("At least one setting is required");
  expect(paymentsToggle).not.toBeChecked();
  expect(paymentsToggle).toBeEnabled();
});

it("shows error alert when loading settings fails", async () => {
  installFetch(async (url, init) => {
    if (url.pathname.endsWith("/settings/access") && methodOf(init) === "GET") {
      return jsonResponse(500, {
        error: { code: "INTERNAL_ERROR", message: "Failed to load database settings" },
      });
    }
  });

  setSession(sessionFor("aa_admin"));
  renderApp("/settings/access");

  const errorAlert = await screen.findByRole("alert");
  expect(errorAlert).toHaveTextContent("Failed to load database settings");
});
