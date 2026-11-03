-- Sonalit Hybrid Tracking — server-side acceptance verification (spec §41).
--
-- The device harness (tracking-acceptance.sh) captures what the phone was doing.
-- These queries decide whether it actually reached us. Run each against the
-- operational database with :session set to the session under test, e.g.
--   psql "$DATABASE_URL" -v session="'<uuid>'" -f scripts/tracking-acceptance.sql
--
-- §14 is explicit that the Android notification is NOT evidence. Rows are.

\set ON_ERROR_STOP on

-- ── Test A — activation reached LIVE through a real fix, not through a claim ──
-- first_location_at must EXIST and post-date started_at. A session that is
-- 'active' with a null first_location_at is the fabricated-LIVE failure (§37).
SELECT 'A: first-fix gate' AS test,
       status,
       started_at,
       first_location_at,
       (first_location_at IS NOT NULL) AS gate_passed,
       runtime, platform, background_status,
       location_count, buffered_count, anomaly_count
  FROM tracking_sessions
 WHERE id = :session;

-- ── Tests B/C/E — continuity while locked / switched away / dozing ───────────
-- Any gap longer than the LIVE threshold (90s) during a window when the device
-- was moving is a continuity failure. Report gaps; do not average them away.
SELECT 'B/C/E: continuity' AS test,
       device_time,
       server_time,
       ROUND(EXTRACT(EPOCH FROM (device_time - LAG(device_time)
             OVER (ORDER BY device_time)))::numeric, 1) AS gap_seconds,
       quality, buffered, source
  FROM tracking_locations
 WHERE session_id = :session
 ORDER BY device_time;

SELECT 'B/C/E: worst gap' AS test,
       MAX(gap)::int AS worst_gap_seconds,
       (MAX(gap) <= 90) AS within_live_threshold
  FROM (SELECT EXTRACT(EPOCH FROM (device_time - LAG(device_time)
               OVER (ORDER BY device_time))) AS gap
          FROM tracking_locations
         WHERE session_id = :session AND quality <> 'rejected') g;

-- ── Test D — offline buffering, batch sync, deduplication ────────────────────
-- buffered rows must exist, must keep their ORIGINAL device_time (well before
-- server_time), and must not duplicate. The unique index makes replay a no-op;
-- this proves it held.
SELECT 'D: buffered points' AS test,
       COUNT(*) FILTER (WHERE buffered)                       AS buffered_rows,
       COUNT(*) FILTER (WHERE NOT buffered)                   AS live_rows,
       MAX(EXTRACT(EPOCH FROM (server_time - device_time)))::int AS max_delivery_lag_seconds
  FROM tracking_locations
 WHERE session_id = :session;

SELECT 'D: duplicates (must be 0 rows)' AS test,
       source, device_time, COUNT(*) AS n
  FROM tracking_locations
 WHERE session_id = :session
 GROUP BY source, device_time
HAVING COUNT(*) > 1;

-- ── §19/§23 — anomalies were recorded, not silently dropped ──────────────────
SELECT '§23: anomalies' AS test, quality, anomaly_reason, COUNT(*) AS n
  FROM tracking_locations
 WHERE session_id = :session AND quality <> 'good'
 GROUP BY quality, anomaly_reason
 ORDER BY n DESC;

-- ── Test F — journey completion terminated the session server-side ───────────
SELECT 'F: termination' AS test,
       status, ended_at, termination_reason, termination_policy,
       (status NOT IN ('awaiting_location','active','paused','signal_lost')) AS terminated
  FROM tracking_sessions
 WHERE id = :session;

-- No telemetry may land AFTER the journey ended (§12 — no zombie trackers).
SELECT 'F: post-termination fixes (must be 0)' AS test, COUNT(*) AS n
  FROM tracking_locations l
  JOIN tracking_sessions s ON s.id = l.session_id
 WHERE s.id = :session AND s.ended_at IS NOT NULL AND l.server_time > s.ended_at;

-- ── Test G — QR replay denied ────────────────────────────────────────────────
-- The QR must be consumed, and the partial unique index must have prevented any
-- second live session from ever existing for it.
SELECT 'G: qr replay' AS test,
       q.status AS qr_status, q.consumed_at, q.scan_attempts,
       COUNT(s2.id) AS sessions_for_qr,
       COUNT(s2.id) FILTER (WHERE s2.status IN
            ('awaiting_location','active','paused','signal_lost')) AS live_sessions
  FROM tracking_qr_codes q
  LEFT JOIN tracking_sessions s2 ON s2.qr_code_id = q.id
 WHERE q.id = (SELECT qr_code_id FROM tracking_sessions WHERE id = :session)
 GROUP BY q.status, q.consumed_at, q.scan_attempts;

-- ── Audit trail — the operational story of this journey ──────────────────────
SELECT 'audit' AS test, created_at, event_type, actor_type, payload
  FROM tracking_events
 WHERE session_id = :session
 ORDER BY created_at;
