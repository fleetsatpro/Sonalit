import { getJs } from '../nats.js';
import { StringCodec } from 'nats';
import { randomUUID } from 'node:crypto';

export interface AuditEvent {
  action: string;
  actorType: 'user' | 'system';
  actorId: string;
  orgId: string | null;
  resourceType: string;
  resourceId: string;
  beforeState?: unknown;
  afterState?: unknown;
  ipAddress: string;
  userAgent: string;
}

const sc = StringCodec();

export async function publishAudit(event: AuditEvent): Promise<void> {
  const js = getJs();
  const payload = {
    id: randomUUID(),
    service: 'auth-svc',
    ...event,
    created_at: new Date().toISOString(),
  };
  await js.publish(`audit.auth-svc`, sc.encode(JSON.stringify(payload)));
}
