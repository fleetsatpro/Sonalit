/**
 * Machine telemetry ingress — /api/v1/ingest
 *
 * The door every non-driver source comes through: vehicle telematics today,
 * SecuriSat the moment credentials exist, any authorized provider after that.
 *
 * WHY THIS IS SEPARATE FROM /track AND /tracking
 *   /track     the driver's own session, opaque session token, no cookies
 *   /tracking  operators, JWT or field device
 *   /ingest    machines, ingest key — no user, no session, no cookie
 *
 * NOT mounted under /api/v1/telemetry: that prefix already carries a legacy
 * compatibility shim for Guardian Android builds that predate the canonical
 * /guardian/location/batch route. Two routers on one prefix resolve by mount
 * order, which is a subtle dependency to leave behind for whoever edits this
 * next.
 *
 * Three callers with three different notions of "who is this", so three
 * boundaries. Sharing one would mean one auth path that has to be all things,
 * and the failure mode of that is a telematics box authenticated as an operator.
 *
 * THE TENANT COMES FROM THE CREDENTIAL. A machine caller has no session to
 * infer an organisation from, so an org in the request body would make
 * cross-tenant injection a matter of typing a different UUID (§35). The key
 * carries org and source; the body carries observations and nothing else that
 * matters. A payload claiming a different org than its key is not an error to
 * correct — it is discarded.
 *
 * SecuriSat is NOT a precondition for any of this. The fabric must degrade to
 * whatever sources exist, so this endpoint works with one provider, three, or
 * none. When SecuriSat arrives it is a credential row and a flag.
 */

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');
const T = require('../utils/trackingEngine');
const F = require('../utils/telemetryFabric');

/** Machine callers batch, so the ceiling is higher than the driver path — but
 *  it is still a ceiling, and it REJECTS rather than truncating: a silently
 *  trimmed batch is telemetry lost at the moment it was being recovered. */
const MAX_EVENTS_PER_REQUEST = 500;

const ingestLimiter = rateLimit({
  windowMs: 60_000,
  max: 240,                       // a 5s reporting interval with headroom
  standardHeaders: true,
  legacyHeaders: false,
  // Per credential, not per IP: providers sit behind shared egress, and one
  // busy fleet must not throttle another tenant's trucks.
  keyGenerator: (req) => req.get('X-Telemetry-Key') || req.ip,
});

/**
 * Authenticate the machine caller and pin the tenant.
 *
 * Deliberately uniform failures. A caller learning the difference between
 * "no such key" and "key exists but wrong source" learns something about
 * credentials it does not hold.
 */
const ingestAuth = asyncHandler(async (req, res, next) => {
  const raw = req.get('X-Telemetry-Key');
  const key = await F.resolveIngestKey(query, raw);
  if (!key) return res.status(401).json({ error: 'unauthorized' });

  const source = req.params.source;
  if (!F.INGESTABLE.includes(source)) {
    return res.status(404).json({ error: 'unknown_source' });
  }
  // A telematics credential must never be able to write e-lock evidence: that
  // would let a weaker integration manufacture the stronger source's testimony,
  // which is exactly what the priority ordering assumes cannot happen.
  if (key.source !== source) return res.status(401).json({ error: 'unauthorized' });

  req.ingestKey = key;
  req.orgId = key.org_id;
  req.db = T.dbForOrg(key.org_id);
  next();
});

/**
 * Resolve which journey these observations belong to — server-side, always.
 *
 * A provider knows its own vehicle; it does not get to nominate a session.
 * Accepting a session id from the body would let any valid key attach evidence
 * to any journey in its org, including one belonging to a different truck.
 */
async function resolveSession(db, key, body) {
  const vehicleId = key.vehicle_id || body.vehicle_id || null;
  const tripId = body.trip_id || null;
  if (!vehicleId && !tripId) return { error: 'vehicle_id or trip_id is required' };

  const filters = [];
  const params = [];
  if (tripId)    { params.push(tripId);    filters.push(`trip_id = $${params.length}`); }
  if (vehicleId) { params.push(vehicleId); filters.push(`vehicle_id = $${params.length}`); }

  const result = await db(
    `SELECT * FROM tracking_sessions
      WHERE deleted_at IS NULL AND ${filters.join(' AND ')}
        AND status = ANY($${params.length + 1}::text[])
      ORDER BY started_at DESC LIMIT 1`,
    [...params, T.LIVE_STATUSES]
  );
  if (!result.rows.length) return { error: 'no_active_journey' };
  return { session: result.rows[0] };
}

/**
 * POST /api/v1/ingest/:source/positions
 *
 * Idempotent by client event_id. A provider that retries a batch after a
 * timeout must not double-count: the store-and-forward contract is that
 * resending is always safe, and a client cannot honour that unless the server
 * makes it true.
 */
router.post('/:source/positions', ingestLimiter, ingestAuth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events
    : Array.isArray(body.locations) ? body.locations : [];

  if (!events.length) return res.status(400).json({ error: 'no_events' });
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return res.status(413).json({
      error: 'batch_too_large',
      max: MAX_EVENTS_PER_REQUEST,
      message: `A request may carry at most ${MAX_EVENTS_PER_REQUEST} events.`,
    });
  }

  const { session, error } = await resolveSession(req.db, req.ingestKey, body);
  if (error) return res.status(error === 'no_active_journey' ? 409 : 400).json({ error });

  const source = req.params.source;
  const now = Date.now();
  let accepted = 0, rejected = 0, duplicate = 0, anomalies = 0;
  let highestSeq = null, maxLatency = null, driftSum = 0, driftCount = 0;
  let canonical = null;
  const acceptedIds = [];

  const prevRow = await req.db(
    `SELECT lat, lng, device_time FROM tracking_locations
      WHERE session_id=$1 AND source=$2 AND quality <> 'rejected'
      ORDER BY device_time DESC LIMIT 1`,
    [session.id, source]
  );
  let prev = prevRow.rows[0] || null;

  for (const raw of events) {
    const deviceTime = raw.occurred_at || raw.device_time || null;
    const fix = {
      lat: Number(raw.lat ?? raw.latitude),
      lng: Number(raw.lng ?? raw.longitude),
      accuracy_m: raw.accuracy_m != null ? Number(raw.accuracy_m) : null,
      altitude_m: raw.altitude_m != null ? Number(raw.altitude_m) : null,
      speed_kph: raw.speed_kph != null ? Number(raw.speed_kph) : null,
      heading: raw.heading != null ? Number(raw.heading) : null,
      device_time: deviceTime || new Date().toISOString(),
      battery_level: raw.battery_level != null ? Math.round(Number(raw.battery_level)) : null,
      network_status: raw.network_status || null,
      buffered: !!raw.buffered,
      event_id: raw.event_id || null,
      sequence_number: raw.sequence_number != null ? Number(raw.sequence_number) : null,
    };

    // Clock drift, measured not assumed. Kept per source because two devices on
    // one journey drift independently, and ordering by a wrong clock silently
    // rewrites the journey's history.
    if (deviceTime) {
      const offset = now - new Date(deviceTime).getTime();
      if (Number.isFinite(offset) && Math.abs(offset) < 86_400_000) {
        driftSum += offset; driftCount++;
        if (maxLatency === null || offset > maxLatency) maxLatency = Math.round(offset);
      }
    }

    const verdict = T.validateFix(prev, fix, now);
    if (verdict.quality !== 'good') anomalies++;
    if (verdict.quality === 'rejected') { rejected++; continue; }

    try {
      const ins = await req.db(
        `INSERT INTO tracking_locations
           (org_id, session_id, source, lat, lng, accuracy_m, altitude_m, speed_kph, heading,
            device_time, battery_level, network_status, buffered, quality, anomaly_reason,
            event_id, sequence_number, clock_offset_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [req.orgId, session.id, source, fix.lat, fix.lng, fix.accuracy_m, fix.altitude_m,
         fix.speed_kph, fix.heading, fix.device_time, fix.battery_level, fix.network_status,
         fix.buffered, verdict.quality, verdict.anomaly_reason,
         fix.event_id, fix.sequence_number,
         driftCount ? Math.round(driftSum / driftCount) : null]
      );
      // ON CONFLICT DO NOTHING returns no row for a replay — that IS the
      // idempotency signal, and counting it separately is what lets a provider
      // see its own retries rather than mistaking them for loss.
      if (!ins.rows.length) { duplicate++; continue; }
      acceptedIds.push(ins.rows[0].id);
    } catch (err) {
      rejected++;
      logger.warn(`telemetry ingest: fix rejected for session ${session.id} — ${err.message}`);
      continue;
    }

    accepted++;
    prev = { lat: fix.lat, lng: fix.lng, device_time: fix.device_time };
    if (fix.sequence_number != null && (highestSeq === null || fix.sequence_number > highestSeq)) {
      highestSeq = fix.sequence_number;
    }
    if (!canonical || new Date(fix.device_time) > new Date(canonical.device_time)) {
      canonical = { ...fix, source, quality: verdict.quality };
    }
  }

  // A gap means points were lost in transit even when everything that arrived
  // looks healthy — freshness alone can never reveal that.
  let gaps = 0;
  if (highestSeq !== null) {
    const prior = await req.db(
      `SELECT highest_sequence FROM telemetry_sources
        WHERE session_id=$1 AND source=$2 AND external_source_id IS NOT DISTINCT FROM $3`,
      [session.id, source, req.ingestKey.id]
    );
    const last = prior.rows[0]?.highest_sequence;
    if (last != null && highestSeq > Number(last) + accepted) gaps = 1;
  }

  await F.recordSourceActivity(req.db, req.orgId, {
    sessionId: session.id,
    source,
    externalSourceId: req.ingestKey.id,
    received: events.length, accepted, rejected, duplicate,
    latencyMs: maxLatency, highestSequence: highestSeq, sequenceGaps: gaps,
    clockOffsetMs: driftCount ? Math.round(driftSum / driftCount) : null,
  });

  await query(
    `UPDATE telemetry_ingest_keys
        SET last_used_at=NOW(), events_accepted=events_accepted+$2,
            events_rejected=events_rejected+$3, updated_at=NOW()
      WHERE id=$1`,
    [req.ingestKey.id, accepted, rejected]
  );

  // Fuse across every source on this journey, and record WHY the winner won.
  if (canonical) {
    await fuseAndRecord(req.db, req.orgId, session, now);
  }

  res.json({
    data: {
      accepted, rejected, duplicate, anomalies,
      session_id: session.id,
      accepted_event_ids: acceptedIds.length,
    },
  });
}));

/**
 * Reconcile every source's latest observation into one canonical position,
 * recording the decision, its confidence, and the evidence on both sides.
 *
 * This is where redundancy stops being a diagram. reconcile() already prefers a
 * fresh low-priority source over a stale high-priority one, so a dead e-lock
 * cannot outrank a live phone — and a journey carried by the phone alone simply
 * has one candidate and lower confidence, not an error.
 */
async function fuseAndRecord(db, orgId, session, now) {
  const latest = await db(
    `SELECT DISTINCT ON (source) id, source, lat, lng, accuracy_m, speed_kph, heading,
            altitude_m, device_time, battery_level, network_status
       FROM tracking_locations
      WHERE session_id = $1 AND quality <> 'rejected'
      ORDER BY source, device_time DESC`,
    [session.id]
  );
  if (!latest.rows.length) return null;

  const candidates = latest.rows.map(r => ({ ...r, device_time: r.device_time }));
  const chosen = T.reconcile(candidates, now);
  const ageSec = (now - new Date(chosen.device_time).getTime()) / 1000;

  // Disagreement between independent sources, measured before confidence is
  // scored so the finding survives the score that noticed it.
  let conflict = null;
  let agreementKm = null;
  if (candidates.length > 1) {
    const others = candidates.filter(c => c.source !== chosen.source);
    for (const other of others) {
      const km = haversineKm(chosen.lat, chosen.lng, other.lat, other.lng);
      if (agreementKm === null || km > agreementKm) agreementKm = km;
      if (km > T.thresholds.SOURCE_DISCREPANCY_KM) {
        conflict = await F.recordConflict(db, orgId, {
          sessionId: session.id,
          kind: 'source_disagreement',
          severity: km > 25 ? 'critical' : 'warning',
          detail: `${chosen.source} and ${other.source} disagree by ${km.toFixed(1)} km`,
          metricName: 'distance_km', metricValue: km,
          thresholdValue: T.thresholds.SOURCE_DISCREPANCY_KM,
          evidenceIds: [chosen.id, other.id],
          sourcesInvolved: [chosen.source, other.source],
        });
      }
    }
  }

  const confidence = T.computeConfidence({
    accuracyM: chosen.accuracy_m,
    ageSeconds: ageSec,
    sourceCount: candidates.length,
    agreementKm,
  });

  // Certainty is about evidence sufficiency, confidence about measurement
  // quality. They are not the same axis: one fresh accurate source is
  // high-confidence but only 'probable', because nothing corroborates it.
  let certainty;
  if (conflict) certainty = 'conflicted';
  else if (candidates.length > 1 && confidence === 'high') certainty = 'confirmed';
  else if (confidence === 'unknown') certainty = 'unknown';
  else if (candidates.length > 1) certainty = 'probable';
  else certainty = 'uncertain';

  await F.recordDecision(db, orgId, {
    sessionId: session.id,
    subject: 'canonical_position',
    decision: `${chosen.source}@${Number(chosen.lat).toFixed(5)},${Number(chosen.lng).toFixed(5)}`,
    certainty,
    confidence,
    chosenSource: chosen.source,
    supporting: [chosen.id],
    contradicting: candidates.filter(c => c.id !== chosen.id).map(c => c.id),
    conflictId: conflict?.id || null,
    inputs: {
      candidates: candidates.map(c => ({ source: c.source, device_time: c.device_time })),
      age_seconds: Math.round(ageSec),
      agreement_km: agreementKm,
    },
    occurredAt: chosen.device_time,
  });

  await db(
    `UPDATE tracking_sessions
        SET status = CASE WHEN status = 'awaiting_location' THEN 'active' ELSE status END,
            current_lat=$1, current_lng=$2, current_accuracy_m=$3, current_speed_kph=$4,
            current_heading=$5, current_source=$6, current_confidence=$7,
            first_location_at = COALESCE(first_location_at, NOW()),
            last_location_at=NOW(), last_seen_at=NOW(), updated_at=NOW()
      WHERE id=$8`,
    [chosen.lat, chosen.lng, chosen.accuracy_m, chosen.speed_kph, chosen.heading,
     chosen.source, confidence, session.id]
  );

  T.publishTracking(orgId, 'tracking.location', {
    session_id: session.id, trip_id: session.trip_id, convoy_id: session.convoy_id,
    vehicle_id: session.vehicle_id, lat: chosen.lat, lng: chosen.lng,
    source: chosen.source, confidence, certainty,
    health: T.computeHealth(chosen.device_time, now),
  });

  return { chosen, confidence, certainty, conflict };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

module.exports = router;
module.exports.MAX_EVENTS_PER_REQUEST = MAX_EVENTS_PER_REQUEST;
module.exports.fuseAndRecord = fuseAndRecord;
module.exports.haversineKm = haversineKm;
