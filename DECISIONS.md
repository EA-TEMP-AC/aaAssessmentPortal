# DECISIONS

## Accepted
- AI claim scope (TR s1,s3): we will claim AI in all three areas: (1) question selection, (2) question difficulty classification, (3) proctoring, including detection of blocked/covered camera, another person present or assisting, devices/objects, off-screen assistance. Only claim what is actually shipped and tested; label each in docs. AI proctoring may need prior AB/NCVET approval (FR s2.3.6.2), so keep a human-review queue and never auto-penalise a candidate without review.
- Learner data repository (TR s25): built and run in-house. Keep an export interface (versioned JSON/CSV export + pull API with scoped credentials) so an NCVET-proposed agency can be fed later. Revisit only if NCVET instructs otherwise.
- Multiple sectors: the 5% question-bank rule is checked per sector applied for. Sector list is configuration, not code.
- **A-01 schema defaults (2026-10-09, review pass 3):**
  - Single-AA tenancy; `assessment_completed`; `EVIDENCE_REQUIRED_FOR_RESULT=false`.
  - `rejected` / `cancelled` terminal for this AA; cancel releases `assessorDayLocks`.
  - Soft SLA for `aa_admin`: late accept/assign/submit allowed with required `lateReason`; record `sla.breached` + audit; return `SLA_*` only when reason missing. `sla.breached` also computed on read + nightly job.
  - Holiday changes audit-logged; **no retroactive** recompute of stored dueAts.
  - Assessment window `assessmentStartDate`/`EndDate` (IST); clash = range overlap + different centre via transactional locks; **reassign** supported.
  - Assessor login → `emailQueue` → `awardingBodies.notificationEmails` (includes `capturedAt`; never fails login API).
  - Working-day counting SCHEMA §2.1; example anchor **Tuesday** 06 Oct 2026; 7 WD before 2026-11-20 → due end **2026-11-11 IST**.
  - Qualifications: `passMarkUnit` percent|absolute; `passMarks`; NOS `maxMarks` nullable; Absent from attendance; PUT results only `assessment_completed`+`draft`; `RESULT_INCOMPLETE` on submit.
  - `learners` stable; `candidates.learnerId`; candidate users `linkedProfileId` → learner.
  - loginEvents: validate by `capturedAt` window; accept status ≥ `assessor_assigned`; `lateSync` + skew flags.
  - Reassessment new batch; inherit fields; 1-year window from **first** assessment; initiator open Q22.
  - Auth refresh device-bound; `mustChangePassword` on admin-set passwords; login rate-limit constants.
  - Audit read scoped for ab_reviewer; ncvet_viewer read-all monitoring.
  - `RATE_LIMITED` / `DUPLICATE_RESOURCE`; redact `passwordHash`.

## Proposed
- Stack: Node/Express + MongoDB (replica set) + React/Vite + React Native/Expo. Reason: matches existing team skills and tooling.
- Multi-tenant from day one? (one AA per tenant vs. single AA). Needs human decision. Phase 1 schema assumes single AA.
- **B-01 `auditLogs` document (2026-10-10):** SCHEMA §3.15 says "as before" and does not list fields. Implemented append-only rows: `actorId`, `actorRole`, `action`, `entity`, `entityId`, `abId`, `batchId`, `before`, `after`, `meta`, `ip`, `createdAt`. `password`, `passwordHash`, `passwordResetToken`, `passwordResetTokenHash`, `refreshToken`, and `tokenHash` are stored as `"***"`. Query indexes not yet in SCHEMA: `{ entity: 1, entityId: 1, createdAt: -1 }`, `{ abId: 1, createdAt: -1 }`, `{ createdAt: -1 }`. Architect: please fold this into SCHEMA.md.
- **B-01 response shapes:** `GET /audit-logs` returns `{ page, pageSize, total, items }` with `pageSize` 20 (contract lists `page` only). `POST /auth/refresh` returns the same session body as login (new access and refresh tokens plus `expiresInMs`, `offlineSessionMaxMs`, and `user`).
- Refresh tokens are opaque random values stored as SHA-256 hashes, not JWTs.
- **B-02 working-day admin (2026-10-10):** SCHEMA §3.15 says workingDayConfig and holidays are "as before" and lists no fields. API_CONTRACT.md has no response bodies. Until open questions 25–30 are confirmed, B-02 uses:
  - `workingDayConfig` singleton `{ key: "default", weekendDays: number[], updatedBy }`. `GET /api/v1/admin/working-day-config` returns `{ weekendDays, timezone }` and includes `id` after the first `PUT`. `timezone` echoes `TIMEZONE` and is not writable. `PUT` body is `{ weekendDays }` (unique integers `0..6`, at most 6, so one weekday remains). The first `GET` does not insert a row.
  - `holidays` `{ date: YYYY-MM-DD, name, region: string|null, createdBy }` with unique `{ date, region }`. `region: null` is AA-wide. `POST` returns `201` `{ id, date, name, region }`. `GET` returns `{ items }` with optional `from`, `to`, and `region`. `DELETE /api/v1/admin/holidays/:id` returns `204`.
  - `ASSIGN_SLA_MODE` `before_exam` counts back from `assessmentStartDate`. The alternate string is `from_acceptance` (counts forward from `acceptedAt`) because the schema names `ASSIGN_FROM_ACCEPTANCE_*`.
  - `RESULT_SLA_ANCHOR` `assessment_end_date` counts forward from `assessmentEndDate`. Alternates, from open Q16, are `assessment_start_date` and `assessment_completed` (the completion instant).
  - Due helpers load AA-wide holidays unless the caller passes a region. A regional holiday applies only for that region. Batches have no region field yet.
  - Holiday and weekend writes do not update `batches`.
- **F-01 web shell (2026-10-10):** React 18, Vite, TypeScript, React Router 6, and TanStack Query. No third-party component library; pages use semantic HTML and CSS in `web/`. Access and refresh tokens stay in memory for the page session. `device.platform` sent to auth is `web`. SME has a landing page because `UserRole` includes `sme`. The candidate route is only a placeholder landing; question 23 still defers a candidate portal.
- **M-01 offline queue (2026-10-10):** AsyncStorage holds the login-event queue (the task allows AsyncStorage or SQLite). The role note prefers SQLite; switch when M-02 adds the batch/roster cache if we want one store. Tokens stay in expo-secure-store. `EXPO_PUBLIC_LOGIN_EVENTS_MODE=live` calls the contract paths; any other value uses an in-memory mock (default). The mock sets `lateSync` when the IST calendar date of receive time is after the IST date of `capturedAt`. It does not apply the SCHEMA "after the assessment window" clause (no batch window on device yet). For assessor `login` only, the mock sets `abEmailQueuedAt` to the receive time and leaves `abEmailSentAt` null; it does not write `emailQueue`. Offline use is allowed while `now - lastOnlineAuthAt < offlineSessionMaxMs` from the last successful online login or refresh (server value, else SCHEMA `OFFLINE_SESSION_MAX_MS`). At the limit the app deletes the local session and requires password login, including if the network just returned. A retryable sync error blocks later events; `409 CONFLICT_IDEMPOTENT` is kept and shown, and later events for that user still sync. Events for a different `userId` stay queued and are not sent with someone else's token.
- **B-08 users and email queue (2026-10-11):** The contract lists user paths and the two password-reset bodies. SCHEMA §3.12 names `pending|sending|sent|failed`, `attempts`, and `nextAttemptAt`, and does not list the other queue fields or the retry numbers. Until open questions 37–43 are confirmed:
  - Public user: `{ id, email, name, role, active, mustChangePassword, linkedProfileId, abId, tpId, createdAt, updatedAt }`. Missing profile ids are `null`. Responses omit `passwordHash`, reset-token fields, and tokens.
  - `GET /api/v1/users` accepts `role`, `active` (`true`|`false`), `page` (default 1), and `pageSize` (default 20, max 100). Response `{ page, pageSize, total, items }`.
  - `POST` returns `201` in that shape. An admin-set `password` sets `mustChangePassword: true`. Optional create fields: `linkedProfileId`, `abId`, `tpId`, `active` (default true). `PATCH` accepts `email`, `name`, `role`, `active`, `linkedProfileId`, `abId`, and `tpId` (`null` clears an id). `PATCH` rejects `password` and `mustChangePassword`.
  - `mis` may read an `aa_admin`. `mis` may not create or assign `aa_admin`, and may not `PATCH` or password-reset a user who already has that role.
  - `POST /users/:id/password-reset` with `newPassword` returns `204`. With `sendEmail: true` returns `202` `{ emailQueued }`. Exactly one of those fields. Both modes set `mustChangePassword: true`, revoke every active refresh token for that user, and write an audit row. Passwords are 8–200 characters.
  - `sendEmail` stores a random temporary password as `passwordHash` and puts the plaintext only in `emailQueue.text`. It does not set `passwordResetTokenHash` (no redeem route; open question 31). The API response and the audit row do not include it. If the queue insert fails, the route still returns `202` with `emailQueued: false` after the password change. SMTP failures happen later in the worker and do not affect that response.
  - Password-reset rate limit reuses `LOGIN_RATE_LIMIT_MAX` and `LOGIN_RATE_LIMIT_WINDOW_MS`, keyed by the acting user id.
  - `emailQueue` documents: `to`, `subject`, `text`, `kind`, `status`, `attempts`, `nextAttemptAt`, `lastError`, `sentAt`, `claimedAt`, `meta`. Password reset uses `kind: "password_reset"`. B-06 should call `enqueueEmailSafely` in `server/src/modules/email/email-queue.service.js` (AB login mail) and must not fail its API when that returns `{ queued: false }`.
  - Retry constants live in `server/src/config/email.js` (not SLA, so not in `compliance.js`): `EMAIL_MAX_ATTEMPTS` 5, delay `EMAIL_RETRY_BASE_MS * 2^(attempts-1)` capped at `EMAIL_RETRY_MAX_DELAY_MS` (60s base, 1h cap). Claim is one `findOneAndUpdate` from `pending` to `sending`. At the cap, status is `failed`. A crashed worker can leave a job in `sending`.
  - SMTP env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, all listed in `server/.env.example`. The worker starts only when host and from are set. Tests pass a fake transport. The API does not send mail during the request. Error logs keep an uppercase code such as `EAUTH` and drop the error message.

## Open questions (need human / NCVET / AB)
1. DEP and SIDH integration: API or file upload? Formats?
2. Obtain Annexure B (Blended Learning Guidelines) for the full engine feature list.
3. Obtain Annexure IX(a)/(b) for the 31 ERF sub-parameters and weights.
4. Is the AA also an AB? (changes separation-of-control requirements)
5. Is AI proctoring needed at launch? (needs prior approval) Or build own vs. integrate a vendor?
6. Hosting region and object storage for evidence (DPDP Act 2023 data localisation concerns).
7. (Resolved in part) NQR list: export per sector from nqr.gov.in. Still open: final list of sectors applied for.
8. (Resolved) AI scope: see Accepted. Still confirm AI proctoring prior approval before go-live.
9. Registered-office documents and premises proof (TR s22 F,G): public or on request?
10. (Resolved) Learner repository is in-house; see Accepted.
11. Mobile OS/API level and build pipeline are project choices (TR s29).
12. **Assign deadline wording (NCVET:FR §F):** from acceptance vs before exam? `ASSIGN_SLA_MODE` configurable.
13. Holiday calendar authority.
14. Q File checklist keys and attendance “minimum criteria” (FR §E).
15. Enforce `BATCH_ALLOCATE_LEAD_DAYS_STT = 15` as hard create validation?
16. **Result SLA anchor:** default `assessment_end_date` — confirm vs start or `assessment_completed`.
17. **Multi-assessor batches?** Phase 1 single `assessorId`.
18. **Post-publication disputes?**
19. **NOS-wise vs overall pass criteria** default / per-batch override?
20. **How do AB batches arrive?** portal vs file vs API?
21. **Unaccepted batches past accept SLA:** auto-escalate to AB, keep `allocated` with breach flag only, or auto-reject? Soft late-accept covers AA action but not silence.
22. **Who initiates reassessment?** AA admin only, AB reviewer, or either?
23. **Candidate-facing UI (Phase 1):** no candidate-facing web/mobile UI is planned for Phase 1. Candidates may read their own result row via API only (`GET /batches/:id/results` scoped). Decide later whether/when to ship a candidate portal screen.
24. **Login rate limiter:** the limiter is a process-local map keyed by IP+email, so a restart clears it and each server instance has its own window. A shared store (Redis or MongoDB) is needed before running more than one instance.
25. **workingDayConfig / holidays fields:** SCHEMA §3.15 does not list them. Are the B-02 fields in Proposed (singleton `key`, `weekendDays`, `updatedBy`; holiday `date`, `name`, `region`, `createdBy`) the ones to fold into the schema?
26. **DELETE /admin/holidays:** the contract has no id segment. B-02 implements `DELETE /api/v1/admin/holidays/:id` and returns `204`. Is that the path?
27. **Holiday region:** AA-wide (`region: null`) always counts. A non-null region counts only when the due-date caller passes that region. Batches have no region. Is that the match rule, and where does a batch's region come from?
28. **ASSIGN_SLA_MODE alternate:** B-02 uses the string `from_acceptance`. Is that the enum value?
29. **RESULT_SLA_ANCHOR alternates:** B-02 uses `assessment_start_date` and `assessment_completed` in addition to `assessment_end_date` (open Q16). Are those the enum strings?
30. **GET working-day-config:** B-02 does not insert a row on read, so the calculator uses `WEEKEND_DAYS` until the first `PUT`. Should the first read create the singleton instead?
31. **Self-service password change:** `POST /auth/login` returns `mustChangePassword`, but Phase 1 has no endpoint for the signed-in user to set a new password. `POST /users/:id/password-reset` is an administrator action. F-01 blocks the shell and offers sign-out until the flag is false. A contract endpoint is needed before the gate can collect a new password.
32. **M-01 login-event request body.** API_CONTRACT says POST `/assessor/login-event` is "as v0.3", and this repo's contract has no v0.3 body. The app sends `clientEventId`, `batchId` (nullable), `type` (`login`|`logout`), `capturedAt`, `device`, and either `lat`+`lng` with `locationStatus: "captured"` or `locationStatus: "unavailable"` plus `locationUnavailableReason` (no coordinates). It does not send server-owned fields (`receivedAt`, `lateSync`, `clockSkewMs`, `clockSkewFlag`, `replayed`, `syncedAt`, `abEmailQueuedAt`, `abEmailSentAt`). Please add the request example to API_CONTRACT.
33. **M-01 GPS miss vs SCHEMA §3.11.** `lat` and `lng` are required numbers. M-01 does not invent coordinates when permission is denied or a fix fails. Should the contract allow omitted coordinates with an explicit unavailable reason?
34. **M-01 `batchId`.** SCHEMA requires `loginEvents.batchId`. Batch download is M-02, so M-01 queues login/logout with `batchId: null`. The mock accepts null. Should sync wait until a batch id is on the device?
35. **M-01 candidate vs student.** The user role is `candidate`. The app maps that role to `POST /student/login-event` (SCHEMA actorType `student`).
36. **M-01 `mustChangePassword`.** The contract has no mobile password-change route. The app blocks field use and tells the user to change the password on the web portal.
37. **emailQueue fields and retry numbers.** SCHEMA §3.12 lists status, attempts, and nextAttemptAt only. B-08 stores `to`, `subject`, `text`, `kind`, `status`, `attempts`, `nextAttemptAt`, `lastError`, `sentAt`, `claimedAt`, and `meta`, with `EMAIL_MAX_ATTEMPTS` 5 and exponential backoff from 60s capped at 1h. Are those the fields and numbers to fold into the schema?
38. **Password-reset rate limit.** The contract says the route is rate-limited and does not give a window. B-08 reuses `LOGIN_RATE_LIMIT_MAX` and `LOGIN_RATE_LIMIT_WINDOW_MS`, keyed by the acting user id. Is that the limit, and is the key right?
39. **Reset email versus a reset token.** There is no endpoint to redeem `passwordResetTokenHash` (open question 31). `sendEmail: true` sets a random temporary password, sets `mustChangePassword`, and queues that password in the email body. The API response and the audit row do not include it. Confirm this instead of a one-time token. Admin passwords are 8–200 characters; the contract example is `Temporary-Pass-1`.
40. **mis and an existing aa_admin.** The matrix says mis has users CRUD except escalate to aa_admin. B-08 forbids mis from creating or assigning `aa_admin`, and from PATCH or password-reset of a user who already has that role. mis may still read that user. Confirm.
41. **Queue insert failure.** When the insert fails, B-08 still returns `202` `{ emailQueued: false }` after the password has already changed, so the API does not fail. The temporary password is not returned. Confirm.
42. **Profile id existence.** B-08 checks that `linkedProfileId`, `abId`, and `tpId` are ObjectIds. It does not check that the learner, assessor, proctor, awarding body, or training partner row exists (those collections belong to later tasks).
43. **Stuck `sending` jobs.** A worker that crashes after the claim leaves the job in `sending`. B-08 does not reclaim it. Should a stale claim return to `pending`?
44. **F-11 actor filter.** The viewer was asked to filter by actor. `GET /audit-logs` in API_CONTRACT accepts `entity`, `entityId`, `from`, `to`, and `page` only. The page shows `actorId` and `actorRole` on each row and does not send an actor query. Should the contract add `actorId` and/or `actorRole` filters?
45. **F-11 `from` / `to`.** The contract does not say whether those values are calendar dates or instants, or which timezone bounds a date. The viewer treats each date input as a local calendar day: `from` is the start of that day and `to` is the end of that day, sent as ISO-8601 instants. Is that the intended range, or should the bounds be IST (`TIMEZONE`)?
46. **F-11 audit item shape.** API_CONTRACT does not list fields on `items[]`. The viewer renders the B-01 proposed row: `id`, `actorId`, `actorRole`, `action`, `entity`, `entityId`, `abId`, `batchId`, `before`, `after`, `meta`, `ip`, `createdAt`, plus the list envelope `{ page, pageSize, total, items }`. Please confirm that item list in the contract.
47. **F-09 list search.** The users list is supposed to include search. `GET /users` accepts `role`, `active`, `page`, and `pageSize` only. The screen sends those and does not send a name or email search. Should the contract add a search query?
48. **F-09 reset results.** `newPassword` is a success only on `204` with no body. `sendEmail: true` is a success only when the response is `202` and `emailQueued` is true: the screen says the email is queued and may arrive later. `emailQueued: false` is shown as a problem (the password changed, the email was not queued, the temporary password is not shown). Any other field on that body, including a temporary password, is ignored and not shown. Confirm.
49. **F-09 user payload.** API_CONTRACT does not list the user object. The screen uses the B-08 public user `{ id, email, name, role, active, mustChangePassword, linkedProfileId, abId, tpId, createdAt, updatedAt }` and `{ page, pageSize, total, items }`. Requests send `page` (default 1) and `pageSize` (default 20; the screen also offers 50 and 100). Please confirm in the contract.
50. **F-09 blank profile ids.** Edit sends `null` for a blank linked profile, awarding body, or training partner id so B-08 clears it. Create omits a blank id. Confirm.

## Not mandated by NCVET (TR s29), do not market as compliance features
Specific language, DB, cloud, server architecture, API style, biometric or face-recognition tech, GPS hardware, payment gateway, CRM, help-desk software.
