import { afterEach, expect, it, vi } from "vitest";
import {
  createProctoringSession,
  parseProctorConfig,
} from "./proctoringSession";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps only valid severities from the server config", () => {
  const config = parseProctorConfig({
    flagSeverity: { phone_detected: "high", tab_hidden: "loud" },
  });
  expect(config.flagSeverity).toEqual({ phone_detected: "high" });
});

it("leaves flagSeverity out when the server sent none", () => {
  expect("flagSeverity" in parseProctorConfig({})).toBe(false);
});

it("reads captureLocation from the session, false unless it is exactly true", async () => {
  for (const [sent, expected] of [
    [true, true],
    [false, false],
    ["yes", false],
    [undefined, false],
  ] as const) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "s1",
              status: "active",
              config: {},
              captureLocation: sent,
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    expect((await createProctoringSession("a1")).captureLocation).toBe(
      expected,
    );
  }
});
