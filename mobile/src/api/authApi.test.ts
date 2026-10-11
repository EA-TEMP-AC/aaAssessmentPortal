import { describe, expect, it, jest } from "@jest/globals";
import { createAuthApi } from "./authApi";
import { device } from "../testing/fixtures";

function sessionJson(accessToken: string, refreshToken: string) {
  return {
    accessToken,
    refreshToken,
    expiresInMs: 900_000,
    offlineSessionMaxMs: 259_200_000,
    user: { id: "user-1", role: "assessor", name: "Asha", mustChangePassword: false },
  };
}

describe("auth API", () => {
  it("logs in and rotates the refresh token", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
      calls.push({ url, body });
      if (url.endsWith("/auth/login")) {
        return new Response(JSON.stringify(sessionJson("access-1", "refresh-1")), { status: 200 });
      }
      if (url.endsWith("/auth/refresh")) {
        return new Response(JSON.stringify(sessionJson("access-2", "refresh-2")), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });

    const api = createAuthApi({ baseUrl: "http://127.0.0.1:3000/api/v1", fetchImpl });
    const loggedIn = await api.login("asha@aa.example", "secret", device);
    const refreshed = await api.refresh(loggedIn.refreshToken, device);
    await api.logout(refreshed.refreshToken);

    expect(calls[0]?.url).toBe("http://127.0.0.1:3000/api/v1/auth/login");
    expect(calls[0]?.body).toEqual({
      email: "asha@aa.example",
      password: "secret",
      device,
    });
    expect(calls[1]?.url).toBe("http://127.0.0.1:3000/api/v1/auth/refresh");
    expect(calls[1]?.body).toEqual({ refreshToken: "refresh-1", device });
    expect(refreshed.accessToken).toBe("access-2");
    expect(refreshed.refreshToken).toBe("refresh-2");
    expect(calls[2]?.body).toEqual({ refreshToken: "refresh-2" });
  });
});
