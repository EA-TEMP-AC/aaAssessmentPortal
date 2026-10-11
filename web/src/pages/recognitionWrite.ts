import { isSectorName, isStateName, SECTOR_NAMES, STATE_NAMES, type SectorName, type StateName } from "../api/annexure";
import { isIsoDate, type Recognition, type RecognitionWrite } from "../api/recognition";

export type RecognitionDraft = {
  sectors: string[];
  panIndia: boolean;
  states: string[];
  startDate: string;
  endDate: string;
};

export type RecognitionResult = { ok: true; body: RecognitionWrite } | { ok: false; message: string; fields: string[] };

export function emptyRecognitionDraft(): RecognitionDraft {
  return { sectors: [], panIndia: false, states: [], startDate: "", endDate: "" };
}

export function recognitionDraftFromRecord(record: Recognition): RecognitionDraft {
  return {
    sectors: [...record.sectors],
    panIndia: record.panIndia,
    states: record.panIndia ? [] : [...record.states],
    startDate: record.startDate,
    endDate: record.endDate,
  };
}

export function recognitionFieldOrder(draft: RecognitionDraft): string[] {
  return draft.panIndia ? ["sectors", "startDate", "endDate"] : ["sectors", "states", "startDate", "endDate"];
}

function fail(messages: string[], fields: string[]): RecognitionResult {
  return { ok: false, message: messages.join(" "), fields };
}

function chosen<T extends string>(selected: readonly string[], catalog: readonly T[], isName: (value: string) => value is T): T[] {
  return catalog.filter((name) => selected.includes(name) && isName(name));
}

export function buildRecognition(draft: RecognitionDraft): RecognitionResult {
  const messages: string[] = [];
  const fields: string[] = [];
  const sectors: SectorName[] = chosen(draft.sectors, SECTOR_NAMES, isSectorName);
  const states: StateName[] = draft.panIndia ? [] : chosen(draft.states, STATE_NAMES, isStateName);

  if (sectors.length === 0) {
    messages.push("Choose at least one recognised sector.");
    fields.push("sectors");
  }
  if (!draft.panIndia && states.length === 0) {
    messages.push("Choose at least one state, or choose PAN India.");
    fields.push("states");
  }
  if (!isIsoDate(draft.startDate)) {
    messages.push("Enter a start date.");
    fields.push("startDate");
  }
  if (!isIsoDate(draft.endDate)) {
    messages.push("Enter an end date.");
    fields.push("endDate");
  }
  if (isIsoDate(draft.startDate) && isIsoDate(draft.endDate) && draft.endDate < draft.startDate) {
    messages.push("The end date must be on or after the start date.");
    fields.push("endDate");
  }
  if (messages.length > 0) return fail(messages, fields);
  return {
    ok: true,
    body: {
      sectors,
      panIndia: draft.panIndia,
      states,
      startDate: draft.startDate,
      endDate: draft.endDate,
    },
  };
}
