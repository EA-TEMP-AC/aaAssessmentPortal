import { describe, expect, it } from "@jest/globals";
import { MemoryStorage } from "./memoryStorage";
import { createVideoQueue } from "./videoQueue";

const item = {
  clientEventId: "e1",
  batchId: "b1",
  candidateId: "c1",
  part: "practical" as const,
  capturedAt: "2026-11-20T05:00:00.000Z",
  uri: "file:///a.mp4",
  candidateName: "Asha",
  label: "Practical",
};

describe("videoQueue", () => {
  it("keeps recordings until they are removed, and counts failed tries", async () => {
    const q = createVideoQueue(new MemoryStorage());
    await q.add(item);
    await q.add({ ...item, clientEventId: "e2" });
    await q.markFailed("e1", "offline");
    const list = await q.list();
    expect(list.map((i) => [i.clientEventId, i.attempts, i.lastError])).toEqual([
      ["e1", 1, "offline"],
      ["e2", 0, null],
    ]);
    await q.remove("e1");
    expect((await q.list()).map((i) => i.clientEventId)).toEqual(["e2"]);
  });

  it("does not duplicate an item added twice", async () => {
    const q = createVideoQueue(new MemoryStorage());
    await q.add(item);
    await q.add(item);
    expect(await q.list()).toHaveLength(1);
  });
});
