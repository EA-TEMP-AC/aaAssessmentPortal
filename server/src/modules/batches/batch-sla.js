import {
  acceptDueAt,
  assignDueAt,
  loadWorkingCalendar,
  resultDueAt,
} from "../../lib/working-days.js";

/**
 * Due instants for a new batch. Guidelines Table 7; NCVET:FR §F.
 * docs/SCHEMA.md §2.1 and §2.3. Both assign and result dues are known at create.
 * Stored values are not recomputed when holidays change.
 *
 * @param {{
 *   type: "STT"|"LTT",
 *   assessmentStartDate: string,
 *   assessmentEndDate: string,
 *   allocatedAt: Date,
 *   calendar?: object,
 * }} input
 */
export async function slaDueAtCreation(input) {
  const calendar = input.calendar ?? (await loadWorkingCalendar());
  const acceptDue = await acceptDueAt(input.allocatedAt, calendar);
  const assignDue = await assignDueAt(
    {
      type: input.type,
      allocatedAt: input.allocatedAt,
      assessmentStartDate: input.assessmentStartDate,
    },
    calendar,
  );
  const resultDue = await resultDueAt(
    {
      type: input.type,
      assessmentEndDate: input.assessmentEndDate,
      assessmentStartDate: input.assessmentStartDate,
    },
    calendar,
  );

  return { acceptDueAt: acceptDue, assignDueAt: assignDue, resultDueAt: resultDue };
}
