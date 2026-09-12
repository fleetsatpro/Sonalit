// CDS Operations Intelligence — bounded, provider-resilient AI monitoring for live CDS data.
const OpenAI = require('openai');
const logger = require('./logger');
const aiClient = require('./aiClient');

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasGroq() {
  const k = process.env.GROQ_API_KEY;
  return !!(k && k.length >= 20);
}
function groqClient() {
  return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
}

async function callGroqDirect(systemPrompt, userContent) {
  const res = await groqClient().chat.completions.create({
    model: GROQ_MODEL,
    max_completion_tokens: 2048,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
  });
  return res.choices?.[0]?.message?.content || '';
}

async function callAI(systemPrompt, userContent) {
  if (aiClient.hasAnthropic() || aiClient.hasGroqFallback()) {
    try {
      const response = await aiClient.createMessage({
        model: process.env.CDS_AI_MODEL || 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
      return response.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    } catch (err) {
      logger.warn(`cds-intelligence: shared AI unavailable (${err?.status || err.message}); trying direct Groq if configured`);
    }
  }
  if (hasGroq()) return callGroqDirect(systemPrompt, userContent);
  throw new Error('no AI provider available');
}

function parseAlerts(text) {
  const match = (text || '').match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); } catch { return []; }
}

async function gatherSnapshot(db, orgId) {
  const [trips, bookings, containers, unacked] = await Promise.all([
    db(`SELECT t.id, t.trip_number, t.status, t.risk, t.eta, t.departed_at, t.arrived_at, t.delivered_at, t.created_at, t.booking_id,
               d.id AS driver_id, d.name AS driver_name, v.id AS vehicle_id, v.registration AS vehicle_registration,
               c.id AS container_id, c.number AS container_number
        FROM cds_trips t
        LEFT JOIN cds_drivers d ON d.id=t.driver_id AND d.deleted_at IS NULL
        LEFT JOIN cds_vehicles v ON v.id=t.vehicle_id AND v.deleted_at IS NULL
        LEFT JOIN cds_containers c ON c.id=t.container_id AND c.deleted_at IS NULL
        WHERE t.deleted_at IS NULL AND t.org_id=$1 AND t.status NOT IN ('completed','archived')
        ORDER BY t.created_at DESC LIMIT 100`, [orgId]),
    db(`SELECT b.id, b.booking_number, b.status, b.eta, b.commodity, b.pickup_location, b.delivery_location, b.created_at,
               cu.company_name AS customer, COUNT(bc.id) AS container_count,
               COUNT(bc.id) FILTER (WHERE bc.status='delivered') AS delivered_count
        FROM cds_bookings b
        LEFT JOIN cds_customers cu ON cu.id=b.customer_id AND cu.deleted_at IS NULL
        LEFT JOIN cds_booking_containers bc ON bc.booking_id=b.id AND bc.deleted_at IS NULL
        WHERE b.deleted_at IS NULL AND b.org_id=$1 AND b.status NOT IN ('completed','billed','cancelled')
        GROUP BY b.id, cu.company_name ORDER BY b.created_at DESC LIMIT 50`, [orgId]),
    db(`SELECT id, number, status FROM cds_containers WHERE deleted_at IS NULL AND org_id=$1 ORDER BY updated_at DESC NULLS LAST LIMIT 300`, [orgId]),
    db(`SELECT COUNT(*) AS cnt FROM cds_alerts WHERE acknowledged=false AND org_id=$1`, [orgId]),
  ]);
  return { activeTrips: trips.rows, activeBookings: bookings.rows, containerInventory: containers.rows,
    unacknowledgedAlerts: parseInt(unacked.rows[0].cnt, 10), snapshotAt: new Date().toISOString() };
}

const SYSTEM_PROMPT = `You are the CDS operations intelligence engine. Analyze the supplied live snapshot and return ONLY a JSON array.
Never invent IDs. entity_id MUST be copied exactly from one of the supplied UUID fields (trip.id, container.id, vehicle.id, driver.id, or booking.id when appropriate). Prefer a concrete trip/container/vehicle/driver UUID over a human-readable number.
Detect overdue/stalled trips, missing assignments, high-risk trips without progress, excessive unacknowledged alerts, near-term bookings without dispatch, and inventory imbalance.
Each alert: {"type":"late_delivery|device_offline|route_deviation|unauthorized_stop|battery_low|overspeed|lock_tamper|fuel_theft|geofence_exit|sos|harsh_braking|harsh_acceleration","severity":"info|low|medium|high|critical","title":"max 80 chars","message":"max 300 chars","entity_type":"trip|container|lock|vehicle|driver|geofence","entity_id":"UUID"}. Maximum 10 alerts. Return [] if none.`;

const VALID_TYPES = new Set(['overspeed','route_deviation','lock_tamper','device_offline','unauthorized_stop','late_delivery','fuel_theft','geofence_exit','battery_low','sos','harsh_braking','harsh_acceleration']);
const VALID_SEVERITIES = new Set(['critical','high','medium','low','info']);
const VALID_ENTITY_TYPES = new Set(['trip','container','lock','vehicle','driver','geofence']);
function normaliseAlert(a) {
  if (!a || !a.title || !a.message) return null;
  return { type: VALID_TYPES.has(a.type) ? a.type : 'late_delivery', severity: VALID_SEVERITIES.has(a.severity) ? a.severity : 'medium',
    title: String(a.title).slice(0,255), message: String(a.message).slice(0,500),
    entity_type: VALID_ENTITY_TYPES.has(a.entity_type) ? a.entity_type : 'trip', entity_id: String(a.entity_id || '') };
}

async function resolveEntityId(db, orgId, alert) {
  if (UUID_RE.test(alert.entity_id)) return alert.entity_id;
  const value = alert.entity_id.trim();
  if (!value) return null;
  const maps = {
    trip: ['SELECT id FROM cds_trips WHERE org_id=$1 AND trip_number=$2 AND deleted_at IS NULL LIMIT 1', value],
    container: ['SELECT id FROM cds_containers WHERE org_id=$1 AND number=$2 AND deleted_at IS NULL LIMIT 1', value],
    vehicle: ['SELECT id FROM cds_vehicles WHERE org_id=$1 AND registration=$2 AND deleted_at IS NULL LIMIT 1', value],
    driver: ['SELECT id FROM cds_drivers WHERE org_id=$1 AND name=$2 AND deleted_at IS NULL LIMIT 1', value],
  };
  const spec = maps[alert.entity_type];
  if (!spec) return null;
  const r = await db(spec[0], [orgId, spec[1]]);
  return r.rows[0]?.id || null;
}

async function runIntelligenceScan(db, orgId) {
  let snapshot;
  try { snapshot = await gatherSnapshot(db, orgId); }
  catch (err) { logger.error(`cds-intelligence: snapshot failed — ${err.message}`); return 0; }
  let alertsRaw;
  try { alertsRaw = await callAI(SYSTEM_PROMPT, JSON.stringify(snapshot)); }
  catch (err) { logger.warn(`cds-intelligence: AI unavailable — ${err.message}`); return 0; }
  const alerts = parseAlerts(alertsRaw);
  if (!Array.isArray(alerts) || !alerts.length) return 0;

  let inserted = 0;
  for (const raw of alerts.slice(0,10)) {
    const a = normaliseAlert(raw);
    if (!a) continue;
    try {
      const entityId = await resolveEntityId(db, orgId, a);
      if (!entityId) { logger.warn(`cds-intelligence: discarded alert with unresolvable ${a.entity_type} entity`); continue; }
      const existing = await db(`SELECT id FROM cds_alerts WHERE org_id=$1 AND type=$2 AND entity_id IS NOT DISTINCT FROM $3::uuid
        AND created_at > NOW() - INTERVAL '2 hours' LIMIT 1`, [orgId, a.type, entityId]);
      if (existing.rows.length) continue;
      await db(`INSERT INTO cds_alerts (org_id,type,severity,title,message,entity_type,entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7::uuid)`,
        [orgId,a.type,a.severity,a.title,a.message,a.entity_type,entityId]);
      inserted++;
    } catch (err) { logger.warn(`cds-intelligence: insert failed — ${err.message}`); }
  }
  logger.info(`cds-intelligence: inserted ${inserted} alerts from ${alerts.length} detected issues`);
  return inserted;
}
module.exports = { runIntelligenceScan };