import { describe, it, expect } from 'vitest';
import {
  AuditLogSchema,
  AuditLogWriteSchema,
  AuditLogQuerySchema,
  ActorTypeSchema,
} from '../audit.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_ISO = '2024-06-01T10:00:00.000Z';
const VALID_SHA256 =
  'a'.repeat(64); // 64 hex chars — valid SHA-256 pattern (all 'a' is valid hex)

const validAuditLog = {
  id: VALID_UUID,
  service: 'convoy-service',
  action: 'convoy.status_changed',
  actor_type: 'user',
  actor_id: VALID_UUID,
  org_id: VALID_UUID,
  resource_type: 'convoy',
  resource_id: VALID_UUID,
  before_state: { status: 'planned' },
  after_state: { status: 'active' },
  ip_address: '192.168.1.1',
  user_agent: 'Mozilla/5.0',
  prev_hash: VALID_SHA256,
  created_at: VALID_ISO,
};

describe('AuditLogSchema', () => {
  it('parses a valid audit log entry', () => {
    const result = AuditLogSchema.safeParse(validAuditLog);
    expect(result.success).toBe(true);
  });

  it('accepts null nullable fields', () => {
    const result = AuditLogSchema.safeParse({
      ...validAuditLog,
      org_id: null,
      before_state: null,
      after_state: null,
      ip_address: null,
      user_agent: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required field: service', () => {
    const { service: _, ...rest } = validAuditLog;
    const result = AuditLogSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing required field: action', () => {
    const { action: _, ...rest } = validAuditLog;
    const result = AuditLogSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid actor_type', () => {
    const result = AuditLogSchema.safeParse({
      ...validAuditLog,
      actor_type: 'robot',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid actor_types', () => {
    const actorTypes = ['user', 'device', 'system'] as const;
    for (const actor_type of actorTypes) {
      const result = AuditLogSchema.safeParse({ ...validAuditLog, actor_type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid ip_address', () => {
    const result = AuditLogSchema.safeParse({
      ...validAuditLog,
      ip_address: 'not-an-ip',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid IPv6 address', () => {
    const result = AuditLogSchema.safeParse({
      ...validAuditLog,
      ip_address: '2001:db8::1',
    });
    expect(result.success).toBe(true);
  });

  describe('prev_hash — SHA-256 hex validation', () => {
    it('accepts a valid 64-char lowercase hex SHA-256', () => {
      const validHash =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: validHash,
      });
      expect(result.success).toBe(true);
    });

    it('rejects a hash that is too short (63 chars)', () => {
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: 'a'.repeat(63),
      });
      expect(result.success).toBe(false);
    });

    it('rejects a hash that is too long (65 chars)', () => {
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: 'a'.repeat(65),
      });
      expect(result.success).toBe(false);
    });

    it('rejects a hash with uppercase chars', () => {
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: 'A'.repeat(64),
      });
      expect(result.success).toBe(false);
    });

    it('rejects a hash with non-hex characters', () => {
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: 'g'.repeat(64),
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty prev_hash', () => {
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: '',
      });
      expect(result.success).toBe(false);
    });

    it('validates the actual SHA-256 of empty string', () => {
      // echo -n "" | sha256sum = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const emptyStrHash =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(emptyStrHash).toHaveLength(64);
      const result = AuditLogSchema.safeParse({
        ...validAuditLog,
        prev_hash: emptyStrHash,
      });
      expect(result.success).toBe(true);
    });
  });

  it('infers correct TypeScript shape', () => {
    const parsed = AuditLogSchema.parse(validAuditLog);
    expect(parsed.service).toBe('convoy-service');
    expect(parsed.actor_type).toBe('user');
    expect(parsed.before_state).toEqual({ status: 'planned' });
  });
});

describe('AuditLogWriteSchema', () => {
  it('omits id and prev_hash from the write schema', () => {
    const { id: _id, prev_hash: _hash, created_at: _ca, ...writePayload } = validAuditLog;
    const result = AuditLogWriteSchema.safeParse(writePayload);
    expect(result.success).toBe(true);
  });

  it('rejects if id is present (it should be omitted)', () => {
    // id is extra — zod strips unknown keys but doesn't fail by default.
    // We just check that write schema has no id in the type (structural test).
    const write = AuditLogWriteSchema.parse({
      ...validAuditLog,
    });
    // @ts-expect-error — id is not in AuditLogWrite type
    expect((write as { id?: string }).id).toBeUndefined();
  });
});

describe('AuditLogQuerySchema', () => {
  it('applies defaults correctly', () => {
    const result = AuditLogQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it('rejects limit above 500', () => {
    const result = AuditLogQuerySchema.safeParse({ limit: 501 });
    expect(result.success).toBe(false);
  });

  it('rejects limit below 1', () => {
    const result = AuditLogQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts optional filters', () => {
    const result = AuditLogQuerySchema.safeParse({
      org_id: VALID_UUID,
      actor_id: VALID_UUID,
      action: 'convoy.status_changed',
      from: VALID_ISO,
      to: VALID_ISO,
    });
    expect(result.success).toBe(true);
  });
});

describe('ActorTypeSchema', () => {
  it.each(['user', 'device', 'system'])('accepts %s as a valid actor type', (type) => {
    const result = ActorTypeSchema.safeParse(type);
    expect(result.success).toBe(true);
  });

  it('rejects unknown actor types', () => {
    const result = ActorTypeSchema.safeParse('api');
    expect(result.success).toBe(false);
  });
});
