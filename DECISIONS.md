# DECISIONS

## Accepted
- AI claim scope (TR s1,s3): we will claim AI in all three areas: (1) question selection, (2) question difficulty classification, (3) proctoring, including detection of blocked/covered camera, another person present or assisting, devices/objects, off-screen assistance. Only claim what is actually shipped and tested; label each in docs. AI proctoring may need prior AB/NCVET approval (FR s2.3.6.2), so keep a human-review queue and never auto-penalise a candidate without review.
- Learner data repository (TR s25): built and run in-house. Keep an export interface (versioned JSON/CSV export + pull API with scoped credentials) so an NCVET-proposed agency can be fed later. Revisit only if NCVET instructs otherwise.
- Multiple sectors: the 5% question-bank rule is checked per sector applied for. Sector list is configuration, not code.

## Proposed
- Stack: Node/Express + MongoDB (replica set) + React/Vite + React Native/Expo. Reason: matches existing team skills and tooling.
- Multi-tenant from day one? (one AA per tenant vs. single AA). Needs human decision.

## Open questions (need human / NCVET / AB)
1. DEP and SIDH integration: API or file upload? Formats?
2. Obtain Annexure B (Blended Learning Guidelines) for the full engine feature list.
3. Obtain Annexure IX(a)/(b) for the 31 ERF sub-parameters and weights.
4. Is the AA also an AB? (changes separation-of-control requirements)
5. Is AI proctoring needed at launch? (needs prior approval) Or build own vs. integrate a vendor?
6. Hosting region and object storage for evidence (DPDP Act 2023 data localisation concerns).
7. (Resolved in part) NQR list: export per sector from nqr.gov.in (qualifications search). Still open: the final list of sectors being applied for.
8. (Resolved) AI scope: see Accepted. Still confirm with NCVET/AB whether AI proctoring needs prior approval before go-live.
9. Registered-office documents and premises proof (TR s22 F,G): must these be public on the website, or available on request?
10. (Resolved) Learner repository is in-house; see Accepted.
11. Mobile OS/API level and build pipeline are project choices, not NCVET-mandated (TR s29).

## Not mandated by NCVET (TR s29), do not market as compliance features
Specific language, DB, cloud, server architecture, API style, biometric or face-recognition tech, GPS hardware, payment gateway, CRM, help-desk software.
