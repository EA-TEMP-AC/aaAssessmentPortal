import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { jsonResponse } from "../test/fixtures";
import { renderApp } from "../test/render";

type Handler = (url: URL, init?: RequestInit) => Response;

function installFetch(handler: Handler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new URL(String(input), "http://localhost"), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

const page = (items: unknown[]) => jsonResponse(200, { page: 1, pageSize: 20, total: items.length, items });

function serve(slug: string, items: unknown[]) {
  return installFetch((url) =>
    url.pathname === `/api/v1/public/${slug}`
      ? page(items)
      : jsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } }),
  );
}

it("home lists every public section inside the site layout, without any request", () => {
  const fetchMock = installFetch(() => page([]));
  renderApp("/site");
  expect(screen.getByRole("heading", { level: 1, name: "Assessment Agency" })).toBeInTheDocument();
  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Public site" })).toBeInTheDocument();
  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Events calendar" }).length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.title).toBe("Home | Assessment Agency");
});

it("team shows members and sends no Authorization header", async () => {
  const fetchMock = serve("team-members", [
    { id: "1", name: "Asha Rao", designation: "Director", department: "Operations" },
  ]);
  renderApp("/site/team");
  expect(await screen.findByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
  expect(screen.getByText("Director, Operations")).toBeInTheDocument();
  expect(document.title).toBe("Team | Assessment Agency");
  const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
  expect(headers.has("Authorization")).toBe(false);
});

it("shows loading, then empty", async () => {
  serve("team-members", []);
  renderApp("/site/team");
  expect(screen.getByRole("status")).toHaveTextContent("Loading team");
  expect(await screen.findByText("No team members have been published yet.")).toBeInTheDocument();
});

it("shows a rate-limit message with retry", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    return calls === 1
      ? jsonResponse(429, { error: { code: "RATE_LIMITED", message: "Slow down" } })
      : page([{ id: "1", name: "Asha Rao", designation: "Director" }]);
  });
  renderApp("/site/team");
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
});

it("shows a general error when the server is unreachable", async () => {
  installFetch(() => {
    throw new TypeError("network");
  });
  renderApp("/site/team");
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
});

it("pages through a long list using ?page=", async () => {
  const fetchMock = installFetch((url) => {
    const current = Number(url.searchParams.get("page") ?? "1");
    return jsonResponse(200, {
      page: current,
      pageSize: 20,
      total: 25,
      items: [{ id: `p${current}`, name: `Person ${current}`, designation: "Staff" }],
    });
  });
  renderApp("/site/team");
  expect(await screen.findByRole("heading", { name: "Person 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("heading", { name: "Person 2" })).toBeInTheDocument();
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  const last = new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost");
  expect(last.searchParams.get("page")).toBe("2");
});

it("renders the organogram as a nested tree from parent links", async () => {
  serve("organogram", [
    { id: "a", name: "Chief", title: "CEO" },
    { id: "b", name: "Deputy", title: "Head of Ops", parentId: "a" },
    { id: "c", name: "Analyst", title: "MIS", parentId: "b" },
  ]);
  renderApp("/site/organogram");
  const chief = (await screen.findByText("Chief")).closest("li")!;
  const deputy = within(chief).getByText("Deputy").closest("li")!;
  expect(within(deputy).getByText("Analyst")).toBeInTheDocument();
  expect(chief.parentElement!.tagName).toBe("UL");
});

it("people shows name, role and sector only, and filters by kind", async () => {
  const fetchMock = serve("people", [
    {
      id: "1",
      kind: "assessor",
      name: "Ravi Kumar",
      roleLabel: "Assessor",
      sector: "IT-ITeS",
      photoRef: "photos/ravi.jpg",
    },
  ]);
  renderApp("/site/people");
  expect(await screen.findByRole("heading", { name: "Ravi Kumar" })).toBeInTheDocument();
  expect(screen.getByText(/Assessor · Sector: IT-ITeS/)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Proctors" }));
  await screen.findByRole("heading", { name: "Ravi Kumar" });
  const urls = fetchMock.mock.calls.map((call) => new URL(String(call[0]), "http://localhost"));
  expect(urls.some((u) => u.searchParams.get("kind") === "proctor")).toBe(true);
  expect(screen.getByRole("button", { name: "Proctors" })).toHaveAttribute("aria-pressed", "true");
});

it("sample papers link only web addresses", async () => {
  serve("sample-papers", [
    {
      id: "1",
      title: "Paper A",
      fileRef: "https://files.example/a.pdf",
      qualification: { code: "Q1", name: "Retail", sector: "Retail" },
    },
    { id: "2", title: "Paper B", fileRef: "javascript:alert(1)" },
  ]);
  renderApp("/site/sample-papers");
  const link = await screen.findByRole("link", { name: /Open Paper A/ });
  expect(link).toHaveAttribute("href", "https://files.example/a.pdf");
  expect(screen.getByText("Retail (Q1) · Sector: Retail")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Paper B/ })).not.toBeInTheDocument();
});

it("industry linkages show the description and website link", async () => {
  serve("industry-linkages", [
    { id: "1", name: "Acme", description: "Placement partner", websiteUrl: "https://acme.example" },
  ]);
  renderApp("/site/industry-linkages");
  expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
  expect(screen.getByText("Placement partner")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Visit the website of Acme/ })).toHaveAttribute(
    "href",
    "https://acme.example/",
  );
});

it("grievance shows procedure and contact details", async () => {
  serve("grievance", [
    {
      id: "1",
      title: "How to complain",
      body: "Write to us.",
      contactName: "Meera",
      contactEmail: "grievance@aa.example",
      contactPhone: "+91 98765 43210",
    },
  ]);
  renderApp("/site/grievance");
  expect(await screen.findByRole("heading", { name: "How to complain" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "grievance@aa.example" })).toHaveAttribute(
    "href",
    "mailto:grievance@aa.example",
  );
  expect(screen.getByRole("link", { name: "+91 98765 43210" })).toHaveAttribute("href", "tel:+919876543210");
});

it("POSH separates the policy from the committee", async () => {
  serve("posh", [
    { id: "1", kind: "policy", title: "POSH Policy", body: "Zero tolerance." },
    { id: "2", kind: "committee_member", title: "Committee", memberName: "Lata Iyer", memberRole: "Chair" },
  ]);
  renderApp("/site/posh");
  const policy = await screen.findByRole("region", { name: "Policy" });
  expect(within(policy).getByText("Zero tolerance.")).toBeInTheDocument();
  const committee = screen.getByRole("region", { name: "Committee" });
  expect(within(committee).getByRole("heading", { name: "Lata Iyer" })).toBeInTheDocument();
  expect(within(committee).getByText(/Chair/)).toBeInTheDocument();
});

it("utility bills show Proof on file and never a link", async () => {
  serve("office-documents", [
    { id: "1", category: "electricity_bill", title: "Power bill", fileRef: null, proofOnFile: true },
    { id: "2", category: "telephone_bill", title: "Phone bill", fileRef: "https://leak.example/bill.pdf", proofOnFile: false },
    { id: "3", category: "internet_bill", title: "Net bill", fileRef: "https://leak.example/net.pdf" },
    { id: "4", category: "lease", title: "Lease deed", fileRef: "https://files.example/lease.pdf", proofOnFile: false },
  ]);
  renderApp("/site/office-documents");
  await screen.findByRole("heading", { name: "Power bill" });
  expect(screen.getAllByText("Proof on file")).toHaveLength(3);
  expect(screen.getByRole("link", { name: /Open Lease deed/ })).toHaveAttribute(
    "href",
    "https://files.example/lease.pdf",
  );
  expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(1);
  expect(document.body.innerHTML).not.toContain("leak.example");
});

it("keeps the previous page and the pager while the next page loads, then focuses the heading", async () => {
  let release: (() => void) | undefined;
  installFetch((url) => {
    const current = Number(url.searchParams.get("page") ?? "1");
    const body = {
      page: current,
      pageSize: 20,
      total: 25,
      items: [{ id: `p${current}`, name: `Person ${current}`, designation: "Staff" }],
    };
    if (current === 2) {
      return new Promise<Response>((resolve) => {
        release = () => resolve(jsonResponse(200, body));
      }) as unknown as Response;
    }
    return jsonResponse(200, body);
  });
  renderApp("/site/team");
  expect(await screen.findByRole("heading", { name: "Person 1" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));

  expect(screen.getByRole("heading", { name: "Person 1" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "team pages" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

  release?.();
  expect(await screen.findByRole("heading", { name: "Person 2" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Our team" })).toHaveFocus());
});

it("shows photos only for https addresses", async () => {
  serve("team-members", [
    { id: "1", name: "Secure Sam", designation: "Lead", photoRef: "https://img.example/a.jpg" },
    { id: "2", name: "Plain Pat", designation: "Lead", photoRef: "http://img.example/b.jpg" },
  ]);
  const { container } = renderApp("/site/team");
  await screen.findByRole("heading", { name: "Secure Sam" });
  const sources = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
  expect(sources).toEqual(["https://img.example/a.jpg"]);
});
