---
name: database-migrations
description: SQL migration conventions — naming, table patterns, RLS policies, partition management, and the db-migrate runner.
triggers:
  - migration
  - database
  - schema
  - table
  - SQL
  - partition
  - RLS policy
  - ALTER TABLE
related_skills:
  - multi-tenancy
  - backend-patterns
  - convoy-system
  - cds-container-delivery
---

# Database Migrations

## Purpose

Teaches how to create and manage SQL migrations in the Sonalit codebase — naming conventions, table patterns, RLS policies, partition management, and the migration runner.

## When to Activate

Any work involving database schema changes, new tables, ALTER TABLE, index creation, partition management, or RLS policies.

## Migration Directory

All migrations: `backend/migrations/*.sql`

81+ migration files as of current codebase.

## Naming Convention

```
YYYYMMDD_NNN_description.sql
```

Examples:
- `20260521_000_base_schema.sql` — initial schema
- `20260521_001_enable_rls.sql` — RLS enablement
- `20260805_073_cds_schema.sql` — CDS schema
- `20260812_076_cds_field_alerts.sql` — latest

The `NNN` sequence number is globally unique across the codebase. When adding a new migration, use the next available number.

Date prefix uses the date the migration was written. Multiple migrations on the same day use sequential numbers.

## Migration Runner

File: `backend/db-migrate.js`

Auto-runs on backend start (Railway deployment). Executes all `.sql` files in `backend/migrations/` in filename sort order. Tracks applied migrations to avoid re-execution.

## Table Conventions

### Standard Columns

Every tenant-owned table should have:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `org_id UUID NOT NULL` (for RLS)
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`
- `deleted_at TIMESTAMPTZ` (soft delete)

### RLS Policy Pattern

From `20260521_001_enable_rls.sql`:

```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_table FORCE ROW LEVEL SECURITY;

CREATE POLICY my_table_org_isolation ON my_table
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);
```

**CRITICAL**: Every new tenant-owned table MUST have RLS enabled with this exact policy pattern. See the multi-tenancy skill for why.

### CDS Table Prefix

All Container Delivery System tables use the `cds_` prefix:
- `cds_customers`, `cds_transporters`, `cds_vehicles`, `cds_drivers`
- `cds_containers`, `cds_electronic_locks`, `cds_lock_events`
- `cds_bookings`, `cds_booking_containers`, `cds_trips`, `cds_trip_events`
- `cds_gps_history`, `cds_geofences`, `cds_alerts`, `cds_incidents`
- `cds_documents`, `cds_notifications`, `cds_audit_logs`, `cds_activity_feed`, `cds_reports`

### Idempotent DDL

Migrations MUST be idempotent — safe to run multiple times:

```sql
CREATE TABLE IF NOT EXISTS ...
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
CREATE UNIQUE INDEX IF NOT EXISTS ...
INSERT INTO ... ON CONFLICT ... DO NOTHING
```

### Soft Delete Index

Tables with soft delete should have a partial index:

```sql
CREATE INDEX IF NOT EXISTS idx_my_table_active
  ON my_table(org_id, created_at DESC)
  WHERE deleted_at IS NULL;
```

## Partition Management

### GPS Logs Partitioning

`gps_logs` is partitioned by month. The partition roller creates future partitions automatically.

From `20260521_006_ensure_future_partitions.sql` and `20260521_013_partition_archival.sql`.

Partition roller cron job runs daily in `backend/src/app.js`.

### Creating Partitioned Tables

```sql
CREATE TABLE IF NOT EXISTS gps_logs (
  id BIGSERIAL,
  vehicle_id UUID NOT NULL,
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  timestamp TIMESTAMPTZ NOT NULL,
  ...
) PARTITION BY RANGE (timestamp);
```

CDS GPS history is also partitioned: `cds_gps_history` partitioned by month.

## Common Migration Patterns

### Adding Columns

```sql
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS escalation_level INT DEFAULT 0;
```

### Adding Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_device_locations_device_id ON device_locations(device_id);
CREATE INDEX IF NOT EXISTS idx_panic_events_open_unacked
  ON panic_events(org_id, created_at)
  WHERE resolved_at IS NULL AND acknowledged_at IS NULL;
```

### Adding Unique Constraints

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_imei_hash
  ON guardian_devices(imei_hash)
  WHERE imei_hash IS NOT NULL AND deleted_at IS NULL;
```

### Foreign Keys

```sql
REFERENCES guardian_devices(id) ON DELETE CASCADE
REFERENCES users(id)
REFERENCES convoys(id)
```

### Backfill Migrations

Some migrations include data backfill alongside schema changes:
- `20260609_039_backfill_convoy_org_id.sql`
- `20260715_059_retire_duplicate_guardian_devices.sql`

## Key Migration Groups

| Range | Domain |
|-------|--------|
| 000–014 | Base schema, RLS, core indexes, partitions |
| 015–016 | Field officers, missing schema |
| 017–020 | App roles, fleet v4, DMS, route safety |
| 021–029 | Portal, convoy portal, smart geofences, fuel, driver behaviour, broadcasts, insurance, shifts |
| 030–034 | Client accounts, manifests, POD, portal documents, custody events |
| 035–045 | Risk intel, border crossings, convoy backfill, guardian convoy, day plans, field officer Knox |
| 046–072 | Ops comms, convoy trucks, reports, incidents, guardian voice/captures, WhatsApp |
| 073–076 | CDS schema, booking lifecycle, containers, field alerts |

## Relevant Files

- `backend/migrations/` — all 81+ SQL migration files
- `backend/db-migrate.js` — migration runner
- `backend/src/app.js` — partition roller cron job

## Do

- Use `IF NOT EXISTS` / `IF EXISTS` for idempotent DDL
- Add RLS policy on every new tenant-owned table
- Use the `YYYYMMDD_NNN_description.sql` naming convention
- Use the next available global sequence number
- Add `org_id` column with RLS for tenant tables
- Include `created_at`, `updated_at`, `deleted_at` on tenant tables
- Use `gen_random_uuid()` for UUID primary keys

## Don't

- Create migrations that fail on re-run (non-idempotent DDL)
- Skip RLS on tenant-owned tables
- Create CDS tables without the `cds_` prefix
- Drop tables or columns in migrations without careful consideration
- Use sequential integer IDs for tenant-facing tables (use UUIDs)
- Forget the soft-delete pattern for tenant tables
