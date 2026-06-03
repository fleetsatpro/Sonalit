# RECON_SCHEMA — Database Schema Inventory

Generated from: `backend/scripts/migrate*.js`
Date: 2026-05-21

Key: ✅ has org_id + indexed | ⚠️ has org_id but nullable/no index | ❌ no org_id

---

## Core Tables (migrate.js)

### users ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | uuid_generate_v4() |
| email | VARCHAR(255) | UNIQUE |
| name | VARCHAR(255) | |
| password_hash | VARCHAR(255) | |
| role | VARCHAR(50) | CHECK IN ('admin','dispatcher','operator','analyst') |
| status | VARCHAR(50) | CHECK IN ('active','suspended') |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | soft delete |
**Indexes:** idx_users_email (email WHERE deleted_at IS NULL), idx_users_role
**No org_id** — single-tenant origin, never retrofitted

### convoys ⚠️
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(255) | |
| region | VARCHAR(100) | |
| status | VARCHAR(50) | CHECK IN ('planned','active','completed','aborted') |
| priority | VARCHAR(50) | CHECK IN ('low','medium','high','critical') |
| description | TEXT | |
| departure_time | TIMESTAMPTZ | |
| arrival_time | TIMESTAMPTZ | |
| estimated_arrival | TIMESTAMPTZ | |
| route_origin | VARCHAR(100) | |
| route_destination | VARCHAR(100) | |
| created_by | UUID | FK users |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |
| org_id | UUID | Added by migrate-guardian-cfo-p1.js — NULLABLE, no index |
| risk_score | INTEGER | Added by migrate-extended.js |
| timezone | TEXT | Added by migrate-guardian-cfo-p1.js |
| ... | | many CFO columns added |
**Indexes:** idx_convoys_status, idx_convoys_region
**org_id added late — nullable, no composite index**

### vehicles ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| type | VARCHAR(100) | |
| registration | VARCHAR(50) | UNIQUE |
| region | VARCHAR(100) | |
| status | VARCHAR(50) | CHECK IN ('idle','active','maintenance','offline') |
| capacity | INTEGER | |
| latitude | DECIMAL(10,7) | |
| longitude | DECIMAL(10,7) | |
| last_ping | TIMESTAMPTZ | |
| driver_id | UUID | FK users |
| assigned_convoy_id | UUID | FK convoys |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |
| last_service_date | TIMESTAMPTZ | Added by migrate-extended.js |
| maintenance_score | INTEGER | Added by migrate-extended.js |
**Indexes:** idx_vehicles_status, idx_vehicles_region
**No org_id**

### alerts ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| vehicle_id | UUID | FK vehicles |
| convoy_id | UUID | FK convoys |
| type | VARCHAR(100) | CHECK IN ('speed','geofence','mechanical','security','communication') |
| severity | VARCHAR(50) | CHECK IN ('low','medium','high','critical') |
| message | TEXT | |
| acknowledged_at | TIMESTAMPTZ | |
| resolved_at | TIMESTAMPTZ | |
| created_by | UUID | FK users |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |
**Indexes:** idx_alerts_severity, idx_alerts_vehicle, idx_alerts_unresolved
**No org_id**

### incidents ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| convoy_id | UUID | FK convoys |
| title | VARCHAR(255) | |
| description | TEXT | |
| severity | VARCHAR(50) | |
| status | VARCHAR(50) | CHECK IN ('open','investigating','resolved') |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |
| linked_vehicle | UUID | Added by migrate-extended.js |
| assigned_to | UUID | Added by migrate-extended.js |
**Indexes:** idx_incidents_convoy
**No org_id**

### channels ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(100) | UNIQUE |
| description | TEXT | |
| created_at | TIMESTAMPTZ | |
**No org_id**

### messages ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| channel_id | UUID | FK channels |
| sender_id | UUID | FK users |
| content | TEXT | |
| created_at | TIMESTAMPTZ | |
**Indexes:** idx_messages_channel
**No org_id**

### audit_logs ❌
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| table_name | VARCHAR(100) | |
| record_id | UUID | |
| action | VARCHAR(20) | CHECK IN ('INSERT','UPDATE','DELETE') |
| old_data | JSONB | |
| new_data | JSONB | |
| user_id | UUID | FK users |
| created_at | TIMESTAMPTZ | |
**Indexes:** idx_audit_table, idx_audit_user
**No org_id** — NOTE: spec audit log has hash chain, reality does not

### gps_logs ❌
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| vehicle_id | UUID | FK vehicles |
| lat | DECIMAL(10,7) | |
| lng | DECIMAL(10,7) | |
| speed | DECIMAL(6,2) | |
| timestamp | TIMESTAMPTZ | |
**Indexes:** idx_gps_vehicle (vehicle_id, timestamp DESC)
**No org_id — not partitioned in core migration** (partition roller script exists separately)

---

## Extended Tables (migrate-extended.js)

### devices ❌
- id, name, imei, sim_number, phone_number, status, battery, signal, last_ping, vehicle_id, created_at, updated_at, deleted_at
- **No org_id**

### rules ❌
- id, name, condition, action, enabled, priority, cooldown_minutes, created_at, updated_at
- **No org_id**

### geofences ❌
- id, name, type, coordinates JSONB, radius, region, active, created_at, updated_at
- **No org_id**

### api_keys ❌
- id, name, key_hash, key_prefix, permissions JSONB, rate_limit, last_used, created_at, revoked_at
- **No org_id**

### documents ❌
- id, convoy_id, type, title, metadata JSONB, valid_until, created_at, updated_at, deleted_at
- **No org_id**

### reports ❌
- id, type, title, data JSONB, created_at
- **No org_id**

### sensor_logs ❌
- id SERIAL, vehicle_id, temperature, humidity, shock_g, raw_payload JSONB, timestamp
- Indexed: (vehicle_id, timestamp DESC)
- **No org_id**

### fuel_logs ❌
- id SERIAL, vehicle_id, fuel_level, liters, cost, timestamp
- Indexed: (vehicle_id, timestamp DESC)
- **No org_id**

---

## Enterprise Tables (migrate-enterprise.js)

### drivers ✅
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- Indexed: idx_drivers_org (org_id WHERE deleted_at IS NULL)

### shipments ✅
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- Indexed: idx_shipments_org (org_id, status WHERE deleted_at IS NULL)

### checkpoints ❌
- convoy_id, shipment_id — no org_id

### trips ✅
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- Indexed: idx_trips_org (org_id, started_at DESC)

### invoices ✅
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- Indexed: idx_invoices_org (org_id, status)

### expenses ⚠️
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- No dedicated org index (indexed by trip_id, vehicle_id)

### maintenance_records ⚠️
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- Indexed: idx_maintenance_vehicle (vehicle_id, scheduled_date)

### risk_zones ⚠️
- org_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
- Indexed: idx_risk_zones_region

### webhooks ❌
- No org_id (if present)

---

## Guardian Tables (migrate-guardian-devices.js + patches)

### guardian_devices ⚠️
- Added org_id via migrate-guardian-p5t6.js: `ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS org_id UUID` — nullable, no index
- token, name, imei, model, android_id, manufacturer, os_version, app_version, status, etc.

### device_locations ❌
- device_id, lat, lng, altitude, speed, bearing, accuracy, timestamp
- No org_id (joins through guardian_devices)

### device_health ❌
- device_id, battery_level, battery_charging, signal_strength, etc.

### panic_events ⚠️
- Added org_id via migrate-guardian-p5t6.js: nullable, no index

### device_commands ❌
- device_id, command_type, payload JSONB, status, etc.
- **NO nonce column** — replay attack surface

### field_reports ⚠️
- Added org_id via migrate-guardian-p5t6.js: nullable, no index

### guardian_config ⚠️
- Added org_id via migrate-guardian-p5t6.js: nullable, no index

### guardian_audit_log ❌
- actor_type, actor_id, action, target_type, etc.
- No org_id

### enrollment_codes ⚠️
- org_id UUID (nullable at schema level)

### convoy_codes ⚠️
- org_id UUID (nullable)

---

## CFO Guardian Tables (migrate-guardian-cfo-p1.js +)

### convoy_cfos ⚠️
- convoy_id, user_id, org_id (from convoys join)

### convoy_trucks ⚠️
- convoy_id, vehicle_id, sequence_order

### convoy_daily_reports ❌
- convoy_id, report_date, status, pdf_url, etc. — no direct org_id

### cfo_photo_sessions ❌
- device_id, convoy_id — no direct org_id

---

## Missing from spec

- `guardian_command_nonces (device_id, nonce, seen_at)` — **NOT PRESENT**
- `idempotency_keys` table — **NOT PRESENT** (only in services/auth-svc)
- `cfo_login_attempts` — **NOT PRESENT** for brute-force protection
- `partition_retention` — **NOT PRESENT**
- Hash chain on `audit_logs` — **NOT PRESENT** (no `hash`/`prev_hash` columns)
- `device_command_events` — **NOT PRESENT**

---

## Partitioning

`backend/scripts/partition-roller.js` exists and creates monthly partitions for:
- `gps_logs` (if partitioned) — likely NOT partitioned in prod (base table is SERIAL, not range-partitioned in migration)
- `guardian_audit_log` — partition roller handles this

No evidence of `pg_partman` or formal partition management.
