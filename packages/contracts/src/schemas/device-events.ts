import { z } from 'zod';

import { UuidSchema, IsoDateTimeSchema } from './common.js';
import { PanicTriggerTypeSchema } from './guardian.js';

// ---------------------------------------------------------------------------
// Sentinel device events
//
// Everything a hardware unit reports that is not a position: custody, sensor,
// motion, integrity, power, vehicle and proximity. Positions stay on the
// positions endpoint. Each event is signed by the unit's secure element, so the
// shapes here are strict on purpose: the signature covers a canonical string
// built from these exact fields, and an unknown extra field would be one the
// signature does not protect.
//
// Wire rules the firmware must follow (mirrored by deviceEventSigningString):
//   - `data` is a flat object of strings, integers and booleans.
//   - Decimals are strings with a fixed number of places per field, never JS or
//     C floats, so both sides produce identical bytes.
//   - `counter` is a JS-safe integer (below 2^53) on the wire.
// ---------------------------------------------------------------------------

export const DEVICE_EVENT_SCHEMA_VERSION = 1 as const;
export const DEVICE_EVENT_MAX_BATCH = 500;

// ---------------------------------------------------------------------------
// Envelope enums
// ---------------------------------------------------------------------------

export const DeviceEventTypeSchema = z.enum([
  'alert.panic',
  'custody.door',
  'custody.seal',
  'custody.driver',
  'sensor.reading',
  'sensor.alarm',
  'motion.impact',
  'motion.harsh',
  'motion.tilt',
  'integrity.gnss',
  'integrity.tamper',
  'integrity.attest',
  'power.state',
  'vehicle.state',
  'proximity.summary',
]);
export type DeviceEventType = z.infer<typeof DeviceEventTypeSchema>;

/** Only `gnss` is trusted for ordering; `network` and `rtc` are recorded as-is. */
export const DeviceEventTimeSourceSchema = z.enum(['gnss', 'network', 'rtc']);
export type DeviceEventTimeSource = z.infer<typeof DeviceEventTimeSourceSchema>;

/** How the event left the unit. */
export const DeviceEventUplinkSchema = z.enum(['direct', 'ble_relay', 'lora_hop', 'satellite']);
export type DeviceEventUplink = z.infer<typeof DeviceEventUplinkSchema>;

/** 0 = P0 (send at once, any uplink), 1 = P1 (next batch), 2 = P2 telemetry. */
export const DeviceEventBandSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type DeviceEventBand = z.infer<typeof DeviceEventBandSchema>;

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** A decimal as a string with exactly `places` digits after the point. */
const decimal = (places: number) =>
  z
    .string()
    .regex(
      new RegExp(`^-?\\d{1,9}\\.\\d{${places}}$`),
      `Must be a decimal string with exactly ${places} place${places === 1 ? '' : 's'}`,
    );

const nonNegInt = z.number().int().nonnegative();
const percent = z.number().int().min(0).max(100);

/**
 * Base64url, no padding, for exactly 64 bytes. 64 bytes encode to 85 full
 * characters plus one carrying two bits, so the last character can only be one
 * of four values. Rejecting the others keeps the encoding canonical: a
 * signature has exactly one valid text form and cannot be re-spelled.
 */
const SignatureSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{85}[AQgw]$/, 'Must be a 64-byte signature in unpadded base64url');

// ---------------------------------------------------------------------------
// Per-type `data` payloads
// ---------------------------------------------------------------------------

const SensorMetricSchema = z.enum(['temperature_c', 'humidity_pct', 'shock_g']);

export const AlertPanicDataSchema = z
  .object({
    trigger: PanicTriggerTypeSchema,
    note: z.string().max(512).optional(),
  })
  .strict();

export const CustodyDoorDataSchema = z
  .object({
    state: z.enum(['open', 'closed']),
    door: nonNegInt,
    moving: z.boolean(),
    speed_kph: nonNegInt,
  })
  .strict();

export const CustodySealDataSchema = z
  .object({
    state: z.enum(['armed', 'intact', 'cut', 'removed']),
    seal_number: z.string().min(1).max(50),
    rfid_code: z.string().min(1).max(64).optional(),
    seal_position: z.number().int().min(1).optional(),
  })
  .strict();

export const CustodyDriverDataSchema = z
  .object({
    badge_id: z.string().min(1).max(64),
    state: z.enum(['in', 'out']),
  })
  .strict();

export const SensorReadingDataSchema = z
  .object({
    metric: SensorMetricSchema,
    value: decimal(2),
    probe: nonNegInt,
  })
  .strict();

export const SensorAlarmDataSchema = z
  .object({
    metric: SensorMetricSchema,
    value: decimal(2),
    limit: decimal(2),
    direction: z.enum(['above', 'below']),
  })
  .strict();

export const MotionImpactDataSchema = z
  .object({
    peak_g: decimal(2),
    duration_ms: nonNegInt,
    class: z.enum(['crash', 'blast_like', 'drop', 'unknown']),
    trace_id: z.string().min(1).max(64).optional(),
  })
  .strict();

export const MotionHarshDataSchema = z
  .object({
    kind: z.enum(['brake', 'accel', 'corner']),
    peak_g: decimal(2),
    duration_ms: nonNegInt,
  })
  .strict();

export const MotionTiltDataSchema = z
  .object({
    kind: z.enum(['rollover', 'tow_start', 'tow_end']),
    roll_deg: decimal(1),
    pitch_deg: decimal(1),
  })
  .strict();

export const IntegrityGnssDataSchema = z
  .object({
    jamming: z.enum(['none', 'warning', 'critical']),
    spoofing: z.enum(['none', 'suspected', 'detected']),
    osnma: z.enum(['ok', 'fail', 'na']),
  })
  .strict();

export const IntegrityTamperDataSchema = z
  .object({
    source: z.enum(['enclosure', 'harness', 'antenna', 'sim']),
    state: z.enum(['ok', 'tripped']),
  })
  .strict();

export const IntegrityAttestDataSchema = z
  .object({
    fw_version: z.string().min(1).max(32),
    fw_hash: z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character lowercase hex SHA-256'),
    boot_state: z.enum(['verified', 'unverified']),
  })
  .strict();

export const PowerStateDataSchema = z
  .object({
    source: z.enum(['vehicle', 'battery']),
    vin_mv: nonNegInt,
    batt_pct: percent,
    charging: z.boolean(),
  })
  .strict();

/** CAN fields are optional: a unit with no bus connection still reports ignition. */
export const VehicleStateDataSchema = z
  .object({
    ignition: z.boolean(),
    can_speed_kph: nonNegInt.optional(),
    odometer_km: nonNegInt.optional(),
    engine_h: decimal(1).optional(),
    fuel_pct: percent.optional(),
    dtc_count: nonNegInt.optional(),
  })
  .strict();

export const ProximitySummaryDataSchema = z
  .object({
    peer_count: nonNegInt,
    nearest_serial: z.string().min(1).max(32).optional(),
    nearest_rssi_dbm: z.number().int().min(-200).max(0).optional(),
    nearest_age_s: nonNegInt.optional(),
    cfo_phone: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Envelope + discriminated union
// ---------------------------------------------------------------------------

const EnvelopeFields = {
  /**
   * `<serial>:<counter>`. The idempotency key. The character set excludes `|`,
   * the delimiter of the signing string, so an id can never forge a field boundary.
   */
  event_id: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/, 'Must be 1-64 characters of A-Z a-z 0-9 . _ : -'),
  /** Strictly increasing per device, across every event type. */
  counter: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  occurred_at: IsoDateTimeSchema,
  time_source: DeviceEventTimeSourceSchema,
  uplink: DeviceEventUplinkSchema,
  buffered: z.boolean(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy_m: z.number().nonnegative().optional(),
  kid: z.string().min(1).max(32),
  sig: SignatureSchema,
};

const event = <T extends DeviceEventType, D extends z.ZodTypeAny>(type: T, data: D) =>
  z.object({ ...EnvelopeFields, type: z.literal(type), data }).strict();

export const DeviceEventSchema = z
  .discriminatedUnion('type', [
    event('alert.panic', AlertPanicDataSchema),
    event('custody.door', CustodyDoorDataSchema),
    event('custody.seal', CustodySealDataSchema),
    event('custody.driver', CustodyDriverDataSchema),
    event('sensor.reading', SensorReadingDataSchema),
    event('sensor.alarm', SensorAlarmDataSchema),
    event('motion.impact', MotionImpactDataSchema),
    event('motion.harsh', MotionHarshDataSchema),
    event('motion.tilt', MotionTiltDataSchema),
    event('integrity.gnss', IntegrityGnssDataSchema),
    event('integrity.tamper', IntegrityTamperDataSchema),
    event('integrity.attest', IntegrityAttestDataSchema),
    event('power.state', PowerStateDataSchema),
    event('vehicle.state', VehicleStateDataSchema),
    event('proximity.summary', ProximitySummaryDataSchema),
  ])
  .refine((e) => (e.lat === undefined) === (e.lng === undefined), {
    message: 'lat and lng must be given together',
    path: ['lat'],
  });
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

/**
 * First-pass batch shape. Events stay `unknown` here so the ingest route can
 * validate them one at a time and answer per event: on a bad link a partial
 * success is normal, and one malformed event must not sink the other 499.
 */
export const DeviceEventBatchEnvelopeSchema = z.object({
  v: z.literal(DEVICE_EVENT_SCHEMA_VERSION),
  device_id: UuidSchema,
  events: z
    .array(z.unknown())
    .min(1, 'Batch must contain at least 1 event')
    .max(DEVICE_EVENT_MAX_BATCH, `Batch must not exceed ${DEVICE_EVENT_MAX_BATCH} events`),
});
export type DeviceEventBatchEnvelope = z.infer<typeof DeviceEventBatchEnvelopeSchema>;

/** Fully validated batch, for callers (tests, the device simulator) that want all-or-nothing. */
export const DeviceEventBatchSchema = DeviceEventBatchEnvelopeSchema.extend({
  events: z.array(DeviceEventSchema).min(1).max(DEVICE_EVENT_MAX_BATCH),
});
export type DeviceEventBatch = z.infer<typeof DeviceEventBatchSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const DeviceEventRejectReasonSchema = z.enum([
  'bad_signature',
  'unknown_kid',
  'revoked_kid',
  'device_mismatch',
  'counter_conflict',
  'time_future',
  'schema',
]);
export type DeviceEventRejectReason = z.infer<typeof DeviceEventRejectReasonSchema>;

export const DeviceEventResultSchema = z.discriminatedUnion('status', [
  z.object({ event_id: z.string(), status: z.literal('accepted') }),
  z.object({ event_id: z.string(), status: z.literal('duplicate') }),
  z.object({
    event_id: z.string(),
    status: z.literal('rejected'),
    reason: DeviceEventRejectReasonSchema,
  }),
]);
export type DeviceEventResult = z.infer<typeof DeviceEventResultSchema>;

export const DeviceEventBatchResponseSchema = z.object({
  accepted: nonNegInt,
  duplicate: nonNegInt,
  rejected: nonNegInt,
  results: z.array(DeviceEventResultSchema),
  server_time: IsoDateTimeSchema,
  /** True when the unit should fetch its commands now rather than at the next heartbeat. */
  commands_pending: z.boolean(),
});
export type DeviceEventBatchResponse = z.infer<typeof DeviceEventBatchResponseSchema>;

/** Published on `events.device.<org>` once an event is stored. */
export const DeviceEventIngestedSchema = z.object({
  device_event_id: UuidSchema,
  org_id: UuidSchema,
  device_id: UuidSchema,
  event_id: z.string().min(1).max(64),
  type: DeviceEventTypeSchema,
  band: DeviceEventBandSchema,
  occurred_at: IsoDateTimeSchema,
  trust: z.enum(['trusted', 'untrusted']),
});
export type DeviceEventIngested = z.infer<typeof DeviceEventIngestedSchema>;

// ---------------------------------------------------------------------------
// Priority band
// ---------------------------------------------------------------------------

/**
 * P0 goes out at once on any uplink, satellite included. P2 is the bulk
 * telemetry that may wait for a good link. Everything else is P1.
 */
export function deviceEventBand(event: Pick<DeviceEvent, 'type' | 'data'>): DeviceEventBand {
  switch (event.type) {
    case 'alert.panic':
    case 'motion.impact':
      return 0;
    case 'custody.seal': {
      const state = (event.data as z.infer<typeof CustodySealDataSchema>).state;
      return state === 'cut' || state === 'removed' ? 0 : 1;
    }
    case 'integrity.tamper':
      return (event.data as z.infer<typeof IntegrityTamperDataSchema>).state === 'tripped' ? 0 : 1;
    case 'sensor.reading':
    case 'vehicle.state':
    case 'proximity.summary':
      return 2;
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Signing string
//
// What the secure element signs, so server and firmware agree to the byte:
//
//   v1|<device_id>|<event_id>|<type>|<occurred_at>|<counter>|<lat>|<lng>|<data_hash>
//
// `lat` and `lng` are written with seven decimals, or left empty when absent.
// `data_hash` is the lowercase-hex SHA-256 of canonicalDataString(data). The
// pipe-joined form is deliberate: it is the same style as canonical() in the
// incident timeline seal, so one habit covers both.
//
// This package carries no crypto dependency, so the caller passes the hash.
// ---------------------------------------------------------------------------

export type DeviceEventDataValue = string | number | boolean;

/** Percent-escape the three characters that structure the canonical string, plus control characters. */
function escapeDataString(value: string): string {
  return value.replace(/[%;=\u0000-\u001f\u007f]/g, (c) => {
    return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  });
}

function formatDataValue(key: string, value: DeviceEventDataValue): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`data.${key} must be an integer; send decimals as fixed-place strings`);
    }
    return String(value);
  }
  return escapeDataString(value);
}

/**
 * Keys sorted by byte value, written `key=value`, joined by `;`. Booleans are
 * `1` or `0`, integers are plain decimal, strings are percent-escaped. Fields
 * that are absent are simply not listed, so an optional field the unit leaves
 * out is not signed as an empty value.
 */
export function canonicalDataString(data: Record<string, DeviceEventDataValue | undefined>): string {
  return Object.keys(data)
    .filter((k) => data[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((k) => `${k}=${formatDataValue(k, data[k] as DeviceEventDataValue)}`)
    .join(';');
}

function formatCoordinate(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(7);
}

export function deviceEventSigningString(
  deviceId: string,
  event: Pick<DeviceEvent, 'event_id' | 'type' | 'occurred_at' | 'counter' | 'lat' | 'lng' | 'data'>,
  sha256Hex: (input: string) => string,
): string {
  const dataHash = sha256Hex(
    canonicalDataString(event.data as Record<string, DeviceEventDataValue | undefined>),
  );
  return [
    `v${DEVICE_EVENT_SCHEMA_VERSION}`,
    deviceId,
    event.event_id,
    event.type,
    event.occurred_at,
    String(event.counter),
    formatCoordinate(event.lat),
    formatCoordinate(event.lng),
    dataHash,
  ].join('|');
}
