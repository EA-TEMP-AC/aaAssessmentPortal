# MongoDB schema (Architect, A-01)

Single-AA deployment. BSON types. Instant timestamps are UTC `Date` unless noted. **Assessment calendar dates** and clash windows use **`YYYY-MM-DD` in Asia/Kolkata (IST)** (project choice; TR s29).

**PII rule:** do **not** store Aadhaar (or other national ID) numbers. Identity verification is a boolean + optional opaque reference only.

**Status transitions:** atomic compare-and-set on `batches.status` (and `statusVersion`); illegal CAS → `INVALID_TRANSITION`.

**Personal data at rest (S-01):** sensitive personal fields are encrypted field by field (AES-256-GCM) and, where they must be searchable or unique, shadowed by a keyed hash column. See §7. Access to personal data is logged in `accessLogs` (§3.23).

**auditLogs:** append-only (no update/delete). Snapshots in `before`/`after`, `meta`, and `requestBody` **must redact** secrets (replace with `"***"`) and **mask plain-text personal data** (emails masked as `u***@example.com`, phones as `***-***-1234`). Access logs sanitize `subjectId` if it holds an email or phone. `emailQueue` masks `to` and unsets `text` once a job is sent or failed (decision 272, B-16). Historical records can be scrubbed using `npm run scrub:logs` (with `--dry-run`).

Phases tag each collection: `1` = Phase 1, `2` = Phase 2, `3` = Phase 3.

## 7. Data protection (S-01) — NCVET:TR s18 to s20; DPDP Act 2023

**Field-level encryption.** The fields below are stored as `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` (AES-256-GCM, random 96-bit IV per value, the field label as authenticated data so a value cannot be moved to another field). Services and API responses see plain text: hydrated documents decrypt through a getter and lean results through a post hook, both in `lib/encrypted-fields.plugin.js`.

| Collection | Field | Hash column | Searchable |
|---|---|---|---|
| `users` | `email` | `emailHash` | equality only (login, duplicate check) |
| `assessors` | `email` | `emailHash` | equality only |
| `proctors` | `email` | `emailHash` | equality only |
| `learners` | `phone` | none | no |

Not encrypted, on purpose or not yet: names, `externalRef`, `accommodations`, training-partner and centre contact fields, `awardingBodies.notificationEmails`, and `loginEvents` (location). See decisions 260 and 261. Raw emails and phones in `auditLogs` snapshots are masked, `emailQueue` masks `to` and clears `text` once sent or failed, and historical rows can be masked via `npm run scrub:logs` (B-16). The schema has no candidate or learner date of birth, address or email; the plugin can take such a field when one is added (decision 260).

**Keys.** `FIELD_ENCRYPTION_KEYS` holds one or more 32-byte keys by id; `FIELD_ENCRYPTION_KEY_ID` names the one used for new writes; older ids stay readable, which is how keys rotate. `FIELD_HASH_KEY` keys the lookup hash. Keys live in the environment, never in the database. README "Key management" has the procedure.

**Lookup hash.** `HMAC-SHA256(FIELD_HASH_KEY, "<collection>.<field>#hash" + NUL + normalisedValue)`, hex. The hash is deterministic so equality lookups and unique indexes work, and is domain-separated per field so the same address in two collections gives different hashes. Filters on the plain path (`{ email: "..." }`) are rewritten to the hash path by the plugin; other operators (regex, range, `$inc`) on an encrypted path are refused. Hash columns are `select: false` and are removed from lean results.

**Rules for model authors.** An encrypted path must not set `lowercase`, `trim` or `maxlength` (setters run on update casting after encryption and would corrupt the ciphertext); normalisation is the plugin's `normalize`, and the length limit lives in the request schema. `aggregate`, `bulkWrite` and `Model.collection.*` bypass the plugin and must not touch these paths.

**Migration.** `npm run migrate:encrypt` (`--dry-run` to report only) encrypts rows still in plain text, fills missing hashes, re-encrypts rows written under an older key id, and replaces the old unique `email_1` index with the hash index. It is safe to run twice. A row it cannot decrypt is reported and left alone.

**Retention.** `server/src/config/retention.js` lists a period per data class (§3.23 and the file header). `npm run retention:dry-run` reports counts of records past their period. Nothing is deleted (decision 263).

---

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
| `PUBLIC_RATE_LIMIT_WINDOW_MS` | `60000` | W-01. Window for `/public/*` per client IP |
| `PUBLIC_RATE_LIMIT_MAX` | `120` | W-01. Max `/public/*` requests / window / IP |
| `DEFAULT_PASS_MARK_UNIT` | `percent` | Qualification may override |
| `SECTOR_MIN_COVERAGE_PERCENT` | `5` | Project (Q-05). A sector passes the coverage check when at least this percent of its NQR qualifications have an approved question set. Open Q360 |
| `ATTEMPT_DEFAULT_DURATION_MINUTES` | `60` | Project (E-03). Attempt length when the test paper gives none. Open Q421 |
| `ATTEMPT_GRACE_SECONDS` | `30` | Project (E-03). Seconds after the deadline when a save or submit is still taken; env `ATTEMPT_GRACE_SECONDS` overrides. Open Q422 |
| `QUESTION_REVIEW_INTERVAL_MONTHS` | `12` | Project (Q-04). Months between question bank reviews of a qualification unless it has its own interval (`reviewSettings`). Allowed range `QUESTION_REVIEW_INTERVAL_MIN_MONTHS` 1 to `QUESTION_REVIEW_INTERVAL_MAX_MONTHS` 60. Open Q440 |
| `PROCTOR_SNAPSHOT_INTERVAL_SECONDS` | `30` | Project (P-01). Seconds between proctor snapshots in the candidate's browser. Returned as `config.snapshotIntervalSeconds`. Open Q620 |
| `PROCTOR_DETECTION_INTERVAL_MS` | `1000` | Project (P-01). Milliseconds between two in-browser detection runs (`config.detectionIntervalMs`) |
| `PROCTOR_FLAG_COOLDOWN_SECONDS` | `15` | Project (P-01). Seconds the browser waits before sending a second flag of the same type (`config.flagCooldownSeconds`). Not enforced by the server |
| `PROCTOR_SUSTAINED_SECONDS` | `{ face_not_present: 5, camera_blocked: 5, camera_frozen: 8 }` | Project (P-01, P-05). How long the condition must last before the browser raises the flag (`config.sustainedSeconds`) |
| `PROCTOR_FEED_LOST_INTERVALS` | `3` | Project (P-01). No heartbeat for this many snapshot intervals (90 s) shows the session as `feed_lost`. Open Q621 |
| `PROCTOR_FLAG_SEVERITY` | table | Project (P-04). low: `tab_hidden`, `fullscreen_exit`, `window_blur`, `permission_revoked`, `object_detected`; medium: `face_not_present`; high: `multiple_faces`, `person_detected`, `phone_detected`, `camera_blocked`, `camera_frozen`. Set by the server, never by the client |

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
| email | string | Y | unique. **Stored encrypted** (§7); lowercased and trimmed before encryption |
| emailHash | string | Y* | keyed hash of the normalised email (§7). Never in an API response. *Absent only on rows not yet migrated |
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

Indexes: `{ emailHash: 1 }` unique (partial: only rows that have a hash); `{ role: 1, active: 1 }`. The plain `{ email: 1 }` unique index is dropped by the S-01 migration.

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
| phone | string | N | **Stored encrypted** (§7). Not searchable |
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

`email` on assessors and proctors is **stored encrypted** with an `emailHash` shadow column (§7). Unique index: `{ emailHash: 1 }` sparse unique (replaces `{ email: 1 }`).

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
| schemeId | ObjectId | N | `schemes` (§3.27). Null when not tagged. Must exist and be active at create; set from the project when only `projectId` is sent (H-01) |
| projectId | ObjectId | N | `projects` (§3.27). Null when not tagged. Must exist, be active, and belong to `schemeId` (H-01) |
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

Indexes: `{ status: 1, assessmentStartDate: 1 }`; `{ assessorId: 1, assessmentStartDate: 1, assessmentEndDate: 1 }`; `{ tpId: 1 }`; `{ abId: 1 }`; `{ schemeId: 1 }` sparse; `{ projectId: 1 }` sparse; `{ sector: 1 }`; `{ reassessmentOf: 1 }` sparse; `{ firstAssessmentBatchId: 1 }`; `{ assessmentStartDate: 1 }` (N-01: every analytics query starts with a range on this field; the result join uses the existing unique `results.batchId` index, and the `abId` filter for `ab_reviewer` uses `{ abId: 1 }`).

**Analytics (N-01).** `GET /analytics/*` aggregates over `batches`, joined to `results` with `status: "published"` on `batchId`. Date range: `assessmentStartDate` between `from` and `to`. Turnaround: `results.submittedAt` minus the end of `assessmentEndDate` (IST). Late: `sla.breached` contains `result`. No collection is added and nothing is stored: every call is computed live.

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

### 3.22 `settings` (phase 1)

One document, `key: "access"`, created on the first `PUT /settings/access`. A missing document reads as both flags `false`.

| Field | Type | Notes |
|---|---|---|
| `key` | string | `"access"`, unique |
| `abReviewerCanReadAssessorPayments` | boolean | default `false`. When `true`, `ab_reviewer` reads assessor payments of their own awarding body (decision 174) |
| `ncvetViewerCanSeeAbQueue` | boolean | default `false`. Read by the clients to show the AB queue to `ncvet_viewer` (decision 175) |
| `updatedBy` | ObjectId | user who last saved |
| `createdAt`, `updatedAt` | Date | |

Writes are `aa_admin` only and audited with `before` and `after`.

---

### 3.23 `accessLogs` (phase 3, S-01) — NCVET:TR s20; DPDP

One row per person whose personal data a read endpoint returned. Append-only (update and delete are rejected, as for `auditLogs`). The row holds ids and field names, never the data read.

| Field | Type | Notes |
|---|---|---|
| `actorId` | ObjectId | user who read |
| `actorRole` | string | role at the time |
| `subjectType` | string | `user`, `learner`, `assessor`, `proctor`, `evidence` (V-01: one row per evidence file download), `question` (S-02: one row per question whose text a read returned), `testPaper` (S-02: one row per test paper read) |
| `subjectId` | string | id of the person read (`users._id`, `learners._id`, ...). The roster endpoint logs `learnerId`, not the candidate row id |
| `kind` | string | `list` or `detail` |
| `fields` | string[] | names of the personal fields the response carried, for example `["name","phone","externalRef"]` |
| `route` | string | route template with method, no query string, for example `GET /api/v1/learners/:id` |
| `requestId` | string | shared by all rows of one list response |
| `ip` | string | |
| `createdAt` | Date | |

Indexes: `{ subjectType: 1, subjectId: 1, createdAt: -1 }`; `{ actorId: 1, createdAt: -1 }`; `{ createdAt: -1 }`.

Logged reads: `GET /users`, `/users/:id`, `/learners`, `/learners/:id`, `/assessors`, `/assessors/:id`, `/assessors/available`, `/proctors`, `/proctors/:id`, `GET /batches/:id/candidates`. Not logged: refused requests, empty lists, results, attendance, login events, batch reads (see DPDP_CHECKLIST.md and decision 266). A read whose log row cannot be written is not served (decision 267). S-02 adds `GET /question-bank/questions` and `/:id` (`question` rows, fields `stem`, `options`, `correctAnswer`) and `GET /tests/:id` (a `testPaper` row, plus `question` rows when `?withQuestions=true`). Test paper lists carry no content and are not logged.

---

### 3.24 `evidence` (phase 2, V-01) - Guidelines 4.11b; NCVET:TR s9

One row per file in the evidence vault. The file is in object storage (section 3.24.1), never in MongoDB. Rows are immutable: the model rejects update, replace and delete, except that `lastVerification` and `verifyCount` may be set by the verify endpoint. Evidence of cancelled and rejected batches is kept.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `clientEventId` | string | unique; offline idempotency key |
| `batchId` | ObjectId | required |
| `abId` | ObjectId | copied from the batch at upload, for awarding-body scoping |
| `candidateId` | ObjectId or null | a `candidates` row of this batch |
| `kind` | string | `photo`, `id_proof`, `attendance`, `equipment`, `other`, `video`, `proctor_snapshot` (P-01; JPEG only, uploaded by the candidate) |
| `sessionId` | ObjectId or null | P-01: the `proctoringSessions` row of a `proctor_snapshot`; null for every other kind. `candidateId` is copied from the session |
| `contentType` | string | from the bytes: `image/jpeg`, `image/png`, `application/pdf`, `video/mp4` |
| `size` | number | bytes, counted by the server. Limit 25 MB (image, PDF), 200 MB (video) |
| `sha256` | string | hex, computed by the server from the uploaded bytes |
| `storageDriver`, `storageKey` | string | `local` or `s3`; key is `evidence/<random uuid>.<ext>`. Never returned by the API. No client file name is stored |
| `uploaderUserId`, `uploaderRole` | ObjectId, string | |
| `capturedAt` | Date | device clock, as sent |
| `uploadedAt` | Date | server clock |
| `locationStatus` | string | `captured`, `unavailable`, `not_provided` |
| `latitude`, `longitude`, `accuracy` | number or null | `captured` only; as sent |
| `locationUnavailableReason` | string or null | required when `unavailable` |
| `deviceId` | string or null | |
| `payloadHash` | string | sha256 of the canonical metadata plus file checksum; decides replay vs `CONFLICT_IDEMPOTENT`. Never returned |
| `lastVerification` | object or null | `{ at, byUserId, result (ok, mismatch, missing), actualSha256, actualSize }`; the actual values only on mismatch |
| `verifyCount` | number | |

Indexes: `{ clientEventId: 1 }` unique; `{ batchId: 1, capturedAt: -1 }`; `{ candidateId: 1, capturedAt: -1 }`; `{ abId: 1, capturedAt: -1 }`; `{ uploaderUserId: 1, capturedAt: -1 }`; `{ sha256: 1 }`; `{ sessionId: 1, capturedAt: -1 }`.

Read scope: aa_admin, mis, ncvet_viewer all rows; ab_reviewer `abId`; assessor and proctor `uploaderUserId` (their own uploads, not the batch's), plus `proctor_snapshot` rows of their assigned batches (P-01); candidate, tp, sme none. A candidate uploads only `proctor_snapshot` for their own session.

#### 3.24.1 Storage

One interface: `put`, `get` (stream) and `signedUrl`. There is no delete and no overwrite. Drivers: local disk (`EVIDENCE_STORAGE_DRIVER=local`, development and tests only) and S3-compatible (`s3`, AWS SDK v3 with configurable endpoint, region, bucket, path-style and credentials from the environment). Production must name a driver and may not use `local`. Hosting provider and region (India) are open (DECISIONS 6, 240, 322).

---
### 3.27 `schemes` / `projects` / `authorisedSignatories` (phase 1) — H-01

Never deleted; `active: false` is the deactivated state. Dates are `YYYY-MM-DD` IST. No signature images, no personal ID numbers.

`schemes`

| Field | Type | Req | Notes |
|---|---|---|---|
| name | string | Y | ≤200 |
| code | string | Y | unique, ≤64 |
| fundingBody | string | Y | ≤200 |
| active | bool | Y | default true |

Indexes: `{ code: 1 }` unique.

`projects`

| Field | Type | Req | Notes |
|---|---|---|---|
| name | string | Y | ≤200 |
| code | string | Y | unique across all projects |
| schemeId | ObjectId | Y | `schemes`; active at create and when changed |
| startDate | string | Y | |
| endDate | string or null | N | null = open-ended; on or after `startDate` |
| active | bool | Y | default true |

Indexes: `{ code: 1 }` unique; `{ schemeId: 1 }`.

`authorisedSignatories`

| Field | Type | Req | Notes |
|---|---|---|---|
| name | string | Y | personal data; redacted in audit rows (Q383) |
| designation | string | Y | ≤200 |
| scope | `scheme`, `project` or `agency` | Y | |
| schemeId | ObjectId or null | N | required when scope is `scheme`, else null |
| projectId | ObjectId or null | N | required when scope is `project`, else null |
| validFrom | string | Y | |
| validTo | string or null | N | null = no end; on or after `validFrom` |
| active | bool | Y | default true |

Indexes: `{ scope: 1, schemeId: 1, projectId: 1 }`. Collection name `authorisedSignatories`.

### 3.16 Phase 2 / 3 collections

Reserved: `tests`, `attempts`; `grievances`, `erfScores`, `siteDocuments`, `securityAudits`, `exportCredentials`.

The old `sectors` placeholder is replaced by `aaRecognition` plus `SectorName` on the qualification (§3.17, §1.5).

### 3.28 Public website content (phase 1) — NCVET:TR s22; Task W-01, B-16

Nine collections, all with `published` (bool, default false), `archived` (bool, default false), `sortOrder` (number 0 to 100000, default 0), `createdBy`, `updatedBy`, `createdAt`, `updatedAt`; index `{ published: 1, sortOrder: 1 }`. File, photo and logo fields are text references (max 500 characters); nothing is uploaded or stored by the API.

**Archiving and deletion (B-16):** Hard delete is removed. Calling DELETE unpublishes (`published: false`) and sets `archived: true`. Archived items never appear on public endpoints and are omitted from default admin lists (`{ archived: { $ne: true } }`), queryable with `?archived=true`.

**Role permissions (B-16):** `mis` may create and edit drafts only; only `aa_admin` may set `published: true`. Any edit to an already published item by `mis` is refused (`403 FORBIDDEN`).

| Collection | Fields |
|---|---|
| `publicTeamMembers` | name, designation, department, bio, photoRef |
| `publicOrganogram` | name, title, parentId (another node, null for the top), photoRef |
| `publicPeople` | kind (`assessor` \| `proctor`), registryId (the `assessors` or `proctors` record), name, roleLabel, sector (SectorName or null), photoRef, `consentRecorded` (bool, required), `consentNote` (string, max 1000). Unique `{ kind, registryId }`. Publishing refused with `409 CONSENT_REQUIRED` unless `consentRecorded: true`. Automatically hidden from public endpoints when the registry assessor/proctor is inactive or assessor ToA expired, without altering stored `published` flag |
| `publicSamplePapers` | title, qualificationId, fileRef |
| `publicIndustryLinkages` | name, description, websiteUrl, logoRef |
| `publicGrievance` | title, body, contactName, contactEmail, contactPhone, fileRef |
| `publicPosh` | kind (`policy` \| `committee_member`), title, body, memberName, memberRole, fileRef, `consentRecorded` (bool, default false), `consentNote` (string). Committee members require `consentRecorded: true` to publish (`409 CONSENT_REQUIRED`) |
| `publicOfficeDocuments` | category (ownership, lease, telephone_bill, internet_bill, electricity_bill, other), title, note, fileRef. Utility bill categories (`telephone_bill`, `internet_bill`, `electricity_bill`) show `proofOnFile: true` and `fileRef: null` publicly, never raw fileRef |
| `publicEvents` | title, description, date and endDate (`YYYY-MM-DD`), location. Extra index `{ published: 1, date: 1 }` |

**PII rule:** `publicPeople` copies the registry `name` once and links by id. It never holds the registry email, phone, code, qualifications, experience, ToA or any ID. The public API does not return `registryId`. Grievance and POSH contact fields are organisation contacts typed by `aa_admin` for publication, not registry data. Consent must be recorded prior to publishing people and committee members (B-16).

---

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

### 3.19 `questions` (phase 2) — NCVET:TR s4-s5, s13-s17; Task Q-01

Question bank repository. Owned by **Q-01**.
Supports versioning: updates create a new version document (`version: n + 1`) and set `isLatest: false` on previous versions. Never hard deletes (soft delete via `status: "retired"`). Question content (stem, options, answers) is confidential and never readable by `candidate` or `tp`. All writes are audited with question text redacted in snapshots.

| Field | Type | Req | Notes |
|---|---|---|---|
| qualificationId | ObjectId | Y | Ref: `qualifications` |
| nosId | string | Y | Trimmed, up to 64 chars. Must exist on qualification |
| pcId | string | Y | Trimmed, up to 64 chars. Must exist on NOS |
| type | QuestionType | Y | `mcq`, `short_answer`, `scenario`, `viva`, `practical` |
| language | string | Y | Trimmed lowercase language code (e.g. `en`, `hi`) |
| difficulty | QuestionDifficulty | N | `easy`, `medium`, `tough` (optional until Q-02) |
| bloomLevel | string | N | Trimmed, up to 64 chars (e.g. `remember`, `apply`) |
| stem | string | Y | Trimmed question text, up to 10,000 characters |
| options | Option[] | N | Array of `{ key, text }`. Required for MCQ (≥ 2 options) |
| correctAnswer | string | N | Required for MCQ (matches option key or text). Rubric for others |
| marks | number | Y | Positive number (≥ 0.5) |
| status | QuestionStatus | Y | `draft`, `in_review`, `approved`, `retired`. Default `draft` |
| version | number | Y | Integer ≥ 1. Incremented on update |
| rootQuestionId | ObjectId | Y | Group identifier across versions (`_id` of version 1) |
| previousVersionId | ObjectId | N | Ref to immediate predecessor question version |
| isLatest | bool | Y | `true` for current active version, `false` for older versions |
| createdBy | ObjectId | Y | Ref: `users` |
| updatedBy | ObjectId | N | Ref: `users` |
| approvedBy | ObjectId | N | Ref: `users` (when approved) |
| approvedAt | Date | N | Timestamp of approval |
| retiredBy | ObjectId | N | Ref: `users` (when retired) |
| retiredAt | Date | N | Timestamp of retirement |

Indexes:
- `{ qualificationId: 1, nosId: 1, pcId: 1, status: 1 }`
- `{ qualificationId: 1, status: 1 }`
- `{ rootQuestionId: 1, version: -1 }`
- `{ isLatest: 1, status: 1 }`
- `{ type: 1, language: 1 }`

---


### 3.20 `testPapers` (phase 2) — Task E-01

One generated test paper. Holds the seed, the rules and the chosen question ids and versions. It never holds question text; read the text from `questions` by id and version.

| Field | Type | Req | Notes |
|---|---|---|---|
| qualificationId | ObjectId | Y | Ref: `qualifications` |
| status | enum | Y | `draft`, `approved`. Default `draft` |
| seed | Number | Y | Unsigned 32-bit integer. Given by the caller or drawn by the server |
| rules.language | String | Y | Lower case |
| rules.totalMarks | Number | N | Marks target, null when none |
| rules.quotas[] | {nosId, type, count} | Y | Canonical order (NOS order on the qualification, then type). `type` null means any type |
| poolHash | String | Y | SHA-256 of the sorted `id:version` list of the pool at generation time |
| items[] | {questionId, rootQuestionId, version, nosId, pcId, type, marks} | Y | In selection order |
| totalMarks | Number | Y | Sum of item marks |
| shortages[] | {nosId, type, requested, available} | Y | Empty when the bank was big enough |
| marksTargetMet | Boolean | Y | |
| complete | Boolean | Y | No shortage and marks target met. Only complete papers can be approved |
| createdBy, approvedBy | ObjectId | Y / N | Ref: `users` |
| approvedAt | Date | N | |

Indexes: `{ qualificationId: 1, status: 1, createdAt: -1 }`.

Selection: pool is approved, latest, non-retired questions of the qualification in the language, one per `rootQuestionId`. Quotas run in canonical order on one seeded stream (mulberry32). Inside a quota the PCs are visited round-robin in a seeded order, so every PC with a question is used before any PC is used twice. A question is never taken twice in a paper.
E-02 additions to `testPapers` (set only when the paper was generated with a weight profile; absent otherwise):

| Field | Type | Notes |
|---|---|---|
| weightProfile | {profileId, version} | `profileId` is the profile's `rootProfileId`. Ref: `weightProfiles` |
| weightMix | Object | Target versus achieved difficulty and Bloom mix, with an `unclassified` row and counts. See API_CONTRACT.md |
| items[].difficulty, items[].bloomLevel | String | The class the item was counted under; null when unclassified |

### 3.29 `weightProfiles` (phase 2) — Task E-02

One row per version of a weight profile. An edit inserts a new row; no row is ever deleted, and only `isLatest` of an older row changes.

| Field | Type | Req | Notes |
|---|---|---|---|
| rootProfileId | ObjectId | Y | `_id` of version 1; shared by all versions |
| version | Number | Y | 1, 2, 3, ... |
| isLatest | Boolean | Y | True on the newest version only |
| name | String | Y | 1-120 characters |
| qualificationId | ObjectId | N | Ref: `qualifications`; null means any qualification |
| difficultyWeights | {easy, medium, tough} | Y | Percentages, add up to 100 |
| bloomWeights | {remember, understand, apply, analyze, evaluate, create} | Y | Percentages, add up to 100 |
| status | enum | Y | `draft`, `approved`. New versions are `draft` |
| createdBy, approvedBy | ObjectId | Y / N | Ref: `users` |
| approvedAt | Date | N | |

Indexes: unique `{ rootProfileId: 1, version: 1 }`, `{ qualificationId: 1, isLatest: 1 }`.
### 3.21 `attempts` (phase 2) — Task E-03

One candidate's attempt at one approved test paper. Holds the stored question order, saved answers and scores. It never holds question text or the answer key; those are read from `questions` by id.

| Field | Type | Req | Notes |
|---|---|---|---|
| testPaperId | ObjectId | Y | Ref: `testPapers` |
| batchId, abId | ObjectId | Y | Batch and its awarding body, copied at start |
| candidateId | ObjectId | Y | Roster row (`candidates`) |
| learnerId, userId | ObjectId | Y | Learner and the candidate's login user |
| status | enum | Y | `in_progress`, `submitted`, `timed_out` |
| durationMinutes | Number | Y | Paper's `durationMinutes`, else `ATTEMPT_DEFAULT_DURATION_MINUTES` |
| graceSeconds | Number | Y | `ATTEMPT_GRACE_SECONDS` at start (env override) |
| startedAt, deadlineAt, acceptUntil | Date | Y | `deadlineAt` = start + duration; `acceptUntil` = deadline + grace |
| closedAt, closeReason | Date, enum | N | `submit` or `timeout` |
| questions[] | {questionId, version, nosId, pcId, type, marks, answer, answeredAt, awardedMarks, scoreStatus, scoredBy, markedBy, markedAt} | Y | In the stored (shuffled) order. `scoreStatus` is `pending` or `scored`; `scoredBy` is `auto` or `manual` |
| scores | {maxMarks, obtainedMarks, pendingMarks, pendingCount, complete, byNos[], byType[]} | N | Set when the attempt closes, recomputed after manual marks. Groups are {key, maxMarks, obtainedMarks, pendingMarks, pendingCount}, sorted by key |
| rev | Number | Y | Bumped by every write; closing and marking compare it so a save is never lost |

Indexes: unique `{ testPaperId: 1, candidateId: 1 }` (one attempt per paper), `{ batchId, status }`, `{ abId, startedAt }`, `{ status, acceptUntil }`.
`testPapers` (§3.20) gains optional `durationMinutes` (1 to 600, default null).

### 3.25 `sectorConfigs` (phase 2) — Task Q-05

One row per Annexure II sector on the recognition record. `sector` is a `SectorName`, never a `RatioClass`. Only a sector listed in `aaRecognition.sectors` can be added (`409 SECTOR_NOT_RECOGNISED`). Writes: `aa_admin`. Audited with before and after.

| Field | Type | Req | Notes |
|---|---|---|---|
| sector | SectorName | Y | Unique |
| active | bool | Y | Default `true`. Inactive sectors are left out of the coverage list |
| createdBy, updatedBy | ObjectId | N | Ref: `users` |

### 3.26 `nqrQualifications` (phase 2) — Task Q-05

National Qualifications Register list per sector, loaded by CSV (`POST /question-bank/nqr-qualifications/import`). No personal data and no national ID fields.

| Field | Type | Req | Notes |
|---|---|---|---|
| code | string | Y | Unique, up to 64 chars. A held `qualifications.code` equal to this code links the two |
| name | string | Y | Up to 200 chars |
| sector | SectorName | Y | Annexure II name |
| importedBy | ObjectId | N | Ref: `users` |

Coverage rule: an NQR qualification is **covered** when a `qualifications` row with the same `code` has at least one `questions` row with `status: "approved"` and `isLatest: true`. Percent covered is `covered / total * 100` (2 decimals); the minimum test compares `covered * 100 >= total * SECTOR_MIN_COVERAGE_PERCENT` so rounding never decides it. A sector with no NQR qualifications has `percentCovered: null` and `meetsMinimum: false`.

---

### 3.33 `reviewCycles` (phase 2) — Task Q-04

One review of a qualification's questions by an awarding body. Items hold question ids and decisions, never question text. Writes: `aa_admin` and `sme` create and close; the `ab_reviewer` of `abId` records decisions. Audited without question text and without the reviewer comment.

| Field | Type | Req | Notes |
|---|---|---|---|
| qualificationId | ObjectId | Y | Ref: `qualifications` |
| abId | ObjectId | Y | Ref: `awardingBodies`. Active |
| reviewerId | ObjectId | Y | Ref: `users`. Active `ab_reviewer` whose `abId` equals this `abId` |
| dueDate | string | Y | IST date `YYYY-MM-DD`, today or later when created |
| status | enum | Y | `open`, `closed`. Default `open` |
| items[] | {questionId, rootQuestionId, decision, comment, decidedBy, decidedAt, resultQuestionId} | Y | Approved, latest questions at creation. `decision` is `keep`, `revise`, `retire` or null (undecided); set once. `comment` up to 2000 characters, reviewer free text. `resultQuestionId` is the new draft version a `revise` created |
| createdBy | ObjectId | Y | Ref: `users` |
| closedBy, closedAt | ObjectId, Date | N | Set on close |
| incomplete | bool | Y | `true` when closed with undecided items (`allowIncomplete`). Such a close does not restart the qualification's review clock |

Indexes: `{ abId: 1, status: 1, dueDate: 1 }`, `{ qualificationId: 1, status: 1, closedAt: -1 }`, unique `{ qualificationId: 1, abId: 1 }` where `status: "open"` (one open cycle per qualification and awarding body).

Rules: a decision needs an open cycle, a question in the cycle with no decision yet, and a question that is still the latest version and not retired. `keep` changes nothing on the question. `revise` creates the next version through the existing update (always `draft`, needs approval again). `retire` uses the existing retire. If the question action fails the decision is undone.

### 3.34 `reviewSettings` (phase 2) — Task Q-04

| Field | Type | Req | Notes |
|---|---|---|---|
| qualificationId | ObjectId | Y | Unique. Ref: `qualifications` |
| intervalMonths | number | Y | Integer 1 to 60. No row means `QUESTION_REVIEW_INTERVAL_MONTHS` |
| updatedBy | ObjectId | N | Ref: `users` |

### 3.35 `reviewReminders` (phase 2) — Task Q-04

One row per reminder queued by the nightly job. The unique index is what keeps a reminder from being queued twice. No question text.

| Field | Type | Req | Notes |
|---|---|---|---|
| qualificationId, abId | ObjectId | Y | |
| anchorDate | string | Y | IST date the period is counted from: the last complete review close of the qualification, else the qualification's `createdAt` |
| periodNo | number | Y | Whole intervals since `anchorDate`, at least 1 |
| dueQuestionCount | number | Y | Questions past the interval when queued |
| emailId | ObjectId | N | The `emailQueue` row |

Indexes: unique `{ qualificationId: 1, abId: 1, anchorDate: 1, periodNo: 1 }`.

Review due rule (`GET /question-bank/review-due` and the nightly job share it). Only approved, latest questions count. A question is past its interval when its current version was created, or its last `keep` decision in a closed cycle was made, `intervalMonths` or more ago (IST dates, whole months). A qualification is past its interval when `intervalMonths` have passed since its last complete cycle close (or its `createdAt`). A qualification is *due* when it, or any of its questions, is past the interval. The awarding bodies to tell are the active ones with a batch or a cycle for the qualification.

---
### 3.36 `contentReadCounters` (phase 3, S-02)

How many questions each user has read today. Counts only, never content. One row per user per IST day, created by the first read of the day and raised atomically (`$inc` with the cap in the filter), so parallel requests cannot pass the cap together.

| Field | Type | Req | Notes |
|---|---|---|---|
| userId | ObjectId | Y | Ref: `users` |
| day | String | Y | IST civil date `YYYY-MM-DD` |
| count | Number | Y | Questions returned to this user that day |
| createdAt, updatedAt | Date | Y | |

Indexes: unique `{ userId: 1, day: 1 }`. The cap is in `server/src/config/content-controls.js` (`CONTENT_READ_DAILY_CAP`, optional per-role `CONTENT_READ_ROLE_CAPS`). Q460.

### 3.37 `contentAnomalies` (phase 3, S-02)

One row per user per IST day on which a question read was refused with `429 CONTENT_READ_LIMIT`. Holds the user, role and numbers only: no question text and no question ids.

| Field | Type | Req | Notes |
|---|---|---|---|
| userId | ObjectId | Y | Ref: `users` |
| role | String | Y | Role at the latest refusal |
| day | String | Y | IST civil date |
| cap | Number | Y | Cap in force at the first refusal |
| readCount | Number | Y | Questions already read that day, at the latest refusal |
| attemptedCount | Number | Y | Questions the latest refused request would have returned |
| refusedRequests | Number | Y | Refusals that day |
| route | String | Y | Route template of the latest refusal, no query string |
| firstAt, lastAt | Date | Y | |

Indexes: unique `{ userId: 1, day: 1 }`; `{ lastAt: -1 }`. Updated in place by later refusals the same day (unlike `auditLogs`); the record of who read what stays in `accessLogs`.

### 3.38 `securityAudits` (phase 3, S-02)

A record of one security audit (VAPT, code review and so on). Archived, never deleted.

| Field | Type | Req | Notes |
|---|---|---|---|
| type | enum | Y | `vapt`, `penetration_test`, `code_review`, `infrastructure`, `data_protection`, `other` |
| auditor | String | Y | Firm or person, max 200. Redacted in `auditLogs` |
| auditDate | String | Y | `YYYY-MM-DD` |
| scope | String | Y | Max 2000 |
| status | enum | Y | `open`, `closed`. Default `open` |
| fixesDueDate | String | N | `YYYY-MM-DD`, not before `auditDate`. The date by which the fixes are due |
| closedDate | String | N | Set when `status` becomes `closed` (today IST unless given, never in the future); cleared on reopening |
| archivedAt | Date | N | Set by `DELETE`; archived rows are hidden everywhere |
| createdAt, updatedAt | Date | Y | |

Indexes: `{ status: 1, auditDate: -1 }`.

### 3.39 `securityFindings` (phase 3, S-02)

One finding raised by an audit.

| Field | Type | Req | Notes |
|---|---|---|---|
| auditId | ObjectId | Y | Ref: `securityAudits`; indexed |
| severity | enum | Y | `critical`, `high`, `medium`, `low`, `info` |
| description | String | Y | Max 4000. Redacted in `auditLogs` |
| owner | String | Y | Who fixes it, max 200. Redacted in `auditLogs` |
| status | enum | Y | `open`, `closed`. Default `open` |
| dueDate | String | Y | `YYYY-MM-DD`. An open finding is overdue when this is before today (IST) |
| closedDate | String | N | As for audits |
| evidenceRef | String | N | A reference to the evidence (ticket, report page, vault id), max 500. Not a file |
| archivedAt | Date | N | |
| createdAt, updatedAt | Date | Y | |

Indexes: `{ auditId: 1 }`; `{ status: 1, severity: 1 }`; `{ status: 1, dueDate: 1 }`.

### 3.40 `proctoringSessions` / `proctoringFlags` (phase 3) — NCVET:TR s6-s8; Tasks P-01, P-04, P-08

Prototype. Detection runs in the candidate's browser; the server stores sessions, flags and human decisions. Nothing here changes an attempt or a result (no penalty without human review, DECISIONS Accepted).

**`proctoringSessions`**: one per attempt.

| Field | Type | Req | Notes |
|---|---|---|---|
| attemptId | ObjectId | Y | Unique. Ref `attempts` |
| batchId, abId | ObjectId | Y | Copied from the attempt, for scoping |
| candidateId, learnerId, userId | ObjectId | Y | Roster row, learner and the candidate's login user (the owner) |
| lastSeenAt | Date | N | Server time of the last heartbeat; set at start |
| flagCounts | {low, medium, high} | Y | Incremented with each new flag (same transaction) |
| warnings[] | {_id, flagId, message (max 300), createdAt, createdBy} | Y | Added by a `warn` decision; the candidate reads them |
| invalidationRecommendedAt, invalidationRecommendedBy, invalidationRecommendedFlagId | Date, ObjectId, ObjectId | N | Set by the first `invalidate_recommended` decision; a mark only |
| createdAt, updatedAt | Date | Y | `createdAt` is the session start |

The shown status is computed: `ended` (attempt closed), `feed_lost` (no heartbeat for `PROCTOR_FEED_LOST_INTERVALS` x `PROCTOR_SNAPSHOT_INTERVAL_SECONDS`), else `active`.
Indexes: `{ attemptId: 1 }` unique; `{ batchId: 1, createdAt: -1 }`; `{ abId: 1, createdAt: -1 }`; `{ userId: 1 }`.

**`proctoringFlags`**: one per event the browser reported.

| Field | Type | Req | Notes |
|---|---|---|---|
| sessionId, attemptId, batchId, abId | ObjectId | Y | |
| clientEventId | string | Y | Max 200; unique per session |
| type | enum | Y | `tab_hidden`, `fullscreen_exit`, `window_blur`, `permission_revoked`, `object_detected`, `face_not_present`, `multiple_faces`, `person_detected`, `phone_detected`, `camera_blocked`, `camera_frozen` |
| severity | enum | Y | `low`, `medium`, `high`; set by the server from `PROCTOR_FLAG_SEVERITY` (§2) |
| capturedAt | Date | Y | Device clock, as sent |
| receivedAt | Date | Y | Server clock |
| detail | {label, count, confidence} | N | Label max 60, count 0 to 100, confidence 0 to 1. No images or personal data |
| evidenceId | ObjectId | N | A `proctor_snapshot` evidence row of the same session |
| payloadHash | string | Y | sha256 of the canonical payload; replay vs `CONFLICT_IDEMPOTENT`. Never returned |
| review | {decision, note (max 300), decidedAt, decidedBy, decidedByRole} | N | One decision per flag: `dismiss`, `warn`, `invalidate_recommended` |

Indexes: `{ sessionId: 1, clientEventId: 1 }` unique; `{ sessionId: 1, capturedAt: 1 }`; `{ batchId: 1, severity: 1 }`.

Scope: the candidate writes and reads warnings for their own session only; aa_admin and ncvet_viewer read all; proctor and assessor read their assigned batches; ab_reviewer reads its own `abId`. Review: aa_admin, and proctor on their own batches; `invalidate_recommended` is aa_admin only.

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
| Access log read (`GET /audit/access-log`) | A | D | D | D | D | D | D | D | D | S-01; aa_admin only, no personal values in the rows |
| Holidays / working-day | A | A | D | D | D | D | D | D | D | audit on change |
| Recognition GET/PUT | A | A | D | D | D | D | D | D | R | audit on PUT |
| Learner feedback write | A | A | D | D | D | D | D | D | D | B-10; batch readers may read it on the batch |
| Assessor payment read/write | A | A | D | own | D | D | D | R° | R | B-11; write is aa_admin and mis; ncvet_viewer reads; an assessor reads only their own rows; ° ab_reviewer reads own-AB rows only when `abReviewerCanReadAssessorPayments` is on, else denied (Q161, decision 174) |
| Analytics GET (summary, by assessor / training partner / job role / state) | A | R | D | D | D | D | D | R° | R | N-01; ° own `abId` only; counts and rates, no learner data |
| Settings access GET / PUT | A / A | R / D | D | D | D | D | D | R / D | R / D | §3.22; PUT is aa_admin only and audited |
| Public site content (admin) | A | D* | D | D | D | D | D | D | D | W-01, B-16; `/admin/public-site/*`, audited; * mis may draft and edit drafts only, never publish or edit published items; `/public/*` is anonymous, published and unarchived items only |
| Resend credentials | A | D | D | D | D | D | D | D | D | aa_admin only; refused for disabled users |
| Schemes / projects / signatories CRUD (`/schemes`, `/projects`, `/signatories`) | A | A | D | D | D | D | D | R | R | H-01; deactivate, never delete; audited (signatory name redacted); Q380 |
| Question bank write / import | A | D | A | D | D | D | D | D | D | Q-01; aa_admin and sme only; audited (content redacted) |
| Question bank approve | A | D | D | D | D | D | D | A | D | Q-01; ab_reviewer and aa_admin; audited |
| Evidence upload (`POST /batches/:id/evidence`) | A | D | D | own | own | own¶ | D | D | D | V-01; assessor and proctor of the batch; not into `cancelled` or `rejected` batches; ¶ P-01: a candidate uploads only `proctor_snapshot` for their own proctoring session |
| Evidence list / get / file | A | R | D | own | own | D | D | R° | R | V-01; ° own `abId`; assessor and proctor see their own uploads plus `proctor_snapshot` rows of their batches (P-01); every file download is access-logged |
| Proctoring session start / heartbeat / flags / own warnings | D | D | D | D | D | own | D | D | D | P-01; the candidate's own attempt and session |
| Proctoring sessions list / detail / report | A | D | D | R | R | D | D | R° | R | P-01, P-04; assessor and proctor their assigned batches; ° own `abId` |
| Proctoring flag review (dismiss / warn) | A | D | D | D | A | D | D | D | D | P-08; proctor on own batches; audited before and after, no note text |
| Proctoring flag review (invalidate_recommended) | A | D | D | D | D | D | D | D | D | P-08; marks the session only, never the attempt or result |
| Evidence verify | A | D | D | D | D | D | D | D | D | V-01; aa_admin only; audited |
| Test paper generate | A | D | A | D | D | D | D | D | D | E-01; aa_admin and sme; audited (ids, seed and rules only) |
| Test paper approve | A | D | D | D | D | D | D | A | D | E-01; ab_reviewer and aa_admin; complete papers only |
| Test paper read / list / regenerate-check | A | D | A | D | D | D | D | A | D | E-01; question text never reaches candidate or tp |
| Review cycles: create / close / set interval | A | D | A | D | D | D | D | D | D | Q-04 |
| Review cycles: list / get / review-due | A | D | A | D | D | D | D | R | D | Q-04; ab_reviewer own abId only |
| Review cycles: record decision | D | D | D | D | D | D | D | A | D | Q-04; ab_reviewer of the cycle's abId |
| Question bank read / coverage | A | D | A | D | D | D | D | A | D | Q-01; question content confidential from candidate and tp |
| Content read cap and anomalies (`GET /security/content-anomalies`) | A | D | D | D | D | D | D | D | D | S-02; the daily cap applies to every role that reads question content (aa_admin, sme, ab_reviewer); only aa_admin lists the anomalies |
| Security audits and findings (`/security/audits`, `/security/findings`) | A | R | D | D | D | D | D | D | R | S-02; aa_admin writes (audited, archived not deleted); mis and ncvet_viewer read, including the summary |


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
batches.schemeId, batches.projectId (optional) → schemes, projects; projects.schemeId → schemes; authorisedSignatories.schemeId or projectId (by scope)
batches.learnerFeedback; assessorPayments (pending = due − paid)
workingDayConfig + holidays → SLA dueAts (no retroactive rewrite)
original result.publishedAt → reassessment window
sla.breached ← late actions + on-read compute + nightly job
auditLogs append-only (secrets redacted)
accessLogs append-only (who read which person's data; no values)
users / assessors / proctors .email and learners .phone encrypted at rest; *Hash columns hold the lookup hash
```
