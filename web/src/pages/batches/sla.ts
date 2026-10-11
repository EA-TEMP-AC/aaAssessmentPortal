import { SLA_KEYS, type BatchRecord, type BatchStatus, type SlaKey } from "../../api/batches";

export type SlaTone = "ok" | "soon" | "overdue" | "closed";

/** UI band only. An action at the due instant is on time (B-03). */
export const SLA_SOON_MS = 24 * 60 * 60 * 1000;

export const SLA_STEP_LABELS: Record<SlaKey, string> = {
  accept: "Accept",
  assign: "Assign",
  result: "Result",
};

export const SLA_TONE_LABELS: Record<SlaTone, string> = {
  ok: "On track",
  soon: "Due soon",
  overdue: "Overdue",
  closed: "Closed",
};

export const SLA_TONE_ICONS: Record<SlaTone, string> = {
  ok: "●",
  soon: "▲",
  overdue: "■",
  closed: "○",
};

/**
 * Open SLA steps match the nightly job: accept while allocated, assign while
 * allocated or accepted, result while assessment_completed.
 */
export function openSlaKeys(status: BatchStatus): SlaKey[] {
  if (status === "allocated") return ["accept", "assign"];
  if (status === "accepted") return ["assign"];
  if (status === "assessment_completed") return ["result"];
  return [];
}

export function dueAtFor(batch: BatchRecord, key: SlaKey): string | null {
  if (key === "accept") return batch.sla.acceptDueAt;
  if (key === "assign") return batch.sla.assignDueAt;
  return batch.sla.resultDueAt;
}

export function slaTone(dueAt: string | null, now: number, open: boolean): SlaTone {
  if (!open) return "closed";
  if (!dueAt) return "ok";
  const remaining = Date.parse(dueAt) - now;
  if (Number.isNaN(remaining)) return "ok";
  if (remaining < 0) return "overdue";
  if (remaining === 0) return "ok";
  if (remaining <= SLA_SOON_MS) return "soon";
  return "ok";
}

export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (days === 0 && minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (days === 0 && hours === 0) {
    parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  }
  return parts.slice(0, 2).join(" ");
}

export function formatCountdown(dueAt: string | null, now: number): string {
  if (!dueAt) return "No due time stored";
  const remaining = Date.parse(dueAt) - now;
  if (Number.isNaN(remaining)) return "No due time stored";
  if (remaining === 0) return "Due now, on time";
  if (remaining > 0) return `${formatDuration(remaining)} left`;
  return `Overdue by ${formatDuration(remaining)}`;
}

export function formatInstant(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function describeSlaStep(batch: BatchRecord, key: SlaKey, now: number) {
  const open = openSlaKeys(batch.status).includes(key);
  const dueAt = dueAtFor(batch, key);
  const tone = slaTone(dueAt, now, open);
  const breached = batch.sla.breached.includes(key);
  return {
    key,
    label: SLA_STEP_LABELS[key],
    dueAt,
    open,
    tone,
    toneLabel: SLA_TONE_LABELS[tone],
    icon: SLA_TONE_ICONS[tone],
    countdown: open ? formatCountdown(dueAt, now) : formatInstant(dueAt),
    breached,
  };
}

export function describeAllSla(batch: BatchRecord, now: number) {
  return SLA_KEYS.map((key) => describeSlaStep(batch, key, now));
}
