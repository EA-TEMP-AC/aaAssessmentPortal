import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const CAN_BROWSE: readonly Role[] = ["aa_admin", "ab_reviewer", "mis", "ncvet_viewer"];
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const SIGNED = "https://bucket.example.test/evidence/abc?X-Signature=secret-signature";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev1",
    clientEventId: "evt-1",
    batchId: "batch-1",
    abId: "ab-1",
    candidateId: "cand-1",
    kind: "photo",
    contentType: "image/jpeg",
    size: 183422,
    sha256: HASH,
    uploaderId: "user-9",
    uploaderRole: "assessor",
    capturedAt: "2026-11-20T05:00:00.000Z",
    uploadedAt: "2026-11-20T05:00:07.412Z",
    locationStatus: "captured",
    latitude: 19.076,
    longitude: 72.8777,
    accuracy: 12.5,
    locationUnavailableReason: null,
    hasLocation: true,
    deviceId: "dev-1",
    verification: null,
    verifyCount: 0,
    ...overrides,
  };
}

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { page: 1, pageSize: 20, total: items.length, items, ...extra };
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

function listCalls(mock: ReturnType<typeof stub>) {
  return mock.mock.calls.map((call) => url(call[0])).filter((u) => u.pathname.endsWith("/evidence"));
}

const createObjectURL = vi.fn(() => "blob:local-preview");
const revokeObjectURL = vi.fn();
let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clickSpy.mockRestore();
});

it.each(ROLES)("opens the evidence browser only for allowed roles (%s)", async (role) => {
  const mock = stub(() => jsonResponse(200, page([])));
  setSession(sessionFor(role));
  renderApp("/evidence");

  if (CAN_BROWSE.includes(role)) {
    expect(await screen.findByRole("heading", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("aria-current", "page");
  } else {
    expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Evidence" })).not.toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  }
});

it("sends an anonymous visitor to sign in", async () => {
  renderApp("/evidence");
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
});

it("shows the table with kind, uploader, times, size, short checksum and location", async () => {
  stub(() => jsonResponse(200, page([row(), row({ id: "ev2", kind: "video", contentType: "video/mp4", locationStatus: "not_provided", hasLocation: false })])));
  setSession(sessionFor("mis"));
  renderApp("/evidence");

  const table = await screen.findByRole("table", { name: "Evidence files" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  const first = within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent ?? "");
  expect(first[0]).toBe("Photo");
  expect(first[1]).toContain("Assessor (user-9)");
  expect(first[2]).toContain("20 Nov 2026");
  expect(first[2]).toContain("10:30");
  expect(first[2]).toContain("IST");
  expect(first[4]).toBe("179.1 KB");
  expect(first[5]).toContain("9f86d081…f00a08");
  expect(first[5]).not.toContain(HASH);
  expect(first[6]).toBe("Captured");
  expect(within(rows[2]).getByText("Not provided")).toBeInTheDocument();
  expect(await screen.findByText("Page 1 of 1. 20 per page. 2 files.")).toBeInTheDocument();
});

it("copies the full checksum", async () => {
  const user = userEvent.setup();
  stub(() => jsonResponse(200, page([row()])));
  setSession(sessionFor("mis"));
  renderApp("/evidence");

  await user.click(await screen.findByRole("button", { name: /Copy checksum/ }));
  expect(await navigator.clipboard.readText()).toBe(HASH);
  expect(screen.getByText("Checksum copied.")).toBeInTheDocument();
});

it("sends every filter to the server and returns to page 1", async () => {
  const user = userEvent.setup();
  const mock = stub(() => jsonResponse(200, page([row()], { total: 45 })));
  setSession(sessionFor("aa_admin"));
  renderApp("/evidence");
  await screen.findByRole("table", { name: "Evidence files" });

  await user.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(listCalls(mock).at(-1)?.searchParams.get("page")).toBe("2"));

  await user.type(screen.getByLabelText("Batch id"), " batch-1 ");
  await user.type(screen.getByLabelText("Candidate id"), "cand-1");
  await user.type(screen.getByLabelText("Uploader id"), "user-9");
  await user.selectOptions(screen.getByLabelText("Kind"), "photo");
  await user.selectOptions(screen.getByLabelText("Has location"), "true");
  await user.type(screen.getByLabelText("Captured from"), "2026-11-01");
  await user.type(screen.getByLabelText("Captured to"), "2026-11-30");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  await waitFor(() => {
    const params = listCalls(mock).at(-1)!.searchParams;
    expect(params.get("batchId")).toBe("batch-1");
    expect(params.get("candidateId")).toBe("cand-1");
    expect(params.get("uploaderId")).toBe("user-9");
    expect(params.get("kind")).toBe("photo");
    expect(params.get("hasLocation")).toBe("true");
    expect(params.get("from")).toMatch(/^2026-1[01]-\d\dT/);
    expect(params.get("to")).toMatch(/^2026-11-30T/);
    expect(params.get("page")).toBe("1");
  });

  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => {
    const params = listCalls(mock).at(-1)!.searchParams;
    expect([...params.keys()]).toEqual(["page"]);
  });
});

it("refuses a date range that runs backwards without asking the server", async () => {
  const user = userEvent.setup();
  const mock = stub(() => jsonResponse(200, page([row()])));
  setSession(sessionFor("mis"));
  renderApp("/evidence");
  await screen.findByRole("table", { name: "Evidence files" });
  const before = mock.mock.calls.length;

  await user.type(screen.getByLabelText("Captured from"), "2026-11-30");
  await user.type(screen.getByLabelText("Captured to"), "2026-11-01");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  expect(await screen.findByText("The From date must be on or before the To date.")).toBeInTheDocument();
  expect(mock.mock.calls.length).toBe(before);
});

it("shows an empty state, and a different one when filters are on", async () => {
  const user = userEvent.setup();
  stub(() => jsonResponse(200, page([])));
  setSession(sessionFor("mis"));
  renderApp("/evidence");
  expect(await screen.findByText("No evidence has been uploaded yet.")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Kind"), "video");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No evidence matches these filters.")).toBeInTheDocument();
});

it("shows a loading message, then an error with a working retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  stub(() =>
    fail
      ? jsonResponse(403, { error: { code: "FORBIDDEN", message: "Not allowed." } })
      : jsonResponse(200, page([row()])),
  );
  setSession(sessionFor("ab_reviewer"));
  renderApp("/evidence");

  expect(screen.getByText("Loading evidence.")).toBeInTheDocument();
  expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("table", { name: "Evidence files" })).toBeInTheDocument();
});

it("shows an unrecognised list response as an error", async () => {
  stub(() => jsonResponse(200, { nope: true }));
  setSession(sessionFor("mis"));
  renderApp("/evidence");
  expect(await screen.findByText(/response was not recognised/)).toBeInTheDocument();
});

it("shows the location as text without a map, and the unavailable reason", async () => {
  const user = userEvent.setup();
  stub(() =>
    jsonResponse(
      200,
      page([
        row(),
        row({
          id: "ev2",
          locationStatus: "unavailable",
          hasLocation: false,
          latitude: null,
          longitude: null,
          accuracy: null,
          locationUnavailableReason: "GPS switched off",
        }),
      ]),
    ),
  );
  setSession(sessionFor("ncvet_viewer"));
  renderApp("/evidence");

  const buttons = await screen.findAllByRole("button", { name: /^Details for/ });
  await user.click(buttons[0]);
  const panel = screen.getByRole("region", { name: "Evidence detail" });
  expect(panel).toHaveFocus();
  expect(buttons[0]).toHaveAttribute("aria-controls", panel.id);
  expect(within(panel).getByText(/Latitude 19.076, longitude 72.8777, accuracy about 12.5 metres/)).toBeInTheDocument();
  expect(within(panel).getByText(HASH)).toBeInTheDocument();
  expect(within(panel).queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  expect(within(panel).getByText(/Only an AA admin can run a check/)).toBeInTheDocument();

  await user.click(screen.getAllByRole("button", { name: /^Details for/ })[1]);
  expect(await screen.findByText(/Reason: GPS switched off/)).toBeInTheDocument();
});

it("closes the detail with Escape and returns focus to the Details button", async () => {
  const user = userEvent.setup();
  stub(() => jsonResponse(200, page([row()])));
  setSession(sessionFor("mis"));
  renderApp("/evidence");

  const opener = await screen.findByRole("button", { name: /^Details for/ });
  await user.click(opener);
  expect(screen.getByRole("region", { name: "Evidence detail" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Evidence detail" })).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

function fileHandler(fileResponse: () => Response): Handler {
  return (u) => {
    if (u.pathname.endsWith("/evidence/ev1/file")) return fileResponse();
    return jsonResponse(200, page([row()]));
  };
}

async function openDetail(role: Role = "mis") {
  const user = userEvent.setup();
  setSession(sessionFor(role));
  renderApp("/evidence");
  await user.click(await screen.findByRole("button", { name: /^Details for/ }));
  return { user, panel: screen.getByRole("region", { name: "Evidence detail" }) };
}

it("previews an image from raw bytes (local disk) and sends the token", async () => {
  const mock = stub(
    fileHandler(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } })),
  );
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Preview" }));

  const image = await within(panel).findByRole("img");
  expect(image).toHaveAttribute("src", "blob:local-preview");
  const call = mock.mock.calls.find((c) => url(c[0]).pathname.endsWith("/evidence/ev1/file"))!;
  expect(new Headers(call[1]?.headers).get("Authorization")).toBe("Bearer access-token");

  await user.click(within(panel).getByRole("button", { name: "Hide preview" }));
  expect(within(panel).queryByRole("img")).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
});

it("previews an image from a signed link (S3) without printing the link", async () => {
  stub(fileHandler(() => jsonResponse(200, { url: SIGNED, expiresAt: "2026-11-20T05:02:00.000Z", contentType: "image/jpeg", size: 3, sha256: HASH })));
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Preview" }));

  const image = await within(panel).findByRole("img");
  expect(image).toHaveAttribute("src", SIGNED);
  expect(document.body.textContent).not.toContain("secret-signature");
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("asks for an inline link on Preview (Q600) but not on Download", async () => {
  const mock = stub(fileHandler(() => jsonResponse(200, { url: SIGNED, expiresAt: "2026-11-20T05:02:00.000Z" })));
  const { user, panel } = await openDetail();
  const fileCalls = () => mock.mock.calls.map((c) => url(c[0])).filter((u) => u.pathname.endsWith("/evidence/ev1/file"));

  await user.click(within(panel).getByRole("button", { name: "Preview" }));
  await within(panel).findByRole("img");
  expect(fileCalls()).toHaveLength(1);
  expect(fileCalls()[0].searchParams.get("inline")).toBe("true");

  await user.click(within(panel).getByRole("button", { name: /Download/ }));
  await waitFor(() => expect(fileCalls()).toHaveLength(2));
  expect(fileCalls()[1].search).toBe("");
});

it("previews a PDF in an object element", async () => {
  stub((u) =>
    u.pathname.endsWith("/file")
      ? new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "Content-Type": "application/pdf" } })
      : jsonResponse(200, page([row({ contentType: "application/pdf", kind: "attendance" })])),
  );
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Preview" }));

  await waitFor(() => {
    const object = panel.querySelector("object");
    expect(object).toHaveAttribute("type", "application/pdf");
    expect(object).toHaveAttribute("data", "blob:local-preview");
  });
});

it("offers no preview for a video, only download", async () => {
  stub(() => jsonResponse(200, page([row({ kind: "video", contentType: "video/mp4" })])));
  const { panel } = await openDetail();
  expect(within(panel).queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  expect(within(panel).getByText(/No preview for this file type/)).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "Download" })).toBeInTheDocument();
});

it("downloads raw bytes through a temporary local link", async () => {
  stub(fileHandler(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } })));
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Download" }));

  expect(await within(panel).findByText("Download started.")).toBeInTheDocument();
  expect(clickSpy).toHaveBeenCalledTimes(1);
  const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
  expect(anchor.download).toBe("evidence-ev1.jpg");
  expect(anchor.getAttribute("href")).toBe("blob:local-preview");
  expect(document.querySelector("a[download]")).toBeNull();
});

it("downloads through a signed link without showing or keeping it", async () => {
  stub(fileHandler(() => jsonResponse(200, { url: SIGNED, expiresAt: "2026-11-20T05:02:00.000Z", contentType: "image/jpeg", size: 3, sha256: HASH })));
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Download" }));

  expect(await within(panel).findByText("Download started.")).toBeInTheDocument();
  expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).getAttribute("href")).toBe(SIGNED);
  expect(document.body.textContent).not.toContain("secret-signature");
  expect(document.querySelector("a[download]")).toBeNull();
  expect(localStorage.length + sessionStorage.length).toBe(0);
});

it("refuses a link response that is not an http address", async () => {
  stub(fileHandler(() => jsonResponse(200, { url: "javascript:alert(1)" })));
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Download" }));
  expect(await within(panel).findByText(/response was not recognised/)).toBeInTheDocument();
  expect(clickSpy).not.toHaveBeenCalled();
});

it("shows a missing stored file as an error and does not start a download", async () => {
  stub(fileHandler(() => jsonResponse(404, { error: { code: "NOT_FOUND", message: "Evidence file not found." } })));
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Download" }));

  expect(await within(panel).findByRole("alert")).toHaveTextContent("Evidence file not found.");
  expect(clickSpy).not.toHaveBeenCalled();
  expect(within(panel).getByRole("button", { name: "Download" })).toBeEnabled();
});

it("shows a failed preview as an error", async () => {
  stub(fileHandler(() => jsonResponse(500, { error: { code: "INTERNAL", message: "Access could not be logged." } })));
  const { user, panel } = await openDetail();
  await user.click(within(panel).getByRole("button", { name: "Preview" }));
  expect(await within(panel).findByRole("alert")).toHaveTextContent("Access could not be logged.");
  expect(within(panel).queryByRole("img")).not.toBeInTheDocument();
});

function verifyHandler(result: Record<string, unknown> | Response): Handler {
  return (u, init) => {
    if (u.pathname.endsWith("/evidence/ev1/verify") && init?.method === "POST") {
      if (result instanceof Response) return result;
      return jsonResponse(200, {
        id: "ev1",
        sha256: HASH,
        verifyCount: 1,
        verification: { at: "2026-11-21T09:00:00.000Z", byUserId: "u1", result: "ok", ...result },
      });
    }
    return jsonResponse(200, page([row()]));
  };
}

it("lets an AA admin verify and shows an ok result", async () => {
  const mock = stub(verifyHandler({}));
  const { user, panel } = await openDetail("aa_admin");
  expect(within(panel).getByText("Not checked yet.")).toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "Verify" }));

  expect(await within(panel).findByText(/Verified: OK/)).toBeInTheDocument();
  expect(within(panel).getByText("Checked 1 time so far.")).toBeInTheDocument();
  expect(mock.mock.calls.some((c) => c[1]?.method === "POST" && url(c[0]).pathname.endsWith("/evidence/ev1/verify"))).toBe(true);
});

it("shows a mismatch with both checksums", async () => {
  stub(verifyHandler({ result: "mismatch", expectedSha256: HASH, actualSha256: "1a2b3c4d", actualSize: 183000 }));
  const { user, panel } = await openDetail("aa_admin");
  await user.click(within(panel).getByRole("button", { name: "Verify" }));

  const alert = await within(panel).findByRole("alert");
  expect(alert).toHaveTextContent("Mismatch.");
  expect(alert).toHaveTextContent(HASH);
  expect(alert).toHaveTextContent("1a2b3c4d");
  expect(alert).toHaveTextContent("178.7 KB");
});

it("shows a missing file result", async () => {
  stub(verifyHandler({ result: "missing" }));
  const { user, panel } = await openDetail("aa_admin");
  await user.click(within(panel).getByRole("button", { name: "Verify" }));
  expect(await within(panel).findByRole("alert")).toHaveTextContent("Missing. The stored file could not be found.");
});

it("shows an earlier verification already on the row", async () => {
  stub(() =>
    jsonResponse(
      200,
      page([row({ verifyCount: 2, verification: { at: "2026-11-21T09:00:00.000Z", byUserId: "u1", result: "missing" } })]),
    ),
  );
  const { panel } = await openDetail("mis");
  expect(within(panel).getByRole("alert")).toHaveTextContent("Missing.");
  expect(within(panel).getByText("Checked 2 times so far.")).toBeInTheDocument();
});

it("shows a verify request error and allows another try", async () => {
  stub(verifyHandler(jsonResponse(403, { error: { code: "FORBIDDEN", message: "Only the AA admin can verify." } })));
  const { user, panel } = await openDetail("aa_admin");
  await user.click(within(panel).getByRole("button", { name: "Verify" }));
  expect(await within(panel).findByText("Only the AA admin can verify.")).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "Verify" })).toBeEnabled();
});
