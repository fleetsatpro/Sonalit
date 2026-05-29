/**
 * Driver behaviour event detection — RULE C: uses withOrg, never req.db
 *
 * detectBehaviourEvents(orgId, driverId, vehicleId, fix, prevFix)
 *   fix / prevFix: { lat, lng, speed, heading, timestamp }
 * Returns array of events to insert into driver_behaviour_events.
 */
const { withOrg } = require('./orgScopedDb');

const SPEED_LIMIT_DEFAULT_KMH = 100;
const IDLE_THRESHOLD_MINUTES = 10;
const IDLE_SPEED_KMH = 3;
const HARD_BRAKE_DECEL = 5;   // km/h/s
const HARSH_ACCEL = 4;         // km/h/s
const HARSH_CORNERING_DEG = 45; // heading change threshold in deg/s

function headingDelta(h1, h2) {
  let d = Math.abs(h1 - h2);
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * detectBehaviourEvents(orgId, driverId, vehicleId, fix, prevFix)
 * Returns array of raw event objects (not yet inserted).
 */
async function detectBehaviourEvents(orgId, driverId, vehicleId, fix, prevFix) {
  if (!prevFix || !fix) return [];
  const events = [];

  const dt = (new Date(fix.timestamp).getTime() - new Date(prevFix.timestamp).getTime()) / 1000;
  if (dt <= 0 || dt > 300) return [];

  const speed = fix.speed ?? 0;
  const prevSpeed = prevFix.speed ?? 0;
  const dSpeed = speed - prevSpeed;

  // Hard braking
  const decel = (prevSpeed - speed) / dt;
  if (decel >= HARD_BRAKE_DECEL && prevSpeed > 20) {
    events.push({ event_type: 'hard_braking', severity: Math.min(5, Math.round(decel / 2)), speed_kmh: prevSpeed });
  }

  // Harsh acceleration
  const accel = dSpeed / dt;
  if (accel >= HARSH_ACCEL && prevSpeed < 80) {
    events.push({ event_type: 'harsh_acceleration', severity: Math.min(5, Math.round(accel / 2)), speed_kmh: speed });
  }

  // Harsh cornering
  if (fix.heading != null && prevFix.heading != null && speed > 20) {
    const deg = headingDelta(fix.heading, prevFix.heading) / dt;
    if (deg >= HARSH_CORNERING_DEG) {
      events.push({ event_type: 'harsh_cornering', severity: Math.min(5, Math.round(deg / 20)), speed_kmh: speed });
    }
  }

  // Speeding — check against vehicle's assigned speed limit or default
  const speedLimit = await getSpeedLimit(orgId, vehicleId);
  if (speed > speedLimit) {
    const overage = speed - speedLimit;
    events.push({ event_type: 'speeding', severity: Math.min(5, Math.ceil(overage / 20)), speed_kmh: speed, extra: { limit_kmh: speedLimit, over_by: overage } });
  }

  // Prolonged idle — requires consecutive fixes all slow; detect via Redis state or approximate
  if (speed <= IDLE_SPEED_KMH && prevSpeed <= IDLE_SPEED_KMH) {
    const idleAt = await getIdleStart(orgId, vehicleId, fix.timestamp, prevFix.timestamp);
    if (idleAt) {
      const idleMin = (new Date(fix.timestamp).getTime() - idleAt) / 60000;
      if (idleMin >= IDLE_THRESHOLD_MINUTES && idleMin < IDLE_THRESHOLD_MINUTES + 2) {
        events.push({ event_type: 'prolonged_idle', severity: 1, speed_kmh: speed, extra: { idle_minutes: Math.round(idleMin) } });
      }
    }
  }

  return events.map(e => ({
    org_id: orgId,
    driver_id: driverId || null,
    vehicle_id: vehicleId || null,
    lat: fix.lat,
    lng: fix.lng,
    ...e,
  }));
}

async function getSpeedLimit(orgId, vehicleId) {
  if (!vehicleId) return SPEED_LIMIT_DEFAULT_KMH;
  try {
    let limit = SPEED_LIMIT_DEFAULT_KMH;
    await withOrg(orgId, async (db) => {
      const r = await db.query(`SELECT speed_limit_kmh FROM vehicles WHERE id = $1`, [vehicleId]);
      if (r.rows[0]?.speed_limit_kmh) limit = Number(r.rows[0].speed_limit_kmh);
    });
    return limit;
  } catch (_) { return SPEED_LIMIT_DEFAULT_KMH; }
}

// Approximate idle start from Redis (key: beh:idle:{vehicleId})
// Falls back to using prevFix timestamp if Redis not available
async function getIdleStart(orgId, vehicleId, nowTs, prevTs) {
  if (!vehicleId) return null;
  try {
    const redis = require('../config/redis').getClient();
    const key = `beh:idle:${vehicleId}`;
    const stored = await redis.get(key);
    if (stored) return parseInt(stored);
    // Start tracking
    await redis.set(key, new Date(prevTs).getTime(), 'EX', 3600);
    return null;
  } catch (_) {
    return null;
  }
}

async function clearIdleState(vehicleId) {
  if (!vehicleId) return;
  try {
    const redis = require('../config/redis').getClient();
    await redis.del(`beh:idle:${vehicleId}`);
  } catch (_) {}
}

/**
 * Store detected events and refresh the matview on first event of each minute window.
 */
async function storeBehaviourEvents(orgId, events) {
  if (!events.length) return;
  await withOrg(orgId, async (db) => {
    for (const e of events) {
      await db.query(
        `INSERT INTO driver_behaviour_events
           (org_id, driver_id, vehicle_id, event_type, severity, speed_kmh, lat, lng, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [e.org_id, e.driver_id, e.vehicle_id, e.event_type,
         e.severity ?? 1, e.speed_kmh ?? null, e.lat ?? null, e.lng ?? null,
         e.extra ? JSON.stringify(e.extra) : null],
      );
    }
  });

  // Async matview refresh — fire-and-forget, not blocking GPS pipeline
  const { pool } = require('../config/database');
  pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY driver_scores_30d').catch(() => {});
}

module.exports = { detectBehaviourEvents, storeBehaviourEvents, clearIdleState };
