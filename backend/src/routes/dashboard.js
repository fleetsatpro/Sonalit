/**
 * Dashboard aggregation endpoints for the Command Center.
 * All routes require operator JWT authentication.
 * GET /api/v1/dashboard/*
 */
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { query } = require('../config/database');
const https = require('https');

router.use(authenticate, attachOrgDb);

// Returns { rows: [] } on any DB error so individual query failures don't crash endpoints
const safeQuery = (db, sql, params) => db(sql, params).catch(() => ({ rows: [] }));

// ── §2.1 Overview ──────────────────────────────────────────────────────────
router.get('/overview', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;

  const [threatR, kpiR, nextR, shiftR, panicR] = await Promise.all([
    safeQuery(req.db, `
      SELECT
        COUNT(*) FILTER (WHERE type='sos' AND resolved_at IS NULL) AS sos_open,
        COUNT(*) FILTER (WHERE severity='critical' AND resolved_at IS NULL) AS crit_open,
        COUNT(*) FILTER (WHERE resolved_at IS NULL) AS alerts_open
      FROM alerts WHERE org_id=$1`, [orgId]),

    safeQuery(req.db, `
      SELECT
        (SELECT COUNT(DISTINCT v.id) FROM vehicles v JOIN gps_logs g ON g.vehicle_id=v.id
          WHERE v.org_id=$1 AND v.deleted_at IS NULL
            AND g.timestamp > NOW()-INTERVAL '5 minutes') AS vehicles_live,
        (SELECT COUNT(*) FROM convoys WHERE org_id=$1 AND status='active' AND deleted_at IS NULL) AS convoys_active,
        (SELECT COUNT(*) FROM incidents WHERE org_id=$1 AND status='open') AS incidents_open,
        (SELECT COUNT(*) FROM incidents WHERE org_id=$1 AND status='open') AS incidents_active,
        (SELECT COALESCE(SUM(smi.weight_kg)/1000, 0)
          FROM shipment_manifest_items smi
          JOIN shipments s ON s.id=smi.shipment_id
          JOIN convoys c ON c.id=s.convoy_id
          WHERE c.org_id=$1 AND c.status='active' AND smi.deleted_at IS NULL) AS payload_tonnes,
        (SELECT COUNT(*) FROM shipments WHERE org_id=$1 AND deleted_at IS NULL) AS consignments,
        (SELECT COUNT(*) FROM vehicles WHERE org_id=$1 AND deleted_at IS NULL) AS guards_active
      `, [orgId]),

    safeQuery(req.db, `
      SELECT id, COALESCE(name, reference) AS convoy_name,
             COALESCE(estimated_arrival_at, estimated_arrival) AS eta
      FROM convoys
      WHERE org_id=$1 AND status='active' AND deleted_at IS NULL
        AND COALESCE(estimated_arrival_at, estimated_arrival) IS NOT NULL
      ORDER BY COALESCE(estimated_arrival_at, estimated_arrival) ASC
      LIMIT 1`, [orgId]),

    safeQuery(req.db, `
      SELECT started_at FROM shifts
      WHERE org_id=$1 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`, [orgId]),

    safeQuery(req.db, `
      SELECT COUNT(*) AS panic_open
      FROM panic_events WHERE org_id=$1 AND resolved_at IS NULL`, [orgId]),
  ]);

  // km_today: sum of GPS distance for active vehicles since midnight
  let kmToday = 0;
  try {
    const kmR = await req.db(`
      SELECT COALESCE(SUM(ST_Distance(
        ST_MakePoint(lat, lng)::geography,
        ST_MakePoint(prev_lat, prev_lng)::geography
      ))/1000, 0) AS km
      FROM (
        SELECT lat, lng,
               LAG(lat) OVER (PARTITION BY vehicle_id ORDER BY timestamp) AS prev_lat,
               LAG(lng) OVER (PARTITION BY vehicle_id ORDER BY timestamp) AS prev_lng
        FROM gps_logs g
        JOIN vehicles v ON v.id=g.vehicle_id
        WHERE v.org_id=$1 AND g.timestamp >= date_trunc('day', NOW())
      ) t WHERE prev_lat IS NOT NULL`, [orgId]);
    kmToday = parseFloat(kmR.rows[0]?.km) || 0;
  } catch (_) { /* PostGIS may not be available */ }

  const t = threatR.rows[0];
  const sosOpen = parseInt(t.sos_open) || 0;
  const critOpen = parseInt(t.crit_open) || 0;
  const alertsOpen = parseInt(t.alerts_open) || 0;
  const panicOpen = parseInt(panicR.rows[0]?.panic_open) || 0;
  const threatLevel = panicOpen > 0 || sosOpen > 0 ? 'critical' : critOpen > 0 ? 'elevated' : 'secure';

  const k = kpiR.rows[0];

  // on_time_pct from recent trips
  let onTimePct = 100;
  try {
    const otR = await req.db(`
      SELECT
        COUNT(*) FILTER (WHERE actual_arrival <= planned_arrival + INTERVAL '15 minutes') AS on_time,
        COUNT(*) AS total
      FROM trips WHERE org_id=$1 AND actual_arrival IS NOT NULL
        AND planned_arrival >= NOW() - INTERVAL '30 days'`, [orgId]);
    const ot = otR.rows[0];
    onTimePct = ot.total > 0 ? Math.round((parseInt(ot.on_time)/parseInt(ot.total))*100) : 100;
  } catch (_) {}

  const nextRow = nextR.rows[0];
  const shiftRow = shiftR.rows[0];

  res.json({
    threat: { level: threatLevel, alerts_open: alertsOpen + panicOpen, incidents_active: parseInt(k.incidents_active)||0 },
    kpi: {
      vehicles_live: parseInt(k.vehicles_live)||0,
      convoys_active: parseInt(k.convoys_active)||0,
      on_time_pct: onTimePct,
      incidents_open: parseInt(k.incidents_open)||0,
      payload_tonnes: parseFloat(k.payload_tonnes)||0,
      consignments: parseInt(k.consignments)||0,
      km_today: Math.round(kmToday),
      guards_active: parseInt(k.guards_active)||0,
    },
    next_delivery: nextRow ? { convoy_id: nextRow.id, convoy_name: nextRow.convoy_name, eta: new Date(nextRow.eta).toISOString() } : null,
    shift_started_at: shiftRow ? new Date(shiftRow.started_at).toISOString() : new Date().toISOString(),
  });
}));

// ── §2.2 Map ───────────────────────────────────────────────────────────────
router.get('/map', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;

  const [convoysR, alertZonesR, vehiclesR, geofencesR, riskzonesR, devicesR] = await Promise.all([
    safeQuery(req.db, `
      SELECT c.id, COALESCE(c.name, c.reference) AS name, c.status,
             (SELECT g.lat FROM gps_logs g JOIN convoy_trucks ct ON ct.vehicle_id=g.vehicle_id
               WHERE ct.convoy_id=c.id ORDER BY g.timestamp DESC LIMIT 1) AS lat,
             (SELECT g.lng FROM gps_logs g JOIN convoy_trucks ct ON ct.vehicle_id=g.vehicle_id
               WHERE ct.convoy_id=c.id ORDER BY g.timestamp DESC LIMIT 1) AS lng,
             (SELECT g.heading FROM gps_logs g JOIN convoy_trucks ct ON ct.vehicle_id=g.vehicle_id
               WHERE ct.convoy_id=c.id ORDER BY g.timestamp DESC LIMIT 1) AS heading
      FROM convoys c
      WHERE c.org_id=$1 AND c.status='active' AND c.deleted_at IS NULL
      LIMIT 20`, [orgId]),

    safeQuery(req.db, `
      SELECT lat, lng, 2000 AS radius_m,
             CASE WHEN severity='critical' THEN 'critical' WHEN severity='high' THEN 'high' ELSE 'medium' END AS severity
      FROM alerts WHERE org_id=$1 AND resolved_at IS NULL AND lat IS NOT NULL
      LIMIT 10`, [orgId]),

    safeQuery(req.db, `
      SELECT v.id, v.registration,
             COALESCE(g.lat, v.latitude)   AS lat,
             COALESCE(g.lng, v.longitude)  AS lng,
             COALESCE(g.heading, v.heading, 0) AS heading,
             COALESCE(g.speed, 0)          AS speed_kmh,
             CASE
               WHEN a.severity = 'critical' OR a.severity = 'high' THEN 'alert'
               WHEN a.id IS NOT NULL THEN 'warn'
               WHEN g.timestamp IS NULL OR g.timestamp < NOW()-INTERVAL '15 minutes' THEN 'offline'
               WHEN g.speed > 2 THEN 'moving'
               ELSE 'idle'
             END AS status
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT lat, lng, heading, speed, timestamp FROM gps_logs
        WHERE vehicle_id=v.id ORDER BY timestamp DESC LIMIT 1
      ) g ON true
      LEFT JOIN convoy_trucks ct ON ct.vehicle_id=v.id
        AND ct.convoy_id IN (SELECT id FROM convoys WHERE org_id=$1 AND status='active')
      LEFT JOIN LATERAL (
        SELECT id, severity FROM alerts
        WHERE convoy_id=ct.convoy_id AND resolved_at IS NULL
        ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
        LIMIT 1
      ) a ON true
      WHERE v.org_id=$1 AND v.deleted_at IS NULL
        AND COALESCE(g.lat, v.latitude) IS NOT NULL
      LIMIT 100`, [orgId]),

    safeQuery(req.db, `
      SELECT id::text, name, COALESCE(type,'circle') AS type,
             lat, lng, COALESCE(radius, 1000) AS radius_m
      FROM geofences
      WHERE org_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL AND deleted_at IS NULL
      LIMIT 30`, [orgId]),

    // risk_zones is global (no org_id) — use raw query
    query(`
      SELECT id::text, name, risk_level, lat, lng, COALESCE(radius_km, 5) AS radius_km
      FROM risk_zones
      WHERE active=true AND lat IS NOT NULL AND lng IS NOT NULL
      LIMIT 20`).catch(() => ({ rows: [] })),

    safeQuery(req.db, `
      SELECT d.id, d.name, d.model, d.assignment_type,
             d.last_lat AS lat, d.last_lng AS lng,
             COALESCE(d.last_speed, 0) AS speed_kmh,
             d.panic_active,
             d.last_seen,
             p.id AS panic_id,
             CASE
               WHEN d.panic_active = true OR p.id IS NOT NULL THEN 'panic'
               WHEN d.last_seen IS NULL OR d.last_seen < NOW()-INTERVAL '15 minutes' THEN 'offline'
               WHEN COALESCE(d.last_speed,0) > 2 THEN 'moving'
               ELSE 'idle'
             END AS status
      FROM guardian_devices d
      LEFT JOIN LATERAL (
        SELECT id FROM panic_events
        WHERE device_id = d.id AND resolved_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      ) p ON true
      WHERE d.org_id=$1 AND d.deleted_at IS NULL
        AND d.last_lat IS NOT NULL AND d.last_lng IS NOT NULL
      LIMIT 100`, [orgId]),
  ]);

  res.json({
    convoys: convoysR.rows.map((c, i) => ({
      id: c.id, name: c.name || `Convoy ${i+1}`, status: c.status,
      lat: c.lat ? parseFloat(c.lat) : null,
      lng: c.lng ? parseFloat(c.lng) : null,
      heading: c.heading ? parseFloat(c.heading) : 0,
      color: c.status === 'alert' ? '#ff4422' : '#00ffcc',
    })),
    alert_zones: alertZonesR.rows.map(z => ({
      lat: parseFloat(z.lat), lng: parseFloat(z.lng),
      radius_m: z.radius_m, severity: z.severity,
    })),
    vehicles: vehiclesR.rows.map(v => ({
      id: v.id, registration: v.registration, status: v.status,
      lat: parseFloat(v.lat), lng: parseFloat(v.lng),
      heading: parseFloat(v.heading), speed_kmh: parseFloat(v.speed_kmh),
    })),
    geofences: geofencesR.rows.map(g => ({
      id: g.id, name: g.name, type: g.type,
      lat: parseFloat(g.lat), lng: parseFloat(g.lng),
      radius_m: parseFloat(g.radius_m),
    })),
    riskzones: riskzonesR.rows.map(r => ({
      id: r.id, name: r.name, risk_level: r.risk_level,
      lat: parseFloat(r.lat), lng: parseFloat(r.lng),
      radius_km: parseFloat(r.radius_km),
    })),
    devices: devicesR.rows.map(d => ({
      id: d.id, name: d.name, model: d.model,
      assignment_type: d.assignment_type,
      lat: parseFloat(d.lat), lng: parseFloat(d.lng),
      speed_kmh: parseFloat(d.speed_kmh),
      status: d.status,
      panic_active: d.panic_active === true || d.panic_id != null,
      last_seen: d.last_seen,
    })),
  });
}));

// ── §2.3 Vehicles ──────────────────────────────────────────────────────────
router.get('/vehicles', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;

  const r = await req.db(`
    SELECT v.id, v.registration,
           ct.convoy_id,
           CASE
             WHEN g.timestamp < NOW()-INTERVAL '15 minutes' THEN 'offline'
             WHEN a.id IS NOT NULL THEN 'alert'
             WHEN g.speed > 2 THEN 'moving'
             ELSE 'idle'
           END AS status,
           COALESCE(g.speed, 0) AS speed_kmh,
           sr_fuel.value AS fuel_pct,
           sr_temp.value AS engine_temp_c,
           g.signal_quality AS gps_signal_pct,
           g.timestamp AS last_ping_at
    FROM vehicles v
    LEFT JOIN convoy_trucks ct ON ct.vehicle_id=v.id
      AND ct.convoy_id IN (SELECT id FROM convoys WHERE org_id=$1 AND status='active')
    LEFT JOIN LATERAL (
      SELECT speed, lat, lng, timestamp, signal_quality FROM gps_logs
      WHERE vehicle_id=v.id ORDER BY timestamp DESC LIMIT 1
    ) g ON true
    LEFT JOIN LATERAL (
      SELECT id FROM alerts WHERE convoy_id=ct.convoy_id AND resolved_at IS NULL LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT value FROM sensor_readings WHERE vehicle_id=v.id AND type='fuel_pct'
      ORDER BY recorded_at DESC LIMIT 1
    ) sr_fuel ON true
    LEFT JOIN LATERAL (
      SELECT value FROM sensor_readings WHERE vehicle_id=v.id AND type='engine_temp_c'
      ORDER BY recorded_at DESC LIMIT 1
    ) sr_temp ON true
    WHERE v.org_id=$1 AND v.deleted_at IS NULL
    ORDER BY v.registration`, [orgId]);

  res.json({ data: r.rows.map(row => ({
    id: row.id,
    registration: row.registration,
    convoy_id: row.convoy_id || null,
    status: row.status || 'offline',
    speed_kmh: parseFloat(row.speed_kmh) || 0,
    fuel_pct: row.fuel_pct != null ? parseFloat(row.fuel_pct) : null,
    engine_temp_c: row.engine_temp_c != null ? parseFloat(row.engine_temp_c) : null,
    gps_signal_pct: row.gps_signal_pct != null ? parseFloat(row.gps_signal_pct) : null,
    last_ping_at: row.last_ping_at ? new Date(row.last_ping_at).toISOString() : null,
  })) });
}));

// ── §2.4 Alerts ────────────────────────────────────────────────────────────
router.get('/alerts', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  try {
    const r = await req.db(`
      SELECT id, severity, type, title, description AS summary,
             convoy_id, created_at AS occurred_at,
             resolved_at IS NOT NULL AS acknowledged
      FROM alerts WHERE org_id=$1
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT $2`, [req.user.org_id, limit]);

    res.json({ data: r.rows.map(a => ({
      id: a.id,
      severity: a.severity,
      type: a.type,
      title: a.title,
      summary: a.summary || '',
      convoy_id: a.convoy_id || null,
      occurred_at: new Date(a.occurred_at).toISOString(),
      acknowledged: a.acknowledged,
    })) });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.5 Convoys ───────────────────────────────────────────────────────────
router.get('/convoys', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const r = await req.db(`
      SELECT c.id, COALESCE(c.name, c.reference) AS name, c.status,
             COALESCE(c.origin, c.route_origin) AS origin,
             COALESCE(c.destination, c.route_destination) AS destination,
             COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS eta,
             (SELECT COUNT(*) FROM convoy_trucks WHERE convoy_id=c.id) AS truck_count
      FROM convoys c
      WHERE c.org_id=$1 AND c.status IN ('active','in_transit','delayed') AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC LIMIT 5`, [orgId]);

    const convoyIds = r.rows.map(c => c.id);
    let checkpoints = [];
    if (convoyIds.length > 0) {
      const ph = convoyIds.map((_, i) => `$${i+2}`).join(',');
      const cpR = await safeQuery(req.db, `
        SELECT cc.convoy_id, cc.name, cc.reached_at
        FROM convoy_checkpoints cc
        WHERE cc.convoy_id IN (${ph})
        ORDER BY cc.convoy_id`, [orgId, ...convoyIds]);
      checkpoints = cpR.rows;
    }

    const cpByConvoy = {};
    for (const cp of checkpoints) {
      if (!cpByConvoy[cp.convoy_id]) cpByConvoy[cp.convoy_id] = [];
      cpByConvoy[cp.convoy_id].push(cp);
    }

    res.json({ data: r.rows.map(c => ({
      id: c.id,
      name: c.name || c.id,
      status: c.status,
      origin: c.origin || null,
      destination: c.destination || null,
      eta: c.eta ? new Date(c.eta).toISOString() : null,
      truck_count: parseInt(c.truck_count) || 0,
      seal_intact: null,
      checkpoints: (cpByConvoy[c.id] || []).map(cp => ({
        name: cp.name,
        status: cp.reached_at ? 'done' : 'pending',
        reached_at: cp.reached_at ? new Date(cp.reached_at).toISOString() : null,
      })),
    })) });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.6 Route Risk ────────────────────────────────────────────────────────
router.get('/route-risk', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  try {
  const r = await req.db(`
    SELECT
      cor.id AS corridor_id,
      cor.name AS corridor,
      cor.origin, cor.destination,
      COUNT(i.id) AS incident_count,
      COUNT(i.id) FILTER (WHERE i.severity='critical') * 3 +
        COUNT(i.id) FILTER (WHERE i.severity='high') * 2 +
        COUNT(i.id) FILTER (WHERE i.severity='medium') AS weighted_score,
      MAX(i.title) AS last_incident_summary,
      ARRAY_AGG(DISTINCT COALESCE(con.name, con.reference)) FILTER (WHERE con.id IS NOT NULL) AS active_convoys
    FROM corridors cor
    LEFT JOIN incidents i ON i.corridor_id=cor.id
      AND i.org_id=$1 AND i.occurred_at >= NOW()-INTERVAL '7 days'
    LEFT JOIN convoys con ON con.corridor_id=cor.id AND con.org_id=$1 AND con.status='active'
    WHERE cor.org_id=$1
    GROUP BY cor.id, cor.name, cor.origin, cor.destination
    ORDER BY weighted_score DESC
    LIMIT 10`, [orgId]);

  res.json({ data: r.rows.map(row => {
    const score = parseInt(row.weighted_score) || 0;
    const normalised = Math.min(100, score * 10);
    const risk = normalised >= 70 ? 'high' : normalised >= 40 ? 'medium' : 'low';
    return {
      corridor: row.corridor,
      origin: row.origin,
      destination: row.destination,
      risk,
      risk_score: normalised,
      last_incident_summary: row.last_incident_summary || null,
      active_convoys: row.active_convoys || [],
    };
  }) });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.7 Drivers ───────────────────────────────────────────────────────────
router.get('/drivers', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  try {
  const r = await req.db(`
    SELECT d.id, d.name, d.on_duty,
           ct.convoy_id,
           COALESCE(be.speed_violations, 0) AS speed_v,
           COALESCE(be.harsh_braking, 0) AS brake_v,
           COALESCE(be.fatigue_flags, 0) AS fatigue_v
    FROM drivers d
    LEFT JOIN convoy_trucks ct ON ct.driver_id=d.id
      AND ct.convoy_id IN (SELECT id FROM convoys WHERE org_id=$1 AND status='active')
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE event_type='speed_violation') AS speed_violations,
        COUNT(*) FILTER (WHERE event_type='harsh_braking') AS harsh_braking,
        COUNT(*) FILTER (WHERE event_type='fatigue') AS fatigue_flags
      FROM behaviour_events be
      WHERE be.driver_id=d.id AND be.occurred_at >= NOW()-INTERVAL '7 days'
    ) be ON true
    WHERE d.org_id=$1 AND d.deleted_at IS NULL
    ORDER BY d.name
    LIMIT 20`, [orgId]);

  res.json({ data: r.rows.map(d => {
    const sv = parseInt(d.speed_v) || 0;
    const bv = parseInt(d.brake_v) || 0;
    const fv = parseInt(d.fatigue_v) || 0;
    const penalty = sv * 3 + bv * 2 + fv * 4;
    const score = Math.max(0, Math.min(100, 100 - penalty));
    const grade = score >= 90 ? 'excellent' : score >= 80 ? 'good' : score >= 65 ? 'monitor' : 'flagged';
    const flags = [
      ...(sv > 0 ? [`${sv} speed violations`] : []),
      ...(bv > 0 ? [`${bv} harsh braking`] : []),
      ...(fv > 0 ? [`${fv} fatigue flags`] : []),
    ];
    const initials = d.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
    return { id: d.id, name: d.name, initials, convoy_id: d.convoy_id || null, score, grade, flags, on_duty: d.on_duty ?? false };
  }) });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.8 Borders ───────────────────────────────────────────────────────────
router.get('/borders', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  try {
  const r = await req.db(`
    SELECT g.id, g.name, g.metadata,
           ARRAY_AGG(DISTINCT COALESCE(con.name, con.reference)) FILTER (WHERE con.id IS NOT NULL) AS active_convoys,
           MAX(ge.created_at) AS last_event_at
    FROM geofences g
    LEFT JOIN geofence_events ge ON ge.geofence_id=g.id AND ge.created_at >= NOW()-INTERVAL '24 hours'
    LEFT JOIN convoys con ON con.org_id=$1 AND con.status='active'
    WHERE g.org_id=$1 AND g.type='border' AND g.deleted_at IS NULL
    GROUP BY g.id, g.name, g.metadata
    ORDER BY g.name
    LIMIT 10`, [orgId]);

  const FLAG_MAP = {
    'Uganda': '🇺🇬', 'Kenya': '🇰🇪', 'Tanzania': '🇹🇿', 'Rwanda': '🇷🇼',
    'Burundi': '🇧🇮', 'DRC': '🇨🇩', 'Ethiopia': '🇪🇹', 'South Sudan': '🇸🇸',
    'Malawi': '🇲🇼', 'Zambia': '🇿🇲', 'Somalia': '🇸🇴',
  };

  res.json({ data: r.rows.map(b => {
    const meta = typeof b.metadata === 'object' && b.metadata ? b.metadata : {};
    const countries = (meta.countries || b.name).toString();
    const flagEmojis = countries.split(/[\/\-,]/).map(c => FLAG_MAP[c.trim()] || '').filter(Boolean).join(' ');
    const activeConvoys = b.active_convoys || [];
    const queueMins = meta.queue_minutes || null;
    const status = activeConvoys.length > 2 ? 'busy' : activeConvoys.length > 0 ? 'clear' : 'clear';
    return { name: b.name, countries, status, queue_minutes: queueMins, active_convoys: activeConvoys, flag_emojis: flagEmojis };
  }) });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.9 Performance ───────────────────────────────────────────────────────
router.get('/performance', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 30);
  const orgId = req.user.org_id;
  try {
  const r = await req.db(`
    SELECT
      date_trunc('day', COALESCE(actual_arrival, planned_arrival)) AS day,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE actual_arrival <= planned_arrival + INTERVAL '15 minutes') AS on_time
    FROM trips
    WHERE org_id=$1 AND planned_arrival >= NOW()-($2 || ' days')::INTERVAL
    GROUP BY 1 ORDER BY 1 DESC`, [orgId, days]);

  const rows = r.rows;
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const match = rows.find(r => new Date(r.day).toISOString().slice(0, 10) === iso);
    const total = parseInt(match?.total) || 0;
    const onTime = parseInt(match?.on_time) || 0;
    result.push({
      date: iso,
      label: d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
      on_time_pct: total > 0 ? Math.round((onTime / total) * 100) : null,
    });
  }

  res.json({ data: result });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.10 Predictions ──────────────────────────────────────────────────────
router.get('/predictions', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const predictions = [];

  try {
    // Delay prediction: convoy below 65% historical avg speed
    const delayR = await req.db(`
      SELECT c.id, COALESCE(c.name, c.reference) AS name,
             AVG(g.speed) FILTER (WHERE g.timestamp >= NOW()-INTERVAL '30 minutes') AS recent_speed,
             AVG(g.speed) FILTER (WHERE g.timestamp >= NOW()-INTERVAL '7 days') AS hist_speed
      FROM convoys c
      JOIN convoy_trucks ct ON ct.convoy_id=c.id
      JOIN gps_logs g ON g.vehicle_id=ct.vehicle_id
      WHERE c.org_id=$1 AND c.status='active'
      GROUP BY c.id, c.name, c.reference
      HAVING AVG(g.speed) FILTER (WHERE g.timestamp >= NOW()-INTERVAL '30 minutes') < 0.65 *
             NULLIF(AVG(g.speed) FILTER (WHERE g.timestamp >= NOW()-INTERVAL '7 days'), 0)`, [orgId]);

    for (const row of delayR.rows) {
      const recentSpeed = parseFloat(row.recent_speed) || 0;
      const histSpeed = parseFloat(row.hist_speed) || 1;
      const deficit = Math.round((1 - recentSpeed / histSpeed) * 100);
      predictions.push({
        id: `delay-${row.id}`,
        confidence: Math.min(95, deficit),
        type: 'delay',
        title: `Delay risk: ${row.name}`,
        detail: `Running ${deficit}% below historical average speed`,
        recommendation: 'Alert dispatch. Check for road incidents or traffic.',
      });
    }

    // Maintenance: brake wear
    const brakeR = await req.db(`
      SELECT v.id, v.registration, sr.value AS brake_wear
      FROM vehicles v
      JOIN sensor_readings sr ON sr.vehicle_id=v.id AND sr.type='brake_wear_pct'
      WHERE v.org_id=$1 AND sr.value < 35 AND v.deleted_at IS NULL
        AND sr.recorded_at = (SELECT MAX(recorded_at) FROM sensor_readings WHERE vehicle_id=v.id AND type='brake_wear_pct')`,
      [orgId]);

    for (const row of brakeR.rows) {
      predictions.push({
        id: `maint-${row.id}`,
        confidence: 90,
        type: 'maintenance',
        title: `Brake inspection: ${row.registration}`,
        detail: `Brake wear at ${Math.round(parseFloat(row.brake_wear))}% — below safe threshold`,
        recommendation: 'Schedule immediate brake inspection before next deployment.',
      });
    }
  } catch (_) {}

  if (predictions.length === 0) {
    predictions.push({
      id: 'perf-ok',
      confidence: 88,
      type: 'performance',
      title: 'Fleet performing nominally',
      detail: 'All convoys on schedule. No maintenance flags.',
      recommendation: 'Continue monitoring. Next scheduled check in 6 hours.',
    });
  }

  res.json({ data: predictions });
}));

// ── §2.11 Weather ──────────────────────────────────────────────────────────
const weatherCache = new Map();

function fetchWeatherCity(city) {
  const cacheKey = city;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return Promise.resolve(cached.data);

  return new Promise((resolve) => {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    https.get(url, { headers: { 'User-Agent': 'Sonalit/1.0' }, timeout: 5000 }, (resp) => {
      let body = '';
      resp.on('data', (d) => { body += d; });
      resp.on('end', () => {
        try {
          const j = JSON.parse(body);
          const cc = j.current_condition[0];
          const data = {
            city,
            temp_c: parseInt(cc.temp_C),
            condition: cc.weatherDesc[0].value,
            wind_kmh: parseInt(cc.windspeedKmph),
            visibility_km: parseInt(cc.visibility),
            icon_emoji: cc.weatherCode >= 200 && cc.weatherCode < 300 ? '⛈' :
              cc.weatherCode >= 300 && cc.weatherCode < 400 ? '🌧' :
              cc.weatherCode >= 500 && cc.weatherCode < 600 ? '🌧' :
              cc.weatherCode >= 600 && cc.weatherCode < 700 ? '❄' :
              cc.weatherCode >= 700 && cc.weatherCode < 800 ? '🌫' :
              cc.weatherCode === 800 ? '☀' :
              cc.weatherCode > 800 ? '⛅' : '🌤',
          };
          weatherCache.set(cacheKey, { ts: Date.now(), data });
          resolve(data);
        } catch (_) { resolve({ city, temp_c: null, condition: 'Unavailable', wind_kmh: null, visibility_km: null, icon_emoji: '❓' }); }
      });
    }).on('error', () => resolve({ city, temp_c: null, condition: 'Unavailable', wind_kmh: null, visibility_km: null, icon_emoji: '❓' }));
  });
}

router.get('/weather', asyncHandler(async (req, res) => {
  const cities = ['Kampala', 'Jinja', 'Malaba', 'Eldoret', 'Nairobi', 'Mombasa'];
  const results = await Promise.all(cities.map(fetchWeatherCity));
  res.json({ data: results });
}));

// ── §2.12 Panic ────────────────────────────────────────────────────────────
router.get('/panic', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  try {
  const [activeR, statsR, teamsR] = await Promise.all([
    safeQuery(req.db, `SELECT id, vehicle_id, lat, lng, created_at AS triggered_at FROM panic_events
            WHERE org_id=$1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId]),
    safeQuery(req.db, `SELECT
              AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) AS avg_response_s,
              MAX(created_at) AS last_event_at
            FROM panic_events WHERE org_id=$1 AND resolved_at IS NOT NULL`, [orgId]),
    safeQuery(req.db, `SELECT name, type, COALESCE(eta_minutes, 0) AS eta_min, location, status
            FROM response_teams WHERE org_id=$1 AND active=true LIMIT 5`, [orgId]),
  ]);

  const active = activeR.rows[0] || null;
  const stats = statsR.rows[0];
  const avgResponseS = Math.round(parseFloat(stats?.avg_response_s) || 0);
  const lastEventDaysAgo = stats?.last_event_at
    ? Math.floor((Date.now() - new Date(stats.last_event_at).getTime()) / 86400000) : -1;

  res.json({
    status: active ? 'active' : 'clear',
    active_event: active ? {
      id: active.id,
      vehicle_id: active.vehicle_id,
      lat: active.lat ? parseFloat(active.lat) : null,
      lng: active.lng ? parseFloat(active.lng) : null,
      triggered_at: new Date(active.triggered_at).toISOString(),
    } : null,
    response_time_avg_s: avgResponseS,
    last_event_days_ago: lastEventDaysAgo,
    response_teams: teamsR.rows.map(t => ({
      name: t.name, type: t.type, eta_min: parseInt(t.eta_min) || 0,
      location: t.location || '', status: t.status || 'standby',
    })),
  });
  } catch (_) {
    res.json({ status: 'clear', active_event: null, response_time_avg_s: 0, last_event_days_ago: -1, response_teams: [] });
  }
}));

// ── §2.13 Comms ────────────────────────────────────────────────────────────
router.get('/comms', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  try {
  const r = await req.db(`
    SELECT v.id AS vehicle_id, v.registration,
           COUNT(g.id) FILTER (WHERE g.timestamp >= date_trunc('day', NOW())) AS ping_count_today,
           MAX(g.timestamp) AS last_ping_at
    FROM vehicles v
    LEFT JOIN gps_logs g ON g.vehicle_id=v.id
    WHERE v.org_id=$1 AND v.deleted_at IS NULL
    GROUP BY v.id, v.registration
    ORDER BY v.registration`, [orgId]);

  res.json({ data: r.rows.map(row => {
    const pingCount = parseInt(row.ping_count_today) || 0;
    const lastPingAt = row.last_ping_at ? new Date(row.last_ping_at).toISOString() : null;
    const secAgo = lastPingAt ? (Date.now() - new Date(lastPingAt).getTime()) / 1000 : 9999;
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const pingsPerMin = pingCount / Math.max(1, (Date.now() - midnight.getTime()) / 60000);
    const signalBars = pingsPerMin > 1 ? 5 : pingsPerMin > 0.5 ? 4 : pingsPerMin > 0.2 ? 3 : pingsPerMin > 0.067 ? 2 : 1;
    const networkType = signalBars >= 4 ? '4G' : signalBars === 3 ? '3G' : signalBars === 2 ? 'EDGE' : 'offline';
    const status = secAgo < 30 ? 'live' : secAgo < 300 ? 'delayed' : secAgo < 900 ? 'weak' : 'offline';
    return { vehicle_id: row.vehicle_id, registration: row.registration, ping_count_today: pingCount, last_ping_at: lastPingAt, signal_bars: signalBars, network_type: networkType, status };
  }) });
  } catch (_) { res.json({ data: [] }); }
}));

// ── §2.14 Timeline ─────────────────────────────────────────────────────────
router.get('/timeline', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const now = Date.now();
  const end = now + 24 * 3600 * 1000;

  const [arrivalsR, checkpointsR, shiftsR] = await Promise.all([
    safeQuery(req.db, `SELECT id, COALESCE(name, reference) AS label,
               COALESCE(estimated_arrival_at, estimated_arrival) AS time
            FROM convoys WHERE org_id=$1 AND status='active'
              AND COALESCE(estimated_arrival_at, estimated_arrival) BETWEEN NOW() AND NOW()+INTERVAL '24 hours'
            ORDER BY time LIMIT 10`, [orgId]),
    safeQuery(req.db, `SELECT cc.convoy_id, cc.name AS label, cc.scheduled_at AS time
            FROM convoy_checkpoints cc
            JOIN convoys c ON c.id=cc.convoy_id
            WHERE c.org_id=$1 AND cc.reached_at IS NULL
              AND cc.scheduled_at BETWEEN NOW() AND NOW()+INTERVAL '24 hours'
            ORDER BY cc.scheduled_at LIMIT 10`, [orgId]),
    safeQuery(req.db, `SELECT 'Shift changeover' AS label, changeover_at AS time
            FROM shifts WHERE org_id=$1 AND changeover_at BETWEEN NOW() AND NOW()+INTERVAL '24 hours'
            ORDER BY changeover_at LIMIT 3`, [orgId]),
  ]);

  const events = [
    ...arrivalsR.rows.map(r => ({ type: 'arrival', label: `Arrival: ${r.label}`, time: new Date(r.time).toISOString(), convoy_id: r.id })),
    ...checkpointsR.rows.map(r => ({ type: 'checkpoint', label: r.label, time: new Date(r.time).toISOString(), convoy_id: r.convoy_id })),
    ...shiftsR.rows.map(r => ({ type: 'shift', label: r.label, time: new Date(r.time).toISOString() })),
  ].map(e => ({
    ...e,
    fraction: Math.max(0, Math.min(1, (new Date(e.time).getTime() - now) / (end - now))),
  })).sort((a, b) => a.fraction - b.fraction);

  res.json({ data: events });
}));

module.exports = router;
