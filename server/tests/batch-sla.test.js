import { slaDueAtCreation } from "../src/modules/batches/batch-sla.js";

const emptyCalendar = { weekendDays: [6, 0], holidays: [] };

const example = {
  assessmentStartDate: "2026-11-20",
  assessmentEndDate: "2026-11-21",
  allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
  calendar: emptyCalendar,
};

describe("batch SLA due instants", () => {
  it("stores the contract STT example at create", async () => {
    const sla = await slaDueAtCreation({ type: "STT", ...example });

    expect(sla.acceptDueAt.toISOString()).toBe("2026-10-12T18:29:59.999Z");
    expect(sla.assignDueAt.toISOString()).toBe("2026-10-19T18:29:59.999Z");
    expect(sla.resultDueAt.toISOString()).toBe("2026-11-25T18:29:59.999Z");
  });

  it("stores the contract LTT dues for the same dates", async () => {
    const sla = await slaDueAtCreation({ type: "LTT", ...example });

    expect(sla.acceptDueAt.toISOString()).toBe("2026-10-12T18:29:59.999Z");
    expect(sla.assignDueAt.toISOString()).toBe("2026-10-09T18:29:59.999Z");
    expect(sla.resultDueAt.toISOString()).toBe("2026-11-27T18:29:59.999Z");
  });

  it("moves accept and STT assign due when the next working day is a holiday", async () => {
    const sla = await slaDueAtCreation({
      type: "STT",
      ...example,
      calendar: {
        weekendDays: [6, 0],
        holidays: [{ date: "2026-10-09", region: null }],
      },
    });
    expect(sla.acceptDueAt.toISOString()).toBe("2026-10-13T18:29:59.999Z");
    expect(sla.assignDueAt.toISOString()).toBe("2026-10-20T18:29:59.999Z");
    expect(sla.resultDueAt.toISOString()).toBe("2026-11-25T18:29:59.999Z");
  });
});
