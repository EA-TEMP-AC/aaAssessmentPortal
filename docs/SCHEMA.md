# MongoDB schema (Architect, A-01)

Single-AA deployment. BSON types. Instant timestamps are UTC `Date` unless noted. **Assessment calendar dates** and clash windows use **`YYYY-MM-DD` in Asia/Kolkata (IST)** (project choice; TR s29).

**PII rule:** do **not** store Aadhaar (or other national ID) numbers. Identity verification is a boolean + optional opaque reference only.

**Status transitions:** atomic compare-and-set on `batches.status` (and `statusVersion`); illegal CAS → `INVALID_TRANSITION`.

**auditLogs:** append-only (no update/delete). Snapshots in `before`/`after` **must redact** `passwordHash` and other secrets (replace with `"***"`).

Phases tag each collection: `1` = Phase 1, `2` = Phase 2, `3` = Phase 3.

Requirement tags: `NCVET:FR §…` (docs/FEATURE_REPORT.md) or `NCVET:TR s…` (docs/TRACEABILITY.md). Untagged items are project choices.

---

## 1. Status enums

### 1.1 Batch status

Main path:

`allocated` → `accepted` | `rejected` → `assessor_assigned` → `in_progress` → `assessment_completed` → `result_submitted` → `ab_validated` → `published`

Terminal / side: `cancelled`, `disputed`

| Status | Notes |
|---|---|
| `rejected` | **Terminal for this AA.** |
| `cancelled` | Terminal; releases `assessorDayLocks`. Via `POST …/cancel`. |
| `assessment_completed` | Attendance/checklist gate; evidence vault not required while `EVIDENCE_REQUIRED_FOR_RESULT` is false. |
| `disputed` | From `result_submitted` \| `ab_validated` only. Exit to those. Post-publication: open Q18. |

### 1.2 Legal transitions

| From | To | Actor / trigger |
|---|---|---|
| `allocated` | `accepted` | `aa_admin` (+ `lateReason` if past acceptDueAt) |
| `allocated` | `rejected` | `aa_admin` (+ reason; + lateReason if late) |
| `allocated` | `cancelled` | `aa_admin` |
| `accepted` | `assessor_assigned` | `aa_admin` assign (+ lateReason if late) |
| `accepted` | `cancelled` | `aa_admin` |
| `assessor_assigned` | `in_progress` | first valid assessor login-event |
| `assessor_assigned` | `assessor_assigned` | `aa_admin` **reassign** (same status; new assessor) |
| `assessor_assigned` | `cancelled` | `aa_admin` |
| `in_progress` | `assessment_completed` | checklist/attendance gate or `aa_admin` |
| `in_progress` | `cancelled` | `aa_admin` |
| `assessment_completed` | `result_submitted` | `aa_admin` submit-result (+ lateReason if late) |
| `assessment_completed` | `cancelled` | `aa_admin` (rare; open whether allowed after results draft) |
| `result_submitted` | `ab_validated` | `ab_reviewer` |
| `ab_validated` | `published` | `ab_reviewer` |
| `result_submitted` \| `ab_validated` | `disputed` | `aa_admin` \| `ab_reviewer` |
| `disputed` | `result_submitted` \| `ab_validated` | resolve |

Reassessment = new batch via `POST /batches/:id/reassessments` (not a status). All others → `409 INVALID_TRANSITION`.

### 1.3 Result status

`draft` → `submitted` → `validated` → `published`.

### 1.4 Other enums

| Enum | Values |
|---|---|
| `UserRole` | `aa_admin`, `mis`, `sme`, `assessor`, `proctor`, `candidate`, `tp`, `ab_reviewer`, `ncvet_viewer` |
| `BatchType` | `STT`, `LTT` |
| `BatchMode` | `online`, `offline`, `blended` |
| `Sector` | `manufacturing`, `services`, `school_education`, `other` |
| `LoginActorType` | `assessor`, `proctor`, `student` |
| `LoginEventType` | `login`, `logout` |
| `CandidateOutcome` | `Pass`, `Fail`, `Absent` (server-computed) |
| `SlaBreachKey` | `accept`, `assign`, `result` |
| `EmailQueueStatus` | `pending`, `sending`, `sent`, `failed` |
| `PassCriteriaMode` | `nos_wise`, `overall` |
| `PassMarkUnit` | `percent`, `absolute` |

---

## 2. Compliance constants

Implement in B-02. No magic numbers in feature code.

| Constant | Default | Tag / note |
|---|---|---|
| `TIMEZONE` | `Asia/Kolkata` | Project |
| `WEEKEND_DAYS` | `[6, 0]` | Sat, Sun |
| `ACCEPT_REJECT_WORKING_DAYS` | `2` | NCVET:FR §F |
| `ASSIGN_BEFORE_EXAM_WD_STT` | `7` | NCVET:FR §F |
| `ASSIGN_BEFORE_EXAM_WD_LTT` | `30` | NCVET:FR §F |
| `ASSIGN_FROM_ACCEPTANCE_WD_STT` | `7` | Alternate; Q12 |
| `ASSIGN_FROM_ACCEPTANCE_WD_LTT` | `30` | Alternate |
| `ASSIGN_SLA_MODE` | `before_exam` | |
| `RESULT_SUBMIT_WD_STT` | `3` | NCVET:FR §F |
| `RESULT_SUBMIT_WD_LTT` | `5` | NCVET:FR §F |
| `RESULT_SLA_ANCHOR` | `assessment_end_date` | Open Q16 |
| `BATCH_ALLOCATE_LEAD_DAYS_STT` | `15` | Project/flow |
| `TOA_VALIDITY_YEARS` | `3` | NCVET:FR §D |
| `MAX_AAS_PER_ASSESSOR` | `4` | NCVET:FR §D |
| `RATIO_MAX_MANUFACTURING` | `25` | |
| `RATIO_MAX_SERVICES` | `35` | |
| `RATIO_MAX_SCHOOL_EDUCATION` | `60` | |
| `RATIO_MAX_OTHER` | `null` | Rule not applied |
| `REASSESS_WINDOW_YEARS` | `1` | From **first** assessment end; NCVET:FR §F |
| `EVIDENCE_REQUIRED_FOR_RESULT` | `false` | Phase 1 |
| `ASSESSOR_REACHABLE_HOURS` | `24` | Soft |
| `MAX_CLOCK_SKEW_MS` | `300000` | Flag only |
| `OFFLINE_SESSION_MAX_MS` | `259200000` | 72h |
| `ACCESS_TOKEN_TTL_MS` | `900000` | 15m |
| `REFRESH_TOKEN_TTL_MS` | `2592000000` | 30d |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | 15m window |
| `LOGIN_RATE_LIMIT_MAX` | `20` | Max attempts / window / IP+email |
| `DEFAULT_PASS_MARK_UNIT` | `percent` | Qualification may override |

### 2.1 Working-day counting convention

1. Convert **anchor instant** to IST calendar date `D0`.
2. Counting starts on the **next** working day after `D0` (anchor date is not day 1).
3. Working day = weekday ∉ `weekendDays` and not in `holidays` (region null = AA-wide).
4. After N working days → date `DN`; due = **end of `DN` IST** → store UTC.
5. “N WD **before** date E”: end of the working day N working days before E (E exclusive).

Example: anchor **Tuesday 06 Oct 2026** IST, N=2, no holidays → day1=Wed 07, day2=Thu 08 → due end of Thu 08 IST.

Example (assign before exam): `assessmentStartDate=2026-11-20`, N=7 WD before → due **end of 2026-11-11 IST** = `2026-11-11T18:29:59.999Z`.

### 2.2 Soft SLA for `aa_admin`

Accept / assign / submit-result after the relevant due instant:

- **Require** `lateReason` (non-empty string) from `aa_admin`.
- On success: append key to `sla.breached`, write audit (`action: sla_late_*`, meta includes reason), proceed.
- If late and `lateReason` missing → `409 SLA_ACCEPT_EXPIRED` | `SLA_ASSIGN_EXPIRED` | `SLA_RESULT_EXPIRED`.
- `sla.breached` is also **recomputed on read** (compare now vs dueAts for open steps) and refreshed by a **nightly job**; persisted breaches from late actions are never cleared.

Holiday CRUD is audit-logged. **Changing holidays does not retroactively recompute** stored `acceptDueAt` / `assignDueAt` / `resultDueAt` on existing batches.

Unaccepted batches past accept SLA with no action: open Q21.

---

## 3. Collections

ObjectIds unless noted. Common: `createdAt`, `updatedAt`.

### 3.1 `users` (phase 1)

| Field | Type | Req | Notes |
|---|---|---|---|
| email | string | Y | unique |
| passwordHash | string | Y | never in API; redacted in audit |
| name | string | Y | |
| role | UserRole | Y | |
| active | bool | Y | |
| mustChangePassword | bool | Y | true after admin-set password |
| linkedProfileId | ObjectId | N | assessor/proctor/**learner**/tp id by role |
| abId | ObjectId | N | `ab_reviewer` |
| tpId | ObjectId | N | `tp` |
| passwordResetTokenHash | string | N | |
| passwordResetExpiresAt | Date | N | |

Indexes: `{ email: 1 }` unique; `{ role: 1, active: 1 }`.

For `role=candidate`, `linkedProfileId` → **`learners._id`** (stable person), not `candidates._id`.

### 3.2 `refreshTokens` (phase 1)

| Field | Type | Req | Notes |
|---|---|---|---|
| userId | ObjectId | Y | |
| tokenHash | string | Y | |
| deviceId | string | Y | |
| device | { platform, appVersion } | N | |
| expiresAt | Date | Y | |
| revokedAt | Date | N | |
| createdAt | Date | Y | |
| lastUsedAt | Date | N | |

Indexes: `{ tokenHash: 1 }` unique; `{ userId: 1, deviceId: 1 }`.

### 3.3 `learners` (phase 1) — NCVET:TR s25

Stable person across batches.

| Field | Type | Req | Notes |
|---|---|---|---|
| name | string | Y | |
| externalRef | string | N | TP/AB stable id; **not** Aadhaar |
| phone | string | N | |
| accommodations | string[] | N | default accommodations |
| active | bool | Y | |

Indexes: `{ externalRef: 1 }` sparse unique; `{ name: 1 }`.

### 3.4 `awardingBodies` (phase 1)

| Field | Type | Req | Notes |
|---|---|---|---|
| name | string | Y | |
| code | string | N | unique if set |
| notificationEmails | string[] | Y | ≥1 |
| active | bool | Y | |

Indexes: `{ code: 1 }` sparse unique.

### 3.5 `assessors` / `proctors` (phase 1)

Unchanged from prior: ToA + undertaking on assessors; proctors without ToA. No Aadhaar.

### 3.6 `trainingPartners` / `centres` (phase 1)

Unchanged.

### 3.7 `qualifications` (phase 1)

| Field | Type | Req | Notes |
|---|---|---|---|
| code | string | Y | unique |
| name | string | Y | |
| sector | Sector | Y | |
| defaultBatchType | BatchType | N | |
| passCriteriaMode | PassCriteriaMode | N | open Q19 |
| passMarkUnit | PassMarkUnit | Y | `percent` (default) or `absolute` |
| passMarks | { theory, practical, viva } | Y | thresholds in `passMarkUnit` |
| maxMarks | { theory, practical, viva } | N | required when unit=`absolute`; nullable when percent |
| nos | [{ nosId, code, name, maxMarks?: { theory, practical, viva }, pcs: [{ pcId, code, name, passMark?, maxMark? }] }] | Y | NOS-level `maxMarks` nullable |
| pcPassMarksRequired | bool | N | |

Indexes: `{ code: 1 }` unique; `{ sector: 1 }`.

**Scoring:** if `passMarkUnit=percent`, compare component % to `passMarks.*`. If `absolute`, compare raw marks to `passMarks.*` with ceiling `maxMarks.*` (qualification or NOS). Marks above max → `RESULT_PASS_MARK_INVALID`.

### 3.8 `batches` (phase 1) — NCVET:FR §F

| Field | Type | Req | Notes |
|---|---|---|---|
| abId | ObjectId | Y | |
| qualificationId | ObjectId | Y | |
| type | BatchType | Y | |
| mode | BatchMode | Y | |
| assessmentStartDate | string | Y | `YYYY-MM-DD` IST |
| assessmentEndDate | string | Y | ≥ start |
| tpId | ObjectId | Y | |
| centreId | ObjectId | Y | |
| candidateCount | number | Y | |
| sector | Sector | Y | |
| status | BatchStatus | Y | |
| statusVersion | number | Y | |
| assessorId | ObjectId | N | |
| proctorId | ObjectId | N | |
| rejectReason | string | N | |
| cancelReason | string | N | |
| sla | { acceptDueAt, assignDueAt, resultDueAt, breached: SlaBreachKey[], lateActions?: [{ key, reason, byUserId, at }] } | Y | |
| ratioOverride | { byUserId, reason, at } | N | |
| resultId | ObjectId | N | |
| isReassessment | bool | Y | |
| reassessmentOf | ObjectId | N | immediate parent |
| firstAssessmentBatchId | ObjectId | N | root batch for 1-year window; = self if not reassessment |
| accommodations | string[] | N | |
| allocatedAt | Date | Y | |
| acceptedAt | Date | N | |
| assignedAt | Date | N | |
| cancelledAt | Date | N | |

Indexes: `{ status: 1, assessmentStartDate: 1 }`; `{ assessorId: 1, assessmentStartDate: 1, assessmentEndDate: 1 }`; `{ tpId: 1 }`; `{ abId: 1 }`; `{ reassessmentOf: 1 }` sparse; `{ firstAssessmentBatchId: 1 }`.

**Clash:** overlapping `[start,end]` + different `centreId` → `RULE_ASSESSOR_CLASH` via `assessorDayLocks` txn.

### 3.9 `assessorDayLocks` (phase 1)

| Field | Type | Req | Notes |
|---|---|---|---|
| assessorId | ObjectId | Y | |
| istDate | string | Y | |
| centreId | ObjectId | Y | |
| batchIds | ObjectId[] | Y | |

Unique `{ assessorId: 1, istDate: 1 }`.

**Assign / reassign / cancel (transactional):**

- **Assign:** insert/update locks for each day in range (same centre merge; different centre → clash).
- **Reassign:** release old assessor’s locks for this `batchId` (pull batchId; delete lock if empty); take locks for new assessor.
- **Cancel:** release locks for current `assessorId` + this batch.

### 3.10 `candidates` (phase 1)

Batch roster row.

| Field | Type | Req | Notes |
|---|---|---|---|
| batchId | ObjectId | Y | |
| learnerId | ObjectId | Y | → `learners` |
| name | string | Y | denorm from learner at add time |
| externalRef | string | N | denorm |
| accommodations | string[] | N | |
| active | bool | Y | deactivate via PATCH (soft) |
| sourceOriginalCandidateId | ObjectId | N | reassessment link |

Indexes: `{ batchId: 1 }`; `{ learnerId: 1 }`; unique `{ batchId: 1, learnerId: 1 }`; `{ batchId: 1, externalRef: 1 }` sparse unique.

### 3.11 `loginEvents` (phase 1) — NCVET:FR §E; NCVET:TR s9, s26

| Field | Type | Req | Notes |
|---|---|---|---|
| clientEventId | string | Y | |
| actorType | LoginActorType | Y | |
| actorId | ObjectId | Y | |
| candidateId | ObjectId | N | student |
| batchId | ObjectId | Y | |
| type | LoginEventType | Y | |
| lat, lng | number | Y | |
| capturedAt | Date | Y | |
| receivedAt | Date | Y | |
| clockSkewMs | number | Y | |
| clockSkewFlag | bool | Y | |
| lateSync | bool | Y | true if `receivedAt` IST date > `capturedAt` IST date (or sync after assessment window while capturedAt in window) |
| device | object | N | |
| syncedAt | Date | Y | |
| abEmailQueuedAt | Date | N | |
| abEmailSentAt | Date | N | |

**Idempotency:** identical `clientEventId`+payload → original `200`; conflict → `CONFLICT_IDEMPOTENT`.

**Validation:**

1. Assigned assessor / proctor / roster student.
2. Batch status **≥ `assessor_assigned`** in lifecycle order and **not** `rejected`/`cancelled` (i.e. `assessor_assigned`, `in_progress`, `assessment_completed`, `result_submitted`, `ab_validated`, `published`, `disputed`).
3. IST date of **`capturedAt`** ∈ `[assessmentStartDate, assessmentEndDate]`. Outside → `VALIDATION_ERROR`.
4. Set `clockSkewFlag` / `lateSync` as flags; do not reject for skew alone.

**AB email:** enqueue to `notificationEmails`; body includes `capturedAt`; never fails API; retries via `emailQueue`.

Indexes: `{ clientEventId: 1 }` unique; `{ batchId: 1, capturedAt: 1 }`; `{ actorType: 1, actorId: 1, capturedAt: -1 }`.

### 3.12 `emailQueue` (phase 1)

Unchanged shape (`pending|sending|sent|failed`, attempts, nextAttemptAt).

### 3.13 `attendanceRecords` / `equipmentChecklists` (phase 1)

Unchanged. Attendance `present=false` drives result `Absent`.

### 3.14 `results` (phase 1) — NCVET:FR §F

| Field | Type | Req | Notes |
|---|---|---|---|
| batchId | ObjectId | Y | unique |
| rows | [{ candidateId, outcome, nos: […] }] | Y | outcome server-computed |
| status | draft\|submitted\|validated\|published | Y | |
| submittedAt / submittedBy / validatedAt / publishedAt | | N | |

**PUT `/batches/:id/results` allowed only when** batch status = `assessment_completed` **and** result status = `draft` (create draft on first PUT if missing).

**Outcome:**

- Derive **`Absent`** from attendance (`present=false`) or missing attendance treated per B-05 policy (document: missing attendance at submit → must be resolved; prefer explicit attendance).
- Client must **not** send `absent: true` conflicting with attendance `present=true` → `VALIDATION_ERROR`.
- Client must not send `outcome`; mismatch → `RESULT_OUTCOME_MISMATCH`.
- Pass/Fail from marks vs `passMarkUnit` + `passMarks` (+ NOS `maxMarks` when absolute).

**Submit-result:** every **active** roster candidate must have a result row → else `409 RESULT_INCOMPLETE`. Soft SLA + `lateReason` if past `resultDueAt`.

### 3.15 `resultChangeLogs` / `workingDayConfig` / `holidays` / `auditLogs`

As before. Holiday writes → audit. No retroactive SLA dueAt recompute.

**Audit read scope:** `ab_reviewer` / `ncvet_viewer` may read audit rows only for entities in their batch scope (`abId` match / all read-only for ncvet as configured: ncvet_viewer = all entities read; ab_reviewer = entities tied to own `abId` batches).

---

### 3.16 Phase 2 / 3 collections

Reserved: `questions`, `tests`, `attempts`, `evidence`; `proctoringSessions`, `proctoringFlags`, `grievances`, `erfScores`, `siteDocuments`, `securityAudits`, `exportCredentials`, `sectors`.

---

## 4. Business rules

### 4.1 Assignment / ratio / clash

Unchanged hard rules (`RULE_*`). Soft SLA separate (§2.2).

### 4.2 Reassessment — NCVET:FR §F

New batch:

- `isReassessment: true`, `reassessmentOf`, `firstAssessmentBatchId` = root’s id
- **Inherit** from parent (unless overridden): `abId`, `qualificationId`, `type`, `mode`, `tpId`, `sector`; dates/centre/assessor set in request
- Candidates: Fail/Absent only; same `learnerId`; copy roster rows
- Window: `assessmentStartDate` of new batch within `REASSESS_WINDOW_YEARS` of **`firstAssessmentBatchId.assessmentEndDate`** (not the immediate parent’s end if chain)
- Never on certificates
- Who initiates (AA vs AB): open Q22
- `409 REASSESS_NOT_ELIGIBLE` on rule failure

---

## 5. Permission matrix (Phase 1)

| Action | aa_admin | mis | sme | assessor | proctor | candidate | tp | ab_reviewer | ncvet_viewer | Scope |
|---|---|---|---|---|---|---|---|---|---|---|
| Auth login/logout/refresh | A | A | A | A | A | A | A | A | A | self + device |
| Users CRUD / password reset | A | A* | D | D | D | D | D | D | D | * no escalate to aa_admin |
| Learners / master data CRUD | A | A | D | D | D | D | D | R | R | |
| Batch create | A | D | D | D | D | D | D | A | D | ab own abId |
| Batch list/get + child GETs | A | R | D | R | R | R | R | R | R | row scope |
| Candidates CUD / CSV | A | A | D | R | D | D | R | R | R | scoped |
| Accept/reject/assign/reassign/cancel/reassess | A | D | D | D | D | D | D | D | D | lateReason aa_admin |
| Submit result | A | D | D | D | D | D | D | D | D | |
| Validate / publish | D | D | D | D | D | D | D | A | D | own abId |
| Login-event write | D | D | D | A | A | D† | D | D | D | assigned |
| Attendance / checklist write | D | D | D | A | D | D | D | D | D | assigned |
| Results read | A | R | D | R | D | R‡ | R | R | R | ‡ own row |
| Results PUT | A | D | D | D | D | D | D | D | D | assessment_completed+draft |
| Audit read | A | A | D | D | D | D | D | R§ | R§ | § scoped |
| Holidays / working-day | A | A | D | D | D | D | D | D | D | audit on change |

**Batch row scope:** aa_admin/mis/ncvet_viewer=all; ab=`abId`; tp=`tpId`; assessor=`assessorId`; proctor=`proctorId`; candidate=batches containing their learner’s candidate row.

---

## 6. Relationships

```
learners <── candidates.learnerId <── batches
users.linkedProfileId → learners | assessors | proctors | tp
awardingBodies.notificationEmails ← emailQueue ← assessor loginEvents
batches → assessorDayLocks; results; reassessmentOf/firstAssessmentBatchId
workingDayConfig + holidays → SLA dueAts (no retroactive rewrite)
sla.breached ← late actions + on-read compute + nightly job
auditLogs append-only (secrets redacted)
```
