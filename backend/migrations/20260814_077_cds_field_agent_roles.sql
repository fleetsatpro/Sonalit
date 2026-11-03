-- Least-privilege accounts for Yard and Port field crews.
--
-- Until now, /field/yard and /field/port were reachable by any authenticated
-- user of any role — the CDS router (backend/src/routes/cds.js) only checks
-- authenticate(), never authorize(). That means an analyst account (or any
-- other internal login) could clamp e-locks and create trips, and there was
-- no way to hand a yard/port worker an account that does ONLY that. These two
-- roles exist to be handed to shared yard/port devices: scoped to the clamp
-- and unclamp flow, nothing else in CDS.
--
-- Same shape as 015b's users_role_cfo_check: drop and recreate rather than
-- ALTER ... ADD VALUE, since role is a CHECK constraint, not an enum type.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_cfo_check;
ALTER TABLE users ADD CONSTRAINT users_role_cfo_check
  CHECK (role IN ('admin','dispatcher','operator','analyst','cfo','yard_agent','port_agent'));
