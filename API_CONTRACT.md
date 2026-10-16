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
| `RATE_LIMITED` | 429 | Login/API rate limit (`LOGIN_RATE_LIMIT_*`). Behind a proxy set env `TRUST_PROXY` (default off; a hop count such as `1`, or `true`) so limits and logs use the real client IP |
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
| `MUST_CHANGE_PASSWORD` | 403 | The signed-in user still has `mustChangePassword: true`. Every route behind a login refuses except `POST /auth/change-password`, `POST /auth/logout`, `POST /auth/refresh` and `GET /auth/me` (B-17) |
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
| Access token | `401 UNAUTHORIZED` (a user with `mustChangePassword` may call this route; every other route returns `403 MUST_CHANGE_PASSWORD` until the password is changed, B-17) |
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

Roles: `aa_admin` | `mis`. `mis` may create, change, reset and resend only for users whose role is `tp`, `assessor`, `proctor` or `candidate` (D1, B-18a). A `mis` request that names any other role, or targets a user who has one (`aa_admin`, `sme`, `ab_reviewer`, `ncvet_viewer`, `mis`), is `403 FORBIDDEN` and stores and audits nothing. `aa_admin` may use every role. A successful create is audited (`user.create`, actor role in the row).

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

`PATCH` by `mis` follows the same limit: both the user's current role and any new `role` in the body must be one of the four.

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
  "testPaperId": null,
  "captureLocation": false,
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

### PUT /batches/:id/test-paper
B-18a (D5). Role: `aa_admin` only; every other role `403`. Sets the one test paper candidates of the batch can start. Body `{ "testPaperId": "<id>" }` (the only key; `null` and other keys are `400 VALIDATION_ERROR`). Returns the batch (`200`, with `testPaperId`).
Checks: the paper must be `approved` and complete (`409 BATCH_TEST_PAPER_NOT_APPROVED`), for the batch's qualification (`400 BATCH_TEST_PAPER_QUALIFICATION_MISMATCH`), and in the batch's assessment language, compared like the start rule (`409 BATCH_TEST_PAPER_LANGUAGE_MISMATCH`). Unknown batch or paper `404`. Setting or changing it is refused once any attempt exists on the batch, open or closed (`409 BATCH_TEST_PAPER_LOCKED`). Changing it before then replaces the earlier paper. Does not change batch status. A reassessment batch does not inherit the paper.
Audit: `batch.set_test_paper`, entity `batch`, `before: { testPaperId }`, `after: { testPaperId }`.

### PUT /batches/:id/capture-location
X-07. Role: `aa_admin` only; every other role `403`. Body `{ "captureLocation": true|false }` (the only key; a non-boolean or any other key is `400 VALIDATION_ERROR`). Returns the batch (`200`, with `captureLocation`). Unknown batch `404`. Any batch status. `captureLocation` is on every batch response and defaults to `false`. When it is `true` the candidate's browser may add its location to flag photos (see Proctoring, flag photos). Turning it off stops new coordinates being kept; coordinates already saved stay with their flags.
Audit: `batch.set_capture_location`, entity `batch`, `before: { captureLocation }`, `after: { captureLocation }`.

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

- `GET /batches/:id/login-events?from=&to=&actorType=`: login events for the batch, oldest `capturedAt` first. Items are the login-event response object without `replayed`. `from` and `to` are ISO-8601 instants (with `Z` or an offset), inclusive bounds on `capturedAt`; `from` after `to` is `400`. `actorType` is `assessor`, `proctor`, or `student`. A `candidate` gets only their own student events (D8). `tp` (own batches) gets the same items with `lat`, `lng` and `accuracy` set to `null` and `device.deviceId` removed (`device` keeps `platform` and `appVersion`); the location status, unavailable reason and no-fix flags stay. `aa_admin`, `mis`, `ncvet_viewer`, `ab_reviewer`, `assessor` and `proctor` (each within their scope) see every field.
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

Audit rules (B-17):
- An uploaded file never reaches an audit row. Question import, candidate CSV import, NQR import, evidence upload and login events keep the request body out (`omitRequestBody`), and the audit middleware refuses to store a Buffer, a typed array or a long base64 string on any route.
- Question routes (`/question-bank/*`) store only an allow-list of safe keys (ids, type, status, version, marks, counts and similar). Everything else, such as `stem`, `options`, `correctAnswer`, comments and question text, is dropped and the row carries `content: "[redacted]"`.
- Evidence and login-event rows carry no exact `latitude`, `longitude`, `lat`, `lng` or `deviceId`. The API response still returns them to those who may read them.
- If the audit insert fails after the change is saved, the success response is kept. Only the error code is logged on the server.

### GET /audit/access-log?subjectType=&subjectId=&actorId=&actorRole=&kind=&from=&to=&page=&pageSize=

`aa_admin` only (others `403`). Who read personal data of which person (S-01, TR s20). Rows are written by the list and detail endpoints that return personal data: `GET /users`, `/users/:id`, `/learners`, `/learners/:id`, `/assessors`, `/assessors/:id`, `/assessors/available`, `/proctors`, `/proctors/:id`, and `GET /batches/:id/candidates` (logged against the learner). One row per person returned; a list of 20 writes 20 rows with the same `requestId`. Rows hold ids and field names only, never the data. A read that cannot be logged returns `500` and no data.

Filters (all optional): `subjectType` = `user|learner|assessor|proctor|evidence|question|testPaper`; `subjectId`; `actorId` (user id); `actorRole`; `kind` = `list|detail`; `from`, `to` (ISO date or time, on `createdAt`, `from` <= `to`); `page` (default 1); `pageSize` (default 20, max 100). An unknown filter or a bad value is `400 VALIDATION_ERROR`. Newest first.

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
| `posh` | POSH policy and committee | `kind` (`policy` or `committee_member`), `title`, `body?`, `memberName?` (required for a committee member; `400` for a policy), `memberRole?` (committee member only; `400` for a policy), `fileRef?` | same |
| `office-documents` | Registered office documents | `category` (`ownership`, `lease`, `telephone_bill`, `internet_bill`, `electricity_bill`, `other`), `title`, `note?`, `fileRef` | same |
| `events` | Monthly calendar of events | `title`, `description?`, `date`, `endDate?`, `location?` (`YYYY-MM-DD`) | same |

Every item has `published` (default `false`) and `sortOrder` (integer 0 to 100000, default 0, lowest first). `photoRef`, `logoRef` and `fileRef` are references (up to 500 characters) to a file or photo hosted elsewhere. Only `http` or `https` addresses are accepted; anything else is `400 VALIDATION_ERROR`. The public web pages show photos and logos only for `https` addresses. This API stores no file and does not fetch one. Hosting is undecided (DECISIONS.md).

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

Query: `page`, `pageSize` (default 20, max 100); `people?kind=`, `posh?kind=`, `office-documents?category=`, `events?month=YYYY-MM` (events whose dates touch the month). Any other parameter is `400`. The public `page` is at most 100 (`400` above it). The `people` list reuses its set of active registry ids for 60 seconds, so a change in the registry can take up to a minute to show.

Response `200`: `{ "page": 1, "pageSize": 20, "total": 2, "items": [ ... ] }` with `Cache-Control: public, max-age=300`, except `people` and `posh`, which are `public, max-age=60` (D7). The server also keeps the `people` and `posh` answers in memory for 60 seconds per slug and query; any admin create, change or delete of that slug drops them at once (a browser or CDN copy can still be up to 60 seconds old). An unknown slug is `404`. Rate limit: `PUBLIC_RATE_LIMIT_MAX` requests (120) per `PUBLIC_RATE_LIMIT_WINDOW_MS` (60 seconds) per client IP, then `429 RATE_LIMITED` with `Retry-After`. Behind a reverse proxy set `TRUST_PROXY` (below) so the limit uses the real client IP.
---

## Question bank (Phase 2, Q-01)

Endpoints for question bank management, versioning, Excel imports, and coverage reporting.
Roles: `aa_admin` and `sme` write and import; `ab_reviewer` reads and may approve; `candidate` and `tp` are strictly denied (403). Other roles (`mis`, `assessor`, `proctor`, `ncvet_viewer`) are denied (403). Question content (stem, options, answers) is confidential. Audit logs redact question content.

### POST /api/v1/question-bank/questions
Roles: `aa_admin`, `sme`.
Creates a new question document (starts at `version: 1`, `status: "draft"`, `isLatest: true`).
National ID fields (`aadhaar`, `panNumber`, etc.) are rejected with 400 `VALIDATION_ERROR`. `status` is not accepted (unknown key, 400); a new question is always `draft`.
For `mcq`, `correctAnswer` may be an option key or the option text (case-insensitive) and is **stored as the option key**. Option keys that repeat when compared without case are refused (`400 VALIDATION_ERROR`; on update `400 DUPLICATE_OPTION_KEYS`; on import a row error). Import stores the key too.

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
Updates question content. Creates a new version (`version: previous.version + 1`), keeps the existing version with `isLatest: false`, and links `previousVersionId` and `rootQuestionId`. New version is always `draft`; `status` in the body is refused (400). `correctAnswer` is stored as the option key (see create).
Only the latest version can be updated: an older one gives `409 QUESTION_NOT_LATEST`. Two edits at once: one wins, the other gets `409 QUESTION_NOT_LATEST` (compare-and-set on `isLatest`, plus a unique `{rootQuestionId, version}` index). Retired: `409 QUESTION_RETIRED`.
Response `200 OK`: new version document. It counts against the daily content read cap and writes access-log rows, like `GET /questions/:id`.

### POST /api/v1/question-bank/questions/:id/retire (or DELETE)
Roles: `aa_admin`, `sme`.
Soft-deletes the question: sets `status: "retired"`, `retiredBy: user._id`, `retiredAt: Date`. Hard deletion is never performed.
Errors: `409 QUESTION_NOT_LATEST` (not the latest version), `409 QUESTION_RETIRED` (already retired; was `200` before).
Response `200 OK`: updated question document (counted against the content read cap and access-logged).

### POST /api/v1/question-bank/questions/:id/approve
Roles: `aa_admin`, `ab_reviewer`.
Sets `status: "approved"`, `approvedBy: user._id`, `approvedAt: Date`.
Errors: `409 QUESTION_NOT_LATEST`, `409 QUESTION_RETIRED`, `409 QUESTION_ALREADY_APPROVED` (approvedBy and approvedAt are never overwritten).
Response `200 OK`: approved question document (counted against the content read cap and access-logged).

### POST /api/v1/question-bank/questions/:id/submit-for-review
X-10. Roles: `aa_admin`, `sme`. No body. Draft to `in_review`. The reviewer's approve (above) takes a question in `draft` or `in_review`, so this step is a signal to the reviewer, not a requirement.
Errors: `404 NOT_FOUND`, `409 QUESTION_NOT_LATEST`, `409 QUESTION_RETIRED`, `409 QUESTION_ALREADY_APPROVED`, `409 QUESTION_ALREADY_IN_REVIEW`. Everyone else `403`.
Response `200 OK`: the question (counted against the content read cap and access-logged, like approve). Audit `question.submit_for_review`, entity `question`, no question text.

### GET /api/v1/question-bank/import-template
X-10. Roles: `aa_admin`, `sme`. Returns an empty `.xlsx` (`Content-Disposition: attachment; filename="question-import-template.xlsx"`, `Cache-Control: no-store`). Sheet `Questions` holds only the header row the import reads: `qualification, nos, pc, type, language, difficulty, bloomLevel, stem, optionA, optionB, optionC, optionD, optionE, optionF, correctAnswer, marks`. Sheet `Notes` explains the columns. The import reads the first sheet only. Not audited (no content).

### GET /api/v1/question-bank/coverage/:qualificationId
Roles: `aa_admin`, `sme`, `ab_reviewer`.
Coverage report for a qualification: lists every PC across its NOS with approved question counts and flags PCs with fewer than `QUESTION_MIN_APPROVED_PER_PC` (5, `server/src/config/compliance.js`) approved questions (`flagged: true`). Only approved **latest** versions are counted.
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

## Question review cycles (Phase 2, Q-04)

Backend only. Paths are under `/api/v1/question-bank`. Audit rows hold ids, dates, decisions and counts; never question text or reviewer comments (`comment` shows as `[redacted]` in the logged request body). Unknown request keys are `400 VALIDATION_ERROR`.

Roles: `aa_admin` and `sme` create, list, read and close cycles and set intervals. `ab_reviewer` reads cycles of their own awarding body and records decisions on them; a cycle of another awarding body (or any cycle, for a reviewer with no `abId`) is `404`. Every other role is `403`.

### POST /review-cycles
Roles: `aa_admin`, `sme`. Body:
```json
{ "qualificationId": "66f0...", "abId": "66f0...", "reviewerId": "66f0...", "dueDate": "2026-12-31", "questionIds": ["66f0..."] }
```
`questionIds` is optional (default: every approved, latest question of the qualification, up to 1000). `reviewerId` must be an active `ab_reviewer` whose `abId` equals the body's `abId` (`400`). `dueDate` is a real IST date, today or later (`400`). Questions must be approved, latest and of the qualification (`400 INVALID_QUESTIONS`, with `invalidQuestionIds`). Also `404 QUALIFICATION_NOT_FOUND`, `404 AWARDING_BODY_NOT_FOUND`, `409 NO_QUESTIONS_TO_REVIEW`, `409 REVIEW_CYCLE_ALREADY_OPEN` (one open cycle per qualification and awarding body). `201` returns the summary:
```json
{ "id": "66f0...", "qualificationId": "66f0...", "abId": "66f0...", "reviewerId": "66f0...", "dueDate": "2026-12-31", "status": "open", "overdue": false,
  "counts": { "total": 12, "decided": 0, "undecided": 12, "keep": 0, "revise": 0, "retire": 0 },
  "incomplete": false, "createdBy": "66f0...", "createdAt": "2026-10-15T...", "closedBy": null, "closedAt": null }
```
Audit `review_cycle.create`.

### GET /review-cycles?status=&qualificationId=&abId=&page=&pageSize=
Roles: `aa_admin`, `sme`, `ab_reviewer` (own awarding body; an `abId` filter cannot widen it). `200` `{ items: [summary], total, page, pageSize, totalPages }`, oldest `dueDate` first.

### GET /review-cycles/:id
Same roles and scope. `200` the summary plus `items: [{ questionId, rootQuestionId, decision, comment, decidedBy, decidedAt, resultQuestionId }]`. Read question text with `GET /questions/:id`.

### POST /review-cycles/:id/decisions
Roles: `ab_reviewer` of the cycle's awarding body only (`aa_admin` and `sme` get `403`). Body `{ "questionId", "decision": "keep"|"revise"|"retire", "comment": "1 to 2000 chars", "changes": { ...optional, revise only } }`. `changes` takes the same fields as `PUT /questions/:id` except `status`.
- `keep`: nothing changes on the question; its review clock restarts when the cycle is closed.
- `revise`: creates the next version through the existing versioning (draft, needs approval); `resultQuestionId` is that version.
- `retire`: the existing retire.

Errors: `404` question not in the cycle; `409 DECISION_ALREADY_RECORDED`; `409 REVIEW_CYCLE_CLOSED`; `409 QUESTION_NOT_REVIEWABLE` (the question is no longer the latest version, or is retired). If the revise or retire is refused (for example `400 INVALID_OPTIONS`) no decision is stored. `201`:
```json
{ "cycleId": "66f0...", "questionId": "66f0...", "decision": "revise", "comment": "...", "decidedBy": "66f0...", "decidedAt": "...", "resultQuestionId": "66f0...", "counts": { "total": 12, "decided": 1, "undecided": 11, "keep": 0, "revise": 1, "retire": 0 } }
```
Audit `review_cycle.decision` with the decision, ids and `commentLength` only.

### POST /review-cycles/:id/close
Roles: `aa_admin`, `sme`. Body `{ "allowIncomplete": false }` (optional). `409 UNDECIDED_ITEMS` (`details.undecided`) while any question has no decision, unless `allowIncomplete: true`, which closes with `incomplete: true`. `409 REVIEW_CYCLE_CLOSED` if already closed. `200` the summary. Audit `review_cycle.close`.

### GET /review-settings/:qualificationId and PUT /review-settings/:qualificationId
Read: `aa_admin`, `sme`, `ab_reviewer`. Write: `aa_admin`, `sme`. Body `{ "intervalMonths": 6 }`, integer 1 to 60. `200` `{ qualificationId, intervalMonths, isDefault }`; the default is 12 from `compliance.QUESTION_REVIEW_INTERVAL_MONTHS`. Audit `review_setting.update` with before and after.

### GET /review-due?page=&pageSize=
Roles: `aa_admin`, `sme`, `ab_reviewer` (only qualifications their awarding body has a batch or cycle for). `200` `{ items: [{ qualificationId, code, name, intervalMonths, lastCompletedReviewAt, dueQuestionCount, qualificationOverdue, awardingBodyIds }], total, page, pageSize, totalPages }`. Rule: docs/SCHEMA.md §3.35.

### Nightly reminder job
Runs once a day in the server process (same pattern as the SLA job; not an endpoint). For each due qualification and each active awarding body linked to it, it queues one `emailQueue` row (`kind: "question_review_due"`) to that body's `notificationEmails`: qualification code and name, number of questions past the interval, last completed review date. No question text. One reminder per qualification, awarding body and period (`reviewReminders` unique index); running the job again queues nothing new. A qualification with no active awarding body linked is skipped. No audit row.

## Evidence vault (Phase 2, V-01)

The browser screen is `/evidence` in the web app (V-02, no API change). Files live in object storage (local disk in development, an S3-compatible bucket in production; see README) under random keys. The API never returns a storage key, never uses a client file name as a path, and offers no way to replace or delete a file.

Read roles: `aa_admin`, `mis` and `ncvet_viewer` see every row; `ab_reviewer` sees rows of its own awarding body (no `abId` means no rows); `assessor` and `proctor` see only rows they uploaded. `candidate`, `tp` and `sme` get `403`. A row outside the caller's scope is `403`; an unknown id is `404`.

### POST /batches/:id/evidence

`multipart/form-data`. Roles: `aa_admin`, or the `assessor` or `proctor` assigned to the batch. Any other role, or another assessor or proctor, is `403`. Unknown batch `404`. A batch in `cancelled` or `rejected` is `409 INVALID_TRANSITION`; every other status accepts uploads.

Parts:

| Part | Required | Notes |
|---|---|---|
| `file` | yes | One file. Real type read from the bytes: `image/jpeg`, `image/png`, `application/pdf`, `video/mp4`. Anything else `415 UNSUPPORTED_FILE_TYPE`. If the part declares one of the four types and the bytes say another, `415 FILE_TYPE_MISMATCH`. The file name is ignored and never stored. Images and PDFs up to 25 MB, video up to 200 MB, else `413 FILE_TOO_LARGE`. An empty file is `400` |
| `clientEventId` | yes | Idempotency key, 1 to 200 characters |
| `kind` | yes | `photo`, `id_proof`, `attendance`, `equipment`, `other`, `video`. `video` needs an MP4 and an MP4 needs `video`; the other kinds take JPEG, PNG or PDF, except `photo`, which takes JPEG or PNG (`400` otherwise). `proctor_snapshot` (P-01) takes JPEG only, needs `sessionId`, and only a candidate may send it (see Proctoring below). **P-09:** a candidate may also send `id_proof` (their ID card photo): JPEG or PNG, at most 5 MB, `sessionId` required, same session checks as `proctor_snapshot`; a candidate sending any other kind is `403` |
| `sessionId` | with `proctor_snapshot`; with a candidate's `id_proof` | The candidate's own proctoring session on this batch. Any other kind with `sessionId` is `400`; staff sending `sessionId` with `id_proof` is `400` |
| `capturedAt` | yes | ISO 8601 with offset, from the device clock. Kept as sent |
| `candidateId` | no | A candidate row (roster id) of this batch, else `400` |
| `deviceId` | no | |
| `latitude`, `longitude`, `accuracy` | no | `latitude` -90 to 90, `longitude` -180 to 180, `accuracy` metres, 0 or more. Latitude and longitude go together; `accuracy` needs them |
| `locationStatus` | no | `captured` or `unavailable`. `unavailable` needs `locationUnavailableReason` (up to 200 characters) and no coordinates. A reason with a fix is `400` |

A request whose `Content-Length` header is over 200 MB plus 64 KB for the form is refused with `413 FILE_TOO_LARGE` before the body is read (B-17). The per-type limit (25 MB for images and PDFs) is still checked once the real type is known. A request with no `Content-Length` (chunked) is stopped by the upload limit while it streams.

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

### GET /evidence?batchId=&candidateId=&kind=&uploaderId=&sessionId=&from=&to=&hasLocation=&page=&pageSize=

Read roles above. All filters optional; an unknown filter or bad value is `400`. `from` and `to` are ISO dates or times applied to `capturedAt`. `uploaderId` is a user id. `sessionId` (X-06) is a proctoring session id; it narrows the list and never widens the caller's scope. `hasLocation=true` means `locationStatus` is `captured`; `false` is every other status. `page` default 1, `pageSize` default 20, max 100. Newest `capturedAt` first. The filters are ANDed with the caller's scope and never replace it: an assessor or proctor who passes another user's `uploaderId` gets an empty list (B-17).

`200`: `{ "page": 1, "pageSize": 20, "total": 3, "items": [ <evidence row as above, without replayed> ] }`

### GET /evidence/:id

`200` the row. Metadata reads are not written to the access log (DECISIONS 325), **except** `id_proof` rows (P-09, decision D3): reading one by detail or in a list writes an access-log row (`subjectType: "evidence"`, `fields: ["id_proof"]`) before the response is sent.

**`id_proof` read rule (P-09, D3).** Whatever the role table above says, a row of kind `id_proof` is returned by the list, detail, file and verify routes only to `aa_admin` and to the user who uploaded it. `proctor`, `assessor`, `ab_reviewer`, `mis` and `ncvet_viewer` get it neither in the list (it is left out, so `total` does not count it) nor by id (`403`). `POST /evidence/:id/verify` is `aa_admin` only as before.

### GET /evidence/:id/file

Same roles and scope as the row. Writes an access-log row for **every** download (`subjectType: "evidence"`, `fields: ["file"]`, plus a `learner` row when the evidence names a candidate), before anything is sent. If the log cannot be written the response is `500` and no file or link is returned.

- S3 driver: `200` JSON `{ "url", "expiresAt", "contentType", "size", "sha256" }`. The link is short-lived (`EVIDENCE_SIGNED_URL_SECONDS`, default 120) and the response is `Cache-Control: no-store`.
- Local driver: `200` with the file bytes, `Content-Type` from the stored type, `Content-Disposition: attachment; filename="evidence-<id>.<ext>"`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.

Query: `inline=true|false` (optional, default `false`; any other value or parameter is `400`). With S3 and `inline=true`, the link is issued with `Content-Disposition: inline` instead of `attachment`, so a browser can show an image or PDF in the page. It applies only to `image/*` and `application/pdf` files; any other type still gets `attachment`. The Download button does not send it. The local driver always sends `attachment`. The Evidence page's Preview sends `inline=true` (Q600); the local driver ignores it and streams the bytes.

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
`name` is optional (1 to 80 characters after trimming, else `400 VALIDATION_ERROR`). With no name the server stores the qualification name and the language, for example `"Electrician L4 (en)"`, cut to 80 characters (B-18a). `type` is optional (any type). A NOS may not have both an any-type quota and a typed quota, and no two quotas may share NOS and type. `totalMarks`, `seed` and `allowPartial` are optional. With no seed the server draws one and stores it.
Only approved, latest-version, non-retired questions in the language are used; no question appears twice.
`201` returns the draft paper (`_id`, `name`, `status`, `seed`, `rules`, `items[]`, `totalMarks`, `shortages`, `complete`, `poolHash`).
`422 TEST_BANK_SHORTAGE` when a quota cannot be filled: `error.details.shortages` lists `{nosId, type, requested, available}`. `422 TEST_MARKS_TARGET_NOT_MET` when the marks differ from the target (`details.totalMarks`, `details.targetMarks`). Nothing is stored. With `allowPartial: true` the draft is stored with `complete: false` and the shortages listed. Also `400 NOS_NOT_FOUND`, `DUPLICATE_QUOTA`, `OVERLAPPING_QUOTAS`, `404 QUALIFICATION_NOT_FOUND`.
Audit: `test.generate`.

### GET /api/v1/tests
Roles: `aa_admin`, `sme`, `ab_reviewer`. Query: `qualificationId` (id or code), `status` (`draft`|`submitted`|`approved`), `page`, `pageSize`. Returns `{items, total, page, pageSize}` without `items[]` of each paper.

### GET /api/v1/tests/:id
Same roles. The paper also carries `returnReason`, `returnedBy` and `returnedAt` (null unless the reviewer sent it back, X-10). `?withQuestions=true` adds `stem`, `options` and `correctAnswer` to each item, at most 50 items a page (S-02): `itemPage` (default 1) picks the page and the response adds `itemPage`, `itemPageSize` (50) and `itemTotal`. Without `withQuestions` the paper is returned in full, as ids only. Counts against the daily content-read cap (see Security audit tracker and content controls). `404 NOT_FOUND`.

### POST /api/v1/tests/generate with a weight profile (task E-02)
Two optional keys: `weightProfileId` (the profile's `rootProfileId`) and `version` (needs `weightProfileId`). With no `version` the latest approved version is used; a named version must be approved. Without `weightProfileId` nothing changes from E-01.
The quotas stay hard rules. Inside them the generator picks the questions that bring the paper closest to the profile's difficulty and Bloom percentages (whole-question targets by largest remainder). A question with no `difficulty`, or a `bloomLevel` that is not one of the six levels (case and spaces ignored), is unclassified: it is taken only when no classified question is left in that quota and is always counted in the report.
The paper then also has `weightProfile: {profileId, version}`, `weightMix` and `difficulty` / `bloomLevel` on each item (null when unclassified):
```json
"weightMix": {
  "totalItems": 10,
  "difficulty": { "easy": {"targetPercent":50,"targetCount":5,"achievedCount":5,"achievedPercent":50,"differenceCount":0}, "medium": {}, "tough": {}, "unclassified": {"achievedCount":0,"achievedPercent":0} },
  "bloom": { "remember": {}, "...": {}, "unclassified": {"achievedCount":0,"achievedPercent":0} },
  "maxDifficultyDeviationPoints": 0, "maxBloomDeviationPoints": 0,
  "unclassifiedDifficulty": 0, "unclassifiedBloom": 0,
  "matched": true
}
```
`differenceCount` is achieved minus target. `matched` is true only when every class hits its target and nothing is unclassified. A mismatch does not refuse the paper (Q402). Errors: `404 WEIGHT_PROFILE_NOT_FOUND` (unknown id, version, or no approved version), `409 WEIGHT_PROFILE_NOT_APPROVED`, `400 WEIGHT_PROFILE_QUALIFICATION_MISMATCH`. `regenerate-check` replays with the stored profile version. The `test.generate` audit row includes `weightProfile`.

### POST /api/v1/tests/:id/submit
B-18a (D4). Roles: `aa_admin`, `sme`. No body. Draft to `submitted` ("submitted for approval"); sets `submittedBy` and `submittedAt`. `409 TEST_ALREADY_SUBMITTED`, `409 TEST_ALREADY_APPROVED`, `409 TEST_PAPER_INCOMPLETE` (shortage or missed marks target), `409 TEST_PAPER_STALE` (a question was retired, unapproved or superseded since generation; `details.stale`), `404 NOT_FOUND`. Everyone else `403`. Audit: `test.submit` with before and after.

### POST /api/v1/tests/:id/approve
B-18a (D4, Guidelines 4.2d). Role: `ab_reviewer` only; `aa_admin`, `sme` and every other role are `403`. Submitted to approved; sets `approvedBy` and `approvedAt`. A draft is `409 TEST_NOT_SUBMITTED`. Also `409 TEST_ALREADY_APPROVED`, `409 TEST_PAPER_INCOMPLETE`, `409 TEST_PAPER_STALE` (checked again at approval). Only an approved, complete paper can be set on a batch or delivered. There is no link from a qualification to an awarding body (D2), so any `ab_reviewer` can approve any paper (Q860). Audit: `test.approve` with before and after.

### POST /api/v1/tests/:id/return
X-10 (D4). Role: `ab_reviewer` only (same as approve); everyone else `403`. Body `{ "reason": "<1 to 2000 characters>" }`, the only key. Moves a `submitted` paper back to `draft` and stores `returnReason`, `returnedBy` and `returnedAt`; the author can then submit it again (submit clears the three fields). `409 TEST_NOT_SUBMITTED` for a draft, `409 TEST_ALREADY_APPROVED` for an approved paper, `404 NOT_FOUND`, `400 VALIDATION_ERROR` for a missing reason. Returns the paper (`200`). Audit: `test.return` with before and after (status only changes); the request body is not logged and `meta` holds only `reasonLength`.

### POST /api/v1/tests/:id/regenerate-check
Roles: `aa_admin`, `sme`, `ab_reviewer`. Re-runs the selection with the stored seed and rules on the current bank. Returns `reproducible` (same questions, versions and order), `poolUnchanged` (bank pool is identical to generation time), `missing` and `extra` (`id:version`), and `stale` (stored questions no longer approved and current). If `poolUnchanged` is true and `reproducible` is false, the generator is broken. Audit: `test.regenerate_check`.
## Weight profiles (task E-02)

All under `/api/v1/weight-profiles`. A profile is a chain of versions; `:id` is the `rootProfileId` (the `_id` of version 1). Old versions are never changed or deleted. Unknown keys are rejected; national ID keys are rejected.

Body fields: `name` (1-120), `qualificationId` (optional, id or code; null or missing means any qualification), `difficultyWeights` `{easy, medium, tough}` (all required) and `bloomWeights` (any of `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`; missing counts as 0). Each weight is a percentage from 0 to 100 with at most 2 decimals, and each set must add up to exactly 100 (`400 VALIDATION_ERROR` otherwise).

| Call | Roles | What it does |
|---|---|---|
| `POST /` | `aa_admin`, `sme` | Creates version 1, status `draft`. `201`. Audit `weight_profile.create`. |
| `PATCH /:id` | `aa_admin`, `sme` | Any of the body fields plus optional `expectedVersion`. Inserts a new draft version (latest + 1) with the unchanged fields copied; the old version is kept. At least one field must change. `409 WEIGHT_PROFILE_STALE_VERSION` when `expectedVersion` is not the latest or two edits collide (`details.latestVersion`). Audit `weight_profile.edit` with before and after. |
| `POST /:id/approve` | `ab_reviewer` | Body `{version?}`, default the latest. Draft to approved, sets `approvedBy` and `approvedAt`. `409 WEIGHT_PROFILE_ALREADY_APPROVED`; `409 WEIGHT_PROFILE_VERSION_SUPERSEDED` when a newer version exists (`details.latestVersion`). Audit `weight_profile.approve` with before and after. |
| `GET /` | `aa_admin`, `sme`, `ab_reviewer` | Latest version of each profile. Query `qualificationId` (id or code), `status`, `page`, `pageSize`. Returns `{items, total, page, pageSize}`. |
| `GET /:id?version=n` | same | One version, the latest by default. `404 NOT_FOUND`. |
| `GET /:id/versions` | same | All versions, oldest first. `{items, total}`. |

Everyone else gets `403 FORBIDDEN`. Audit rows hold ids, name, version, status and the percentages only. See "POST /api/v1/tests/generate with a weight profile" for how a profile is used.

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
Anonymous read-only access. Response header: `Cache-Control: public, max-age=300` (`people` and `posh`: `public, max-age=60`, D7). Rate-limited per IP (`PUBLIC_RATE_LIMIT_MAX` per minute).

- Only items with `published: true` and `archived: false` are returned.
- Whitelisted fields only (audit metadata, `createdBy`, `updatedBy`, `registryId`, etc. are omitted).
- **Dynamic registry status hiding (B-16):** For `people` (assessors and proctors), if the linked assessor/proctor in the registry is `active: false` or the assessor's `toa.expiresOn` is past, the person is automatically hidden from `/api/public/people` without altering the database `published` flag.
- **Utility bill proof-on-file marker (B-16):** For `office-documents`, categories `telephone_bill`, `internet_bill`, and `electricity_bill` return `proofOnFile: true` and `fileRef: null`. Other categories (e.g. `lease`) return `proofOnFile: false` with their `fileRef`.

---

## Security audit tracker and content controls (task S-02)

All under `/api/v1/security`. Dates are `YYYY-MM-DD` (IST). Unknown body or query keys are `400 VALIDATION_ERROR`. Lists take `page` (default 1) and `pageSize` (default 20, max 100).

Roles: `aa_admin` writes; `aa_admin`, `mis` and `ncvet_viewer` read (except `/content-anomalies`, `aa_admin` only). Everyone else `403`. Every write is audited with before and after; the auditor, the finding owner and the finding description are shown as `"[redacted]"` in audit rows. `DELETE` archives (the row stays, hidden from every read); nothing is deleted.

### POST /security/audits
`{type, auditor, auditDate, scope, fixesDueDate?}`. `type` = `vapt|penetration_test|code_review|infrastructure|data_protection|other`. `fixesDueDate` must not be before `auditDate`. `201` returns `{id, type, auditor, auditDate, scope, status: "open", fixesDueDate, closedDate: null, createdAt, updatedAt}`. Audit: `securityAudit.create`.

### GET /security/audits?status=&type=
`{page, pageSize, total, items[]}`, newest audit date first.

### GET /security/audits/summary
`{asOf, openAudits, openFindingsBySeverity: {critical, high, medium, low, info}, openFindingsTotal, overdueCount, overdueAudits}`. `overdueCount` is open findings whose `dueDate` is before today; `overdueAudits` is open audits whose `fixesDueDate` is before today. Archived rows and closed findings are not counted.

### GET /security/audits/:id
`404 NOT_FOUND` for an unknown or archived id.

### PATCH /security/audits/:id
Any of the create fields plus `status` (`open|closed`) and `closedDate`. Closing sets `closedDate` to today unless one is sent (not in the future); reopening clears it; `closedDate` on an open audit is `400`. `fixesDueDate: null` clears the date. Audit: `securityAudit.update`.

### DELETE /security/audits/:id
Archives the audit. `409 INVALID_TRANSITION` while it still has findings that are not archived. `200 {id, archived: true}`. Audit: `securityAudit.archive`.

### POST /security/audits/:id/findings
`{severity, description, owner, dueDate, evidenceRef?}`. `severity` = `critical|high|medium|low|info`. `409 INVALID_TRANSITION` on a closed audit. `201` returns `{id, auditId, severity, description, owner, status: "open", dueDate, closedDate: null, evidenceRef, overdue, createdAt, updatedAt}`. Audit: `securityFinding.create`.

### GET /security/audits/:id/findings and GET /security/findings
Filters: `severity`, `status`, `overdue` (`true|false`), and `auditId` (on `/security/findings` only). Soonest `dueDate` first.

### GET /security/findings/:id, PATCH /security/findings/:id, DELETE /security/findings/:id
Same rules as audits (`status`, `closedDate`, `evidenceRef: null` to clear). Audit: `securityFinding.update`, `securityFinding.archive`.

### GET /security/content-anomalies?userId=&day=&page=&pageSize=
`aa_admin` only. Days on which a user was refused for reading too much question content, newest first: `{id, userId, role, day, cap, readCount, attemptedCount, refusedRequests, route, firstAt, lastAt}`. No question text, no ids.

### Content controls (all question and test paper content reads)
- **Daily cap.** `GET /question-bank/questions`, `GET /question-bank/questions/:id` and `GET /tests/:id?withQuestions=true` count every question returned against the caller's daily total (IST day, per user). Above the cap the request is refused before anything is sent: `429 CONTENT_READ_LIMIT` with `error.details.cap`, and an anomaly row is written. The cap and any per-role cap are in `server/src/config/content-controls.js`. Reads that carry no question text (paper lists, papers without `withQuestions`, counts, coverage) count 0.
- **No bulk export.** No endpoint returns more than 50 questions with answers in one response: `GET /question-bank/questions` now has `pageSize` max 50 (was 100; `400` above it), and paper questions are paged 50 at a time. There is no export endpoint.
- **Access log.** The reads above write `question` and `testPaper` rows (see `GET /audit/access-log`). A read that cannot be logged is not served.
- **Watermark.** Any future export of question or paper content must use `server/src/lib/watermark.js` (`applyWatermark`: user id, role, time). No file or PDF is generated yet.

## Phase 2+ stubs

Tests generator, proctoring, grievances, analytics, public site, accessibility, security — unchanged intent; see SCHEMA. Recognition and Annexure II sectors are Phase 1 (`/admin/recognition`, `qualifications.sector`). ERF weights are in docs/ERF.md (task C-01). Phase 2 notes that are not endpoints yet: live NCVET monitoring link, geo-tagged photos and videos for offline and blended batches (Guidelines 4.11b; backend built as V-01, see Evidence vault above), the 24-hour travel rule, theory-only online batches with no assessor, and gender-parity staff reporting (open questions 80–84).

## Attempt engine (task E-03)

All under `/api/v1/attempts`. An attempt is one candidate's go at one approved test paper (SCHEMA §3.21). Question text and answers never go into audit rows. Unknown request keys are `400 VALIDATION_ERROR`. Scores stay on the attempt and are not written into results (Q424).

### POST /api/v1/attempts/start
Role: `candidate` (on the active roster of the batch). Body `{ "batchId", "testPaperId" }`.
`201` new attempt, `200` when the candidate already has one for that paper (same id, same timer, same order). Returns `{ id, testPaperId, batchId, status, durationMinutes, startedAt, deadlineAt, closedAt, closeReason, serverTime, remainingSeconds, totalMarks, questions[] }`; each question is `{ questionId, order, type, marks, stem, options[{key,text}], answer }`. No answer key, no NOS, no marks awarded.
Errors: `403 FORBIDDEN` (not on the active roster), `404 NOT_FOUND` (unknown batch; paper unknown, not approved, incomplete, for another qualification, or not the paper set on the batch), `409 ATTEMPT_NO_TEST_PAPER` (D5: the batch has no `testPaperId`), `409 ATTEMPT_BATCH_NOT_IN_PROGRESS`, `409 ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW` (today in IST is before `assessmentStartDate` or after `assessmentEndDate`; `details` has both dates), `409 ATTEMPT_CANDIDATE_ABSENT` (attendance row with `present: false`), `409 ATTEMPT_LANGUAGE_MISMATCH` (`paper.rules.language` differs from the batch `assessmentLanguage`, compared trimmed and without case), `409 ATTEMPT_PAPER_UNAVAILABLE`. These apply to new attempts only; an existing attempt is still returned.
B-20: the response also carries `paused` (bool), `shuffleOptions` (bool), `settings` and `marks` (see "Batch settings" below). The question order follows the batch's `shuffleQuestions` and is stored; options follow `shuffleOptions`.
Audit: `attempt.start`, or `attempt.start_replay`.

### GET /api/v1/attempts/available
Role: `candidate` only; every other role `403 FORBIDDEN`. No query keys (`400 VALIDATION_ERROR` otherwise). Task B-19.
Lists, for each batch where the candidate is on the active roster and the batch is `in_progress`, the one test paper set on the batch (`batches.testPaperId`, D5; it must be approved and complete). A batch with no paper set lists nothing. A paper with an attempt of the candidate that is still open is also listed when the batch is no longer `in_progress` or its dates have passed (Q702, B-18a). Returns `{ items: [...] }`, batches by assessment start date. Each item:
`{ batchId, batchName, assessmentStartDate, assessmentEndDate, paperId, paperCode, paperName, language, questionCount, durationMinutes, attempt, startable }`.
`{ batchId, batchName, captureLocation, paperId, paperCode, paperName, language, questionCount, durationMinutes, attempt, startable }`. `captureLocation` (X-07) is the batch setting; when `true` the check screen shows "This exam records your location with flag photos."
- `batchName` is the qualification code and name with the assessment dates; `paperName` is the paper's `name`; a paper without one gets the qualification name and the language, for example `"Electrician L4 (en)"`. `paperCode` is the last 6 characters of the paper id, upper case (B-18a, Q700).
- `assessmentStartDate` and `assessmentEndDate` are the batch's dates as `YYYY-MM-DD` (IST calendar days; X-08). The window is whole days: there is no time of day. A paper whose attempt is closed stays listed only while its batch is `in_progress`.
- `language` is the paper's `rules.language`. `durationMinutes` is the paper's value, else 60.
- `attempt` is `null` or the candidate's own attempt on that paper: `{ id, status, startedAt, deadline, remainingSeconds }`. `remainingSeconds` is the time left to `deadline` for an open attempt (0 once past it) and `null` for a closed one. An open attempt past its accept window is closed as `timed_out` by this read (Q703).
- `startable` is `{ ok: true }` or `{ ok: false, reason }`. The rules are the ones `POST /attempts/start` uses (one shared function): `reason` is the error code start would return (`ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW`, `ATTEMPT_LANGUAGE_MISMATCH`, `ATTEMPT_CANDIDATE_ABSENT`, `ATTEMPT_PAPER_UNAVAILABLE`). An `in_progress` attempt before its `deadline` is `ok: true` (start resumes it, whatever the batch status or dates); past the deadline, inside the grace window, it is `ok: false` with `ATTEMPT_TIME_UP`. A batch with no paper set gives `ATTEMPT_NO_TEST_PAPER` on start. A `submitted` or `timed_out` attempt is `ok: false` with `ATTEMPT_CLOSED` (start replays it closed, Q701).
Never returns question ids, question text, options, answer keys, marks or scores, and never another candidate's attempts. Writes nothing except a lazy timeout.

### GET /api/v1/attempts/:id
Roles: `candidate` (own attempt only), `aa_admin`, `assessor` (the batch's assessor), `ab_reviewer` (own awarding body). Anything else `403 FORBIDDEN`. An attempt past its accept window is closed as `timed_out` by this read. The candidate view is the start shape. The staff view adds `abId`, `candidateId`, `learnerId`, `candidateName`, `scores` and, per question, `nosId`, `pcId`, `awardedMarks`, `scoreStatus`, `scoredBy`, `markedBy`, `markedAt`, and `correctAnswer` only once the attempt is closed. The staff view is paged like `GET /tests/:id`: `?itemPage=` (default 1), at most 50 questions per page, with `itemPage`, `itemPageSize` and `itemTotal` in the reply. It writes access-log rows for the questions returned but does not count against the daily content read cap (Q588); the cap still applies to the question bank and `GET /tests/:id?withQuestions=true`. The candidate view is not paged. Who sees answer keys is unchanged.

### PUT /api/v1/attempts/:id/answers
Role: `candidate`, own attempt. Body `{ "answers": [{ "questionId", "answer" }] }` (1 to 200 rows, no repeated question, `answer` up to 10000 characters, `null` or blank clears). For MCQ the answer must be an option key (case-insensitive; the stored key is kept). Last write wins per question. Accepted until `acceptUntil` (deadline plus grace). One bad row saves nothing. Returns `{ saved, savedAt, deadlineAt, remainingSeconds }`.
Errors: `400 VALIDATION_ERROR`, `409 ATTEMPT_CLOSED`, `409 ATTEMPT_TIME_UP` (the attempt is closed as `timed_out` and scored on what was saved), `409 ATTEMPT_PAUSED` (B-20: the flag policy paused the attempt; nothing is saved and `Your test is paused. Please contact your proctor.` is the message; saved answers are kept).
Audit: `attempt.answers_save`, `meta.savedCount` only.

### POST /api/v1/attempts/:id/submit
Role: `candidate`, own attempt. No body. Closes and scores the attempt: MCQ by the stored key (full marks or 0, no negative marking), every other type `pending`. Idempotent: a closed attempt returns its state again. A submit after the accept window is a timeout. Returns `{ id, status, closeReason, closedAt, deadlineAt, marks }`; `marks` is `null` unless the batch has `showMarksToCandidate` (B-20), then `{ obtainedMarks, maxMarks, complete }`, totals only.
B-20 errors: `409 ATTEMPT_PAUSED`, and `409 ATTEMPT_UNANSWERED_QUESTIONS` (`details.unansweredCount`) when the batch has `questionsMandatory` and a question has no answer. A submit after the accept window is still a timeout and is not blocked.
Audit: `attempt.submit`, `attempt.submit_replay`, or `attempt.submit_late` (which also writes `attempt.timeout`).

### PUT /api/v1/attempts/:id/manual-marks
Roles: `aa_admin`, `assessor` of the batch. Body `{ "marks": [{ "questionId", "marks" }] }` (1 to 200 rows, no repeats, 0 or more, at most two decimals). Only on a closed attempt, and only for questions the server did not score. A later mark replaces an earlier one. Returns the staff view. Locked once the batch result is submitted (D6, B-18a): while the result of the batch is `submitted`, `validated` or `published` every call is `409 ATTEMPT_MARKS_LOCKED` (`details.resultStatus`). To change a mark later, the awarding body reviewer returns the result for correction with a reason (`POST /batches/:id/return-for-correction`, audited, result back to `draft`); marks can then be changed again until the result is submitted again. A published result cannot be returned, so its marks stay locked.
Errors: `400 ATTEMPT_MARKS_EXCEED_CEILING` (`details.exceeded[{questionId,maxMarks,marks}]`), `400 ATTEMPT_QUESTION_AUTO_SCORED`, `400 VALIDATION_ERROR` (unknown question), `409 ATTEMPT_NOT_CLOSED`, `409 ATTEMPT_MARKS_LOCKED`. A refused request changes nothing.
Audit: `attempt.manual_marks` with before and after (question ids, marks, totals).

### GET /api/v1/attempts
Roles: `aa_admin` (all), `assessor` (own batches), `ab_reviewer` (own awarding body). Query: `batchId`, `testPaperId`, `status`, `page`, `pageSize` (max 100). Returns `{ items, total, page, pageSize }`, newest first. Rows have ids, `status`, times, `scoringComplete`, `maxMarks`, `obtainedMarks`, `pendingCount`; no questions or answers.

### GET /api/v1/attempts/:id/summary
Role: `aa_admin`. Read-only totals to copy into a result draft: `{ attemptId, batchId, candidateId, learnerId, testPaperId, status, closedAt, scoringComplete, maxMarks, obtainedMarks, pendingMarks, pendingCount, byNos[{nosId,...}], byType[{type,...}] }`. `409 ATTEMPT_NOT_CLOSED` while in progress. Writes nothing.

### Timer and timeout
The server clock decides. `deadlineAt` = `startedAt` + duration (the paper's `durationMinutes`, else 60). Saves and submit are taken until `deadlineAt` + grace (30 s, env `ATTEMPT_GRACE_SECONDS`). A timeout is applied when the attempt is next read or written, or by the attempt sweep job (`closeExpiredAttempts()`, every 5 minutes and once at startup); `closedAt` is the earlier of now and `deadlineAt`. It writes audit `attempt.timeout` (actor role `system`). `POST /tests/generate` takes an optional `durationMinutes` (1 to 600).
The server clock decides. `deadlineAt` = `startedAt` + duration (the paper's `durationMinutes`, else 60). Saves and submit are taken until `deadlineAt` + grace (30 s, env `ATTEMPT_GRACE_SECONDS`). A timeout is applied when the attempt is next read or written, or by `closeExpiredAttempts()` (no scheduler yet, Q423); it writes audit `attempt.timeout` (actor role `system`). `POST /tests/generate` takes an optional `durationMinutes` (1 to 600).

## Proctoring (tasks P-01, P-04, P-08)

All under `/api/v1/proctoring`. A prototype for a demo: detection runs in the candidate's browser and sends flags here. **Nothing is invalidated automatically.** A flag only records an event; a person reviews it, and even `invalidate_recommended` only marks the session (the attempt and the result never change). Unknown request keys are `400 VALIDATION_ERROR`; national ID keys are refused. Collections: SCHEMA §3.40.

Session `status` is computed, not stored: `ended` once the attempt is `submitted` or `timed_out`; `feed_lost` when there was no heartbeat for `PROCTOR_FEED_LOST_INTERVALS` x `snapshotIntervalSeconds` (3 x 30 = 90 s; the session start counts as the first heartbeat); `active` otherwise.

### POST /api/v1/proctoring/sessions
Role: `candidate`, for their own attempt (`attempts.userId`). Body `{ "attemptId" }`. `201` new, `200` when the attempt already has a session (same id). A new session needs the attempt `in_progress`; an existing session is returned whatever the attempt status.
```json
{ "id": "66f0...", "attemptId": "66f0...", "batchId": "66f0...", "status": "active",
  "config": { "snapshotIntervalSeconds": 30, "detectionIntervalMs": 1000, "flagCooldownSeconds": 15,
              "sustainedSeconds": { "face_not_present": 5, "camera_blocked": 5, "camera_frozen": 8 },
              "flagSeverity": { "tab_hidden": "low", "face_not_present": "medium", "phone_detected": "high" } },
  "captureLocation": false }
```
The numbers come from `server/src/config/compliance.js` (SCHEMA §2). X-07: `config.flagSeverity` is `PROCTOR_FLAG_SEVERITY` (every type); the browser draws the severity on the flag photo. `captureLocation` is the batch setting (`PUT /batches/:id/capture-location`); the browser asks for the location only when it is `true`.
Errors: `403 FORBIDDEN` (another user's attempt, any other role), `404 NOT_FOUND` (unknown attempt), `409 PROCTORING_ATTEMPT_CLOSED` (new session for a closed attempt).
Audit: `proctoring.session_start` or `proctoring.session_replay`.

### POST /api/v1/proctoring/sessions/:id/heartbeat
Role: `candidate`, own session. Body `{}` (any key is `400`). Sets `lastSeenAt` to the server time. `200 { id, status, paused, lastSeenAt, serverTime }` (`paused`: B-20, whether the flag policy has paused the attempt). Send it at least every `snapshotIntervalSeconds`.
Audit: `proctoring.heartbeat` with `before.lastSeenAt` and `after.lastSeenAt` (open question 622).

### POST /api/v1/proctoring/sessions/:id/flags
Role: `candidate`, own session.
```json
{ "clientEventId": "f-0192", "type": "phone_detected", "capturedAt": "2026-11-20T05:00:03.000Z",
  "detail": { "label": "cell phone", "count": 1, "confidence": 0.82 }, "evidenceId": "66f0..." }
```
| Field | Required | Rule |
|---|---|---|
| `clientEventId` | yes | 1 to 200 characters; idempotency key within the session |
| `type` | yes | `tab_hidden`, `fullscreen_exit`, `window_blur`, `permission_revoked`, `object_detected`, `face_not_present`, `multiple_faces`, `person_detected`, `phone_detected`, `camera_blocked`, `camera_frozen`, `face_mismatch`, `id_mismatch`, `id_unreadable` |
| `capturedAt` | yes | ISO-8601 with `Z` or an offset; device clock, stored as sent |
| `detail` | no | Only `label` (1 to 60 letters, digits, spaces, `_`, `-`), `count` (integer 0 to 100), `confidence` (0 to 1). Never an image, a name or other personal data; any other key is `400` |
| `evidenceId` | no | A `proctor_snapshot` evidence row of this session, else `400` |
| `location` | no | X-07. `{ latitude (-90 to 90), longitude (-180 to 180), accuracy (metres, 0 to 1000000, optional) }`, no other key. Kept only when the batch has `captureLocation` on; otherwise it is dropped and the flag has `locationStatus: "not_shared"`. Not part of the replay check: a resend with a different `location` returns the stored flag |

The **server** sets `severity` (a `severity` key in the body is `400`): low `tab_hidden`, `fullscreen_exit`, `window_blur`, `permission_revoked`, `object_detected`; medium `face_not_present`, `id_unreadable`; high `multiple_faces`, `person_detected`, `phone_detected`, `camera_blocked`, `camera_frozen`, `face_mismatch`, `id_mismatch`.

`201` new, `200` replay: `{ paused, id, sessionId, clientEventId, type, severity, capturedAt, receivedAt, evidenceId, replayed }` (`paused`: B-20, true when this flag made the batch's flag policy pause the attempt, or it already was). The same `clientEventId` with a different `type`, `capturedAt`, `detail` or `evidenceId` is `409 CONFLICT_IDEMPOTENT`. The server does not enforce the cooldown.
Audit: `proctoring.flag` or `proctoring.flag_replay` (session, type, severity, time, evidence id; no request body).
`201` new, `200` replay: `{ id, sessionId, clientEventId, type, severity, capturedAt, receivedAt, evidenceId, replayed }`. The same `clientEventId` with a different `type`, `capturedAt`, `detail` or `evidenceId` is `409 CONFLICT_IDEMPOTENT`. The server does not enforce the cooldown.
Audit: `proctoring.flag` or `proctoring.flag_replay` (session, type, severity, time, evidence id; no request body). **Coordinates are never in an audit row, an access-log row or a log line** (X-07). The response does not echo the location.

#### Flag photos (X-07)
When the engine raises a flag it takes a camera photo at that moment, burns a banner into the bottom of the JPEG in the browser (flag name, the reason in one line such as "Face not visible for 2 seconds", severity, date and time in IST, attempt short code (last 6 characters of the attempt id, upper case), and "Location: lat, lon (accuracy N m)" or "Location not shared"), and uploads it as `proctor_snapshot`; the flag carries it as `evidenceId`. The photo is at most 150 KB (quality, then size, is reduced to fit); one photo per flag, so the cooldown applies. If the frame, the banner or the upload fails, the flag is still saved without `evidenceId` and the review page says "No image for this flag". The interval snapshots have no banner. Only the banner photo is kept (open question 820).
The banner is drawn in the browser and can be forged, so the server keeps the facts itself: the flag row holds `type`, `severity` (server table), `capturedAt` (browser clock), `receivedAt` (server clock) and, when allowed, the encrypted coordinates. The reason line is built by the server from the type and `PROCTOR_SUSTAINED_SECONDS` (`server/src/modules/proctoring/flag-reason.js`), not read from the picture.

### GET /api/v1/proctoring/flags/:id/capture
X-07. What the server saved about one flag photo, to show beside the picture. Roles: `aa_admin`, `proctor`, `assessor`, `ab_reviewer`, `ncvet_viewer` and `tp`, scoped like the session (the proctor and assessor of the batch, the awarding body's reviewer, the batch's training partner); anything else or outside scope `403`, unknown flag `404`.
```json
{ "flagId": "66f0...", "sessionId": "66f0...", "type": "face_not_present",
  "reason": "Face not visible for 2 seconds", "severity": "medium",
  "capturedAt": "2026-11-20T05:00:03.000Z", "receivedAt": "2026-11-20T05:00:04.120Z",
  "evidenceId": "66f0...", "locationStatus": "captured", "locationVisible": true,
  "location": { "latitude": 19.076123, "longitude": 72.877456, "accuracy": 12 } }
```
`capturedAt` is the browser clock (the time drawn on the photo comes from it) and `receivedAt` the server clock; the review page shows both so a mismatch is visible. `locationStatus` is `captured` or `not_shared`. Coordinates are personal data: `location` is returned only to `aa_admin`, the batch's `tp` and the batch's assigned `proctor` (`locationVisible: true`); every other role gets `locationVisible: false` and `location: null`. When coordinates are returned the read is access-logged before the response is sent (a row for the flag, subject type `proctoringFlag`, field `location`, and one for the learner, field `flagLocation`); if it cannot be logged the read fails. No audit row (read only).


Storage (X-06): the flag and the session's `flagCounts` are written in one transaction. A MongoDB that is not a replica set refuses transactions with code 20 (IllegalOperation); the server then writes the flag and the count as two plain writes and logs one warning, so the flag is not lost. The supported set-up is still the replica set in docker-compose.yml.

### Snapshots: POST /batches/:id/evidence with kind `proctor_snapshot`
The evidence vault upload, with `kind=proctor_snapshot` and `sessionId=<proctoring session id>`. JPEG only (PNG or anything else is `400`), 25 MB limit. Only a `candidate` may send this kind, and it is the only kind a candidate may send (`403` otherwise). The session must be the candidate's own and on this batch (`403`), and the candidate must be on the batch's active roster (`403`). `candidateId` may not be sent with this kind; the server copies it from the session. `sessionId` with any other kind is `400`. Evidence responses now carry `sessionId` (null for other kinds). Idempotency, checksum, audit and access logging are unchanged. The batch's assigned `proctor` and `assessor` may also read `proctor_snapshot` rows of their batches (open question 624).

### GET /api/v1/proctoring/sessions?batchId=&status=&minSeverity=&page=&pageSize=
Roles: `aa_admin` and `ncvet_viewer` (all), `proctor` (batches whose `proctorId` is theirs), `assessor` (batches whose `assessorId` is theirs), `ab_reviewer` (own `abId`). Everyone else `403`. `status` is `active`, `feed_lost` or `ended`; `minSeverity` `low`, `medium` or `high` keeps sessions with at least one flag of that severity or higher. `page` default 1, `pageSize` default 50, max 100. Newest session first.
```json
{ "page": 1, "pageSize": 50, "total": 1, "serverTime": "2026-11-20T05:01:00.000Z",
  "items": [ { "id": "66f0...", "attemptId": "66f0...", "batchId": "66f0...", "abId": "66f0...",
    "candidateId": "66f0...", "candidateName": "Asha Devi", "status": "feed_lost", "attemptStatus": "in_progress",
    "startedAt": "...", "lastSeenAt": "...", "flagCounts": { "low": 2, "medium": 0, "high": 1 },
    "unreviewedCount": 3, "warningCount": 0, "invalidationRecommended": false, "invalidationRecommendedAt": null } ] }
```

### GET /api/v1/proctoring/sessions/:id
Same roles and scope (`403` outside scope, `404` unknown). B-20: list items and this detail also carry `paused`; the detail adds `lock { paused, pausedAt, timesPaused, lastUnlockedAt, countedFlags, policy { action, pauseAfterFlags, countSeverities } }`. The list item plus `serverTime`, `warnings[{ id, message, createdAt }]` and `flags[]`, oldest `capturedAt` first: `{ id, sessionId, clientEventId, type, severity, capturedAt, receivedAt, detail, sustainedSeconds, evidenceId, review }`, where `sustainedSeconds` (X-06) is how long the condition must last before the browser raises this type (`PROCTOR_SUSTAINED_SECONDS`: `face_not_present` 2, `camera_blocked` 2, `camera_frozen` 8), and `null` for one-off events such as `tab_hidden`; it is the rule, not a measured duration, and it is also on the review response. In `review` is `null` or `{ decision, note, decidedAt, decidedBy, decidedByRole }`. Load a snapshot with `GET /evidence/:evidenceId/file` (access-logged). The proctor page lists a session's photos with `GET /evidence?sessionId=<session id>&kind=proctor_snapshot&pageSize=100` (X-06) and shows those that no flag points at as the "Snapshots" strip. The same read roles and scope apply; no image bytes or links are written to any audit row.
Same roles and scope (`403` outside scope, `404` unknown). The list item plus `serverTime`, `warnings[{ id, message, createdAt }]` and `flags[]`, oldest `capturedAt` first: `{ id, sessionId, clientEventId, type, severity, capturedAt, receivedAt, detail, sustainedSeconds, evidenceId, locationStatus, review }`, where `sustainedSeconds` (X-06) is how long the condition must last before the browser raises this type (`PROCTOR_SUSTAINED_SECONDS`: `face_not_present` 2, `camera_blocked` 2, `camera_frozen` 8), and `null` for one-off events such as `tab_hidden`; it is the rule, not a measured duration, and it is also on the review response. In `review` is `null` or `{ decision, note, decidedAt, decidedBy, decidedByRole }`. `locationStatus` (X-07) says whether coordinates were kept; the coordinates themselves are only in `GET /proctoring/flags/:id/capture`. Load a snapshot with `GET /evidence/:evidenceId/file` (access-logged). The proctor page lists a session's photos with `GET /evidence?sessionId=<session id>&kind=proctor_snapshot&pageSize=100` (X-06) and shows those that no flag points at as the "Snapshots" strip. The same read roles and scope apply; no image bytes or links are written to any audit row.

### GET /api/v1/proctoring/sessions/:id/report (P-04)
Same roles and scope. Writes nothing.
```json
{ "sessionId": "...", "attemptId": "...", "batchId": "...", "candidateId": "...", "candidateName": "Asha Devi",
  "generatedAt": "...", "status": "ended", "attemptStatus": "submitted", "startedAt": "...", "lastSeenAt": "...",
  "invalidationRecommended": true, "invalidationRecommendedAt": "...",
  "totals": { "flags": 3, "bySeverity": { "low": 2, "medium": 0, "high": 1 }, "reviewed": 2, "unreviewed": 1, "warnings": 0 },
  "byType": [ { "type": "phone_detected", "severity": "high", "count": 1 }, { "type": "tab_hidden", "severity": "low", "count": 2 } ],
  "timeline": [ { "flagId": "...", "type": "tab_hidden", "severity": "low", "capturedAt": "...", "receivedAt": "...", "evidenceId": null, "decision": "dismiss" } ],
  "decisions": [ { "flagId": "...", "type": "tab_hidden", "severity": "low", "decision": "dismiss", "note": null, "decidedAt": "...", "decidedByRole": "proctor" } ] }
```
`byType` is sorted high to low severity, then by type. `timeline` is oldest first; `decisions` are in the order they were made.

### PATCH /api/v1/proctoring/flags/:id/review (P-08)
Roles: `aa_admin` (any flag) and `proctor` (flags of their batches). Body `{ "decision": "dismiss" | "warn" | "invalidate_recommended", "note"?: "up to 300 characters" }`. Only `aa_admin` may send `invalidate_recommended` (`403` for a proctor). Every other role `403`; unknown flag `404`.
- `dismiss`: records the decision only.
- `warn`: also adds a warning to the session. Its message is the `note`, or a default message when there is no note. The candidate reads it at `GET /sessions/:id/warnings`.
- `invalidate_recommended`: also marks the session (`invalidationRecommended: true`; the first recommendation is kept). It never changes the attempt or the result; invalidating is a separate human step outside this API.

One decision per flag: a second review is `409 PROCTORING_FLAG_REVIEWED` (open question 625). `200` the flag as in the detail view.
Audit: `proctoring.review_dismiss`, `proctoring.review_warn` or `proctoring.review_invalidate_recommended`, with `before` and `after` `{ flag: { sessionId, type, severity, capturedAt, evidenceId, detail, decision, noteLength }, session: { attemptId, batchId, candidateId, lastSeenAt, flagCounts, warningCount, invalidationRecommended } }`. The note text, the warning message, the snapshot and the candidate's name are never written to the audit row.

### POST /api/v1/proctoring/sessions/:id/unlock (B-20)
Roles: `aa_admin` (any session) and `proctor` (sessions of their own batches); anyone else, or a proctor of another batch, `403 FORBIDDEN`. Body `{}`. Lifts a flag-policy pause: the attempt can save and submit again and the session's counted flags restart from zero. The exam clock is not changed. `200 { sessionId, attemptId, lock }`, `lock` as in the session detail.
Errors: `404 NOT_FOUND`, `409 PROCTORING_NOT_PAUSED`, `409 PROCTORING_ATTEMPT_CLOSED`.
Audit: `proctoring.unlock`, `before { paused: true, countedFlags }`, `after { paused: false, countedFlags: 0 }`.

### GET /api/v1/proctoring/sessions/:id/warnings
Role: `candidate`, own session only (staff read warnings in the session detail). `200 [ { "id", "message", "createdAt" } ]`, oldest first.
## Batch settings (task B-20)

Per-batch settings, edited by `aa_admin` only. A batch nobody changed behaves exactly as before: the defaults below are today's behaviour. Defaults and limits live in `server/src/config/batch-settings.js`. Unknown keys are `400 VALIDATION_ERROR`; national ID keys are refused. The settings hold no personal data.

### GET /api/v1/batches/:id/settings
Roles: `aa_admin`, `mis`, `assessor`, `proctor`, `tp`, `ab_reviewer`, `ncvet_viewer`, with the usual batch row scope (`403` outside it, `404` unknown). `candidate` and `sme` get `403`. `200 { batchId, settings }`; `settings` is always the full shape:
```json
{ "shuffleQuestions": true, "shuffleOptions": false, "showMarksToCandidate": false, "questionsMandatory": false,
  "flagPolicy": { "action": "record", "pauseAfterFlags": 3, "countSeverities": ["high"] },
  "imageCapture": { "intervalSeconds": 30, "atStartAndEnd": true },
  "candidateInfoPopup": { "enabled": false, "fields": [] },
  "captureLocation": false }
```

### PATCH /api/v1/batches/:id/settings
Role: `aa_admin` only (`403` for every other role). Body: any non-empty subset of the keys above; inside `flagPolicy`, `imageCapture` and `candidateInfoPopup` any subset of their keys. Limits: `flagPolicy.action` is `record` or `pause`; `pauseAfterFlags` an integer 1 to 20; `countSeverities` exactly `["high"]` or `["medium","high"]`; `imageCapture.intervalSeconds` an integer 10 to 120; `candidateInfoPopup.fields` a list without repeats from `email`, `fatherName`, `gender`, `dateOfBirth`, and at least one when `enabled` is true (checked on the merged result). Returns `200` like GET. The full merged shape is stored.
Errors: `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 NOT_FOUND`.
Audit: `batch.settings_update` with `before { settings }` and `after { settings }`.

What each setting does:
- `shuffleQuestions` (default true): the question order is drawn when an attempt starts, seeded by the attempt id, and stored; a resume shows the same order. `false` keeps the paper order.
- `shuffleOptions` (default false): options are shown in an order seeded by the attempt id and question id, the same on every read. Answers and marking use the option key, never the position. Copied to the attempt at start.
- `showMarksToCandidate` (default false): after the attempt closes, the submit response and `GET /attempts/:id` carry `marks { obtainedMarks, maxMarks, complete }` (totals; `complete` is false while hand-marked answers are pending). Never per-question marks or keys.
- `questionsMandatory` (default false): see `POST /attempts/:id/submit`.
- `flagPolicy`: `record` only saves flags for review. `pause`: when the flags of the attempt with a counted severity reach `pauseAfterFlags`, the attempt is paused. While paused, `PUT /attempts/:id/answers` and `POST /attempts/:id/submit` return `409 ATTEMPT_PAUSED`, saved answers stay, the clock keeps running (a timeout still closes the attempt as `timed_out`), and a pause never fails or changes a result. `aa_admin` or the batch's proctor unlocks with `POST /proctoring/sessions/:id/unlock`; the count then restarts from zero. The pause writes audit `attempt.pause` (actor role `system`; counts and ids only). Flags are still recorded while paused.
- `imageCapture`: `intervalSeconds` becomes `config.snapshotIntervalSeconds` of a proctoring session created afterwards (a running session keeps its own); `atStartAndEnd` is delivered as `config.snapshotAtStartAndEnd`.
- `captureLocation` (default false): the field and the API only. It is returned in the attempt `settings` for X-07.

Attempt responses for the candidate (`POST /attempts/start`, `GET /attempts/:id`) add: `paused`, `shuffleOptions` and
```json
"settings": { "questionsMandatory": false, "showMarksToCandidate": false, "flagPolicy": { "action": "record" },
  "imageCapture": { "intervalSeconds": 30, "atStartAndEnd": true },
  "candidateInfoPopup": { "enabled": false, "fields": [] }, "captureLocation": false },
"marks": null
```
The pause limit and the counted severities are not sent to the candidate.

### GET /api/v1/batches/:id/candidate-info/mine
Role: `candidate`, active on the roster of the batch (`403` otherwise). `200 { batchId, enabled, fields, submitted }`. No values.

### PUT /api/v1/batches/:id/candidate-info
Role: `candidate`, active on the roster. Body: exactly the fields in `candidateInfoPopup.fields`, no others: `email` (valid address), `fatherName` (1 to 200 characters), `gender` (`female`, `male`, `other`), `dateOfBirth` (`YYYY-MM-DD`). Any other key, a missing field or a national ID key is `400 VALIDATION_ERROR`; `409 CANDIDATE_INFO_NOT_ENABLED` when the batch does not ask. Saves (or replaces) the candidate's row, encrypted. `200 { batchId, submitted: true, fields }`.
Audit: `batch.candidate_info_save`, `meta.fields` (names only; no request body, no values).

### GET /api/v1/batches/:id/candidate-info
Roles: `aa_admin`, and `tp` of the batch (`403` for everyone else, including other tps). `200 { batchId, enabled, fields, items[{ candidateId, learnerId, candidateName, submittedAt, email, fatherName, gender, dateOfBirth }] }`, newest first; fields the batch does not ask are `null`. Personal data: every call writes `accessLogs` rows (subject type `learner`, field names only).

## Proctoring sessions (planned; the candidate exam page, task F-05, calls these)

The server side is a separate task. These are the shapes the web client (`web/src/api/proctoringSession.ts`) is built against; that task should confirm or correct them (DECISIONS Q645). All need the `candidate` role and the candidate's own attempt.

### POST /api/v1/proctoring/sessions
Body `{ "attemptId" }`. Returns `{ id, status, config, captureLocation }`, where `config` is `{ snapshotIntervalSeconds, detectionIntervalMs, flagCooldownSeconds, sustainedSeconds: { <flagType>: seconds }, flagSeverity: { <flagType>: "low"|"medium"|"high" } }` (X-07 added `flagSeverity` and `captureLocation`). Called once when the exam opens. On any error the exam goes on without proctoring and shows a notice.

### POST /api/v1/proctoring/sessions/:id/heartbeat
No body. Any `2xx`. Sent every 15 seconds while the exam is open.

### GET /api/v1/proctoring/sessions/:id/warnings
Returns `{ items: [{ id, message, createdAt }] }`. Polled every 15 seconds; each new `id` is shown once to the candidate, who must acknowledge it (the acknowledgement is not sent yet).

Flag types the engine raises (`web/src/exam/proctorBridge.ts`): `tab_hidden`, `fullscreen_exit`, `window_blur`, `permission_revoked`, `object_detected`, `face_not_present`, `multiple_faces`, `person_detected`, `phone_detected`, `camera_blocked`, `camera_frozen`, `face_mismatch`, `id_mismatch`, `id_unreadable` (P-09). No video is uploaded; only flags and occasional snapshots, plus, at Start, the ID card photo (`id_proof`) and the selfie (`proctor_snapshot`). Face flags only ask a person to look; they never block or fail a candidate. The `detail` of a face flag is `{ label: "distance_<hundredths>", count: <samples> }` (docs/PROCTORING_ENGINE.md); no descriptor or image data is ever sent.


## Reports (task X-09)

### GET /api/v1/reports/batches/:batchId/marks.xlsx
Roles: `aa_admin`, `assessor` (own batches), `ab_reviewer` (own awarding body). `404` for a batch outside the caller's scope. No query keys (`400` otherwise). Returns an .xlsx (`Content-Disposition: attachment`, `Cache-Control: no-store`): one row per candidate on the roster with status, start and finish time (IST), marks obtained, maximum, percentage, whether marking is still pending and obtained / maximum for each NOS. Names starting with `=`, `+`, `-`, `@` are written with a leading `'`. Access log: one `learner` list row per candidate (fields `name`, `marks`). Audit: `report.marks_export` with the row count only.

### Changes to existing attempt reads (X-09)
- `GET /api/v1/attempts/:id` for staff: each question also has `answeredAt` (last save of the answer) and `secondsSpent` (seconds since the answer before it, or since the start for the first; `null` when not answered). Estimate, see DECISIONS 921.
- `GET /api/v1/attempts`: each row also has `candidateName` (`null` when unknown).
## Names next to ids (task X-11)

Additive fields only; nothing was removed. A value is `null` when the record is not found, and the screen then shows the id.
- `GET /api/v1/batches/:id`: `names { abName, qualificationName, tpName, centreName, assessorName, proctorName }`. `qualificationName` is "code name". The batch list does not carry `names`.
- `GET /api/v1/proctoring/sessions` and `GET /api/v1/proctoring/sessions/:id`: `batchLabel` ("code name, start to end").
- `GET /api/v1/evidence` and `GET /api/v1/evidence/:id`: `batchLabel` and `candidateName`.
