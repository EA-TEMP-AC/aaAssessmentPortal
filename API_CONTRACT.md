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
| `UNSUPPORTED_FILE_TYPE` | 415 | Evidence file is not JPEG, PNG, PDF or MP4 by its bytes (V-01) |
| `FILE_TYPE_MISMATCH` | 415 | Evidence file's real type differs from the type the client declared (V-01) |
| `FILE_TOO_LARGE` | 413 | Evidence file over 25 MB (image, PDF) or 200 MB (video) (V-01) |
| `REASSESS_ALREADY_OPEN` | 409 | A learner being reassessed already has a live, unpublished reassessment batch from the same parent. `details.conflicts` names each learner and the existing batch |
| `REASSESS_NOT_ELIGIBLE` | 409 | Reassessment rules failed. `details.reason`: `not_published`, `window`, `outcome`, or `type`. Window is one year from the original result’s publication date (Guidelines 4.7) |
| `CONFLICT_IDEMPOTENT` | 409 | Same `clientEventId`, different payload, path, or user |
| `CONSENT_REQUIRED` | 409 | Publishing public person or POSH committee member refused without `consentRecorded: true` |

**Soft SLA:** `aa_admin` may proceed after due with required `lateReason`; server records `sla.breached` + audit. Codes above only when late and reason missing.

---

## Auth

### POST /auth/login

Public. Rate limit: `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS` per IP+email → `429 RATE_LIMITED`.

The body (and `device`) accepts only the fields shown. Any other key, such as `aadhaar`, is `400 VALIDATION_ERROR`; the same holds for `POST /auth/refresh`. As a second guard, the audit middleware drops national-id keys (`aadhaar`, `aadhar`, `nationalId`, `panNumber`, `voterId`, `passportNumber` and similar) from `meta.requestBody` on every route (T01-B1).

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

### POST /users/:id/resend-credentials

`aa_admin` only (`mis` and every other role `403`). Body `{}` (any key is `400 VALIDATION_ERROR`). Issues a new temporary password, sets `mustChangePassword: true`, revokes the user's refresh tokens, and queues a fresh email (`emailQueue.kind` `credentials_resend`). Same effect as the `sendEmail` password reset, without its rate limit. A queue failure does not fail the call.

Response `202`: `{ "emailQueued": true }`. The password is never returned. A disabled user (`active: false`) is `409 INVALID_TRANSITION`; unknown id `404`; malformed id `400`.

Audit: `user.resend_credentials`, entity `user`, `before` and `after` (public user shape), `meta: { "mode": "resend_credentials", "emailQueued": true }`. No password or mail text.

---

## Settings

### GET /settings/access

Roles: `aa_admin`, `mis`, `ncvet_viewer`, `ab_reviewer`; others `403`. Response `200`:
```json
{
  "abReviewerCanReadAssessorPayments": false,
  "ncvetViewerCanSeeAbQueue": false,
  "updatedBy": null,
  "updatedAt": null
}
```
Both flags are `false` until `aa_admin` changes them. Clients read the flags to show or hide screens; the server does not gate the AB queue on `ncvetViewerCanSeeAbQueue` (the queue is the batch list, which `ncvet_viewer` can already read).

### PUT /settings/access

`aa_admin` only. Body: one or both booleans, `{ "abReviewerCanReadAssessorPayments": true }`; an empty body, an unknown key or a non-boolean is `400 VALIDATION_ERROR`. Flags not named keep their value. Response `200`: the same shape as GET. Audit: `settings.access.update`, entity `settings`, entityId `access`, `before` and `after` as the GET shape. Decisions 174 and 175 (Q161, Q171).

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
  "schemeId": "66f0000000000000000000s1",
  "projectId": "66f0000000000000000000p1",
  "candidateCount": 24,
  "assessmentLanguage": "Hindi"
}
```

`schemeId` and `projectId` are optional (omit or `null`; H-01). Each must exist and be active, and a project must belong to the given scheme; otherwise `400 VALIDATION_ERROR` with `details.schemeId` or `details.projectId`. If only `projectId` is sent, `schemeId` is set to the project's scheme. They cannot be changed after creation yet, and a reassessment does not copy them (Q384, Q385).

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
  "schemeId": "66f0000000000000000000s1",
  "projectId": "66f0000000000000000000p1",
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

### GET /batches?status=&from=&to=&tpId=&schemeId=&projectId=&page=&pageSize=

`schemeId` and `projectId` (H-01) filter on the batch's own link, on top of the caller's row scope. An empty value is ignored; a value that is not an id is `400 VALIDATION_ERROR`. Batches with no link are never matched by these filters.

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
| None of the learners taken is already on an active roster row of a live reassessment batch of the same parent (live and unpublished = status not `cancelled`, `rejected` or `published`) | `409 REASSESS_ALREADY_OPEN`, `details: { "reason": "already_open", "conflicts": [ { "learnerId": "...", "batchId": "..." } ] }`. One entry per blocked learner, in roster order; `batchId` is that learner's earliest live reassessment batch |
| Centre exists, has a state, and belongs to the parent's training partner | `400 VALIDATION_ERROR` with `details.centreId` |
| Recognition (SCHEMA §4.3), with the parent's `sector` and the centre's `state` | `409 RULE_OUTSIDE_RECOGNITION` |

A learner may be reassessed from the same parent again once the earlier reassessment batch is `cancelled`, `rejected` or `published` (decision 173, Q167), or the learner was removed from its roster. The check is per learner: a request naming only learners with no live batch goes through. Only batches with the same `reassessmentOf` count; a reassessment of another parent in the chain does not.

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

Roles: `aa_admin`, `mis`, and `ncvet_viewer` read all rows. `assessor` reads only rows whose `assessorId` is their own `linkedProfileId`. `ab_reviewer` gets `403` unless `abReviewerCanReadAssessorPayments` is on (`GET /settings/access`); when it is on they read only rows of batches of their own `abId` (another awarding body's batch id is `403`, a reviewer with no `abId` is `403`) and still cannot write. `proctor`, `tp`, `candidate`, and `sme` get `403`. The first path lists across batches; the second is limited to one batch (unknown id `404`).

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

**Stuck sends (B-14, Q155).** The worker returns a job that has been `sending` for over 10 minutes to `pending`, due at once, at most twice (`reclaims` on the job counts them). When it is stuck a third time, or had used its last attempt, it becomes `failed` and its `text` is unset. Not visible through the API.

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

### GET /audit/access-log?subjectType=&subjectId=&actorId=&actorRole=&kind=&from=&to=&page=&pageSize=

`aa_admin` only (others `403`). Who read personal data of which person (S-01, TR s20). Rows are written by the list and detail endpoints that return personal data: `GET /users`, `/users/:id`, `/learners`, `/learners/:id`, `/assessors`, `/assessors/:id`, `/assessors/available`, `/proctors`, `/proctors/:id`, and `GET /batches/:id/candidates` (logged against the learner). One row per person returned; a list of 20 writes 20 rows with the same `requestId`. Rows hold ids and field names only, never the data. A read that cannot be logged returns `500` and no data.

Filters (all optional): `subjectType` = `user|learner|assessor|proctor|evidence`; `subjectId`; `actorId` (user id); `actorRole`; `kind` = `list|detail`; `from`, `to` (ISO date or time, on `createdAt`, `from` <= `to`); `page` (default 1); `pageSize` (default 20, max 100). An unknown filter or a bad value is `400 VALIDATION_ERROR`. Newest first.

`200`:
```json
{
  "page": 1, "pageSize": 20, "total": 1,
  "items": [{
    "id": "66f0...", "actorId": "66f0...", "actorRole": "aa_admin",
    "subjectType": "learner", "subjectId": "66f0...", "kind": "detail",
    "fields": ["name", "phone", "externalRef"],
    "route": "GET /api/v1/learners/:id", "requestId": "b0b7...",
    "ip": "203.0.113.7", "createdAt": "2026-10-15T09:30:00.000Z"
  }]
}
```

Reading the access log is not itself logged. Append-only.

### Personal data in responses (S-01)

Email and phone are encrypted at rest (SCHEMA §7) but returned in plain text exactly as before; no response shape changed. Hash columns (`emailHash`) never appear in a response. A duplicate email on `POST|PATCH /users`, `/assessors`, `/proctors` is still `409 DUPLICATE_RESOURCE`. Searching or sorting by email or phone is not offered.

---

## Analytics

Read-only. Roles: `aa_admin`, `mis` and `ncvet_viewer` read everything; `ab_reviewer` reads only batches of their own `abId` (a reviewer with no `abId` is `403`); every other role is `403`. All five endpoints are `GET` and need `from` and `to`.

Query: `from`, `to` (required, IST calendar dates `YYYY-MM-DD`, both inclusive). A batch is in range when its `assessmentStartDate` is between them. `from` after `to`, a date that is not real, a missing date, an unknown parameter, or a range of three years or more (`to` on or after `from` plus 3 years) is `400 VALIDATION_ERROR`. The list endpoints also take `page` (default 1) and `pageSize` (default 20, max 100).

Rules for every measure: only results with `status: "published"` count towards learners assessed, pass rate and turnaround. Responses hold counts and rates only. No learner, candidate or result row is returned.

### GET /analytics/summary

```json
{
  "from": "2026-01-01",
  "to": "2026-12-31",
  "batches": { "total": 4, "byStatus": { "allocated": 0, "published": 3, "result_submitted": 1, "...": 0 } },
  "publishedResults": { "total": 3, "onTime": 2, "late": 1 },
  "learnersAssessed": 7,
  "passRate": 0.7143,
  "slaBreaches": 2
}
```

`byStatus` lists every batch status, with 0 where none. `late` is a published result whose batch has `result` in `sla.breached`; `onTime` is the rest. `passRate` is `null` when no learner was assessed.

### GET /analytics/by-assessor, /by-training-partner, /by-job-role, /by-state

Paged, busiest first (`batches` descending, then id). `by-assessor` leaves out batches with no assessor. Job role is the batch qualification.

```json
{
  "from": "2026-01-01", "to": "2026-12-31", "page": 1, "pageSize": 20, "total": 3,
  "items": [
    {
      "id": "66f000000000000000000a01", "name": "Assessor One", "code": "AS-1",
      "batches": 2, "publishedBatches": 2,
      "learnersAssessed": 5, "passed": 3, "failed": 2, "absent": 1,
      "passRate": 0.6, "avgTurnaroundDays": 2.25, "slaBreaches": 1
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id`, `name`, `code` | The assessor, training partner or qualification. For `by-state`, `id` and `name` are the state name and `code` is `null`. `name` is `null` if the record is gone |
| `batches` | Batches in range, in any status |
| `publishedBatches` | Of those, batches with a published result |
| `passed`, `failed`, `absent` | Rows of published results by outcome |
| `learnersAssessed` | `passed + failed` (absent learners are not assessed) |
| `passRate` | `passed / learnersAssessed`, 4 decimals, `null` when 0 learners |
| `avgTurnaroundDays` | Mean calendar days from the end of the last assessment day (IST) to result `submittedAt`, floored at 0, 2 decimals, `null` when no published result |
| `slaBreaches` | Total entries in `sla.breached` across the batches (one batch can add up to 3) |

Empty range: `total: 0`, `items: []`. Summary with no batches: zeros and `passRate: null`.

---

## Compliance stubs

`GET /compliance/dashboard`; ERF/risk-plan Phase 3.

---

## Public website content

Content for the AA public website (NCVET TR s22). Nine sections, one slug each:

| Slug | Content | Admin fields (besides `published`, `sortOrder`) | Public fields (besides `id`) |
|---|---|---|---|
| `team-members` | Operational team | `name`, `designation`, `department?`, `bio?`, `photoRef?` | same |
| `organogram` | Organogram nodes | `name`, `title`, `parentId?`, `photoRef?` | same; `parentId` only while the parent is published |
| `people` | Assessors and proctors shown publicly | `kind` (`assessor` or `proctor`), `registryId`, `name?`, `roleLabel`, `sector?`, `photoRef?` | `kind`, `name`, `roleLabel`, `sector`, `photoRef` (never `registryId`) |
| `sample-papers` | Sample assessment papers | `title`, `qualificationId`, `fileRef` | `title`, `fileRef`, `qualification: { code, name, sector }` |
| `industry-linkages` | Industry linkages | `name`, `description?`, `websiteUrl?` (http or https), `logoRef?` | same |
| `grievance` | Grievance procedure and contact | `title`, `body?`, `contactName?`, `contactEmail?`, `contactPhone?`, `fileRef?` | same |
| `posh` | POSH policy and committee | `kind` (`policy` or `committee_member`), `title`, `body?`, `memberName?` (required for a committee member), `memberRole?`, `fileRef?` | same |
| `office-documents` | Registered office documents | `category` (`ownership`, `lease`, `telephone_bill`, `internet_bill`, `electricity_bill`, `other`), `title`, `note?`, `fileRef` | same |
| `events` | Monthly calendar of events | `title`, `description?`, `date`, `endDate?`, `location?` (`YYYY-MM-DD`) | same |

Every item has `published` (default `false`) and `sortOrder` (integer 0 to 100000, default 0, lowest first). `photoRef`, `logoRef` and `fileRef` are plain text references (up to 500 characters) to a file or photo hosted elsewhere. This API stores no file and does not fetch one. Hosting is undecided (DECISIONS.md).

### Admin: /admin/public-site/:slug

Roles: `aa_admin` creates, changes and deletes; `mis` reads; every other role `403`. Responses are `Cache-Control: no-store`.

| Call | Result |
|---|---|
| `GET /admin/public-site/:slug?page=&pageSize=&published=` | `200 { page, pageSize, total, items }`, every item with all its fields plus `id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`. `pageSize` default 20, max 100 |
| `GET /admin/public-site/:slug/:id` | `200` one item, or `404` |
| `POST /admin/public-site/:slug` | `201` the item. Unknown fields and missing required fields are `400 VALIDATION_ERROR` |
| `PATCH /admin/public-site/:slug/:id` | `200` the item. At least one field. `people.kind` and `people.registryId` cannot be changed |
| `DELETE /admin/public-site/:slug/:id` | `204`. Deleting an organogram node moves its children to the top |

Checks: `people.registryId` must be an assessor (or proctor, by `kind`) in the registry, one entry per registry record, and only the registry `name` is copied (when `name` is not sent); no email, phone, code, qualification or ID data is read. `sample-papers.qualificationId` must exist. `organogram.parentId` must exist and may not make a loop. `events.endDate` may not be before `date`.

Every write is audited: action `public_site.<slug>.create|update|delete`, entity `publicSite`, `before` and `after`, `meta.resource`.

### Public: GET /public/:slug

No login. Read only (no other method exists). Returns only items with `published: true`, in `sortOrder` order (events: by `date`, then `sortOrder`), with only the public fields in the table above. Admin fields (`published`, `sortOrder`, `createdBy`, timestamps, `registryId`, `qualificationId`) are never returned.

Query: `page`, `pageSize` (default 20, max 100); `people?kind=`, `posh?kind=`, `office-documents?category=`, `events?month=YYYY-MM` (events whose dates touch the month). Any other parameter is `400`.

Response `200`: `{ "page": 1, "pageSize": 20, "total": 2, "items": [ ... ] }` with `Cache-Control: public, max-age=300`. An unknown slug is `404`. Rate limit: `PUBLIC_RATE_LIMIT_MAX` requests (120) per `PUBLIC_RATE_LIMIT_WINDOW_MS` (60 seconds) per client IP, then `429 RATE_LIMITED` with `Retry-After`.
---

## Question bank (Phase 2, Q-01)

Endpoints for question bank management, versioning, Excel imports, and coverage reporting.
Roles: `aa_admin` and `sme` write and import; `ab_reviewer` reads and may approve; `candidate` and `tp` are strictly denied (403). Other roles (`mis`, `assessor`, `proctor`, `ncvet_viewer`) are denied (403). Question content (stem, options, answers) is confidential. Audit logs redact question content.

### POST /api/v1/question-bank/questions
Roles: `aa_admin`, `sme`.
Creates a new question document (starts at `version: 1`, `status: "draft"`, `isLatest: true`).
National ID fields (`aadhaar`, `panNumber`, etc.) are rejected with 400 `VALIDATION_ERROR`.

Request body:
```json
{
  "qualificationId": "66f0000000000000000000q1",
  "nosId": "NOS-01",
  "pcId": "PC-01",
  "type": "mcq",
  "language": "en",
  "difficulty": "medium",
  "bloomLevel": "apply",
  "stem": "Which tool is used for torque specification verification?",
  "options": [
    { "key": "A", "text": "Torque wrench" },
    { "key": "B", "text": "Impact driver" },
    { "key": "C", "text": "Pliers" },
    { "key": "D", "text": "Screw gauge" }
  ],
  "correctAnswer": "A",
  "marks": 2
}
```
Response `201 Created`: created question object.

### GET /api/v1/question-bank/questions
Roles: `aa_admin`, `sme`, `ab_reviewer`.
Query parameters: `qualification`, `nos`, `pc`, `type`, `language`, `status`, `difficulty`, `latestOnly` (default true), `page` (default 1), `pageSize` (default 20, max 100).
Response `200 OK`:
```json
{
  "items": [...],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

### GET /api/v1/question-bank/questions/:id
Roles: `aa_admin`, `sme`, `ab_reviewer`.
Response `200 OK`: question document.

### PUT|PATCH /api/v1/question-bank/questions/:id
Roles: `aa_admin`, `sme`.
Updates question content. Creates a new version (`version: previous.version + 1`), keeps the existing version with `isLatest: false`, and links `previousVersionId` and `rootQuestionId`. New version resets to `draft`.
Response `200 OK`: new version document.

### POST /api/v1/question-bank/questions/:id/retire (or DELETE)
Roles: `aa_admin`, `sme`.
Soft-deletes the question: sets `status: "retired"`, `retiredBy: user._id`, `retiredAt: Date`. Hard deletion is never performed.
Response `200 OK`: updated question document.

### POST /api/v1/question-bank/questions/:id/approve
Roles: `aa_admin`, `ab_reviewer`.
Sets `status: "approved"`, `approvedBy: user._id`, `approvedAt: Date`.
Response `200 OK`: approved question document.

### GET /api/v1/question-bank/coverage/:qualificationId
Roles: `aa_admin`, `sme`, `ab_reviewer`.
Coverage report for a qualification: lists every PC across its NOS with approved question counts and flags PCs with fewer than 5 approved questions (`flagged: true`).
Response `200 OK`:
```json
{
  "qualificationId": "66f0000000000000000000q1",
  "qualificationCode": "ASC/Q1402",
  "qualificationName": "Automotive Service Technician",
  "totalPCs": 12,
  "totalApprovedQuestions": 54,
  "averageApprovedQuestionsPerPc": 4.5,
  "flaggedPcsCount": 2,
  "pcs": [
    {
      "nosId": "NOS-01",
      "nosCode": "ASC/N0101",
      "pcId": "PC-01",
      "pcCode": "PC1.1",
      "pcName": "Inspect engine oil",
      "approvedQuestionCount": 6,
      "flagged": false
    },
    {
      "nosId": "NOS-01",
      "nosCode": "ASC/N0101",
      "pcId": "PC-02",
      "pcCode": "PC1.2",
      "pcName": "Replace spark plugs",
      "approvedQuestionCount": 3,
      "flagged": true
    }
  ]
}
```

### POST /api/v1/question-bank/import(?partial=true)
Roles: `aa_admin`, `sme`.
Accepts raw `.xlsx` binary buffer, base64 data (`{ fileBase64: "..." }`), or parsed row array.
Powered by `exceljs`. Enforces security and validation limits:
- Maximum file size: 5 MB (larger payloads rejected with `400 VALIDATION_ERROR`).
- Maximum row count: 5,000 rows (excluding header; larger workbooks rejected with `400 VALIDATION_ERROR`).
- Accepted format: `.xlsx` only (binary payload verified for zip magic bytes `PK\x03\x04`).
- Macros and external links forbidden: workbooks containing `vbaProject.bin`, macro-enabled sheets, or external target links are rejected with `400 VALIDATION_ERROR`.
Validates every row. If any row fails validation and `partial=true` is not set, imports 0 rows and returns `400 BAD_REQUEST` with a per-row error report.
If `partial=true`, imports valid rows and returns `201 Created` with `imported` items and `errors` for failed rows.

Response `400 Bad Request` (when partial is false and errors exist):
```json
{
  "success": false,
  "code": "IMPORT_VALIDATION_FAILED",
  "totalRows": 10,
  "importedCount": 0,
  "errorCount": 2,
  "errors": [
    { "row": 3, "errors": ["PC 'PC-99' not found under NOS 'NOS-01'"] },
    { "row": 5, "errors": ["MCQ correct answer does not match any provided option key or text"] }
  ]
}
```

### GET /api/v1/question-bank/sector-coverage
Roles: `aa_admin`, `sme`, `ab_reviewer`.
Coverage per active configured sector. Response `200 OK`:
```json
{
  "minimumPercent": 5,
  "items": [
    {
      "sectorId": "66f0000000000000000000s1",
      "sector": "Electronics",
      "active": true,
      "nqrQualificationCount": 100,
      "coveredCount": 5,
      "percentCovered": 5,
      "meetsMinimum": true,
      "minimumPercent": 5
    }
  ]
}
```
`percentCovered` is `null` and `meetsMinimum` is `false` when the sector has no NQR qualifications.

### GET /api/v1/question-bank/sector-coverage/:sectorId?page=1&limit=100
Roles: `aa_admin`, `sme`, `ab_reviewer`. `sectorId` is the `sectorConfigs` id. Same fields as one list item plus the uncovered qualifications (sorted by code; `limit` 1 to 500):
```json
{ "sectorId": "…", "sector": "Electronics", "nqrQualificationCount": 100, "coveredCount": 4,
  "percentCovered": 4, "meetsMinimum": false, "minimumPercent": 5,
  "uncovered": { "total": 96, "page": 1, "limit": 100, "items": [{ "code": "ELE/Q0101", "name": "Solderer" }] } }
```
Errors: `404 NOT_FOUND`, `400 VALIDATION_ERROR` (bad id or query).

### POST /api/v1/question-bank/sector-config
Roles: `aa_admin`. Body `{ "sector": "Electronics", "active": true }` (`active` optional; unknown keys refused; a ratio class is not a sector). `201` returns `{ id, sector, active, createdAt, updatedAt }`. Errors: `409 SECTOR_NOT_RECOGNISED`, `409 DUPLICATE_RESOURCE`, `400 VALIDATION_ERROR`. Audit `sector_config.create`.

### PATCH /api/v1/question-bank/sector-config/:id
Roles: `aa_admin`. Body `{ "active": false }`. `200` returns the row. Audit `sector_config.update` with before and after.

### POST /api/v1/question-bank/nqr-qualifications/import(?partial=true)
Roles: `aa_admin`. Body is the CSV itself, `Content-Type: text/csv`, up to 2 MB and 20,000 rows. Header must be exactly `code,name,sector` (any order); unknown columns, missing columns and national-id columns give `400 VALIDATION_ERROR`. `sector` must be an Annexure II name (matched ignoring case). Cells starting `=`, `+`, `-` or `@` are stored with a leading `'`. A code already present is updated, not duplicated; a code repeated in the file is a row error.
Every row is validated. If any row fails and `partial=true` is not set, nothing is imported and the answer is `400` with `code: "IMPORT_VALIDATION_FAILED"` and `errors: [{ "row": 3, "errors": ["Unknown sector 'X'…"] }]` (row numbers are file lines, header is line 1). With `partial=true` valid rows are saved. Success: `201` when any row was created, else `200`:
```json
{ "success": true, "totalRows": 10, "importedCount": 9, "createdCount": 7, "updatedCount": 2, "errorCount": 1, "errors": [{ "row": 5, "errors": ["Missing name"] }] }
```
Audit `nqr_qualification.import` (also on a failed import) with counts only, never the file text.

---

## Evidence vault (Phase 2, V-01)

Backend only. The browser screen is V-02. Files live in object storage (local disk in development, an S3-compatible bucket in production; see README) under random keys. The API never returns a storage key, never uses a client file name as a path, and offers no way to replace or delete a file.

Read roles: `aa_admin`, `mis` and `ncvet_viewer` see every row; `ab_reviewer` sees rows of its own awarding body (no `abId` means no rows); `assessor` and `proctor` see only rows they uploaded. `candidate`, `tp` and `sme` get `403`. A row outside the caller's scope is `403`; an unknown id is `404`.

### POST /batches/:id/evidence

`multipart/form-data`. Roles: `aa_admin`, or the `assessor` or `proctor` assigned to the batch. Any other role, or another assessor or proctor, is `403`. Unknown batch `404`. A batch in `cancelled` or `rejected` is `409 INVALID_TRANSITION`; every other status accepts uploads.

Parts:

| Part | Required | Notes |
|---|---|---|
| `file` | yes | One file. Real type read from the bytes: `image/jpeg`, `image/png`, `application/pdf`, `video/mp4`. Anything else `415 UNSUPPORTED_FILE_TYPE`. If the part declares one of the four types and the bytes say another, `415 FILE_TYPE_MISMATCH`. The file name is ignored and never stored. Images and PDFs up to 25 MB, video up to 200 MB, else `413 FILE_TOO_LARGE`. An empty file is `400` |
| `clientEventId` | yes | Idempotency key, 1 to 200 characters |
| `kind` | yes | `photo`, `id_proof`, `attendance`, `equipment`, `other`, `video`. `video` needs an MP4 and an MP4 needs `video`; the other kinds take JPEG, PNG or PDF, except `photo`, which takes JPEG or PNG (`400` otherwise) |
| `capturedAt` | yes | ISO 8601 with offset, from the device clock. Kept as sent |
| `candidateId` | no | A candidate row (roster id) of this batch, else `400` |
| `deviceId` | no | |
| `latitude`, `longitude`, `accuracy` | no | `latitude` -90 to 90, `longitude` -180 to 180, `accuracy` metres, 0 or more. Latitude and longitude go together; `accuracy` needs them |
| `locationStatus` | no | `captured` or `unavailable`. `unavailable` needs `locationUnavailableReason` (up to 200 characters) and no coordinates. A reason with a fix is `400` |

No location at all is allowed and stored as `locationStatus: "not_provided"`. Unknown parts, and server-owned ones (`uploadedAt`, `sha256`, `size`, `uploaderId`), are `400`.

The server computes `sha256` and `size`, sets `uploadedAt`, and records the uploader and their role.

`201` (stored) or `200` (replay):
```json
{
  "id": "66f0...", "clientEventId": "evt-17", "batchId": "66f0...", "abId": "66f0...",
  "candidateId": "66f0...", "kind": "photo", "contentType": "image/jpeg",
  "size": 183422, "sha256": "9f86d0...", "uploaderId": "66f0...", "uploaderRole": "assessor",
  "capturedAt": "2026-11-20T05:00:00.000Z", "uploadedAt": "2026-11-20T05:00:07.412Z",
  "locationStatus": "captured", "latitude": 19.076, "longitude": 72.8777, "accuracy": 12.5,
  "locationUnavailableReason": null, "hasLocation": true, "deviceId": "dev-9f3a",
  "verification": null, "verifyCount": 0, "replayed": false
}
```

**Idempotency.** The same `clientEventId` with the same user, batch, metadata and file bytes returns the stored row with `200` and `replayed: true`; nothing new is stored, and the replay is not re-checked against the batch status, so an offline queue can resend after the batch was cancelled. The same `clientEventId` with anything different (another user, another file, other metadata) is `409 CONFLICT_IDEMPOTENT`.

Audit: `evidence.upload` (or `evidence.replay`) with the response fields and `meta.{contentType,size,sha256}`. File contents are never written to the audit log.

### GET /evidence?batchId=&candidateId=&kind=&uploaderId=&from=&to=&hasLocation=&page=&pageSize=

Read roles above. All filters optional; an unknown filter or bad value is `400`. `from` and `to` are ISO dates or times applied to `capturedAt`. `uploaderId` is a user id. `hasLocation=true` means `locationStatus` is `captured`; `false` is every other status. `page` default 1, `pageSize` default 20, max 100. Newest `capturedAt` first.

`200`: `{ "page": 1, "pageSize": 20, "total": 3, "items": [ <evidence row as above, without replayed> ] }`

### GET /evidence/:id

`200` the row. Metadata reads are not written to the access log (DECISIONS 325).

### GET /evidence/:id/file

Same roles and scope as the row. Writes an access-log row for **every** download (`subjectType: "evidence"`, `fields: ["file"]`, plus a `learner` row when the evidence names a candidate), before anything is sent. If the log cannot be written the response is `500` and no file or link is returned.

- S3 driver: `200` JSON `{ "url", "expiresAt", "contentType", "size", "sha256" }`. The link is short-lived (`EVIDENCE_SIGNED_URL_SECONDS`, default 120) and the response is `Cache-Control: no-store`.
- Local driver: `200` with the file bytes, `Content-Type` from the stored type, `Content-Disposition: attachment; filename="evidence-<id>.<ext>"`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.

If the stored object is missing, `404 NOT_FOUND`.

### POST /evidence/:id/verify

`aa_admin` only. Re-reads the stored file and compares size and sha256 with the row. Always `200` for a row that exists; the outcome is in `verification.result`: `ok`, `mismatch` (bytes changed) or `missing` (object gone). The result, time and user are saved on the row (`verifyCount` goes up by one) and the recorded checksum is never rewritten. A `mismatch` also returns what the stored file hashes to now.

```json
{ "id": "66f0...", "sha256": "9f86d0...", "verifyCount": 1,
  "verification": { "at": "2026-11-21T09:00:00.000Z", "byUserId": "66f0...", "result": "mismatch",
                    "expectedSha256": "9f86d0...", "actualSha256": "1a2b3c...", "actualSize": 183000 } }
```

Audit: `evidence.verify` with `meta.result`.

`PUT`, `PATCH` and `DELETE` on `/evidence/:id` and `/evidence/:id/file` do not exist (`404`).
## Test generator (task E-01)

All under `/api/v1/tests`. Papers hold ids, versions, seed and rules, never question text.

### POST /api/v1/tests/generate
Roles: `aa_admin`, `sme`. Unknown keys are rejected.
```json
{
  "qualificationId": "<id or code>",
  "language": "en",
  "quotas": [
    { "nosId": "NOS-01", "type": "mcq", "count": 4 },
    { "nosId": "NOS-02", "count": 2 }
  ],
  "totalMarks": 11,
  "seed": 1234,
  "allowPartial": false
}
```
`type` is optional (any type). A NOS may not have both an any-type quota and a typed quota, and no two quotas may share NOS and type. `totalMarks`, `seed` and `allowPartial` are optional. With no seed the server draws one and stores it.
Only approved, latest-version, non-retired questions in the language are used; no question appears twice.
`201` returns the draft paper (`_id`, `status`, `seed`, `rules`, `items[]`, `totalMarks`, `shortages`, `complete`, `poolHash`).
`422 TEST_BANK_SHORTAGE` when a quota cannot be filled: `error.details.shortages` lists `{nosId, type, requested, available}`. `422 TEST_MARKS_TARGET_NOT_MET` when the marks differ from the target (`details.totalMarks`, `details.targetMarks`). Nothing is stored. With `allowPartial: true` the draft is stored with `complete: false` and the shortages listed. Also `400 NOS_NOT_FOUND`, `DUPLICATE_QUOTA`, `OVERLAPPING_QUOTAS`, `404 QUALIFICATION_NOT_FOUND`.
Audit: `test.generate`.

### GET /api/v1/tests
Roles: `aa_admin`, `sme`, `ab_reviewer`. Query: `qualificationId` (id or code), `status` (`draft`|`approved`), `page`, `pageSize`. Returns `{items, total, page, pageSize}` without `items[]` of each paper.

### GET /api/v1/tests/:id
Same roles. `?withQuestions=true` adds `stem`, `options` and `correctAnswer` to each item. `404 NOT_FOUND`.

### POST /api/v1/tests/:id/approve
Roles: `aa_admin`, `ab_reviewer`. Draft to approved. `409 TEST_ALREADY_APPROVED`, `409 TEST_PAPER_INCOMPLETE` (shortage or missed marks target), `409 TEST_PAPER_STALE` (a question was retired, unapproved or superseded since generation; `details.stale`). Audit: `test.approve` with before and after.

### POST /api/v1/tests/:id/regenerate-check
Roles: `aa_admin`, `sme`, `ab_reviewer`. Re-runs the selection with the stored seed and rules on the current bank. Returns `reproducible` (same questions, versions and order), `poolUnchanged` (bank pool is identical to generation time), `missing` and `extra` (`id:version`), and `stale` (stored questions no longer approved and current). If `poolUnchanged` is true and `reproducible` is false, the generator is broken. Audit: `test.regenerate_check`.
## Schemes, projects, authorised signatories (H-01)

Master data for funding schemes, projects under a scheme, and the people who may sign for a scheme, a project, or the whole agency. Nothing is deleted: `DELETE` deactivates (`active: false`). Every write is audited with `before` and `after` (`scheme.create|update|deactivate`, `project.*`, `signatory.*`). Unknown request keys are `400 VALIDATION_ERROR`. No signature images and no personal ID numbers are accepted.

Roles (all three resources): write `aa_admin`, `mis` (the master-data pattern; Q380); read `aa_admin`, `mis`, `ab_reviewer`, `ncvet_viewer`; every other role `403 FORBIDDEN`. Lists are paged (`page`, `pageSize` max 100, default 20), newest first, and take `active=true|false`.

### /schemes

`POST /schemes`, `GET /schemes?active=&page=&pageSize=`, `GET /schemes/:id`, `PATCH /schemes/:id`, `DELETE /schemes/:id` (deactivate, returns the row).

Create request (`name`, `code`, `fundingBody` required; `active` optional, default true):
```json
{ "name": "State Skill Scheme", "code": "SSS-01", "fundingBody": "State Skill Mission" }
```
Response `201`:
```json
{
  "id": "66f0000000000000000000s1",
  "name": "State Skill Scheme",
  "code": "SSS-01",
  "fundingBody": "State Skill Mission",
  "active": true,
  "createdAt": "2026-10-15T08:00:00.000Z",
  "updatedAt": "2026-10-15T08:00:00.000Z"
}
```
`code` is unique: a repeat on create or `PATCH` is `409 DUPLICATE_RESOURCE`. `PATCH` takes any of `name`, `code`, `fundingBody`, `active` (at least one).

### /projects

`POST /projects`, `GET /projects?schemeId=&active=&page=&pageSize=`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id` (deactivate).

Create request (`endDate` optional or `null` for open-ended; dates are `YYYY-MM-DD` IST, `endDate` on or after `startDate`):
```json
{
  "name": "Project One",
  "code": "PRJ-01",
  "schemeId": "66f0000000000000000000s1",
  "startDate": "2026-04-01",
  "endDate": "2027-03-31"
}
```
Response `201`: the same fields plus `id`, `active`, `createdAt`, `updatedAt`. `schemeId` must exist and be active on create and when `PATCH` changes it (`400 VALIDATION_ERROR`, `details.schemeId`). `code` is unique across all projects (`409 DUPLICATE_RESOURCE`).

### /signatories

`POST /signatories`, `GET /signatories?scope=&schemeId=&projectId=&active=&page=&pageSize=`, `GET /signatories/:id`, `PATCH /signatories/:id`, `DELETE /signatories/:id` (deactivate).

Create request:
```json
{
  "name": "A. Signer",
  "designation": "Director",
  "scope": "scheme",
  "schemeId": "66f0000000000000000000s1",
  "validFrom": "2026-04-01",
  "validTo": "2027-03-31"
}
```
`scope` is `scheme` (needs `schemeId`, no `projectId`), `project` (needs `projectId`, no `schemeId`), or `agency` (neither). `validTo` is optional or `null` (no end) and must be on or after `validFrom`. A referenced scheme or project must exist and be active when set or changed. Response `201`: `id`, `name`, `designation`, `scope`, `schemeId`, `projectId` (the unused one is `null`), `validFrom`, `validTo`, `active`, `createdAt`, `updatedAt`. `PATCH` may change the scope; the merged row must still satisfy the rules above. A signatory's name is personal data, so audit rows and the logged request body show `"[redacted]"` for `name` (Q383).

---

## Public site endpoints (Phase 1, W-01, B-16)

Public website content covers 9 resources: `team-members`, `organogram`, `people`, `sample-papers`, `industry-linkages`, `grievance`, `posh`, `office-documents`, `events`.

### Admin endpoints (`/api/v1/admin/public-site/:slug`)
Roles: `aa_admin`, `mis`. All writes are audited.

- `GET /api/v1/admin/public-site/:slug`:
  Query parameters: `page` (default 1), `pageSize` (default 20, max 100), `published` (boolean), `archived` (boolean, default false).
  Default list excludes archived items (`{ archived: { $ne: true } }`). Pass `?archived=true` to view archived items.
- `GET /api/v1/admin/public-site/:slug/:id`:
  Returns item detail. Returns `404 NOT_FOUND` if the item is archived.
- `POST /api/v1/admin/public-site/:slug`:
  Creates an item.
  - Role rules: `mis` may create drafts only (`published: false`). Attempting `published: true` returns `403 FORBIDDEN`. Only `aa_admin` may publish.
  - Consent rule: `people` entries require `consentRecorded: boolean` and optional `consentNote: string`. If `published: true` is requested without `consentRecorded: true`, returns `409 CONSENT_REQUIRED`.
  - POSH rule: `posh` items with `kind: "committee_member"` require `consentRecorded: true` before publishing; returns `409 CONSENT_REQUIRED` otherwise.
- `PATCH /api/v1/admin/public-site/:slug/:id`:
  Updates an item.
  - Role rules: `mis` cannot edit published items (`403 FORBIDDEN`) and cannot set `published: true` (`403 FORBIDDEN`).
  - Consent rule: setting `published: true` on `people` or POSH `committee_member` requires `consentRecorded: true` (`409 CONSENT_REQUIRED`).
- `DELETE /api/v1/admin/public-site/:slug/:id`:
  Roles: `aa_admin` only. Soft-delete / archive: sets `archived: true` and `published: false`. Hard deletion is never performed. Archived items are hidden from default admin lists and never appear on public endpoints. Response: `204 No Content`.

### Public endpoints (`/api/public/:slug`)
Anonymous read-only access. Response header: `Cache-Control: public, max-age=300`. Rate-limited per IP (`PUBLIC_RATE_LIMIT_MAX` per minute).

- Only items with `published: true` and `archived: false` are returned.
- Whitelisted fields only (audit metadata, `createdBy`, `updatedBy`, `registryId`, etc. are omitted).
- **Dynamic registry status hiding (B-16):** For `people` (assessors and proctors), if the linked assessor/proctor in the registry is `active: false` or the assessor's `toa.expiresOn` is past, the person is automatically hidden from `/api/public/people` without altering the database `published` flag.
- **Utility bill proof-on-file marker (B-16):** For `office-documents`, categories `telephone_bill`, `internet_bill`, and `electricity_bill` return `proofOnFile: true` and `fileRef: null`. Other categories (e.g. `lease`) return `proofOnFile: false` with their `fileRef`.

---

## Phase 2+ stubs

Tests generator, proctoring, grievances, analytics, public site, accessibility, security — unchanged intent; see SCHEMA. Recognition and Annexure II sectors are Phase 1 (`/admin/recognition`, `qualifications.sector`). ERF weights are in docs/ERF.md (task C-01). Phase 2 notes that are not endpoints yet: live NCVET monitoring link, geo-tagged photos and videos for offline and blended batches (Guidelines 4.11b; backend built as V-01, see Evidence vault above), the 24-hour travel rule, theory-only online batches with no assessor, and gender-parity staff reporting (open questions 80–84).

## Attempt engine (task E-03)

All under `/api/v1/attempts`. An attempt is one candidate's go at one approved test paper (SCHEMA §3.21). Question text and answers never go into audit rows. Unknown request keys are `400 VALIDATION_ERROR`. Scores stay on the attempt and are not written into results (Q424).

### POST /api/v1/attempts/start
Role: `candidate` (on the active roster of the batch). Body `{ "batchId", "testPaperId" }`.
`201` new attempt, `200` when the candidate already has one for that paper (same id, same timer, same order). Returns `{ id, testPaperId, batchId, status, durationMinutes, startedAt, deadlineAt, closedAt, closeReason, serverTime, remainingSeconds, totalMarks, questions[] }`; each question is `{ questionId, order, type, marks, stem, options[{key,text}], answer }`. No answer key, no NOS, no marks awarded.
Errors: `403 FORBIDDEN` (not on the active roster), `404 NOT_FOUND` (unknown batch; paper unknown, draft, incomplete or for another qualification), `409 ATTEMPT_BATCH_NOT_IN_PROGRESS` (new attempts only; an existing attempt is still returned), `409 ATTEMPT_PAPER_UNAVAILABLE`.
Audit: `attempt.start`, or `attempt.start_replay`.

### GET /api/v1/attempts/:id
Roles: `candidate` (own attempt only), `aa_admin`, `assessor` (the batch's assessor), `ab_reviewer` (own awarding body). Anything else `403 FORBIDDEN`. An attempt past its accept window is closed as `timed_out` by this read. The candidate view is the start shape. The staff view adds `abId`, `candidateId`, `learnerId`, `candidateName`, `scores` and, per question, `nosId`, `pcId`, `awardedMarks`, `scoreStatus`, `scoredBy`, `markedBy`, `markedAt`, and `correctAnswer` only once the attempt is closed.

### PUT /api/v1/attempts/:id/answers
Role: `candidate`, own attempt. Body `{ "answers": [{ "questionId", "answer" }] }` (1 to 200 rows, no repeated question, `answer` up to 10000 characters, `null` or blank clears). For MCQ the answer must be an option key (case-insensitive; the stored key is kept). Last write wins per question. Accepted until `acceptUntil` (deadline plus grace). One bad row saves nothing. Returns `{ saved, savedAt, deadlineAt, remainingSeconds }`.
Errors: `400 VALIDATION_ERROR`, `409 ATTEMPT_CLOSED`, `409 ATTEMPT_TIME_UP` (the attempt is closed as `timed_out` and scored on what was saved).
Audit: `attempt.answers_save`, `meta.savedCount` only.

### POST /api/v1/attempts/:id/submit
Role: `candidate`, own attempt. No body. Closes and scores the attempt: MCQ by the stored key (full marks or 0, no negative marking), every other type `pending`. Idempotent: a closed attempt returns its state again. A submit after the accept window is a timeout. Returns `{ id, status, closeReason, closedAt, deadlineAt }`, never marks.
Audit: `attempt.submit`, `attempt.submit_replay`, or `attempt.submit_late` (which also writes `attempt.timeout`).

### PUT /api/v1/attempts/:id/manual-marks
Roles: `aa_admin`, `assessor` of the batch. Body `{ "marks": [{ "questionId", "marks" }] }` (1 to 200 rows, no repeats, 0 or more, at most two decimals). Only on a closed attempt, and only for questions the server did not score. A later mark replaces an earlier one. Returns the staff view.
Errors: `400 ATTEMPT_MARKS_EXCEED_CEILING` (`details.exceeded[{questionId,maxMarks,marks}]`), `400 ATTEMPT_QUESTION_AUTO_SCORED`, `400 VALIDATION_ERROR` (unknown question), `409 ATTEMPT_NOT_CLOSED`. A refused request changes nothing.
Audit: `attempt.manual_marks` with before and after (question ids, marks, totals).

### GET /api/v1/attempts
Roles: `aa_admin` (all), `assessor` (own batches), `ab_reviewer` (own awarding body). Query: `batchId`, `testPaperId`, `status`, `page`, `pageSize` (max 100). Returns `{ items, total, page, pageSize }`, newest first. Rows have ids, `status`, times, `scoringComplete`, `maxMarks`, `obtainedMarks`, `pendingCount`; no questions or answers.

### GET /api/v1/attempts/:id/summary
Role: `aa_admin`. Read-only totals to copy into a result draft: `{ attemptId, batchId, candidateId, learnerId, testPaperId, status, closedAt, scoringComplete, maxMarks, obtainedMarks, pendingMarks, pendingCount, byNos[{nosId,...}], byType[{type,...}] }`. `409 ATTEMPT_NOT_CLOSED` while in progress. Writes nothing.

### Timer and timeout
The server clock decides. `deadlineAt` = `startedAt` + duration (the paper's `durationMinutes`, else 60). Saves and submit are taken until `deadlineAt` + grace (30 s, env `ATTEMPT_GRACE_SECONDS`). A timeout is applied when the attempt is next read or written, or by `closeExpiredAttempts()` (no scheduler yet, Q423); it writes audit `attempt.timeout` (actor role `system`). `POST /tests/generate` takes an optional `durationMinutes` (1 to 600).
