import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { query, queryOne } from '../db.js';
import { getJs } from '../nats.js';
import { StringCodec } from 'nats';
import { NotFoundError, AuthError } from '../lib/errors.js';
import { deviceAuthHook } from '../middleware/deviceAuth.js';

const EnrollSchema = z.object({
  device_id: z.string().min(1).max(255),
  operator_code: z.string().min(1),
  play_integrity_token: z.string().min(1),
  fcm_token: z.string().optional(),
  platform: z.string().default('android'),
  app_version: z.string().optional(),
});

const HeartbeatSchema = z.object({
  battery_pct: z.number().int().min(0).max(100).optional(),
  connectivity: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

const PanicSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  driver_id: z.string().uuid().optional(),
  note: z.string().max(1000).optional(),
});

const CommandSchema = z.object({
  device_id: z.string().uuid(),
  command_type: z.enum(['reboot', 'lock', 'wipe', 'photo', 'locate']),
  params: z.record(z.unknown()).optional(),
});

const sc = StringCodec();

export const guardianRoutes: FastifyPluginAsync = async (app) => {

  // Enrollment: device presents operator_code; server issues a one-time opaque token.
  // Token hash (argon2id) and lookup hash (sha256) are stored for O(1) auth.
  app.post('/v4/guardian/enroll', async (req, reply) => {
    const body = EnrollSchema.parse(req.body);

    const existing = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM guardian_devices WHERE device_id=$1 AND deleted_at IS NULL',
      [body.device_id],
    );
    if (existing) {
      return reply.code(200).send({ status: existing.status, device_uuid: existing.id });
    }

    const rawToken = randomUUID();
    const lookupHash = createHash('sha256').update(rawToken).digest('hex');
    const tokenHash = await argon2Hash(rawToken);

    const device = await queryOne<{ id: string }>(
      `INSERT INTO guardian_devices
        (id, device_id, operator_code, play_integrity_token, fcm_token, platform, app_version,
         token_hash, token_lookup_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       RETURNING id`,
      [
        randomUUID(), body.device_id, body.operator_code, body.play_integrity_token,
        body.fcm_token ?? null, body.platform, body.app_version ?? null,
        tokenHash, lookupHash,
      ],
    );

    if (!device) throw new Error('INSERT failed');

    return reply.code(202).send({
      status: 'pending_approval',
      device_uuid: device.id,
      device_token: rawToken,
    });
  });

  // Heartbeat: requires device auth. Updates heartbeat timestamp and returns pending commands.
  app.post('/v4/guardian/heartbeat', { preHandler: deviceAuthHook }, async (req, reply) => {
    const device = req.device!;
    const body = HeartbeatSchema.parse(req.body);

    await query(
      `UPDATE guardian_devices
       SET last_heartbeat_at=NOW(), battery_pct=$1, last_lat=$2, last_lon=$3, updated_at=NOW()
       WHERE id=$4`,
      [body.battery_pct ?? null, body.lat ?? null, body.lon ?? null, device.id],
    );

    const cmds = await query(
      `SELECT id, command_type, params, created_at FROM device_commands
       WHERE device_id=$1 AND status='pending'
       ORDER BY created_at ASC LIMIT 5`,
      [device.id],
    );

    return reply.send({
      commands: cmds,
      integrity_refresh_required: device.integrityRefreshRequired,
    });
  });

  // Panic: requires device auth. Always publishes to NATS; DB insert is a secondary record.
  app.post('/v4/guardian/panic', { preHandler: deviceAuthHook }, async (req, reply) => {
    const device = req.device!;
    const body = PanicSchema.parse(req.body);
    const eventId = randomUUID();

    await query(
      `INSERT INTO panic_events (id, device_id, org_id, lat, lon, driver_id, note, event_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(), device.id, device.org_id,
        body.lat, body.lon,
        body.driver_id ?? null, body.note ?? null,
        eventId,
      ],
    );

    try {
      const js = getJs();
      await js.publish(
        `events.panic.${device.org_id}`,
        sc.encode(JSON.stringify({
          event_id: eventId,
          device_id: device.id,
          org_id: device.org_id,
          lat: body.lat,
          lon: body.lon,
          driver_id: body.driver_id,
          ts: Date.now(),
        })),
        { msgID: eventId },
      );
    } catch {
      // Never block a panic on NATS failure — DB record was already written.
    }

    return reply.code(202).send({ event_id: eventId, status: 'received' });
  });

  // Issue a command to a device (operator-facing, not device-facing — no device auth here).
  app.post('/v4/guardian/commands', async (req, reply) => {
    const body = CommandSchema.parse(req.body);
    const device = await queryOne<{ id: string }>(
      'SELECT id FROM guardian_devices WHERE id=$1 AND deleted_at IS NULL',
      [body.device_id],
    );
    if (!device) throw new NotFoundError('Device not found');

    const [cmd] = await query<{ id: string; command_type: string; status: string }>(
      `INSERT INTO device_commands (id, device_id, command_type, params, status)
       VALUES ($1,$2,$3,$4,'pending') RETURNING id, command_type, status, created_at`,
      [randomUUID(), body.device_id, body.command_type, JSON.stringify(body.params ?? {})],
    );
    return reply.code(201).send(cmd);
  });

  // ACK a command (device-facing, requires device auth).
  app.post('/v4/guardian/ack-command', { preHandler: deviceAuthHook }, async (req, reply) => {
    const device = req.device!;
    const { command_id } = z.object({ command_id: z.string().uuid() }).parse(req.body);
    await query(
      `UPDATE device_commands SET status='acknowledged', acked_at=NOW()
       WHERE id=$1 AND device_id=$2`,
      [command_id, device.id],
    );
    return reply.send({ status: 'ok' });
  });

  // List enrolled devices (operator-facing).
  app.get('/v4/guardian/devices', async (req, reply) => {
    const orgId = req.headers['x-org-id'] as string | undefined;
    if (!orgId) throw new AuthError('x-org-id header required');

    const devices = await query(
      `SELECT id, device_id, name, status, platform, app_version,
              last_heartbeat_at, battery_pct, assignment_type, assignment_id
       FROM guardian_devices
       WHERE org_id=$1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [orgId],
    );
    return reply.send({ data: devices });
  });

  // Approve/activate a pending device (operator-facing).
  app.post('/v4/guardian/devices/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const device = await queryOne<{ id: string; status: string }>(
      `UPDATE guardian_devices SET status='enrolled', updated_at=NOW()
       WHERE id=$1 AND status='pending' AND deleted_at IS NULL
       RETURNING id, status`,
      [id],
    );
    if (!device) throw new NotFoundError('Device not found or not in pending state');
    return reply.send(device);
  });
};
