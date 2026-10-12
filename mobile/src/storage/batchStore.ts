import type { KeyValueStore } from "./types";
import {
  type AssignedBatch,
  type CachedBatchData,
  DEFAULT_CHECKLIST_ITEMS,
  type RosterCandidate,
} from "../domain/batch";
import type { AttendanceRecordInput, ChecklistItemInput } from "../queue/types";

const BATCH_CACHE_PREFIX = "aa.batchCache.v1.";
const CURRENT_BATCH_ID_KEY = "aa.currentBatchId.v1";

export type BatchStore = {
  saveBatch(batch: AssignedBatch, roster: RosterCandidate[]): Promise<CachedBatchData>;
  getBatch(batchId?: string): Promise<CachedBatchData | null>;
  getCurrentBatchId(): Promise<string | null>;
  setCurrentBatchId(batchId: string): Promise<void>;
  saveAttendance(
    batchId: string,
    records: AttendanceRecordInput[],
    capturedAt?: string,
  ): Promise<CachedBatchData>;
  saveChecklist(
    batchId: string,
    items: ChecklistItemInput[],
    completed?: boolean,
  ): Promise<CachedBatchData>;
  clear(): Promise<void>;
};

export function createBatchStore(store: KeyValueStore): BatchStore {
  let chain: Promise<void> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readBatchData(id: string): Promise<CachedBatchData | null> {
    const raw = await store.getItem(`${BATCH_CACHE_PREFIX}${id}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedBatchData;
    } catch {
      return null;
    }
  }

  async function writeBatchData(data: CachedBatchData): Promise<void> {
    await store.setItem(`${BATCH_CACHE_PREFIX}${data.batch.id}`, JSON.stringify(data));
  }

  return {
    saveBatch(batch, roster) {
      return exclusive(async () => {
        const existing = await readBatchData(batch.id);
        const data: CachedBatchData = {
          batch,
          roster,
          downloadedAt: new Date().toISOString(),
          attendance: existing?.attendance ?? {},
          checklist: existing?.checklist ?? [...DEFAULT_CHECKLIST_ITEMS],
          assessmentCompleted: existing?.assessmentCompleted ?? false,
        };
        await writeBatchData(data);
        await store.setItem(CURRENT_BATCH_ID_KEY, batch.id);
        return data;
      });
    },

    getBatch(batchId) {
      return exclusive(async () => {
        let id = batchId;
        if (!id) {
          id = (await store.getItem(CURRENT_BATCH_ID_KEY)) ?? undefined;
        }
        if (!id) return null;
        return readBatchData(id);
      });
    },

    getCurrentBatchId() {
      return store.getItem(CURRENT_BATCH_ID_KEY);
    },

    setCurrentBatchId(batchId) {
      return store.setItem(CURRENT_BATCH_ID_KEY, batchId);
    },

    saveAttendance(batchId, records, capturedAt) {
      return exclusive(async () => {
        const data = await readBatchData(batchId);
        if (!data) {
          throw new Error(`Batch ${batchId} is not cached`);
        }
        const nowIso = capturedAt ?? new Date().toISOString();
        for (const record of records) {
          data.attendance[record.candidateId] = {
            candidateId: record.candidateId,
            present: record.present,
            idVerified: record.idVerified,
            note: record.note,
            capturedAt: nowIso,
          };
        }
        await writeBatchData(data);
        return data;
      });
    },

    saveChecklist(batchId, items, completed = false) {
      return exclusive(async () => {
        const data = await readBatchData(batchId);
        if (!data) {
          throw new Error(`Batch ${batchId} is not cached`);
        }
        data.checklist = items.map((item) => ({
          key: item.key,
          label: item.label ?? item.key,
          available: item.available,
          note: item.note,
        }));
        if (completed) {
          data.assessmentCompleted = true;
          data.batch.status = "assessment_completed";
        }
        await writeBatchData(data);
        return data;
      });
    },

    clear() {
      return exclusive(async () => {
        const currentId = await store.getItem(CURRENT_BATCH_ID_KEY);
        if (currentId) {
          await store.deleteItem(`${BATCH_CACHE_PREFIX}${currentId}`);
          await store.deleteItem(CURRENT_BATCH_ID_KEY);
        }
      });
    },
  };
}
