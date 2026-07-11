const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');
const { runOsintSweep, isSweeping } = require('../utils/riskOsint');
const { query: rawQuery } = require('../config/database');
const logger = require('../utils/logger');

router.use(authenticate);
router.use(attachOrgDb);

// ─── GET /zones ───────────────────────────────────────────────────────────────

router.get('/zones', asyncHandler(async (req, res) => {
  const continent = req.query.continent || null;
  const level = req.query.level || null;

  const { rows } = await req.db(
    `SELECT rz.*,
       COALESCE(s.total_events, 0) AS events,
       COALESCE(s.events_24h, 0)   AS events_24h,
       COALESCE(s.week_data, '[]'::json) AS week_data
     FROM risk_zones rz
     LEFT JOIN risk_zone_stats s ON s.zone_id = rz.id AND s.org_id = rz.org_id
     WHERE rz.is_active = true
       AND ($1::text IS NULL OR rz.continent = $1)
       AND ($2::text IS NULL OR rz.level = $2)
     ORDER BY
       CASE rz.level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       COALESCE(s.total_events, 0) DESC`,
    [continent, level]
  );

  const counts = { high: 0, medium: 0, low: 0, total: rows.length };
  for (const z of rows) {
    if (z.level === 'high')   counts.high++;
    else if (z.level === 'medium') counts.medium++;
    else                      counts.low++;
  }

  res.json({ zones: rows, counts });
}));

// ─── GET /zones/:zoneId/events ────────────────────────────────────────────────

router.get('/zones/:zoneId/events', asyncHandler(async (req, res) => {
  const { zoneId } = req.params;

  const { rows } = await req.db(
    `SELECT * FROM risk_events
     WHERE zone_id = $1
     ORDER BY occurred_at DESC
     LIMIT 20`,
    [zoneId]
  );

  res.json({ events: rows });
}));

// ─── GET /convoys ─────────────────────────────────────────────────────────────

router.get('/convoys', asyncHandler(async (req, res) => {
  const continent = req.query.continent || null;

  const { rows } = await req.db(
    `SELECT c.id, COALESCE(c.name, c.reference) AS name, c.status,
       array_agg(DISTINCT rz.zone_code) AS affected_zones,
       MAX(CASE rz.level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS level_rank
     FROM convoys c
     JOIN convoy_risk_zones crz ON crz.convoy_id = c.id
     JOIN risk_zones rz ON rz.id = crz.zone_id AND rz.is_active = true
       AND ($1::text IS NULL OR rz.continent = $1)
     WHERE c.deleted_at IS NULL
     GROUP BY c.id, c.name, c.reference, c.status
     ORDER BY level_rank DESC`,
    [continent]
  );

  const convoys = rows.map(r => ({
    ...r,
    highest_level: r.level_rank === 3 ? 'high' : r.level_rank === 2 ? 'medium' : 'low',
  }));

  res.json({ convoys });
}));

// ─── GET /ticker ──────────────────────────────────────────────────────────────

router.get('/ticker', asyncHandler(async (req, res) => {
  const { rows } = await req.db(
    `SELECT re.level, rz.zone_code, re.description AS text, re.occurred_at
     FROM risk_events re
     JOIN risk_zones rz ON rz.id = re.zone_id AND rz.is_active = true
     ORDER BY re.occurred_at DESC
     LIMIT 12`,
    []
  );

  res.json({ items: rows });
}));

// ─── POST /zones (admin only) ─────────────────────────────────────────────────

router.post('/zones', asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }

  const orgId = req.user.org_id;
  const {
    name, description, zone_code, continent, level, region,
    why, when_active, precaution, tags, map_lon, map_lat,
    confidence, velocity, lat, lng, radius_km, zone_type,
    risk_level, is_active,
  } = req.body;

  if (!name || lat == null || lng == null) {
    return res.status(400).json({ error: 'name, lat, lng are required' });
  }

  const { rows } = await req.db(
    `INSERT INTO risk_zones (
       org_id, name, description, zone_code, continent, level, region,
       why, when_active, precaution, tags, map_lon, map_lat,
       confidence, velocity, lat, lng, radius_km, zone_type,
       risk_level, is_active, active, created_by, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,
       $20,$21,$21,$22,NOW(),NOW()
     ) RETURNING *`,
    [
      orgId, name, description || null, zone_code || null, continent || null,
      level || 'medium', region || null,
      why || null, when_active || null, precaution || null,
      tags || null, map_lon || null, map_lat || null,
      confidence != null ? confidence : 70,
      velocity || 'stable',
      lat, lng, radius_km || 5, zone_type || 'conflict',
      risk_level || level || 'medium',
      is_active !== false,
      req.user.id,
    ]
  );

  const row = rows[0];
  await publish(`risk:updates:${orgId}`, {
    type: 'zone_updated',
    zone_id: row.id,
    org_id: orgId,
  });

  res.status(201).json({ zone: row });
}));

// ─── PATCH /zones/:zoneId ─────────────────────────────────────────────────────

router.patch('/zones/:zoneId', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const { zoneId } = req.params;

  const allowed = [
    'level', 'precaution', 'velocity', 'confidence', 'why', 'when_active',
    'region', 'tags', 'map_lon', 'map_lat', 'name', 'is_active',
  ];

  const setClauses = [];
  const values = [];

  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      values.push(req.body[field]);
      setClauses.push(`${field} = $${values.length}`);
    }
  }

  if (!setClauses.length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(zoneId);
  const { rows } = await req.db(
    `UPDATE risk_zones
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  if (!rows.length) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  const row = rows[0];
  await publish(`risk:updates:${orgId}`, {
    type: 'zone_updated',
    zone_id: row.id,
    org_id: orgId,
  });

  res.json({ zone: row });
}));

// ─── POST /zones/:zoneId/events ───────────────────────────────────────────────

router.post('/zones/:zoneId/events', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const { zoneId } = req.params;
  const { description, level, source } = req.body;

  if (!description || !level) {
    return res.status(400).json({ error: 'description and level are required' });
  }

  const { rows } = await req.db(
    `INSERT INTO risk_events (org_id, zone_id, description, level, source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [orgId, zoneId, description, level, source || 'manual']
  );

  const row = rows[0];
  await publish(`risk:updates:${orgId}`, {
    type: 'event_added',
    zone_id: zoneId,
    org_id: orgId,
  });

  res.status(201).json({ event: row });
}));

// ─── GET /export ──────────────────────────────────────────────────────────────

router.get('/export', asyncHandler(async (req, res) => {
  const continent = req.query.continent || null;
  const level = req.query.level || null;

  const { rows } = await req.db(
    `SELECT rz.*,
       COALESCE(s.total_events, 0) AS events,
       COALESCE(s.events_24h, 0)   AS events_24h,
       COALESCE(s.week_data, '[]'::json) AS week_data
     FROM risk_zones rz
     LEFT JOIN risk_zone_stats s ON s.zone_id = rz.id AND s.org_id = rz.org_id
     WHERE rz.is_active = true
       AND ($1::text IS NULL OR rz.continent = $1)
       AND ($2::text IS NULL OR rz.level = $2)
     ORDER BY
       CASE rz.level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       COALESCE(s.total_events, 0) DESC`,
    [continent, level]
  );

  const header = 'zone_code,continent,level,name,region,why,precaution,confidence,velocity,events';
  const csvEscape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [header];
  for (const z of rows) {
    lines.push([
      z.zone_code, z.continent, z.level, z.name, z.region,
      z.why, z.precaution, z.confidence, z.velocity, z.events,
    ].map(csvEscape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="risk-report.csv"');
  res.send(lines.join('\n'));
}));

// ─── POST /refresh-intel (admin only) ──────────────────────────────────────
// Lets an admin force the OSINT sweep now instead of waiting for the next
// scheduled run (every 2 hours — see backend/src/utils/riskOsint.js). The
// sweep itself (several external HTTP calls per zone) can take a minute or
// more, so this responds immediately and runs it in the background; the
// frontend re-polls risk-zones/ticker shortly after to pick up the results.
router.post('/refresh-intel', asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  if (isSweeping()) {
    return res.json({ started: false, message: 'A refresh is already running — try again shortly.' });
  }

  runOsintSweep()
    .then(() => rawQuery('REFRESH MATERIALIZED VIEW CONCURRENTLY risk_zone_stats'))
    .catch(err => logger.error('Manual Risk Intel OSINT sweep failed: ' + err.message));

  res.json({ started: true, message: 'Refreshing risk intel from OSINT sources — this can take a minute.' });
}));

module.exports = router;
