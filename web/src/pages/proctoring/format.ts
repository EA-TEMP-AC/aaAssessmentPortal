import { KIND_LABELS, type EvidenceKind } from "../../api/evidence";

/** Time in IST, for the proctor screens. */
export function formatTime(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const text = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  return `${text} IST`;
}

/** File size in KB, one decimal under 10 KB. */
export function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as EvidenceKind] ?? kind;
}
