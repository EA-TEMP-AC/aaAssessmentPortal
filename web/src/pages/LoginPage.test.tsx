import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { getSnapshot } from "../api/session";
import { renderApp } from "../test/render";
import { jsonResponse, loginSuccessBody } from "../test/fixtures";

beforeEach(() => {
  vi.spyOn(Storage.prototype, "setItem");
});

async function signIn(password = "secret-password") {
  const user = userEvent.setup();
  renderApp("/login");
  await user.type(screen.getByLabelText("Email"), "admin@aa.example");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

it("signs in and keeps the access token in memory", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/auth/logout")) return jsonResponse(204);
      return jsonResponse(200, loginSuccessBody);
    }),
  );

  const user = await signIn();

  expect(await screen.findByRole("heading", { name: "AA admin" })).toBeInTheDocument();
  expect(getSnapshot()?.accessToken).toBe("access-token");
  expect(getSnapshot()?.refreshToken).toBe("refresh-token");
  expect(Storage.prototype.setItem).not.toHaveBeenCalled();

  const loginCall = calls[0];
  expect(loginCall?.url).toBe("/api/v1/auth/login");
  expect(new Headers(loginCall?.init?.headers).get("Authorization")).toBeNull();
  const body = JSON.parse(String(loginCall?.init?.body)) as {
    email: string;
    password: string;
    device: { platform: string; appVersion: string; deviceId: string };
  };
  expect(body.email).toBe("admin@aa.example");
  expect(body.password).toBe("secret-password");
  expect(body.device.platform).toBe("web");
  expect(body.device.appVersion).toBe("0.0.1");
  expect(body.device.deviceId.length).toBeGreaterThan(0);

  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(getSnapshot()).toBeNull();

  const logoutCall = calls.find((call) => call.url.endsWith("/auth/logout"));
  expect(JSON.parse(String(logoutCall?.init?.body))).toEqual({ refreshToken: "refresh-token" });
});

it("shows the contract error message when sign-in fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
      }),
    ),
  );

  await signIn("wrong-password");

  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(getSnapshot()).toBeNull();
});

it("sends a user who must change their password to the gate", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(200, {
        ...loginSuccessBody,
        user: { ...loginSuccessBody.user, mustChangePassword: true },
      }),
    ),
  );

  await signIn();

  expect(await screen.findByRole("heading", { name: "Password change required" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
});
