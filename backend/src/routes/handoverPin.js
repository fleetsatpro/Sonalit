/**
 * Handover officer PIN auth routes.
 * Mounted at /api/v1/handover-auth.
 *
 * Handover officers first authenticate with email/password (the normal login),
 * then set a 4-8 digit PIN for quick re-auth. The PIN flow is:
 *
 *   1. Admin creates handover_officer account with email + password (POST /auth/users)
 *   2. Officer signs in with email/password on first use (POST /auth/login)
 *   3. Officer sets their PIN (POST /handover-auth/pin/set) — requires JWT
 *   4. Future sign-ins: officer enters PIN (POST /handover-auth/pin/verify) — requires JWT
 *
 * PIN verify is gated behind an existing JWT session, not standalone — the
 * handover app stores the JWT, and PIN is a quick-unlock mechanism (like a
 * phone lock screen), not a replacement for the initial login.
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');

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

const pinLimiter = rl(20, 'Too many PIN attempts');

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

// ─── POST /handover-auth/pin/set — officer sets or changes their own PIN ──────
router.post('/pin/set', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'handover_officer') {
    return res.status(403).json({ error: 'Only handover officers can set a PIN' });
  }

  const { pin } = req.body || {};
  const err = validatePin(pin);
  if (err) return res.status(400).json({ error: err });

  const pin_hash = await bcrypt.hash(String(pin), 10);

  await query(
    `INSERT INTO handover_officer_pins (user_id, pin_hash)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET pin_hash = $2, must_change = FALSE, failed_attempts = 0,
           locked_until = NULL, updated_at = NOW()`,
    [req.user.id, pin_hash]
  );

  res.json({ data: { has_pin: true } });
}));

// ─── GET /handover-auth/pin/status — does the current officer have a PIN? ─────
router.get('/pin/status', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'handover_officer') {
    return res.status(403).json({ error: 'Only handover officers can check PIN status' });
  }

  const result = await query(
    `SELECT user_id, must_change,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
       FROM handover_officer_pins WHERE user_id = $1`,
    [req.user.id]
  );

  const row = result.rows[0];
  res.json({
    data: {
      has_pin: !!row,
      must_change: row?.must_change ?? false,
      locked: row?.locked ?? false,
    },
  });
}));

// ─── POST /handover-auth/pin/verify — quick re-auth via PIN ──────────────────
router.post('/pin/verify', authenticate, pinLimiter, asyncHandler(async (req, res) => {
  if (req.user.role !== 'handover_officer') {
    return res.status(403).json({ error: 'Only handover officers can verify PIN' });
  }

  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'pin is required' });

  const result = await query(
    `SELECT pin_hash, must_change, failed_attempts, locked_until
       FROM handover_officer_pins WHERE user_id = $1`,
    [req.user.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'no_pin', message: 'No PIN set. Set one first.' });
  }

  const row = result.rows[0];

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(row.locked_until) - Date.now()) / 60000));
    return res.status(423).json({
      error: 'pin_locked',
      message: `Too many wrong PINs. Locked for ${mins} more minute${mins === 1 ? '' : 's'}.`,
    });
  }

  if (!(await bcrypt.compare(String(pin), row.pin_hash))) {
    const attempts = Number(row.failed_attempts || 0) + 1;
    const lock = attempts >= MAX_PIN_ATTEMPTS;
    await query(
      `UPDATE handover_officer_pins
          SET failed_attempts = $1,
              locked_until = CASE WHEN $2 THEN NOW() + ($3 || ' minutes')::INTERVAL ELSE locked_until END
        WHERE user_id = $4`,
      [lock ? 0 : attempts, lock, String(LOCKOUT_MINUTES), req.user.id]
    );

    if (lock) {
      return res.status(423).json({
        error: 'pin_locked',
        message: `Too many wrong PINs. Locked for ${LOCKOUT_MINUTES} minutes.`,
      });
    }

    const remaining = MAX_PIN_ATTEMPTS - attempts;
    return res.status(401).json({
      error: 'invalid_pin',
      message: `Wrong PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    });
  }

  await query(
    'UPDATE handover_officer_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1',
    [req.user.id]
  );

  res.json({ data: { verified: true, must_change: row.must_change } });
}));

// ─── Admin endpoints ──────────────────────────────────────────────────────────

// POST /handover-auth/admin/reset-pin — admin resets an officer's PIN
router.post('/admin/reset-pin', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  const userResult = await query(
    `SELECT id, role FROM users WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
    [user_id, req.user.org_id]
  );
  if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
  if (userResult.rows[0].role !== 'handover_officer') {
    return res.status(400).json({ error: 'User is not a handover officer' });
  }

  await query('DELETE FROM handover_officer_pins WHERE user_id = $1', [user_id]);

  res.json({ data: { pin_cleared: true } });
}));

// GET /handover-auth/admin/pin-status/:userId — admin checks if officer has PIN
//
// handover_officer_pins carries no org_id and no RLS, and query() runs on the
// raw pool rather than through withOrg — so the join to users is the only thing
// keeping one org's admin out of another's rows. Same shape as the sibling
// field_agent_pins endpoints in routes/field.js.
router.get('/admin/pin-status/:userId', authenticate, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT p.user_id, p.must_change,
            (p.locked_until IS NOT NULL AND p.locked_until > NOW()) AS locked,
            p.updated_at
       FROM handover_officer_pins p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1 AND u.org_id = $2`,
    [req.params.userId, req.user.org_id]
  );

  const row = result.rows[0];
  res.json({
    data: {
      has_pin: !!row,
      must_change: row?.must_change ?? false,
      locked: row?.locked ?? false,
      updated_at: row?.updated_at ?? null,
    },
  });
}));

// POST /handover-auth/admin/unlock — admin unlocks a locked PIN
router.post('/admin/unlock', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  // Scoped through users for the same reason as pin-status above — and here it
  // matters more: unlocking is a write that clears a brute-force lockout, so an
  // unscoped WHERE lets an admin in one org reopen an account in another.
  const result = await query(
    `UPDATE handover_officer_pins p
        SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
       FROM users u
      WHERE p.user_id = u.id AND p.user_id = $1 AND u.org_id = $2
      RETURNING p.user_id`,
    [user_id, req.user.org_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'No PIN set for that user' });

  res.json({ data: { unlocked: true } });
}));

module.exports = router;
