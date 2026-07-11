-- guardian_devices.org_id was made nullable in 20260612_045 — devices
-- enrolled via PEGAGENT before a matching field officer/org exists are
-- meant to be accepted, with an admin assigning the org later. But
-- panic_events.org_id (added NOT NULL in 20260521_001_enable_rls.sql) was
-- never relaxed to match, so POST /guardian/panic always violated this
-- constraint for any such device — every panic attempt 400'd, and the
-- Android app's PanicSender.send() silently swallows that as "could not
-- reach dispatch", making the panic button appear completely broken.
ALTER TABLE panic_events ALTER COLUMN org_id DROP NOT NULL;
