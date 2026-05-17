# Guardian Operations Runbook

## Audit Log Archive — Restore Procedure

Archived audit log rows are written as GZIP-compressed JSONL to Cloudflare R2 at:

```
audit-log-archive/YYYY-MM-DD.jsonl.gz
```

Each file is created when `POST /api/v1/gdpr/run-retention` runs with
`guardian_config.audit_log_archive_enabled = 1`.

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
# Using AWS CLI pointed at R2
aws s3 ls s3://$R2_BUCKET/audit-log-archive/ \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
```

### Download and inspect an archive

```bash
# Download
aws s3 cp s3://$R2_BUCKET/audit-log-archive/2026-01-15.jsonl.gz /tmp/audit.jsonl.gz \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com

# Decompress and inspect
gunzip -c /tmp/audit.jsonl.gz | head -20
```

### Restore rows to the database

```bash
gunzip -c /tmp/audit.jsonl.gz | while IFS= read -r line; do
  psql "$DATABASE_URL" -c "
    INSERT INTO guardian_audit_log
      (id, actor_type, actor_id, action, target_type, target_id, payload, ip_address, created_at)
    SELECT
      (v->>'id')::bigint,
      v->>'actor_type', (v->>'actor_id')::uuid,
      v->>'action', v->>'target_type', (v->>'target_id')::uuid,
      (v->>'payload')::jsonb, v->>'ip_address',
      (v->>'created_at')::timestamptz
    FROM (SELECT '\''$line'\''::jsonb AS v) sub
    ON CONFLICT (id) DO NOTHING;
  "
done
```

Or bulk-restore using a temporary table:

```sql
-- 1. Copy the decompressed file to the DB server (or use \copy from psql)
CREATE TEMP TABLE audit_restore (row jsonb);
\copy audit_restore FROM PROGRAM 'gunzip -c /tmp/audit.jsonl.gz' CSV QUOTE e'\x01' DELIMITER e'\x02';

-- 2. Insert, skipping duplicates
INSERT INTO guardian_audit_log
  (id, actor_type, actor_id, action, target_type, target_id, payload, ip_address, created_at)
SELECT
  (row->>'id')::bigint,
  row->>'actor_type', (row->>'actor_id')::uuid,
  row->>'action', row->>'target_type', (row->>'target_id')::uuid,
  (row->>'payload')::jsonb, row->>'ip_address',
  (row->>'created_at')::timestamptz
FROM audit_restore
ON CONFLICT (id) DO NOTHING;
```

---

## Partition Roller

Runs daily at **02:00 UTC** via node-cron in `app.js` and as a startup task.

Creates the next 3 months of partitions for `device_locations` and `device_health`,
drops partitions older than `guardian_config.gdpr_retention_days_location` (default 90 days).

**Manual run:**

```bash
cd backend && node scripts/partition-roller.js
```

**Check extant partitions:**

```sql
SELECT c.relname AS partition, p.relname AS parent
FROM pg_inherits i
JOIN pg_class p ON p.oid = i.inhparent
JOIN pg_class c ON c.oid = i.inhrelid
WHERE p.relname IN ('device_locations', 'device_health')
ORDER BY p.relname, c.relname;
```

---

## Base64 Photo Backfill

Runs daily at **03:00 UTC** via node-cron. Migrates `field_reports` rows whose
`photo_url` is a `data:` URI (created in the last 7 days) to R2 and replaces
the column with the HTTPS public URL.

Requires R2 environment variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`.

**Manual run:**

```bash
cd backend && node scripts/backfill-base64-photos.js
```

---

## DMS (Dead-Man Switch) Ceiling

Maximum DMS interval enforced server-side via `guardian_config.dms_max_interval_minutes` (default 120).
SettingsActivity caps the spinner at this value.

**Change ceiling:**

```sql
UPDATE guardian_config SET value_int = 120 WHERE key = 'dms_max_interval_minutes';
```
