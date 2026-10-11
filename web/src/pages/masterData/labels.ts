import type { BatchType, PassCriteriaMode, PassMarkUnit, Sector } from "../../api/masterData";

export const SECTOR_LABELS: Record<Sector, string> = {
  manufacturing: "Manufacturing",
  services: "Services",
  school_education: "School education",
  other: "Other",
};

export const BATCH_TYPE_LABELS: Record<BatchType, string> = {
  STT: "STT",
  LTT: "LTT",
};

export const PASS_CRITERIA_LABELS: Record<PassCriteriaMode, string> = {
  nos_wise: "NOS-wise",
  overall: "Overall",
};

export const PASS_UNIT_LABELS: Record<PassMarkUnit, string> = {
  percent: "Percent",
  absolute: "Absolute",
};
