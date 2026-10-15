import { expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { sectionFor } from "./sections";
import { buildBody, emptyDraft, formatPublicSiteError, type Draft } from "./write";

function draft(slug: string, values: Record<string, string>, consentRecorded = false): Draft {
  const base = emptyDraft(sectionFor(slug));
  return { values: { ...base.values, ...values }, consentRecorded };
}

it("creates a draft with only the filled fields", () => {
  const result = buildBody(sectionFor("team-members"), draft("team-members", { name: " Asha ", designation: "Head" }), "create");
  expect(result).toEqual({ ok: true, body: { name: "Asha", designation: "Head", published: false } });
});

it("sends cleared optional fields as null on edit", () => {
  const result = buildBody(sectionFor("team-members"), draft("team-members", { name: "Asha", designation: "Head" }), "edit");
  expect(result).toMatchObject({ ok: true, body: { name: "Asha", department: null, bio: null, photoRef: null } });
  expect(result.ok && "published" in result.body).toBe(false);
});

it("never sends people kind or registry id on edit, and never a null name", () => {
  const result = buildBody(
    sectionFor("people"),
    draft("people", { registryId: "x", roleLabel: "Lead" }, true),
    "edit",
  );
  expect(result.ok && result.body).toMatchObject({ roleLabel: "Lead", consentRecorded: true });
  expect(result.ok && "kind" in result.body).toBe(false);
  expect(result.ok && "registryId" in result.body).toBe(false);
  expect(result.ok && "name" in result.body).toBe(false);
});

it("asks for a member name only for a committee member", () => {
  const policy = buildBody(sectionFor("posh"), draft("posh", { kind: "policy", title: "Policy" }), "create");
  expect(policy.ok).toBe(true);
  const member = buildBody(sectionFor("posh"), draft("posh", { kind: "committee_member", title: "Chair" }), "create");
  expect(member).toMatchObject({ ok: false, fields: ["memberName"] });
});

it("sends consent for a POSH committee member only", () => {
  const member = buildBody(
    sectionFor("posh"),
    draft("posh", { kind: "committee_member", title: "Chair", memberName: "Dr Rao", consentNote: "On file" }, true),
    "create",
  );
  expect(member).toMatchObject({ ok: true, body: { consentRecorded: true, consentNote: "On file" } });
  const policy = buildBody(sectionFor("posh"), draft("posh", { kind: "policy", title: "Policy" }, true), "create");
  expect(policy.ok && "consentRecorded" in policy.body).toBe(false);
});

it("checks event dates", () => {
  const section = sectionFor("events");
  expect(buildBody(section, draft("events", { title: "Fair", date: "2026-02-30" }), "create")).toMatchObject({
    ok: false,
    fields: ["date"],
  });
  expect(
    buildBody(section, draft("events", { title: "Fair", date: "2026-10-10", endDate: "2026-10-09" }), "create"),
  ).toMatchObject({ ok: false, fields: ["endDate"] });
});

it("rejects a sort order outside 0 to 100000", () => {
  const result = buildBody(
    sectionFor("team-members"),
    draft("team-members", { name: "A", designation: "B", sortOrder: "-1" }),
    "create",
  );
  expect(result).toMatchObject({ ok: false, fields: ["sortOrder"] });
});

it("explains server errors in plain words", () => {
  const section = sectionFor("people");
  const consent = formatPublicSiteError(section, new ApiError(409, "CONSENT_REQUIRED", "Consent must be recorded"));
  expect(consent.message).toContain("Consent has not been recorded");
  expect(consent.fields).toContain("consentRecorded");
  expect(formatPublicSiteError(section, new ApiError(403, "FORBIDDEN", "x")).message).toContain("Only an AA admin");
  expect(formatPublicSiteError(section, new ApiError(404, "NOT_FOUND", "x")).message).toContain("not found");
  expect(formatPublicSiteError(section, new Error("offline")).message).toBe("Could not reach the server. Try again.");
  const validation = formatPublicSiteError(
    section,
    new ApiError(400, "VALIDATION_ERROR", "Request validation failed", { registryId: ["No assessor with this id"] }),
  );
  expect(validation.fields).toEqual(["registryId"]);
  expect(validation.byField.registryId).toBe("No assessor with this id");
  expect(validation.message).toContain("Registry id: No assessor with this id");
});
