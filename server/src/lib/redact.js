/**
 * Replace secret fields with "***" before they are stored on auditLogs.
 * docs/SCHEMA.md: passwordHash and other secrets in before/after snapshots.
 * Also covers reset tokens and refresh token hashes (B-01).
 */
const SECRET_KEYS = new Set([
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "oldpassword",
  "temporarypassword",
  "plainpassword",
  "smtppassword",
  "smtppass",
  "refreshtoken",
  "tokenhash",
  "passwordresettoken",
  "passwordresettokenhash",
  "resettoken",
  "accesstoken",
]);

export function isSecretKey(key) {
  return SECRET_KEYS.has(String(key).replace(/[_-]/g, "").toLowerCase());
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Date) return false;
  if (Buffer.isBuffer(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (!isPlainObject(value)) return value;

  const redacted = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? "***" : redactSecrets(nested);
  }
  return redacted;
}

/**
 * National-id keys are dropped, not masked: docs/SCHEMA.md PII rule says no Aadhaar or other
 * national id is stored anywhere, auditLogs included.
 */
const NATIONAL_ID_KEYS = new Set([
  "uidai",
  "nationalid",
  "pan",
  "pannumber",
  "voterid",
  "passportnumber",
]);

export function isNationalIdKey(key) {
  const normal = String(key).replace(/[_-]/g, "").toLowerCase();
  return normal.includes("aadhaar") || normal.includes("aadhar") || NATIONAL_ID_KEYS.has(normal);
}

export function stripNationalIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripNationalIds(item));
  }
  if (!isPlainObject(value)) return value;

  const kept = {};
  for (const [key, nested] of Object.entries(value)) {
    if (!isNationalIdKey(key)) kept[key] = stripNationalIds(nested);
  }
  return kept;
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const EXACT_EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const EMAIL_KEY_NAMES = new Set([
  "email",
  "useremail",
  "contactemail",
  "toemail",
  "fromemail",
  "recipientemail",
  "notificationemails",
]);

const PHONE_KEY_NAMES = new Set([
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "contactphone",
  "telephone",
  "cellphone",
]);

export function maskEmail(email) {
  if (typeof email !== "string") return email;
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf("@");
  if (atIdx === -1) return "***";
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

export function maskPhone(phone) {
  if (phone === null || phone === undefined) return phone;
  const str = String(phone).trim();
  const digits = str.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `***-***-${digits.slice(-4)}`;
  }
  return "***";
}

export function isEmailKey(key) {
  const normal = String(key).replace(/[_-]/g, "").toLowerCase();
  return EMAIL_KEY_NAMES.has(normal);
}

export function isPhoneKey(key) {
  const normal = String(key).replace(/[_-]/g, "").toLowerCase();
  return PHONE_KEY_NAMES.has(normal);
}

export function maskPersonalData(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => maskPersonalData(item));
  }
  if (typeof value === "string") {
    if (EXACT_EMAIL_REGEX.test(value)) {
      return maskEmail(value);
    }
    if (EMAIL_REGEX.test(value)) {
      return value.replace(EMAIL_REGEX, (match) => maskEmail(match));
    }
    return value;
  }
  if (!isPlainObject(value)) return value;

  const masked = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isEmailKey(key)) {
      if (Array.isArray(nested)) {
        masked[key] = nested.map((e) =>
          typeof e === "string" ? maskEmail(e) : maskPersonalData(e),
        );
      } else if (typeof nested === "string") {
        masked[key] = maskEmail(nested);
      } else {
        masked[key] = maskPersonalData(nested);
      }
    } else if (isPhoneKey(key)) {
      if (Array.isArray(nested)) {
        masked[key] = nested.map((p) => maskPhone(p));
      } else if (typeof nested === "string" || typeof nested === "number") {
        masked[key] = maskPhone(nested);
      } else {
        masked[key] = maskPersonalData(nested);
      }
    } else {
      masked[key] = maskPersonalData(nested);
    }
  }
  return masked;
}
