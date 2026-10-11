import { expect, it } from "vitest";
import { ApiError, errorMessage } from "./client";
import { explainBatchRule } from "./ruleErrors";
import { formatMasterDataError } from "../pages/masterData/formatApiError";

it("explains RULE_OUTSIDE_RECOGNITION with each failed check", () => {
  const error = new ApiError(409, "RULE_OUTSIDE_RECOGNITION", "Outside recognition", {
    checks: ["sector", "state", "not_started", "expired", "unconfigured", "other"],
  });
  const text = errorMessage(error);
  expect(text).toContain("RULE_OUTSIDE_RECOGNITION");
  expect(text).toContain("Outside recognition");
  expect(text).toContain("The qualification sector is not a recognised sector.");
  expect(text).toContain("The centre state is not a recognised state.");
  expect(text).toContain("The recognition period has not started.");
  expect(text).toContain("The recognition period has ended.");
  expect(text).toContain("Recognition has not been set up.");
  expect(text).toContain("other");
  expect(text).toContain("override reason");
  expect(explainBatchRule("VALIDATION_ERROR", {})).toBeNull();
});

it("explains RULE_ASSESSOR_LANGUAGE on master-data alerts as well", () => {
  const error = new ApiError(409, "RULE_ASSESSOR_LANGUAGE", "Language does not match");
  const formatted = formatMasterDataError(error);
  expect(formatted.message).toContain("RULE_ASSESSOR_LANGUAGE");
  expect(formatted.message).toContain("Language does not match");
  expect(formatted.message).toContain("do not include this batch's assessment language");
  expect(formatted.message).toContain("override reason");
});
