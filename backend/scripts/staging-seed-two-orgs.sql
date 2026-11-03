-- staging-seed-two-orgs.sql
-- Seeds two isolated orgs for the S2 multi-tenancy smoke phase.
-- Run against the STAGING database only. Never run against production.
--
-- Usage:
--   psql $DATABASE_URL -f backend/scripts/staging-seed-two-orgs.sql
--
-- After running, collect the UUIDs printed at the bottom and paste them
-- into the smoke report (docs/runbooks/staging-smoke-sprint-002-2026-05-30.md)
-- under the S2 section.

BEGIN;

-- ─── Org A ────────────────────────────────────────────────────────────────────

INSERT INTO organisations (id, name, country, timezone, plan, created_at, updated_at)
VALUES (
  'aaaaaaaa-0000-4000-a000-000000000001',
  'Smoke Org Alpha',
  'KE',
  'Africa/Nairobi',
  'enterprise',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Admin user for Org A (password: SmokeA123!)
-- bcrypt hash of SmokeA123! with cost=10
INSERT INTO users (id, org_id, name, email, password_hash, role, active, created_at, updated_at)
VALUES (
  'aaaaaaaa-0001-4000-a000-000000000001',
  'aaaaaaaa-0000-4000-a000-000000000001',
  'Alpha Admin',
  'admin@org-a-smoke.io',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh9S', -- SmokeA123!
  'admin',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Driver user for Org A
INSERT INTO users (id, org_id, name, email, password_hash, role, phone, active, created_at, updated_at)
VALUES (
  'aaaaaaaa-0002-4000-a000-000000000001',
  'aaaaaaaa-0000-4000-a000-000000000001',
  'Alpha Driver',
  'driver@org-a-smoke.io',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh9S',
  'driver',
  '+254700000001',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Vehicles for Org A
INSERT INTO vehicles (id, org_id, registration_number, make, model, status, assigned_driver_id, created_at, updated_at)
VALUES
  ('aaaaaaaa-0010-4000-a000-000000000001', 'aaaaaaaa-0000-4000-a000-000000000001', 'KAA 001A', 'Toyota', 'Land Cruiser', 'idle', 'aaaaaaaa-0002-4000-a000-000000000001', NOW(), NOW()),
  ('aaaaaaaa-0011-4000-a000-000000000001', 'aaaaaaaa-0000-4000-a000-000000000001', 'KAA 002A', 'Isuzu', 'NQR', 'idle', NULL, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Convoy for Org A
INSERT INTO convoys (id, org_id, name, status, start_date, end_date, timezone, created_by, created_at, updated_at)
VALUES (
  'aaaaaaaa-0020-4000-a000-000000000001',
  'aaaaaaaa-0000-4000-a000-000000000001',
  'Alpha Convoy',
  'active',
  CURRENT_DATE,
  CURRENT_DATE + 7,
  'Africa/Nairobi',
  'aaaaaaaa-0001-4000-a000-000000000001',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Fuel entry for Org A
INSERT INTO fuel_entries (id, org_id, vehicle_id, driver_id, source, litres, currency, idempotency_key, created_at, updated_at)
VALUES (
  'aaaaaaaa-0030-4000-a000-000000000001',
  'aaaaaaaa-0000-4000-a000-000000000001',
  'aaaaaaaa-0010-4000-a000-000000000001',
  'aaaaaaaa-0002-4000-a000-000000000001',
  'manual',
  55.0,
  'KES',
  'seed-fuel-org-a-001',
  NOW(), NOW()
) ON CONFLICT (idempotency_key) DO NOTHING;

-- Shift for Org A
INSERT INTO shifts (id, org_id, driver_id, vehicle_id, role, status, start_time, end_time, created_by, created_at, updated_at)
VALUES (
  'aaaaaaaa-0040-4000-a000-000000000001',
  'aaaaaaaa-0000-4000-a000-000000000001',
  'aaaaaaaa-0002-4000-a000-000000000001',
  'aaaaaaaa-0010-4000-a000-000000000001',
  'driver',
  'active',
  NOW() - INTERVAL '2 hours',
  NOW() + INTERVAL '10 hours',
  'aaaaaaaa-0001-4000-a000-000000000001',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Insurance claim for Org A (draft)
INSERT INTO insurance_claims (id, org_id, status, currency, created_by, updated_by, created_at, updated_at)
VALUES (
  'aaaaaaaa-0050-4000-a000-000000000001',
  'aaaaaaaa-0000-4000-a000-000000000001',
  'draft',
  'KES',
  'aaaaaaaa-0001-4000-a000-000000000001',
  'aaaaaaaa-0001-4000-a000-000000000001',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- ─── Org B ────────────────────────────────────────────────────────────────────

INSERT INTO organisations (id, name, country, timezone, plan, created_at, updated_at)
VALUES (
  'bbbbbbbb-0000-4000-b000-000000000001',
  'Smoke Org Beta',
  'KE',
  'Africa/Nairobi',
  'enterprise',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Admin user for Org B (password: SmokeB123!)
INSERT INTO users (id, org_id, name, email, password_hash, role, active, created_at, updated_at)
VALUES (
  'bbbbbbbb-0001-4000-b000-000000000001',
  'bbbbbbbb-0000-4000-b000-000000000001',
  'Beta Admin',
  'admin@org-b-smoke.io',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh9S', -- SmokeB123!
  'admin',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Driver user for Org B
INSERT INTO users (id, org_id, name, email, password_hash, role, phone, active, created_at, updated_at)
VALUES (
  'bbbbbbbb-0002-4000-b000-000000000001',
  'bbbbbbbb-0000-4000-b000-000000000001',
  'Beta Driver',
  'driver@org-b-smoke.io',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh9S',
  'driver',
  '+254700000002',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Vehicles for Org B
INSERT INTO vehicles (id, org_id, registration_number, make, model, status, assigned_driver_id, created_at, updated_at)
VALUES
  ('bbbbbbbb-0010-4000-b000-000000000001', 'bbbbbbbb-0000-4000-b000-000000000001', 'KBB 001B', 'Toyota', 'Hilux', 'idle', 'bbbbbbbb-0002-4000-b000-000000000001', NOW(), NOW()),
  ('bbbbbbbb-0011-4000-b000-000000000001', 'bbbbbbbb-0000-4000-b000-000000000001', 'KBB 002B', 'Mitsubishi', 'Fuso', 'idle', NULL, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Convoy for Org B
INSERT INTO convoys (id, org_id, name, status, start_date, end_date, timezone, created_by, created_at, updated_at)
VALUES (
  'bbbbbbbb-0020-4000-b000-000000000001',
  'bbbbbbbb-0000-4000-b000-000000000001',
  'Beta Convoy',
  'active',
  CURRENT_DATE,
  CURRENT_DATE + 7,
  'Africa/Nairobi',
  'bbbbbbbb-0001-4000-b000-000000000001',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Fuel entry for Org B
INSERT INTO fuel_entries (id, org_id, vehicle_id, driver_id, source, litres, currency, idempotency_key, created_at, updated_at)
VALUES (
  'bbbbbbbb-0030-4000-b000-000000000001',
  'bbbbbbbb-0000-4000-b000-000000000001',
  'bbbbbbbb-0010-4000-b000-000000000001',
  'bbbbbbbb-0002-4000-b000-000000000001',
  'manual',
  48.0,
  'KES',
  'seed-fuel-org-b-001',
  NOW(), NOW()
) ON CONFLICT (idempotency_key) DO NOTHING;

-- Shift for Org B
INSERT INTO shifts (id, org_id, driver_id, vehicle_id, role, status, start_time, end_time, created_by, created_at, updated_at)
VALUES (
  'bbbbbbbb-0040-4000-b000-000000000001',
  'bbbbbbbb-0000-4000-b000-000000000001',
  'bbbbbbbb-0002-4000-b000-000000000001',
  'bbbbbbbb-0010-4000-b000-000000000001',
  'driver',
  'active',
  NOW() - INTERVAL '1 hour',
  NOW() + INTERVAL '11 hours',
  'bbbbbbbb-0001-4000-b000-000000000001',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- Insurance claim for Org B (draft)
INSERT INTO insurance_claims (id, org_id, status, currency, created_by, updated_by, created_at, updated_at)
VALUES (
  'bbbbbbbb-0050-4000-b000-000000000001',
  'bbbbbbbb-0000-4000-b000-000000000001',
  'draft',
  'KES',
  'bbbbbbbb-0001-4000-b000-000000000001',
  'bbbbbbbb-0001-4000-b000-000000000001',
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ─── Print resource IDs for smoke report ─────────────────────────────────────
SELECT 'ORG_A_ID'           AS var, 'aaaaaaaa-0000-4000-a000-000000000001' AS value
UNION ALL SELECT 'ORG_B_ID',          'bbbbbbbb-0000-4000-b000-000000000001'
UNION ALL SELECT 'ORG_A_DRIVER_ID',   'aaaaaaaa-0002-4000-a000-000000000001'
UNION ALL SELECT 'ORG_B_DRIVER_ID',   'bbbbbbbb-0002-4000-b000-000000000001'
UNION ALL SELECT 'ORG_A_VEHICLE_ID',  'aaaaaaaa-0010-4000-a000-000000000001'
UNION ALL SELECT 'ORG_B_VEHICLE_ID',  'bbbbbbbb-0010-4000-b000-000000000001'
UNION ALL SELECT 'ORG_A_CONVOY_ID',   'aaaaaaaa-0020-4000-a000-000000000001'
UNION ALL SELECT 'ORG_B_CONVOY_ID',   'bbbbbbbb-0020-4000-b000-000000000001'
UNION ALL SELECT 'ORG_A_FUEL_ID',     'aaaaaaaa-0030-4000-a000-000000000001'
UNION ALL SELECT 'ORG_B_FUEL_ID',     'bbbbbbbb-0030-4000-b000-000000000001'
UNION ALL SELECT 'ORG_A_SHIFT_ID',    'aaaaaaaa-0040-4000-a000-000000000001'
UNION ALL SELECT 'ORG_B_SHIFT_ID',    'bbbbbbbb-0040-4000-b000-000000000001'
UNION ALL SELECT 'ORG_A_CLAIM_ID',    'aaaaaaaa-0050-4000-a000-000000000001'
UNION ALL SELECT 'ORG_B_CLAIM_ID',    'bbbbbbbb-0050-4000-b000-000000000001'
ORDER BY var;
