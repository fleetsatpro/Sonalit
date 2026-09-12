-- Alerts and Incidents were two independent, half-finished features that the
-- product already treats as one concept everywhere except the internal
-- operator UI (the customer-facing portal literally serves `alerts` rows
-- back to clients labeled "incidents" — see routes/portalSecurity.js).
-- Merging the two pages into one feed needs incidents to actually support
-- what its own frontend already assumed it could: notes and an assignee
-- (neither column existed — every "Save Notes" / assignee display was a
-- no-op), a link back to the alert that triggered it (for the new
-- "Promote to Incident" action), and a soft-delete column to match alerts.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS type VARCHAR(100);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS source_alert_id UUID REFERENCES alerts(id);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The dashboard's IncidentLog widget already ships an "Escalate" button that
-- PATCHes status to 'escalated' — a value this CHECK constraint has never
-- allowed, so that button has always thrown a DB error. The frontend TS
-- types across Incidents.tsx/IncidentCenter.tsx also already declare
-- 'closed' as a status the UI expects to exist. Widen the constraint to
-- match what the UI already assumes rather than leaving both silently broken.
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_status_check
  CHECK (status IN ('open', 'investigating', 'escalated', 'resolved', 'closed'));
