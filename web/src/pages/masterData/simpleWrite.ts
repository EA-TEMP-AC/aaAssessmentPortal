import { isStateName } from "../../api/annexure";
import type { AwardingBodyWrite, CentreWrite, LearnerWrite, TrainingPartnerWrite } from "../../api/masterData";
import type { MasterCollection } from "../masterDataAccess";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export type SimpleDraft = {
  name: string;
  code: string;
  email: string;
  tpId: string;
  state: string;
  active: boolean;
  notificationEmails: string[];
  externalRef: string;
  phone: string;
  enrolmentNumber: string;
  fatherName: string;
  gender: string;
  address: string;
  aadhaar: string;
  accommodations: string[];
};

export type SimpleWrite = AwardingBodyWrite | TrainingPartnerWrite | CentreWrite | LearnerWrite;

export type SimpleResult = { ok: true; body: SimpleWrite } | { ok: false; message: string; fields: string[] };

export function emptySimpleDraft(): SimpleDraft {
  return {
    name: "",
    code: "",
    email: "",
    tpId: "",
    state: "",
    active: true,
    notificationEmails: [""],
    externalRef: "",
    phone: "",
    enrolmentNumber: "",
    fatherName: "",
    gender: "",
    address: "",
    aadhaar: "",
    accommodations: [],
  };
}

function fail(messages: string[], fields: string[]): SimpleResult {
  return { ok: false, message: messages.join(" "), fields };
}

function bounded(value: string, max: number, label: string, field: string, messages: string[], fields: string[]): boolean {
  if (value.length > max) {
    messages.push(`${label} must be ${max} characters or fewer.`);
    fields.push(field);
    return false;
  }
  return true;
}

export function simpleFieldOrder(collection: MasterCollection, draft: SimpleDraft): string[] {
  if (collection === "awarding-bodies") {
    return ["name", "code", ...draft.notificationEmails.map((_, index) => `notificationEmails.${index}`)];
  }
  if (collection === "training-partners") return ["name", "code", "email"];
  if (collection === "centres") return ["name", "code", "tpId", "state", "email"];
  return ["name", "externalRef", "enrolmentNumber", "fatherName", "gender", "phone", "address", "aadhaar", ...draft.accommodations.map((_, index) => `accommodations.${index}`)];
}

export function buildSimpleWrite(collection: MasterCollection, draft: SimpleDraft, mode: "create" | "edit"): SimpleResult {
  const messages: string[] = [];
  const fields: string[] = [];
  const name = draft.name.trim();
  const code = draft.code.trim();
  if (!name) {
    messages.push("Name is required.");
    fields.push("name");
  } else bounded(name, 200, "Name", "name", messages, fields);
  if (code) bounded(code, 64, "Code", "code", messages, fields);

  if (collection === "awarding-bodies") {
    const emails: string[] = [];
    const seen = new Set<string>();
    draft.notificationEmails.forEach((value, index) => {
      const trimmed = value.trim().toLowerCase();
      if (!trimmed) return;
      const field = `notificationEmails.${index}`;
      if (trimmed.length > 320 || !EMAIL.test(trimmed)) {
        messages.push("Enter a valid notification email.");
        fields.push(field);
        return;
      }
      if (seen.has(trimmed)) {
        messages.push("Notification emails must be unique.");
        fields.push(field);
        return;
      }
      seen.add(trimmed);
      emails.push(trimmed);
    });
    if (emails.length === 0 && !fields.some((field) => field.startsWith("notificationEmails"))) {
      messages.push("Enter at least one notification email.");
      fields.push("notificationEmails.0");
    }
    if (messages.length > 0) return fail(messages, fields);
    const body: AwardingBodyWrite = { name, notificationEmails: emails, active: draft.active };
    if (code) body.code = code;
    else if (mode === "edit") body.code = null;
    return { ok: true, body };
  }

  if (collection === "training-partners") {
    const email = draft.email.trim().toLowerCase();
    if (email && (email.length > 320 || !EMAIL.test(email))) {
      messages.push("Enter a valid email address.");
      fields.push("email");
    }
    if (messages.length > 0) return fail(messages, fields);
    const body: TrainingPartnerWrite = { name, active: draft.active };
    if (code) body.code = code;
    else if (mode === "edit") body.code = null;
    if (email) body.email = email;
    else if (mode === "edit") body.email = null;
    return { ok: true, body };
  }

  if (collection === "centres") {
    const tpId = draft.tpId.trim();
    if (!tpId) {
      messages.push("Training partner id is required.");
      fields.push("tpId");
    } else if (!OBJECT_ID.test(tpId)) {
      messages.push("Training partner id must be a 24-character id.");
      fields.push("tpId");
    }
    if (!isStateName(draft.state)) {
      messages.push("Choose a state.");
      fields.push("state");
    }
    const email = draft.email.trim().toLowerCase();
    if (email && (email.length > 320 || !EMAIL.test(email))) {
      messages.push("Enter a valid email address.");
      fields.push("email");
    }
    if (messages.length > 0 || !isStateName(draft.state)) return fail(messages, fields);
    const body: CentreWrite = { name, tpId, state: draft.state, active: draft.active };
    if (code) body.code = code;
    else if (mode === "edit") body.code = null;
    if (email) body.email = email;
    else if (mode === "edit") body.email = null;
    return { ok: true, body };
  }

  const externalRef = draft.externalRef.trim();
  const phone = draft.phone.trim();
  if (externalRef) bounded(externalRef, 64, "External reference", "externalRef", messages, fields);
  if (phone) bounded(phone, 32, "Phone", "phone", messages, fields);
  const enrolmentNumber = draft.enrolmentNumber.trim();
  const fatherName = draft.fatherName.trim();
  const address = draft.address.trim();
  if (enrolmentNumber) bounded(enrolmentNumber, 64, "Enrolment number", "enrolmentNumber", messages, fields);
  if (fatherName) bounded(fatherName, 200, "Father's or husband's name", "fatherName", messages, fields);
  if (address) bounded(address, 500, "Address", "address", messages, fields);
  const aadhaar = draft.aadhaar.replace(/[\s-]/g, "");
  if (aadhaar && !/^[2-9]\d{11}$/.test(aadhaar)) {
    messages.push("Aadhaar number must be 12 digits.");
    fields.push("aadhaar");
  }
  if (draft.gender && !["Male", "Female", "Other"].includes(draft.gender)) {
    messages.push("Choose Male, Female or Other.");
    fields.push("gender");
  }
  const accommodations: string[] = [];
  draft.accommodations.forEach((value, index) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!bounded(trimmed, 100, "Accommodation", `accommodations.${index}`, messages, fields)) return;
    accommodations.push(trimmed);
  });
  if (messages.length > 0) return fail(messages, fields);
  const body: LearnerWrite = { name, active: draft.active };
  if (externalRef) body.externalRef = externalRef;
  else if (mode === "edit") body.externalRef = null;
  if (phone) body.phone = phone;
  else if (mode === "edit") body.phone = null;
  const optionalText = (key: "enrolmentNumber" | "fatherName" | "address", value: string) => {
    if (value) body[key] = value;
    else if (mode === "edit") body[key] = null;
  };
  optionalText("enrolmentNumber", enrolmentNumber);
  optionalText("fatherName", fatherName);
  optionalText("address", address);
  // Blank on edit leaves the stored number as it is.
  if (aadhaar) body.aadhaar = aadhaar;
  if (draft.gender) body.gender = draft.gender as "Male" | "Female" | "Other";
  else if (mode === "edit") body.gender = null;
  if (accommodations.length > 0 || mode === "edit") body.accommodations = accommodations;
  return { ok: true, body };
}
