import { apiRequest } from "./client";

/** X-44. Results list and candidate summary report (admin, MIS, NCVET viewer). */
export type ResultBatchRow = {
  batchId: string;
  qualification: string | null;
  sector: string;
  centre: string | null;
  partner: string | null;
  assessor: string | null;
  assessmentDate: string;
  batchStatus: string;
  resultStatus: string | null;
  total: number;
  pass: number;
  fail: number;
  absent: number;
};

export type ResultBatchPage = {
  page: number;
  pageSize: number;
  total: number;
  items: ResultBatchRow[];
};

export type ResultListFilters = {
  status?: string;
  sector?: string;
  batchId?: string;
  from?: string;
  to?: string;
  page?: number;
};

export type SummaryRow = {
  sNo: number;
  reference: string;
  name: string;
  fatherName: string;
  marks: Record<string, number | null>[];
  totals: Record<string, number>;
  total: number;
  percentage: number;
  status: string;
};

export type CandidateSummary = {
  batchId: string;
  resultStatus: string;
  header: {
    qualification: string;
    sector: string;
    assessor: string;
    centre: string;
    partner: string;
    date: string;
  };
  counts: { total: number; assessed: number; pass: number; fail: number; absent: number };
  components: string[];
  nos: { nosId: string; code: string; max: Record<string, number | null> }[];
  maxTotal: number;
  rows: SummaryRow[];
};

export async function listResultBatches(
  filters: ResultListFilters,
  signal?: AbortSignal,
): Promise<ResultBatchPage> {
  const params = new URLSearchParams();
  for (const key of ["status", "sector", "batchId", "from", "to"] as const) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  params.set("page", String(filters.page && filters.page > 0 ? filters.page : 1));
  return apiRequest<ResultBatchPage>(`/reports/results?${params.toString()}`, { signal });
}

export async function getCandidateSummary(
  batchId: string,
  signal?: AbortSignal,
): Promise<CandidateSummary> {
  return apiRequest<CandidateSummary>(
    `/reports/batches/${encodeURIComponent(batchId)}/candidate-summary`,
    { signal },
  );
}

export async function downloadCandidateSummary(batchId: string): Promise<Blob> {
  const response = await apiRequest<Response>(
    `/reports/batches/${encodeURIComponent(batchId)}/candidate-summary.xlsx`,
    { raw: true },
  );
  return response.blob();
}
