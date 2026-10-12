import type { BatchFieldApi } from "../api/batchApi";
import type { CachedBatchData } from "../domain/batch";
import type { BatchStore } from "../storage/batchStore";

export type BatchDownload = { kind: "none" } | { kind: "saved"; data: CachedBatchData };

/**
 * Downloads the first batch the server lists for this user and caches it for
 * offline use. GET /batches is already scoped per role: the assessor's and the
 * proctor's assigned batches, and the batches a candidate is on the roster of.
 * A proctor cannot read the roster (B-07b: 403), so none is requested. A
 * candidate gets only their own roster row.
 */
export async function downloadAssignedBatch(options: {
  api: BatchFieldApi;
  store: BatchStore;
  role: string;
  accessToken: string;
}): Promise<BatchDownload> {
  const batches = await options.api.listAssignedBatches(options.accessToken);
  const assigned = batches[0];
  if (!assigned) return { kind: "none" };
  const roster =
    options.role === "proctor" ? [] : await options.api.getCandidates(assigned.id, options.accessToken);
  return { kind: "saved", data: await options.store.saveBatch(assigned, roster) };
}
