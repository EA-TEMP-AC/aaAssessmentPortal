import { isSectorName, type SectorName } from "../../api/annexure";
import type {
  BatchType,
  ComponentMarks,
  NosWrite,
  PassCriteriaMode,
  PassMarkUnit,
  PcWrite,
  Qualification,
  QualificationWrite,
  RatioClass,
} from "../../api/masterData";
import { isRatioClass } from "../../api/masterData";

/**
 * Mirrors server/src/config/compliance.js and pass-marks.js.
 * The form explains a problem before submit. The server remains the authority.
 */
export const PASS_MARK_MIN = 0;
export const PASS_MARK_PERCENT_MAX = 100;

const MARKS = ["theory", "practical", "viva"] as const;
type MarkName = (typeof MARKS)[number];

const MARK_LABEL: Record<MarkName, string> = {
  theory: "Theory",
  practical: "Practical",
  viva: "Viva",
};

export type MarkDraft = Record<MarkName, string>;

export type PcDraft = {
  key: string;
  pcId: string;
  code: string;
  name: string;
  passMark: string;
  maxMark: string;
};

export type NosDraft = {
  key: string;
  nosId: string;
  code: string;
  name: string;
  maxMarks: MarkDraft;
  pcs: PcDraft[];
};

export type QualificationDraft = {
  code: string;
  name: string;
  sector: SectorName | "";
  ratioClass: RatioClass | "";
  defaultBatchType: BatchType | "";
  passCriteriaMode: PassCriteriaMode | "";
  passMarkUnit: PassMarkUnit;
  passMarks: MarkDraft;
  maxMarks: MarkDraft;
  pcPassMarksRequired: boolean;
  nos: NosDraft[];
};

export type FormFailure = { ok: false; message: string; fields: string[] };
export type FormSuccess = { ok: true; body: QualificationWrite };

function blankMarks(): MarkDraft {
  return { theory: "", practical: "", viva: "" };
}

export function blankPc(key: string): PcDraft {
  return { key, pcId: "", code: "", name: "", passMark: "", maxMark: "" };
}

export function blankNos(key: string): NosDraft {
  return { key, nosId: "", code: "", name: "", maxMarks: blankMarks(), pcs: [] };
}

export function emptyQualificationDraft(): QualificationDraft {
  return {
    code: "",
    name: "",
    sector: "",
    ratioClass: "",
    defaultBatchType: "",
    passCriteriaMode: "",
    passMarkUnit: "percent",
    passMarks: blankMarks(),
    maxMarks: blankMarks(),
    pcPassMarksRequired: false,
    nos: [],
  };
}

function markText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function marksFrom(value: ComponentMarks | null | undefined): MarkDraft {
  return {
    theory: markText(value?.theory),
    practical: markText(value?.practical),
    viva: markText(value?.viva),
  };
}

export function qualificationDraftFromRecord(record: Qualification, nextKey: () => string): QualificationDraft {
  return {
    code: record.code,
    name: record.name,
    sector: record.sector,
    ratioClass: record.ratioClass,
    defaultBatchType: record.defaultBatchType ?? "",
    passCriteriaMode: record.passCriteriaMode ?? "",
    passMarkUnit: record.passMarkUnit,
    passMarks: {
      theory: markText(record.passMarks.theory),
      practical: markText(record.passMarks.practical),
      viva: markText(record.passMarks.viva),
    },
    maxMarks: marksFrom(record.maxMarks),
    pcPassMarksRequired: record.pcPassMarksRequired,
    nos: record.nos.map((item) => ({
      key: nextKey(),
      nosId: item.nosId,
      code: item.code,
      name: item.name,
      maxMarks: marksFrom(item.maxMarks),
      pcs: item.pcs.map((pc) => ({
        key: nextKey(),
        pcId: pc.pcId,
        code: pc.code,
        name: pc.name,
        passMark: markText(pc.passMark),
        maxMark: markText(pc.maxMark),
      })),
    })),
  };
}

export function qualificationFieldOrder(draft: QualificationDraft): string[] {
  const fields = [
    "code",
    "name",
    "sector",
    "ratioClass",
    "defaultBatchType",
    "passCriteriaMode",
    "passMarkUnit",
    "passMarks.theory",
    "passMarks.practical",
    "passMarks.viva",
    "maxMarks.theory",
    "maxMarks.practical",
    "maxMarks.viva",
  ];
  draft.nos.forEach((item, nosIndex) => {
    fields.push(
      `nos.${nosIndex}.nosId`,
      `nos.${nosIndex}.code`,
      `nos.${nosIndex}.name`,
      `nos.${nosIndex}.maxMarks.theory`,
      `nos.${nosIndex}.maxMarks.practical`,
      `nos.${nosIndex}.maxMarks.viva`,
    );
    item.pcs.forEach((_, pcIndex) => {
      fields.push(
        `nos.${nosIndex}.pcs.${pcIndex}.pcId`,
        `nos.${nosIndex}.pcs.${pcIndex}.code`,
        `nos.${nosIndex}.pcs.${pcIndex}.name`,
        `nos.${nosIndex}.pcs.${pcIndex}.passMark`,
        `nos.${nosIndex}.pcs.${pcIndex}.maxMark`,
      );
    });
  });
  return fields;
}

export function formFieldForServerPath(path: string, draft: QualificationDraft): string | null {
  if (/^(passMarks|maxMarks)\.(theory|practical|viva)$/.test(path)) return path;
  const nosMax = /^nos\.([^.]+)\.maxMarks\.(theory|practical|viva)$/.exec(path);
  if (nosMax) {
    const index = draft.nos.findIndex((item) => item.code.trim() === nosMax[1]);
    return index < 0 ? null : `nos.${index}.maxMarks.${nosMax[2]}`;
  }
  const pc = /^nos\.([^.]+)\.pcs\.([^.]+)\.(passMark|maxMark)$/.exec(path);
  if (pc) {
    const nosIndex = draft.nos.findIndex((item) => item.code.trim() === pc[1]);
    if (nosIndex < 0) return null;
    const pcIndex = draft.nos[nosIndex]?.pcs.findIndex((item) => item.code.trim() === pc[2]) ?? -1;
    return pcIndex < 0 ? null : `nos.${nosIndex}.pcs.${pcIndex}.${pc[3]}`;
  }
  return null;
}

type ParsedMark = { empty: true } | { empty: false; value: number } | { invalid: true };

function parseMark(value: string): ParsedMark {
  const trimmed = value.trim();
  if (!trimmed) return { empty: true };
  if (!/^-?(?:\d+\.\d+|\d+)$/.test(trimmed)) return { invalid: true };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { invalid: true };
  return { empty: false, value: parsed };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

type PassProblem = { message: string; field: string };

function problem(message: string, field: string): PassProblem {
  return { message, field };
}

/** Same checks as server findPassMarkProblem. A qualification pass mark is not compared to a NOS max. */
export function findPassMarkProblem(doc: {
  passMarkUnit: PassMarkUnit;
  passMarks: { theory: number; practical: number; viva: number };
  maxMarks: ComponentMarks | null;
  nos: NosWrite[];
  pcPassMarksRequired: boolean;
}): PassProblem | null {
  const unit = doc.passMarkUnit;
  const maxMarks = doc.maxMarks;
  const nos = doc.nos;

  for (const component of MARKS) {
    const passValue = doc.passMarks[component];
    const label = `passMarks.${component}`;
    if (!finite(passValue) || passValue < PASS_MARK_MIN) {
      return problem(`${label} must be at least ${PASS_MARK_MIN}`, label);
    }
    if (unit === "percent" && passValue > PASS_MARK_PERCENT_MAX) {
      return problem(`${label} must be at most ${PASS_MARK_PERCENT_MAX} when passMarkUnit is percent`, label);
    }

    const qualMax = maxMarks ? maxMarks[component] : null;
    if (qualMax != null) {
      if (!finite(qualMax) || qualMax < PASS_MARK_MIN) {
        return problem(`maxMarks.${component} must be at least ${PASS_MARK_MIN}`, `maxMarks.${component}`);
      }
      if (unit === "absolute" && passValue > qualMax) {
        return problem(`${label} exceeds maxMarks.${component}`, label);
      }
    }

    if (unit === "absolute" && qualMax == null) {
      if (nos.length === 0) {
        return problem(`${label} needs maxMarks.${component} or a max mark on every NOS`, label);
      }
      for (const item of nos) {
        const nosMax = item.maxMarks ? item.maxMarks[component] : null;
        if (!finite(nosMax)) {
          return problem(`NOS ${item.code} is missing maxMarks.${component}`, `nos.${item.code}.maxMarks.${component}`);
        }
      }
    }

    for (const item of nos) {
      if (!item.maxMarks || item.maxMarks[component] == null) continue;
      const nosMax = item.maxMarks[component];
      if (!finite(nosMax) || nosMax < PASS_MARK_MIN) {
        return problem(
          `NOS ${item.code} maxMarks.${component} must be at least ${PASS_MARK_MIN}`,
          `nos.${item.code}.maxMarks.${component}`,
        );
      }
    }
  }

  for (const item of nos) {
    for (const pc of item.pcs) {
      const field = `nos.${item.code}.pcs.${pc.code}.passMark`;
      if (doc.pcPassMarksRequired && !finite(pc.passMark)) {
        return problem(`PC ${pc.code} requires passMark`, field);
      }
      if (pc.passMark != null && !finite(pc.passMark)) {
        return problem(`PC ${pc.code} passMark must be a number`, field);
      }
      if (finite(pc.passMark) && pc.passMark < PASS_MARK_MIN) {
        return problem(`PC ${pc.code} passMark must be at least ${PASS_MARK_MIN}`, field);
      }
      if (unit === "percent" && finite(pc.passMark) && pc.passMark > PASS_MARK_PERCENT_MAX) {
        return problem(
          `PC ${pc.code} passMark must be at most ${PASS_MARK_PERCENT_MAX} when passMarkUnit is percent`,
          field,
        );
      }
      if (pc.maxMark != null && (!finite(pc.maxMark) || pc.maxMark < PASS_MARK_MIN)) {
        return problem(`PC ${pc.code} maxMark must be at least ${PASS_MARK_MIN}`, `nos.${item.code}.pcs.${pc.code}.maxMark`);
      }
      if (unit === "absolute" && finite(pc.passMark)) {
        if (!finite(pc.maxMark)) {
          return problem(`PC ${pc.code} needs maxMark when passMarkUnit is absolute`, field);
        }
        if (pc.passMark > pc.maxMark) {
          return problem(`PC ${pc.code} passMark exceeds maxMark`, field);
        }
      }
    }
  }

  return null;
}

function fail(messages: string[], fields: string[]): FormFailure {
  return { ok: false, message: messages.join(" "), fields };
}

function lengthError(value: string, max: number, label: string, field: string, messages: string[], fields: string[]) {
  if (value.length > max) {
    messages.push(`${label} must be ${max} characters or fewer.`);
    fields.push(field);
  }
}

export function buildQualification(draft: QualificationDraft, mode: "create" | "edit"): FormSuccess | FormFailure {
  const messages: string[] = [];
  const fields: string[] = [];
  const code = draft.code.trim();
  const name = draft.name.trim();
  if (!code) {
    messages.push("Code is required.");
    fields.push("code");
  } else lengthError(code, 64, "Code", "code", messages, fields);
  if (!name) {
    messages.push("Name is required.");
    fields.push("name");
  } else lengthError(name, 200, "Name", "name", messages, fields);
  if (!isSectorName(draft.sector)) {
    messages.push("Choose a sector.");
    fields.push("sector");
  }
  if (!isRatioClass(draft.ratioClass)) {
    messages.push("Choose a ratio class.");
    fields.push("ratioClass");
  }

  const passMarks = { theory: 0, practical: 0, viva: 0 };
  for (const component of MARKS) {
    const parsed = parseMark(draft.passMarks[component]);
    const field = `passMarks.${component}`;
    if ("invalid" in parsed || parsed.empty) {
      messages.push(`${MARK_LABEL[component]} pass mark must be a number.`);
      fields.push(field);
    } else passMarks[component] = parsed.value;
  }

  let anyMax = false;
  const maxMarks: ComponentMarks = { theory: null, practical: null, viva: null };
  for (const component of MARKS) {
    const parsed = parseMark(draft.maxMarks[component]);
    if ("invalid" in parsed) {
      messages.push(`${MARK_LABEL[component]} max mark must be a number.`);
      fields.push(`maxMarks.${component}`);
    } else if (!parsed.empty) {
      anyMax = true;
      maxMarks[component] = parsed.value;
    }
  }

  const nos: NosWrite[] = [];
  draft.nos.forEach((item, nosIndex) => {
    const nosId = item.nosId.trim();
    const nosCode = item.code.trim();
    const nosName = item.name.trim();
    const idField = `nos.${nosIndex}.nosId`;
    const codeField = `nos.${nosIndex}.code`;
    const nameField = `nos.${nosIndex}.name`;
    if (!nosId) {
      messages.push(`NOS ${nosIndex + 1} id is required.`);
      fields.push(idField);
    } else lengthError(nosId, 64, `NOS ${nosIndex + 1} id`, idField, messages, fields);
    if (!nosCode) {
      messages.push(`NOS ${nosIndex + 1} code is required.`);
      fields.push(codeField);
    } else lengthError(nosCode, 64, `NOS ${nosIndex + 1} code`, codeField, messages, fields);
    if (!nosName) {
      messages.push(`NOS ${nosIndex + 1} name is required.`);
      fields.push(nameField);
    } else lengthError(nosName, 200, `NOS ${nosIndex + 1} name`, nameField, messages, fields);

    let anyNosMax = false;
    const nosMax: ComponentMarks = { theory: null, practical: null, viva: null };
    for (const component of MARKS) {
      const parsed = parseMark(item.maxMarks[component]);
      const field = `nos.${nosIndex}.maxMarks.${component}`;
      if ("invalid" in parsed) {
        messages.push(`NOS ${nosIndex + 1} ${MARK_LABEL[component].toLowerCase()} max mark must be a number.`);
        fields.push(field);
      } else if (!parsed.empty) {
        anyNosMax = true;
        nosMax[component] = parsed.value;
      }
    }

    const pcs: PcWrite[] = [];
    item.pcs.forEach((pc, pcIndex) => {
      const pcId = pc.pcId.trim();
      const pcCode = pc.code.trim();
      const pcName = pc.name.trim();
      const pcIdField = `nos.${nosIndex}.pcs.${pcIndex}.pcId`;
      const pcCodeField = `nos.${nosIndex}.pcs.${pcIndex}.code`;
      const pcNameField = `nos.${nosIndex}.pcs.${pcIndex}.name`;
      if (!pcId) {
        messages.push(`Performance criterion ${pcIndex + 1} on NOS ${nosIndex + 1} needs an id.`);
        fields.push(pcIdField);
      } else lengthError(pcId, 64, `Performance criterion ${pcIndex + 1} id`, pcIdField, messages, fields);
      if (!pcCode) {
        messages.push(`Performance criterion ${pcIndex + 1} on NOS ${nosIndex + 1} needs a code.`);
        fields.push(pcCodeField);
      } else lengthError(pcCode, 64, `Performance criterion ${pcIndex + 1} code`, pcCodeField, messages, fields);
      if (!pcName) {
        messages.push(`Performance criterion ${pcIndex + 1} on NOS ${nosIndex + 1} needs a name.`);
        fields.push(pcNameField);
      } else lengthError(pcName, 200, `Performance criterion ${pcIndex + 1} name`, pcNameField, messages, fields);

      const pass = parseMark(pc.passMark);
      const max = parseMark(pc.maxMark);
      const written: PcWrite = { pcId, code: pcCode, name: pcName };
      if ("invalid" in pass) {
        messages.push(`Performance criterion ${pcIndex + 1} pass mark must be a number.`);
        fields.push(`nos.${nosIndex}.pcs.${pcIndex}.passMark`);
      } else if (!pass.empty) written.passMark = pass.value;
      if ("invalid" in max) {
        messages.push(`Performance criterion ${pcIndex + 1} max mark must be a number.`);
        fields.push(`nos.${nosIndex}.pcs.${pcIndex}.maxMark`);
      } else if (!max.empty) written.maxMark = max.value;
      pcs.push(written);
    });

    const writtenNos: NosWrite = { nosId, code: nosCode, name: nosName, pcs };
    if (anyNosMax) writtenNos.maxMarks = nosMax;
    nos.push(writtenNos);
  });

  if (messages.length > 0 || !isSectorName(draft.sector) || !isRatioClass(draft.ratioClass)) return fail(messages, fields);
  const sector = draft.sector;
  const ratioClass = draft.ratioClass;

  const nosIds = new Map<string, number>();
  const nosCodes = new Map<string, number>();
  const pcIds = new Map<string, string>();
  draft.nos.forEach((item, nosIndex) => {
    const nosId = item.nosId.trim();
    const nosCode = item.code.trim();
    if (nosIds.has(nosId)) {
      messages.push("nosId values must be unique.");
      fields.push(`nos.${nosIndex}.nosId`);
    } else nosIds.set(nosId, nosIndex);
    if (nosCodes.has(nosCode)) {
      messages.push("NOS codes must be unique.");
      fields.push(`nos.${nosIndex}.code`);
    } else nosCodes.set(nosCode, nosIndex);

    const pcCodes = new Map<string, number>();
    item.pcs.forEach((pc, pcIndex) => {
      const pcId = pc.pcId.trim();
      const pcCode = pc.code.trim();
      if (pcIds.has(pcId)) {
        messages.push("pcId values must be unique.");
        fields.push(`nos.${nosIndex}.pcs.${pcIndex}.pcId`);
      } else pcIds.set(pcId, pcId);
      if (pcCodes.has(pcCode)) {
        messages.push("Duplicate PC code in this NOS.");
        fields.push(`nos.${nosIndex}.pcs.${pcIndex}.code`);
      } else pcCodes.set(pcCode, pcIndex);
    });
  });
  if (messages.length > 0) return fail(messages, fields);

  const body: QualificationWrite = {
    code,
    name,
    sector,
    ratioClass,
    passMarkUnit: draft.passMarkUnit,
    passMarks,
    nos,
    pcPassMarksRequired: draft.pcPassMarksRequired,
  };
  if (draft.defaultBatchType) body.defaultBatchType = draft.defaultBatchType;
  else if (mode === "edit") body.defaultBatchType = null;
  if (draft.passCriteriaMode) body.passCriteriaMode = draft.passCriteriaMode;
  else if (mode === "edit") body.passCriteriaMode = null;
  if (anyMax) body.maxMarks = maxMarks;
  else if (mode === "edit") body.maxMarks = null;

  const found = findPassMarkProblem({
    passMarkUnit: body.passMarkUnit,
    passMarks: body.passMarks,
    maxMarks: body.maxMarks === undefined ? null : body.maxMarks,
    nos: body.nos,
    pcPassMarksRequired: body.pcPassMarksRequired,
  });
  if (found) {
    const field = formFieldForServerPath(found.field, draft);
    return { ok: false, message: found.message, fields: field ? [field] : [] };
  }
  return { ok: true, body };
}
