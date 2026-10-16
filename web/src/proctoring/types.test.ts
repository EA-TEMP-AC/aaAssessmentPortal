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
