import { apiRequest } from "./client";

/** X-49. Home dashboard, batch notification mails and login history. */
export type DashboardBatch = {
  id: string;
  qualification: string | null;
  sector: string;
  status: string;
  assessmentStartDate: string;
  assessmentEndDate: string;
  candidateCount: number;
  tpName: string | null;
  centreName: string | null;
  assessorName: string | null;
};

export type DashboardSummary = {
  today: string;
  from: string;
  to: string;
  batchesScheduled: number;
  assessorsScheduled: number;
  writingNow: number;
  nextSevenDays: DashboardBatch[];
};

export type DashboardFilters = {
  sector?: string;
  batchId?: string;
  from?: string;
  to?: string;
};

function paramsOf(
  filters: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const text = String(value ?? "").trim();
    if (text) params.set(key, text);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function getDashboard(filters: DashboardFilters, signal?: AbortSignal) {
  return apiRequest<DashboardSummary>(`/dashboard${paramsOf(filters)}`, {
    signal,
  });
}

export type MailBatch = DashboardBatch & {
  assessorAssigned: boolean;
  tpAccepted: boolean;
};
export type MailFilters = DashboardFilters & {
  assessorStatus?: string;
  tpStatus?: string;
  page?: number;
};
export type MailBatchPage = {
  page: number;
  pageSize: number;
  total: number;
  items: MailBatch[];
};
export type MailRecipient = "training_partner" | "assessor";
export type MailResult = {
  queued: number;
  skipped: { batchId: string; reason: string }[];
};

export function searchMailBatches(filters: MailFilters, signal?: AbortSignal) {
  return apiRequest<MailBatchPage>(
    `/batch-mails/batches${paramsOf({ ...filters })}`,
    { signal },
  );
}

export function sendBatchMails(
  batchIds: string[],
  recipients: MailRecipient[],
) {
  return apiRequest<MailResult>("/batch-mails/send", {
    method: "POST",
    body: { batchIds, recipients },
  });
}

export type LoginRow = {
  id: string;
  userId: string;
  userName: string | null;
  role: string;
  type: string;
  capturedAt: string;
  batchId: string | null;
  qualification: string | null;
  sector: string | null;
  platform: string | null;
  locationCaptured: boolean;
  lateSync: boolean;
};
export type LoginPage = {
  page: number;
  pageSize: number;
  total: number;
  items: LoginRow[];
};
export type PunchRow = {
  userId: string;
  userName: string | null;
  role: string;
  batchId: string | null;
  date: string;
  firstLogin: string | null;
  lastLogout: string | null;
  events: number;
};
export type PunchResult = { truncated: boolean; items: PunchRow[] };
export type LoginFilters = {
  sector?: string;
  batchId?: string;
  examDate?: string;
  role?: string;
  userId?: string;
  page?: number;
};

export function getLoginHistory(filters: LoginFilters, signal?: AbortSignal) {
  return apiRequest<LoginPage>(
    `/reports/login-history${paramsOf({ ...filters })}`,
    { signal },
  );
}

export function getPunchDetails(filters: LoginFilters, signal?: AbortSignal) {
  return apiRequest<PunchResult>(
    `/reports/login-history${paramsOf({ ...filters, view: "punch" })}`,
    { signal },
  );
}
