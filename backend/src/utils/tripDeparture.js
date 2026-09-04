/**
 * Trip departure — establishing that a truck has actually left.
 *
 * THE PROBLEM
 * `departed_at` had exactly one writer (the trip transition handler) and no
 * caller. Every trip stayed at 'locked' forever, so Live Operations reported a
 * truck streaming GPS from the road as "awaiting departure", and every metric
 * derived from departed_at was permanently null.
 *
 * THREE PATHS, ONE FUNCTION
 * Manual, derived and operator departures all land in markDeparted(). They
 * differ only in who established the fact and how, which is recorded rather
 * than inferred. Three code paths would drift, and the day they disagree is the
 * day the yard and the control room tell different stories about the same
 * truck.
 *
 * MANUAL IS NOT A FALLBACK — IT IS THE PRIMARY PATH.
 * A driver who never scanned the QR produces no telemetry at all, so there is
 * nothing to derive from and the trip would sit at 'locked' permanently. The
 * yard must always be able to say "it left", with or without tracking.
 * Derivation exists so a departure is never MISSED, not so a human is never
 * involved.
 *
 * IDEMPOTENT BY CONSTRUCTION. A yard worker tapping twice, a derivation racing
 * a manual mark, a retried offline action — all must converge on one departure
 * with one timestamp. The first writer wins and later callers are told so,
 * rather than the timestamp being quietly rewritten to a later moment.
 */

const logger = require('./logger');
const F = require('./telemetryFabric');
const T = require('./trackingEngine');

/**
 * How far from the clamp point counts as "left the yard".
 *
 * A truck shunting between stacks can easily move 200m without departing, and
 * a GPS fix in a container yard bounces off steel. 500m is past both, and short
 * enough that a departure is noticed within a minute or two of the gate.
 */
const DEPARTURE_RADIUS_M = num('TRIP_DEPARTURE_RADIUS_M', 500);

/**
 * How long that distance must hold.
 *
 * One fix beyond the radius is not a departure — it is often a bad fix. GPS in
 * a yard surrounded by containers routinely throws a point a kilometre away and
 * then returns. Requiring the distance to persist across a gap of this long is
 * what separates a truck leaving from a reflection off a stack.
 */
const DEPARTURE_SUSTAIN_SECONDS = num('TRIP_DEPARTURE_SUSTAIN_SECONDS', 120);

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Record a departure. The single writer for all three paths.
 *
 * `source` says how it was established:
 *   manual    the yard, from the field app
 *   derived   sustained movement away from the clamp point
 *   operator  the control room, correcting after the fact
 *
 * Returns { trip, already } — `already` true when someone got there first, so
 * a caller can tell "you marked it" from "it was already marked" without
 * treating the second as an error.
 */
async function markDeparted(db, orgId, tripId, {
  source, actorId = null, note = null, at = null, evidence = null,
} = {}) {
  if (!['manual', 'derived', 'operator'].includes(source)) {
    throw new Error(`markDeparted: unknown source "${source}"`);
  }

  // The guard is in the WHERE clause, not in a preceding SELECT: two callers
  // racing (a yard tap and a derivation tick) would both pass a check-then-act,
  // and the loser would overwrite the winner's timestamp with a later one.
  const updated = await db(
    `UPDATE cds_trips
        SET status = CASE WHEN status = 'locked' THEN 'dispatched' ELSE status END,
            departed_at = COALESCE($2, NOW()),
            departure_source = $3,
            departed_by = $4,
            departure_note = $5,
            updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
        AND departed_at IS NULL
      RETURNING *`,
    [tripId, at, source, actorId, note]
  );

  if (!updated.rows.length) {
    const existing = await db(
      `SELECT * FROM cds_trips WHERE id = $1 AND deleted_at IS NULL`, [tripId]);
    return { trip: existing.rows[0] || null, already: true };
  }

  const trip = updated.rows[0];

  // The departure is a derived conclusion like any other, so it carries its
  // evidence. "When did it leave, and how do we know?" has to be answerable
  // months later by someone who was not in the yard.
  try {
    const session = await db(
      `SELECT id FROM tracking_sessions
        WHERE trip_id = $1 AND deleted_at IS NULL
        ORDER BY started_at DESC LIMIT 1`, [tripId]);
    if (session.rows.length) {
      await F.recordDecision(db, orgId, {
        sessionId: session.rows[0].id,
        subject: 'departure',
        decision: `departed via ${source}`,
        // A yard worker watching a truck leave is stronger evidence than a
        // coordinate: they saw it. Derived departure is 'probable' because a
        // radius crossing is an inference, however well sustained.
        certainty: source === 'derived' ? 'probable' : 'confirmed',
        chosenSource: source === 'derived' ? 'guardian_gps' : null,
        supporting: evidence?.locationIds || [],
        inputs: evidence?.inputs || { source, note },
        occurredAt: trip.departed_at,
      });
    }
  } catch (err) {
    // Never let the audit trail block the operational fact. The truck left
    // whether or not we managed to write down why we think so.
    logger.warn(`departure decision not recorded for trip ${tripId}: ${err.message}`);
  }

  // Tell every open board at once. Departure is the moment a trip stops being
  // the yard's and becomes the control room's, and until this existed the desk
  // only learned about it on the next poll — up to 30 seconds after a truck
  // they were watching for had already gone.
  T.publishTracking(orgId, 'cds.trip.updated', {
    trip_id: trip.id, trip_number: trip.trip_number, booking_id: trip.booking_id,
    status: trip.status, departed_at: trip.departed_at, departure_source: source,
  });

  return { trip, already: false };
}

/**
 * Has this trip moved far enough, for long enough, to count as departed?
 *
 * Called from the telemetry paths after a canonical position lands, so a
 * departure is noticed by the same evidence that proves it. Deliberately quiet:
 * a trip with no anchor, no session or too few fixes simply is not derivable
 * yet, which is not an error and must not be logged as one.
 */
async function maybeDeriveDeparture(db, orgId, trip, now = Date.now()) {
  if (!trip || trip.departed_at) return null;

  const anchorLat = trip.clamp_lat;
  const anchorLng = trip.clamp_lng;
  // No anchor means the clamp had no GPS — a perfectly ordinary outcome, since
  // the physical clamp never depends on location. Manual departure covers it.
  if (anchorLat == null || anchorLng == null) return null;

  const fixes = await db(
    `SELECT l.id, l.lat, l.lng, l.device_time
       FROM tracking_locations l
       JOIN tracking_sessions s ON s.id = l.session_id
      WHERE s.trip_id = $1 AND l.quality <> 'rejected'
      ORDER BY l.device_time DESC
      LIMIT 40`,
    [trip.id]
  );
  if (fixes.rows.length < 2) return null;

  // Walk newest-first and find how long the truck has been continuously beyond
  // the radius. A single outlier breaks the run, which is the point: one wild
  // fix off a container stack must not dispatch a truck that never moved.
  const beyond = [];
  for (const f of fixes.rows) {
    const d = haversineM(anchorLat, anchorLng, Number(f.lat), Number(f.lng));
    if (d < DEPARTURE_RADIUS_M) break;
    beyond.push({ ...f, distance_m: d });
  }
  if (beyond.length < 2) return null;

  const newest = new Date(beyond[0].device_time).getTime();
  const oldest = new Date(beyond[beyond.length - 1].device_time).getTime();
  const sustainedSec = (newest - oldest) / 1000;
  if (sustainedSec < DEPARTURE_SUSTAIN_SECONDS) return null;

  const result = await markDeparted(db, orgId, trip.id, {
    source: 'derived',
    // Dated to when the truck FIRST went beyond the radius, not to now.
    // Recording the moment we noticed would put every departure minutes late
    // and quietly distort transit times.
    at: beyond[beyond.length - 1].device_time,
    note: `${Math.round(beyond[beyond.length - 1].distance_m)}m from clamp point, `
        + `sustained ${Math.round(sustainedSec)}s`,
    evidence: {
      locationIds: beyond.map(b => b.id),
      inputs: {
        radius_m: DEPARTURE_RADIUS_M,
        sustained_seconds: Math.round(sustainedSec),
        fixes_beyond: beyond.length,
        max_distance_m: Math.round(Math.max(...beyond.map(b => b.distance_m))),
      },
    },
  });

  if (!result.already) {
    logger.info(`trip ${trip.id} departure derived from telemetry`);
  }
  return result;
}

/** Fetch the trip behind a tracking session, for the derivation path. */
async function tripForSession(db, sessionId) {
  const r = await db(
    `SELECT t.* FROM cds_trips t
       JOIN tracking_sessions s ON s.trip_id = t.id
      WHERE s.id = $1 AND t.deleted_at IS NULL`,
    [sessionId]
  );
  return r.rows[0] || null;
}

module.exports = {
  markDeparted, maybeDeriveDeparture, tripForSession, haversineM,
  DEPARTURE_RADIUS_M, DEPARTURE_SUSTAIN_SECONDS,
};
