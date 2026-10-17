import type { VideoUploadMeta } from "../api/videoApi";
import type { KeyValueStore } from "./types";

const KEY = "aa.videoQueue.v1";

export type PendingVideo = VideoUploadMeta & {
  /** Display only: the student's name. */
  candidateName: string;
  /** Display only. */
  label: string;
  attempts: number;
  lastError: string | null;
};

export type VideoQueue = {
  list(): Promise<PendingVideo[]>;
  add(item: Omit<PendingVideo, "attempts" | "lastError">): Promise<void>;
  markFailed(clientEventId: string, message: string): Promise<void>;
  remove(clientEventId: string): Promise<void>;
};

/** Recorded videos waiting to upload. Survives the app closing; the file itself stays on the phone. */
export function createVideoQueue(store: KeyValueStore): VideoQueue {
  let chain: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  }
  async function read(): Promise<PendingVideo[]> {
    const raw = await store.getItem(KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as PendingVideo[]) : [];
    } catch {
      return [];
    }
  }
  const write = (items: PendingVideo[]) => store.setItem(KEY, JSON.stringify(items));

  return {
    list: () => exclusive(read),
    add: (item) =>
      exclusive(async () => {
        const items = (await read()).filter((i) => i.clientEventId !== item.clientEventId);
        items.push({ ...item, attempts: 0, lastError: null });
        await write(items);
      }),
    markFailed: (id, message) =>
      exclusive(async () => {
        const items = (await read()).map((i) =>
          i.clientEventId === id ? { ...i, attempts: i.attempts + 1, lastError: message } : i,
        );
        await write(items);
      }),
    remove: (id) =>
      exclusive(async () => {
        await write((await read()).filter((i) => i.clientEventId !== id));
      }),
  };
}
