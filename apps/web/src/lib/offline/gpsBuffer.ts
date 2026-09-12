/**
 * GPS buffering and adaptive sampling.
 *
 * Two problems, one module.
 *
 * **Buffering.** Position collection must not depend on the network. Fixes land
 * in IndexedDB first and are uploaded in batches; a thirty-minute dead zone at a
 * fix every five seconds is 360 points, which is one request here and 360 TLS
 * handshakes on the naive path. The device-observed timestamp is carried
 * through untouched, so the track reconstructs as it actually happened rather
 * than collapsing onto the moment signal returned.
 *
 * **Adaptive sampling.** Maximum frequency is not the goal — a phone that dies
 * at 14:00 tracks nothing at all after 14:00. The interval responds to what is
 * actually happening: a stationary truck needs a fix a minute, a moving one at
 * speed needs one every few seconds, and a device below a battery floor backs
 * off regardless. Connectivity does *not* shrink the sampling rate: being
 * offline is precisely when the track matters, and storage is cheap. It only
 * changes how often we try to upload.
 */

import { db } from './db.js';
import { isEnabled } from './flags.js';
import { recordOperation } from './outbox.js';

import type { BufferedFix } from './types.js';

/** Sampling intervals in ms, by movement state. */
export const SAMPLE_INTERVAL = {
  /** Not moving. A parked vehicle still needs proof of where it is parked. */
  STATIONARY: 60_000,
  /** Moving slowly — yard manoeuvring, traffic. */
  SLOW: 15_000,
  /** At road speed, where a coarse track loses corners and stops. */
  FAST: 5_000,
  /** Battery below the floor: keep tracking, but cheaply. */
  LOW_BATTERY: 120_000,
} as const;

/** Below this speed (m/s ≈ 3.6 km/h) the vehicle is treated as stationary. */
const STATIONARY_SPEED = 1;
/** Above this (m/s ≈ 36 km/h) it is at road speed. */
const FAST_SPEED = 10;
/** Below this battery fraction, sampling backs right off. */
const LOW_BATTERY_LEVEL = 0.15;

export interface SamplingInputs {
  /** Metres per second from the last fix, or null when unknown. */
  speed: number | null;
  /** 0..1, or null when the browser will not say. */
  batteryLevel: number | null;
  /** Is the device plugged in? Charging cancels the battery penalty. */
  charging: boolean;
  /** True while the vehicle is on an active convoy or trip. */
  operationallyActive: boolean;
}

/**
 * Choose a sampling interval.
 *
 * Pure, so the policy that decides whether a driver's phone survives a shift is
 * testable without a device.
 */
export function chooseInterval(i: SamplingInputs): number {
  if (i.batteryLevel != null && i.batteryLevel < LOW_BATTERY_LEVEL && !i.charging) {
    return SAMPLE_INTERVAL.LOW_BATTERY;
  }
  // An idle vehicle outside any active operation does not need a minute-by-minute
  // record; this is the difference between a day of tracking and a dead phone.
  if (!i.operationallyActive) return SAMPLE_INTERVAL.STATIONARY;

  if (i.speed == null) return SAMPLE_INTERVAL.SLOW;
  if (i.speed < STATIONARY_SPEED) return SAMPLE_INTERVAL.STATIONARY;
  if (i.speed < FAST_SPEED) return SAMPLE_INTERVAL.SLOW;
  return SAMPLE_INTERVAL.FAST;
}

/** Points per upload batch. Sized to stay well inside the server's 1000 cap. */
export const BATCH_SIZE = 500;

/**
 * Hard cap on buffered fixes.
 *
 * When it is hit, the *oldest* points are dropped. That is the right end to
 * discard from: recent positions are what matter operationally, and a device
 * that has been offline for two days has already lost the ability to reconstruct
 * a useful continuous track. Nothing else in the offline layer discards data on
 * overflow — this is the one place, because telemetry is genuinely lower value
 * than an operational event and the alternative is filling the quota that the
 * event queue also lives in.
 */
export const MAX_BUFFERED = 20_000;

const SEQ_KEY = 'gps:sequence';

async function nextSequence(): Promise<number> {
  const row = await db.sync_meta.get(SEQ_KEY);
  const next = (typeof row?.value === 'number' ? row.value : 0) + 1;
  await db.sync_meta.put({ key: SEQ_KEY, value: next });
  return next;
}

function fixId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `fix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RecordFixInput {
  vehicleId: string;
  tripId?: string | null;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  /** Device-observed instant. Defaults to now, never to server time. */
  deviceTime?: string;
  ownerUserId: string;
  ownerOrgId: string;
}

/** Buffer one fix. Never touches the network. */
export async function recordFix(input: RecordFixInput): Promise<BufferedFix | null> {
  if (!isEnabled('OFFLINE_GPS')) return null;
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return null;

  const fix: BufferedFix = {
    id: fixId(),
    vehicleId: input.vehicleId,
    tripId: input.tripId ?? null,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy ?? null,
    speed: input.speed ?? null,
    heading: input.heading ?? null,
    altitude: input.altitude ?? null,
    deviceTime: input.deviceTime ?? new Date().toISOString(),
    sequence: 0,
    ownerUserId: input.ownerUserId,
    ownerOrgId: input.ownerOrgId,
  };

  await db.transaction('rw', db.gps_buffer, db.sync_meta, async () => {
    fix.sequence = await nextSequence();
    await db.gps_buffer.add(fix);

    const total = await db.gps_buffer.count();
    if (total > MAX_BUFFERED) {
      const excess = total - MAX_BUFFERED;
      const oldest = await db.gps_buffer.orderBy('sequence').limit(excess).primaryKeys();
      await db.gps_buffer.bulkDelete(oldest);
    }
  });

  return fix;
}

export async function bufferedCount(userId: string): Promise<number> {
  return db.gps_buffer.where('ownerUserId').equals(userId).count();
}

/**
 * Move buffered fixes into the outbox as batch operations.
 *
 * The handoff is what keeps telemetry from competing with operational events:
 * once a batch is an outbox entry it sits at TELEMETRY priority and drains
 * behind anything critical, automatically.
 *
 * Fixes are removed from the buffer only after the outbox entry exists, in the
 * same transaction, so a crash mid-handoff cannot lose them.
 */
export async function flushToOutbox(
  userId: string,
  orgId: string,
  batchSize: number = BATCH_SIZE,
): Promise<number> {
  if (!isEnabled('OFFLINE_GPS')) return 0;

  const pending = await db.gps_buffer
    .where('ownerUserId').equals(userId)
    .sortBy('sequence');
  if (pending.length === 0) return 0;

  // One outbox entry per vehicle: the server's batch handler takes a single
  // vehicle_id, and mixing vehicles would make a partial failure ambiguous.
  const byVehicle = new Map<string, BufferedFix[]>();
  for (const f of pending) {
    const list = byVehicle.get(f.vehicleId) ?? [];
    if (list.length < batchSize) {
      list.push(f);
      byVehicle.set(f.vehicleId, list);
    }
  }

  let batches = 0;
  for (const [vehicleId, fixes] of byVehicle) {
    if (fixes.length === 0) continue;
    const ids = fixes.map(f => f.id);
    const tripId = fixes[0]?.tripId ?? null;

    await recordOperation(
      {
        type: 'gps.batch',
        entityId: vehicleId,
        label: `${fixes.length} GPS ${fixes.length === 1 ? 'fix' : 'fixes'}`,
        payload: {
          vehicle_id: vehicleId,
          trip_id: tripId,
          points: fixes.map(f => ({
            lat: f.lat,
            lng: f.lng,
            speed: f.speed,
            heading: f.heading,
            altitude: f.altitude,
            device_time: f.deviceTime,
          })),
        },
        ownerUserId: userId,
        ownerOrgId: orgId,
      },
      async () => { await db.gps_buffer.bulkDelete(ids); },
    );
    batches++;
  }

  return batches;
}

/** Clear a user's buffered telemetry. Used by the logout purge. */
export async function clearBuffer(userId: string): Promise<number> {
  return db.gps_buffer.where('ownerUserId').equals(userId).delete();
}
