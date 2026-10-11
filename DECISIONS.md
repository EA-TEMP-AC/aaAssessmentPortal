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

## Not mandated by NCVET (TR s29), do not market as compliance features
Specific language, DB, cloud, server architecture, API style, biometric or face-recognition tech, GPS hardware, payment gateway, CRM, help-desk software.
