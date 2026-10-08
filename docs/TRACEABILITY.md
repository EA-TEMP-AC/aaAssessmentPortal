# Traceability: NCVET technology requirements -> modules -> tasks
Source: docs/TECH_REQUIREMENTS.pdf (section numbers = that PDF). Status: covered / partial / GAP (before this update).
Rule: only items in this table may be labelled "NCVET-mandated" in code, UI or docs. Everything else is a project choice (PDF s29).

| PDF s | Requirement | Module | Tasks | Was |
|---|---|---|---|---|
| 1,3 | AI-enabled test engine, lifecycle dashboards, content refresh | Engine, Analytics | E-01..E-04, N-01 | partial |
| 2,12 | Online, offline, blended, proctored modes; offline operation | Engine, Mobile | E-05, M-01, M-04 | covered |
| 4,5 | Auto test creation, qualification>NOS>PC, random selection, difficulty + Bloom weights (AA+AB decide weights) | Engine | E-01, E-02 | covered |
| 6,7 | Audio + video recording, live proctoring start to end, suspicious behaviour detection, malpractice record + flag | Proctoring | P-01..P-04 | partial (audio missing) |
| 8 | Live video feed + random photo capture at intervals | Proctoring | P-02 | covered |
| 9,26 | Geo-tag assessors AND proctors; login/logout geo+date+time, offline; student tracking; email AB at assessor login | Mobile, Backend | M-01, M-03, B-06 | partial (proctor geo, student tracking, email trigger missing) |
| 10 | Graphical analytics by Assessor, TP, Job Role, State, Date range | Analytics | N-01 | GAP in contract |
| 11 | Candidate verification/authenticity (auto proctoring + geo-tag) | Proctoring, Mobile | P-03, M-02 | partial |
| 13 | Auto classify Easy/Medium/Tough; per-question usage report; feedback to AB/TP on mostly-wrong questions | Question bank | Q-02, Q-03 | GAP in contract |
| 14,15 | Question banks for >=5% of sector qualifications (at application); >=5 Q per PC avg; AB consultation; Low/Med/High mix; Bloom coverage; periodic review/upgrade with AB; Indian languages | Question bank | Q-01..Q-05 | partial (5% rule missing) |
| 16 | MCQ, short answer, scenario (encouraged), viva + practical banks, simulators | Question bank, Engine | Q-01, E-06 | partial |
| 17,25 | Store assessment videos/data; learner data repository; assessor repository (qualifications + years of experience) | Evidence, Registry | V-01, B-04 | partial (experience years) |
| 18 | DMS/SDMS: record, validate, report; documented info-security procedures; data collection tools; DPDP Act 2023 | Backend, Compliance | B-01, B-05, S-01 | partial |
| 19,20 | Zero content theft; regular info-security audits; student data privacy | Security | S-01, S-02 | partial |
| 21 | Easy-to-use UI, no prior expertise needed | Web | F-* (acceptance criterion) | not tracked |
| 22 | Public website: team, organogram, assessor/proctor details + quals + experience, sample papers, industry linkages, grievance/POSH, registered-office docs, premises proof | Public site | W-01, W-02 | GAP |
| 23 | PwD: disability-based content, trained proctors/assessors, ICT tools, accessible result publishing | Accessibility | X-01..X-03 | GAP (only noted) |
| 24 | Simulators/tools for blended mode where applicable | Engine | E-06 | partial |
| 27 | ERF tech parameters: DPDP storage, video evidence, offline assessment by certified assessor, result TAT, no same-day two-location assessor | Compliance | C-01, B-02, B-04 | covered |
| 29 | No mandated language/DB/cloud/API/biometric/GPS hardware | all | DECISIONS.md | covered |
