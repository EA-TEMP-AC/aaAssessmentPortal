import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SETTINGS,
  parseBatchSettings,
} from "../../api/batchSettings";
import {
  buildPatch,
  describeChanges,
  toDraft,
  validateDraft,
} from "./settingsDraft";

describe("ThinkExam switches (X-28)", () => {
  const saved = DEFAULT_BATCH_SETTINGS;

  it("keeps today's behaviour as the defaults, also when the server sends an old shape", () => {
    expect(saved).toMatchObject({
      proctoringType: "automatic",
      aiEnabled: true,
      ufmEvidence: "image",
      downloadSessionVideo: false,
      studentAttendance: true,
      assessorAnnexureM: true,
      languages: { theory: false, practical: false, viva: false },
      flagPolicy: { pauseAfterUnlock: 3 },
      imageCapture: { enabled: true },
    });
    const parsed = parseBatchSettings({
      settings: { shuffleQuestions: false },
    });
    expect(parsed.proctoringType).toBe("automatic");
    expect(parsed.flagPolicy.pauseAfterUnlock).toBe(3);
    expect(parsed.languages.viva).toBe(false);
  });

  it("sends nothing when nothing changed", () => {
    expect(buildPatch(saved, toDraft(saved))).toEqual({});
  });

  it("sends only what changed, in the shape the server takes", () => {
    const draft = {
      ...toDraft(saved),
      proctoringType: "manual" as const,
      aiEnabled: false,
      studentAttendance: false,
      langViva: true,
      pauseAfterUnlock: "5",
      imageEnabled: false,
      allowOjtImages: true,
    };
    expect(buildPatch(saved, draft)).toEqual({
      proctoringType: "manual",
      aiEnabled: false,
      studentAttendance: false,
      allowOjtImages: true,
      languages: { viva: true },
      flagPolicy: { pauseAfterUnlock: 5 },
      imageCapture: { enabled: false },
    });
    const lines = describeChanges(saved, draft).join("\n");
    expect(lines).toMatch(/Proctoring type: Manual/);
    expect(lines).toMatch(/Proctoring by AI: On to Off/);
    expect(lines).toMatch(/Flags allowed after an unlock: 3 to 5/);
    expect(lines).toMatch(/Pictures during the exam: On to Off/);
    expect(lines).toMatch(/Viva test in more than one language: Off to On/);
  });

  it("checks the unlock number like the server", () => {
    for (const bad of ["0", "21", "x", ""]) {
      expect(
        validateDraft({ ...toDraft(saved), pauseAfterUnlock: bad })
          .pauseAfterUnlock,
      ).toMatch(/whole number/);
    }
    expect(
      validateDraft({ ...toDraft(saved), pauseAfterUnlock: "20" })
        .pauseAfterUnlock,
    ).toBeUndefined();
  });

  it("needs the exam video for video evidence and for the downloads", () => {
    for (const change of [
      { ufmEvidence: "video" as const },
      { downloadSessionVideo: true },
      { downloadFlagVideo: true },
    ]) {
      expect(
        validateDraft({ ...toDraft(saved), ...change }).videoOptions,
      ).toMatch(/Record exam video/);
    }
    const withVideo = {
      ...toDraft(saved),
      requireScreenShare: true,
      recordVideo: true,
    };
    expect(
      validateDraft({
        ...withVideo,
        ufmEvidence: "video",
        downloadSessionVideo: true,
      }).videoOptions,
    ).toBeUndefined();
  });
});
