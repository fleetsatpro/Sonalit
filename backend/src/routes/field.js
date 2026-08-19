/**
 * Sonalit Field app API — device pairing + per-worker PIN.
 * Mounted at /api/v1/field.
 *
 * Two halves, deliberately split by path prefix:
 *
 *   /field/app/*    the tablet talking. Authenticated by X-Field-Device and,
 *                   once a worker signs in, X-Field-Token. No cookies, so
 *                   these are exempt from CSRF double-submit (middleware/csrf.js)
 *                   on the same grounds as the Guardian device API.
 *   /field/admin/*  the operator dashboard managing tablets and PINs. Ordinary
 *                   JWT + CSRF, admin/dispatcher only.
 *
 * Nothing here touches users.password_hash, refresh_tokens, or the auth
 * cookies. That is the whole point: signing into the Field app must not sign
 * anyone in or out of the operator app, in either direction.
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const {
  FIELD_ROLES, SESSION_HOURS,
  sha256, newToken, newPairingCode, hashCode,
  requireDevice, fieldAuthenticate,
} = require('../middleware/fieldAuth');
const logger = require('../utils/logger');

const PAIRING_TTL_HOURS = 24;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const rl = (max, message) => rateLimit({
  windowMs: 900_000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: message },
});

// Pairing is unauthenticated by necessity — the tablet has no credential yet —
// so it is the one endpoint here worth brute-forcing. 8 characters of a
// 29-symbol alphabet plus a 24h expiry plus this limiter is the whole defence.
const pairLimiter = rl(10, 'Too many pairing attempts');
// The DB-backed per-worker lockout below is the real control; this just stops
// one device hammering the whole roster.
const signInLimiter = rl(40, 'Too many sign-in attempts');

/**
 * PINs are short by design (gloves, cold hands, a queue of trucks waiting), so
 * the obvious ones have to be refused outright — a lockout after 5 attempts is
 * no help if half the yard picks 1234.
 */
function validatePin(pin) {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    return 'PIN must be 4 to 8 digits.';
  }
  if (/^(\d)\1+$/.test(pin)) return 'PIN cannot be a single repeated digit.';
  const asc = '0123456789';
  const desc = '9876543210';
  if (asc.includes(pin) || desc.includes(pin)) return 'PIN cannot be a run of consecutive digits.';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Device-facing: /field/app/*
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/field/app/pair — exchange a one-time pairing code for a device
 * token. The code is consumed on success, so a code read off a screen and left
 * on a whiteboard cannot enrol a second tablet.
 */
router.post('/app/pair', pairLimiter, asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  const result = await query(
    `SELECT * FROM field_devices
      WHERE pairing_code_hash = $1
        AND status <> 'revoked'
        AND pairing_expires_at > NOW()`,
    [hashCode(code)]
  );
  if (!result.rows.length) {
    return res.status(401).json({ error: 'invalid_pairing_code', message: 'That pairing code is not valid or has expired.' });
  }

  const device = result.rows[0];
  const token = newToken();

  // Re-pairing an already-active device replaces its token, which silently
  // logs out the old handset — the intended behaviour when a tablet is
  // replaced and the admin reuses the same device record.
  await query(
    `UPDATE field_devices
        SET token_hash = $1, status = 'active', paired_at = NOW(),
            last_seen_at = NOW(), pairing_code_hash = NULL, pairing_expires_at = NULL
      WHERE id = $2`,
    [sha256(token), device.id]
  );
  await query(
    `UPDATE field_sessions SET revoked_at = NOW()
      WHERE device_id = $1 AND revoked_at IS NULL`,
    [device.id]
  );

  logger.info(`Field device paired: ${device.label} (${device.id})`);
  res.json({
    data: {
      device_token: token,
      device: { id: device.id, label: device.label, site: device.site, scope: device.scope },
    },
  });
}));

/**
 * GET /api/v1/field/app/device — who am I paired as?
 * The app calls this on boot to confirm its stored token still works; a 401
 * here is how a revoked tablet learns to drop back to the pairing screen.
 */
router.get('/app/device', requireDevice, asyncHandler(async (req, res) => {
  const d = req.fieldDevice;
  res.json({
    data: {
      id: d.id, label: d.label, site: d.site, scope: d.scope, paired_at: d.paired_at,
    },
  });
}));

/**
 * GET /api/v1/field/app/workers — the roster shown on the sign-in screen.
 *
 * Names only. This is a list of who may use this tablet, on a tablet that has
 * already proved it is ours; it deliberately carries no email, no phone, and
 * nothing that would be worth harvesting if the device were stolen.
 */
router.get('/app/workers', requireDevice, asyncHandler(async (req, res) => {
  const d = req.fieldDevice;
  const roles = d.scope === 'yard' ? ['yard_agent']
    : d.scope === 'port' ? ['port_agent']
      : FIELD_ROLES;

  const result = await query(
    `SELECT u.id, u.name, u.role,
            (p.user_id IS NOT NULL) AS has_pin,
            (p.locked_until IS NOT NULL AND p.locked_until > NOW()) AS locked
       FROM users u
       LEFT JOIN field_agent_pins p ON p.user_id = u.id
      WHERE u.org_id = $1
        AND u.role = ANY($2)
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      ORDER BY u.name`,
    [d.org_id, roles]
  );
  res.json({ data: result.rows });
}));

/**
 * POST /api/v1/field/app/sign-in — worker taps their name, enters their PIN.
 */
router.post('/app/sign-in', requireDevice, signInLimiter, asyncHandler(async (req, res) => {
  const { user_id, pin } = req.body || {};
  if (!user_id || !pin) return res.status(400).json({ error: 'user_id and pin are required' });

  const d = req.fieldDevice;
  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.org_id,
            p.pin_hash, p.must_change, p.failed_attempts, p.locked_until
       FROM users u
       LEFT JOIN field_agent_pins p ON p.user_id = u.id
      WHERE u.id = $1 AND u.org_id = $2 AND u.status = 'active' AND u.deleted_at IS NULL`,
    [user_id, d.org_id]
  );

  // One generic failure for "no such worker", "no PIN set" and "wrong PIN":
  // the roster endpoint already tells the tablet who exists, so there is
  // nothing to protect there, but a distinct "no PIN set" reply would tell an
  // attacker exactly which account to target with the pairing code they found.
  const deny = () => res.status(401).json({ error: 'invalid_pin', message: 'Wrong PIN. Try again.' });

  if (!result.rows.length) return deny();
  const u = result.rows[0];
  if (!FIELD_ROLES.includes(u.role)) return deny();

  if (d.scope && d.scope !== (u.role === 'yard_agent' ? 'yard' : 'port')) {
    return res.status(403).json({
      error: 'wrong_device_scope',
      message: `This device is set up for ${d.scope} work only.`,
    });
  }

  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(u.locked_until) - Date.now()) / 60000));
    return res.status(423).json({
      error: 'pin_locked',
      message: `Too many wrong PINs. Locked for ${mins} more minute${mins === 1 ? '' : 's'}. A supervisor can unlock it.`,
    });
  }

  if (!u.pin_hash || !(await bcrypt.compare(String(pin), u.pin_hash))) {
    if (u.pin_hash) {
      const attempts = Number(u.failed_attempts || 0) + 1;
      const lock = attempts >= MAX_PIN_ATTEMPTS;
      await query(
        `UPDATE field_agent_pins
            SET failed_attempts = $1,
                locked_until = CASE WHEN $2 THEN NOW() + ($3 || ' minutes')::INTERVAL ELSE locked_until END
          WHERE user_id = $4`,
        [lock ? 0 : attempts, lock, String(LOCKOUT_MINUTES), u.id]
      );
      if (lock) {
        return res.status(423).json({
          error: 'pin_locked',
          message: `Too many wrong PINs. Locked for ${LOCKOUT_MINUTES} minutes. A supervisor can unlock it.`,
        });
      }
    }
    return deny();
  }

  await query(
    'UPDATE field_agent_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1',
    [u.id]
  );

  // One session per worker per device: signing in ends any session they left
  // open on this tablet, so a stale token from a previous shift can't be
  // replayed after someone else has taken over.
  await query(
    `UPDATE field_sessions SET revoked_at = NOW()
      WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [d.id, u.id]
  );

  const token = newToken();
  await query(
    `INSERT INTO field_sessions (org_id, device_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' hours')::INTERVAL)`,
    [d.org_id, d.id, u.id, sha256(token), String(SESSION_HOURS)]
  );

  await query('UPDATE field_devices SET last_seen_at = NOW() WHERE id = $1', [d.id]);
  logger.info(`Field sign-in: ${u.name} on ${d.label}`);

  res.json({
    data: {
      token,
      expires_in_hours: SESSION_HOURS,
      must_change_pin: Boolean(u.must_change),
      user: { id: u.id, name: u.name, role: u.role, org_id: u.org_id },
      device: { id: d.id, label: d.label, site: d.site, scope: d.scope },
    },
  });
}));

/** GET /api/v1/field/app/me — used by the app to re-hydrate after a reload. */
router.get('/app/me', fieldAuthenticate, asyncHandler(async (req, res) => {
  const d = req.fieldDevice;
  res.json({
    data: {
      user: { id: req.user.id, name: req.user.name, role: req.user.role, org_id: req.user.org_id },
      device: { id: d.id, label: d.label, site: d.site, scope: d.scope },
    },
  });
}));

/**
 * POST /api/v1/field/app/pin — worker changes their own PIN.
 * Required on first sign-in (must_change), because the PIN an admin typed into
 * a form and read out loud must not be the one still in service at the gate.
 */
router.post('/app/pin', fieldAuthenticate, asyncHandler(async (req, res) => {
  const { current_pin, new_pin } = req.body || {};
  const problem = validatePin(new_pin);
  if (problem) return res.status(400).json({ error: 'weak_pin', message: problem });

  const cur = await query('SELECT pin_hash FROM field_agent_pins WHERE user_id = $1', [req.user.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'no_pin_set' });
  if (!(await bcrypt.compare(String(current_pin || ''), cur.rows[0].pin_hash))) {
    return res.status(401).json({ error: 'invalid_pin', message: 'Current PIN is wrong.' });
  }

  await query(
    `UPDATE field_agent_pins
        SET pin_hash = $1, must_change = FALSE, failed_attempts = 0,
            locked_until = NULL, updated_at = NOW()
      WHERE user_id = $2`,
    [await bcrypt.hash(String(new_pin), 10), req.user.id]
  );
  res.json({ data: { ok: true } });
}));

/** POST /api/v1/field/app/sign-out — hand the tablet to the next crew. */
router.post('/app/sign-out', fieldAuthenticate, asyncHandler(async (req, res) => {
  await query('UPDATE field_sessions SET revoked_at = NOW() WHERE id = $1', [req.fieldSessionId]);
  res.json({ data: { ok: true } });
}));

// ═══════════════════════════════════════════════════════════════════════════
// Operator-facing: /field/admin/*
// ═══════════════════════════════════════════════════════════════════════════

router.use('/admin', authenticate);

/** GET /api/v1/field/admin/devices — the tablet fleet. */
router.get('/admin/devices', authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.id, d.label, d.site, d.scope, d.status, d.paired_at, d.last_seen_at,
            d.created_at, d.revoked_at,
            (d.pairing_code_hash IS NOT NULL AND d.pairing_expires_at > NOW()) AS pairing_pending,
            d.pairing_expires_at,
            s.user_id AS signed_in_user_id, u.name AS signed_in_name
       FROM field_devices d
       LEFT JOIN LATERAL (
         SELECT user_id FROM field_sessions
          WHERE device_id = d.id AND revoked_at IS NULL AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT 1
       ) s ON TRUE
       LEFT JOIN users u ON u.id = s.user_id
      WHERE d.org_id = $1
      ORDER BY d.created_at DESC`,
    [req.user.org_id]
  );
  res.json({ data: result.rows });
}));

/**
 * POST /api/v1/field/admin/devices — enrol a tablet.
 * The pairing code comes back exactly once; it is stored hashed, so a lost
 * code is re-issued by rotating rather than looked up.
 */
router.post('/admin/devices', authorize('admin'), asyncHandler(async (req, res) => {
  const { label, site, scope } = req.body || {};
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  if (scope && !['yard', 'port'].includes(scope)) {
    return res.status(400).json({ error: "scope must be 'yard' or 'port'" });
  }

  const code = newPairingCode();
  const result = await query(
    `INSERT INTO field_devices (org_id, label, site, scope, pairing_code_hash, pairing_expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::INTERVAL, $7)
     RETURNING id, label, site, scope, status, pairing_expires_at, created_at`,
    [
      req.user.org_id, String(label).trim(), site ? String(site).trim() : null,
      scope || null, hashCode(code), String(PAIRING_TTL_HOURS), req.user.id,
    ]
  );
  res.status(201).json({ data: { ...result.rows[0], pairing_code: code } });
}));

/** POST /api/v1/field/admin/devices/:id/rotate — issue a fresh pairing code. */
router.post('/admin/devices/:id/rotate', authorize('admin'), asyncHandler(async (req, res) => {
  const code = newPairingCode();
  const result = await query(
    `UPDATE field_devices
        SET pairing_code_hash = $1, pairing_expires_at = NOW() + ($2 || ' hours')::INTERVAL,
            status = CASE WHEN status = 'revoked' THEN 'pending' ELSE status END,
            revoked_at = NULL
      WHERE id = $3 AND org_id = $4
      RETURNING id, label, pairing_expires_at`,
    [hashCode(code), String(PAIRING_TTL_HOURS), req.params.id, req.user.org_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
  res.json({ data: { ...result.rows[0], pairing_code: code } });
}));

/**
 * DELETE /api/v1/field/admin/devices/:id — revoke a lost or retired tablet.
 * Clearing token_hash is what makes this immediate: the next request from that
 * device fails to resolve at all, rather than being checked and rejected.
 */
router.delete('/admin/devices/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE field_devices
        SET status = 'revoked', revoked_at = NOW(), token_hash = NULL,
            pairing_code_hash = NULL, pairing_expires_at = NULL
      WHERE id = $1 AND org_id = $2
      RETURNING id`,
    [req.params.id, req.user.org_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });

  await query(
    'UPDATE field_sessions SET revoked_at = NOW() WHERE device_id = $1 AND revoked_at IS NULL',
    [req.params.id]
  );
  logger.info(`Field device revoked: ${req.params.id}`);
  res.status(204).end();
}));

/** GET /api/v1/field/admin/workers — field accounts with their PIN state. */
router.get('/admin/workers', authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.status,
            (p.user_id IS NOT NULL) AS has_pin,
            p.must_change,
            p.locked_until,
            p.updated_at AS pin_updated_at
       FROM users u
       LEFT JOIN field_agent_pins p ON p.user_id = u.id
      WHERE u.org_id = $1 AND u.role = ANY($2) AND u.deleted_at IS NULL
      ORDER BY u.name`,
    [req.user.org_id, FIELD_ROLES]
  );
  res.json({ data: result.rows });
}));

/** PUT /api/v1/field/admin/workers/:userId/pin — issue or reset a worker's PIN. */
router.put('/admin/workers/:userId/pin', authorize('admin'), asyncHandler(async (req, res) => {
  const { pin } = req.body || {};
  const problem = validatePin(pin);
  if (problem) return res.status(400).json({ error: 'weak_pin', message: problem });

  const target = await query(
    `SELECT id, org_id, role FROM users
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
    [req.params.userId, req.user.org_id]
  );
  if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
  if (!FIELD_ROLES.includes(target.rows[0].role)) {
    return res.status(400).json({ error: 'Only yard_agent and port_agent accounts use field PINs' });
  }

  await query(
    `INSERT INTO field_agent_pins (user_id, org_id, pin_hash, must_change, set_by)
     VALUES ($1, $2, $3, TRUE, $4)
     ON CONFLICT (user_id) DO UPDATE
        SET pin_hash = EXCLUDED.pin_hash, must_change = TRUE, set_by = EXCLUDED.set_by,
            failed_attempts = 0, locked_until = NULL, updated_at = NOW()`,
    [target.rows[0].id, target.rows[0].org_id, await bcrypt.hash(String(pin), 10), req.user.id]
  );

  // Any shift already running on the old PIN ends now — a reset is what an
  // admin does when a PIN has leaked, so leaving live sessions alone would
  // defeat it.
  await query(
    'UPDATE field_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [target.rows[0].id]
  );
  res.json({ data: { ok: true } });
}));

/** POST /api/v1/field/admin/workers/:userId/unlock — clear a PIN lockout. */
router.post('/admin/workers/:userId/unlock', authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE field_agent_pins p
        SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
       FROM users u
      WHERE p.user_id = u.id AND p.user_id = $1 AND u.org_id = $2
      RETURNING p.user_id`,
    [req.params.userId, req.user.org_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'No PIN set for that user' });
  res.json({ data: { ok: true } });
}));

// ── Response Crew field endpoints (device-authenticated) ─────────────────────

const { publish } = require('../realtime/centrifugo');

/** GET /api/v1/field/response-crew/dispatches — active dispatches for this crew member's team. */
router.get('/response-crew/dispatches', requireDevice, fieldAuthenticate, asyncHandler(async (req, res) => {
  if (req.fieldUser.role !== 'response_crew') return res.status(403).json({ error: 'Response crew only' });
  const memberR = await query(
    `SELECT team_id FROM response_crew_members WHERE user_id = $1 AND active = true LIMIT 1`,
    [req.fieldUser.id]
  );
  const teamId = memberR.rows[0]?.team_id;
  if (!teamId) return res.json({ data: [] });

  const r = await query(
    `SELECT d.id, d.priority, d.status, d.reason, d.target_lat, d.target_lng, d.target_label,
            d.dispatched_at, d.acknowledged_at, d.arrived_at,
            t.name AS team_name, t.callsign AS team_callsign
     FROM intercept_dispatches d
     JOIN response_teams t ON t.id = d.team_id
     WHERE d.team_id = $1 AND d.status IN ('dispatched','acknowledged','en_route','on_scene')
     ORDER BY CASE d.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
              d.dispatched_at DESC
     LIMIT 20`, [teamId]
  );
  res.json({ data: r.rows });
}));

/** PATCH /api/v1/field/response-crew/dispatches/:id/status — update dispatch status from field device. */
router.patch('/response-crew/dispatches/:id/status', requireDevice, fieldAuthenticate, asyncHandler(async (req, res) => {
  if (req.fieldUser.role !== 'response_crew') return res.status(403).json({ error: 'Response crew only' });
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['acknowledged', 'en_route', 'on_scene', 'resolved'];
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });

  const tsCol = status === 'acknowledged' ? 'acknowledged_at'
    : status === 'resolved' ? 'resolved_at'
    : status === 'on_scene' ? 'arrived_at' : null;
  const setClauses = ['status = $2'];
  if (tsCol) setClauses.push(`${tsCol} = now()`);

  const r = await query(
    `UPDATE intercept_dispatches SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    [id, status]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Dispatch not found' });
  const dispatch = r.rows[0];

  if (status === 'resolved') {
    await query(`UPDATE response_teams SET status = 'standby', updated_at = now() WHERE id = $1`, [dispatch.team_id]);
  }

  const teamR = await query(`SELECT name, callsign FROM response_teams WHERE id = $1`, [dispatch.team_id]);
  publish(`org#${dispatch.org_id}`, {
    type: 'crew.status_update',
    dispatch_id: dispatch.id,
    team_id: dispatch.team_id,
    team_name: teamR.rows[0]?.name,
    team_callsign: teamR.rows[0]?.callsign,
    status,
    target_lat: parseFloat(dispatch.target_lat),
    target_lng: parseFloat(dispatch.target_lng),
    updated_at: new Date().toISOString(),
  });

  res.json({ data: dispatch });
}));

module.exports = router;
