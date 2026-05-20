import { describe, it, expect } from 'vitest';
import {
  GpsFixSchema,
  GpsFixBatchSchema,
  GpsRollup1mSchema,
  GpsRollup5mSchema,
  GpsRollup1hSchema,
  GpsRollupSchema,
} from '../telemetry.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_ISO = '2024-06-01T10:00:00.000Z';

const makeFix = (overrides: Record<string, unknown> = {}) => ({
  device_id: VALID_UUID,
  org_id: ORG_UUID,
  seq_no: 1,
  lat: 6.5244,
  lng: 3.3792,
  altitude: 20.5,
  speed: 15.3,
  heading: 90,
  accuracy: 5.0,
  timestamp: VALID_ISO,
  tracking_mode: 'normal',
  ...overrides,
});

describe('GpsFixSchema', () => {
  it('parses a valid GPS fix', () => {
    const result = GpsFixSchema.safeParse(makeFix());
    expect(result.success).toBe(true);
  });

  it('accepts null nullable fields', () => {
    const result = GpsFixSchema.safeParse(
      makeFix({ altitude: null, speed: null, heading: null, accuracy: null }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects lat out of range (>90)', () => {
    const result = GpsFixSchema.safeParse(makeFix({ lat: 91 }));
    expect(result.success).toBe(false);
  });

  it('rejects lat out of range (<-90)', () => {
    const result = GpsFixSchema.safeParse(makeFix({ lat: -91 }));
    expect(result.success).toBe(false);
  });

  it('rejects lng out of range (>180)', () => {
    const result = GpsFixSchema.safeParse(makeFix({ lng: 181 }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid tracking_mode', () => {
    const result = GpsFixSchema.safeParse(makeFix({ tracking_mode: 'turbo' }));
    expect(result.success).toBe(false);
  });

  it('accepts all valid tracking modes', () => {
    const modes = ['normal', 'live', 'stealth', 'emergency'] as const;
    for (const mode of modes) {
      const result = GpsFixSchema.safeParse(makeFix({ tracking_mode: mode }));
      expect(result.success).toBe(true);
    }
  });

  it('rejects negative seq_no', () => {
    const result = GpsFixSchema.safeParse(makeFix({ seq_no: -1 }));
    expect(result.success).toBe(false);
  });

  it('rejects negative accuracy', () => {
    const result = GpsFixSchema.safeParse(makeFix({ accuracy: -1 }));
    expect(result.success).toBe(false);
  });

  it('rejects negative speed', () => {
    const result = GpsFixSchema.safeParse(makeFix({ speed: -5 }));
    expect(result.success).toBe(false);
  });

  it('rejects heading above 360', () => {
    const result = GpsFixSchema.safeParse(makeFix({ heading: 361 }));
    expect(result.success).toBe(false);
  });
});

describe('GpsFixBatchSchema', () => {
  const makeValidBatch = (count: number) => ({
    device_id: VALID_UUID,
    org_id: ORG_UUID,
    fixes: Array.from({ length: count }, (_, i) => makeFix({ seq_no: i })),
  });

  it('parses a valid batch with one fix', () => {
    const result = GpsFixBatchSchema.safeParse(makeValidBatch(1));
    expect(result.success).toBe(true);
  });

  it('parses a valid batch with 50 fixes (max)', () => {
    const result = GpsFixBatchSchema.safeParse(makeValidBatch(50));
    expect(result.success).toBe(true);
  });

  it('rejects an empty fixes array (min=1)', () => {
    const result = GpsFixBatchSchema.safeParse({
      device_id: VALID_UUID,
      org_id: ORG_UUID,
      fixes: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/at least 1/i);
    }
  });

  it('rejects a batch exceeding 50 fixes', () => {
    const result = GpsFixBatchSchema.safeParse(makeValidBatch(51));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/50/);
    }
  });

  it('rejects missing device_id', () => {
    const batch = makeValidBatch(1);
    const { device_id: _, ...rest } = batch;
    const result = GpsFixBatchSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid device_id', () => {
    const result = GpsFixBatchSchema.safeParse({
      ...makeValidBatch(1),
      device_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects batch with an invalid fix inside', () => {
    const result = GpsFixBatchSchema.safeParse({
      ...makeValidBatch(1),
      fixes: [makeFix({ lat: 999 })],
    });
    expect(result.success).toBe(false);
  });

  it('infers correct TypeScript type shape', () => {
    const parsed = GpsFixBatchSchema.parse(makeValidBatch(2));
    expect(parsed.fixes).toHaveLength(2);
    expect(typeof parsed.device_id).toBe('string');
    expect(parsed.fixes[0]?.tracking_mode).toBe('normal');
  });
});

describe('GpsRollup schemas', () => {
  const baseRollup = {
    device_id: VALID_UUID,
    org_id: ORG_UUID,
    bucket: VALID_ISO,
    avg_lat: 6.5,
    avg_lng: 3.4,
    fix_count: 12,
    max_speed: 25.5,
    avg_speed: 15.0,
  };

  it('parses a valid 1m rollup', () => {
    const result = GpsRollup1mSchema.safeParse({
      ...baseRollup,
      resolution: '1m',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid 5m rollup', () => {
    const result = GpsRollup5mSchema.safeParse({
      ...baseRollup,
      resolution: '5m',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid 1h rollup', () => {
    const result = GpsRollup1hSchema.safeParse({
      ...baseRollup,
      resolution: '1h',
    });
    expect(result.success).toBe(true);
  });

  it('discriminates rollup type via GpsRollupSchema', () => {
    const result = GpsRollupSchema.safeParse({
      ...baseRollup,
      resolution: '5m',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resolution).toBe('5m');
    }
  });

  it('rejects unknown resolution', () => {
    const result = GpsRollupSchema.safeParse({
      ...baseRollup,
      resolution: '15m',
    });
    expect(result.success).toBe(false);
  });

  it('accepts null for max_speed and avg_speed', () => {
    const result = GpsRollup1mSchema.safeParse({
      ...baseRollup,
      resolution: '1m',
      max_speed: null,
      avg_speed: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative fix_count', () => {
    const result = GpsRollup1mSchema.safeParse({
      ...baseRollup,
      resolution: '1m',
      fix_count: -1,
    });
    expect(result.success).toBe(false);
  });
});
