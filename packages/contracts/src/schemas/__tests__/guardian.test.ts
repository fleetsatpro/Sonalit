import { describe, it, expect } from 'vitest';
import {
  EnrollRequestSchema,
  HeartbeatRequestSchema,
  CfoLoginRequestSchema,
  CommandSchema,
  GuardianDeviceSchema,
  IntegrityVerdictSchema,
  PanicRequestSchema,
  AckRequestSchema,
} from '../guardian.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_ISO = '2024-06-01T10:00:00.000Z';

describe('EnrollRequestSchema', () => {
  const validPayload = {
    org_id: VALID_UUID,
    android_id: 'abcdef1234567890',
    manufacturer: 'Samsung',
    model: 'Galaxy Tab A',
    os_version: '14',
    app_version: '4.0.1',
    name: 'Truck CFO Device',
    enroll_token: 'otp-supersecret-12345',
  };

  it('parses a valid enroll request', () => {
    const result = EnrollRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts optional IMEI when provided', () => {
    const result = EnrollRequestSchema.safeParse({
      ...validPayload,
      imei: '123456789012345',
    });
    expect(result.success).toBe(true);
  });

  it('rejects IMEI shorter than 15 digits', () => {
    const result = EnrollRequestSchema.safeParse({
      ...validPayload,
      imei: '12345',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing org_id', () => {
    const { org_id: _, ...rest } = validPayload;
    const result = EnrollRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid org_id (not UUID)', () => {
    const result = EnrollRequestSchema.safeParse({
      ...validPayload,
      org_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty enroll_token', () => {
    const result = EnrollRequestSchema.safeParse({
      ...validPayload,
      enroll_token: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing manufacturer', () => {
    const { manufacturer: _, ...rest } = validPayload;
    const result = EnrollRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('HeartbeatRequestSchema', () => {
  const validPayload = {
    device_id: VALID_UUID,
    app_version: '4.0.1',
    battery_pct: 85,
    is_charging: false,
    network_type: 'cellular',
    timestamp: VALID_ISO,
  };

  it('parses a valid heartbeat', () => {
    const result = HeartbeatRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts null nullable fields', () => {
    const result = HeartbeatRequestSchema.safeParse({
      ...validPayload,
      battery_pct: null,
      is_charging: null,
      network_type: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects battery_pct above 100', () => {
    const result = HeartbeatRequestSchema.safeParse({
      ...validPayload,
      battery_pct: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects battery_pct below 0', () => {
    const result = HeartbeatRequestSchema.safeParse({
      ...validPayload,
      battery_pct: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid network_type', () => {
    const result = HeartbeatRequestSchema.safeParse({
      ...validPayload,
      network_type: 'satellite',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamp', () => {
    const result = HeartbeatRequestSchema.safeParse({
      ...validPayload,
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('CfoLoginRequestSchema', () => {
  const validPayload = {
    device_id: VALID_UUID,
    user_pin: '1234',
  };

  it('parses a valid login request', () => {
    const result = CfoLoginRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts optional convoy_id', () => {
    const result = CfoLoginRequestSchema.safeParse({
      ...validPayload,
      convoy_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects pin shorter than 4 characters', () => {
    const result = CfoLoginRequestSchema.safeParse({
      ...validPayload,
      user_pin: '123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects pin longer than 16 characters', () => {
    const result = CfoLoginRequestSchema.safeParse({
      ...validPayload,
      user_pin: '12345678901234567',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid device_id', () => {
    const result = CfoLoginRequestSchema.safeParse({
      ...validPayload,
      device_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid convoy_id', () => {
    const result = CfoLoginRequestSchema.safeParse({
      ...validPayload,
      convoy_id: 'bad',
    });
    expect(result.success).toBe(false);
  });
});

describe('CommandSchema', () => {
  const validCommand = {
    id: VALID_UUID,
    device_id: VALID_UUID,
    type: 'CHANGE_MODE',
    payload: { mode: 'live' },
    issued_at: VALID_ISO,
    expires_at: '2024-06-01T11:00:00.000Z',
    acked_at: null,
  };

  it('parses a valid command', () => {
    const result = CommandSchema.safeParse(validCommand);
    expect(result.success).toBe(true);
  });

  it('rejects unknown command type', () => {
    const result = CommandSchema.safeParse({
      ...validCommand,
      type: 'UNKNOWN_COMMAND',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string payload values', () => {
    const result = CommandSchema.safeParse({
      ...validCommand,
      payload: { mode: 42 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid command types', () => {
    const types = [
      'CHANGE_MODE',
      'LOCKDOWN',
      'WIPE',
      'SEND_MESSAGE',
      'TAKE_PHOTO',
      'UPDATE_PINS',
    ] as const;
    for (const type of types) {
      const result = CommandSchema.safeParse({ ...validCommand, type });
      expect(result.success).toBe(true);
    }
  });
});

describe('IntegrityVerdictSchema', () => {
  const validVerdict = {
    deviceIntegrity: true,
    basicIntegrity: true,
    appIntegrity: true,
    verdictString: 'MEETS_DEVICE_INTEGRITY',
    tokenTime: VALID_ISO,
  };

  it('parses a valid integrity verdict', () => {
    const result = IntegrityVerdictSchema.safeParse(validVerdict);
    expect(result.success).toBe(true);
  });

  it('rejects invalid verdictString', () => {
    const result = IntegrityVerdictSchema.safeParse({
      ...validVerdict,
      verdictString: 'INVALID_VALUE',
    });
    expect(result.success).toBe(false);
  });

  it('accepts FAILS verdict', () => {
    const result = IntegrityVerdictSchema.safeParse({
      ...validVerdict,
      deviceIntegrity: false,
      basicIntegrity: false,
      verdictString: 'FAILS',
    });
    expect(result.success).toBe(true);
  });
});

describe('PanicRequestSchema', () => {
  const validPanic = {
    device_id: VALID_UUID,
    lat: 6.5244,
    lng: 3.3792,
    accuracy: 10.5,
    timestamp: VALID_ISO,
  };

  it('parses a valid panic request', () => {
    const result = PanicRequestSchema.safeParse(validPanic);
    expect(result.success).toBe(true);
  });

  it('rejects lat out of bounds', () => {
    const result = PanicRequestSchema.safeParse({ ...validPanic, lat: 91 });
    expect(result.success).toBe(false);
  });

  it('rejects lng out of bounds', () => {
    const result = PanicRequestSchema.safeParse({ ...validPanic, lng: 181 });
    expect(result.success).toBe(false);
  });
});

describe('AckRequestSchema', () => {
  it('parses a valid ack request', () => {
    const result = AckRequestSchema.safeParse({
      command_id: VALID_UUID,
      device_id: VALID_UUID,
      acked_at: VALID_ISO,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid command_id', () => {
    const result = AckRequestSchema.safeParse({
      command_id: 'not-uuid',
      device_id: VALID_UUID,
      acked_at: VALID_ISO,
    });
    expect(result.success).toBe(false);
  });
});
