// CDS Operations Intelligence — open-source AI (Groq/Llama) monitors live
// operational data and surfaces alerts: overdue containers, stalled trips,
// booking anomalies, capacity gaps, and risk patterns.
// Called by a cron job every 15 minutes; writes to cds_alerts table.
const OpenAI = require('openai');
const logger = require('./logger');

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

function hasGroq() {
  const k = process.env.GROQ_API_KEY;
  return !!(k && k.length >= 20);
}

function groqClient() {
  return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
}

async function callGroq(systemPrompt, userContent) {
  const res = await groqClient().chat.completions.create({
    model: GROQ_MODEL,
    max_completion_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });
  return res.choices?.[0]?.message?.content || '';
}

function parseAlerts(text) {
  const match = (text || '').match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); } catch { return []; }
}

async function gatherSnapshot(db, orgId) {
  const [trips, bookings, containers, unacked] = await Promise.all([
    db(`SELECT t.id, t.trip_number, t.status, t.risk, t.eta, t.departed_at, t.arrived_at,
               t.delivered_at, t.created_at, t.booking_id,
               d.name AS driver_name, v.registration AS vehicle_registration,
               c.number AS container_number
        FROM cds_trips t
        LEFT JOIN cds_drivers d ON d.id=t.driver_id AND d.deleted_at IS NULL
        LEFT JOIN cds_vehicles v ON v.id=t.vehicle_id AND v.deleted_at IS NULL
        LEFT JOIN cds_containers c ON c.id=t.container_id AND c.deleted_at IS NULL
        WHERE t.deleted_at IS NULL AND t.org_id=$1
          AND t.status NOT IN ('completed','archived')
        ORDER BY t.created_at DESC LIMIT 100`, [orgId]),
    db(`SELECT b.id, b.booking_number, b.status, b.eta, b.commodity, b.pickup_location,
               b.delivery_location, b.created_at,
               cu.company_name AS customer,
               COUNT(bc.id) AS container_count,
               COUNT(bc.id) FILTER (WHERE bc.status='delivered') AS delivered_count
        FROM cds_bookings b
        LEFT JOIN cds_customers cu ON cu.id=b.customer_id AND cu.deleted_at IS NULL
        LEFT JOIN cds_booking_containers bc ON bc.booking_id=b.id AND bc.deleted_at IS NULL
        WHERE b.deleted_at IS NULL AND b.org_id=$1
          AND b.status NOT IN ('completed','billed','cancelled')
        GROUP BY b.id, cu.company_name
        ORDER BY b.created_at DESC LIMIT 50`, [orgId]),
    db(`SELECT status, COUNT(*) AS cnt FROM cds_containers
        WHERE deleted_at IS NULL AND org_id=$1 GROUP BY status`, [orgId]),
    db(`SELECT COUNT(*) AS cnt FROM cds_alerts
        WHERE acknowledged=false AND org_id=$1`, [orgId]),
  ]);
  return {
    activeTrips: trips.rows,
    activeBookings: bookings.rows,
    containerInventory: containers.rows,
    unacknowledgedAlerts: parseInt(unacked.rows[0].cnt, 10),
    snapshotAt: new Date().toISOString(),
  };
}

const SYSTEM_PROMPT = `You are an operations intelligence engine for a container delivery system (CDS).
You receive a JSON snapshot of live operational data. Your job is to identify issues that require human attention.

Detect issues such as:
- Trips overdue (departed but no ETA update, or ETA passed with no delivery)
- Trips stuck in a status too long (e.g. "dispatched" for >24h with no progress)
- Bookings with missing container assignments or 0 containers defined
- High-risk trips (risk=high or critical) with no checkpoint updates
- Large number of unacknowledged alerts
- Bookings with ETA within 24h but containers not yet dispatched
- Container inventory imbalance (too many in maintenance, too few available)

Return ONLY a JSON array of alert objects. Each object:
{
  "type": "string (overspeed|route_deviation|lock_tamper|device_offline|unauthorized_stop|late_delivery|fuel_theft|geofence_exit|battery_low|sos|harsh_braking|harsh_acceleration)",
  "severity": "string (info|low|medium|high|critical)",
  "title": "string (short, max 80 chars)",
  "message": "string (clear explanation with specific IDs/numbers, max 300 chars)",
  "entity_type": "string (trip|container|lock|vehicle|driver|geofence)",
  "entity_id": "uuid"
}

Use type=late_delivery for overdue/stalled delivery issues, type=device_offline for missing operational updates,
type=route_deviation for route/progress anomalies, type=unauthorized_stop for suspicious stops, and type=battery_low
for capacity/device availability issues when no more specific CDS alert type applies.
Never emit entity_id=null and never emit entity_type=system because the cds_alerts schema requires a concrete entity.
Return [] if no issues. Be specific — include trip numbers, booking numbers, container IDs in your messages. Maximum 10 alerts per run.`;

const VALID_TYPES = new Set([
  'overspeed', 'route_deviation', 'lock_tamper', 'device_offline', 'unauthorized_stop',
  'late_delivery', 'fuel_theft', 'geofence_exit', 'battery_low', 'sos',
  'harsh_braking', 'harsh_acceleration',
]);
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_ENTITY_TYPES = new Set(['trip', 'container', 'lock', 'vehicle', 'driver', 'geofence']);

function normaliseAlert(a) {
  if (!a || !a.title || !a.message || !a.entity_id) return null;
  const type = VALID_TYPES.has(a.type) ? a.type : 'late_delivery';
  const severity = VALID_SEVERITIES.has(a.severity) ? a.severity : 'medium';
  const entityType = VALID_ENTITY_TYPES.has(a.entity_type) ? a.entity_type : 'trip';
  return {
    type,
    severity,
    title: String(a.title).slice(0, 255),
    message: String(a.message).slice(0, 500),
    entity_type: entityType,
    entity_id: a.entity_id,
  };
}

async function runIntelligenceScan(db, orgId) {
  if (!hasGroq()) {
    logger.info('cds-intelligence: groq not configured, skipping scan');
    return 0;
  }

  let snapshot;
  try {
    snapshot = await gatherSnapshot(db, orgId);
  } catch (err) {
    logger.error(`cds-intelligence: snapshot failed — ${err.message}`);
    return 0;
  }

  const snapshotStr = JSON.stringify(snapshot, null, 2);
  let alertsRaw;
  try {
    alertsRaw = await callGroq(SYSTEM_PROMPT, snapshotStr);
  } catch (err) {
    logger.error(`cds-intelligence: groq call failed — ${err.message}`);
    return 0;
  }

  const alerts = parseAlerts(alertsRaw);
  if (!Array.isArray(alerts) || alerts.length === 0) {
    logger.info('cds-intelligence: no issues detected');
    return 0;
  }

  let inserted = 0;
  for (const raw of alerts.slice(0, 10)) {
    const a = normaliseAlert(raw);
    if (!a) continue;
    try {
      const existing = await db(
        `SELECT id FROM cds_alerts WHERE org_id=$1 AND type=$2 AND entity_id IS NOT DISTINCT FROM $3
         AND created_at > NOW() - INTERVAL '2 hours' LIMIT 1`,
        [orgId, a.type, a.entity_id]
      );
      if (existing.rows.length) continue;

      await db(
        `INSERT INTO cds_alerts (org_id, type, severity, title, message, entity_type, entity_id, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'intelligence')`,
        [orgId, a.type, a.severity, a.title, a.message, a.entity_type, a.entity_id]
      );
      inserted++;
    } catch (err) {
      logger.warn(`cds-intelligence: insert failed — ${err.message}`);
    }
  }

  logger.info(`cds-intelligence: inserted ${inserted} alerts from ${alerts.length} detected issues`);
  return inserted;
}

module.exports = { runIntelligenceScan };
