const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.use(authenticate);

function parseLatLng(row) {
  // Normalize double-serialized JSON strings (JSON.stringify called twice)
  let coordinates = row.coordinates;
  if (typeof coordinates === 'string') {
    try { coordinates = JSON.parse(coordinates); } catch (_) {}
  }

  let lat = row.lat != null ? parseFloat(row.lat) : null;
  let lng = row.lng != null ? parseFloat(row.lng) : null;
  if ((!lat || !lng) && coordinates) {
    try {
      const c = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
      if (c && !Array.isArray(c)) {
        lat = parseFloat(c.lat || c.center?.lat || c.latitude) || null;
        lng = parseFloat(c.lng || c.center?.lng || c.longitude) || null;
      }
    } catch (_) {}
  }
  return { ...row, coordinates, lat, lng };
}

async function ensureGeofenceActions() {
  await query(`
    CREATE TABLE IF NOT EXISTS geofence_actions (
      id               SERIAL PRIMARY KEY,
      geofence_id      INTEGER REFERENCES geofences(id) ON DELETE CASCADE,
      action_type      VARCHAR(50) NOT NULL,
      recipient        VARCHAR(500),
      message_template TEXT,
      enabled          BOOLEAN DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

router.get('/', async (req, res, next) => {
  try {
    const db = req.db || query;
    const { rows } = await db(`SELECT * FROM geofences ORDER BY created_at DESC`);
    res.json({ data: rows.map(parseLatLng) });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const db = req.db || query;
    const { name, type = 'circle', radius, region } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    let coordinates = req.body.coordinates;
    const lat = req.body.lat;
    const lng = req.body.lng;
    if (!coordinates && lat != null && lng != null) {
      coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) };
    }
    const { rows } = await db(
      `INSERT INTO geofences (name, type, coordinates, radius, region) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, type, JSON.stringify(coordinates), radius, region]
    );
    res.status(201).json({ data: parseLatLng(rows[0]) });
  } catch (err) { next(err); }
});

async function updateGeofence(req, res, next) {
  try {
    const db = req.db || query;
    const { name, active, coordinates, radius } = req.body;
    const { rows } = await db(
      `UPDATE geofences SET name=COALESCE($1,name), active=COALESCE($2,active), coordinates=COALESCE($3,coordinates), radius=COALESCE($4,radius), updated_at=NOW() WHERE id=$5 RETURNING *`,
      [name, active, coordinates ? JSON.stringify(coordinates) : null, radius, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Geofence not found' });
    res.json({ data: parseLatLng(rows[0]) });
  } catch (err) { next(err); }
}

router.put('/:id', updateGeofence);
router.patch('/:id', updateGeofence);

router.delete('/:id', async (req, res, next) => {
  try {
    const db = req.db || query;
    await db(`DELETE FROM geofences WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/actions', async (req, res, next) => {
  try {
    const db = req.db || query;
    const { rows } = await db(`SELECT * FROM geofence_actions WHERE geofence_id = $1 ORDER BY created_at`, [req.params.id]);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/actions', async (req, res, next) => {
  try {
    await ensureGeofenceActions();
    const db = req.db || query;
    const { action_type, recipient, message_template } = req.body;
    if (!action_type) return res.status(400).json({ error: 'action_type is required' });
    const { rows } = await db(
      `INSERT INTO geofence_actions (action_type, recipient, message_template, geofence_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [action_type, recipient || null, message_template || null, req.params.id]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id/actions/:actionId', async (req, res, next) => {
  try {
    const db = req.db || query;
    await db(`DELETE FROM geofence_actions WHERE id = $1 AND geofence_id = $2`, [req.params.actionId, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.patch('/:id/actions/:actionId/toggle', async (req, res, next) => {
  try {
    const db = req.db || query;
    const { rows } = await db(
      `UPDATE geofence_actions SET enabled = NOT enabled WHERE id = $1 AND geofence_id = $2 RETURNING *`,
      [req.params.actionId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Action not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
