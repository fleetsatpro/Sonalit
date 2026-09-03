/**
 * Sonalit Hybrid Tracking — the engine.
 *
 * Everything that decides *what Sonalit believes about a vehicle's position*
 * lives here, so CDS, Convoys and Guardian consume one canonical answer instead
 * of each interpreting raw telemetry their own way.
 *
 * Three ideas carry most of the weight:
 *
 *   1. SOURCES ARE INTERCHANGEABLE. `guardian_gps` (the driver's phone, started
 *      by a QR scan) and `securisat_elock` are peers. Priority decides which one
 *      wins a tie; it never switches the other off. Losing a source costs
 *      confidence, not tracking.
 *
 *   2. FRESHNESS IS NOT THE SAME AS TRUTH. A stale coordinate is never shown as
 *      LIVE. Health is derived from how long ago the last fix landed, so a phone
 *      in a dead zone degrades to SIGNAL LOST rather than quietly pinning a
 *      vehicle to where it was an hour ago.
 *
 *   3. THE JOURNEY ENDS THE SESSION. Not a timer, and never the driver. A
 *      container being marked delivered — or a convoy being ended — is what
 *      terminates tracking, which is why the termination policy is chosen when
 *      the QR is minted and copied onto the session.
 *
 * Anomalous telemetry is stored and flagged rather than dropped: an impossible
 * jump is itself evidence, and discarding it would leave a silent gap in the
 * journey record.
 */
const crypto = require('crypto');
const { haversine } = require('./haversine');
const { withOrg } = require('./orgScopedDb');
const { publish } = require('../realtime/centrifugo');
const logger = require('./logger');

/* ─── Thresholds ──────────────────────────────────────────────────────────── */
// Deliberately env-tunable: a long-haul corridor with thin coverage wants a
// laxer LIVE window than a city yard.
const num = (name, fallback) => Number(process.env[name] || fallback);

const LIVE_SECONDS        = num('TRACKING_LIVE_SECONDS', 90);
const DELAYED_SECONDS     = num('TRACKING_DELAYED_SECONDS', 300);
const SIGNAL_LOST_SECONDS = num('TRACKING_SIGNAL_LOST_SECONDS', 1800);

const MAX_PLAUSIBLE_KPH   = num('TRACKING_MAX_KPH', 250);
const MAX_CLOCK_SKEW_SEC  = num('TRACKING_MAX_CLOCK_SKEW_SEC', 120);
const POOR_ACCURACY_M     = num('TRACKING_POOR_ACCURACY_M', 250);
const REJECT_ACCURACY_M   = num('TRACKING_REJECT_ACCURACY_M', 5000);

// When two sources disagree by more than this, record a discrepancy rather than
// silently preferring one.
const SOURCE_DISCREPANCY_KM = num('TRACKING_SOURCE_DISCREPANCY_KM', 2);

// Higher wins a tie. SecuriSat outranks a phone because it is bolted to the
// container — but only when it is actually fresh.
const SOURCE_PRIORITY = { securisat_elock: 30, device_telematics: 20, guardian_gps: 10 };

const LIVE_STATUSES = ['awaiting_location', 'active', 'paused', 'signal_lost'];

/* ─── Tokens ──────────────────────────────────────────────────────────────── */

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** 32 random bytes — long enough that enumeration is hopeless. */
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Stable, non-reversible device id. Never store the raw fingerprint inputs. */
function deviceFingerprint(parts) {
  return sha256(JSON.stringify(parts || {}));
}

/** An org-scoped query fn for callers that have no `req.db` (workers, hooks). */
function dbForOrg(orgId) {
  return (text, params) => withOrg(orgId, client => client.query(text, params));
}

/* ─── Health & confidence ─────────────────────────────────────────────────── */

/**
 * Tracking health from the age of the newest fix.
 * `not_started` is distinct from `offline`: one has never reported, the other
 * has gone quiet — very different operator responses.
 */
function computeHealth(session, now = Date.now()) {
  if (!session) return 'not_started';
  if (['completed', 'terminated', 'expired', 'cancelled'].includes(session.status)) return 'completed';
  if (!session.first_location_at) return 'not_started';

  const last = session.last_location_at ? new Date(session.last_location_at).getTime() : 0;
  const ageSec = (now - last) / 1000;

  if (ageSec <= LIVE_SECONDS) return 'live';
  if (ageSec <= DELAYED_SECONDS) return 'delayed';
  if (ageSec <= SIGNAL_LOST_SECONDS) return 'signal_lost';
  return 'offline';
}

/**
 * Confidence blends accuracy, freshness and cross-source agreement, so an
 * operator can tell "we know exactly where this is" from "we have a rough idea".
 */
function computeConfidence({ accuracyM, ageSeconds, sourceCount = 1, agreementKm = null }) {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return 'unknown';
  if (ageSeconds > SIGNAL_LOST_SECONDS) return 'low';

  const acc = Number.isFinite(accuracyM) ? accuracyM : POOR_ACCURACY_M;
  const disagrees = agreementKm != null && agreementKm > SOURCE_DISCREPANCY_KM;

  if (!disagrees && acc <= 50 && ageSeconds <= LIVE_SECONDS) {
    return sourceCount >= 2 ? 'high' : 'high';
  }
  if (acc <= POOR_ACCURACY_M && ageSeconds <= DELAYED_SECONDS) return 'medium';
  return 'low';
}

/* ─── Telemetry validation ────────────────────────────────────────────────── */

/**
 * Grade one incoming fix against the previous one.
 * Returns `{ quality, anomaly_reason }`; `rejected` points are still written so
 * the gap is explainable, but they never become the canonical position.
 */
function validateFix(prev, fix, now = Date.now()) {
  const t = new Date(fix.device_time).getTime();

  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) ||
      Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) {
    return { quality: 'rejected', anomaly_reason: 'invalid_coordinates' };
  }
  if (!Number.isFinite(t)) {
    return { quality: 'rejected', anomaly_reason: 'invalid_timestamp' };
  }
  if (t - now > MAX_CLOCK_SKEW_SEC * 1000) {
    return { quality: 'rejected', anomaly_reason: 'future_timestamp' };
  }
  if (Number.isFinite(fix.accuracy_m) && fix.accuracy_m > REJECT_ACCURACY_M) {
    return { quality: 'rejected', anomaly_reason: 'accuracy_out_of_range' };
  }

  if (prev && prev.lat != null && prev.device_time) {
    const prevT = new Date(prev.device_time).getTime();
    const dtHours = (t - prevT) / 3_600_000;
    if (dtHours > 0) {
      const km = haversine(prev.lat, prev.lng, fix.lat, fix.lng);
      const kph = km / dtHours;
      if (kph > MAX_PLAUSIBLE_KPH) {
        return { quality: 'rejected', anomaly_reason: `impossible_speed_${Math.round(kph)}kph` };
      }
    }
  }

  if (Number.isFinite(fix.accuracy_m) && fix.accuracy_m > POOR_ACCURACY_M) {
    return { quality: 'degraded', anomaly_reason: 'poor_accuracy' };
  }
  return { quality: 'good', anomaly_reason: null };
}

/* ─── Source reconciliation ───────────────────────────────────────────────── */

/**
 * Pick the canonical position from whatever sources reported recently.
 * Priority breaks ties, but a stale high-priority source loses to a fresh
 * low-priority one — that is the whole point of the redundancy.
 */
function reconcile(candidates, now = Date.now()) {
  const usable = (candidates || []).filter(c => c && c.quality !== 'rejected' && c.lat != null);
  if (!usable.length) return null;

  const scored = usable.map(c => {
    const ageSec = (now - new Date(c.device_time).getTime()) / 1000;
    const stale = ageSec > DELAYED_SECONDS;
    return { ...c, ageSec, score: (stale ? 0 : SOURCE_PRIORITY[c.source] || 0) - ageSec / 60 };
  }).sort((a, b) => b.score - a.score);

  const winner = scored[0];
  let agreementKm = null;
  const other = scored.find(c => c.source !== winner.source);
  if (other) agreementKm = haversine(winner.lat, winner.lng, other.lat, other.lng);

  return {
    ...winner,
    agreementKm,
    sourceCount: new Set(scored.map(c => c.source)).size,
    discrepancy: agreementKm != null && agreementKm > SOURCE_DISCREPANCY_KM
      ? { km: agreementKm, sources: [winner.source, other.source] }
      : null,
  };
}

/* ─── Events & realtime ───────────────────────────────────────────────────── */

async function recordEvent(db, orgId, { sessionId = null, qrCodeId = null, eventType,
                                        actorType = 'system', actorId = null, actorName = null,
                                        payload = {} }) {
  try {
    await db(
      `INSERT INTO tracking_events (org_id, session_id, qr_code_id, event_type, actor_type, actor_id, actor_name, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgId, sessionId, qrCodeId, eventType, actorType, actorId, actorName, JSON.stringify(payload)]
    );
  } catch (err) {
    // A missing audit line must never fail the operation it describes.
    logger.warn(`tracking event ${eventType} not recorded: ${err.message}`);
  }
}

/** Push to the org command-center channel. Fire-and-forget by design. */
function publishTracking(orgId, type, data) {
  publish(`org#${orgId}`, { type, ...data }).catch(() => {});
}

/* ─── QR issuance ─────────────────────────────────────────────────────────── */

/** Where a scanned QR sends the driver. */
function trackingBaseUrl() {
  return (process.env.TRACKING_BASE_URL || process.env.APP_BASE_URL || 'https://sonalit.vercel.app')
    .replace(/\/+$/, '');
}

/**
 * Mint a QR for one journey.
 *
 * Returns the raw token exactly once — it is hashed on the way into the table
 * and can never be recovered, so a caller that loses it must regenerate. That
 * is the same bargain field_devices strikes with its pairing code, and it is
 * what makes a leaked database row unscannable.
 *
 * `display` is the only thing the driver's phone will ever see, so keep it to
 * what belongs on a gate pass.
 */
async function issueQr(db, orgId, {
  purpose,
  terminationPolicy = 'container_delivered',
  terminationContainerId = null,
  tripId = null, bookingId = null, convoyId = null,
  vehicleId = null, cdsVehicleId = null, driverId = null, coreDriverId = null,
  display = {}, issuedBy = null, expiresAt = null,
} = {}) {
  const token = newToken();
  const result = await db(
    `INSERT INTO tracking_qr_codes
       (org_id, token_hash, purpose, status, termination_policy, termination_container_id,
        trip_id, booking_id, convoy_id, vehicle_id, cds_vehicle_id, driver_id, core_driver_id,
        display, issued_by, expires_at)
     VALUES ($1,$2,$3,'ready',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [orgId, sha256(token), purpose, terminationPolicy, terminationContainerId,
     tripId, bookingId, convoyId, vehicleId, cdsVehicleId, driverId, coreDriverId,
     JSON.stringify(display || {}), issuedBy, expiresAt]
  );

  const qr = result.rows[0];
  return { qr, token, url: `${trackingBaseUrl()}/t/${token}` };
}

/**
 * Supersede any live QR for a journey before issuing a replacement, so a
 * regenerated code cannot leave two scannable links in circulation.
 */
async function supersedeOpenQrs(db, { tripId = null, convoyId = null, vehicleId = null }) {
  const clauses = [], params = [];
  if (tripId)   { params.push(tripId);   clauses.push(`trip_id = $${params.length}`); }
  if (convoyId) { params.push(convoyId); clauses.push(`convoy_id = $${params.length}`); }
  if (vehicleId){ params.push(vehicleId);clauses.push(`(vehicle_id = $${params.length} OR cds_vehicle_id = $${params.length})`); }
  if (!clauses.length) return 0;

  const result = await db(
    `UPDATE tracking_qr_codes SET status='replaced', updated_at=NOW()
      WHERE status IN ('generated','ready','scanned') AND ${clauses.join(' AND ')}
      RETURNING id`,
    params
  );
  return result.rows.length;
}

/* ─── Termination ─────────────────────────────────────────────────────────── */

/**
 * End one session. Idempotent: calling it on an already-ended session is a
 * no-op that still returns the row, because delivery webhooks retry.
 */
async function terminateSession(db, orgId, sessionId, reason, actor = {}) {
  const result = await db(
    `UPDATE tracking_sessions
        SET status = 'completed', ended_at = NOW(), termination_reason = $1,
            terminated_by = $2, updated_at = NOW()
      WHERE id = $3 AND status = ANY($4::text[])
      RETURNING *`,
    [reason, actor.id || null, sessionId, LIVE_STATUSES]
  );

  if (!result.rows.length) {
    const existing = await db('SELECT * FROM tracking_sessions WHERE id = $1', [sessionId]);
    return existing.rows[0] || null;
  }

  const session = result.rows[0];

  // Spend the QR with the session: an ended journey must not be restartable.
  if (session.qr_code_id) {
    await db(
      `UPDATE tracking_qr_codes SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status <> 'consumed'`,
      [session.qr_code_id]
    );
  }

  await recordEvent(db, orgId, {
    sessionId, qrCodeId: session.qr_code_id, eventType: 'TRACKING_TERMINATED',
    actorType: actor.type || 'system', actorId: actor.id || null, actorName: actor.name || null,
    payload: { reason },
  });

  publishTracking(orgId, 'tracking.session.terminated', {
    session_id: sessionId, reason, trip_id: session.trip_id, convoy_id: session.convoy_id,
  });

  return session;
}

/**
 * A container was delivered. Ends every session whose termination policy that
 * satisfies — which is not always "this session", hence the policy check:
 * a multi-container load keeps tracking until the last box lands.
 */
async function onContainerDelivered(db, orgId, containerId, actor = {}) {
  if (!containerId) return [];

  await db(
    `UPDATE tracking_session_containers SET delivered_at = NOW()
      WHERE container_id = $1 AND delivered_at IS NULL`,
    [containerId]
  );

  const candidates = await db(
    `SELECT DISTINCT s.*
       FROM tracking_sessions s
       JOIN tracking_session_containers c ON c.session_id = s.id
      WHERE c.container_id = $1 AND s.status = ANY($2::text[])`,
    [containerId, LIVE_STATUSES]
  );

  const ended = [];
  for (const session of candidates.rows) {
    let shouldEnd = false;

    if (session.termination_policy === 'container_delivered') {
      shouldEnd = true;
    } else if (session.termination_policy === 'specific_container_delivered') {
      shouldEnd = String(session.termination_container_id) === String(containerId);
    } else if (session.termination_policy === 'all_containers_delivered') {
      const pending = await db(
        `SELECT COUNT(*)::int AS n FROM tracking_session_containers
          WHERE session_id = $1 AND delivered_at IS NULL`,
        [session.id]
      );
      shouldEnd = pending.rows[0].n === 0;
    }
    // convoy_ended / manual sessions ignore container delivery entirely.

    if (shouldEnd) {
      const row = await terminateSession(db, orgId, session.id, 'CONTAINER_DELIVERED', actor);
      if (row) ended.push(row);
    }
  }
  return ended;
}

/** A convoy ended. Every session that convoy owns stops with it. */
async function onConvoyEnded(db, orgId, convoyId, actor = {}) {
  if (!convoyId) return [];

  const candidates = await db(
    `SELECT * FROM tracking_sessions
      WHERE convoy_id = $1 AND status = ANY($2::text[])`,
    [convoyId, LIVE_STATUSES]
  );

  const ended = [];
  for (const session of candidates.rows) {
    // A container-policy session riding along in a convoy keeps its own
    // lifecycle unless the convoy is what owns it.
    if (session.termination_policy !== 'convoy_ended') continue;
    const row = await terminateSession(db, orgId, session.id, 'CONVOY_ENDED', actor);
    if (row) ended.push(row);
  }

  // Unscanned QRs for a finished convoy must not stay scannable.
  await db(
    `UPDATE tracking_qr_codes
        SET status = 'expired', updated_at = NOW()
      WHERE convoy_id = $1 AND status IN ('generated','ready','scanned')`,
    [convoyId]
  );

  return ended;
}

module.exports = {
  sha256, newToken, deviceFingerprint, dbForOrg,
  computeHealth, computeConfidence, validateFix, reconcile,
  recordEvent, publishTracking,
  issueQr, supersedeOpenQrs, trackingBaseUrl,
  terminateSession, onContainerDelivered, onConvoyEnded,
  LIVE_STATUSES, SOURCE_PRIORITY,
  thresholds: { LIVE_SECONDS, DELAYED_SECONDS, SIGNAL_LOST_SECONDS, SOURCE_DISCREPANCY_KM },
};
