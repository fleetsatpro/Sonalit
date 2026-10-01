import { createHash } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db.js';

export interface TelemetryDevice { id: string; org_id: string; status: string; }

declare module 'fastify' {
  interface FastifyRequest { telemetryDevice?: TelemetryDevice; }
}

export async function deviceAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.headers['x-device-token'];
  if (!token || typeof token !== 'string') {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'X-Device-Token header is required' });
    return;
  }

  const lookupHash = createHash('sha256').update(token).digest('hex');
  const rows = await query<TelemetryDevice & { token_hash: string }>(
    `SELECT id, org_id, status, token_hash
       FROM guardian_devices
      WHERE token_lookup_hash = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [lookupHash],
  );
  const device = rows[0];
  if (!device || !device.org_id) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Invalid device token' });
    return;
  }

  let valid = false;
  try { valid = await verify(device.token_hash, token); } catch { /* invalid */ }
  if (!valid) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Invalid device token' });
    return;
  }
  if (device.status !== 'enrolled') {
    await reply.code(401).send({ code: 'DEVICE_INACTIVE', message: `Device is ${device.status}` });
    return;
  }

  request.telemetryDevice = { id: device.id, org_id: device.org_id, status: device.status };
}
