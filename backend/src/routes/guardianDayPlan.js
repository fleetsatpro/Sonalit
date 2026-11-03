// Guardian Convoy — Day Plans
// CFO sets a plan each morning: start point, night park location, waypoints.
// Waypoints are auto-detected client-side by GPS; CFO taps to confirm reaching.
const router = require('express').Router();
const { query } = require('../config/database');
const { jwtAuth } = require('./guardianConvoy');

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateCoord(lat, lng) {
  return isFiniteNum(lat) && isFiniteNum(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function validateWaypoints(waypoints) {
  if (!Array.isArray(waypoints)) return 'waypoints must be an array';
  if (waypoints.length > 20) return 'maximum 20 waypoints';
  for (const wp of waypoints) {
    if (!wp || typeof wp.label !== 'string' || !wp.label.trim()) return 'each waypoint needs a label';
    if (!validateCoord(wp.lat, wp.lng)) return `waypoint "${wp.label}" has invalid coordinates`;
    if (wp.radius_m != null && (!isFiniteNum(wp.radius_m) || wp.radius_m < 50 || wp.radius_m > 10000))
      return `waypoint "${wp.label}" radius must be 50–10000 m`;
  }
  return null;
}

async function fetchPlanWithWaypoints(planId) {
  const [planRes, wpRes] = await Promise.all([
    query(`SELECT * FROM convoy_day_plans WHERE id = $1`, [planId]),
    query(`SELECT id, seq, label, lat, lng, radius_m, reached_at, reached_lat, reached_lng
           FROM convoy_day_plan_waypoints WHERE plan_id = $1 ORDER BY seq`, [planId]),
  ]);
  if (!planRes.rows.length) return null;
  return { ...planRes.rows[0], waypoints: wpRes.rows };
}

// GET /day-plan/:convoy_id — today's plan for this CFO (null if not set yet)
router.get('/day-plan/:convoy_id', jwtAuth, async (req, res, next) => {
  try {
    const planRes = await query(
      `SELECT id FROM convoy_day_plans
       WHERE convoy_id = $1 AND cfo_id = $2 AND date = CURRENT_DATE`,
      [req.params.convoy_id, req.cfo.id]
    );
    if (!planRes.rows.length) return res.json({ plan: null });
    const plan = await fetchPlanWithWaypoints(planRes.rows[0].id);
    return res.json({ plan });
  } catch (err) {
    next(err);
  }
});

// POST /day-plan — create today's plan
router.post('/day-plan', jwtAuth, async (req, res, next) => {
  try {
    const {
      convoy_id, start_label, start_lat, start_lng,
      night_park_label, night_park_lat, night_park_lng, waypoints = [],
    } = req.body;

    if (!convoy_id || typeof convoy_id !== 'string')
      return res.status(400).json({ error: 'convoy_id is required' });
    if (!night_park_label || typeof night_park_label !== 'string' || !night_park_label.trim())
      return res.status(400).json({ error: 'night_park_label is required' });
    if (start_lat != null && !validateCoord(start_lat, start_lng))
      return res.status(400).json({ error: 'invalid start coordinates' });
    if (night_park_lat != null && !validateCoord(night_park_lat, night_park_lng))
      return res.status(400).json({ error: 'invalid night park coordinates' });
    const wpError = validateWaypoints(waypoints);
    if (wpError) return res.status(400).json({ error: wpError });

    const existing = await query(
      `SELECT id FROM convoy_day_plans WHERE convoy_id = $1 AND cfo_id = $2 AND date = CURRENT_DATE`,
      [convoy_id, req.cfo.id]
    );
    if (existing.rows.length)
      return res.status(409).json({ error: 'Day plan already exists for today', plan_id: existing.rows[0].id });

    const planRes = await query(
      `INSERT INTO convoy_day_plans
         (org_id, convoy_id, cfo_id, start_label, start_lat, start_lng,
          night_park_label, night_park_lat, night_park_lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.cfo.org_id, convoy_id, req.cfo.id,
       start_label?.trim() || null, start_lat ?? null, start_lng ?? null,
       night_park_label.trim(), night_park_lat ?? null, night_park_lng ?? null]
    );
    const planId = planRes.rows[0].id;

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      await query(
        `INSERT INTO convoy_day_plan_waypoints (org_id, plan_id, seq, label, lat, lng, radius_m)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.cfo.org_id, planId, i + 1, wp.label.trim(), wp.lat, wp.lng, wp.radius_m ?? 500]
      );
    }

    const plan = await fetchPlanWithWaypoints(planId);
    return res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
});

// PATCH /day-plan/:id — modify the plan (emergency reroute / night park change)
router.patch('/day-plan/:id', jwtAuth, async (req, res, next) => {
  try {
    const { night_park_label, night_park_lat, night_park_lng, waypoints, modified_reason } = req.body;

    const owned = await query(
      `SELECT id FROM convoy_day_plans WHERE id = $1 AND cfo_id = $2`,
      [req.params.id, req.cfo.id]
    );
    if (!owned.rows.length)
      return res.status(404).json({ error: 'Day plan not found or not owned by this CFO' });

    if (night_park_label != null && (typeof night_park_label !== 'string' || !night_park_label.trim()))
      return res.status(400).json({ error: 'night_park_label must be a non-empty string' });
    if (night_park_lat != null && !validateCoord(night_park_lat, night_park_lng))
      return res.status(400).json({ error: 'invalid night park coordinates' });
    if (waypoints != null) {
      const wpError = validateWaypoints(waypoints);
      if (wpError) return res.status(400).json({ error: wpError });
    }

    await query(
      `UPDATE convoy_day_plans SET
         night_park_label = COALESCE($1, night_park_label),
         night_park_lat   = COALESCE($2, night_park_lat),
         night_park_lng   = COALESCE($3, night_park_lng),
         modified_at      = NOW(),
         modified_reason  = COALESCE($4, modified_reason)
       WHERE id = $5`,
      [night_park_label?.trim() ?? null, night_park_lat ?? null, night_park_lng ?? null,
       typeof modified_reason === 'string' ? modified_reason.trim() : null, req.params.id]
    );

    if (waypoints != null) {
      // Replace unreached waypoints only — reached ones are historical record
      await query(
        `DELETE FROM convoy_day_plan_waypoints WHERE plan_id = $1 AND reached_at IS NULL`,
        [req.params.id]
      );
      const maxSeq = await query(
        `SELECT COALESCE(MAX(seq), 0) AS max FROM convoy_day_plan_waypoints WHERE plan_id = $1`,
        [req.params.id]
      );
      let seq = Number(maxSeq.rows[0].max);
      for (const wp of waypoints) {
        seq += 1;
        await query(
          `INSERT INTO convoy_day_plan_waypoints (org_id, plan_id, seq, label, lat, lng, radius_m)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.cfo.org_id, req.params.id, seq, wp.label.trim(), wp.lat, wp.lng, wp.radius_m ?? 500]
        );
      }
    }

    const plan = await fetchPlanWithWaypoints(req.params.id);
    return res.json({ plan });
  } catch (err) {
    next(err);
  }
});

// POST /day-plan/:id/waypoints/:wpId/reach — CFO confirms reaching a waypoint
router.post('/day-plan/:id/waypoints/:wpId/reach', jwtAuth, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (!validateCoord(lat, lng))
      return res.status(400).json({ error: 'lat and lng are required' });

    const result = await query(
      `UPDATE convoy_day_plan_waypoints wp
       SET reached_at = NOW(), reached_lat = $1, reached_lng = $2
       FROM convoy_day_plans p
       WHERE wp.id = $3 AND wp.plan_id = $4 AND p.id = wp.plan_id
         AND p.cfo_id = $5 AND wp.reached_at IS NULL
       RETURNING wp.id, wp.seq, wp.label, wp.reached_at`,
      [lat, lng, req.params.wpId, req.params.id, req.cfo.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Waypoint not found, already reached, or not owned by this CFO' });
    return res.json({ waypoint: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
