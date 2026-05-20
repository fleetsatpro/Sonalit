import { createHash } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import type { FastifyRequest, FastifyReply } from 'fastify';
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

  // O(1) indexed lookup via SHA-256 fast hash — avoids scanning all devices.
  const lookupHash = createHash('sha256').update(token).digest('hex');

  const devices = await query<GuardianDeviceRow>(
    `SELECT id, org_id, status, assignment_type, assignment_id, token_hash, integrity_checked_at
     FROM guardian_devices
     WHERE token_lookup_hash = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [lookupHash],
  );

  const candidate = devices[0];
  if (!candidate) {
    await reply.status(401).send({ code: 'AUTH_REQUIRED', message: 'Invalid device token' });
    return;
  }

  // Verify the full argon2id hash for the single matched candidate.
  let tokenValid = false;
  try {
    tokenValid = await verify(candidate.token_hash, token);
  } catch {
    // argon2 error counts as invalid
  }

  if (!tokenValid) {
    await reply.status(401).send({ code: 'AUTH_REQUIRED', message: 'Invalid device token' });
    return;
  }

  if (candidate.status === 'revoked' || candidate.status === 'suspended') {
    await reply.status(401).send({
      code: 'DEVICE_INACTIVE',
      message: `Device is ${candidate.status}`,
    });
    return;
  }

  const integrityAgeSeconds = candidate.integrity_checked_at
    ? (Date.now() - new Date(candidate.integrity_checked_at).getTime()) / 1000
    : Infinity;

  request.device = {
    id: candidate.id,
    org_id: candidate.org_id,
    status: candidate.status,
    assignment_type: candidate.assignment_type,
    assignment_id: candidate.assignment_id,
    integrity_checked_at: candidate.integrity_checked_at
      ? new Date(candidate.integrity_checked_at)
      : null,
    integrityRefreshRequired: integrityAgeSeconds > config.PLAY_INTEGRITY_MAX_AGE_SECONDS,
  };
}
