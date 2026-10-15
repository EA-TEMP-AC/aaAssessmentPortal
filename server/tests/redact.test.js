import {
  isNationalIdKey,
  maskEmail,
  maskPersonalData,
  maskPhone,
  stripNationalIds,
} from "../src/lib/redact.js";

describe("stripNationalIds", () => {
  it("drops national-id keys at any depth and keeps everything else", () => {
    const out = stripNationalIds({
      name: "Asha",
      aadhaar: "123412341234",
      Aadhaar_Number: "1",
      nested: { PAN: "x", panNumber: "y", panel: "kept", list: [{ voterId: "v", ok: 1 }] },
    });
    expect(out).toEqual({ name: "Asha", nested: { panel: "kept", list: [{ ok: 1 }] } });
  });

  it("recognises the names the security test lists", () => {
    for (const key of [
      "aadhaar",
      "aadhar",
      "aadhaarNumber",
      "aadhaar_number",
      "nationalId",
      "panNumber",
      "voterId",
      "passportNumber",
    ]) {
      expect(isNationalIdKey(key), key).toBe(true);
    }
    expect(isNationalIdKey("email")).toBe(false);
  });
});

describe("maskEmail and maskPhone", () => {
  it("masks emails preserving only the first char and domain", () => {
    expect(maskEmail("asha@example.com")).toBe("a***@example.com");
    expect(maskEmail("x@example.com")).toBe("*@example.com");
    expect(maskEmail("not-an-email")).toBe("***");
  });

  it("masks phone numbers keeping only the last 4 digits", () => {
    expect(maskPhone("9876543210")).toBe("***-***-3210");
    expect(maskPhone("+91 98765 43210")).toBe("***-***-3210");
    expect(maskPhone("12")).toBe("***");
    expect(maskPhone(null)).toBeNull();
  });
});

describe("maskPersonalData", () => {
  it("masks emails and phones across nested structures and key names", () => {
    const input = {
      user: {
        email: "candidate@skills.gov.in",
        phone: "9876543210",
        profile: {
          contactEmail: "alt@example.com",
          mobile: "9123456789",
          note: "Reach out to lead@partner.org for questions",
        },
      },
      tags: ["admin", "ops@test.com"],
    };
    const masked = maskPersonalData(input);
    expect(masked.user.email).toBe("c***@skills.gov.in");
    expect(masked.user.phone).toBe("***-***-3210");
    expect(masked.user.profile.contactEmail).toBe("a***@example.com");
    expect(masked.user.profile.mobile).toBe("***-***-6789");
    expect(masked.user.profile.note).toContain("l***@partner.org");
    expect(masked.tags[1]).toBe("o***@test.com");
  });
});
