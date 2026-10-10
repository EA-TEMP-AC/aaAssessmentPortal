# AA Compliance App: agent team kit

## Local MongoDB (replica set)

Transactions (e.g. `assessorDayLocks`) need a replica set. From the repo root:

```bash
docker compose up -d
```

Wait until healthy (`docker compose ps` shows `aa-mongo` healthy). Then copy `server/.env.example` to `server/.env` and use:

```text
MONGO_URI=mongodb://127.0.0.1:27017/aa_portal?replicaSet=rs0&directConnection=true
```

Stop: `docker compose down`. Wipe data: `docker compose down -v`.

## How to run the team in Cursor
1. Open this folder as a git repo (`git init && git add . && git commit -m "kit"`).
2. Agent 1 (Plan mode), prompt:
   "Act as the Architect per .cursor/rules/architect.mdc. Read docs/FEATURE_REPORT.md and docs/REFERENCE_DEMO_NOTES.md. Do task A-01 only."
   Review and edit its output yourself. Do not skip this.
3. Then run parallel agents, each in its own worktree, one task each:
   "Act as Backend per .cursor/rules/backend.mdc. Do task B-01 only."
   "Act as Frontend per .cursor/rules/frontend.mdc. Do task F-01 only."
4. For each finished branch run:
   "Act as Reviewer per .cursor/rules/reviewer.mdc. Review branch task/B-01-*."
5. You merge. Ask Architect to refresh TASKS.md for the next batch.

Tips: new chat per task; tasks that touch the same files must not run in parallel; commit often.

## Requirement sources
docs/FEATURE_REPORT.md (functional) and docs/TECH_REQUIREMENTS.pdf (technology). Coverage map: docs/TRACEABILITY.md.
