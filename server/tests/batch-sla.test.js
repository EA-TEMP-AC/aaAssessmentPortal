import {
  assignDueAfterAccept,
  resultDueAfterComplete,
  slaDueAtCreation,
} from "../src/modules/batches/batch-sla.js";

const emptyCalendar = { weekendDays: [6, 0], holidays: [] };

describe("batch SLA due instants", () => {
  it("stores the contract example for an allocation on 8 Oct 2026", async () => {
    const sla = await slaDueAtCreation({
      type: "STT",
      assessmentStartDate: "2026-11-20",
      assessmentEndDate: "2026-11-21",
      allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
      calendar: emptyCalendar,
    });

    expect(sla.acceptDueAt.toISOString()).toBe("2026-10-12T18:29:59.999Z");
    expect(sla.assignDueAt.toISOString()).toBe("2026-11-11T18:29:59.999Z");
    expect(sla.resultDueAt.toISOString()).toBe("2026-11-25T18:29:59.999Z");
  });

  it("moves accept due when the next working day is a holiday", async () => {
    const sla = await slaDueAtCreation({
      type: "STT",
      assessmentStartDate: "2026-11-20",
      assessmentEndDate: "2026-11-21",
      allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
      calendar: {
        weekendDays: [6, 0],
        holidays: [{ date: "2026-10-09", region: null }],
      },
    });
    expect(sla.acceptDueAt.toISOString()).toBe("2026-10-13T18:29:59.999Z");
  });

  it("leaves assign and result empty for the alternate anchors until those events", async () => {
    const sla = await slaDueAtCreation({
      type: "STT",
      assessmentStartDate: "2026-11-20",
      assessmentEndDate: "2026-11-21",
      allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
      mode: "from_acceptance",
      anchor: "assessment_completed",
      calendar: emptyCalendar,
    });
    expect(sla.acceptDueAt.toISOString()).toBe("2026-10-12T18:29:59.999Z");
    expect(sla.assignDueAt).toBeNull();
    expect(sla.resultDueAt).toBeNull();

    const assign = await assignDueAfterAccept({
      mode: "from_acceptance",
      type: "STT",
      acceptedAt: new Date("2026-10-06T04:30:00.000Z"),
      already: null,
      calendar: emptyCalendar,
    });
    expect(assign.toISOString()).toBe("2026-10-15T18:29:59.999Z");
    expect(
      await assignDueAfterAccept({
        mode: "before_exam",
        type: "STT",
        acceptedAt: new Date("2026-10-06T04:30:00.000Z"),
        already: null,
        calendar: emptyCalendar,
      }),
    ).toBeNull();
    expect(
      await assignDueAfterAccept({
        mode: "from_acceptance",
        type: "STT",
        acceptedAt: new Date("2026-10-06T04:30:00.000Z"),
        already: assign,
        calendar: emptyCalendar,
      }),
    ).toBeNull();

    const result = await resultDueAfterComplete({
      anchor: "assessment_completed",
      type: "STT",
      completedAt: new Date("2026-10-06T04:30:00.000Z"),
      already: null,
      calendar: emptyCalendar,
    });
    expect(result.toISOString()).toBe("2026-10-09T18:29:59.999Z");
    expect(
      await resultDueAfterComplete({
        anchor: "assessment_end_date",
        type: "STT",
        completedAt: new Date("2026-10-06T04:30:00.000Z"),
        already: null,
        calendar: emptyCalendar,
      }),
    ).toBeNull();
  });
});
