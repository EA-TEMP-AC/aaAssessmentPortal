import { expect, it } from "vitest";
import { ApiError } from "../../api/client";
import {
  buildProjectWrite,
  buildSchemeWrite,
  buildSignatoryWrite,
  emptyProjectDraft,
  emptySchemeDraft,
  emptySignatoryDraft,
  serverFieldErrors,
} from "./schemeWrite";

const SCHEME_ID = "66f0000000000000000000a1";
const PROJECT_ID = "66f0000000000000000000b1";

it("builds a scheme body and trims text", () => {
  const result = buildSchemeWrite({ ...emptySchemeDraft(), name: " State Skill ", code: " SSS-01 ", fundingBody: " Mission " });
  expect(result).toEqual({ ok: true, body: { name: "State Skill", code: "SSS-01", fundingBody: "Mission", active: true } });
});

it("lists every missing or long scheme field", () => {
  const result = buildSchemeWrite({ ...emptySchemeDraft(), code: "x".repeat(65) });
  expect(result).toMatchObject({ ok: false, fields: ["name", "code", "fundingBody"] });
});

it("needs a scheme and a start date for a project, and an end date not before the start", () => {
  const empty = buildProjectWrite(emptyProjectDraft());
  expect(empty).toMatchObject({ ok: false, fields: ["name", "code", "schemeId", "startDate"] });

  const base = { ...emptyProjectDraft(), name: "P", code: "P-1", schemeId: SCHEME_ID, startDate: "2026-04-01" };
  expect(buildProjectWrite({ ...base, endDate: "2026-03-31" })).toMatchObject({ ok: false, fields: ["endDate"] });
  expect(buildProjectWrite({ ...base, schemeId: "nope" })).toMatchObject({ ok: false, fields: ["schemeId"] });
  expect(buildProjectWrite({ ...base, startDate: "2026-02-30" })).toMatchObject({ ok: false, fields: ["startDate"] });
  expect(buildProjectWrite({ ...base, endDate: "" })).toEqual({
    ok: true,
    body: { name: "P", code: "P-1", schemeId: SCHEME_ID, startDate: "2026-04-01", endDate: null, active: true },
  });
  expect(buildProjectWrite({ ...base, endDate: "2026-04-01" })).toMatchObject({ ok: true });
});

it("sends only the id the signatory scope needs", () => {
  const base = { ...emptySignatoryDraft(), name: "A. Signer", designation: "Director", validFrom: "2026-04-01", schemeId: SCHEME_ID, projectId: PROJECT_ID };
  expect(buildSignatoryWrite({ ...base, scope: "agency" })).toMatchObject({ ok: true, body: { scope: "agency", schemeId: null, projectId: null, validTo: null } });
  expect(buildSignatoryWrite({ ...base, scope: "scheme" })).toMatchObject({ ok: true, body: { schemeId: SCHEME_ID, projectId: null } });
  expect(buildSignatoryWrite({ ...base, scope: "project" })).toMatchObject({ ok: true, body: { schemeId: null, projectId: PROJECT_ID } });
  expect(buildSignatoryWrite({ ...base, scope: "scheme", schemeId: "" })).toMatchObject({ ok: false, fields: ["schemeId"] });
  expect(buildSignatoryWrite({ ...base, scope: "project", projectId: "" })).toMatchObject({ ok: false, fields: ["projectId"] });
});

it("checks signatory dates", () => {
  const base = { ...emptySignatoryDraft(), name: "A", designation: "D", validFrom: "2026-04-01" };
  expect(buildSignatoryWrite({ ...base, validFrom: "" })).toMatchObject({ ok: false, fields: ["validFrom"] });
  expect(buildSignatoryWrite({ ...base, validTo: "2026-03-01" })).toMatchObject({ ok: false, fields: ["validTo"] });
  expect(buildSignatoryWrite({ ...base, validTo: "2027-03-31" })).toMatchObject({ ok: true, body: { validTo: "2027-03-31" } });
});

it("reads field names from server validation details", () => {
  const error = new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { schemeId: ["must be active"], other: ["x"], count: 3 });
  expect(serverFieldErrors(error, ["name", "schemeId"])).toEqual(["schemeId"]);
  expect(serverFieldErrors(new ApiError(409, "DUPLICATE_RESOURCE", "Duplicate", { field: "code" }), ["name", "code"])).toEqual(["code"]);
  expect(serverFieldErrors(new Error("x"), ["name"])).toEqual([]);
  expect(serverFieldErrors(new ApiError(500, "X", "x"), ["name"])).toEqual([]);
});
