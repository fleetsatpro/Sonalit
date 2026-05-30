/**
 * Cargo Owner Portal routes.
 *
 * Public (portal token):
 *   GET  /api/v1/portal/convoy           — view convoy status
 *   GET  /api/v1/portal/convoy/custody-pdf — download custody chain PDF
 *
 * Admin (JWT + role):
 *   POST   /api/v1/portal/tokens         — issue token
 *   GET    /api/v1/portal/tokens         — list tokens for a convoy
 *   DELETE /api/v1/portal/tokens/:id     — revoke token
 */
const router = require('express').Router();
const crypto = require('crypto');
const Joi = require('joi');
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { portalAuth } = require('../middleware/portalAuth');
const { generateCustodyPdf } = require('../utils/custodyPdfGenerator');
const { asyncHandler } = require('../middleware/error');

// ─── Portal-token-authenticated routes ───────────────────────────────────────

// GET /api/v1/portal/convoy
router.get('/convoy', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const result = await req.db(
    `SELECT
       c.id                                          AS convoy_id,
       c.org_id,
       COALESCE(c.reference, c.name)                AS reference,
       c.status,
       COALESCE(c.origin, c.route_origin)           AS origin,
       COALESCE(c.destination, c.route_destination) AS destination,
       COALESCE(c.departed_at, c.departure_time)    AS departed_at,
       c.arrived_at,
       COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS estimated_arrival_at,
       (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id) AS vehicle_count,
       (SELECT g.lat  FROM gps_logs g WHERE g.vehicle_id = ANY(
          SELECT ct2.vehicle_id FROM convoy_trucks ct2 WHERE ct2.convoy_id = c.id)
          ORDER BY g.recorded_at DESC LIMIT 1) AS last_known_lat,
       (SELECT g.lng  FROM gps_logs g WHERE g.vehicle_id = ANY(
          SELECT ct2.vehicle_id FROM convoy_trucks ct2 WHERE ct2.convoy_id = c.id)
          ORDER BY g.recorded_at DESC LIMIT 1) AS last_known_lng,
       (SELECT g.recorded_at FROM gps_logs g WHERE g.vehicle_id = ANY(
          SELECT ct2.vehicle_id FROM convoy_trucks ct2 WHERE ct2.convoy_id = c.id)
          ORDER BY g.recorded_at DESC LIMIT 1) AS last_location_at,
       c.seal_intact
     FROM convoys c
    WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [convoy_id],
  );

  if (!result.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const row = result.rows[0];
  res.json({
    data: {
      ...row,
      vehicle_count: parseInt(row.vehicle_count) || 0,
      cargo_owner_ref: req.portal.cargo_owner_ref,
    },
  });
}));

// GET /api/v1/portal/convoy/custody-pdf
router.get('/convoy/custody-pdf', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const convoyResult = await req.db(
    `SELECT
       c.id, c.org_id, c.status, c.seal_intact,
       COALESCE(c.reference, c.name)                AS reference,
       COALESCE(c.origin, c.route_origin)           AS origin,
       COALESCE(c.destination, c.route_destination) AS destination,
       COALESCE(c.departed_at, c.departure_time)    AS departed_at,
       c.arrived_at,
       COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS estimated_arrival_at,
       (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id) AS vehicle_count
     FROM convoys c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [convoy_id],
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const convoy = {
    ...convoyResult.rows[0],
    vehicle_count: parseInt(convoyResult.rows[0].vehicle_count) || 0,
    cargo_owner_ref: req.portal.cargo_owner_ref,
  };

  const posResult = await req.db(
    `SELECT g.lat, g.lng, g.recorded_at, g.speed_kmh, g.source
       FROM gps_logs g
       JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
      WHERE ct.convoy_id = $1
      ORDER BY g.recorded_at DESC
      LIMIT 200`,
    [convoy_id],
  );

  const pdfBuffer = await generateCustodyPdf({ convoy, positions: posResult.rows });

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="custody-${convoy.reference}-${Date.now()}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });
  res.end(pdfBuffer);
}));

// ─── Admin routes (JWT) ───────────────────────────────────────────────────────

const issueSchema = Joi.object({
  convoy_id: Joi.string().uuid().required(),
  cargo_owner_ref: Joi.string().max(128).optional(),
  ttl_hours: Joi.number().integer().min(1).max(168).default(24),
});

// POST /api/v1/portal/tokens — issue
router.post('/tokens', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const { error, value } = issueSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoyCheck = await req.db(
    `SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [value.convoy_id],
  );
  if (!convoyCheck.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + value.ttl_hours * 3600 * 1000);

  await req.db(
    `INSERT INTO portal_tokens (org_id, convoy_id, token_hash, cargo_owner_ref, expires_at, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.org_id, value.convoy_id, tokenHash, value.cargo_owner_ref ?? null, expiresAt, req.user.id],
  );

  res.status(201).json({
    data: {
      token: rawToken,
      convoy_id: value.convoy_id,
      org_id: req.user.org_id,
      cargo_owner_ref: value.cargo_owner_ref ?? null,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    },
  });
}));

// GET /api/v1/portal/tokens?convoy_id=
router.get('/tokens', authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const convoyId = req.query.convoy_id;
  if (!convoyId) return res.status(400).json({ error: 'convoy_id query param required' });
  if (!/^[0-9a-f-]{36}$/i.test(convoyId)) return res.status(400).json({ error: 'convoy_id must be a UUID' });

  const result = await req.db(
    `SELECT pt.id, pt.convoy_id, pt.cargo_owner_ref, pt.issued_at, pt.expires_at,
            pt.last_used_at, pt.revoked_at, u.name AS issued_by_name
       FROM portal_tokens pt
       LEFT JOIN users u ON u.id = pt.issued_by
      WHERE pt.convoy_id = $1
      ORDER BY pt.issued_at DESC`,
    [convoyId],
  );

  res.json({ data: result.rows });
}));

// DELETE /api/v1/portal/tokens/:id — revoke
router.delete('/tokens/:id', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE portal_tokens
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Token not found or already revoked' });
  res.json({ data: { id: result.rows[0].id, revoked: true } });
}));

module.exports = router;
