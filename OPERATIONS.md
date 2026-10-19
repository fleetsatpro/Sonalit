# Guardian Operations Runbook

## Audit Log Archive — Restore Procedure

When enabled, the GDPR retention route archives eligible `guardian_audit_log` rows as GZIP-compressed JSONL objects in Cloudflare R2 under:

```
audit-log-archive/<org_id>/YYYY-MM-DD.jsonl.gz
```

The archive is produced when `POST /api/v1/gdpr/run-retention` runs with `guardian_config.audit_log_archive_enabled = 1`. Verify that the feature flag, retention eligibility and R2 configuration are correct before using it.

### Enable archiving

```sql
UPDATE guardian_config SET value_int = 1 WHERE key = 'audit_log_archive_enabled';
```

Or via the admin API:

```bash
curl -X PUT /api/v1/guardian/admin/config \
  -H "Authorization: Bearer <admin_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"key":"audit_log_archive_enabled","value_int":1}'
```

### List archive files (AWS CLI / rclone / wrangler)

```bash
aws s3 ls "s3://$R2_BUCKET/audit-log-archive/<org_id>/" \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
```

### Download and inspect an archive

```bash
aws s3 cp "s3://$R2_BUCKET/audit-log-archive/<org_id>/2026-01-15.jsonl.gz" /tmp/audit.jsonl.gz \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

gunzip -c /tmp/audit.jsonl.gz | head -20
```

### Restore rows to the database

Restore only to a recovery/staging database first. Validate the object, organization scope, row count and schema before importing. Do not execute per-row SQL interpolation with untrusted archive content in a production shell. Prefer decompression into a file, load with a parameter-safe staging process, reconcile counts, then insert with `ON CONFLICT DO NOTHING` if the target restore plan requires it.

The archive key includes the tenant ID, so verify the tenant scope before restoring. The existing archive format is a row snapshot; it is not a full PostgreSQL backup or WAL/PITR replacement.

## Partition maintenance — understand before running

The current scheduler in `backend/src/app.js` runs:
- **Hourly:** `ensure_future_partitions(..., 3)` for `gps_logs`, `audit_logs` and `outbox`.
- **Daily at 03:00 UTC:** calls `drop_old_partitions(table_name, retain_months)` for rows in `partition_retention`.

Despite the code's log label saying "archival", the `archiveOldPartitions()` function shown in `app.js` does **not itself export the partition to R2 before dropping it**. Treat the current function as destructive partition cleanup, not a verified archival pipeline. Do not lower retention values or manually invoke partition deletion until the retention intent, table definitions and an independently verified archive/backup have been checked.

### Inspect current partition layout

Run read-only on a healthy database:

```sql
SELECT pn.nspname AS schema_name,
       p.relname AS parent_table,
       c.relname AS partition_name,
       pg_get_expr(c.relpartbound, c.oid) AS partition_bound,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS partition_size
FROM pg_inherits i
JOIN pg_class p ON p.oid = i.inhparent
JOIN pg_namespace pn ON pn.oid = p.relnamespace
JOIN pg_class c ON c.oid = i.inhrelid
WHERE pn.nspname = 'public'
ORDER BY p.relname, c.relname;
```

Inspect retention settings (read-only):

```sql
SELECT table_name, retain_months
FROM partition_retention
ORDER BY table_name;
```

An archive-before-delete workflow must upload, verify count/range/checksum, write a durable archive manifest, validate a test restore, and only then release eligible source data. Retention must continue to respect the applicable data protection policy.

## Base64 Photo Backfill — manual, limited scope

The scheduled backfill was removed from `backend/src/app.js`. The existing script is a **manual backfill utility**, not an active daily cron. Run it from the repository/backend environment only after confirming the R2 target and having a database backup:

```bash
cd backend
node scripts/backfill-base64-photos.js
```

Important limitations in the current script:
- It scans `field_reports.photo_url` and `convoy_truck_photos.photo_url` data URIs created in the preceding seven days, not all historical rows.
- Its existence does not establish that current production R2 credentials or bucket routes are configured.
- It does not replace a full media inventory, an idempotent multi-batch migration manifest or a post-migration reconciliation.

For a full historical storage migration, use the read-only inventory first and implement the bounded, resumable, checksummed process described in `docs/architecture/storage-tiering-b-and-c.md`. Do not delete original inline content before each object is verified and restore checks pass.

## DMS (Dead-Man Switch) Ceiling

Maximum DMS interval is enforced server-side via `guardian_config.dms_max_interval_minutes` (default 120). The exact current setting should be checked before changing it.

```sql
UPDATE guardian_config SET value_int = 120 WHERE key = 'dms_max_interval_minutes';
```
