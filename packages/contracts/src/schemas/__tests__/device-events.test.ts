import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { NATS_SUBJECTS, STREAM_CONFIG } from '../../events/subjects.js';
import {
  DEVICE_EVENT_MAX_BATCH,
  DeviceEventBatchEnvelopeSchema,
  DeviceEventBatchResponseSchema,
  DeviceEventBatchSchema,
  DeviceEventSchema,
  DeviceEventTypeSchema,
  canonicalDataString,
  deviceEventBand,
  deviceEventSigningString,
} from '../device-events.js';

const DEVICE_ID = '6f1c2d9e-8a41-4b7e-9d33-2c5e0a7b1f64';
// 64 bytes in unpadded base64url: 85 characters plus one of A, Q, g, w.
const SIG = 'A'.repeat(86);

const sha256Hex = (input: string) => createHash('sha256').update(input).digest('hex');

const envelope = (overrides: Record<string, unknown> = {}) => ({
  event_id: 'SC-000123:48211',
  counter: 48211,
  occurred_at: '2026-10-11T09:42:17.350Z',
  time_source: 'gnss',
  uplink: 'direct',
  buffered: false,
  kid: 'k1',
  sig: SIG,
  ...overrides,
});

// One valid event per type. The test below fails if a type is added to the enum
// without a sample here, so the table cannot silently fall behind.
const SAMPLES: Record<string, Record<string, unknown>> = {
  'alert.panic': { trigger: 'manual', note: 'driver pressed SOS' },
  'custody.door': { state: 'open', door: 1, moving: true, speed_kph: 62 },
  'custody.seal': { state: 'cut', seal_number: 'KE-883210', rfid_code: 'E280689400', seal_position: 2 },
  'custody.driver': { badge_id: 'BADGE-7741', state: 'in' },
  'sensor.reading': { metric: 'temperature_c', value: '4.20', probe: 0 },
  'sensor.alarm': { metric: 'humidity_pct', value: '88.00', limit: '80.00', direction: 'above' },
  'motion.impact': { peak_g: '9.40', duration_ms: 120, class: 'crash', trace_id: 'tr-1' },
  'motion.harsh': { kind: 'brake', peak_g: '0.62', duration_ms: 900 },
  'motion.tilt': { kind: 'rollover', roll_deg: '78.5', pitch_deg: '4.0' },
  'integrity.gnss': { jamming: 'warning', spoofing: 'none', osnma: 'na' },
  'integrity.tamper': { source: 'enclosure', state: 'tripped' },
  'integrity.attest': { fw_version: '0.9.2', fw_hash: 'a'.repeat(64), boot_state: 'verified' },
  'power.state': { source: 'battery', vin_mv: 0, batt_pct: 96, charging: false },
  'vehicle.state': { ignition: true, can_speed_kph: 61, odometer_km: 120443, engine_h: '3011.5', fuel_pct: 54, dtc_count: 0 },
  'proximity.summary': { peer_count: 3, nearest_serial: 'SC-000124', nearest_rssi_dbm: -97, nearest_age_s: 4, cfo_phone: true },
};

const make = (type: string, data = SAMPLES[type], overrides: Record<string, unknown> = {}) =>
  envelope({ type, data, ...overrides });

describe('DeviceEventSchema', () => {
  it('has a sample for every event type', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...DeviceEventTypeSchema.options].sort());
  });

  it.each(Object.keys(SAMPLES))('parses a valid %s event', (type) => {
    const result = DeviceEventSchema.safeParse(make(type));
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(DeviceEventSchema.safeParse(make('custody.nope', {})).success).toBe(false);
  });

  it('rejects an unknown field in data, because the signature would not cover it', () => {
    const bad = make('custody.door', { ...SAMPLES['custody.door'], extra: 1 });
    expect(DeviceEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown envelope field', () => {
    expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { org_id: DEVICE_ID })).success).toBe(false);
  });

  it('requires decimals as fixed-place strings, not numbers', () => {
    const asNumber = make('sensor.reading', { metric: 'temperature_c', value: 4.2, probe: 0 });
    const wrongPlaces = make('sensor.reading', { metric: 'temperature_c', value: '4.2', probe: 0 });
    expect(DeviceEventSchema.safeParse(asNumber).success).toBe(false);
    expect(DeviceEventSchema.safeParse(wrongPlaces).success).toBe(false);
  });

  it('rejects a float where an integer is required', () => {
    const bad = make('custody.door', { ...SAMPLES['custody.door'], speed_kph: 61.5 });
    expect(DeviceEventSchema.safeParse(bad).success).toBe(false);
  });

  it('lets a vehicle with no CAN connection report ignition alone', () => {
    expect(DeviceEventSchema.safeParse(make('vehicle.state', { ignition: false })).success).toBe(true);
  });

  it('rejects percentages outside 0 to 100', () => {
    expect(DeviceEventSchema.safeParse(make('power.state', { ...SAMPLES['power.state'], batt_pct: 101 })).success).toBe(false);
  });

  it('reuses the panic trigger vocabulary from the Guardian contract', () => {
    expect(DeviceEventSchema.safeParse(make('alert.panic', { trigger: 'impact_detected' })).success).toBe(true);
    expect(DeviceEventSchema.safeParse(make('alert.panic', { trigger: 'because' })).success).toBe(false);
  });

  describe('event_id', () => {
    it('accepts serial and counter', () => {
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { event_id: 'SC-1:7' })).success).toBe(true);
    });
    it('rejects the signing-string delimiter', () => {
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { event_id: 'SC-1|7' })).success).toBe(false);
    });
    it('rejects empty and over-long ids', () => {
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { event_id: '' })).success).toBe(false);
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { event_id: 'a'.repeat(65) })).success).toBe(false);
    });
  });

  describe('counter', () => {
    it('rejects negatives, fractions and values beyond the safe integer range', () => {
      for (const counter of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { counter })).success).toBe(false);
      }
    });
  });

  describe('signature encoding', () => {
    it('accepts the four valid final characters', () => {
      for (const last of ['A', 'Q', 'g', 'w']) {
        const sig = 'B'.repeat(85) + last;
        expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { sig })).success).toBe(true);
      }
    });
    it('rejects a final character that would encode more than two bits', () => {
      const sig = `${'B'.repeat(85)}B`;
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { sig })).success).toBe(false);
    });
    it('rejects padding, wrong length and the standard base64 alphabet', () => {
      for (const sig of [`${SIG}=`, 'A'.repeat(85), `${'A'.repeat(84)}+A`, `${'A'.repeat(84)}/A`]) {
        expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { sig })).success).toBe(false);
      }
    });
  });

  describe('position snapshot', () => {
    it('accepts lat and lng together', () => {
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { lat: -3.4012871, lng: 38.5601344, accuracy_m: 4.2 })).success).toBe(true);
    });
    it('rejects lat without lng', () => {
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { lat: -3.4 })).success).toBe(false);
    });
    it('rejects out-of-range coordinates', () => {
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { lat: 91, lng: 0 })).success).toBe(false);
      expect(DeviceEventSchema.safeParse(make('custody.door', undefined, { lat: 0, lng: 181 })).success).toBe(false);
    });
  });
});

describe('batch schemas', () => {
  const door = make('custody.door');

  it('accepts a batch of one', () => {
    expect(DeviceEventBatchSchema.safeParse({ v: 1, device_id: DEVICE_ID, events: [door] }).success).toBe(true);
  });

  it('rejects an empty batch and one over the ceiling', () => {
    expect(DeviceEventBatchEnvelopeSchema.safeParse({ v: 1, device_id: DEVICE_ID, events: [] }).success).toBe(false);
    const tooMany = Array.from({ length: DEVICE_EVENT_MAX_BATCH + 1 }, () => door);
    expect(DeviceEventBatchEnvelopeSchema.safeParse({ v: 1, device_id: DEVICE_ID, events: tooMany }).success).toBe(false);
  });

  it('accepts exactly the ceiling', () => {
    const atLimit = Array.from({ length: DEVICE_EVENT_MAX_BATCH }, () => door);
    expect(DeviceEventBatchEnvelopeSchema.safeParse({ v: 1, device_id: DEVICE_ID, events: atLimit }).success).toBe(true);
  });

  it('rejects an unknown schema version', () => {
    expect(DeviceEventBatchEnvelopeSchema.safeParse({ v: 2, device_id: DEVICE_ID, events: [door] }).success).toBe(false);
  });

  it('lets the envelope pass malformed events so the route can answer per event', () => {
    const mixed = { v: 1, device_id: DEVICE_ID, events: [door, { type: 'nonsense' }, 42] };
    expect(DeviceEventBatchEnvelopeSchema.safeParse(mixed).success).toBe(true);
    expect(DeviceEventBatchSchema.safeParse(mixed).success).toBe(false);
  });
});

describe('response schema', () => {
  it('parses accepted, duplicate and rejected results', () => {
    const response = {
      accepted: 1,
      duplicate: 1,
      rejected: 1,
      results: [
        { event_id: 'SC-1:1', status: 'accepted' },
        { event_id: 'SC-1:2', status: 'duplicate' },
        { event_id: 'SC-1:3', status: 'rejected', reason: 'bad_signature' },
      ],
      server_time: '2026-10-11T09:42:18.912Z',
      commands_pending: true,
    };
    expect(DeviceEventBatchResponseSchema.safeParse(response).success).toBe(true);
  });

  it('requires a reason on a rejection and refuses unknown reasons', () => {
    const base = { accepted: 0, duplicate: 0, rejected: 1, server_time: '2026-10-11T09:42:18.912Z', commands_pending: false };
    expect(DeviceEventBatchResponseSchema.safeParse({ ...base, results: [{ event_id: 'a', status: 'rejected' }] }).success).toBe(false);
    expect(DeviceEventBatchResponseSchema.safeParse({ ...base, results: [{ event_id: 'a', status: 'rejected', reason: 'because' }] }).success).toBe(false);
  });
});

describe('deviceEventBand', () => {
  const band = (type: string, data = SAMPLES[type]) =>
    deviceEventBand(DeviceEventSchema.parse(make(type, data)));

  it('sends panic and impact at once', () => {
    expect(band('alert.panic')).toBe(0);
    expect(band('motion.impact')).toBe(0);
  });

  it('treats a cut or removed seal as P0 but an intact one as P1', () => {
    expect(band('custody.seal', { ...SAMPLES['custody.seal'], state: 'cut' })).toBe(0);
    expect(band('custody.seal', { ...SAMPLES['custody.seal'], state: 'removed' })).toBe(0);
    expect(band('custody.seal', { ...SAMPLES['custody.seal'], state: 'intact' })).toBe(1);
    expect(band('custody.seal', { ...SAMPLES['custody.seal'], state: 'armed' })).toBe(1);
  });

  it('treats a tripped tamper switch as P0 but a restored one as P1', () => {
    expect(band('integrity.tamper', { source: 'harness', state: 'tripped' })).toBe(0);
    expect(band('integrity.tamper', { source: 'harness', state: 'ok' })).toBe(1);
  });

  it('batches bulk telemetry as P2', () => {
    expect(band('sensor.reading')).toBe(2);
    expect(band('vehicle.state')).toBe(2);
    expect(band('proximity.summary')).toBe(2);
  });

  it('sends everything else at the next batch', () => {
    for (const type of ['custody.door', 'custody.driver', 'sensor.alarm', 'motion.harsh', 'motion.tilt', 'integrity.gnss', 'integrity.attest', 'power.state']) {
      expect(band(type)).toBe(1);
    }
  });
});

describe('canonicalDataString', () => {
  it('sorts keys by byte value and writes key=value pairs', () => {
    expect(canonicalDataString({ state: 'open', door: 1, moving: true, speed_kph: 62 })).toBe(
      'door=1;moving=1;speed_kph=62;state=open',
    );
  });

  it('writes booleans as 1 and 0', () => {
    expect(canonicalDataString({ a: true, b: false })).toBe('a=1;b=0');
  });

  it('leaves out absent optional fields instead of signing an empty value', () => {
    expect(canonicalDataString({ ignition: true, fuel_pct: undefined })).toBe('ignition=1');
  });

  it('escapes the delimiters so two different objects can never share a string', () => {
    const a = canonicalDataString({ a: 'x;b=2' });
    const b = canonicalDataString({ a: 'x', b: '2' });
    expect(a).toBe('a=x%3Bb%3D2');
    expect(a).not.toBe(b);
    expect(canonicalDataString({ n: '100%' })).toBe('n=100%25');
    expect(canonicalDataString({ n: 'line\nbreak' })).toBe('n=line%0Abreak');
  });

  it('refuses a non-integer number, because decimals travel as strings', () => {
    expect(() => canonicalDataString({ value: 4.2 })).toThrow(/integer/);
  });

  it('does not depend on the order keys were written in', () => {
    expect(canonicalDataString({ b: 1, a: 2 })).toBe(canonicalDataString({ a: 2, b: 1 }));
  });
});

describe('deviceEventSigningString', () => {
  // A fixed vector for the firmware team: the same event must give the same
  // string on the unit and on the server, byte for byte.
  const vector = {
    event_id: 'SC-000123:48211',
    type: 'custody.door' as const,
    occurred_at: '2026-10-11T09:42:17.350Z',
    counter: 48211,
    lat: -3.4012871,
    lng: 38.5601344,
    data: { state: 'open' as const, door: 1, moving: true, speed_kph: 62 },
  };

  it('matches the published test vector', () => {
    expect(deviceEventSigningString(DEVICE_ID, vector, sha256Hex)).toBe(
      'v1|6f1c2d9e-8a41-4b7e-9d33-2c5e0a7b1f64|SC-000123:48211|custody.door|2026-10-11T09:42:17.350Z|48211|-3.4012871|38.5601344|635327b4e53d5757455caf810535cddcb04e9f3d386bfc010bb1eb0bcad55d25',
    );
  });

  it('leaves lat and lng empty when the event has no position', () => {
    const { lat: _lat, lng: _lng, ...noPosition } = vector;
    const signed = deviceEventSigningString(DEVICE_ID, noPosition, sha256Hex);
    expect(signed.split('|').slice(6, 8)).toEqual(['', '']);
  });

  it('writes coordinates with seven decimals', () => {
    const signed = deviceEventSigningString(DEVICE_ID, { ...vector, lat: 1, lng: -2.5 }, sha256Hex);
    expect(signed.split('|').slice(6, 8)).toEqual(['1.0000000', '-2.5000000']);
  });

  it('changes when any signed field changes', () => {
    const base = deviceEventSigningString(DEVICE_ID, vector, sha256Hex);
    const variants = [
      deviceEventSigningString(DEVICE_ID.replace('6f', '7f'), vector, sha256Hex),
      deviceEventSigningString(DEVICE_ID, { ...vector, event_id: 'SC-000123:48212' }, sha256Hex),
      deviceEventSigningString(DEVICE_ID, { ...vector, counter: 48212 }, sha256Hex),
      deviceEventSigningString(DEVICE_ID, { ...vector, occurred_at: '2026-10-11T09:42:17.351Z' }, sha256Hex),
      deviceEventSigningString(DEVICE_ID, { ...vector, lat: -3.4012872 }, sha256Hex),
      deviceEventSigningString(DEVICE_ID, { ...vector, data: { ...vector.data, state: 'closed' as const } }, sha256Hex),
    ];
    for (const v of variants) expect(v).not.toBe(base);
  });
});

describe('subject', () => {
  it('builds the per-org device event subject', () => {
    expect(NATS_SUBJECTS.events_device('org-1')).toBe('events.device.org-1');
  });

  it('is covered by the existing EVENTS stream pattern', () => {
    // events.* . * : a three-token subject, which events.device.<org> is.
    expect(STREAM_CONFIG.EVENTS.subjects).toContain('events.*.*');
    expect(NATS_SUBJECTS.events_device('org-1').split('.')).toHaveLength(3);
  });
});
