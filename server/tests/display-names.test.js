import { batchLabelOf, qualificationLabel } from "../src/lib/display-names.js";

describe("display names (X-11)", () => {
  it("joins the qualification code and name", () => {
    expect(qualificationLabel({ code: "ELE/Q0001", name: "Field Technician" })).toBe(
      "ELE/Q0001 Field Technician",
    );
    expect(qualificationLabel(null)).toBeNull();
  });

  it("writes the batch as qualification and dates, like the candidate's list", () => {
    const batch = { assessmentStartDate: "2026-10-15", assessmentEndDate: "2026-10-17" };
    expect(batchLabelOf(batch, { code: "ELE/Q0001", name: "Field Technician" })).toBe(
      "ELE/Q0001 Field Technician, 2026-10-15 to 2026-10-17",
    );
    expect(batchLabelOf(batch, null)).toBe("Batch, 2026-10-15 to 2026-10-17");
  });
});
