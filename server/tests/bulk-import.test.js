import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const created = [];
vi.mock("../src/modules/master-data/master-data.service.js", async () => {
  const { duplicateResource } = await import("../src/lib/errors.js");
  const make = (kind) => async (body) => {
    if (body.code === "DUP") throw duplicateResource("A record with this code already exists");
    created.push([kind, body]);
    return { id: "x" };
  };
  return {
    createAwardingBody: make("ab"),
    createTrainingPartner: make("tp"),
    createCentre: make("centre"),
    createLearner: make("learner"),
  };
});
vi.mock("../src/modules/assessors/assessor.service.js", () => ({
  createAssessor: async (body) => {
    created.push(["assessor", body]);
    return { id: "x" };
  },
}));
vi.mock("../src/modules/proctors/proctor.service.js", () => ({
  createProctor: async (body) => {
    created.push(["proctor", body]);
    return { id: "x" };
  },
}));
vi.mock("../src/models/training-partner.model.js", () => ({
  TrainingPartner: {
    findOne: ({ code }) => ({
      select: () => ({ lean: async () => (code === "TP-1" ? { _id: "a".repeat(24) } : null) }),
    }),
  },
}));

const { buildBulkTemplate, importMasterRecords, BULK_TYPES } =
  await import("../src/modules/master-data/bulk-import.js");

async function sheet(header, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeEach(() => {
  created.length = 0;
});

describe("master bulk import (X-43)", () => {
  it("offers a template for every record type with a Data and a Notes sheet", async () => {
    expect(BULK_TYPES).toEqual([
      "awarding-bodies",
      "training-partners",
      "centres",
      "assessors",
      "proctors",
      "learners",
    ]);
    for (const type of BULK_TYPES) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await buildBulkTemplate(type));
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Data", "Notes"]);
      expect(wb.getWorksheet("Data").rowCount).toBe(1);
    }
  });

  it("creates good rows, skips existing ones, and reports bad rows by number", async () => {
    const buffer = await sheet(
      ["name", "code", "notificationEmails", "active"],
      [
        ["One AB", "AB-1", "a@x.example; b@x.example", "yes"],
        ["Existing AB", "DUP", "c@x.example", ""],
        ["", "AB-3", "d@x.example", ""],
        ["Bad email AB", "AB-4", "not-an-email", ""],
      ],
    );
    const out = await importMasterRecords("awarding-bodies", buffer);
    expect(out).toMatchObject({ totalRows: 4, created: 1, skipped: 1 });
    expect(out.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(created).toEqual([
      [
        "ab",
        {
          name: "One AB",
          code: "AB-1",
          notificationEmails: ["a@x.example", "b@x.example"],
          active: true,
        },
      ],
    ]);
  });

  it("looks up the training partner of a centre by its code", async () => {
    const buffer = await sheet(
      ["name", "code", "tpCode", "state"],
      [
        ["Centre A", "C-1", "TP-1", "Maharashtra"],
        ["Centre B", "C-2", "TP-NONE", "Maharashtra"],
        ["Centre C", "C-3", "TP-1", "Atlantis"],
      ],
    );
    const out = await importMasterRecords("centres", buffer);
    expect(out.created).toBe(1);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0].reason).toContain("TP-NONE");
    expect(created[0][1]).toMatchObject({
      name: "Centre A",
      tpId: "a".repeat(24),
      state: "Maharashtra",
    });
  });

  it("reads assessor lists, numbers and the ToA", async () => {
    const buffer = await sheet(
      [
        "name",
        "qualifications",
        "languages",
        "yearsOfExperience",
        "toaCertNo",
        "toaIssuedOn",
        "toaExpiresOn",
        "undertaking",
      ],
      [
        [
          "Ravi",
          "Electrician L4; Welder L3",
          "Hindi; English",
          6,
          "TOA-1",
          "2024-01-15",
          "2027-01-14",
          "yes",
        ],
      ],
    );
    const out = await importMasterRecords("assessors", buffer);
    expect(out.errors).toEqual([]);
    expect(created[0][1]).toMatchObject({
      name: "Ravi",
      qualifications: ["Electrician L4", "Welder L3"],
      languages: ["Hindi", "English"],
      yearsOfExperience: 6,
      toa: { certNo: "TOA-1", issuedOn: "2024-01-15", expiresOn: "2027-01-14" },
      undertaking: true,
    });
  });

  it("refuses a file without the required columns, and a file that is not Excel", async () => {
    await expect(
      importMasterRecords("learners", await sheet(["phone"], [["1"]])),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(importMasterRecords("learners", Buffer.from("name\nAsha"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("passes an Aadhaar column to the student rules, which check and encrypt it", async () => {
    const out = await importMasterRecords(
      "learners",
      await sheet(["name", "externalRef", "aadhaar"], [["Asha", "R-1", "2345 6789 0123"]]),
    );
    expect(out.created).toBe(1);
    expect(created[0][1].aadhaar).toBe("234567890123");
  });

  it("reports a bad Aadhaar by row without echoing the number", async () => {
    const out = await importMasterRecords(
      "learners",
      await sheet(["name", "aadhaar"], [["Asha", "12345"]]),
    );
    expect(out.created).toBe(0);
    expect(out.errors).toHaveLength(1);
    expect(JSON.stringify(out.errors)).not.toContain("12345");
  });
});

describe("student columns (X-45)", () => {
  it("reads the student form columns and maps the gender", async () => {
    const out = await importMasterRecords(
      "learners",
      await sheet(
        ["name", "externalRef", "enrolmentNumber", "fatherName", "gender", "phone", "address"],
        [["Asha Devi", "S-1", "ENR-1", "Ram Kumar", "f", "9000000001", "Gangtok"]],
      ),
    );
    expect(out.created).toBe(1);
    expect(created[0][1]).toMatchObject({
      name: "Asha Devi",
      externalRef: "S-1",
      enrolmentNumber: "ENR-1",
      fatherName: "Ram Kumar",
      gender: "Female",
      phone: "9000000001",
      address: "Gangtok",
    });
  });

  it("lists a bad gender as a row error", async () => {
    const out = await importMasterRecords(
      "learners",
      await sheet(["name", "gender"], [["Asha", "unknown"]]),
    );
    expect(out.created).toBe(0);
    expect(out.errors).toHaveLength(1);
  });
});
