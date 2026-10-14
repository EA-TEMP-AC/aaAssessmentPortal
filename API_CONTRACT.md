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
| `RESULT_INCOMPLETE` | 409 | Submit with an active roster candidate that has no row, or a row with marks missing |
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

### POST /auth/change-password

Owned by **B-13** (Q31). Any signed-in role, for their own password. Needs the access token.

Request:
```json
{
  "currentPassword": "Temporary-Pass-1",
  "newPassword": "Battery-Staple-7",
  "refreshToken": "rt_8f3c..."
}
```

- `currentPassword` (1–200 characters) and `newPassword` (8–200 characters) are required. `newPassword` must differ from `currentPassword`.
- `refreshToken` is optional: the refresh token of the session making the call. That token stays valid and every other refresh token of the user is revoked. When it is omitted, or is not an active token of this user, every refresh token of the user is revoked, including this session's.
- Unknown keys are `400 VALIDATION_ERROR`.

Response `200`:
```json
{
  "user": {
    "id": "66f000000000000000000001",
    "role": "assessor",
    "name": "Asha Devi",
    "mustChangePassword": false
  }
}
```

The new password is stored hashed and `mustChangePassword` becomes `false`. No new tokens are issued; the access token in use keeps working until it expires. Access tokens already issued to other devices also work until they expire (`ACCESS_TOKEN_TTL_MS`), and those devices cannot refresh.

| Check, in this order | Failure |
|---|---|
| Access token | `401 UNAUTHORIZED` |
| Body shape | `400 VALIDATION_ERROR` |
| Rate limit: `LOGIN_RATE_LIMIT_MAX` attempts per `LOGIN_RATE_LIMIT_WINDOW_MS`, per user. Every attempt counts, right or wrong | `429 RATE_LIMITED` |
| `currentPassword` is the user's password | `400 VALIDATION_ERROR` with `details.currentPassword`. Not `401`, so a client does not treat it as an expired session |
| `newPassword` differs from `currentPassword` | `400 VALIDATION_ERROR` with `details.newPassword` |

**Audit.** `auth.password_changed` (entity `user`, the user as actor, `meta.revokedRefreshTokens`, `meta.keptCurrentSession`). A wrong current password writes `auth.password_change_failed` and a rate-limit block writes `auth.password_change_rate_limited`. No row holds a password, a hash, or a token: the request body is stored with those fields as `"***"`.

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

Roles: `aa_admin`. From `in_progress` → `assessment_completed` when checklist/attendance gate is skipped or overridden. **Required** `reason`. Audit-logged. (Owned by **B-03**; the assessor checklist path also reaches `assessment_completed` without this call — see `POST /assessor/batches/:id/checklist`, B-06c.)

Request:
```json
{ "reason": "Centre closed early; practical and viva completed; attendance recorded" }
```

Response `200`: Batch `status: "assessment_completed"`, `statusVersion` incremented.

Errors: `400 VALIDATION_ERROR` (missing reason), `409 INVALID_TRANSITION`.

### POST /batches/:id/submit-result

Owned by **B-05**. Roles: `aa_admin`. **No body** except optional soft-SLA:

```json
{ "lateReason": "Marks verification with TP took extra day" }
```

Unknown keys are `400 VALIDATION_ERROR`. The server recomputes every outcome from the stored marks, the attendance rows, and the qualification as it is now, then moves batch `assessment_completed` → `result_submitted` and result `draft` → `submitted` in one transaction, and writes a change-log row (`action: "submit"`, with any row whose outcome changed on recompute).

Response `200`: the result object (see `PUT /batches/:id/results`) with `status: "submitted"`, `submittedAt`, `submittedBy`, plus `batchStatus` and `batchStatusVersion`.

| Check, in this order | Failure |
|---|---|
| Role is `aa_admin` | `403 FORBIDDEN` |
| Batch exists | `404 NOT_FOUND` |
| Batch status is `assessment_completed` | `409 INVALID_TRANSITION` |
| A draft exists, every **active** roster candidate has a row, and every row has an outcome | `409 RESULT_INCOMPLETE` with `details.missingCandidates` (no row) and `details.incompleteMarks` (row with marks still missing), both arrays of candidate ids |
| Now is on or before `resultDueAt`, or `lateReason` is sent | `409 SLA_RESULT_EXPIRED` |

A late submit with `lateReason` adds `result` to `sla.breached`, appends `sla.lateActions`, and writes audit `sla_late_submit` (`meta.reason`, `meta.key: "result"`). A deactivated roster row is not required.

**Audit.** `batch.submit-result` (batch status before and after) and `result.submit` (result header before and after, no rows).

### POST /batches/:id/validate, POST /batches/:id/publish

Owned by **B-05**. Roles: `ab_reviewer`, and only when the batch `abId` equals the reviewer's `abId`. Any other role, a reviewer of another awarding body, and a reviewer with no `abId` are `403 FORBIDDEN`.

Request: optional `{ "reason": "Checked against the marks sheet" }` (1–2000 characters), stored on the change-log row. Unknown keys are `400`.

- `validate`: batch `result_submitted` → `ab_validated`; result `submitted` → `validated`; sets `validatedAt`, `validatedBy`.
- `publish`: batch `ab_validated` → `published`; result `validated` → `published`; sets `publishedAt`, `publishedBy`. `publishedAt` is the reassessment window anchor (Guidelines 4.7, SCHEMA §4.2, B-09).

Response `200`: the result object plus `batchStatus` and `batchStatusVersion`. Any other batch or result status is `409 INVALID_TRANSITION` (publish before validate, a repeat call). Unknown batch is `404`. Each call is one transaction and writes a change-log row (`validate` or `publish`).

**Audit.** `batch.validate` / `batch.publish` and `result.validate` / `result.publish`.

### POST /batches/:id/return-for-correction

Owned by **B-05b** (decided 2026-10-12, Q127). Roles: `ab_reviewer`, and only when the batch `abId` equals the reviewer's `abId`. Any other role, a reviewer of another awarding body, and a reviewer with no `abId` are `403 FORBIDDEN`.

```json
{ "reason": "NOS-02 theory marks do not match the marks sheet" }
```

`reason` is required (1–2000 characters after trimming). A missing or blank reason and unknown keys are `400 VALIDATION_ERROR`.

Moves batch `result_submitted` or `ab_validated` → `assessment_completed`, and result `submitted` or `validated` → `draft`, in one transaction. `statusVersion` increments. The rows and their outcomes are kept. `submittedAt`, `submittedBy`, `validatedAt`, and `validatedBy` are set to `null`. `aa_admin` can then `PUT /batches/:id/results` and `POST /batches/:id/submit-result` again; the usual submit checks apply, including the soft SLA on the stored `resultDueAt`.

Response `200`: the result object with `status: "draft"`, plus `batchStatus: "assessment_completed"` and `batchStatusVersion`.

| Check, in this order | Failure |
|---|---|
| Role is `ab_reviewer` | `403 FORBIDDEN` |
| Body has a `reason` | `400 VALIDATION_ERROR` |
| Batch exists | `404 NOT_FOUND` |
| Batch `abId` is the reviewer's `abId` | `403 FORBIDDEN` |
| Batch status is `result_submitted` or `ab_validated`, and the result status matches it | `409 INVALID_TRANSITION` |

A `published` result cannot be returned (`409 INVALID_TRANSITION`). So are a draft and a repeat call.

**Change log.** One row: `action: "return"`, `fromStatus` `submitted` or `validated`, `toStatus: "draft"`, the `reason`, and empty `changes`. **Audit.** `batch.return-for-correction` (batch status before and after) and `result.return` (result header before and after, no rows), both with `meta.reason`.

### POST /batches/:id/dispute, POST /batches/:id/resolve-dispute

**Not mounted (`404`).** Disputes are deferred (B-05 decision, 2026-10-12). The `disputed` status and its rows stay in SCHEMA §1.2 and the transition table for a later task; no Phase 1 call reaches them.

### POST /batches/:id/reassessments

Owned by **B-09**. Roles: `aa_admin`, or `ab_reviewer` when the batch `abId` equals the reviewer's `abId` (Q22, decided 2026-10-13). Any other role, a reviewer of another awarding body, and a reviewer with no `abId` are `403 FORBIDDEN`. `:id` is the batch being reassessed (the parent). Guidelines 4.7; SCHEMA §4.2.

```json
{
  "assessmentStartDate": "2027-02-01",
  "assessmentEndDate": "2027-02-01",
  "centreId": "66f0000000000000000000c1",
  "learnerIds": ["66f0000000000000000000L2"],
  "assessmentLanguage": "Hindi",
  "recognitionOverrideReason": "NCVET extension letter on file"
}
```

- `assessmentStartDate` and `assessmentEndDate` are required (`YYYY-MM-DD`, end ≥ start).
- `centreId` is optional and defaults to the parent's centre. It must be a centre of the parent's training partner (`400 VALIDATION_ERROR` otherwise). `state` is copied from that centre.
- `learnerIds` is optional (1–500). When omitted, every learner whose outcome on the parent is `Fail` or `Absent` is taken.
- `assessmentLanguage` is optional and defaults to the parent's.
- `recognitionOverrideReason` works as on `POST /batches` (`aa_admin` only).
- Unknown keys are `400 VALIDATION_ERROR`. `abId`, `qualificationId`, `type`, `mode`, `tpId`, `sector`, and `ratioClass` cannot be sent.

Response `201`: a new Batch (the `POST /batches` shape) with `status: "allocated"`, `statusVersion: 1`, `isReassessment: true`, `reassessmentOf` = the parent id, and `firstAssessmentBatchId` = the parent's `firstAssessmentBatchId` (the root). It inherits `abId`, `qualificationId`, `type`, `mode`, `tpId`, `sector`, `ratioClass`, `assessmentLanguage`, and `accommodations` from the parent; `sector` and `ratioClass` are the parent's stored values and are not re-read from the qualification. `allocatedAt` is now and the three `sla` due instants are computed as on create. `candidateCount` is the number of roster rows copied. The parent batch is not changed.

**Roster.** One `candidates` row per learner taken, copied from the parent row (`learnerId`, `name`, `externalRef`, `accommodations`), `active: true`, with `sourceOriginalCandidateId` pointing at the learner's row on the first assessment. The batch and its roster are written in one transaction.

**Window.** `windowStart` is the IST calendar date of `publishedAt` on the result of the first assessment (`firstAssessmentBatchId`, not the parent when there is a chain). `windowEnd` is the same date `REASSESS_WINDOW_YEARS` (1) later; 29 February becomes 28 February. `assessmentStartDate` must satisfy `windowStart ≤ assessmentStartDate ≤ windowEnd`. `assessmentEndDate` is not checked against the window. Example: published `2026-11-25T19:00:00.000Z` is `2026-11-26` in IST, so the start may be `2026-11-26` through `2027-11-26`.

| Check, in this order | Failure |
|---|---|
| Role is `aa_admin` or `ab_reviewer` | `403 FORBIDDEN` |
| Body shape | `400 VALIDATION_ERROR` |
| Parent batch exists | `404 NOT_FOUND` |
| Reviewer's `abId` is the batch `abId` | `403 FORBIDDEN` |
| Parent batch is `published` and its result is `published`; the first assessment's result is `published` | `409 REASSESS_NOT_ELIGIBLE`, `details: { "reason": "not_published" }` |
| Start date inside the window | `409 REASSESS_NOT_ELIGIBLE`, `details: { "reason": "window", "windowStart": "2026-11-26", "windowEnd": "2027-11-26" }` |
| Every named learner is `Fail` or `Absent` on the parent, and at least one learner is taken | `409 REASSESS_NOT_ELIGIBLE`, `details: { "reason": "outcome", "learnerIds": [ ... ] }` (the refused ids; empty when the parent has nobody to reassess) |
| Centre exists, has a state, and belongs to the parent's training partner | `400 VALIDATION_ERROR` with `details.centreId` |
| Recognition (SCHEMA §4.3), with the parent's `sector` and the centre's `state` | `409 RULE_OUTSIDE_RECOGNITION` |

`details.reason: "type"` is reserved and is not returned yet (open Q140).

**Audit.** `batch.reassess` on the new batch: `actorId` and `actorRole` are the initiator, `after` is the new batch, and `meta` holds `reassessmentOf`, `firstAssessmentBatchId`, `originalPublishedAt`, `windowStart`, `windowEnd`, and `learnerIds`. A recognition override also writes `recognition_override`.

### PUT /batches/:id/learner-feedback

Owned by **B-10**. Roles: `aa_admin` | `mis`. Everyone else is `403`. The batch status must be `assessment_completed`, `result_submitted`, `ab_validated`, `published`, or `disputed`; any other status is `409 INVALID_TRANSITION`. Does not change status or `statusVersion`. One record per batch: each PUT replaces it.

```json
{ "collected": false, "reason": "Learners had left before the form was handed out", "note": "Optional free text" }
```
```json
{ "collected": true, "note": "Forms returned by all learners", "collectedOn": "2026-11-21" }
```

| Field | Rule |
|---|---|
| `collected` | Required boolean |
| `reason` | Required (1–2000 characters) when `collected` is `false`; must be null or omitted when `true` |
| `note` | Optional, 1–2000 characters |
| `collectedOn` | Optional `YYYY-MM-DD` (IST calendar date); only with `collected: true` |

Unknown keys, a missing `reason`, a `reason` with `collected: true`, or a `collectedOn` with `collected: false` are `400 VALIDATION_ERROR` with `details` naming the field. An unknown batch is `404`; a batch outside the caller's scope is `403`.

Response `200`: the batch, with `learnerFeedback` set to `{ collected, reason, note, collectedOn, recordedBy, recordedAt }` (`reason`, `note`, `collectedOn` are `null` when absent; `recordedBy` is the caller, `recordedAt` the write time). **Audit:** `batch.learner_feedback` on the batch, with `before` and `after` each `{ learnerFeedback }`. Annexure IX(a) Governance & Manpower sub-parameter 4 (docs/ERF.md row 26).

### GET /batches/:id/learner-feedback

Roles: `aa_admin`, `mis`, `ncvet_viewer` (all batches), `ab_reviewer` (own awarding body), `assessor` (assigned batch), `proctor` (assigned batch). `candidate`, `tp`, and `sme` get `403`. Any batch status; unknown id `404`; outside scope `403`.

Response `200`: `{ "batchId": "...", "learnerFeedback": null }` until recorded, otherwise `learnerFeedback` is the object above. The same object is in `learnerFeedback` on `GET /batches/:id`.

### PUT /batches/:id/assessor-payment

Owned by **B-11**. Roles: `aa_admin` | `mis`. The batch must already have `assessorId`, else `409 INVALID_TRANSITION`. Does not change batch status. One row per batch and assessor, replaced on each PUT.

```json
{
  "amountDue": 4500,
  "amountPaid": 2000,
  "logisticsNote": "Rail ticket booked; boarding at the centre guest room"
}
```

| Field | Rule |
|---|---|
| `amountDue` | Required number of rupees, at least 0, at most 2 decimal places |
| `amountPaid` | Required, same rules, and not above `amountDue` (`400 VALIDATION_ERROR`, `details.amountPaid`) |
| `logisticsNote` | Optional, up to 2000 characters |
| `assessorId` | Optional. Defaults to the batch's current assessor. May name a previous assessor only when that assessor already has a row on this batch; otherwise `400 VALIDATION_ERROR` |

`pending` is set by the server to `amountDue - amountPaid` and is never accepted: a body that contains it is `400 VALIDATION_ERROR`. Unknown keys are `400`. Unknown batch is `404`. Response `200`:

```json
{
  "id": "66f0000000000000000000pay",
  "batchId": "66f0000000000000000000b1",
  "assessorId": "66f0000000000000000000a1",
  "amountDue": 4500,
  "amountPaid": 2000,
  "pending": 2500,
  "logisticsNote": "Rail ticket booked; boarding at the centre guest room",
  "updatedBy": "66f0000000000000000000u1",
  "updatedAt": "2026-11-21T10:00:00.000Z"
}
```

`logisticsNote` is `null` when absent. **Audit:** `assessor_payment.save` on entity `assessorPayment`, with `batchId`, the batch's `abId`, and `before` (absent on first write) and `after` set to the row.

### GET /assessor-payments and GET /batches/:id/assessor-payments

Roles: `aa_admin`, `mis`, and `ncvet_viewer` read all rows. `assessor` reads only rows whose `assessorId` is their own `linkedProfileId`. `ab_reviewer`, `proctor`, `tp`, `candidate`, and `sme` get `403`. The first path lists across batches; the second is limited to one batch (unknown id `404`).

Query: `page` (default 1), `pageSize` (default 20, max 100), `assessorId`, `pendingOnly` (`true` returns rows with `pending > 0`; `false` is the same as omitted). Unknown or malformed values are `400 VALIDATION_ERROR`. An assessor who passes another assessor's `assessorId` gets an empty page. Newest `updatedAt` first.

Response `200`: `{ "page", "pageSize", "total", "items": [ <row as above> ] }`. Annexure IX(a) Financials sub-parameter 3 (docs/ERF.md row 19).

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

Owned by **B-06c**. Roles: the batch read roles (`aa_admin`, `mis`, `assessor`, `proctor`, `candidate`, `tp`, `ab_reviewer`, `ncvet_viewer`), each in their batch row scope (SCHEMA §5). `sme` is `403`. Unknown batch id is `404`. An existing batch outside the caller's scope is `403`. Every response is `200` `{ "items": [ ... ] }` with no paging.

- `GET /batches/:id/login-events?from=&to=&actorType=`: login events for the batch, oldest `capturedAt` first. Items are the login-event response object without `replayed`. `from` and `to` are ISO-8601 instants (with `Z` or an offset), inclusive bounds on `capturedAt`; `from` after `to` is `400`. `actorType` is `assessor`, `proctor`, or `student`. A `candidate` gets only their own student events.
- `GET /batches/:id/attendance`: the attendance rows (shape below), ordered by `candidateId`. A `candidate` gets only their own row.
- `GET /batches/:id/checklist`: every checklist submission (shape below, without `replayed`, `batchStatus`, and `batchStatusVersion`), newest `capturedAt` first. `?latest=true` returns only the newest one. A `latest` value other than `true` or `false` is `400`.

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

### POST /assessor/batches/:id/attendance

Owned by **B-06c**. Role: `assessor`, and only the batch's `assessorId`. Candidate attendance and identity check (NCVET:FR §E).

Request:
```json
{
  "capturedAt": "2026-11-20T05:00:00.000Z",
  "records": [
    { "candidateId": "66f0000000000000000000k1", "present": true, "idVerified": true },
    { "candidateId": "66f0000000000000000000k2", "present": false, "note": "Did not report" }
  ]
}
```

- `capturedAt` is the device clock, ISO-8601 with `Z` or an offset.
- `records` holds 1–500 rows. A `candidateId` may appear once. Each must be an **active** roster row on this batch.
- `present` is required. `idVerified` (boolean) and `note` (1–500 characters) are optional. `idVerified` is a yes/no only; no ID number is accepted.
- Unknown keys are `400 VALIDATION_ERROR`, including server-owned fields.

Response `200`: the stored rows for the candidates in the request.
```json
{
  "items": [
    {
      "id": "66f0000000000000000000t1",
      "batchId": "66f0000000000000000000b1",
      "candidateId": "66f0000000000000000000k1",
      "present": true,
      "idVerified": true,
      "note": null,
      "capturedAt": "2026-11-20T05:00:00.000Z",
      "receivedAt": "2026-11-20T05:00:02.000Z",
      "assessorId": "66f0000000000000000000a1"
    }
  ]
}
```

There is one row per candidate per batch. A later submission replaces the row (omitted `idVerified` and `note` become `null`). A submission whose `capturedAt` is older than the stored row leaves that row as it is, and the response shows the stored row. A candidate with `present: false` takes the result outcome `Absent` (B-05). Attendance alone never changes batch status.

| Check, in this order | Failure |
|---|---|
| Body shape | `400 VALIDATION_ERROR` |
| Role is `assessor` | `403 FORBIDDEN` |
| Batch exists | `404 NOT_FOUND` |
| Caller is the batch's `assessorId` | `403 FORBIDDEN` |
| Batch status is `in_progress` | `409 INVALID_TRANSITION` |
| IST date of `capturedAt` is within `assessmentStartDate`..`assessmentEndDate`, inclusive | `400 VALIDATION_ERROR` with `details.capturedAt` |
| Every `candidateId` is an active roster row on this batch | `400 VALIDATION_ERROR` with `details.records` |

**Audit.** `attendance.record` with the previous rows as `before` and the stored rows as `after`.

### POST /assessor/batches/:id/checklist

Owned by **B-06c**. Role: `assessor`, and only the batch's `assessorId`. Tool and equipment check (NCVET:FR §E), and the step that completes the assessment.

Request:
```json
{
  "clientEventId": "0b6b8b6e-52d1-4f0c-9a3e-6f8d2f4f1c20",
  "capturedAt": "2026-11-21T11:30:00.000Z",
  "items": [
    { "key": "multimeter", "label": "Digital multimeter", "available": true },
    { "key": "soldering-station", "available": false, "note": "One of two units faulty" }
  ],
  "completeAssessment": true
}
```

- `clientEventId` (1–200 characters) is made on the device and is the idempotency key.
- `items` holds 1–200 rows. `key` (1–100 characters) may appear once. `available` is required. `label` (1–200) and `note` (1–500) are optional. Keys are not checked against a Q File list (open Q14).
- `completeAssessment` is optional and defaults to `false`.
- Unknown keys are `400 VALIDATION_ERROR`.

Response `200` (first submission and replays alike):
```json
{
  "id": "66f0000000000000000000h1",
  "clientEventId": "0b6b8b6e-52d1-4f0c-9a3e-6f8d2f4f1c20",
  "batchId": "66f0000000000000000000b1",
  "assessorId": "66f0000000000000000000a1",
  "items": [
    { "key": "multimeter", "label": "Digital multimeter", "available": true, "note": null },
    { "key": "soldering-station", "label": null, "available": false, "note": "One of two units faulty" }
  ],
  "completeAssessment": true,
  "capturedAt": "2026-11-21T11:30:00.000Z",
  "receivedAt": "2026-11-21T11:30:03.000Z",
  "replayed": false,
  "batchStatus": "assessment_completed",
  "batchStatusVersion": 5
}
```

`batchStatus` and `batchStatusVersion` are the batch as it is after this call.

**Status.** With `completeAssessment: true` the batch moves `in_progress` → `assessment_completed` (`statusVersion` + 1, audit `batch.checklist`). Every **active** roster candidate must already have an attendance row; otherwise `409 INVALID_TRANSITION` with `details.missingAttendance` (candidate ids) and the checklist is not stored. An item with `available: false` does not block the move. Without the flag the checklist is stored and the batch does not move. The checklist row and the status change are one transaction: if the status change loses a race, the call is `409 INVALID_TRANSITION` and nothing is stored.

**Idempotency.** The same `clientEventId` with the same payload from the same user on the same batch returns the stored checklist with `replayed: true` and writes nothing new. A replay is not re-validated, so a queued resend still succeeds after the batch has completed. A different payload, batch, or user is `409 CONFLICT_IDEMPOTENT`.

**Validation (first submission).** The same checks, in the same order, as attendance up to the `capturedAt` window, then the attendance gate when `completeAssessment` is true.

**Audit.** `checklist.create` or `checklist.replay` with the checklist as `after`, and `batch.checklist` for the status change.

---

## Results

Owned by **B-05**. Code is in `server/src/modules/results/`.

### PUT /batches/:id/results

Roles: `aa_admin`. **Only if** batch=`assessment_completed` and result=`draft` (or none yet → create draft). A result returned for correction (B-05b) is a draft again. Any other batch or result status is `409 INVALID_TRANSITION`.

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
  ],
  "changeReason": "Marks sheet received from the assessor"
}
```

- The body **replaces** the draft rows. A candidate left out of `rows` has no row afterwards. `rows` holds 0–500 rows; a `candidateId` may appear once and must be an **active** roster row on this batch.
- `nos` holds 0–200 entries; a `nosId` may appear once and must be on the batch's qualification. `theory`, `practical`, and `viva` are numbers ≥ 0, or `null` / omitted while the mark is not known yet.
- `absent` (boolean) and `outcome` (`Pass` | `Fail` | `Absent`) are optional and are only checked, never trusted.
- `changeReason` (1–2000 characters) is optional and is stored on the change-log row.
- Unknown keys are `400 VALIDATION_ERROR`.

Response `200`:
```json
{
  "id": "66f0000000000000000000r1",
  "batchId": "66f0000000000000000000b1",
  "status": "draft",
  "rows": [
    {
      "candidateId": "66f0000000000000000000k1",
      "absent": false,
      "outcome": "Pass",
      "nos": [{ "nosId": "NOS-01", "theory": 70, "practical": 80, "viva": 75 }]
    },
    { "candidateId": "66f0000000000000000000k2", "absent": true, "outcome": "Absent", "nos": [] }
  ],
  "submittedAt": null,
  "submittedBy": null,
  "validatedAt": null,
  "validatedBy": null,
  "publishedAt": null,
  "publishedBy": null,
  "createdAt": "2026-11-23T06:00:00.000Z",
  "updatedAt": "2026-11-23T06:00:00.000Z"
}
```

The first PUT sets `batches.resultId`. PUT never changes batch status or `statusVersion`.

**Outcome (server-computed).**

- **Absent.** A candidate whose attendance row has `present: false` is `Absent` (`attendanceByCandidate`, B-06c) and stores no marks. A candidate with **no** attendance row (possible after `POST /batches/:id/complete`) is `Absent` only when the row sends `absent: true`.
- **Ceiling.** For each NOS component: the NOS `maxMarks`, else the qualification `maxMarks`. A `percent` qualification with neither is marked out of 100, so the mark is the percent. A ceiling of `0` means that component is not assessed on that NOS.
- **Pass / Fail.** `passMarkUnit: "percent"` compares mark ÷ ceiling × 100 with `passMarks`. `"absolute"` compares the raw mark with `passMarks`. `passCriteriaMode: "nos_wise"` (also used when the qualification has none) needs every assessed component of every NOS to pass. `"overall"` sums each component over the NOS (percent: against the summed ceilings) and needs every component total to pass.
- **`null`.** A draft row that still lacks a mark for any assessed component of any NOS has `outcome: null`. Such a row blocks submit (`RESULT_INCOMPLETE`).
- PC-level marks are not part of this body (open Q123).

| Failure | When |
|---|---|
| `400 VALIDATION_ERROR` with `details.rows` | `absent: true` for a candidate present in attendance; `absent: false` for one absent in attendance; marks for an absent candidate; a `candidateId` that is not an active roster row; a `nosId` not on the qualification |
| `400 RESULT_PASS_MARK_INVALID` with `details` `{ candidateId, nosId, component, max }` | A mark above its ceiling |
| `400 RESULT_OUTCOME_MISMATCH` with `details.rows[{ candidateId, outcome }]` (the server's value) | A sent `outcome` differs from the computed one |
| `409 INVALID_TRANSITION` | Batch is not `assessment_completed`, or the result is not `draft` |

**Change log.** One `resultChangeLogs` row (`action: "save"`) per PUT that creates the draft or changes a row. **Audit.** `result.save` with the result before and after.

### GET /batches/:id/results

Roles: `aa_admin`, `mis`, `assessor`, `candidate`, `tp`, `ab_reviewer`, `ncvet_viewer`, each in their batch row scope (SCHEMA §5). `proctor` and `sme` are `403`. Unknown batch is `404`; a batch outside scope is `403`. No result yet is `404`.

Response `200`: the result object above. A **candidate** gets only their own row in `rows`. A `candidate` or `tp` gets the result only once it is `published`; before that the call is `404`.

### GET /results/:id/change-log

`aa_admin` | `ab_reviewer` | `mis`. A reviewer reads only results of batches with their own `abId` (`403` otherwise). Unknown id is `404`. Oldest first, no paging.

```json
{
  "items": [
    {
      "id": "66f0000000000000000000g1",
      "resultId": "66f0000000000000000000r1",
      "batchId": "66f0000000000000000000b1",
      "action": "save",
      "fromStatus": null,
      "toStatus": "draft",
      "byUserId": "66f000000000000000000001",
      "byRole": "aa_admin",
      "reason": "Marks sheet received from the assessor",
      "changes": [
        {
          "candidateId": "66f0000000000000000000k1",
          "before": null,
          "after": {
            "candidateId": "66f0000000000000000000k1",
            "absent": false,
            "outcome": "Pass",
            "nos": [{ "nosId": "NOS-01", "theory": 70, "practical": 80, "viva": 75 }]
          }
        }
      ],
      "createdAt": "2026-11-23T06:00:00.000Z"
    }
  ]
}
```

`action` is `save`, `submit`, `validate`, `publish`, or `return` (B-05b return for correction; `reason` is always set). `changes` lists the rows that differ (`before` is `null` for a new row, `after` is `null` for a removed one); it is empty for `validate`, `publish`, and `return`. Rows are append-only.

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
