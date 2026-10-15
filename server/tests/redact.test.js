import { isNationalIdKey, stripNationalIds } from "../src/lib/redact.js";

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
