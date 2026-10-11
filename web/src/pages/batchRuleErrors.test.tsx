import { cleanup, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { setSession } from "../api/session";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input), "http://localhost"), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("shows RULE_OUTSIDE_RECOGNITION on an existing list alert", async () => {
  installFetch(async () =>
    jsonResponse(409, {
      error: {
        code: "RULE_OUTSIDE_RECOGNITION",
        message: "Outside recognition",
        details: { checks: ["unconfigured", "sector"] },
      },
    }),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/users");

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("RULE_OUTSIDE_RECOGNITION");
  expect(alert).toHaveTextContent("Outside recognition");
  expect(alert).toHaveTextContent("Recognition has not been set up.");
  expect(alert).toHaveTextContent("The qualification sector is not a recognised sector.");
  expect(alert).toHaveTextContent("An AA admin can send an override reason when creating the batch.");
});

it("shows RULE_ASSESSOR_LANGUAGE on an existing master-data alert", async () => {
  cleanup();
  installFetch(async () =>
    jsonResponse(409, {
      error: { code: "RULE_ASSESSOR_LANGUAGE", message: "Language does not match" },
    }),
  );
  setSession(sessionFor("aa_admin"));
  renderApp("/master-data/qualifications");

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("RULE_ASSESSOR_LANGUAGE");
  expect(alert).toHaveTextContent("Language does not match");
  expect(alert).toHaveTextContent("The assessor's languages do not include this batch's assessment language.");
  expect(alert).toHaveTextContent("An AA admin can send an override reason when assigning the assessor.");
});
