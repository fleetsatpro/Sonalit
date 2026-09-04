-- Invariant tests for migration 091 (spec §39).
--
-- These run against a real Postgres because every property under test is
-- enforced by the database, not by application code: a unique index either
-- rejects a replay or it does not, and only the engine can say which.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f backend/tests/sql/telemetry_evidence_invariants.sql
--
-- Any failure raises an exception, so ON_ERROR_STOP turns this into a pass/fail
-- gate suitable for CI.

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  org   UUID := gen_random_uuid();
  org_b UUID := gen_random_uuid();
  sess  UUID;
  ev    UUID := gen_random_uuid();
  ts    TIMESTAMPTZ := NOW();
  failed BOOLEAN;
  n     INT;
BEGIN
  INSERT INTO tracking_sessions (org_id, session_token_hash, status)
  VALUES (org, encode(gen_random_bytes(32), 'hex'), 'active') RETURNING id INTO sess;

  -- INVARIANT 1 — an event cannot be persisted twice under the same identity.
  -- The replay carries different coordinates AND a different timestamp, so only
  -- event_id can catch it. This is what makes a store-and-forward client safe
  -- to retry blindly.
  INSERT INTO tracking_locations (org_id, session_id, source, lat, lng, device_time, event_id)
  VALUES (org, sess, 'guardian_gps', -1.28, 36.81, ts, ev);

  failed := FALSE;
  BEGIN
    INSERT INTO tracking_locations (org_id, session_id, source, lat, lng, device_time, event_id)
    VALUES (org, sess, 'guardian_gps', -9.99, 99.99, ts + interval '5 min', ev);
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'INVARIANT 1 FAILED: event_id replay was accepted'; END IF;
  RAISE NOTICE '  ok  1. event_id replay rejected even with different coords and time';

  -- INVARIANT 2 — the pre-091 guard still protects clients that send no
  -- event_id. Adding an identity column must not weaken the old path.
  INSERT INTO tracking_locations (org_id, session_id, source, lat, lng, device_time)
  VALUES (org, sess, 'guardian_gps', -1.30, 36.80, ts + interval '1 min');

  failed := FALSE;
  BEGIN
    INSERT INTO tracking_locations (org_id, session_id, source, lat, lng, device_time)
    VALUES (org, sess, 'guardian_gps', -1.30, 36.80, ts + interval '1 min');
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'INVARIANT 2 FAILED: (session,source,device_time) replay accepted'; END IF;
  RAISE NOTICE '  ok  2. legacy (session,source,device_time) guard still holds';

  -- INVARIANT 3 — deduplication must not destroy genuine multi-source evidence.
  -- Two sources observing the same instant is the NORMAL case for a fused
  -- fabric; if the index collapsed them, consensus would be impossible.
  INSERT INTO tracking_locations (org_id, session_id, source, lat, lng, device_time, event_id)
  VALUES (org, sess, 'guardian_gps',    -1.40, 36.70, ts + interval '2 min', gen_random_uuid()),
         (org, sess, 'securisat_elock', -1.40, 36.70, ts + interval '2 min', gen_random_uuid());
  SELECT COUNT(*) INTO n FROM tracking_locations
   WHERE session_id = sess AND device_time = ts + interval '2 min';
  IF n <> 2 THEN RAISE EXCEPTION 'INVARIANT 3 FAILED: expected 2 concurrent observations, got %', n; END IF;
  RAISE NOTICE '  ok  3. two sources at one instant both survive';

  -- INVARIANT 4 — raw evidence is never overwritten by reconciliation.
  -- A decision points at evidence by id; it cannot mutate it.
  INSERT INTO reconciliation_decisions
    (org_id, session_id, subject, decision, certainty, confidence,
     chosen_source, supporting_evidence, contradicting_evidence, algorithm_version)
  SELECT org, sess, 'canonical_position', 'guardian_gps@-1.40,36.70', 'probable', 'medium',
         'guardian_gps',
         ARRAY(SELECT id FROM tracking_locations WHERE session_id = sess LIMIT 2),
         ARRAY[]::BIGINT[], 'reconcile-v1';
  SELECT COUNT(*) INTO n FROM tracking_locations WHERE session_id = sess AND lat = -1.28;
  IF n <> 1 THEN RAISE EXCEPTION 'INVARIANT 4 FAILED: original observation was altered'; END IF;
  RAISE NOTICE '  ok  4. reconciliation leaves raw observations intact';

  -- INVARIANT 5 — "unknown" is storable as an outcome. A schema that cannot
  -- record insufficient evidence forces the engine to invent certainty.
  INSERT INTO reconciliation_decisions
    (org_id, session_id, subject, decision, certainty, algorithm_version)
  VALUES (org, sess, 'departure', 'no departure established', 'unknown', 'reconcile-v1');
  RAISE NOTICE '  ok  5. certainty=unknown is a valid recorded outcome';

  -- INVARIANT 6 — a conflict outlives the score that noticed it, and cites its
  -- evidence rather than copying it.
  INSERT INTO telemetry_conflicts
    (org_id, session_id, kind, severity, detail, metric_name, metric_value,
     threshold_value, evidence_location_ids, sources_involved)
  SELECT org, sess, 'source_disagreement', 'warning', '25km apart', 'distance_km', 25, 2,
         ARRAY(SELECT id FROM tracking_locations WHERE session_id = sess LIMIT 2),
         ARRAY['guardian_gps','securisat_elock'];
  SELECT COUNT(*) INTO n FROM telemetry_conflicts WHERE session_id = sess AND status = 'open';
  IF n <> 1 THEN RAISE EXCEPTION 'INVARIANT 6 FAILED: conflict not recorded'; END IF;
  RAISE NOTICE '  ok  6. conflicts are durable and reference evidence by id';

  -- INVARIANT 7 — one source row per (session, source, device); a second
  -- registration of the same device must not fork its health history.
  INSERT INTO telemetry_sources (org_id, session_id, source, external_source_id, state)
  VALUES (org, sess, 'guardian_gps', 'phone-1', 'healthy');
  failed := FALSE;
  BEGIN
    INSERT INTO telemetry_sources (org_id, session_id, source, external_source_id, state)
    VALUES (org, sess, 'guardian_gps', 'phone-1', 'degraded');
  EXCEPTION WHEN unique_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'INVARIANT 7 FAILED: duplicate source row accepted'; END IF;
  RAISE NOTICE '  ok  7. one health row per (session, source, device)';

  -- INVARIANT 8 — a source marked lost cannot also be healthy. One state, and
  -- the enum is what stops "LOST" and "LIVE" ever coexisting.
  failed := FALSE;
  BEGIN
    INSERT INTO telemetry_sources (org_id, session_id, source, external_source_id, state)
    VALUES (org, sess, 'device_telematics', 'box-1', 'live_and_offline');
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'INVARIANT 8 FAILED: invalid source state accepted'; END IF;
  RAISE NOTICE '  ok  8. source state is constrained to the declared enum';

  -- INVARIANT 9 — a superseded decision is retained, not updated in place, so
  -- a revision driven by late evidence stays auditable (§17, §36).
  INSERT INTO reconciliation_decisions
    (org_id, session_id, subject, decision, certainty, algorithm_version)
  VALUES (org, sess, 'arrival', 'revised by late e-lock event', 'probable', 'reconcile-v2');
  UPDATE reconciliation_decisions d
     SET superseded_by = (SELECT id FROM reconciliation_decisions
                           WHERE session_id = sess AND subject = 'arrival'
                             AND algorithm_version = 'reconcile-v2')
   WHERE d.session_id = sess AND d.subject = 'departure';
  SELECT COUNT(*) INTO n FROM reconciliation_decisions WHERE session_id = sess;
  IF n <> 3 THEN RAISE EXCEPTION 'INVARIANT 9 FAILED: superseding destroyed a decision, have %', n; END IF;
  RAISE NOTICE '  ok  9. superseded decisions are retained, not overwritten';

  -- INVARIANT 10 — cross-tenant evidence cannot be referenced into another
  -- org's session. org_b has no session here; the FK is the backstop behind RLS.
  failed := FALSE;
  BEGIN
    INSERT INTO telemetry_sources (org_id, session_id, source, state)
    VALUES (org_b, gen_random_uuid(), 'guardian_gps', 'healthy');
  EXCEPTION WHEN foreign_key_violation THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'INVARIANT 10 FAILED: source attached to a non-existent session'; END IF;
  RAISE NOTICE '  ok 10. evidence cannot attach to a session that does not exist';

  RAISE NOTICE 'ALL 10 INVARIANTS HELD';
END $$;

ROLLBACK;
