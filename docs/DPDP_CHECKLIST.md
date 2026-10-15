# DPDP Act 2023 checklist (S-01)

Source of the requirement: docs/TECH_REQUIREMENTS.pdf sections 18E and 20 ("data maintenance and protection must comply with the Digital Personal Data Protection Act, 2023"). The TR gives no further detail, so this list follows the Act's duties as the project understands them.

**Read this first.**
- This is an engineering inventory, not legal advice. Section numbers are from the Act as published; the DPDP Rules were not read for this task, so every deadline, form and log-retention period must be checked against the current Rules by the AA's legal adviser.
- The person who decides the lawful basis, names the contacts and signs off retention periods is not in the repository (DECISIONS 262, 272).
- Status words: **Done** (built and tested), **Partial** (some of it), **Missing** (nothing yet), **Not engineering** (policy or organisation).
- "Task" names the work that would close the gap. S-01 to S-03 are in TASKS.md. **DPDP-1 to DPDP-6 are proposals and are not in TASKS.md yet** (DECISIONS 272).

## What S-01 added

| Item | Where |
|---|---|
| Field-level encryption (AES-256-GCM, rotating key ids, keyed lookup hash) for user, assessor and proctor email and learner phone | `lib/field-crypto.js`, `lib/encrypted-fields.plugin.js`, SCHEMA section 7 |
| Migration that encrypts existing rows, safe to run twice | `npm run migrate:encrypt` |
| Access log: who read which person's data, no values | `accessLogs`, `GET /audit/access-log` |
| Retention periods per data class and a read-only report | `config/retention.js`, `npm run retention:dry-run` |
| This checklist, key management notes | README |

## Duties

| Duty (Act) | What the system does now | What is missing | Status | Task |
|---|---|---|---|---|
| **Notice** (s5): tell the person, before or when asking for consent, what is collected, why, how to exercise rights and how to complain | Nothing. No notice text, no version, no record that a notice was shown. Learners reach the system through training partners and awarding bodies, not through a sign-up screen of ours | Notice wording (an organisation task), a notice version, a stored record of which version was given to which learner and when, in the languages the Act requires. Where the notice is shown (the TP's enrolment, not our UI) is undecided | **Missing** | DPDP-1 |
| **Consent / lawful basis** (s4, s6, s7): consent that is free, specific, informed, and withdrawable, or a listed legitimate use | Nothing recorded. No consent or basis field exists, and no withdrawal path | Decision on the basis for learner data (consent collected by the TP, or a legitimate use because of the NCVET assessment function). If consent: capture, store, expose and honour withdrawal; if not, document the basis | **Missing**, decision open (Q272) | DPDP-1 |
| **Purpose limitation and data minimisation** (s4, s5, s6, s8(7)) | The schema forbids personal fields beyond a short list (SCHEMA PII rule). Aadhaar and other national ids are never stored, and the audit middleware drops keys that look like national ids (B-15). Reads are scoped by role and row (a candidate sees only their own learner row, a TP only its own centres). Every list and detail read of personal data is logged (S-01) | No written purpose register mapping each field to a purpose. No check that data collected for assessment is not reused. Free text (names, notes) is not scanned for national ids (Q176). The roster and results reads are not all access-logged (Q266). Learner export (S-03) must be limited to its purpose | **Partial** | S-03 (export limits), DPDP-1 (register) |
| **Accuracy** (s8(3)) | Request validation on every write (zod). `aa_admin` and `mis` can correct users, learners, assessors and proctors, and every write is audited with before and after | Nothing flags stale data. No learner-facing way to ask for a fix | **Partial** | DPDP-2 |
| **Security safeguards** (s8(5)): reasonable safeguards against breach. TR s19, s20 | Encryption of the main personal fields at rest with key rotation (S-01). Passwords bcrypt-hashed, access tokens signed, refresh tokens hashed and revocable. Role and row scoping. Login and password-reset rate limits. Append-only audit and access logs. Secrets redacted in logs and audit | Disk and database-volume encryption, TLS to MongoDB and the API, encrypted backups: not configured here (Q271). Keys are environment variables, not a managed secret store (Q264). Emails, phone numbers and geo-location still sit in plain text in `auditLogs`, `emailQueue` and `loginEvents` (Q261). Temporary passwords are held in `emailQueue.text` until the job is sent and purged. The periodic security audits and content-theft controls of TR s19 are S-02, not started | **Partial** | S-02, DPDP-4 |
| **Access and correction** (s11, s12): the person can get a summary of their data and who it was shared with, and can correct it | The access log answers "who read this person's data" for the endpoints it covers, filtered by learner id. A candidate can read their own learner row. Staff can correct records | No intake for a request from a person, no identity check, no report of "all data held about me" or "who it was shared with", no response timer, no learner-side correction request, no record of the request and its outcome. Results, attendance and login events are not in the access log | **Missing** (a manual answer is possible: an admin queries the access log and the records) | DPDP-2 |
| **Erasure and retention** (s8(7), s12(3)): erase when consent is withdrawn or the purpose is served, unless law requires keeping it | Records are soft-deleted only (`active: false` on users, learners, candidates, assessors, proctors). The retention config proposes a period per data class and `retention:dry-run` counts records past it. Nothing is deleted | The proposed periods are guesses and need sign-off (Q262). No delete or anonymise job (Q263). `auditLogs` and `accessLogs` are append-only, so a person's id and, in `auditLogs`, their email remain. Awarding bodies need results kept, so a learner's erasure cannot remove them. Backups outlive deletions. No erasure request workflow. No processors told to erase | **Missing** (report only) | DPDP-3 |
| **Breach notice** (s8(6)): tell the Data Protection Board and each affected person | Nothing automated. The audit log, access log and failed-login audit rows would help an investigation after the fact | Incident procedure and contacts, detection and alerting (for example many reads by one account), a way to list the people affected from the access log, notice templates, and the Board's required content and timing (read the Rules) | **Missing** | DPDP-4 |
| **Children's data** (s9): verifiable parental consent, no tracking or behavioural monitoring, no targeted advertising | Nothing. The system stores no date of birth or age, so it cannot tell whether a candidate is under 18. Proctoring and geo-tracking (TR s6, s9, s26) are behavioural monitoring of candidates | Whether any candidate is a child (Q272). If yes: record age or a minor flag, a parental-consent record, and a legal view on whether proctoring monitoring of children is allowed or needs an exemption | **Missing**, blocked on a fact | DPDP-5 |
| **Grievance redressal and contacts** (s8(9), s8(10), s13) | The public-site task W-01 plans grievance and POSH pages | A named grievance officer and published contact for data matters, a way to receive and track a DPDP grievance, response times | **Not engineering** plus a small build | DPDP-6, W-01 |
| **Processors and transfers** (s8(2), s16) | Mail goes through the configured SMTP provider. Evidence storage and face verification vendors are not chosen (P-03, Q5) | A list of processors with the data each sees, written contracts, and a check that no restricted transfer happens. Face images are the most sensitive item planned | **Missing** | DPDP-6, P-03 |
| **Right to nominate** (s14) | Nothing | Whether and how a person can name someone to act for them | **Missing**, low priority | DPDP-2 |
| **Significant Data Fiduciary duties** (s10): data protection officer, audits, impact assessment | Not applicable until the Government notifies the AA as one | Find out whether the AA may be notified; if so, the audit and impact-assessment duties are large | **Not engineering** | |

## Proposed follow-up tasks (not in TASKS.md)

| ID | Task | Owner | Depends |
|---|---|---|---|
| DPDP-1 | Notice and consent: decide the lawful basis, store notice version and consent or basis per learner, withdrawal, purpose register | architect, then backend | decision 272 |
| DPDP-2 | Data-principal requests: intake, identity check, "data held about me" report from records and the access log, correction requests, timers, log of outcome | backend + frontend | DPDP-1 |
| DPDP-3 | Retention executor and erasure: confirm periods, anonymise or delete per class, approval and audit, handle backups and processors | backend | decisions 262, 263 |
| DPDP-4 | Breach response: runbook, alerting on unusual access, affected-person list from the access log, notice templates | backend + security | S-02 |
| DPDP-5 | Children's data: age or minor flag, parental-consent record, legal view on proctoring | architect, then backend | decision 272 |
| DPDP-6 | Contacts and processors: grievance officer and published contact, processor register and contracts | organisation + backend | W-01 |

## Known weak points in what was built

These are in the S-01 report and in DECISIONS 260 to 271. Listed so nobody reads the table above as "encryption solves it".
- Field encryption covers four fields. Names, learner references and accommodations are still plain text.
- Emails and phone numbers are copied, in plain text, into `auditLogs`, `emailQueue` and the failed-login audit row.
- The access log covers lists and details of users, learners, assessors, proctors and the roster. It does not cover results, attendance or login events.
- Keys are environment variables. Losing one loses the data under it.
- Nothing is ever deleted.
- The retention periods are proposals.
