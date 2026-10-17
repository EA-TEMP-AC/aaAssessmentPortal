import { describe, expect, expectTypeOf, it } from "vitest";
import { kindForLabel } from "./mediapipeDetector";
import { PROCTOR_FLAG_TYPES, type ProctorFlagType } from "./types";

describe("engine contract", () => {
  it("lists exactly the flag types agreed with the exam page and the server", () => {
    expect([...PROCTOR_FLAG_TYPES].sort()).toEqual(
      [
        "tab_hidden",
        "fullscreen_exit",
        "window_blur",
        "permission_revoked",
        "object_detected",
        "face_not_present",
        "multiple_faces",
        "person_detected",
        "phone_detected",
        "camera_blocked",
        "camera_frozen",
        "face_mismatch",
        "id_mismatch",
        "id_unreadable",
        "looking_away",
        "voice_detected",
      ].sort(),
    );
    expectTypeOf<(typeof PROCTOR_FLAG_TYPES)[number]>().toEqualTypeOf<ProctorFlagType>();
  });

  it("maps object-detector labels to detection kinds", () => {
    expect(kindForLabel("person")).toBe("person");
    expect(kindForLabel("cell phone")).toBe("phone");
    expect(kindForLabel("book")).toBe("object");
  });
});

describe("head turn (X-14)", () => {
  it("is about zero facing the camera and grows as the nose moves off the eye line", async () => {
    const { headTurnOf } = await import("./mediapipeDetector");
    const eyes = [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }];
    expect(headTurnOf([...eyes, { x: 0.5, y: 0.5 }])).toBeCloseTo(0);
    expect(Math.abs(headTurnOf([...eyes, { x: 0.6, y: 0.5 }])!)).toBeCloseTo(0.5);
    expect(headTurnOf(undefined)).toBeUndefined();
    expect(headTurnOf([{ x: 0.5, y: 0.4 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.5 }])).toBeUndefined();
  });
});
