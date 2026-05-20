import type { FastifyRequest, FastifyReply } from 'fastify';
import { verify } from '@node-rs/argon2';
import { query } from '../db.js';
import { config } from '../config.js';

export interface DeviceContext {
  id: string;
  org_id: string;
  status: string;
  assignment_type: string;
  assignment_id: string | null;
  integrity_checked_at: Date | null;
  integrityRefreshRequired: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceContext;
  }
}

interface GuardianDeviceRow {
  id: string;
  org_id: string;
  status: string;
  assignment_type: string;
  assignment_id: string | null;
  token_hash: string;
  integrity_checked_at: Date | null;
}

export async function deviceAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.headers['x-device-token'];
  if (!token || typeof token !== 'string') {
    await reply.status(401).send({ code: 'AUTH_REQUIRED', message: 'X-Device-Token header is required' });
    return;
  }

  const devices = await query<GuardianDeviceRow>(
    `SELECT id, org_id, status, assignment_type, assignment_id, token_hash, integrity_checked_at
     FROM guardian_devices
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 100`,
  );

  let matched: GuardianDeviceRow | null = null;
  for (const device of devices) {
    try {
      const ok = await verify(device.token_hash, token);
      if (ok) {
        matched = device;
        break;
      }
    } catch {
      // continue to next device
    }
  }

  if (!matched) {
    await reply.status(401).send({ code: 'AUTH_REQUIRED', message: 'Invalid device token' });
    return;
  }

  if (matched.status === 'revoked' || matched.status === 'suspended') {
    await reply.status(401).send({
      code: 'DEVICE_INACTIVE',
      message: `Device is ${matched.status}`,
    });
    return;
  }

  const integrityAgeSeconds = matched.integrity_checked_at
    ? (Date.now() - matched.integrity_checked_at.getTime()) / 1000
    : Infinity;

  request.device = {
    id: matched.id,
    org_id: matched.org_id,
    status: matched.status,
    assignment_type: matched.assignment_type,
    assignment_id: matched.assignment_id,
    integrity_checked_at: matched.integrity_checked_at,
    integrityRefreshRequired: integrityAgeSeconds > config.PLAY_INTEGRITY_MAX_AGE_SECONDS,
  };
}
