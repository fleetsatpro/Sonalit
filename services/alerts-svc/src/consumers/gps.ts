import { StringCodec } from 'nats';
import { getJs } from '../nats.js';
import { query } from '../db.js';
import { randomUUID } from 'node:crypto';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

type GpsFix = {
  device_id: string;
  org_id: string;
  speed_kmh: number;
  lat: number;
  lon: number;
  ts: number;
};

type Rule = {
  id: string;
  org_id: string;
  condition_type: string;
  threshold: number;
  action_type: string;
  name: string;
  geofence_id: string | null;
};

type Geofence = {
  id: string;
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
};

// In-memory dedup for duplicate alert suppression within DEDUP_WINDOW_MS.
// Capped at MAX_DEDUP_ENTRIES to prevent unbounded growth.
const MAX_DEDUP_ENTRIES = 50_000;
const DEDUP_WINDOW_MS = 5 * 60 * 1_000;
const recentAlerts = new Map<string, number>();

function isDuplicate(deviceId: string, ruleId: string): boolean {
  const key = `${deviceId}:${ruleId}`;
  const last = recentAlerts.get(key);
  const now = Date.now();
  if (last && now - last < DEDUP_WINDOW_MS) return true;

  // Evict oldest entry when at capacity.
  if (recentAlerts.size >= MAX_DEDUP_ENTRIES) {
    const oldestKey = recentAlerts.keys().next().value;
    if (oldestKey) recentAlerts.delete(oldestKey);
  }

  recentAlerts.set(key, now);
  return false;
}

function isInsideBoundingBox(lat: number, lon: number, geofence: Geofence): boolean {
  return lat >= geofence.min_lat && lat <= geofence.max_lat &&
         lon >= geofence.min_lon && lon <= geofence.max_lon;
}

async function evaluateRules(fix: GpsFix): Promise<void> {
  const rules = await query<Rule>(
    `SELECT id, org_id, condition_type, threshold, action_type, name, geofence_id
     FROM rules WHERE org_id = $1 AND enabled = true`,
    [fix.org_id],
  );

  for (const rule of rules) {
    if (isDuplicate(fix.device_id, rule.id)) continue;

    let triggered = false;

    if (rule.condition_type === 'speed' && fix.speed_kmh > rule.threshold) {
      triggered = true;
    } else if (rule.condition_type === 'geofence_exit' && rule.geofence_id) {
      const geofences = await query<Geofence>(
        `SELECT id, min_lat, max_lat, min_lon, max_lon
         FROM geofences WHERE id = $1 AND deleted_at IS NULL`,
        [rule.geofence_id],
      );
      const geofence = geofences[0];
      if (geofence && !isInsideBoundingBox(fix.lat, fix.lon, geofence)) {
        triggered = true;
      }
    } else if (rule.condition_type === 'geofence_enter' && rule.geofence_id) {
      const geofences = await query<Geofence>(
        `SELECT id, min_lat, max_lat, min_lon, max_lon
         FROM geofences WHERE id = $1 AND deleted_at IS NULL`,
        [rule.geofence_id],
      );
      const geofence = geofences[0];
      if (geofence && isInsideBoundingBox(fix.lat, fix.lon, geofence)) {
        triggered = true;
      }
    }

    if (!triggered) continue;

    await query(
      `INSERT INTO alerts (id, org_id, type, severity, title, description, device_id, status, created_at)
       VALUES ($1, $2, 'rule_violation', 'medium', $3, $4, $5, 'open', NOW())
       ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        fix.org_id,
        `Rule triggered: ${rule.name}`,
        `Device ${fix.device_id}: ${rule.condition_type} threshold exceeded`,
        fix.device_id,
      ],
    );
  }
}

export async function startGpsConsumer(): Promise<void> {
  const js = getJs();
  const sc = StringCodec();
  const consumer = await js.consumers.get('TELEMETRY', 'alerts-gps');
  const messages = await consumer.consume();
  log.info('alerts-svc GPS consumer started');
  for await (const msg of messages) {
    try {
      const fix = JSON.parse(sc.decode(msg.data)) as GpsFix;
      await evaluateRules(fix);
      msg.ack();
    } catch (err) {
      log.error({ err }, 'GPS consumer error');
      msg.nak();
    }
  }
}
