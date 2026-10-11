import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { UserRecord } from "../api/users";
import { setSession } from "../api/session";
import { ROLE_LABELS, ROLES, type Role } from "../routing/access";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

const CAN_MANAGE: readonly Role[] = ["aa_admin", "mis"];
const PASSWORD = "Temporary-Pass-1";
const LEAKED = "Secret-Temp-99";

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "66f0000000000000000000a1",
    email: "asha@example.com",
    name: "Asha Devi",
    role: "assessor",
    active: true,
    mustChangePassword: true,
    linkedProfileId: null,
    abId: null,
    tpId: null,
    createdAt: "2026-10-01T09:30:00.000Z",
    updatedAt: "2026-10-02T09:30:00.000Z",
    ...overrides,
  };
}

function adminRecord(): UserRecord {
  return userRecord({
    id: "66f0000000000000000000aa",
    email: "ada@example.com",
    name: "Ada Admin",
    role: "aa_admin",
    mustChangePassword: false,
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function methodOf(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function requestBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== "string") return undefined;
  return JSON.parse(init.body);
}

function listBody(items: UserRecord[], extra: { page?: number; pageSize?: number; total?: number } = {}) {
  return {
    page: extra.page ?? 1,
    pageSize: extra.pageSize ?? 20,
    total: extra.total ?? items.length,
    items,
  };
}

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function storedText(): string {
  const chunks: string[] = [];
  for (const store of [localStorage, sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key) continue;
      chunks.push(key, store.getItem(key) ?? "");
    }
  }
  return chunks.join("\n");
}

function postCalls(fetchMock: ReturnType<typeof installFetch>, suffix: string) {
  return fetchMock.mock.calls.filter((call) => {
    const url = requestUrl(call[0]);
    return methodOf(call[1]) === "POST" && url.pathname.endsWith(suffix);
  });
}

it.each(ROLES)("shows user administration only to aa_admin and mis (%s)", async (role) => {
  const fetchMock = installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor(role));
  renderApp("/users");

  if (CAN_MANAGE.includes(role)) {
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(fetchMock.mock.calls.some((call) => requestUrl(call[0]).pathname.endsWith("/users"))).toBe(true);
  } else {
    expect(await screen.findByRole("heading", { name: ROLE_LABELS[role] })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  }
});

it("lets mis read an AA admin but not edit, activate, or reset that account", async () => {
  const user = userEvent.setup();
  installFetch(async () =>
    jsonResponse(200, {
      page: 1,
      pageSize: 20,
      total: 2,
      items: [{ ...adminRecord(), password: LEAKED, passwordHash: "hashed-secret" }, userRecord()],
    }),
  );
  setSession(sessionFor("mis"));
  renderApp("/users");

  const adminRow = await screen.findByRole("row", { name: /Ada Admin/ });
  expect(within(adminRow).getByText("Cannot edit or reset")).toBeInTheDocument();
  expect(within(adminRow).queryAllByRole("button")).toEqual([]);
  expect(screen.queryByText(LEAKED)).not.toBeInTheDocument();
  expect(screen.queryByText("hashed-secret")).not.toBeInTheDocument();
  expect(within(screen.getByLabelText("Role")).getByRole("option", { name: "AA admin" })).toBeInTheDocument();

  const ashaRow = screen.getByRole("row", { name: /Asha Devi/ });
  expect(within(ashaRow).getByRole("button", { name: "Edit Asha Devi" })).toBeInTheDocument();
  expect(within(ashaRow).getByRole("button", { name: "Deactivate Asha Devi" })).toBeInTheDocument();
  expect(within(ashaRow).getByRole("button", { name: "Reset password for Asha Devi" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create user" }));
  const createDialog = screen.getByRole("dialog", { name: "Create user" });
  const createRoles = within(createDialog).getByLabelText("Role");
  for (const role of ROLES) {
    const option = within(createRoles).queryByRole("option", { name: ROLE_LABELS[role] });
    if (role === "aa_admin") expect(option).not.toBeInTheDocument();
    else expect(option).toBeInTheDocument();
  }

  await user.click(within(createDialog).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Edit Asha Devi" }));
  const editDialog = screen.getByRole("dialog", { name: "Edit Asha Devi" });
  expect(within(editDialog).queryByRole("option", { name: "AA admin" })).not.toBeInTheDocument();
  expect(within(editDialog).getByLabelText("Role")).toHaveValue("assessor");
});

it("lets an AA admin edit and reset an existing AA admin", async () => {
  installFetch(async () => jsonResponse(200, listBody([adminRecord()])));
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  const row = await screen.findByRole("row", { name: /Ada Admin/ });
  expect(within(row).getByRole("button", { name: "Edit Ada Admin" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Deactivate Ada Admin" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Reset password for Ada Admin" })).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Create user" }));
  const roles = within(screen.getByRole("dialog", { name: "Create user" })).getByLabelText("Role");
  expect(within(roles).getByRole("option", { name: "AA admin" })).toHaveValue("aa_admin");
});

it("pages with the returned page, pageSize, and total", async () => {
  const user = userEvent.setup();
  const people = ["One", "Two", "Three", "Four", "Five"].map((name, index) =>
    userRecord({
      id: `66f00000000000000000000${index + 1}`,
      name: `User ${name}`,
      email: `${name.toLowerCase()}@example.com`,
    }),
  );
  const fetchMock = installFetch(async (url) => {
    const page = Number(url.searchParams.get("page") ?? "1");
    const start = (page - 1) * 2;
    return jsonResponse(200, listBody(people.slice(start, start + 2), { page, pageSize: 2, total: people.length }));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  expect(await screen.findByText("Page 1 of 3. 2 per page. 5 users.")).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
    "Name",
    "Email",
    "Role",
    "Status",
    "Password change",
    "Actions",
  ]);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "User Three" })).toBeInTheDocument();
  expect(screen.getByText("Page 2 of 3. 2 per page. 5 users.")).toBeInTheDocument();
  const params = requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams;
  expect(params.get("page")).toBe("2");
  expect(params.get("pageSize")).toBe("20");

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "User Five" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Previous page" }));
  expect(await screen.findByRole("cell", { name: "User Three" })).toBeInTheDocument();
});

it("filters by role and account status and returns to page 1", async () => {
  const user = userEvent.setup();
  const people = [
    userRecord({ name: "User One", email: "one@example.com", id: "66f000000000000000000001" }),
    userRecord({
      name: "User Two",
      email: "two@example.com",
      id: "66f000000000000000000002",
      role: "mis",
      active: false,
    }),
  ];
  const fetchMock = installFetch(async (url) => {
    const page = Number(url.searchParams.get("page") ?? "1");
    return jsonResponse(200, listBody(people.slice(page - 1, page), { page, pageSize: 1, total: people.length }));
  });
  setSession(sessionFor("mis"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("cell", { name: "User Two" })).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Role"), "assessor");
  await user.selectOptions(screen.getByLabelText("Account status"), "false");
  await user.selectOptions(screen.getByLabelText("Page size"), "50");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));

  expect(await screen.findByRole("cell", { name: "User One" })).toBeInTheDocument();
  const params = requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? "").searchParams;
  expect(params.get("role")).toBe("assessor");
  expect(params.get("active")).toBe("false");
  expect(params.get("page")).toBe("1");
  expect(params.get("pageSize")).toBe("50");
  expect(params.has("search")).toBe(false);
  expect(params.has("q")).toBe(false);
  expect(params.has("email")).toBe(false);
});

it("shows an empty state, then a filtered empty state", async () => {
  const user = userEvent.setup();
  installFetch(async () => jsonResponse(200, listBody([], { total: 0, pageSize: 20 })));
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  expect(await screen.findByText("No users are available.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Page 1 of 1. 20 per page. 0 users.");
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

  await user.selectOptions(screen.getByLabelText("Role"), "candidate");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("No users match these filters.")).toBeInTheDocument();
});

it("announces that users are loading", async () => {
  let resolveFetch: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  installFetch(() => pending);
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  expect(await screen.findByRole("status")).toHaveTextContent("Loading users.");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  resolveFetch(jsonResponse(200, listBody([userRecord()])));
  expect(await screen.findByRole("cell", { name: "Asha Devi" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Page 1 of 1. 20 per page. 1 user.");
});

it("announces a load failure and retries", async () => {
  const user = userEvent.setup();
  let fail = true;
  installFetch(async () => {
    if (fail) {
      return jsonResponse(503, { error: { code: "UNAVAILABLE", message: "Users are unavailable." } });
    }
    return jsonResponse(200, listBody([userRecord()]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  expect(await screen.findByRole("alert")).toHaveTextContent("Users are unavailable.");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("cell", { name: "Asha Devi" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("returns focus to Create user when the form is cancelled from the keyboard", async () => {
  const user = userEvent.setup();
  installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  const opener = await screen.findByRole("button", { name: "Create user" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Create user" });
  expect(within(dialog).getByLabelText("Email")).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("announces validation errors and does not send them", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async () => jsonResponse(200, listBody([])));
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Create user" }));
  const dialog = screen.getByRole("dialog", { name: "Create user" });
  const callsBefore = fetchMock.mock.calls.length;
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Enter an email address.");
  expect(alert).toHaveTextContent("Enter a name.");
  expect(alert).toHaveTextContent("Select a role.");
  expect(alert).toHaveTextContent("Enter a password of 8 to 200 characters.");
  expect(within(dialog).getByLabelText("Email")).toHaveFocus();
  expect(within(dialog).getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  expect(fetchMock.mock.calls.length).toBe(callsBefore);

  await user.type(within(dialog).getByLabelText("Email"), "asha@example.com");
  await user.type(within(dialog).getByLabelText("Name"), "Asha Devi");
  await user.selectOptions(within(dialog).getByLabelText("Role"), "assessor");
  await user.type(within(dialog).getByLabelText("Password"), PASSWORD);
  await user.type(within(dialog).getByLabelText("Confirm password"), "Temporary-Pass-2");
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The passwords do not match.");
  expect(within(dialog).getByLabelText("Confirm password")).toHaveFocus();
  expect(postCalls(fetchMock, "/users")).toHaveLength(0);

  await user.clear(within(dialog).getByLabelText("Confirm password"));
  await user.type(within(dialog).getByLabelText("Confirm password"), PASSWORD);
  await user.type(within(dialog).getByLabelText("Linked profile id"), "not-an-id");
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Linked profile id must be a 24-character id, or blank.");
  expect(postCalls(fetchMock, "/users")).toHaveLength(0);
});

it("creates a user and does not keep the password after the form closes", async () => {
  const user = userEvent.setup();
  let created = false;
  const fetchMock = installFetch(async (url, init) => {
    if (methodOf(init) === "POST" && url.pathname.endsWith("/users")) {
      created = true;
      return jsonResponse(201, { ...userRecord(), password: PASSWORD, passwordHash: "hashed-secret" });
    }
    return jsonResponse(200, listBody(created ? [userRecord()] : []));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Create user" }));
  const dialog = screen.getByRole("dialog", { name: "Create user" });
  await user.type(within(dialog).getByLabelText("Email"), "asha@example.com");
  await user.type(within(dialog).getByLabelText("Name"), "Asha Devi");
  await user.selectOptions(within(dialog).getByLabelText("Role"), "assessor");
  await user.type(within(dialog).getByLabelText("Password"), PASSWORD);
  await user.type(within(dialog).getByLabelText("Confirm password"), PASSWORD);
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));

  const notice = await screen.findByText(/Asha Devi was created/);
  expect(notice).toHaveTextContent("They must change the password the next time they sign in.");
  expect(notice).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(PASSWORD)).not.toBeInTheDocument();
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  expect(screen.queryByText("hashed-secret")).not.toBeInTheDocument();
  expect(storedText()).not.toContain(PASSWORD);
  expect(requestBody(postCalls(fetchMock, "/users")[0]?.[1])).toEqual({
    email: "asha@example.com",
    name: "Asha Devi",
    role: "assessor",
    password: PASSWORD,
    active: true,
  });
  expect(await screen.findByRole("cell", { name: "Asha Devi" })).toBeInTheDocument();
});

it("announces a create error and leaves the form open", async () => {
  const user = userEvent.setup();
  installFetch(async (_url, init) => {
    if (methodOf(init) === "POST") {
      return jsonResponse(409, {
        error: { code: "DUPLICATE_RESOURCE", message: "A user with this email already exists" },
      });
    }
    return jsonResponse(200, listBody([]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Create user" }));
  const dialog = screen.getByRole("dialog", { name: "Create user" });
  await user.type(within(dialog).getByLabelText("Email"), "asha@example.com");
  await user.type(within(dialog).getByLabelText("Name"), "Asha Devi");
  await user.selectOptions(within(dialog).getByLabelText("Role"), "assessor");
  await user.type(within(dialog).getByLabelText("Password"), PASSWORD);
  await user.type(within(dialog).getByLabelText("Confirm password"), PASSWORD);
  await user.click(within(dialog).getByRole("button", { name: "Create user" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent("A user with this email already exists");
  expect(alert).not.toHaveTextContent(PASSWORD);
  expect(alert).toHaveFocus();
  expect(screen.getByRole("dialog", { name: "Create user" })).toBeInTheDocument();
});

it("saves an edit without sending a password", async () => {
  const user = userEvent.setup();
  const profileId = "66f0000000000000000000b1";
  let saved = userRecord();
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "PATCH") {
      const body = requestBody(init) as Partial<UserRecord>;
      saved = userRecord({ ...saved, ...body, name: "Asha D.", active: false, linkedProfileId: profileId });
      return jsonResponse(200, saved);
    }
    return jsonResponse(200, listBody([saved]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Edit Asha Devi" }));
  const dialog = screen.getByRole("dialog", { name: "Edit Asha Devi" });
  expect(within(dialog).queryByLabelText("Password")).not.toBeInTheDocument();
  const name = within(dialog).getByLabelText("Name");
  expect(name).toHaveValue("Asha Devi");
  await user.clear(name);
  await user.type(name, "Asha D.");
  await user.click(within(dialog).getByLabelText("Active"));
  await user.type(within(dialog).getByLabelText("Linked profile id"), profileId);
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText(/Changes for Asha D. were saved/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const patch = fetchMock.mock.calls.find((call) => methodOf(call[1]) === "PATCH");
  expect(requestUrl(patch?.[0] ?? "").pathname).toBe("/api/v1/users/66f0000000000000000000a1");
  expect(requestBody(patch?.[1])).toEqual({
    email: "asha@example.com",
    name: "Asha D.",
    role: "assessor",
    active: false,
    linkedProfileId: profileId,
    abId: null,
    tpId: null,
  });
  expect(requestBody(patch?.[1])).not.toHaveProperty("password");
  expect(requestBody(patch?.[1])).not.toHaveProperty("mustChangePassword");
});

it("deactivates a user from the row, after focusing cancel", async () => {
  const user = userEvent.setup();
  let active = true;
  const fetchMock = installFetch(async (_url, init) => {
    if (methodOf(init) === "PATCH") {
      active = false;
      return jsonResponse(200, userRecord({ active: false }));
    }
    return jsonResponse(200, listBody([userRecord({ active })]));
  });
  setSession(sessionFor("mis"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Deactivate Asha Devi" }));
  const dialog = screen.getByRole("dialog", { name: "Deactivate Asha Devi?" });
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(within(dialog).getByText("They will not be able to sign in.")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

  expect(await screen.findByText("Asha Devi is now inactive.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const patch = fetchMock.mock.calls.find((call) => methodOf(call[1]) === "PATCH");
  expect(requestBody(patch?.[1])).toEqual({ active: false });
  expect(await screen.findByRole("button", { name: "Activate Asha Devi" })).toBeInTheDocument();
});

it("sets a new password on 204 and does not show it again", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url) => {
    if (url.pathname.endsWith("/password-reset")) return jsonResponse(204);
    return jsonResponse(200, listBody([userRecord()]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Reset password for Asha Devi" }));
  const dialog = screen.getByRole("dialog", { name: "Reset password for Asha Devi" });
  expect(within(dialog).getByRole("radio", { name: "Set a new password" })).toHaveFocus();
  await user.click(within(dialog).getByRole("radio", { name: "Set a new password" }));
  await user.type(within(dialog).getByLabelText("Password"), PASSWORD);
  await user.type(within(dialog).getByLabelText("Confirm password"), PASSWORD);
  await user.click(within(dialog).getByRole("button", { name: "Set password" }));

  const notice = await screen.findByText(/A new password was set for Asha Devi/);
  expect(notice).toHaveTextContent("It is not shown again.");
  expect(notice).toHaveTextContent("The user must change it the next time they sign in.");
  expect(notice).not.toHaveTextContent(PASSWORD);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(PASSWORD)).not.toBeInTheDocument();
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  expect(storedText()).not.toContain(PASSWORD);
  const reset = postCalls(fetchMock, "/password-reset");
  expect(reset).toHaveLength(1);
  expect(requestBody(reset[0]?.[1])).toEqual({ newPassword: PASSWORD });
});

it("queues a reset email on 202 and says it may arrive later", async () => {
  const user = userEvent.setup();
  const fetchMock = installFetch(async (url) => {
    if (url.pathname.endsWith("/password-reset")) {
      return jsonResponse(202, { emailQueued: true, temporaryPassword: LEAKED });
    }
    return jsonResponse(200, listBody([userRecord()]));
  });
  setSession(sessionFor("mis"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Reset password for Asha Devi" }));
  const dialog = screen.getByRole("dialog", { name: "Reset password for Asha Devi" });
  await user.click(within(dialog).getByRole("radio", { name: "Send a reset email" }));
  expect(within(dialog).getByText(/queued and may arrive later/i)).toBeInTheDocument();
  expect(within(dialog).queryByLabelText("Password")).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Queue reset email" }));

  const notice = await screen.findByText(/reset email for Asha Devi was queued/i);
  expect(notice).toHaveTextContent("It may arrive later.");
  expect(notice).toHaveTextContent("The temporary password is not shown.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(LEAKED)).not.toBeInTheDocument();
  expect(storedText()).not.toContain(LEAKED);
  expect(requestBody(postCalls(fetchMock, "/password-reset")[0]?.[1])).toEqual({ sendEmail: true });
});

it("announces when a reset email was not queued", async () => {
  const user = userEvent.setup();
  installFetch(async (url) => {
    if (url.pathname.endsWith("/password-reset")) {
      return jsonResponse(202, { emailQueued: false, temporaryPassword: LEAKED });
    }
    return jsonResponse(200, listBody([userRecord()]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Reset password for Asha Devi" }));
  const dialog = screen.getByRole("dialog", { name: "Reset password for Asha Devi" });
  await user.click(within(dialog).getByRole("radio", { name: "Send a reset email" }));
  await user.click(within(dialog).getByRole("button", { name: "Queue reset email" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/not queued/i);
  expect(alert).toHaveTextContent(/may not arrive/i);
  expect(alert).toHaveTextContent(/temporary password is not shown/i);
  expect(alert).not.toHaveTextContent(LEAKED);
  expect(alert).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/may arrive later/i)).not.toBeInTheDocument();
  expect(screen.queryByText(LEAKED)).not.toBeInTheDocument();
});

it("announces a password-reset error and does not show a returned password", async () => {
  const user = userEvent.setup();
  let mode: "rate" | "leaked" = "rate";
  installFetch(async (url) => {
    if (url.pathname.endsWith("/password-reset")) {
      if (mode === "rate") {
        return jsonResponse(429, {
          error: { code: "RATE_LIMITED", message: "Too many password resets. Try again later." },
        });
      }
      return jsonResponse(200, { temporaryPassword: LEAKED });
    }
    return jsonResponse(200, listBody([userRecord()]));
  });
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  await user.click(await screen.findByRole("button", { name: "Reset password for Asha Devi" }));
  let dialog = screen.getByRole("dialog", { name: "Reset password for Asha Devi" });
  await user.click(within(dialog).getByRole("radio", { name: "Set a new password" }));
  await user.type(within(dialog).getByLabelText("Password"), PASSWORD);
  await user.type(within(dialog).getByLabelText("Confirm password"), PASSWORD);
  await user.click(within(dialog).getByRole("button", { name: "Set password" }));

  let alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent("Too many password resets. Try again later.");
  expect(alert).not.toHaveTextContent(PASSWORD);
  expect(alert).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  mode = "leaked";
  await user.click(within(dialog).getByRole("radio", { name: "Send a reset email" }));
  await user.click(within(dialog).getByRole("button", { name: "Queue reset email" }));
  dialog = screen.getByRole("dialog", { name: "Reset password for Asha Devi" });
  alert = await within(dialog).findByRole("alert");
  expect(alert).toHaveTextContent("Password reset response was not recognised.");
  expect(screen.queryByText(LEAKED)).not.toBeInTheDocument();
  expect(storedText()).not.toContain(PASSWORD);
  expect(storedText()).not.toContain(LEAKED);
});
