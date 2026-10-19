import { describe, expect, it } from "vitest";
import {
  createSchemeSchema,
  createSubSchemeSchema,
  listSchemesQuerySchema,
  patchSubSchemeSchema,
} from "../src/modules/schemes/schemes.schemas.js";

const id = "a".repeat(24);

describe("scheme and sub-scheme forms (X-45)", () => {
  it("accepts a scheme with just a name, sector, description and third-party flag", () => {
    const ok = createSchemeSchema.parse({
      name: "UPSDM STT",
      sector: "Electronics",
      description: "x".repeat(250),
      thirdParty: false,
    });
    expect(ok.code).toBeUndefined();
    expect(() => createSchemeSchema.parse({ name: "A", description: "x".repeat(251) })).toThrow();
    expect(() => createSchemeSchema.parse({ name: "A", sector: "Not a sector" })).toThrow();
    expect(() => createSchemeSchema.parse({ name: "A", extra: 1 })).toThrow();
  });

  it("reads the third-party filter as yes, no or both", () => {
    expect(listSchemesQuerySchema.parse({ thirdParty: "yes" }).thirdParty).toBe(true);
    expect(listSchemesQuerySchema.parse({ thirdParty: "no" }).thirdParty).toBe(false);
    expect(listSchemesQuerySchema.parse({ thirdParty: "both" }).thirdParty).toBeUndefined();
  });

  it("needs prices and billing basis on a sub-scheme", () => {
    const body = {
      name: "STT 2026",
      sector: "Electronics",
      schemeId: id,
      priceRegular: 500,
      priceReassessment: 250,
      billedOn: "appeared",
    };
    expect(createSubSchemeSchema.parse(body).jobRoleCategory).toBeUndefined();
    expect(() => createSubSchemeSchema.parse({ ...body, priceRegular: -1 })).toThrow();
    expect(() => createSubSchemeSchema.parse({ ...body, billedOn: "other" })).toThrow();
    expect(() =>
      createSubSchemeSchema.parse({ ...body, priceEffectiveDate: "19/10/2026" }),
    ).toThrow();
    expect(patchSubSchemeSchema.parse({ jobRoleCategory: "category_1" })).toEqual({
      jobRoleCategory: "category_1",
    });
    expect(() => patchSubSchemeSchema.parse({})).toThrow();
  });
});
