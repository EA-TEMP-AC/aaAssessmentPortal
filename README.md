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

## Key management and deployment variables (S-01)

Personal fields (user, assessor and proctor email; learner phone) are encrypted in the database with AES-256-GCM, field by field. Full design: docs/SCHEMA.md section 7. Plain text never reaches the database or a backup; API responses are unchanged.

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `FIELD_ENCRYPTION_KEYS` | production | One or more keys as `id:base64key`, comma separated. Each key is 32 random bytes, base64. Ids are 1 to 32 letters, digits, `_` or `-` |
| `FIELD_ENCRYPTION_KEY_ID` | production | The id used to encrypt new values. Must be one of the ids above. Older ids stay readable |
| `FIELD_HASH_KEY` | production | At least 32 random bytes, base64. Keys the lookup hash used for email uniqueness and login |
| `JWT_ACCESS_SECRET` | production | At least 32 characters (existing) |
| `MONGO_URI`, `SMTP_*`, `BCRYPT_COST` | as before | See `server/.env.example` |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. The server refuses to start in production with the keys missing or malformed. Outside production, missing keys fall back to a built-in development key with a warning: do not put real data in such a database. The test suite sets its own throwaway keys in `server/tests/setup-env.js`.

### Rules for keys

- Keys exist only in the environment (a secret manager or the host's protected environment file). They are never committed, never logged, and never stored in MongoDB.
- Keep a copy of every key in use in a second protected place that is not the database backup. **Losing a key makes the data encrypted under it permanently unreadable.**
- `FIELD_HASH_KEY` and the encryption keys should be different values.
- Give each environment its own keys.

### First deployment on an existing database

1. Set the three variables and deploy the new build. Until the next step, nobody can sign in, because login looks users up by the new `emailHash` column. Plan a short window (DECISIONS 270).
2. `cd server && npm run migrate:encrypt -- --dry-run` to see the counts, then `npm run migrate:encrypt`. It encrypts plain-text rows, fills the hash columns, and swaps the old unique `email` indexes for the hash indexes. Running it again changes nothing. A row it cannot decrypt is listed by id and left alone, and the command exits with code 2.
3. Check the output shows `errors: []` for every collection.

### Rotating the encryption key

1. Generate a new key. Add it to `FIELD_ENCRYPTION_KEYS` next to the old one (`k1:...,k2:...`) and set `FIELD_ENCRYPTION_KEY_ID=k2`. Restart. New writes use `k2`; old values still read.
2. Run `npm run migrate:encrypt`. The output shows `rotated` counts. Run it again and confirm `rotated: 0`.
3. Only then remove `k1` from `FIELD_ENCRYPTION_KEYS`.

Rotating `FIELD_HASH_KEY` means changing it and running `npm run migrate:encrypt` straight away; email lookups fail in between.

### Retention report

`cd server && npm run retention:dry-run [-- --ids=5]` prints, per data class, how many records are past the period set in `server/src/config/retention.js`. It only reads. The periods are proposals (DECISIONS 262) and nothing is deleted.

### Access log

Reads of personal data are recorded in `accessLogs`, and `aa_admin` reads them at `GET /api/v1/audit/access-log` (API_CONTRACT.md). The compliance picture, including what is not done, is in docs/DPDP_CHECKLIST.md.

## Evidence storage (V-01)

Evidence files (photos, ID proofs, PDFs, MP4 video) are written through one storage interface with two drivers, chosen by `EVIDENCE_STORAGE_DRIVER`. Files get random keys; no client file name is used. The interface has no delete. Production must set a driver and cannot use `local`; the server refuses to start otherwise. Hosting must be in India (DECISIONS 6, 240); the provider is not chosen yet.

| Variable | Required | Meaning |
|---|---|---|
| `EVIDENCE_STORAGE_DRIVER` | production | `local` (development, tests; the default outside production) or `s3` |
| `EVIDENCE_LOCAL_DIR` | no | Folder for the local driver. Default `server/var/evidence` (git-ignored) |
| `EVIDENCE_S3_BUCKET` | s3 | Bucket name |
| `EVIDENCE_S3_REGION` | s3 | Region, for example `ap-south-1` |
| `EVIDENCE_S3_ENDPOINT` | no | Endpoint URL of an S3-compatible service. Leave unset for AWS |
| `EVIDENCE_S3_FORCE_PATH_STYLE` | no | `true` for services that need path-style addressing (default `false`) |
| `EVIDENCE_S3_ACCESS_KEY_ID`, `EVIDENCE_S3_SECRET_ACCESS_KEY` | no | Set both or neither. When neither is set the AWS default credential chain is used. Credentials exist only in the environment, never in code, and are never logged |
| `EVIDENCE_S3_SSE`, `EVIDENCE_S3_KMS_KEY_ID` | no | Server-side encryption sent with every upload: `AES256` (default) or `aws:kms` with an optional key id |
| `EVIDENCE_SIGNED_URL_SECONDS` | no | Download link lifetime, 10 to 900 (default 120) |

Turn on server-side encryption and versioning (or object lock) on the bucket, and give the application key put and get rights only, no delete. Uploads pass through a temporary file under the OS temp folder and are removed afterwards. Check file integrity with `POST /api/v1/evidence/:id/verify`.
