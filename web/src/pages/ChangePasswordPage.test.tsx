import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, getSnapshot, setSession } from "../api/session";
import { renderApp } from "../test/render";
import { jsonResponse, sessionFor } from "../test/fixtures";

type Call = { url: string; init?: RequestInit };

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

function stubFetch(handler: (call: Call) => Response, calls: Call[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), init };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  confirm = next,
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

it("changes the password from the gate and opens the portal", async () => {
  setSession(sessionFor("assessor", { mustChangePassword: true }));
  const calls = stubFetch(() =>
    jsonResponse(200, {
      user: {
        id: "66f000000000000000000001",
        role: "assessor",
        name: "Test User",
        mustChangePassword: false,
      },
    }),
  );
  const user = userEvent.setup();
  renderApp("/home");

  expect(
    await screen.findByRole("heading", { name: "Password change required" }),
  ).toBeInTheDocument();
  await fill(user, "Temporary-Pass-1", "Battery-Staple-7");

  expect(
    await screen.findByRole("navigation", { name: "Primary" }),
  ).toBeInTheDocument();
  expect(getSnapshot()?.user.mustChangePassword).toBe(false);
  expect(getSnapshot()?.accessToken).toBe("access-token");

  const call = calls[0];
  expect(call?.url).toBe("/api/v1/auth/change-password");
  expect(call?.init?.method).toBe("POST");
  expect(JSON.parse(String(call?.init?.body))).toEqual({
    currentPassword: "Temporary-Pass-1",
    newPassword: "Battery-Staple-7",
    refreshToken: "refresh-token",
  });
});

it("lets a signed-in user change their password from the header link", async () => {
  setSession(sessionFor("mis"));
  stubFetch(() =>
    jsonResponse(200, {
      user: {
        id: "66f000000000000000000001",
        role: "mis",
        name: "Test User",
        mustChangePassword: false,
      },
    }),
  );
  const user = userEvent.setup();
  renderApp("/home");

  await user.click(
    await screen.findByRole("link", { name: "Change password" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Change password" }),
  ).toBeInTheDocument();
  await fill(user, "old-password-1", "new-password-2");

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Your password was changed",
  );
  expect(screen.getByLabelText("Current password")).toHaveValue("");
});

it("blocks short, mismatched and unchanged passwords before any request", async () => {
  setSession(sessionFor("mis"));
  const calls = stubFetch(() => jsonResponse(500));
  const user = userEvent.setup();
  renderApp("/account/password");
  await screen.findByRole("heading", { name: "Change password" });

  await fill(user, "old-password-1", "short");
  expect(
    await screen.findByText("The new password must be 8 to 200 characters."),
  ).toBeInTheDocument();

  await user.clear(screen.getByLabelText("New password"));
  await user.clear(screen.getByLabelText("Confirm new password"));
  await user.type(screen.getByLabelText("New password"), "long-enough-1");
  await user.type(screen.getByLabelText("Confirm new password"), "different-1");
  await user.click(screen.getByRole("button", { name: "Change password" }));
  expect(
    await screen.findByText("The two new passwords do not match."),
  ).toBeInTheDocument();

  await user.clear(screen.getByLabelText("New password"));
  await user.clear(screen.getByLabelText("Confirm new password"));
  await user.type(screen.getByLabelText("New password"), "old-password-1");
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "old-password-1",
  );
  await user.click(screen.getByRole("button", { name: "Change password" }));
  expect(
    await screen.findByText(
      "The new password must be different from the current password.",
    ),
  ).toBeInTheDocument();

  expect(calls).toHaveLength(0);
});

it("shows a wrong current password as a field error and keeps the session", async () => {
  setSession(sessionFor("mis"));
  stubFetch(() =>
    jsonResponse(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: { currentPassword: "Current password is not correct" },
      },
    }),
  );
  const user = userEvent.setup();
  renderApp("/account/password");
  await screen.findByRole("heading", { name: "Change password" });
  await fill(user, "wrong-password", "new-password-2");

  expect(
    await screen.findByText("The current password is not correct."),
  ).toBeInTheDocument();
  expect(getSnapshot()).not.toBeNull();
  expect(
    screen.getByRole("heading", { name: "Change password" }),
  ).toBeInTheDocument();
});

it("shows a retry message when the server rate-limits the attempt", async () => {
  setSession(sessionFor("mis"));
  stubFetch(() =>
    jsonResponse(429, {
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    }),
  );
  const user = userEvent.setup();
  renderApp("/account/password");
  await screen.findByRole("heading", { name: "Change password" });
  await fill(user, "old-password-1", "new-password-2");

  expect(
    await screen.findByText(
      "Too many attempts. Wait a few minutes, then try again.",
    ),
  ).toBeInTheDocument();
});

it("shows the server message for other failures and never stores the password", async () => {
  setSession(sessionFor("mis"));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  stubFetch(() =>
    jsonResponse(500, {
      error: { code: "INTERNAL", message: "Something went wrong" },
    }),
  );
  const user = userEvent.setup();
  renderApp("/account/password");
  await screen.findByRole("heading", { name: "Change password" });
  await fill(user, "old-password-1", "new-password-2");

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"),
  );
  expect(setItem).not.toHaveBeenCalled();
});

it("keeps the sign-out button on the gate", async () => {
  setSession(sessionFor("mis", { mustChangePassword: true }));
  renderApp("/change-password");
  expect(
    await screen.findByRole("button", { name: "Sign out" }),
  ).toBeInTheDocument();
});
