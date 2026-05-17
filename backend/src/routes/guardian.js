const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// ─── Table Initialisation ────────────────────────────────────────────────────

async function ensureTables() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS guardian_devices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        name            TEXT NOT NULL,
        imei            TEXT,
        model           TEXT,
        os_version      TEXT,
        app_version     TEXT,
        status          TEXT DEFAULT 'pending',
        assignment_type TEXT,
        assignment_id   UUID,
        panic_active    BOOLEAN DEFAULT false,
        last_seen       TIMESTAMPTZ,
        last_lat        DECIMAL(10,7),
        last_lng        DECIMAL(10,7),
        last_speed      DECIMAL(6,2),
        enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS device_locations (
        id        BIGSERIAL PRIMARY KEY,
        device_id UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        lat       DECIMAL(10,7) NOT NULL,
        lng       DECIMAL(10,7) NOT NULL,
        altitude  DECIMAL(8,2),
        heading   DECIMAL(6,2),
        speed     DECIMAL(6,2),
        accuracy  DECIMAL(8,2),
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS device_health (
        id               BIGSERIAL PRIMARY KEY,
        device_id        UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        battery_level    INT,
        battery_charging BOOLEAN,
        signal_strength  INT,
        network_type     TEXT,
        storage_free_mb  INT,
        ram_free_mb      INT,
        app_version      TEXT,
        recorded_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS panic_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id   UUID NOT NULL REFERENCES guardian_devices(id),
        mode        TEXT NOT NULL,
        lat         DECIMAL(10,7),
        lng         DECIMAL(10,7),
        message     TEXT,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS device_commands (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id    UUID NOT NULL REFERENCES guardian_devices(id),
        command_type TEXT NOT NULL,
        payload      JSONB,
        status       TEXT DEFAULT 'pending',
        result       TEXT,
        issued_by    UUID,
        issued_at    TIMESTAMPTZ DEFAULT NOW(),
        executed_at  TIMESTAMPTZ
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS field_reports (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id   UUID NOT NULL REFERENCES guardian_devices(id),
        category    TEXT NOT NULL,
        severity    TEXT DEFAULT 'medium',
        description TEXT,
        lat         DECIMAL(10,7),
        lng         DECIMAL(10,7),
        photo_url   TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for performance
    await query(`CREATE INDEX IF NOT EXISTS idx_device_locations_device_id ON device_locations(device_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_locations_timestamp ON device_locations(timestamp DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_health_device_id ON device_health(device_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_commands_device_status ON device_commands(device_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_panic_events_device_id ON panic_events(device_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_panic_events_resolved ON panic_events(resolved_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_field_reports_device_id ON field_reports(device_id)`);

    logger.info('Guardian tables initialised');
  } catch (err) {
    logger.error(`Guardian ensureTables error: ${err.message}`);
  }
}

// Run immediately on module load
ensureTables();

// ─── Device Auth Middleware ───────────────────────────────────────────────────

async function deviceAuth(req, res, next) {
  try {
    const token = req.headers['x-device-token'];
    if (!token) {
      return res.status(401).json({ error: 'Missing X-Device-Token header' });
    }

    const result = await query(
      `SELECT * FROM guardian_devices
       WHERE token = $1 AND deleted_at IS NULL`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid device token' });
    }

    const device = result.rows[0];
    if (device.status === 'revoked' || device.status === 'suspended') {
      return res.status(403).json({ error: `Device is ${device.status}` });
    }

    req.device = device;
    next();
  } catch (err) {
    logger.error(`deviceAuth error: ${err.message}`);
    next(err);
  }
}

// ─── Device Routes (no JWT required) ─────────────────────────────────────────

/**
 * POST /api/v1/guardian/enroll
 * Register a new device. Validates org_token against env GUARDIAN_ORG_TOKEN.
 */
router.post('/enroll', async (req, res, next) => {
  try {
    const { name, imei, model, os_version, app_version, org_token } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!org_token) {
      return res.status(400).json({ error: 'org_token is required' });
    }

    const expectedToken = process.env.GUARDIAN_ORG_TOKEN || 'fleet-guardian-2024';
    if (org_token !== expectedToken) {
      logger.warn(`Guardian enroll rejected: bad org_token from IMEI ${imei}`);
      return res.status(403).json({ error: 'Invalid organisation token' });
    }

    const result = await query(
      `INSERT INTO guardian_devices (name, imei, model, os_version, app_version, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, token, enrolled_at`,
      [name, imei || null, model || null, os_version || null, app_version || null]
    );

    const device = result.rows[0];
    logger.info(`Guardian device enrolled: ${device.id} name="${name}" imei=${imei}`);

    res.status(201).json({
      device_id: device.id,
      token: device.token,
      enrolled_at: device.enrolled_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/heartbeat
 * Battery / health ping every 60 s. Returns queued commands.
 */
router.post('/heartbeat', deviceAuth, async (req, res, next) => {
  try {
    const {
      battery_level,
      battery_charging,
      signal_strength,
      network_type,
      storage_free_mb,
      ram_free_mb,
      app_version,
      lat,
      lng,
      speed,
    } = req.body;

    const deviceId = req.device.id;

    // Upsert health record (delete old for device then insert, or use plain insert)
    await query(
      `INSERT INTO device_health
         (device_id, battery_level, battery_charging, signal_strength, network_type,
          storage_free_mb, ram_free_mb, app_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        deviceId,
        battery_level ?? null,
        battery_charging ?? null,
        signal_strength ?? null,
        network_type || null,
        storage_free_mb ?? null,
        ram_free_mb ?? null,
        app_version || null,
      ]
    );

    // Update device last_seen and optionally location
    if (lat != null && lng != null) {
      await query(
        `UPDATE guardian_devices
         SET last_seen = NOW(), status = 'active',
             last_lat = $2, last_lng = $3, last_speed = $4, updated_at = NOW()
         WHERE id = $1`,
        [deviceId, lat, lng, speed ?? null]
      );
    } else {
      await query(
        `UPDATE guardian_devices
         SET last_seen = NOW(), status = 'active', updated_at = NOW()
         WHERE id = $1`,
        [deviceId]
      );
    }

    // Fetch pending commands for this device
    const commands = await query(
      `SELECT id, command_type, payload, issued_at
       FROM device_commands
       WHERE device_id = $1 AND status = 'pending'
       ORDER BY issued_at ASC`,
      [deviceId]
    );

    res.json({ commands: commands.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/location
 * GPS position update from device.
 */
router.post('/location', deviceAuth, async (req, res, next) => {
  try {
    const { lat, lng, altitude, heading, speed, accuracy, timestamp } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const deviceId = req.device.id;

    const result = await query(
      `INSERT INTO device_locations (device_id, lat, lng, altitude, heading, speed, accuracy, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::TIMESTAMPTZ, NOW()))
       RETURNING id, timestamp`,
      [
        deviceId,
        lat,
        lng,
        altitude ?? null,
        heading ?? null,
        speed ?? null,
        accuracy ?? null,
        timestamp || null,
      ]
    );

    // Update last known position on device record
    await query(
      `UPDATE guardian_devices
       SET last_lat = $2, last_lng = $3, last_speed = $4,
           last_seen = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [deviceId, lat, lng, speed ?? null]
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('device:location', {
        device_id: deviceId,
        name: req.device.name,
        lat,
        lng,
        altitude: altitude ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        accuracy: accuracy ?? null,
        timestamp: result.rows[0].timestamp,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/panic
 * Trigger SOS alert from device.
 */
router.post('/panic', deviceAuth, async (req, res, next) => {
  try {
    const { mode, lat, lng, message } = req.body;

    const validModes = ['silent', 'loud', 'medical', 'security', 'hijack'];
    if (!mode || !validModes.includes(mode)) {
      return res.status(400).json({
        error: `mode is required and must be one of: ${validModes.join(', ')}`,
      });
    }

    const deviceId = req.device.id;

    const result = await query(
      `INSERT INTO panic_events (device_id, mode, lat, lng, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [deviceId, mode, lat ?? null, lng ?? null, message || null]
    );

    const panicEvent = result.rows[0];

    await query(
      `UPDATE guardian_devices SET panic_active = true, updated_at = NOW() WHERE id = $1`,
      [deviceId]
    );

    const payload = {
      panic_id: panicEvent.id,
      device_id: deviceId,
      device_name: req.device.name,
      mode,
      lat: lat ?? null,
      lng: lng ?? null,
      message: message || null,
      created_at: panicEvent.created_at,
    };

    const io = req.app.get('io');
    if (io) {
      io.emit('device:panic', payload);
    }

    logger.warn(`PANIC triggered: device=${deviceId} name="${req.device.name}" mode=${mode}`);

    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/report
 * Field incident report from device.
 */
router.post('/report', deviceAuth, async (req, res, next) => {
  try {
    const { category, severity = 'medium', description, lat, lng, photo_url } = req.body;

    const validCategories = [
      'suspicious', 'roadblock', 'theft', 'attack', 'accident',
      'medical', 'checkpoint', 'delivery_issue', 'vehicle_issue',
    ];
    if (!category || !validCategories.includes(category)) {
      return res.status(400).json({
        error: `category is required and must be one of: ${validCategories.join(', ')}`,
      });
    }

    const deviceId = req.device.id;

    const result = await query(
      `INSERT INTO field_reports (device_id, category, severity, description, lat, lng, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        deviceId,
        category,
        severity,
        description || null,
        lat ?? null,
        lng ?? null,
        photo_url || null,
      ]
    );

    const report = result.rows[0];

    const io = req.app.get('io');
    if (io) {
      io.emit('device:report', {
        report_id: report.id,
        device_id: deviceId,
        device_name: req.device.name,
        category,
        severity,
        description: description || null,
        lat: lat ?? null,
        lng: lng ?? null,
        photo_url: photo_url || null,
        created_at: report.created_at,
      });
    }

    logger.info(`Field report: device=${deviceId} category=${category} severity=${severity}`);

    res.status(201).json({ report_id: report.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/ack-command
 * Device acknowledges a command was received / executed.
 */
router.post('/ack-command', deviceAuth, async (req, res, next) => {
  try {
    const { command_id, status, result: cmdResult } = req.body;

    if (!command_id) {
      return res.status(400).json({ error: 'command_id is required' });
    }
    if (!['executed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "executed" or "failed"' });
    }

    const deviceId = req.device.id;

    const updated = await query(
      `UPDATE device_commands
       SET status = $2, executed_at = NOW(), result = $3
       WHERE id = $1 AND device_id = $4
       RETURNING id`,
      [command_id, status, cmdResult || null, deviceId]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ error: 'Command not found for this device' });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Admin Routes (JWT required) ──────────────────────────────────────────────

/**
 * GET /api/v1/guardian/devices
 * List all guardian devices with last health, last location, pending command count.
 */
router.get('/devices', authenticate, async (req, res, next) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;

    const filters = ['gd.deleted_at IS NULL'];
    const params = [];

    if (status) {
      params.push(status);
      filters.push(`gd.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(
        `(gd.name ILIKE $${params.length} OR gd.imei ILIKE $${params.length} OR gd.model ILIKE $${params.length})`
      );
    }

    params.push(parseInt(limit), parseInt(offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const result = await query(
      `SELECT
         gd.id, gd.name, gd.imei, gd.model, gd.os_version, gd.app_version,
         gd.status, gd.assignment_type, gd.assignment_id,
         gd.panic_active, gd.last_seen, gd.last_lat, gd.last_lng, gd.last_speed,
         gd.enrolled_at, gd.created_at,
         h.battery_level, h.battery_charging, h.signal_strength,
         h.network_type, h.storage_free_mb, h.ram_free_mb, h.recorded_at AS health_recorded_at,
         COALESCE(pc.cnt, 0)::INT AS pending_commands
       FROM guardian_devices gd
       LEFT JOIN LATERAL (
         SELECT battery_level, battery_charging, signal_strength,
                network_type, storage_free_mb, ram_free_mb, recorded_at
         FROM device_health
         WHERE device_id = gd.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) h ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt
         FROM device_commands
         WHERE device_id = gd.id AND status = 'pending'
       ) pc ON true
       WHERE ${filters.join(' AND ')}
       ORDER BY gd.last_seen DESC NULLS LAST, gd.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) FROM guardian_devices gd WHERE ${filters.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/devices/:id
 * Single device with full detail.
 */
router.get('/devices/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = result.rows[0];

    const [healthResult, locResult, cmdResult] = await Promise.all([
      query(
        `SELECT * FROM device_health WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [device.id]
      ),
      query(
        `SELECT lat, lng, altitude, heading, speed, accuracy, timestamp
         FROM device_locations WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 20`,
        [device.id]
      ),
      query(
        `SELECT id, command_type, payload, status, result, issued_at, executed_at
         FROM device_commands WHERE device_id = $1 ORDER BY issued_at DESC LIMIT 20`,
        [device.id]
      ),
    ]);

    res.json({
      data: {
        ...device,
        health: healthResult.rows[0] || null,
        recent_locations: locResult.rows,
        recent_commands: cmdResult.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/guardian/devices/:id
 * Update device assignment, status, or name.
 */
router.patch('/devices/:id', authenticate, async (req, res, next) => {
  try {
    const { assignment_type, assignment_id, status, name } = req.body;

    const validAssignmentTypes = ['driver', 'officer', 'convoy', 'vehicle', 'asset'];
    if (assignment_type && !validAssignmentTypes.includes(assignment_type)) {
      return res.status(400).json({
        error: `assignment_type must be one of: ${validAssignmentTypes.join(', ')}`,
      });
    }

    const result = await query(
      `UPDATE guardian_devices
       SET name            = COALESCE($1, name),
           status          = COALESCE($2, status),
           assignment_type = COALESCE($3, assignment_type),
           assignment_id   = COALESCE($4::UUID, assignment_id),
           updated_at      = NOW()
       WHERE id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [name || null, status || null, assignment_type || null, assignment_id || null, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/guardian/devices/:id
 * Soft delete device.
 */
router.delete('/devices/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE guardian_devices
       SET deleted_at = NOW(), status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    logger.info(`Guardian device soft-deleted: ${req.params.id} by user ${req.user.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/devices/:id/command
 * Send a remote command to a device.
 */
router.post('/devices/:id/command', authenticate, async (req, res, next) => {
  try {
    const { command_type, payload } = req.body;

    const validCommandTypes = [
      'force_sync', 'start_live_tracking', 'stop_live_tracking',
      'lock_screen', 'trigger_siren', 'push_message', 'wipe_cache',
      'restart_agent', 'request_location', 'enable_lost_mode',
    ];
    if (!command_type || !validCommandTypes.includes(command_type)) {
      return res.status(400).json({
        error: `command_type must be one of: ${validCommandTypes.join(', ')}`,
      });
    }

    // Verify device exists
    const deviceCheck = await query(
      `SELECT id FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!deviceCheck.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await query(
      `INSERT INTO device_commands (device_id, command_type, payload, issued_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, issued_at`,
      [req.params.id, command_type, payload ? JSON.stringify(payload) : null, req.user.id]
    );

    const cmd = result.rows[0];

    const io = req.app.get('io');
    if (io) {
      io.emit('device:command', {
        device_id: req.params.id,
        command_type,
        payload: payload || null,
        command_id: cmd.id,
        issued_at: cmd.issued_at,
      });
    }

    logger.info(`Command issued: ${command_type} → device=${req.params.id} by user=${req.user.id}`);

    res.status(201).json({ command_id: cmd.id });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/devices/:id/history
 * Recent GPS trail (last 500 points, default 24 hours).
 */
router.get('/devices/:id/history', authenticate, async (req, res, next) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 168); // cap at 7 days

    const deviceCheck = await query(
      `SELECT id, name FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!deviceCheck.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await query(
      `SELECT lat, lng, altitude, heading, speed, accuracy, timestamp
       FROM device_locations
       WHERE device_id = $1 AND timestamp >= NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY timestamp DESC
       LIMIT 500`,
      [req.params.id, hours]
    );

    res.json({
      device_id: req.params.id,
      device_name: deviceCheck.rows[0].name,
      hours,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/panic
 * List panic events, newest first. Optional ?active_only=true
 */
router.get('/panic', authenticate, async (req, res, next) => {
  try {
    const { active_only, device_id, limit = 50, offset = 0 } = req.query;

    const filters = [];
    const params = [];

    if (active_only === 'true') {
      filters.push('pe.resolved_at IS NULL');
    }
    if (device_id) {
      params.push(device_id);
      filters.push(`pe.device_id = $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await query(
      `SELECT pe.*, gd.name AS device_name, gd.imei AS device_imei, gd.model AS device_model
       FROM panic_events pe
       JOIN guardian_devices gd ON gd.id = pe.device_id
       ${whereClause}
       ORDER BY pe.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) FROM panic_events pe ${whereClause}`,
      params.slice(0, -2)
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/guardian/panic/:id/resolve
 * Resolve a panic event.
 */
router.patch('/panic/:id/resolve', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE panic_events
       SET resolved_at = NOW(), resolved_by = $2
       WHERE id = $1 AND resolved_at IS NULL
       RETURNING id, device_id, resolved_at`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Panic event not found or already resolved' });
    }

    const panicEvent = result.rows[0];

    // Check if this device has any remaining unresolved panics
    const remaining = await query(
      `SELECT COUNT(*) FROM panic_events
       WHERE device_id = $1 AND resolved_at IS NULL`,
      [panicEvent.device_id]
    );

    if (parseInt(remaining.rows[0].count) === 0) {
      await query(
        `UPDATE guardian_devices SET panic_active = false, updated_at = NOW() WHERE id = $1`,
        [panicEvent.device_id]
      );
    }

    logger.info(`Panic resolved: ${req.params.id} by user=${req.user.id}`);

    res.json({ data: panicEvent });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/reports
 * List field reports. Params: {category, severity, device_id}
 */
router.get('/reports', authenticate, async (req, res, next) => {
  try {
    const { category, severity, device_id, limit = 50, offset = 0 } = req.query;

    const filters = [];
    const params = [];

    if (category) {
      params.push(category);
      filters.push(`fr.category = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      filters.push(`fr.severity = $${params.length}`);
    }
    if (device_id) {
      params.push(device_id);
      filters.push(`fr.device_id = $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await query(
      `SELECT fr.*, gd.name AS device_name, gd.imei AS device_imei
       FROM field_reports fr
       JOIN guardian_devices gd ON gd.id = fr.device_id
       ${whereClause}
       ORDER BY fr.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) FROM field_reports fr ${whereClause}`,
      params.slice(0, -2)
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

// ─── APK Download ─────────────────────────────────────────────────────────────
// Serve the Guardian Agent APK. Configure via env:
//   APK_FILE_PATH  — absolute path to a pre-built APK on the server
//   APK_REDIRECT_URL — URL to redirect to (e.g. a GitHub release asset)

router.get('/apk/download', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  // Option 1: redirect to an external URL (GitHub release, S3, etc.)
  if (process.env.APK_REDIRECT_URL) {
    return res.redirect(302, process.env.APK_REDIRECT_URL);
  }

  // Option 2: serve a local file
  const apkPath = process.env.APK_FILE_PATH
    || path.join(__dirname, '../../static/guardian-agent.apk');

  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({
      error: 'APK not yet built',
      message: 'The Guardian Agent APK must be compiled before it can be downloaded. Build it with: cd guardian-agent && ./gradlew assembleDebug',
      apk_path: apkPath,
      build_instructions: 'https://developer.android.com/studio',
    });
  }

  const stat = fs.statSync(apkPath);
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="FleetOps-Guardian.apk"');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(apkPath).pipe(res);
});

module.exports = router;
