-- Drop the stale users_role_cfo_check so handover_officer and response_crew
-- accounts can actually be created.
--
-- Two CHECK constraints sit on users.role, and Postgres ANDs them:
--
--   users_role_cfo_check (077) admin,dispatcher,operator,analyst,cfo,
--                              yard_agent,port_agent
--   users_role_check     (083) ... the same seven, plus response_crew
--                              and handover_officer
--
-- 082 and 083 each meant to widen the constraint, and each did
-- "DROP CONSTRAINT IF EXISTS users_role_check" before adding their own. But
-- 077 had already renamed the live constraint to users_role_cfo_check, so that
-- DROP matched nothing and the narrow one survived alongside the wide one. The
-- intersection is the narrow set, so every INSERT of response_crew or
-- handover_officer has been rejected since 082 — verified against a database
-- with all 86 migrations applied.
--
-- That is not academic: 086 and the handover PIN routes gate every endpoint on
-- role = 'handover_officer', a row that cannot exist, and the Settings screen
-- that creates these officers 500s.
--
-- Dropping the narrow constraint loosens nothing beyond the two roles 082 and
-- 083 intended to add: users_role_check is a strict superset of
-- users_role_cfo_check, so it keeps rejecting every value the narrow one did.
-- Validation still happens; it just happens once, under the name the last two
-- migrations were aiming at.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_cfo_check;

-- Re-assert the intended constraint rather than trusting 083 to have run: if a
-- database somehow lacks it, this migration must not leave users.role
-- unconstrained. Same drop-and-recreate shape 082 and 083 use.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','dispatcher','operator','analyst','cfo','yard_agent','port_agent','response_crew','handover_officer'));

COMMIT;
