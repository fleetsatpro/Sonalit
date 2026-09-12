/**
 * Authentication for the Sonalit Field app (shared yard/port devices).
 *
 * Deliberately shares nothing with middleware/auth.js: no JWT, no cookies, no
 * CSRF double-submit. A Field request carries two headers instead —
 *
 *   X-Field-Device : the tablet's long-lived pairing token
 *   X-Field-Token  : the signed-in worker's shift session
 *
 * — and both are opaque random strings verified against a server-side hash, so
 * a session can be cut off the instant a device is handed over or lost. See
 * backend/migrations/20260818_079_field_device_auth.sql for why the two
 * credentials are split.
 *
 * The pay-off for keeping the schemes disjoint is that an operator session and
 * a Field session can exist side by side in one browser without either being
 * able to end, read, or escalate into the other.
 */
const crypto = require('crypto');
const { query } = require('../config/database');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { authenticate } = require('./auth');
const logger = require('../utils/logger');

/** Roles that may hold a Field session at all. */
const FIELD_ROLES = ['yard_agent', 'port_agent', 'response_crew'];

/** How long a shift session lasts before the worker has to re-enter their PIN. */
const SESSION_HOURS = 12;

/**
 * Don't write last_seen_at on every request — a field device polls its queue
 * every few seconds, and an UPDATE per poll is a pointless row-version churn
 * on the hottest table in the flow.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Pairing codes are read off a screen and typed into a tablet, so the alphabet
 * drops every character pair a tired person confuses at a gate at 5am:
 * O/0, I/1/L, S/5, B/8. 26 remaining symbols over 8 characters is ~37 bits,
 * and codes are single-use and expiring, so that is ample.
 */
const CODE_ALPHABET = '23456789ACDEFGHJKMNPQRTUVWXYZ';

function newPairingCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

function normaliseCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Hash of a pairing code, insensitive to the dash and to case. */
function hashCode(raw) {
  return sha256(normaliseCode(raw));
}

/**
 * Resolve X-Field-Device to an active device row.
 * Returns null (rather than throwing) so callers choose their own 401 shape.
 */
async function resolveDevice(req) {
  const token = req.headers['x-field-device'];
  if (!token || typeof token !== 'string') return null;

  const result = await query(
    `SELECT * FROM field_devices
      WHERE token_hash = $1 AND status = 'active' AND revoked_at IS NULL`,
    [sha256(token)]
  );
  return result.rows[0] || null;
}

/**
 * Gate for the pre-sign-in endpoints (worker roster, PIN sign-in): the tablet
 * has proved it is one of ours, but nobody is signed in yet.
 */
async function requireDevice(req, res, next) {
  try {
    const device = await resolveDevice(req);
    if (!device) {
      return res.status(401).json({ error: 'device_not_paired' });
    }
    req.fieldDevice = device;
    next();
  } catch (err) {
    logger.error(`requireDevice error: ${err.message}`);
    next(err);
  }
}

/**
 * Full Field auth: a valid device AND a live shift session on that same device.
 *
 * Binding the session to the device it was issued on is the point — a session
 * token lifted off one tablet is useless without also holding that tablet's
 * pairing token, and revoking the device kills every session it ever issued.
 *
 * On success this sets req.user to the same shape middleware/auth.js produces,
 * so downstream routers (notably routes/cds.js and its yard/port role gate)
 * need no knowledge of which scheme let the request in.
 */
async function fieldAuthenticate(req, res, next) {
  try {
    const token = req.headers['x-field-token'];
    if (!token || typeof token !== 'string') {
      return res.status(401).json({ error: 'field_session_required' });
    }

    const device = await resolveDevice(req);
    if (!device) return res.status(401).json({ error: 'device_not_paired' });

    const result = await query(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
              u.id, u.email, u.name, u.role, u.status, u.org_id
         FROM field_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.device_id = $2
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND u.deleted_at IS NULL`,
      [sha256(token), device.id]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'field_session_expired' });
    }

    const row = result.rows[0];
    if (row.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    // A worker demoted out of a field role mid-shift loses the session on the
    // next request rather than at expiry.
    if (!FIELD_ROLES.includes(row.role)) {
      return res.status(403).json({ error: 'field_role_required' });
    }

    req.user = {
      id: row.id, email: row.email, name: row.name,
      role: row.role, status: row.status, org_id: row.org_id,
    };
    req.fieldDevice = device;
    req.fieldSessionId = row.session_id;

    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeen > TOUCH_INTERVAL_MS) {
      // Fire-and-forget: a failed heartbeat must not fail the worker's clamp.
      query('UPDATE field_sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id])
        .catch((err) => logger.warn(`field session touch failed: ${err.message}`));
      query('UPDATE field_devices SET last_seen_at = NOW() WHERE id = $1', [device.id])
        .catch(() => {});
    }

    attachOrgDb(req, res, next);
  } catch (err) {
    logger.error(`fieldAuthenticate error: ${err.message}`);
    next(err);
  }
}

/**
 * Accept either scheme on a shared router.
 *
 * routes/cds.js serves both the operator dashboard and the Field app. Rather
 * than duplicating every clamp/unclamp route under a second mount, it takes
 * this and lets the credential decide. The presence of X-Field-Token is the
 * switch, and there is no fall-through: a request that presents a Field token
 * is answered as a Field request even if it is bad, so a stale field session
 * can never quietly borrow an operator cookie that happens to be in the jar.
 */
function dualAuthenticate(req, res, next) {
  if (req.headers['x-field-token']) return fieldAuthenticate(req, res, next);
  return authenticate(req, res, next);
}

module.exports = {
  FIELD_ROLES,
  SESSION_HOURS,
  sha256,
  newToken,
  newPairingCode,
  normaliseCode,
  hashCode,
  requireDevice,
  fieldAuthenticate,
  dualAuthenticate,
};
