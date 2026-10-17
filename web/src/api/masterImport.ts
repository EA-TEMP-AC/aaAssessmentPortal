import { apiRequest } from "./client";

/** X-43. The record types that can be bulk-loaded from an Excel file. */
export type BulkType =
  | "awarding-bodies"
  | "training-partners"
  | "centres"
  | "assessors"
  | "proctors"
  | "learners";

export type BulkImportResult = {
  totalRows: number;
  created: number;
  skipped: number;
  errors: { row: number; reason: string }[];
};

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function downloadBulkTemplate(type: BulkType): Promise<Blob> {
  const response = await apiRequest<Response>(
    `/master-import/${type}/template`,
    {
      raw: true,
    },
  );
  return response.blob();
}

export async function bulkImport(
  type: BulkType,
  file: Blob,
): Promise<BulkImportResult> {
  const body = await apiRequest<unknown>(`/master-import/${type}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": XLSX },
  });
  const b = (body ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(b.errors)
    ? b.errors.flatMap((e) => {
        const r = e as Record<string, unknown>;
        return typeof r?.row === "number" && typeof r.reason === "string"
          ? [{ row: r.row, reason: r.reason }]
          : [];
      })
    : [];
  return {
    totalRows: typeof b.totalRows === "number" ? b.totalRows : 0,
    created: typeof b.created === "number" ? b.created : 0,
    skipped: typeof b.skipped === "number" ? b.skipped : 0,
    errors,
  };
}
