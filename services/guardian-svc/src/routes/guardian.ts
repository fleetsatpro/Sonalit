import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { getJs } from '../nats.js';
import { StringCodec } from 'nats';
import { NotFoundError, AuthError } from '../lib/errors.js';

const EnrollSchema = z.object({
  device_id: z.string().min(1).max(255),
  operator_code: z.string().min(1),
  play_integrity_token: z.string().min(1),
  fcm_token: z.string().optional(),
  platform: z.string().default('android'),
  app_version: z.string().optional(),
});

const HeartbeatSchema = z.object({
  device_id: z.string().uuid(),
  battery_pct: z.number().int().min(0).max(100).optional(),
  connectivity: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

const PanicSchema = z.object({
  device_id: z.string().uuid(),
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

export const guardianRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v4/guardian/enroll', async (req, reply) => {
    const body = EnrollSchema.parse(req.body);
    const existing = await query<{ id: string; status: string }>('SELECT id, status FROM guardian_devices WHERE device_id=$1', [body.device_id]);
    if (existing.rows[0]) {
      return reply.code(200).send({ status: existing.rows[0].status, device_uuid: existing.rows[0].id });
    }
    const { rows: [device] } = await query(
      `INSERT INTO guardian_devices (id, device_id, operator_code, play_integrity_token, fcm_token, platform, app_version, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [randomUUID(), body.device_id, body.operator_code, body.play_integrity_token, body.fcm_token ?? null, body.platform, body.app_version ?? null],
    );
    return reply.code(202).send({ status: 'pending_approval', device_uuid: device.id });
  });

  app.post('/v4/guardian/heartbeat', async (req, reply) => {
    const body = HeartbeatSchema.parse(req.body);
    const { rows: [device] } = await query<{ id: string; org_id: string }>('SELECT id, org_id FROM guardian_devices WHERE id=$1 AND status=\'enrolled\'', [body.device_id]);
    if (!device) throw new AuthError('Device not enrolled');
    await query(
      'UPDATE guardian_devices SET last_heartbeat_at=NOW(), battery_pct=$1, last_lat=$2, last_lon=$3 WHERE id=$4',
      [body.battery_pct ?? null, body.lat ?? null, body.lon ?? null, body.device_id],
    );
    const { rows: cmds } = await query(
      'SELECT * FROM device_commands WHERE device_id=$1 AND status=\'pending\' ORDER BY created_at LIMIT 5',
      [body.device_id],
    );
    return reply.send({ commands: cmds });
  });

  app.post('/v4/guardian/panic', async (req, reply) => {
    const body = PanicSchema.parse(req.body);
    const { rows: [device] } = await query<{ org_id: string }>('SELECT org_id FROM guardian_devices WHERE id=$1', [body.device_id]);
    const org_id = device?.org_id ?? 'unknown';
    const eventId = randomUUID();
    await query(
      'INSERT INTO panic_events (id, device_id, org_id, lat, lon, driver_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [eventId, body.device_id, org_id, body.lat, body.lon, body.driver_id ?? null, body.note ?? null],
    );
    try {
      const js = getJs(); const sc = StringCodec();
      await js.publish('events.panic', sc.encode(JSON.stringify({ event_id: eventId, device_id: body.device_id, org_id, lat: body.lat, lon: body.lon })));
    } catch { /* never block panic */ }
    return reply.code(202).send({ event_id: eventId, status: 'received' });
  });

  app.post('/v4/guardian/commands', async (req, reply) => {
    const body = CommandSchema.parse(req.body);
    const { rows: [device] } = await query<{ id: string }>('SELECT id FROM guardian_devices WHERE id=$1', [body.device_id]);
    if (!device) throw new NotFoundError('Device not found');
    const { rows: [cmd] } = await query(
      'INSERT INTO device_commands (id, device_id, command_type, params, status) VALUES ($1,$2,$3,$4,\'pending\') RETURNING *',
      [randomUUID(), body.device_id, body.command_type, JSON.stringify(body.params ?? {})],
    );
    return reply.code(201).send(cmd);
  });

  app.post('/v4/guardian/ack-command', async (req, reply) => {
    const { command_id } = z.object({ command_id: z.string().uuid() }).parse(req.body);
    await query('UPDATE device_commands SET status=\'acknowledged\', acked_at=NOW() WHERE id=$1', [command_id]);
    return reply.send({ status: 'ok' });
  });

  app.get('/v4/guardian/devices', async (_req, reply) => {
    const { rows } = await query('SELECT id, device_id, status, platform, app_version, last_heartbeat_at, battery_pct FROM guardian_devices ORDER BY created_at DESC', []);
    return reply.send({ data: rows });
  });
};
