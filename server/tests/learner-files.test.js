import { describe, expect, it } from "vitest";
import { uploadFieldsSchema } from "../src/modules/learner-files/learner-files.schemas.js";

describe("student file upload fields (X-47)", () => {
  it("needs a document type for an identity card and none for a photo", () => {
    expect(uploadFieldsSchema.parse({ kind: "photo" })).toEqual({ kind: "photo" });
    expect(uploadFieldsSchema.parse({ kind: "identity", docType: "voter_id" })).toEqual({
      kind: "identity",
      docType: "voter_id",
    });
    expect(() => uploadFieldsSchema.parse({ kind: "identity" })).toThrow();
    expect(() => uploadFieldsSchema.parse({ kind: "photo", docType: "voter_id" })).toThrow();
    expect(() => uploadFieldsSchema.parse({ kind: "identity", docType: "passport" })).toThrow();
    expect(() => uploadFieldsSchema.parse({ kind: "photo", extra: 1 })).toThrow();
  });
});
