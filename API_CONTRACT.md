# API CONTRACT (owned by Architect). v0.4

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
| `RULE_RATIO` | 409 | Over ratio without override |
| `RESULT_PASS_MARK_INVALID` | 400 | Marks vs max/pass rules |
| `RESULT_OUTCOME_MISMATCH` | 400 | Client `outcome` ≠ server |
| `RESULT_INCOMPLETE` | 409 | Submit missing active roster rows |
| `EVIDENCE_REQUIRED` | 409 | Flag true (Phase 2) |
| `REASSESS_NOT_ELIGIBLE` | 409 | Reassessment rules failed |
| `CONFLICT_IDEMPOTENT` | 409 | Same `clientEventId`, different payload |

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
  "sector": "manufacturing",
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
  "candidateCount": 24
}
```

Response `201` (note corrected `assignDueAt`):
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
  "sector": "manufacturing",
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
    "assignDueAt": "2026-11-11T18:29:59.999Z",
    "resultDueAt": null,
    "breached": []
  },
  "allocatedAt": "2026-10-08T08:00:00.000Z",
  "ratioOverride": null
}
```

`GET` responses recompute `sla.breached` for open steps (plus persisted late-action keys). Nightly job refreshes stored breach flags.

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
  "lateReason": "Assessor travel clearance delayed"
}
```

Errors: `RULE_*` | `SLA_ASSIGN_EXPIRED` | `INVALID_TRANSITION`.

### POST /batches/:id/reassign

Roles: `aa_admin`. From `assessor_assigned` (or `in_progress` if product allows — Phase 1: `assessor_assigned` only unless B-03 extends). Transaction: release old locks, take new locks.

```json
{
  "assessorId": "66f0000000000000000000a2",
  "proctorId": null,
  "lateReason": "Original assessor unavailable"
}
```

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

Roles: `aa_admin` (initiator open Q22). New batch; inherits `abId`, `qualificationId`, `type`, `mode`, `tpId`, `sector` from parent; sets `firstAssessmentBatchId` from root; window from **first** assessment end.

```json
{
  "assessmentStartDate": "2027-02-01",
  "assessmentEndDate": "2027-02-01",
  "centreId": "66f0000000000000000000c1",
  "learnerIds": ["66f0000000000000000000L2"]
}
```

Response `201` new Batch. Errors: `REASSESS_NOT_ELIGIBLE`.

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

Unchanged CRUD + `GET /assessors/available?from=&to=&languages=&batchId=`.

---

## Assessor field app

### POST /assessor/login-event

Validation: assigned assessor; status ≥ `assessor_assigned` (not rejected/cancelled); **`capturedAt`** IST date in assessment window; flags `clockSkewFlag`, `lateSync`.

Request/response as v0.3 plus:
```json
{
  "clockSkewFlag": false,
  "lateSync": true,
  "abEmailQueuedAt": "2026-11-22T10:00:00.000Z",
  "abEmailSentAt": null,
  "replayed": false
}
```

AB email: **enqueue** to `emailQueue` for `notificationEmails` with `capturedAt` in body (B-06); enqueue failure never fails this call. Worker/SMTP (B-08) delivers asynchronously.

### POST /proctor/login-event / POST /student/login-event

Same validation pattern (proctor assigned / student on roster).

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

Evidence, questions/tests, proctoring, grievances, analytics, public site, accessibility, security, sectors — unchanged intent; see SCHEMA.
