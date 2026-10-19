# Storage tiering — production preflight runbook

This runbook applies to branch `feat/storage-tiering-b-c-preflight`. It deliberately separates read-only inventory from DDL and from data migration.

## 0. Guardrails

- The original `Postgres` database recently failed WAL recovery with `No space left on device`. Do not run write/migration/cleanup commands against it until recovery is established and a backup is restorable.
- The second service `Postgres--wsQ` is provisioned, private-only, and intended for the `sonalit_analytics` database. It is currently empty; no operational application is configured to use it.
- Do not attach/delete/repurpose any detached PostgreSQL volume until its provenance and contents are known.
- Never print, paste, or commit `DATABASE_URL`, `ANALYTICS_DATABASE_URL`, R2 access keys, secrets, or presigned URLs.
- Commands below use the Railway project ID only to avoid running against a similarly named project.

## 1. Get the preflight branch locally

From an existing local Sonalit checkout:

```bash
git fetch origin feat/storage-tiering-b-c-preflight
git switch feat/storage-tiering-b-c-preflight
pnpm install --frozen-lockfile
```

No PR or merge is required to run the inventory scripts.

## 2. Inventory the existing R2 buckets first (read-only)

The tool reads object metadata only. It does not download object bodies, modify buckets, or print object keys.

```bash
railway run \
  --project 0fed6056-6fb1-4c3c-a3d3-7816d5a8c901 \
  --environment production \
  --service serene-ambition \
  node backend/scripts/storage-audit.js --scan-r2 --r2-only --max-objects=10000
```

- `--r2-only` means it will not try to connect to PostgreSQL.
- It discovers distinct buckets using configured `R2_MEDIA_BUCKET`, `R2_PRIVATE_EVIDENCE_BUCKET`, `R2_PRIVATE_REPORTS_BUCKET`, `R2_ARCHIVE_BUCKET`, `R2_REPORTS_BUCKET` and the legacy `R2_BUCKET`.
- If a bucket reports `truncatedAtLimit: true`, its totals cover only the enumerated objects. Repeat with a higher `--max-objects` (maximum 100000) or implement a paginated export to a secured report store.
- If it says credentials are not configured, or sealed variables are unavailable to the local CLI, **do not unseal or copy production credentials into a local file**. Stop and use a scoped in-platform inventory runner with service-variable references.
- The prefix summary is informational, not proof of correct data classification. An object's prefix may be incomplete or inconsistent with its actual contents/permissions.

Run a separate Cloudflare dashboard/Terraform-state review for bucket privacy, custom domains, lifecycle rules, CORS, object-lock rules and existing bucket contents. Runtime environment variables alone do not establish those settings.

## 3. Inventory the primary PostgreSQL DB (read-only, only after it is healthy)

Open a private DB shell. `railway connect` will use an SSH tunnel when the database has no public TCP proxy; do not create a public proxy for this audit.

```bash
railway connect Postgres --environment production
```

At the `psql` prompt, run:

```psql
SELECT current_database(),
       pg_size_pretty(pg_database_size(current_database())) AS database_size;
\i backend/scripts/storage-audit-readonly.sql
\q
```

The SQL audit is wrapped in a READ ONLY transaction and reports large relations, bytea/media-candidate columns and partition metadata. If the primary is still unavailable, stop; do not try to repair it by deleting files or manipulating WAL. After the metadata audit, the optional payload scans in the SQL comments can be run separately during a low-load window. They can read many rows and should not be run while the database is failing or near full capacity.

## 4. Apply the new analytics catalog (DDL only; no source data)

The schema file has a database-name guard: it raises an error unless `current_database()` is exactly `sonalit_analytics`. It is wrapped in a transaction and creates empty tables/policies only.

```bash
railway connect "Postgres--wsQ" --environment production
```

At the `psql` prompt, **first confirm the target**:

```psql
SELECT current_database(), current_user,
       pg_size_pretty(pg_database_size(current_database())) AS database_size;
```

Proceed only if `current_database()` is `sonalit_analytics`. Then:

```psql
\i backend/scripts/storage-analytics-schema.sql
\dt public.storage_*
\dt public.analytics_*
\q
```

The script enables and forces tenant RLS on catalog/rollup tables but intentionally does not create login users or grant app permissions. Do not point the existing app at this database; the secondary schema is not wired into the application yet. A later dedicated role bootstrap and adapter must use transaction-local `app.current_org_id`, least privilege, and explicit failure isolation.

## 5. Next step after inventories

Save these values in a secured change record: measurement timestamp, database name and size, top tables, BYTEA/media payload sizes, partition layout/retention settings, R2 bucket inventory totals and whether each listing was complete. Do not attach object keys, secrets, exact personal data or signed URLs to public issues.

Prioritise candidate migrations only after counts are known:
1. verified R2 copies of generated PDFs, without dropping the database fallback in the same release;
2. legacy base64 photos, beyond the existing script's seven-day selector;
3. Guardian voice clips after both direction-specific API paths support key-based R2 reads;
4. approved historical archives only after archive checksum/restore tests and retention review.

Never archive raw personal location history for longer than the approved retention window just to save space. A successful upload is not sufficient: object existence/length/checksum, source-to-object mapping, download authorization and restoration must all be verified before source bytes are released.
