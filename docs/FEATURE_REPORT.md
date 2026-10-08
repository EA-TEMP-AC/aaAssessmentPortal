# Assessment Agency Compliance App: Feature Report

Source: NCVET *Guidelines for Recognition and Regulation of Assessment Agencies* (June 2025). Section numbers below refer to that document.

## 1. What the guidelines expect from an AA's technology

An Assessment Agency (AA) must run assessments (theory, practical, viva) for Awarding Bodies (ABs) in online, offline or blended mode, prove every assessment with digital evidence, submit results within fixed deadlines, and report monthly and annually to NCVET through the Digital Enterprise Portal (DEP). The app therefore needs an assessment engine, a field app for assessors, a batch and result workflow with the AB, an evidence vault, and a compliance dashboard.

## 2. Core feature modules

### A. Assessment engine (2.3.6.2, 4.1)

- Automatic test creation from the question bank, mapped to NOS and Performance Criteria (PC).
- Random question selection with balanced difficulty and weightage per Bloom's Taxonomy, with weights set by the AA together with the AB.
- Support for multiple-choice and short-answer questions; scenario questions encouraged; optional simulators for blended mode.
- Questions in Indian languages; content refreshed periodically.
- Online and offline operation when connectivity is poor.
- Accessible delivery for learners with disabilities (ICT tools, accessible result publishing).

### B. Question bank management (2.3.5.4, 4.1)

- At least 5 questions per PC on average for every NOS in a qualification.
- AB consultation and validation workflow, plus periodic review cycles.
- Auto-classification of questions as easy, medium or tough; usage report per question.
- Feedback to AB and training partner for questions most candidates get wrong; phase out the easiest and toughest.
- Viva and practical question banks; sample papers publishable on the website.

### C. Proctoring and anti-malpractice (2.3.6.2, 4.3.1, 4.11)

- Live proctoring from start to end, plus AI or auto proctoring (AI proctoring needs prior approval).
- Live video feed and random photo capture at regular intervals.
- Automatic recording and flagging of malpractice.
- Modes: face-to-face at centre, online proctored at candidate's location, remote auto-proctored.
- Real-time monitoring link for NCVET for online assessments.

### D. Assessor and proctor management (4.3, 4.4)

- Repository of assessors with qualifications, experience, languages and ToA certificate (valid 3 years).
- Only ToA-certified assessors can be assigned; undertaking that an assessor works with no more than 4 AAs.
- Rule preventing one assessor from being assigned two batches on the same day at different locations.
- Assessor-to-learner ratio check (indicative: manufacturing 1:20-25, services 1:30-35, school education 1:50-60).
- Logistics, travel and payment tracking; assessor reachable within 24 hours of travel.

### E. Assessor mobile app and geo-tracking (2.3.6.2)

- Geo-tagged, time-stamped login and logout (works offline), with an email to the AB at assessor login.
- Candidate identity verification and attendance check against minimum criteria.
- Tool and equipment availability check against the Q File.

### F. Batch, SLA and result workflow (4.8)

- AB allocates batch to AA; AA accepts or rejects within 2 working days.
- Assessor assigned within 7 working days (short-term) or 30 working days before the exam (long-term).
- Results submitted within 3 working days (short-term) or 5 working days (long-term).
- AB validates; any change is logged and notified to the AA.
- Separate pass marks for theory, practical and viva; PC marks follow the qualification.
- Re-upload on mismatch with SIDH or other authorized systems; conflict and grievance resolution on results.
- Re-assessment only for failed or absent learners, only for STT/LTT, within one year, and never shown on certificates.

### G. Evidence vault (4.5f)

- Video and photos of theory, practical and viva with embedded date, time and GPS metadata.
- Evidence indexed by candidate, job role, batch, date and location for audit and grievances.
- Assessment reports and digital logs generated from the app.

### H. Analytics and dashboards (2.3.6.2)

- Assessment lifecycle dashboards for all stakeholders.
- Performance graphs by Assessor, Training Partner, Job Role, State and Date range.

### I. Public website and calendar (2.3.6.1, 4.2)

- Monthly assessment calendar published with a link to NCVET.
- Organogram, assessor and proctor details, sample papers, industry linkages, grievance and POSH information.

### J. Compliance and ERF scoring (Section 5)

- Collect and push evidence and data to DEP regularly; show red flags as they appear.
- Score each sub-parameter: Compliance +4, Low risk -1, Medium risk -2, High risk -4; maximum 400.
- Grades: A 324-400, B 171-324, C 18-171, D below 18.
- Macro-parameter weights: Assessment Delivery 50%, Financials 15%, Governance and Manpower 10%, Business Planning and Research 10%, Assessment Strategy 10%, Grievance and POSH 5%.
- Assessment Delivery is monitored monthly, the rest annually.
- Grade B, C or D triggers a Risk Mitigation Plan to be presented to NCVET within a month.

### K. Grievance and POSH (Section 5, 4.6)

- Grievance and POSH committee records, with case tracking.
- Candidate result-dispute workflow.

### L. Security and privacy (2.3.6.2, 4.9)

- Compliance with the Digital Personal Data Protection Act 2023 and Government of India storage and privacy guidelines.
- Content-theft protection, regular information security audits, role-based access, audit logs.
- If the AA is also an AB: separate people, systems and control for awarding and assessment.

## 3. User roles

AA admin, MIS/IT team, SME/content developer, assessor, proctor, candidate, training partner or centre, Awarding Body reviewer, NCVET/monitoring viewer.

## 4. Suggested build order

1. **Phase 1:** batch workflow with SLA timers, assessor registry and rules, geo-tagged assessor app, result submission.
2. **Phase 2:** question bank, assessment engine, offline mode, evidence vault.
3. **Phase 3:** live and AI proctoring, analytics, ERF score tracker and DEP data export, public calendar.

## 5. Items to verify before building

- The guidelines refer to *Annexure B of NCVET's Blended Learning Guidelines* for the full engine feature list. Obtain it.
- ICT tools and AI proctoring need prior AB and/or NCVET approval.
- DEP and SIDH integration formats are not specified in this document. Confirm API or upload requirements with NCVET and the AB.
- Annexure IX(a) and IX(b) hold the full 31 sub-parameters and weights if you want an exact scoring engine.
