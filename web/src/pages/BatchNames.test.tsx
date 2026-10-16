import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearSession, setSession } from "../api/session";
import {
  IDS,
  batchRecord,
  emptyMasterList,
  listBody,
} from "../test/batchFixtures";
import { jsonResponse, sessionFor } from "../test/fixtures";
import { renderApp } from "../test/render";

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

function serve(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith(`/batches/${IDS.batch}`))
        return jsonResponse(200, body);
      if (url.pathname.endsWith("/batches"))
        return jsonResponse(200, listBody([batchRecord()]));
      if (url.pathname.endsWith("/candidates"))
        return jsonResponse(200, { items: [] });
      if (url.pathname.endsWith("/tests"))
        return jsonResponse(200, {
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
        });
      if (url.pathname.includes("/attempts"))
        return jsonResponse(200, {
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
        });
      return jsonResponse(200, emptyMasterList());
    }),
  );
}

it("shows names instead of ids on the batch page, and the id when no name came", async () => {
  serve({
    ...batchRecord(),
    names: {
      abName: "Skill Council of Electronics",
      qualificationName: "ELE/Q0001 Field Technician",
      tpName: "Asha Training Partner",
      centreName: null,
      assessorName: "Ravi Kumar",
      proctorName: null,
    },
  });
  setSession(sessionFor("aa_admin"));
  renderApp(`/batches/${IDS.batch}`);
  expect(
    await screen.findByText("Skill Council of Electronics"),
  ).toBeInTheDocument();
  expect(screen.getByText("ELE/Q0001 Field Technician")).toBeInTheDocument();
  expect(screen.getByText("Asha Training Partner")).toBeInTheDocument();
  expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
  // No centre name came, so the stored id stays visible rather than a blank.
  expect(screen.getByText(batchRecord().centreId)).toBeInTheDocument();
});
