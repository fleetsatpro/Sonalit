/**
 * /api/v1/sync — the offline replication contract.
 *
 *   GET  /sync/pull      authorised changes since a checkpoint
 *   POST /sync/push      operations recorded on a device, applied idempotently
 *   GET  /sync/status    what the server thinks this device's position is
 *   POST /sync/device    register/refresh a device, get its bootstrap state
 *   GET  /sync/conflicts open conflicts awaiting a human decision
 *   POST /sync/conflicts/:id/resolve
 *
 * Authentication is `dualAuthenticate`, exactly as routes/cds.js uses it, so
 * the same endpoints serve the operator dashboard (JWT) and the Field app
 * (device + PIN). There is deliberately no new authentication system here: a
 * device that cannot authenticate against the existing model cannot sync.
 *
 * Nothing in this router trusts the client for identity. `org_id`, `user_id`
 * and role all come from `req.user`; the device id is the only client-supplied
 * value that is honoured, and it is scoped by org and used only for
 * attribution and checkpoint bookkeeping — never for authorisation.
 */
const router = require('express').Router();
const { dualAuthenticate } = require('../middleware/fieldAuth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { authorize } = require('../middleware/auth');
const { pull } = require('../sync/changeFeed');
const { applyBatch, MAX_BATCH } = require('../sync/operations');
const { scopeFor } = require('../sync/scope');
const handlers = require('../sync/handlers');
const logger = require('../utils/logger');

/**
 * Local schema versions this server can interpret.
 *
 * A device that has been offline through a deployment may be behind. Rather
 * than let it push payloads the server would misread, it is told to update and
 * its queue is held intact until it does — losing the work would be worse than
 * delaying it.
 */
const MIN_CLIENT_SCHEMA = 1;
const CURRENT_SCHEMA = 1;

/**
 * Reachability probe. Deliberately BEFORE the auth middleware and deliberately
 * tiny.
 *
 * The connectivity manager needs a way to ask "is the Sonalit API answering?"
 * that is unambiguous. Probing the SPA origin would answer "is Vercel up",
 * which is a different question and stays green while the API is down; probing
 * an authenticated route conflates a reachability failure with an expired
 * token. This answers exactly one thing, in a few dozen bytes, with no database
 * access — so it stays cheap enough to call on a 2G link.
 */
router.get('/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, t: Date.now() });
});

router.use(dualAuthenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

/** Device id header, mirroring the Field app's existing X-Field-Device convention. */
function deviceIdOf(req) {
  const raw = req.headers['x-sync-device'] || req.headers['x-field-device'] || '';
  const id = String(raw).trim().slice(0, 128);
  return id || null;
}

function clientSchemaOf(req) {
  const n = Number(req.headers['x-sync-schema']);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * Reject a client whose local schema this server cannot safely talk to.
 * Returns true when the response has already been sent.
 */
function schemaIncompatible(req, res) {
  const v = clientSchemaOf(req);
  if (v >= MIN_CLIENT_SCHEMA && v <= CURRENT_SCHEMA) return false;
  res.status(426).json({
    error: 'schema_incompatible',
    client_schema: v,
    min_supported: MIN_CLIENT_SCHEMA,
    current_schema: CURRENT_SCHEMA,
    message: v > CURRENT_SCHEMA
      ? 'This server is older than the app. Sync is paused.'
      : 'App update required before this device can sync.',
  });
  return true;
}

/** Upsert the device row and refresh last_seen. Never fails the request. */
async function touchDevice(req, patch = {}) {
  const deviceId = deviceIdOf(req);
  if (!deviceId) return;
  try {
    await req.db(
      `INSERT INTO sync_devices
         (device_id, org_id, user_id, platform, app_version, schema_version, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (device_id, org_id) DO UPDATE
         SET user_id        = EXCLUDED.user_id,
             platform       = COALESCE(EXCLUDED.platform, sync_devices.platform),
             app_version    = COALESCE(EXCLUDED.app_version, sync_devices.app_version),
             schema_version = EXCLUDED.schema_version,
             last_seen_at   = NOW(),
             last_pull_at   = COALESCE($7, sync_devices.last_pull_at),
             last_push_at   = COALESCE($8, sync_devices.last_push_at),
             pull_checkpoint = GREATEST(sync_devices.pull_checkpoint, COALESCE($9, 0))`,
      [
        deviceId,
        req.user.org_id,
        req.user.id,
        req.headers['x-sync-platform'] ? String(req.headers['x-sync-platform']).slice(0, 40) : null,
        req.headers['x-sync-app-version'] ? String(req.headers['x-sync-app-version']).slice(0, 40) : null,
        clientSchemaOf(req),
        patch.pulled ? new Date() : null,
        patch.pushed ? new Date() : null,
        Number.isFinite(patch.checkpoint) ? patch.checkpoint : null,
      ]
    );
  } catch (err) {
    // Bookkeeping must never break a sync. The checkpoint the device holds
    // locally is the authoritative one for correctness; this row is for
    // operational visibility.
    logger.warn(`sync device bookkeeping failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /sync/device — registration + bootstrap
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Called on first launch and on every reconnect. Its job is to answer the
 * questions a device cannot answer for itself: what am I allowed to replicate,
 * is my schema still supported, and has my access been revoked while I was
 * dark? A device that has been offline through a permission change learns it
 * here, before it pushes anything.
 */
router.post('/device', asyncHandler(async (req, res) => {
  if (schemaIncompatible(req, res)) return;

  const deviceId = deviceIdOf(req);
  if (!deviceId) return res.status(400).json({ error: 'device_id_required' });

  await touchDevice(req);

  const row = await req.db(
    'SELECT pull_checkpoint, revoked_at, first_seen_at FROM sync_devices WHERE device_id = $1 AND org_id = $2',
    [deviceId, req.user.org_id]
  );
  const device = row.rows[0] || {};

  if (device.revoked_at) {
    return res.status(403).json({
      error: 'device_revoked',
      message: 'This device is no longer authorised to sync.',
    });
  }

  res.json({
    device_id: deviceId,
    org_id: req.user.org_id,
    user: { id: req.user.id, role: req.user.role },
    entity_types: scopeFor(req.user),
    operation_types: handlers.types(),
    server_checkpoint: Number(device.pull_checkpoint || 0),
    schema_version: CURRENT_SCHEMA,
    server_time: new Date().toISOString(),
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /sync/pull
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pull', asyncHandler(async (req, res) => {
  if (schemaIncompatible(req, res)) return;

  const checkpoint = Number(req.query.checkpoint);
  const limit = Number(req.query.limit);
  const entityTypes = typeof req.query.entity_types === 'string' && req.query.entity_types.length
    ? req.query.entity_types.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  const result = await pull(req.db, req.user, { checkpoint, limit, entityTypes });

  await touchDevice(req, { pulled: true, checkpoint: result.checkpoint });

  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /sync/push
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Always 200 when the batch itself was well-formed, even if every operation in
 * it was rejected. The per-operation outcome is the answer — an HTTP status
 * cannot express "seven accepted, one duplicate, one conflict, one retryable",
 * and a client that reads 200 as "all accepted" is exactly the bug this
 * protocol exists to prevent. The response documents that explicitly.
 */
router.post('/push', asyncHandler(async (req, res) => {
  if (schemaIncompatible(req, res)) return;

  const deviceId = deviceIdOf(req);
  if (!deviceId) return res.status(400).json({ error: 'device_id_required' });

  const ops = Array.isArray(req.body && req.body.operations) ? req.body.operations : null;
  if (!ops) return res.status(400).json({ error: 'operations_required' });
  if (ops.length === 0) return res.json({ results: [], accepted: 0 });
  if (ops.length > MAX_BATCH) {
    return res.status(413).json({ error: 'batch_too_large', max: MAX_BATCH });
  }

  const revoked = await req.db(
    'SELECT revoked_at FROM sync_devices WHERE device_id = $1 AND org_id = $2',
    [deviceId, req.user.org_id]
  );
  if (revoked.rows[0] && revoked.rows[0].revoked_at) {
    return res.status(403).json({ error: 'device_revoked' });
  }

  // Preserve the device's own ordering rather than arrival order: an operation
  // that depends on an earlier one must not be applied first because JSON key
  // order or a client bug shuffled the array.
  const ordered = [...ops].sort((a, b) => {
    const sa = Number.isFinite(a && a.local_sequence) ? a.local_sequence : 0;
    const sb = Number.isFinite(b && b.local_sequence) ? b.local_sequence : 0;
    return sa - sb;
  });

  const results = await applyBatch(
    { user: req.user, deviceId, schemaVersion: clientSchemaOf(req) },
    ordered
  );

  await touchDevice(req, { pushed: true });

  const tally = results.reduce((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] || 0) + 1;
    return acc;
  }, {});

  logger.info(
    `sync.push device=${deviceId} org=${req.user.org_id} ` +
    Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')
  );

  res.json({ results, tally, server_time: new Date().toISOString() });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /sync/status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', asyncHandler(async (req, res) => {
  const deviceId = deviceIdOf(req);

  const head = await req.db('SELECT COALESCE(MAX(seq), 0)::bigint AS head FROM sync_change_log');

  let device = null;
  if (deviceId) {
    const d = await req.db(
      `SELECT device_id, pull_checkpoint, last_pull_at, last_push_at, last_seen_at, revoked_at
         FROM sync_devices WHERE device_id = $1 AND org_id = $2`,
      [deviceId, req.user.org_id]
    );
    device = d.rows[0] || null;
  }

  const pendingConflicts = await req.db(
    `SELECT COUNT(*)::int AS n FROM sync_conflicts
      WHERE resolution = 'unresolved'` + (deviceId ? ' AND device_id = $1' : ''),
    deviceId ? [deviceId] : []
  );

  res.json({
    server_head: Number(head.rows[0].head),
    schema_version: CURRENT_SCHEMA,
    entity_types: scopeFor(req.user),
    operation_types: handlers.types(),
    device: device && {
      device_id: device.device_id,
      checkpoint: Number(device.pull_checkpoint),
      last_pull_at: device.last_pull_at,
      last_push_at: device.last_push_at,
      last_seen_at: device.last_seen_at,
      revoked: Boolean(device.revoked_at),
      behind_by: Number(head.rows[0].head) - Number(device.pull_checkpoint),
    },
    open_conflicts: pendingConflicts.rows[0].n,
    server_time: new Date().toISOString(),
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Conflicts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/conflicts', asyncHandler(async (req, res) => {
  const onlyOpen = req.query.status !== 'all';
  const rows = await req.db(
    `SELECT id, operation_id, device_id, entity_type, entity_id, expected_revision,
            actual_revision, local_payload, server_snapshot, reason, resolution,
            created_at, resolved_at
       FROM sync_conflicts
      ${onlyOpen ? "WHERE resolution = 'unresolved'" : ''}
      ORDER BY created_at DESC
      LIMIT 200`
  );
  res.json({ conflicts: rows.rows });
}));

/**
 * Resolving a conflict is a supervisory decision, not a field one — the point
 * of raising it was that no automatic rule could safely pick a winner. Only
 * office roles may close one, and closing it never replays the local operation:
 * it records which version stands so the audit trail says who decided and when.
 */
router.post('/conflicts/:id/resolve',
  authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const resolution = req.body && req.body.resolution;
    if (!['kept_server', 'applied_local', 'dismissed'].includes(resolution)) {
      return res.status(400).json({
        error: 'invalid_resolution',
        allowed: ['kept_server', 'applied_local', 'dismissed'],
      });
    }

    const upd = await req.db(
      `UPDATE sync_conflicts
          SET resolution = $2, resolved_by = $3, resolved_at = NOW()
        WHERE id = $1 AND resolution = 'unresolved'
        RETURNING id, resolution, resolved_at`,
      [req.params.id, resolution, req.user.id]
    );

    if (upd.rows.length === 0) {
      return res.status(404).json({ error: 'not_found_or_already_resolved' });
    }
    res.json(upd.rows[0]);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /sync/devices — fleet-wide device health (office roles only)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/devices',
  authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const head = await req.db('SELECT COALESCE(MAX(seq), 0)::bigint AS head FROM sync_change_log');
    const rows = await req.db(
      `SELECT d.device_id, d.user_id, u.name AS user_name, d.platform, d.app_version,
              d.schema_version, d.pull_checkpoint, d.last_pull_at, d.last_push_at,
              d.last_seen_at, d.revoked_at,
              (SELECT COUNT(*)::int FROM sync_operations o
                 WHERE o.device_id = d.device_id AND o.status = 'claimed') AS in_flight
         FROM sync_devices d
         LEFT JOIN users u ON u.id = d.user_id
        ORDER BY d.last_seen_at DESC
        LIMIT 500`
    );

    const headSeq = Number(head.rows[0].head);
    res.json({
      server_head: headSeq,
      devices: rows.rows.map(r => ({
        ...r,
        pull_checkpoint: Number(r.pull_checkpoint),
        behind_by: headSeq - Number(r.pull_checkpoint),
      })),
    });
  })
);

module.exports = router;
