# API CONTRACT (owned by Architect). v0.5

Base: `/api/v1`. JSON (unless multipart/CSV). Auth: `Authorization: Bearer <accessToken>`.

Errors: `{ "error": { "code": "STRING", "message": "...", "details?: object" } }`.

Roles: `aa_admin`, `mis`, `sme`, `assessor`, `proctor`, `candidate`, `tp`, `ab_reviewer`, `ncvet_viewer`.

Schema / scopes / working-day counting / soft SLA: [docs/SCHEMA.md](docs/SCHEMA.md).

**Dates:** `assessmentStartDate` / `assessmentEndDate` as `YYYY-MM-DD` (IST). **Clash:** range overlap + different centre; `assessorDayLocks` txn. **CAS:** `statusVersion`.

Phase 1 endpoints have examples. Phase 2+ stubs without full examples.

---

## Error catalog (Phase 1)

| Code | HTTP | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/invalid access token |
| `FORBIDDEN` | 403 | Role or row-scope denied |
| `NOT_FOUND` | 404 | Unknown id |
| `VALIDATION_ERROR` | 400 | Body/query invalid |
| `RATE_LIMITED` | 429 | Login/API rate limit (`LOGIN_RATE_LIMIT_*`) |
| `DUPLICATE_RESOURCE` | 409 | Unique constraint |
| `INVALID_TRANSITION` | 409 | Illegal/raced status change |
| `SLA_ACCEPT_EXPIRED` | 409 | Late accept/reject **without** `lateReason` |
| `SLA_ASSIGN_EXPIRED` | 409 | Late assign/reassign **without** `lateReason` |
| `SLA_RESULT_EXPIRED` | 409 | Late submit-result **without** `lateReason` |
| `RULE_ASSESSOR_CLASH` | 409 | Overlapping range, different centre |
| `RULE_TOA_INVALID` | 409 | Missing/expired ToA |
| `RULE_MAX_AAS` | 409 | >4 AAs |
| `RULE_RATIO` | 409 | Over ratio without override. Uses `ratioClass`, not `sector` |
| `RULE_OUTSIDE_RECOGNITION` | 409 | Sector, state, or recognition dates fail, and no `aa_admin` override reason |
| `RULE_ASSESSOR_LANGUAGE` | 409 | Assessor languages omit `assessmentLanguage`, and no `aa_admin` override reason |
| `RESULT_PASS_MARK_INVALID` | 400 | Marks vs max/pass rules |
| `RESULT_OUTCOME_MISMATCH` | 400 | Client `outcome` ≠ server |
| `RESULT_INCOMPLETE` | 409 | Submit missing active roster rows |
| `EVIDENCE_REQUIRED` | 409 | Flag true (Phase 2) |
| `REASSESS_NOT_ELIGIBLE` | 409 | Reassessment rules failed. `details.reason`: `not_published`, `window`, `outcome`, or `type`. Window is one year from the original result’s publication date (Guidelines 4.7) |
| `CONFLICT_IDEMPOTENT` | 409 | Same `clientEventId`, different payload, path, or user |

**Soft SLA:** `aa_admin` may proceed after due with required `lateReason`; server records `sla.breached` + audit. Codes above only when late and reason missing.

---

## Auth

### POST /auth/login

Public. Rate limit: `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS` per IP+email → `429 RATE_LIMITED`.

Request:
```json
{
  "email": "admin@aa.example",
  "password": "********",
  "device": { "deviceId": "dev-9f3a", "platform": "web", "appVersion": "1.0.0" }
}
```

Response `200`:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "rt_8f3c...",
  "expiresInMs": 900000,
  "offlineSessionMaxMs": 259200000,
  "user": {
    "id": "66f000000000000000000001",
    "role": "aa_admin",
    "name": "AA Admin",
    "mustChangePassword": false
  }
}
```

### POST /auth/refresh

Request: `{ "refreshToken": "rt_8f3c...", "device": { "deviceId": "dev-9f3a", "platform": "android", "appVersion": "1.0.0" } }`  
Response `200`: new tokens. `401` if revoked/expired/device mismatch.

### POST /auth/logout

Optional `{ "refreshToken": "..." }`. `204`.

---

## Users

### POST /users

Roles: `aa_admin` | `mis` (no create `aa_admin` for mis).

Request:
```json
{
  "email": "learner1@example.com",
  "name": "Asha Devi",
  "role": "candidate",
  "password": "Temporary-Pass-1",
  "linkedProfileId": "66f0000000000000000000L1"
}
```

Admin-set password → `mustChangePassword: true`. Response `201` without `passwordHash`.

### GET /users, GET /users/:id, PATCH /users/:id

### POST /users/:id/password-reset

Admin set `{ "newPassword": "********" }` → `mustChangePassword: true`, `204`. Or `{ "sendEmail": true }` → `202` queued. Rate-limited.

---

## Learners

`POST /learners`, `GET /learners`, `GET /learners/:id`, `PATCH /learners/:id`

Roles: write `aa_admin` | `mis`; read scoped roles as needed.

Request: `{ "name": "Asha Devi", "externalRef": "TP-REG-10021", "active": true }`

---

## Master data

### Awarding bodies / training partners / centres / qualifications

CRUD as v0.3. Qualification create example:
```json
{
  "code": "Q-ELEC-L4",
  "name": "Electrician L4",
  "sector": "Electronics",
  "ratioClass": "manufacturing",
  "passCriteriaMode": "nos_wise",
  "passMarkUnit": "percent",
  "passMarks": { "theory": 50, "practical": 50, "viva": 50 },
  "maxMarks": null,
  "nos": [
    {
      "nosId": "NOS-01",
      "code": "N01",
      "name": "Safety",
      "maxMarks": { "theory": null, "practical": null, "viva": null },
      "pcs": [{ "pcId": "PC-01", "code": "P1", "name": "PPE" }]
    }
  ]
}
```

When `passMarkUnit: "absolute"`, supply non-null `maxMarks` (and/or per-NOS `maxMarks`).

`sector` is an Annexure II name (SCHEMA §1.5). `ratioClass` is required and is only the assessor-to-learner class. A centre body includes `state` (Annexure IV, SCHEMA §1.6), required.

---

## Batches

### POST /batches

Roles: `ab_reviewer` | `aa_admin`.

Request:
```json
{
  "abId": "66f0000000000000000000ab",
  "qualificationId": "66f0000000000000000000q1",
  "type": "STT",
  "mode": "offline",
  "assessmentStartDate": "2026-11-20",
  "assessmentEndDate": "2026-11-21",
  "tpId": "66f0000000000000000000tp",
  "centreId": "66f0000000000000000000c1",
  "candidateCount": 24,
  "assessmentLanguage": "Hindi"
}
```

`sector` and `ratioClass` are not accepted on this body. The server copies them from the qualification. `state` is copied from the centre. Optional `recognitionOverrideReason` (1–2000 characters) is honoured only for `aa_admin` when §4.3 of the schema fails; otherwise that failure is `RULE_OUTSIDE_RECOGNITION`.

Response `201` (STT; assign due is 7 working days after allocation, result due is 3 working days after the assessment end):
```json
{
  "id": "66f0000000000000000000b1",
  "abId": "66f0000000000000000000ab",
  "qualificationId": "66f0000000000000000000q1",
  "type": "STT",
  "mode": "offline",
  "assessmentStartDate": "2026-11-20",
  "assessmentEndDate": "2026-11-21",
  "tpId": "66f0000000000000000000tp",
  "centreId": "66f0000000000000000000c1",
  "candidateCount": 24,
  "sector": "Electronics",
  "ratioClass": "manufacturing",
  "assessmentLanguage": "Hindi",
  "state": "Maharashtra",
  "learnerFeedback": null,
  "recognitionOverride": null,
  "status": "allocated",
  "statusVersion": 1,
  "assessorId": null,
  "proctorId": null,
  "resultId": null,
  "isReassessment": false,
  "reassessmentOf": null,
  "firstAssessmentBatchId": "66f0000000000000000000b1",
  "sla": {
    "acceptDueAt": "2026-10-12T18:29:59.999Z",
    "assignDueAt": "2026-10-19T18:29:59.999Z",
    "resultDueAt": "2026-11-25T18:29:59.999Z",
    "breached": []
  },
  "allocatedAt": "2026-10-08T08:00:00.000Z",
  "ratioOverride": null
}
```

`GET` responses recompute `sla.breached` for open steps (plus persisted late-action keys). Nightly job refreshes stored breach flags.

An LTT batch with the same dates would set `assignDueAt` to `2026-10-09T18:29:59.999Z` (30 working days before `2026-11-20`) and `resultDueAt` to `2026-11-27T18:29:59.999Z` (5 working days after that exam date). SCHEMA §2.3.

### GET /batches?status=&from=&to=&tpId=&page=&pageSize=

### GET /batches/:id

### POST /batches/:id/accept

Roles: `aa_admin`.

Request: `{ "lateReason": "AB confirmation delayed" }` — `lateReason` **required if** now > `acceptDueAt`; omit if on time.

Response `200`: `accepted`; if late → `sla.breached` includes `accept`, audit logged.

Errors: `SLA_ACCEPT_EXPIRED` (late, no reason), `INVALID_TRANSITION`.

### POST /batches/:id/reject

`{ "reason": "...", "lateReason?: "..." }`. Terminal.

### POST /batches/:id/assign

Roles: `aa_admin`. Transaction + `assessorDayLocks`.

```json
{
  "assessorId": "66f0000000000000000000a1",
  "proctorId": "66f0000000000000000000p1",
  "ratioOverrideReason": "AB approved larger cohort",
  "languageOverrideReason": "AB accepted an assessor briefed by a Hindi-speaking proctor",
  "lateReason": "Assessor travel clearance delayed"
}
```

`languageOverrideReason` is required only when the assessor’s languages do not include `assessmentLanguage`, and only `aa_admin` may send it. Omit it when the language matches.

Errors: `RULE_*` (including `RULE_ASSESSOR_LANGUAGE`) | `SLA_ASSIGN_EXPIRED` | `INVALID_TRANSITION`.

### POST /batches/:id/reassign

Roles: `aa_admin`. From `assessor_assigned` (or `in_progress` if product allows — Phase 1: `assessor_assigned` only unless B-03 extends). Transaction: release old locks, take new locks.

```json
{
  "assessorId": "66f0000000000000000000a2",
  "proctorId": null,
  "languageOverrideReason": "Replacement assessor will be paired with a Hindi speaker",
  "lateReason": "Original assessor unavailable"
}
```

Same language rule as assign.

### POST /batches/:id/cancel

Roles: `aa_admin`. From pre-result statuses (see SCHEMA). Releases locks.

```json
{ "reason": "Centre flooded; AB agreed to cancel" }
```

Response `200`: `status: "cancelled"`, `cancelledAt` set.

### POST /batches/:id/complete

Roles: `aa_admin`. From `in_progress` → `assessment_completed` when checklist/attendance gate is skipped or overridden. **Required** `reason`. Audit-logged. (Owned by **B-03**; assessor checklist path may also reach `assessment_completed` without this call — B-06.)

Request:
```json
{ "reason": "Centre closed early; practical and viva completed; attendance recorded" }
```

Response `200`: Batch `status: "assessment_completed"`, `statusVersion` incremented.

Errors: `400 VALIDATION_ERROR` (missing reason), `409 INVALID_TRANSITION`.

### POST /batches/:id/submit-result

Roles: `aa_admin`. **No body** except optional soft-SLA:

```json
{ "lateReason": "Marks verification with TP took extra day" }
```

Requires `results.status=draft` with a row per **active** candidate → else `RESULT_INCOMPLETE`. Batch → `result_submitted`; result → `submitted`.

### POST /batches/:id/validate / publish / dispute / resolve-dispute

Owned by **B-05**. AB validate/publish; pre-publication dispute/resolve (see SCHEMA).

### POST /batches/:id/reassessments

Roles: `aa_admin` (initiator open Q22). New batch. Inherits `abId`, `qualificationId`, `type`, `mode`, `tpId`, `sector`, `ratioClass`, and `assessmentLanguage` from the parent. The request may set `assessmentLanguage`. Sets `firstAssessmentBatchId` from the root. The window is one year from the **publication** date of the original result (`publishedAt` on the root batch’s result), not from the assessment end. Guidelines 4.7. An unpublished original result is `REASSESS_NOT_ELIGIBLE` with `details.reason: "not_published"`. Recognition (§4.3) runs on this create as well.

```json
{
  "assessmentStartDate": "2027-02-01",
  "assessmentEndDate": "2027-02-01",
  "centreId": "66f0000000000000000000c1",
  "learnerIds": ["66f0000000000000000000L2"]
}
```

Response `201` new Batch. Errors: `REASSESS_NOT_ELIGIBLE`, `RULE_OUTSIDE_RECOGNITION`.

### PUT /batches/:id/learner-feedback

Owned by **B-10**. Roles: `aa_admin` | `mis`. Batch status must be `assessment_completed` or later (not `rejected` or `cancelled`). Does not change status.

```json
{ "collected": false, "reason": "Learners had left before the form was handed out" }
```

`collected: true` requires `reason` null or omitted. `collected: false` requires `reason` (1–2000 characters). Response `200`: the batch, with `learnerFeedback` set. Audit-logged. Annexure IX(a) Governance & Manpower sub-parameter 4 (docs/ERF.md row 26).

### PUT /batches/:id/assessor-payment

Owned by **B-11**. Roles: write `aa_admin` | `mis`. The batch must already have `assessorId`. Does not change status.

```json
{
  "assessorId": "66f0000000000000000000a1",
  "amountDue": 4500,
  "amountPaid": 2000,
  "logisticsNote": "Rail ticket booked; boarding at the centre guest room"
}
```

`assessorId` must be the current or a previous assessor on this batch. Server sets `pending` to `amountDue - amountPaid`. Response `200`:

```json
{
  "id": "66f0000000000000000000pay",
  "batchId": "66f0000000000000000000b1",
  "assessorId": "66f0000000000000000000a1",
  "amountDue": 4500,
  "amountPaid": 2000,
  "pending": 2500,
  "logisticsNote": "Rail ticket booked; boarding at the centre guest room"
}
```

`GET /batches/:id/assessor-payments` returns `{ "items": [ ... ] }` for `aa_admin`, `mis`, `ncvet_viewer`, and `ab_reviewer` (own `abId` only). Annexure IX(a) Financials sub-parameter 3 (docs/ERF.md row 19).

### GET|PUT /admin/recognition

Roles: write `aa_admin` | `mis`; read those plus `ncvet_viewer`. Audit on `PUT`. Does not rewrite existing batches.

```json
{
  "sectors": ["Electronics", "Construction"],
  "panIndia": false,
  "states": ["Maharashtra", "Gujarat"],
  "startDate": "2026-04-01",
  "endDate": "2029-03-31"
}
```

`panIndia: true` requires `states: []`. Response `200` is that object plus `id` after the first `PUT`. `GET` before any `PUT` is `404` (batch create then fails with `RULE_OUTSIDE_RECOGNITION` and `details.checks: ["unconfigured"]`). `sectors` values are Annexure II names (§1.5). `states` values are Annexure IV names (§1.6).

### Batch child reads

Roles: scoped batch readers.

- `GET /batches/:id/login-events?from=&to=&actorType=`
- `GET /batches/:id/attendance`
- `GET /batches/:id/checklist` — latest or list by `capturedAt`

---

## Batch candidates

### POST /batches/:id/candidates

```json
{
  "learnerId": "66f0000000000000000000L1",
  "accommodations": []
}
```

Creates roster row (name/externalRef from learner). Or `{ "name", "externalRef" }` to upsert learner then link.

### GET /batches/:id/candidates

### PATCH /batches/:id/candidates/:candidateId

`{ "active": false }` deactivate; or update accommodations. Soft-delete only (no hard delete in Phase 1).

### POST /batches/:id/candidates/import

CSV: `name,externalRef` (creates/links learners). Response `{ created, skipped, errors[] }`.

---

## Assessors / Proctors

CRUD includes `languages: string[]` on assessors (trimmed; may be empty). `GET /assessors/available?from=&to=&languages=&batchId=` is unchanged aside from that field.

---

## Assessor field app

### POST /assessor/login-event

Owned by **B-06** / **B-06b**. Role: `assessor`. Login and logout, geo-tagged (NCVET:TR s9, s26).

Request (captured location):
```json
{
  "clientEventId": "5f0c1c9e-6f0b-4c1e-9a55-0d6b8f2f7a11",
  "batchId": "66f0000000000000000000b1",
  "type": "login",
  "capturedAt": "2026-11-20T05:00:00.000Z",
  "lat": 19.076012345,
  "lng": 72.877654321,
  "accuracy": 12.5,
  "locationStatus": "captured",
  "device": { "deviceId": "dev-9f3a", "platform": "android", "appVersion": "1.0.0" }
}
```

Request (GPS unavailable, or batch not yet attached):
```json
{
  "clientEventId": "5f0c1c9e-6f0b-4c1e-9a55-0d6b8f2f7a12",
  "batchId": null,
  "type": "login",
  "capturedAt": "2026-11-20T05:00:00.000Z",
  "locationStatus": "unavailable",
  "locationUnavailableReason": "position_unavailable",
  "locationUnavailableDetail": "GPS fix timed out",
  "device": { "deviceId": "dev-9f3a", "platform": "android", "appVersion": "1.0.0" }
}
```

- `clientEventId` (1–200 characters) is made on the device and is the idempotency key.
- `capturedAt` is the device clock, ISO-8601 with `Z` or an offset.
- `batchId` is a Batch ObjectId or `null`. When `null`, the event is stored, and assigned-actor, status, date-window checks, batch transition, and AB email are skipped.
- `locationStatus`: `"captured"` or `"unavailable"`.
  - When `"captured"` (or omitted): `lat` (−90..90) and `lng` (−180..180) are required. `accuracy` (metres, ≥ 0) is optional. `locationUnavailableReason` and `locationUnavailableDetail` must be absent.
  - When `"unavailable"`: `locationUnavailableReason` is required (1–200 characters). `locationUnavailableDetail` is optional. `lat`, `lng`, and `accuracy` must be absent. Never blocks login.
- `device` is optional. Unknown keys are `400 VALIDATION_ERROR`, including server-owned fields (`receivedAt`, `clockSkewMs`, `lateSync`, …).

Response `200` (first submission and replays alike):
```json
{
  "id": "66f0000000000000000000e1",
  "clientEventId": "5f0c1c9e-6f0b-4c1e-9a55-0d6b8f2f7a11",
  "actorType": "assessor",
  "actorId": "66f0000000000000000000a1",
  "candidateId": null,
  "batchId": "66f0000000000000000000b1",
  "type": "login",
  "locationStatus": "captured",
  "lat": 19.076012345,
  "lng": 72.877654321,
  "accuracy": 12.5,
  "locationUnavailableReason": null,
  "locationUnavailableDetail": null,
  "missingGpsFix": false,
  "noGpsFix": false,
  "capturedAt": "2026-11-20T05:00:00.000Z",
  "receivedAt": "2026-11-22T10:00:00.000Z",
  "clockSkewMs": 190800000,
  "clockSkewFlag": true,
  "lateSync": true,
  "device": { "deviceId": "dev-9f3a", "platform": "android", "appVersion": "1.0.0" },
  "syncedAt": "2026-11-22T10:00:00.000Z",
  "abEmailQueuedAt": "2026-11-22T10:00:00.000Z",
  "abEmailSentAt": null,
  "replayed": false
}
```

`actorId` is the caller's `linkedProfileId` (assessor, proctor, or learner). `clockSkewMs` is `receivedAt − capturedAt`. `clockSkewFlag` is true when its absolute value is over `MAX_CLOCK_SKEW_MS`. `lateSync` is true when the IST date of `receivedAt` is after the IST date of `capturedAt`. Neither flag rejects the event. `missingGpsFix` / `noGpsFix` flag events without a fix for reporting. `accuracy`, `candidateId`, `batchId`, `lat`, `lng`, `locationUnavailableReason`, `locationUnavailableDetail`, and `device` are `null` when absent.

**Idempotency.** The same `clientEventId` with the same payload from the same user returns the stored event with `replayed: true` and writes nothing new (no second event, status change, or email). A replay is not re-validated, so a queued resend still succeeds after the batch has moved on. The same `clientEventId` with a different payload, a different path, or a different user is `409 CONFLICT_IDEMPOTENT`.

**Validation (first submission), in this order:**

| Check | Failure |
|---|---|
| Body shape (types, required coordinates when captured, reason when unavailable) | `400 VALIDATION_ERROR` |
| Role matches the path | `403 FORBIDDEN` |
| If `batchId` is present: Batch exists | `404 NOT_FOUND` |
| If `batchId` is present: Caller is the batch's `assessorId` | `403 FORBIDDEN` |
| If `batchId` is present: Batch status is `assessor_assigned`, `in_progress`, `assessment_completed`, `result_submitted`, `ab_validated`, `published`, or `disputed` | `409 INVALID_TRANSITION` |
| If `batchId` is present: IST date of `capturedAt` is within `assessmentStartDate`..`assessmentEndDate`, inclusive | `400 VALIDATION_ERROR` with `details.capturedAt` |

If `batchId` is `null`, batch lookup, assignment, status, and date-window checks are skipped.

**Status.** The first valid assessor event of `type: "login"` on an `assessor_assigned` batch moves it to `in_progress` (`statusVersion` + 1, audit `batch.login-event`). Logout, proctor, student events, and events with `batchId: null` never change batch status.

**AB email.** An assessor `login` with a batch attached **enqueues** one `emailQueue` job (`kind: "assessor_login"`) to the AB's `notificationEmails`, with `capturedAt` and location (or unavailable reason) in the body, and sets `abEmailQueuedAt`. When `batchId` is `null`, no email is queued. Enqueue failure never fails this call: the response is still `200` with `abEmailQueuedAt: null`, and a replay of that event tries the enqueue again. Logout does not send mail. Worker/SMTP (B-08) delivers asynchronously. `abEmailSentAt` stays `null` (open Q107).

**Audit.** `loginEvent.create` or `loginEvent.replay` with the event as `after`. No mail body or recipients.

### POST /proctor/login-event / POST /student/login-event

Same request, response, idempotency, and validation. Roles: `proctor` on the proctor path; `candidate` on the student path (`actorType: "student"`). When `batchId` is present: proctor must be the batch's `proctorId`; student's learner must have an **active** roster row on the batch (returned as `candidateId`). When `batchId` is `null`, those batch checks are skipped. No status change and no AB email.

### POST /assessor/batches/:id/attendance | checklist

Unchanged write shapes.

---

## Results

### PUT /batches/:id/results

Roles: `aa_admin`. **Only if** batch=`assessment_completed` and result=`draft` (or none yet → create draft).

Request — omit `outcome`; do not send conflicting `absent`:
```json
{
  "rows": [
    {
      "candidateId": "66f0000000000000000000k1",
      "nos": [{ "nosId": "NOS-01", "theory": 70, "practical": 80, "viva": 75 }]
    },
    {
      "candidateId": "66f0000000000000000000k2",
      "nos": []
    }
  ]
}
```

Server sets `outcome` from marks + **attendance** (`Absent` if `present=false`). Response includes computed outcomes, `status: "draft"`.

Errors: `INVALID_TRANSITION`, `RESULT_PASS_MARK_INVALID`, `RESULT_OUTCOME_MISMATCH`, `VALIDATION_ERROR` (absent conflict).

### GET /batches/:id/results

Scoped; **candidate** sees own row only.

### GET /results/:id/change-log

`aa_admin` | `ab_reviewer` | `mis`.

---

## Working days / holidays

### GET|PUT /admin/working-day-config

Counting: SCHEMA §2.1. Example anchor **Tuesday 06 Oct 2026**, N=2 → due end of Thu 08 Oct IST.

### GET|POST|DELETE /admin/holidays

Example: `{ "date": "2026-10-02", "name": "Gandhi Jayanti", "region": null }`.

All holiday mutations **audit-logged**. Do **not** recompute existing batch `sla.*DueAt` values.

---

## Audit

### GET /audit-logs?entity=&entityId=&from=&to=&page=

- `aa_admin` | `mis`: all  
- `ab_reviewer`: entities related to own `abId` batches  
- `ncvet_viewer`: read-only all (monitoring)

Secrets redacted. Append-only.

---

## Compliance stubs

`GET /compliance/dashboard`; ERF/risk-plan Phase 3.

---

## Phase 2+ stubs

Evidence, questions/tests, proctoring, grievances, analytics, public site, accessibility, security — unchanged intent; see SCHEMA. Recognition and Annexure II sectors are Phase 1 (`/admin/recognition`, `qualifications.sector`). ERF weights are in docs/ERF.md (task C-01). Phase 2 notes that are not endpoints yet: live NCVET monitoring link, geo-tagged photos and videos for offline and blended batches (Guidelines 4.11b), the 24-hour travel rule, theory-only online batches with no assessor, and gender-parity staff reporting (open questions 80–84).
