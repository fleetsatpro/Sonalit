import { StringCodec } from 'nats';
import { getJs } from '../nats.js';
import { query } from '../db.js';
import { randomUUID } from 'node:crypto';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

type GpsFix = { device_id: string; org_id: string; speed_kmh: number; lat: number; lon: number; ts: number };
type Rule = { id: string; org_id: string; condition_type: string; threshold: number; action_type: string; name: string };

// Dedup: key = `${device_id}:${rule_id}`, value = last alert timestamp (ms)
const recentAlerts = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1_000;

function isDuplicate(deviceId: string, ruleId: string): boolean {
  const key = `${deviceId}:${ruleId}`;
  const last = recentAlerts.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) return true;
  recentAlerts.set(key, Date.now());
  return false;
}

async function evaluateRules(fix: GpsFix): Promise<void> {
  const { rows: rules } = await query<Rule>(
    `SELECT id, org_id, condition_type, threshold, action_type, name
     FROM rules WHERE org_id = $1 AND enabled = true`,
    [fix.org_id],
  );
  for (const rule of rules) {
    let triggered = false;
    if (rule.condition_type === 'speed' && fix.speed_kmh > rule.threshold) triggered = true;
    if (!triggered || isDuplicate(fix.device_id, rule.id)) continue;
    await query(
      `INSERT INTO alerts (id, org_id, type, severity, title, description, status)
       VALUES ($1, $2, 'rule_violation', 'medium', $3, $4, 'open')`,
      [randomUUID(), fix.org_id, `Rule triggered: ${rule.name}`, `Device ${fix.device_id} speed ${fix.speed_kmh} km/h (threshold ${rule.threshold})`],
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
