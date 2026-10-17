import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_SETTINGS } from "../../api/batchSettings";
import { buildPatch, describeChanges, toDraft, validateDraft } from "./settingsDraft";

describe("exam video settings (X-27)", () => {
  const saved = DEFAULT_BATCH_SETTINGS;

  it("defaults: not recorded, continue on failure, only the proctor may watch", () => {
    expect(saved.recordVideo).toBe(false);
    expect(saved.videoFailureAction).toBe("continue");
    expect(saved.videoVisibleTo).toEqual(["proctor"]);
  });

  it("needs screen sharing", () => {
    const draft = { ...toDraft(saved), recordVideo: true };
    expect(validateDraft(draft).recordVideo).toMatch(/screen sharing/);
    expect(validateDraft({ ...draft, requireScreenShare: true }).recordVideo).toBeUndefined();
  });

  it("sends only what changed and describes it in plain words", () => {
    const draft = {
      ...toDraft(saved),
      requireScreenShare: true,
      recordVideo: true,
      videoFailureAction: "require" as const,
      videoVisibleTo: ["tp" as const, "proctor" as const],
    };
    expect(buildPatch(saved, draft)).toEqual({
      requireScreenShare: true,
      recordVideo: true,
      videoFailureAction: "require",
      videoVisibleTo: ["tp", "proctor"],
    });
    const lines = describeChanges(saved, draft).join("\n");
    expect(lines).toMatch(/Record exam video/);
    expect(lines).toMatch(/cannot start/);
    expect(lines).toMatch(/Who can watch the video: AA admin/);
    expect(buildPatch(saved, toDraft(saved))).toEqual({});
  });
});
