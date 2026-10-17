import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { batchRecord } from "../../test/batchFixtures";
import { jsonResponse } from "../../test/fixtures";
import { TpSpocSection } from "./TpSpocSection";

afterEach(() => vi.unstubAllGlobals());

function show(
  role: Parameters<typeof TpSpocSection>[0]["role"],
  spoc?: { name: string; contact: string | null },
) {
  const batch = { ...batchRecord(), tpSpoc: spoc ?? null };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TpSpocSection batch={batch} role={role} />
    </QueryClientProvider>,
  );
  return batch;
}

it("shows the saved contact and lets the training partner save a new one (X-29)", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(200, {
        ...batchRecord(),
        tpSpoc: JSON.parse(String(init?.body)),
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  const batch = show("tp", { name: "Nitin Sharma", contact: null });
  expect(screen.getByText(/Nitin Sharma, no phone number/)).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Contact person name"));
  await user.type(screen.getByLabelText("Contact person name"), "Asha Rao");
  await user.type(
    screen.getByLabelText(/Contact phone number/),
    "+91 98765 43210",
  );
  await user.click(screen.getByRole("button", { name: "Save contact person" }));
  expect(await screen.findByText("Contact person saved.")).toBeInTheDocument();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(url)).toContain(`/batches/${batch.id}/tp-spoc`);
  expect(init.method).toBe("PUT");
  expect(JSON.parse(String(init.body))).toEqual({
    name: "Asha Rao",
    contact: "+91 98765 43210",
  });
});

it("checks the name and the number before sending anything", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  show("aa_admin");
  expect(
    screen.getByText("No contact person has been set for this batch."),
  ).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Contact phone number/), "12ab");
  await user.click(screen.getByRole("button", { name: "Save contact person" }));
  expect(
    screen.getByText("Enter the name of the contact person."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/phone number with 8 to 20 digits/),
  ).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
});

it("shows the contact but no form to roles that cannot change it", () => {
  vi.stubGlobal("fetch", vi.fn());
  show("assessor", { name: "Nitin Sharma", contact: "9876543210" });
  expect(screen.getByText(/Nitin Sharma, 9876543210/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save contact person" }),
  ).not.toBeInTheDocument();
});
