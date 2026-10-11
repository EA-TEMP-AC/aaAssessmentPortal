import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { apiRequest } from "../api/client";
import { setSession } from "../api/session";
import { AuthBridge } from "../routing/guards";
import { jsonResponse, loginSuccessBody, sessionFor } from "../test/fixtures";

function HealthProbe() {
  const [label, setLabel] = useState("loading");

  useEffect(() => {
    let active = true;
    apiRequest<{ status: string }>("/health")
      .then((body) => {
        if (active) setLabel(body.status);
      })
      .catch(() => {
        if (active) setLabel("failed");
      });
    return () => {
      active = false;
    };
  }, []);

  return <p>{label}</p>;
}

function renderProbe() {
  setSession(sessionFor("aa_admin"));
  return render(
    <MemoryRouter
      initialEntries={["/probe"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthBridge />
      <Routes>
        <Route path="/probe" element={<HealthProbe />} />
        <Route path="/login" element={<h1>Sign in</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

it("refreshes once after a 401 and retries the request", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/refresh")) {
      return jsonResponse(200, {
        ...loginSuccessBody,
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });
    }
    const authorization = new Headers(init?.headers).get("Authorization");
    if (authorization === "Bearer new-access") {
      return jsonResponse(200, { status: "ok" });
    }
    return jsonResponse(401, {
      error: { code: "UNAUTHORIZED", message: "Missing or invalid access token" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderProbe();

  expect(await screen.findByText("ok")).toBeInTheDocument();
  const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/auth/refresh"));
  const healthCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/health"));
  expect(refreshCalls).toHaveLength(1);
  expect(healthCalls).toHaveLength(2);
  expect(JSON.parse(String(refreshCalls[0]?.[1]?.body))).toMatchObject({
    refreshToken: "refresh-token",
    device: { deviceId: "dev-test", platform: "web", appVersion: "0.0.1" },
  });
  expect(new Headers(healthCalls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer new-access");
});

it("redirects to sign in when refresh fails, and does not refresh twice", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/refresh")) {
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Invalid refresh token" },
      });
    }
    return jsonResponse(401, {
      error: { code: "UNAUTHORIZED", message: "Missing or invalid access token" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderProbe();

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/auth/refresh"));
  const healthCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/health"));
  expect(refreshCalls).toHaveLength(1);
  expect(healthCalls).toHaveLength(1);
});

it("redirects to sign in when the retried request is still unauthorized", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/refresh")) {
      return jsonResponse(200, {
        ...loginSuccessBody,
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });
    }
    return jsonResponse(401, {
      error: { code: "UNAUTHORIZED", message: "Missing or invalid access token" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderProbe();

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/auth/refresh"));
  const healthCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/health"));
  expect(refreshCalls).toHaveLength(1);
  expect(healthCalls).toHaveLength(2);
});
