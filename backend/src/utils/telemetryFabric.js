/**
 * Telemetry fabric — source registry, per-source health, conflicts, decisions.
 *
 * THE PRINCIPLE THIS FILE ENCODES
 * No source is required. SecuriSat is the intended primary because a lock on
 * the container is better evidence than a phone in a cab, but "primary" means
 * it wins reconciliation when present and fresh — not that the fabric waits for
 * it. A journey tracked only by a driver's phone is a real journey with lower
 * confidence, not an error state, and it must keep working while SecuriSat is
 * unintegrated, offline, or simply not fitted to that container.
 *
 * So every source enters through one path. guardian_gps authenticates with its
 * session token; machine sources authenticate with an ingest key. After that
 * boundary they are indistinguishable: same evidence table, same idempotency,
 * same health accounting, same reconciliation. Adding SecuriSat later is a
 * credential row and a flag, not a new pipeline — and nothing about how the
 * fabric degrades has to be redesigned when it arrives.
 *
 * WHAT LIVES HERE vs trackingEngine.js
 *   trackingEngine  the primitives: reconcile(), computeHealth(),
 *                   computeConfidence(), validateFix(). Pure, unit-tested,
 *                   unchanged by this file.
 *   telemetryFabric the bookkeeping those primitives never had a home for:
 *                   which source is healthy, what disagreed, and why the
 *                   canonical position is what it is.
 */

const crypto = require('crypto');
const T = require('./trackingEngine');

/** Bump when a rule below changes what a decision would be. Stored on every
 *  decision row so an old conclusion stays explainable under new rules. */
const ALGORITHM_VERSION = 'fabric-v1';

/* ─── Source registry ─────────────────────────────────────────────────────── */

/**
 * The declared sources.
 *
 * `integrated` is deliberately NOT what decides whether the fabric functions.
 * It records whether an adapter exists yet, so operations can tell "we have no
 * connection to this" apart from "this connection went quiet" — two facts that
 * look identical in a health field and mean completely different things.
 *
 * `priority` only orders sources that are BOTH present and fresh. reconcile()
 * already lets a fresh low-priority source beat a stale high-priority one, so
 * a dead e-lock cannot outrank a live phone.
 */
const SOURCES = {
  guardian_gps: {
    id: 'guardian_gps',
    label: 'Driver device',
    priority: T.SOURCE_PRIORITY.guardian_gps,
    auth: 'session',              // the driver's own tracking session token
    integrated: true,
    evidence: 'position',
  },
  device_telematics: {
    id: 'device_telematics',
    label: 'Vehicle telematics',
    priority: T.SOURCE_PRIORITY.device_telematics,
    auth: 'ingest_key',
    integrated: true,             // the door is open; a key is all a provider needs
    evidence: 'position',
  },
  securisat_elock: {
    id: 'securisat_elock',
    label: 'SecuriSat e-lock',
    priority: T.SOURCE_PRIORITY.securisat_elock,
    auth: 'ingest_key',
    // Reads false until credentials exist. The ingestion path is already the
    // same one device_telematics uses — this flag gates reporting, not code.
    integrated: false,
    // An e-lock is not merely another GPS: its custody state is evidence in a
    // way a coordinate is not (§14).
    evidence: 'position+custody',
  },
};

const INGESTABLE = Object.values(SOURCES).filter(s => s.auth === 'ingest_key').map(s => s.id);

function sourceMeta(id) {
  return SOURCES[id] || null;
}

/* ─── Per-source health ───────────────────────────────────────────────────── */

/**
 * Derive a source's state from its own freshness and transport record.
 *
 * Freshness reuses trackingEngine.computeHealth so one definition of "live"
 * governs the whole system. The rest is what a single fix cannot express:
 * a source delivering every point 90 seconds late is not the same as one
 * silently dropping half of them, and only the second is losing evidence.
 *
 * Returns a state from the §5 enum. 'unavailable' is reserved for a source
 * with no adapter — never for one that merely stopped talking, because
 * conflating those two would make an unintegrated provider look broken and a
 * broken one look unintegrated.
 */
function deriveSourceState(row, now = Date.now()) {
  const meta = sourceMeta(row.source);
  if (meta && !meta.integrated) return { state: 'unavailable', reason: 'no adapter configured' };
  if (row.revoked_at) return { state: 'revoked', reason: row.state_reason || 'credential revoked' };
  if (!row.last_event_at) return { state: 'initializing', reason: 'no events yet' };

  // computeHealth reasons about a SESSION, so a source row is adapted into that
  // shape rather than duplicating the thresholds here. One definition of "live"
  // has to govern the whole system: two would drift, and the day they disagree
  // is the day the dashboard and the health engine tell different stories.
  const health = T.computeHealth(
    { status: 'active', first_location_at: row.first_event_at || row.last_event_at,
      last_location_at: row.last_event_at },
    now
  );

  // A source that is delivering again after a gap is 'recovering', not
  // 'healthy': operations should see that the gap happened, and the backlog
  // may still be draining.
  if (health === 'live' && row.sequence_gaps > 0) {
    return { state: 'recovering', reason: `${row.sequence_gaps} sequence gap(s)` };
  }
  if (health === 'live') {
    const received = Number(row.events_received || 0);
    const rejected = Number(row.events_rejected || 0);
    // Arriving but mostly unusable is degraded, not healthy. Requiring a
    // meaningful sample first stops one bad fix out of three from tripping it.
    if (received >= 10 && rejected / received > 0.2) {
      return { state: 'degraded', reason: `${Math.round((rejected / received) * 100)}% rejected` };
    }
    return { state: 'healthy', reason: null };
  }
  if (health === 'delayed')     return { state: 'degraded', reason: 'events arriving late' };
  if (health === 'signal_lost') return { state: 'stale',    reason: 'no events recently' };
  return { state: 'offline', reason: 'no events' };
}

/**
 * Record that a source reported, and update what we know about its health.
 *
 * Upsert rather than insert: one row per (session, source, device) for the life
 * of the journey, so a source's history is continuous across reconnects. A
 * reconnecting device must not fork its own health record.
 */
async function recordSourceActivity(db, orgId, {
  sessionId, source, externalSourceId = null,
  received = 0, accepted = 0, rejected = 0, duplicate = 0,
  latencyMs = null, highestSequence = null, sequenceGaps = 0, clockOffsetMs = null,
}) {
  const result = await db(
    `INSERT INTO telemetry_sources
       (org_id, session_id, source, external_source_id, state,
        first_event_at, last_event_at, last_accepted_at,
        events_received, events_accepted, events_rejected, events_duplicate,
        latency_ms_max, highest_sequence, sequence_gaps, clock_offset_ms, clock_samples)
     VALUES ($1,$2,$3,$4,'initializing',
             NOW(), NOW(), CASE WHEN $6 > 0 THEN NOW() END,
             $5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $12 IS NULL THEN 0 ELSE 1 END)
     ON CONFLICT (session_id, source, external_source_id) DO UPDATE SET
       last_event_at    = NOW(),
       last_accepted_at = CASE WHEN $6 > 0 THEN NOW() ELSE telemetry_sources.last_accepted_at END,
       events_received  = telemetry_sources.events_received  + $5,
       events_accepted  = telemetry_sources.events_accepted  + $6,
       events_rejected  = telemetry_sources.events_rejected  + $7,
       events_duplicate = telemetry_sources.events_duplicate + $8,
       latency_ms_max   = GREATEST(COALESCE(telemetry_sources.latency_ms_max, 0), COALESCE($9, 0)),
       highest_sequence = GREATEST(COALESCE(telemetry_sources.highest_sequence, 0), COALESCE($10, 0)),
       sequence_gaps    = telemetry_sources.sequence_gaps + $11,
       -- Rolling mean, so one wild sample cannot swing the estimate.
       clock_offset_ms  = CASE WHEN $12 IS NULL THEN telemetry_sources.clock_offset_ms
                          ELSE ((COALESCE(telemetry_sources.clock_offset_ms, 0)
                                 * telemetry_sources.clock_samples) + $12)
                               / (telemetry_sources.clock_samples + 1) END,
       clock_samples    = telemetry_sources.clock_samples + CASE WHEN $12 IS NULL THEN 0 ELSE 1 END,
       updated_at       = NOW()
     RETURNING *`,
    [orgId, sessionId, source, externalSourceId,
     received, accepted, rejected, duplicate,
     latencyMs, highestSequence, sequenceGaps, clockOffsetMs]
  );

  const row = result.rows[0];
  const { state, reason } = deriveSourceState(row);
  if (state !== row.state || reason !== row.state_reason) {
    await db(
      `UPDATE telemetry_sources SET state=$1, state_reason=$2, updated_at=NOW() WHERE id=$3`,
      [state, reason, row.id]
    );
  }
  return { ...row, state, state_reason: reason };
}

/** Every source on a journey, with state derived fresh rather than trusted. */
async function sourcesForSession(db, sessionId, now = Date.now()) {
  const result = await db(
    `SELECT * FROM telemetry_sources WHERE session_id = $1 AND deleted_at IS NULL
      ORDER BY source`,
    [sessionId]
  );
  return result.rows.map(r => {
    const { state, reason } = deriveSourceState(r, now);
    return { ...r, state, state_reason: reason };
  });
}

/* ─── Conflicts ───────────────────────────────────────────────────────────── */

/**
 * Record a disagreement so it outlives the score that noticed it.
 *
 * Deduplicated on (session, kind, open): one open finding per kind per journey.
 * A truck 25km from where its e-lock claims to be is one conflict that persists,
 * not a new one every fifteen seconds — an alert that repeats itself into noise
 * gets muted, and a muted alert protects nobody.
 */
async function recordConflict(db, orgId, {
  sessionId, kind, severity = 'warning', detail = null,
  metricName = null, metricValue = null, thresholdValue = null,
  evidenceIds = [], sourcesInvolved = [],
}) {
  const existing = await db(
    `SELECT id FROM telemetry_conflicts
      WHERE session_id = $1 AND kind = $2 AND status = 'open' AND deleted_at IS NULL
      LIMIT 1`,
    [sessionId, kind]
  );
  if (existing.rows.length) {
    await db(
      `UPDATE telemetry_conflicts
          SET metric_value = COALESCE($2, metric_value),
              detail       = COALESCE($3, detail),
              evidence_location_ids =
                (SELECT ARRAY(SELECT DISTINCT unnest(evidence_location_ids || $4::bigint[]))),
              updated_at   = NOW()
        WHERE id = $1`,
      [existing.rows[0].id, metricValue, detail, evidenceIds]
    );
    return { ...existing.rows[0], reopened: false };
  }

  const inserted = await db(
    `INSERT INTO telemetry_conflicts
       (org_id, session_id, kind, severity, detail, metric_name, metric_value,
        threshold_value, evidence_location_ids, sources_involved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [orgId, sessionId, kind, severity, detail, metricName, metricValue,
     thresholdValue, evidenceIds, sourcesInvolved]
  );
  return inserted.rows[0];
}

/** Close a conflict the evidence has answered. Never auto-closed to tidy a
 *  dashboard — only when something actually resolved it. */
async function resolveConflict(db, conflictId, resolution) {
  await db(
    `UPDATE telemetry_conflicts
        SET status='resolved', resolved_at=NOW(), resolution=$2, updated_at=NOW()
      WHERE id=$1 AND status='open'`,
    [conflictId, resolution]
  );
}

/* ─── Reconciliation decisions ────────────────────────────────────────────── */

/**
 * Persist a derived conclusion with the evidence on BOTH sides.
 *
 * A decision that records only its winner cannot be audited, only believed.
 * Storing what was rejected is what makes "why did Sonalit conclude this?"
 * answerable months later by someone who was not there.
 *
 * Supersedes rather than overwrites: late evidence (§17) revises the
 * conclusion, and the revision itself stays inspectable.
 */
async function recordDecision(db, orgId, {
  sessionId, subject, decision, certainty = 'unknown', confidence = null,
  chosenSource = null, supporting = [], contradicting = [],
  conflictId = null, inputs = {}, occurredAt = null,
}) {
  const prior = await db(
    `SELECT id FROM reconciliation_decisions
      WHERE session_id = $1 AND subject = $2 AND superseded_by IS NULL AND deleted_at IS NULL
      ORDER BY generated_at DESC LIMIT 1`,
    [sessionId, subject]
  );

  const inserted = await db(
    `INSERT INTO reconciliation_decisions
       (org_id, session_id, subject, decision, certainty, confidence, chosen_source,
        supporting_evidence, contradicting_evidence, conflict_id,
        algorithm_version, inputs, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [orgId, sessionId, subject, decision, certainty, confidence, chosenSource,
     supporting, contradicting, conflictId, ALGORITHM_VERSION,
     JSON.stringify(inputs), occurredAt]
  );

  if (prior.rows.length) {
    await db(`UPDATE reconciliation_decisions SET superseded_by=$2 WHERE id=$1`,
      [prior.rows[0].id, inserted.rows[0].id]);
  }
  return inserted.rows[0];
}

/* ─── Journey health summary (§32) ────────────────────────────────────────── */

/**
 * The operations-facing picture, and the §33 degradation level behind it.
 *
 * The distinction that matters most here is LEVEL 5 versus "stationary".
 * A vehicle parked with a healthy source reporting is Level 0 and perfectly
 * fine. A vehicle with nothing reporting is Level 5 — we do not know where it
 * is — and those must never render the same way. Everything else in this
 * function is in service of keeping them apart.
 */
async function journeyHealth(db, sessionId, now = Date.now()) {
  const sources = await sourcesForSession(db, sessionId, now);
  const conflicts = await db(
    `SELECT id, kind, severity, detail, metric_value, detected_at
       FROM telemetry_conflicts
      WHERE session_id=$1 AND status='open' AND deleted_at IS NULL
      ORDER BY detected_at DESC`,
    [sessionId]
  );

  const usable = sources.filter(s => ['healthy', 'recovering'].includes(s.state));
  const degraded = sources.filter(s => s.state === 'degraded');
  const configured = sources.filter(s => s.state !== 'unavailable');

  let level, label;
  if (usable.length >= 2)                      { level = 0; label = 'full'; }
  else if (usable.length === 1 && configured.length > 1) { level = 1; label = 'redundant'; }
  else if (usable.length === 1)                { level = 2; label = 'degraded'; }
  else if (degraded.length > 0)                { level = 3; label = 'store_and_forward'; }
  else if (configured.length > 0)              { level = 4; label = 'evidence_only'; }
  else                                         { level = 5; label = 'unknown'; }

  return {
    degradation_level: level,
    degradation: label,
    // Never inferred from silence: with no usable source we say we do not know,
    // rather than implying the vehicle is stationary.
    position_known: usable.length > 0,
    sources: sources.map(s => ({
      source: s.source,
      label: sourceMeta(s.source)?.label ?? s.source,
      state: s.state,
      reason: s.state_reason,
      last_event_at: s.last_event_at,
      events_accepted: Number(s.events_accepted || 0),
      events_rejected: Number(s.events_rejected || 0),
      sequence_gaps: s.sequence_gaps,
      clock_offset_ms: s.clock_offset_ms,
    })),
    open_conflicts: conflicts.rows,
    algorithm_version: ALGORITHM_VERSION,
  };
}

/* ─── Ingest credentials ──────────────────────────────────────────────────── */

function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }

/**
 * Resolve an ingest key to its org and source.
 *
 * The tenant comes from the credential and nowhere else. A machine caller has
 * no session to infer it from, so accepting an org from the request body would
 * make cross-tenant injection a matter of typing a different UUID.
 */
async function resolveIngestKey(query, rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const result = await query(
    `SELECT * FROM telemetry_ingest_keys
      WHERE key_hash = $1 AND status = 'active' AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [sha256(rawKey)]
  );
  return result.rows[0] || null;
}

module.exports = {
  ALGORITHM_VERSION, SOURCES, INGESTABLE, sourceMeta,
  deriveSourceState, recordSourceActivity, sourcesForSession,
  recordConflict, resolveConflict,
  recordDecision,
  journeyHealth,
  sha256, resolveIngestKey,
};
