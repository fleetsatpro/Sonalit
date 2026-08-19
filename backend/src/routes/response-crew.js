const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { publish } = require('../realtime/centrifugo');
const logger = require('../utils/logger');

router.use(authenticate);

// ── GET /teams — list active response teams ──────────────────────────────────
router.get('/teams', authorize('admin', 'dispatcher', 'operator', 'response_crew'), async (req, res) => {
  try {
    const r = await req.db(
      `SELECT id, name, type, callsign, location, base_lat, base_lng,
              eta_minutes, status, active, created_at
       FROM response_teams WHERE org_id = $1 AND active = true
       ORDER BY name`, [req.user.org_id]
    );
    res.json({ data: r.rows });
  } catch (err) {
    logger.error('response-crew/teams error:', err);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// ── POST /teams — create a response team ─────────────────────────────────────
router.post('/teams', authorize('admin', 'dispatcher'), async (req, res) => {
  const { name, type, callsign, location, base_lat, base_lng, eta_minutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const r = await req.db(
      `INSERT INTO response_teams (org_id, name, type, callsign, location, base_lat, base_lng, eta_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.org_id, name, type || 'reaction', callsign || null, location || null,
       base_lat || null, base_lng || null, eta_minutes || 0]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    logger.error('response-crew/teams create error:', err);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// ── GET /dispatches — active intercept dispatches ────────────────────────────
router.get('/dispatches', authorize('admin', 'dispatcher', 'operator', 'response_crew'), async (req, res) => {
  const activeOnly = req.query.active_only !== 'false';
  try {
    const where = activeOnly
      ? `AND d.status IN ('dispatched','acknowledged','en_route','on_scene')`
      : '';
    const r = await req.db(
      `SELECT d.*, t.name AS team_name, t.callsign AS team_callsign, t.type AS team_type
       FROM intercept_dispatches d
       JOIN response_teams t ON t.id = d.team_id
       WHERE d.org_id = $1 ${where}
       ORDER BY d.dispatched_at DESC
       LIMIT 50`, [req.user.org_id]
    );
    res.json({ data: r.rows });
  } catch (err) {
    logger.error('response-crew/dispatches error:', err);
    res.status(500).json({ error: 'Failed to fetch dispatches' });
  }
});

// ── GET /dispatches/mine — dispatches for the crew member's team ─────────────
router.get('/dispatches/mine', authorize('response_crew'), async (req, res) => {
  try {
    const memberR = await req.db(
      `SELECT team_id FROM response_crew_members WHERE user_id = $1 AND active = true LIMIT 1`,
      [req.user.id]
    );
    const teamId = memberR.rows[0]?.team_id;
    if (!teamId) return res.json({ data: [] });

    const r = await req.db(
      `SELECT d.*, t.name AS team_name, t.callsign AS team_callsign
       FROM intercept_dispatches d
       JOIN response_teams t ON t.id = d.team_id
       WHERE d.team_id = $1 AND d.status IN ('dispatched','acknowledged','en_route','on_scene')
       ORDER BY CASE d.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                d.dispatched_at DESC
       LIMIT 20`, [teamId]
    );
    res.json({ data: r.rows });
  } catch (err) {
    logger.error('response-crew/dispatches/mine error:', err);
    res.status(500).json({ error: 'Failed to fetch your dispatches' });
  }
});

// ── POST /dispatch — dispatch a team to intercept ────────────────────────────
router.post('/dispatch', authorize('admin', 'dispatcher', 'operator'), async (req, res) => {
  const { team_id, alert_id, panic_id, convoy_id, vehicle_id, priority, reason, target_lat, target_lng, target_label } = req.body;
  if (!team_id || !reason || target_lat == null || target_lng == null) {
    return res.status(400).json({ error: 'team_id, reason, target_lat, target_lng are required' });
  }
  try {
    const teamR = await req.db(
      `SELECT id, name, callsign, type FROM response_teams WHERE id = $1 AND org_id = $2 AND active = true`,
      [team_id, req.user.org_id]
    );
    if (!teamR.rows.length) return res.status(404).json({ error: 'Team not found' });
    const team = teamR.rows[0];

    const r = await req.db(
      `INSERT INTO intercept_dispatches
        (org_id, team_id, alert_id, panic_id, convoy_id, vehicle_id, priority, reason,
         target_lat, target_lng, target_label, dispatched_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'dispatched') RETURNING *`,
      [req.user.org_id, team_id, alert_id || null, panic_id || null,
       convoy_id || null, vehicle_id || null, priority || 'high', reason,
       target_lat, target_lng, target_label || null, req.user.id]
    );
    const dispatch = r.rows[0];

    await req.db(
      `UPDATE response_teams SET status = 'deployed', updated_at = now() WHERE id = $1`,
      [team_id]
    );

    publish(`org#${req.user.org_id}`, {
      type: 'crew.dispatched',
      dispatch_id: dispatch.id,
      team_id: team.id,
      team_name: team.name,
      team_callsign: team.callsign,
      priority: dispatch.priority,
      reason,
      target_lat,
      target_lng,
      target_label: target_label || null,
      dispatched_at: dispatch.dispatched_at,
    });

    res.status(201).json({ data: dispatch });
  } catch (err) {
    logger.error('response-crew/dispatch error:', err);
    res.status(500).json({ error: 'Failed to dispatch team' });
  }
});

// ── PATCH /dispatches/:id/status — update dispatch status ────────────────────
router.patch('/dispatches/:id/status', authorize('admin', 'dispatcher', 'operator', 'response_crew'), async (req, res) => {
  const { id } = req.params;
  const { status, resolution_note } = req.body;
  const valid = ['acknowledged', 'en_route', 'on_scene', 'resolved', 'cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  }

  try {
    const tsCol = status === 'acknowledged' ? 'acknowledged_at'
      : status === 'resolved' || status === 'cancelled' ? 'resolved_at'
      : status === 'on_scene' ? 'arrived_at' : null;
    const setClauses = [`status = $2`];
    const params = [id, status];
    if (tsCol) {
      setClauses.push(`${tsCol} = now()`);
    }
    if (resolution_note) {
      params.push(resolution_note);
      setClauses.push(`resolution_note = $${params.length}`);
    }

    const r = await req.db(
      `UPDATE intercept_dispatches SET ${setClauses.join(', ')}
       WHERE id = $1 AND org_id = $${params.length + 1} RETURNING *`,
      [...params, req.user.org_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Dispatch not found' });
    const dispatch = r.rows[0];

    if (status === 'resolved' || status === 'cancelled') {
      await req.db(
        `UPDATE response_teams SET status = 'standby', updated_at = now() WHERE id = $1`,
        [dispatch.team_id]
      );
    }

    const teamR = await req.db(`SELECT name, callsign FROM response_teams WHERE id = $1`, [dispatch.team_id]);

    publish(`org#${req.user.org_id}`, {
      type: 'crew.status_update',
      dispatch_id: dispatch.id,
      team_id: dispatch.team_id,
      team_name: teamR.rows[0]?.name,
      team_callsign: teamR.rows[0]?.callsign,
      status,
      target_lat: dispatch.target_lat,
      target_lng: dispatch.target_lng,
      updated_at: new Date().toISOString(),
    });

    res.json({ data: dispatch });
  } catch (err) {
    logger.error('response-crew/dispatch status error:', err);
    res.status(500).json({ error: 'Failed to update dispatch status' });
  }
});

module.exports = router;
