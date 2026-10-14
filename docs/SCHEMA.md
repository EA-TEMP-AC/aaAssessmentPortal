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
| `in_progress` | `assessment_completed` | checklist/attendance gate (B-06), or `aa_admin` via `POST /batches/:id/complete` (+ reason, audit; B-03) |
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
| `RatioClass` | `manufacturing`, `services`, `school_education`, `other` |
| `SectorName` | the 59 Annexure II names in §1.5 |
| `StateUt` | the 36 Annexure IV names in §1.6 |
| `LoginActorType` | `assessor`, `proctor`, `student` |
| `LoginEventType` | `login`, `logout` |
| `CandidateOutcome` | `Pass`, `Fail`, `Absent` (server-computed) |
| `SlaBreachKey` | `accept`, `assign`, `result` |
| `EmailQueueStatus` | `pending`, `sending`, `sent`, `failed` |
| `PassCriteriaMode` | `nos_wise`, `overall` |
| `PassMarkUnit` | `percent`, `absolute` |

### 1.5 `SectorName` — Guidelines Annexure II (indicative)

Stored and compared as these strings. Abbreviations are the ones printed in the annexure (`Gems/Jewel`, `Musical Inst.`, `Org. Retail`, `Religious Prof.`, `Unorg. Sector`, `Wood & Carp.`, and the others below). Do not expand them.

1. Aerospace and Aviation
2. Automotive
3. Agriculture
4. Apparel
5. Beauty & Wellness
6. BFSI
7. Capital goods
8. Chemicals and Petrochemicals
9. Construction
10. Domestic Worker
11. Education, Training & Research
12. Electronics
13. Environmental Science
14. Food
15. Gems/Jewel
16. Glass & Ceramics
17. Handicrafts
18. Healthcare
19. Hydrocarbon
20. Infrastructure
21. Iron & Steel
22. IT-ITeS
23. Judiciary
24. Leather
25. Legal Services
26. Legislators
27. Life Sciences
28. Media & Entertainment
29. Mining
30. Musical Inst.
31. Office Admin
32. Optical Products
33. Org. Retail
34. Paints & Coatings
35. Paper & paper products
36. Plumbing
37. Postal
38. Power
39. Printing
40. Public Admin
41. Pvt. Security
42. PwD
43. Railways
44. Real Estate
45. Religious Prof.
46. Rubber
47. Shipping
48. Sports
49. Telecom
50. Textile
51. Tobacco
52. Tourism & Hospitality
53. Transportation, Logistics and Warehousing
54. Unorg. Sector
55. Water Supply
56. Wood & Carp.
57. Instrumentation
58. Green Jobs
59. Management

`RatioClass` is not a sector. It only feeds the assessor-to-learner cap (`RATIO_MAX_*`).

### 1.6 `StateUt` — Guidelines Annexure IV

Stored and compared as these strings, including the printed spellings (`Himachal`, `J and K`, `Chattisgarh`, `Orissa`, `Dadra & Nagar Haveli and Daman & Diu`). Annexure V uses different spellings for some of the same places. Recognition and centres use this list, not Annexure V.

Andaman and Nicobar Islands; Lakshadweep; Dadra & Nagar Haveli and Daman & Diu; Ladakh; Chandigarh; Puducherry; Sikkim; Mizoram; Goa; Arunachal Pradesh; Nagaland; Manipur; Meghalaya; Tripura; Himachal; Uttarakhand; J and K; NCT of Delhi; Chattisgarh; Telangana; Haryana; Kerala; Punjab; Jharkhand; Assam; Orissa; Gujarat; Karnataka; Rajasthan; Tamil Nadu; Madhya Pradesh; Andhra Pradesh; Bihar; West Bengal; Maharashtra; Uttar Pradesh.

---

## 2. Compliance constants

Implement in B-02. No magic numbers in feature code.

| Constant | Default | Tag / note |
|---|---|---|
| `TIMEZONE` | `Asia/Kolkata` | Project |
| `WEEKEND_DAYS` | `[6, 0]` | Sat, Sun |
| `ACCEPT_REJECT_WORKING_DAYS` | `2` | NCVET:FR §F |
| `ASSIGN_AFTER_ALLOCATION_WD_STT` | `7` | Guidelines Table 7; NCVET:FR §F. Forward from `allocatedAt` |
| `ASSIGN_BEFORE_EXAM_WD_LTT` | `30` | Guidelines Table 7; NCVET:FR §F. Back from `assessmentStartDate` |
| `RESULT_SUBMIT_WD_STT` | `3` | Guidelines Table 7; NCVET:FR §F |
| `RESULT_SUBMIT_WD_LTT` | `5` | Guidelines Table 7; NCVET:FR §F |
| `RESULT_SLA_ANCHOR_STT` | `assessment_end_date` | `assessmentEndDate` |
| `RESULT_SLA_ANCHOR_LTT` | `exam_date` | `assessmentStartDate` |
| `BATCH_ALLOCATE_LEAD_DAYS_STT` | `15` | Guidelines Figure 2; calendar days. Hard check open Q15 |
| `TOA_VALIDITY_YEARS` | `3` | NCVET:FR §D |
| `MAX_AAS_PER_ASSESSOR` | `4` | NCVET:FR §D |
| `RATIO_MAX_MANUFACTURING` | `25` | |
| `RATIO_MAX_SERVICES` | `35` | |
| `RATIO_MAX_SCHOOL_EDUCATION` | `60` | |
| `RATIO_MAX_OTHER` | `null` | Rule not applied |
| `REASSESS_WINDOW_YEARS` | `1` | Guidelines 4.7; NCVET:FR §F. From the original result `publishedAt` |
| `EVIDENCE_REQUIRED_FOR_RESULT` | `false` | Phase 1 |
| `ASSESSOR_REACHABLE_HOURS` | `24` | Guidelines 4.4.e. Not an assign block; open Q82 |
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

Example (LTT assign, before the exam): `assessmentStartDate=2026-11-20`, N=30 WD before → due **end of 2026-10-09 IST** = `2026-10-09T18:29:59.999Z`.

Example (STT assign, after allocation): `allocatedAt=2026-10-08T08:00:00.000Z` is Thursday 08 Oct 2026 IST. N=7 WD after → day 7 is Monday 19 Oct → due **end of 2026-10-19 IST** = `2026-10-19T18:29:59.999Z`.

Example (STT result): `assessmentEndDate=2026-11-21` (Saturday). N=3 WD after → due **end of 2026-11-25 IST** = `2026-11-25T18:29:59.999Z`.

Example (LTT result): exam date `assessmentStartDate=2026-11-20`. N=5 WD after → due **end of 2026-11-27 IST** = `2026-11-27T18:29:59.999Z`.

### 2.2 Soft SLA for `aa_admin`

Accept / assign / submit-result after the relevant due instant:

- **Require** `lateReason` (non-empty string) from `aa_admin`.
- On success: append key to `sla.breached`, write audit (`action: sla_late_*`, meta includes reason), proceed.
- If late and `lateReason` missing → `409 SLA_ACCEPT_EXPIRED` | `SLA_ASSIGN_EXPIRED` | `SLA_RESULT_EXPIRED`.
- `sla.breached` is also **recomputed on read** (compare now vs dueAts for open steps) and refreshed by a **nightly job** (owned by **B-03**); persisted breaches from late actions are never cleared.

Holiday CRUD is audit-logged. **Changing holidays does not retroactively recompute** stored `acceptDueAt` / `assignDueAt` / `resultDueAt` on existing batches.

Unaccepted batches past accept SLA with no action: open Q21.

### 2.3 Per-type assign and result anchors

There is no `ASSIGN_SLA_MODE`. The batch `type` picks the anchor. Guidelines Table 7 (NCVET:FR §F). Assign and result due instants are stored at create, together with the accept due instant. Holiday edits do not rewrite them (§2.2).

| Type | Assign | Result |
|---|---|---|
| `STT` | `ASSIGN_AFTER_ALLOCATION_WD_STT` (7) working days **after** `allocatedAt` (receipt from the AB) | `RESULT_SUBMIT_WD_STT` (3) working days after `assessmentEndDate` |
| `LTT` | `ASSIGN_BEFORE_EXAM_WD_LTT` (30) working days **before** `assessmentStartDate` (the exam date) | `RESULT_SUBMIT_WD_LTT` (5) working days after `assessmentStartDate` |

`BATCH_ALLOCATE_LEAD_DAYS_STT` is 15 **calendar** days. Guidelines Figure 2 says the AB allocates an STT batch at least 15 days in advance. Whether create rejects a shorter lead is open Q15.

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

ToA + undertaking on assessors; proctors without ToA. No Aadhaar.

Assessors also store `languages: string[]` (may be empty). Each entry is trimmed. Comparison with `batches.assessmentLanguage` is case-insensitive after trim. NCVET:FR §D; Annexure IX(a) Assessment Delivery sub-parameter 4; docs/ERF.md row 04.

### 3.6 `trainingPartners` / `centres` (phase 1)

Training-partner fields other than those below stay as the B-07a proposal (open questions 47–57).

Centres gain `state: StateUt` (required). Recognition checks this value (§4.3). A centre with no `state` cannot be placed on a batch (`400 VALIDATION_ERROR`).

### 3.7 `qualifications` (phase 1)

| Field | Type | Req | Notes |
|---|---|---|---|
| code | string | Y | unique |
| name | string | Y | |
| sector | SectorName | Y | Annexure II name. Not the ratio class |
| ratioClass | RatioClass | Y | Assessor-to-learner cap only |
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
| sector | SectorName | Y | Copied from the qualification. Client cannot set it |
| ratioClass | RatioClass | Y | Copied from the qualification. Client cannot set it |
| assessmentLanguage | string | Y | Trimmed, 1–80 characters. Scheduled language of this batch |
| state | StateUt | Y | Copied from `centres.state` at create |
| learnerFeedback | { collected: bool, reason: string\|null, note: string\|null, collectedOn: string\|null, recordedBy: ObjectId, recordedAt: Date } \| null | N | Null until recorded; one record, replaced on each PUT. Reason required when `collected` is false, otherwise null. `note` ≤2000 characters. `collectedOn` is `YYYY-MM-DD` IST, only when `collected` is true. Written by B-10 once the batch is `assessment_completed` or later (not `rejected` or `cancelled`). NCVET:FR §J; Annexure IX(a) Governance sub-parameter 4; docs/ERF.md row 26 |
| recognitionOverride | { byUserId, reason, at, checks: string[] } \| null | N | Set when `aa_admin` overrides §4.3 |
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
| firstAssessmentBatchId | ObjectId | N | root batch; the 1-year window uses that batch’s result `publishedAt`; = self if not a reassessment |
| accommodations | string[] | N | |
| allocatedAt | Date | Y | |
| acceptedAt | Date | N | |
| assignedAt | Date | N | |
| cancelledAt | Date | N | |

Indexes: `{ status: 1, assessmentStartDate: 1 }`; `{ assessorId: 1, assessmentStartDate: 1, assessmentEndDate: 1 }`; `{ tpId: 1 }`; `{ abId: 1 }`; `{ sector: 1 }`; `{ reassessmentOf: 1 }` sparse; `{ firstAssessmentBatchId: 1 }`.

**Clash:** overlapping `[start,end]` + different `centreId` → `RULE_ASSESSOR_CLASH` via `assessorDayLocks` txn. The same centre on the same day still merges into one lock. Whether two batches at that centre should block, warn, or stay allowed is open Q79 (Annexure IX(a) Assessment Delivery sub-parameter 9).

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
| batchId | ObjectId | N | nullable; when null, batch-related checks, transition, and AB email are skipped |
| type | LoginEventType | Y | |
| locationStatus | string | Y | `"captured"` \| `"unavailable"` |
| lat, lng | number | N | required when `locationStatus` is `"captured"`; absent when `"unavailable"` |
| accuracy | number | N | optional when `locationStatus` is `"captured"`; absent when `"unavailable"` |
| locationUnavailableReason | string | N | required when `locationStatus` is `"unavailable"`; absent when `"captured"` |
| locationUnavailableDetail | string | N | optional device detail |
| missingGpsFix | bool | Y | true when `locationStatus` is `"unavailable"` or fix is missing; flagged for reports; never blocks login |
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

1. If `batchId` is provided:
   - Assigned assessor / proctor / roster student.
   - Batch status **≥ `assessor_assigned`** in lifecycle order and **not** `rejected`/`cancelled` (i.e. `assessor_assigned`, `in_progress`, `assessment_completed`, `result_submitted`, `ab_validated`, `published`, `disputed`).
   - IST date of **`capturedAt`** ∈ `[assessmentStartDate, assessmentEndDate]`. Outside → `VALIDATION_ERROR`.
   If `batchId` is `null`: skip assigned-actor, status, and date-window checks. Store event.
2. **GPS miss:** If `locationStatus` is `"unavailable"`, `locationUnavailableReason` is required and `lat`/`lng`/`accuracy` must be absent. Stored with flag `missingGpsFix: true`. Never block login for a missing fix. If `"captured"`, `lat` and `lng` are required.
3. Set `clockSkewFlag` / `lateSync` as flags; do not reject for skew alone.

**AB email:** B-06 **enqueues** to `emailQueue` for `notificationEmails` on assessor `login` when a batch is attached; body includes `capturedAt` and location (or unavailable reason); enqueue never fails login API. When `batchId` is `null`, AB email is skipped (sent only when a batch is attached). Worker/retries/SMTP owned by **B-08**.

Indexes: `{ clientEventId: 1 }` unique; `{ batchId: 1, capturedAt: 1 }`; `{ actorType: 1, actorId: 1, capturedAt: -1 }`; `{ missingGpsFix: 1 }`.

### 3.12 `emailQueue` (phase 1)

Shape: `pending|sending|sent|failed`, attempts, nextAttemptAt. **B-08** owns worker + SMTP env (password-reset + AB login delivery). B-06 only inserts jobs.

`reclaims` (number, default 0, B-14): times the stale-send reclaim has put the job back to `pending`. A job still in `sending` more than 10 minutes after `claimedAt` is returned to `pending` (due at once) while `reclaims` is below 2, and `reclaims` goes up by one. Past that, or after its last attempt, it becomes `failed` and its `text` is unset. A normal send failure and its backoff do not count as a reclaim. DECISIONS Q155.

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

Reserved: `questions`, `tests`, `attempts`, `evidence`; `proctoringSessions`, `proctoringFlags`, `grievances`, `erfScores`, `siteDocuments`, `securityAudits`, `exportCredentials`.

The old `sectors` placeholder is replaced by `aaRecognition` plus `SectorName` on the qualification (§3.17, §1.5).

### 3.17 `aaRecognition` (phase 1)

One document, `key: "default"`. Guidelines recognition: sectors, geography, and dates.

| Field | Type | Req | Notes |
|---|---|---|---|
| key | string | Y | `"default"` only |
| sectors | SectorName[] | Y | Unique, at least one |
| panIndia | bool | Y | |
| states | StateUt[] | Y | Unique. Empty when `panIndia` is true. At least one when `panIndia` is false |
| startDate | string | Y | `YYYY-MM-DD` IST, inclusive |
| endDate | string | Y | `YYYY-MM-DD` IST, inclusive, on or after `startDate` |
| updatedBy | ObjectId | N | |

Index: `{ key: 1 }` unique.

`PUT` replaces the document and writes an audit row. It does not rewrite existing batches.

### 3.18 `assessorPayments` (phase 1) — NCVET:FR §D, §J; Annexure IX(a) Financials 3; docs/ERF.md row 19

One row per batch and assessor. Owned by **B-11**.

| Field | Type | Req | Notes |
|---|---|---|---|
| batchId | ObjectId | Y | |
| assessorId | ObjectId | Y | |
| amountDue | number | Y | Rupees, ≥ 0, at most 2 decimal places |
| amountPaid | number | Y | Rupees, ≥ 0, at most 2 decimal places, ≤ `amountDue` |
| pending | number | Y | Server sets `amountDue - amountPaid` |
| logisticsNote | string | N | Trimmed, up to 2000 characters. Project field for travel and boarding notes (Guidelines 4.4.d). Not a separate ERF weight |
| updatedBy | ObjectId | Y | |

Unique `{ batchId: 1, assessorId: 1 }`. A reassigned assessor gets a separate row. The previous row stays.

---

## 4. Business rules

### 4.1 Assignment / ratio / clash

Hard rules (`RULE_*`) stay, including a different centre on an overlapping range. Soft SLA is separate (§2.2). The ratio cap uses `ratioClass`, never `sector`.

**Language (NCVET:FR §D; Annexure IX(a) Assessment Delivery 4):** on assign and reassign, `assessors.languages` must contain `batches.assessmentLanguage` (trim, case-insensitive). If not, `409 RULE_ASSESSOR_LANGUAGE`. `aa_admin` may send `languageOverrideReason` (1–2000 characters), store it on the audit row (`action: assessor_language_override`, `meta.reason`), and the assign proceeds. Any other role cannot override.

### 4.2 Reassessment — Guidelines 4.7; NCVET:FR §F

New batch:

- `isReassessment: true`, `reassessmentOf`, `firstAssessmentBatchId` = root’s id
- **Inherit** from parent (unless the request overrides a field that the contract allows): `abId`, `qualificationId`, `type`, `mode`, `tpId`, `sector`, `ratioClass`, `assessmentLanguage`; dates and centre are set in the request
- Candidates: Fail or Absent on the parent batch only; same `learnerId`; copy roster rows
- Window: `assessmentStartDate` of the new batch is on or before the IST calendar date of the **original** result’s `publishedAt` plus `REASSESS_WINDOW_YEARS`. Original means `firstAssessmentBatchId`, not the immediate parent when there is a chain. The new start must also be on or after that publication date
- The original result must already be `published`. An unpublished original fails the rule
- Never on certificates
- Who initiates (AA vs AB): open Q22
- `409 REASSESS_NOT_ELIGIBLE` when any of those rules fail. `details.reason` is `not_published`, `window`, `outcome`, or `type`

### 4.3 Recognition scope — Guidelines §§ on sector and geography; Annexure II and IV

Singleton `aaRecognition` (§3.17). On `POST /batches`, after the qualification and centre exist:

1. `qualification.sector` is one of `aaRecognition.sectors`.
2. `panIndia` is true, or `centres.state` is one of `aaRecognition.states`.
3. Today’s IST date is on or after `startDate` and on or before `endDate`.

Any miss is `409 RULE_OUTSIDE_RECOGNITION` with `details.checks` containing one or more of `sector`, `state`, `not_started`, `expired`. No recognition row is `unconfigured` in that array. `aa_admin` may send `recognitionOverrideReason` (1–2000 characters) on the same create. The batch then stores `recognitionOverride` (including the checks that failed) and an audit row `action: recognition_override`. `ab_reviewer` cannot override. The check runs again for a reassessment create.

### 4.4 Learner feedback and assessor payments

Schema and contract only. **B-10** writes `learnerFeedback` once the batch is `assessment_completed` or later. **B-11** writes `assessorPayments` once an assessor is assigned. Neither call changes batch status.

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
| Accept/reject/assign/reassign/cancel/complete/reassess | A | D | D | D | D | D | D | D | D | lateReason aa_admin; complete needs reason |
| Submit result | A | D | D | D | D | D | D | D | D | |
| Validate / publish | D | D | D | D | D | D | D | A | D | own abId |
| Login-event write | D | D | D | A | A | D† | D | D | D | assigned |
| Attendance / checklist write | D | D | D | A | D | D | D | D | D | assigned |
| Results read | A | R | D | R | D | R‡ | R | R | R | ‡ own row |
| Results PUT | A | D | D | D | D | D | D | D | D | assessment_completed+draft |
| Audit read | A | A | D | D | D | D | D | R§ | R§ | § scoped |
| Holidays / working-day | A | A | D | D | D | D | D | D | D | audit on change |
| Recognition GET/PUT | A | A | D | D | D | D | D | D | R | audit on PUT |
| Learner feedback write | A | A | D | D | D | D | D | D | D | B-10; batch readers may read it on the batch |
| Assessor payment read/write | A | A | D | own | D | D | D | D | R | B-11; write is aa_admin and mis; ncvet_viewer reads; an assessor reads only their own rows; ab_reviewer is denied (Q161) |

**Batch row scope:** aa_admin/mis/ncvet_viewer=all; ab=`abId`; tp=`tpId`; assessor=`assessorId`; proctor=`proctorId`; candidate=batches containing their learner’s candidate row.

---

## 6. Relationships

```
learners <── candidates.learnerId <── batches
users.linkedProfileId → learners | assessors | proctors | tp
awardingBodies.notificationEmails ← emailQueue ← assessor loginEvents
batches → assessorDayLocks; results; reassessmentOf/firstAssessmentBatchId
batches.sector + centre.state + aaRecognition → RULE_OUTSIDE_RECOGNITION
batches.assessmentLanguage + assessors.languages → RULE_ASSESSOR_LANGUAGE
batches.learnerFeedback; assessorPayments (pending = due − paid)
workingDayConfig + holidays → SLA dueAts (no retroactive rewrite)
original result.publishedAt → reassessment window
sla.breached ← late actions + on-read compute + nightly job
auditLogs append-only (secrets redacted)
```
