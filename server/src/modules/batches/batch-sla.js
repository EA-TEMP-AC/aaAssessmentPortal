import { compliance } from "../../config/compliance.js";
import {
  acceptDueAt,
  assignDueAt,
  loadWorkingCalendar,
  resultDueAt,
} from "../../lib/working-days.js";

/**
 * Due instants for a new batch. NCVET:FR §F. docs/SCHEMA.md §2.1 and §2.2.
 * `before_exam` and the result anchors that are calendar dates are known at creation.
 * `from_acceptance` leaves assignDueAt empty until accept.
 * `assessment_completed` leaves resultDueAt empty until complete.
 * Stored values are not recomputed when holidays change.
 *
 * @param {{
 *   type: "STT"|"LTT",
 *   assessmentStartDate: string,
 *   assessmentEndDate: string,
 *   allocatedAt: Date,
 *   mode?: string,
 *   anchor?: string,
 *   calendar?: object,
 * }} input
 */
export async function slaDueAtCreation(input) {
  const mode = input.mode ?? compliance.ASSIGN_SLA_MODE;
  const anchor = input.anchor ?? compliance.RESULT_SLA_ANCHOR;
  const calendar = input.calendar ?? (await loadWorkingCalendar());

  const acceptDue = await acceptDueAt(input.allocatedAt, calendar);
  let assignDue = null;
  if (mode === "before_exam") {
    assignDue = await assignDueAt(
      { type: input.type, mode: "before_exam", assessmentStartDate: input.assessmentStartDate },
      calendar,
    );
  }

  let resultDue = null;
  if (anchor === "assessment_end_date" || anchor === "assessment_start_date") {
    resultDue = await resultDueAt(
      {
        type: input.type,
        anchor,
        assessmentEndDate: input.assessmentEndDate,
        assessmentStartDate: input.assessmentStartDate,
      },
      calendar,
    );
  }

  return { acceptDueAt: acceptDue, assignDueAt: assignDue, resultDueAt: resultDue };
}

/**
 * Assign due when ASSIGN_SLA_MODE is `from_acceptance`.
 * Returns null when the mode is `before_exam` or a due instant is already stored.
 */
export async function assignDueAfterAccept({ mode, type, acceptedAt, already, calendar }) {
  if (mode !== "from_acceptance" || already) return null;
  return assignDueAt({ type, mode: "from_acceptance", acceptedAt }, calendar);
}

/**
 * Result due when RESULT_SLA_ANCHOR is `assessment_completed`.
 * Returns null for the calendar-date anchors (those are set at creation).
 */
export async function resultDueAfterComplete({ anchor, type, completedAt, already, calendar }) {
  if (anchor !== "assessment_completed" || already) return null;
  return resultDueAt(
    { type, anchor: "assessment_completed", assessmentCompletedAt: completedAt },
    calendar,
  );
}
