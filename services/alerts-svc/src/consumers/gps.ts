import { StringCodec } from 'nats';
import { getJs } from '../nats.js';
import { query } from '../db.js';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { evaluateRule, renderTemplate, type RuleAction, type RuleInput } from '../rules/engine.js';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

type GpsFix = {
  device_id: string;
  org_id: string;
  speed_kmh: number;
  lat: number;
  lon: number;
  ts: number;
};

type RuleRow = Record<string, unknown> & {
  id: string;
  org_id: string;
  name: string;
  version: number;
  priority: number;
  severity: 'low'|'medium'|'high'|'critical';
  mode: 'live'|'dry_run';
  enabled: boolean;
  status: string;
  condition_type?: string;
  threshold?: number | null;
  action_type?: string;
  geofence_id?: string | null;
  cooldown_seconds?: number;
  conditions?: unknown;
  actions?: unknown;
  condition_logic?: 'all'|'any';
};

type Geofence = {
  id: string;
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
};

function isInsideBoundingBox(lat: number, lon: number, geofence: Geofence): boolean {
  return lat >= geofence.min_lat && lat <= geofence.max_lat &&
    lon >= geofence.min_lon && lon <= geofence.max_lon;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toRuleInput(row: RuleRow): RuleInput {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    version: Number(row.version ?? 1),
    priority: Number(row.priority ?? 50),
    severity: row.severity ?? 'medium',
    mode: row.mode ?? 'live',
    conditions: asArray(row.conditions),
    condition_logic: row.condition_logic ?? 'all',
    actions: asArray(row.actions),
  };
}

function legacyMatch(row: RuleRow, fix: GpsFix, insideByGeofence: boolean | undefined): boolean {
  if (row.condition_type === 'speed') return fix.speed_kmh > Number(row.threshold ?? Infinity);
  if (row.condition_type === 'geofence_exit') return insideByGeofence === false;
  if (row.condition_type === 'geofence_enter') return insideByGeofence === true;
  if (row.condition_type === 'idle') return fix.speed_kmh <= Number(row.threshold ?? 0);
  return false;
}

async function emitNotification(orgId: string, rule: RuleRow, action: RuleAction, fix: GpsFix, executionId: string): Promise<Record<string, unknown>> {
  if (!action.recipient || !action.channel) {
    return { type: action.type, status: 'failed', error: 'notify action requires channel and recipient' };
  }

  const id = randomUUID();
  const body = renderTemplate(
    action.template ?? 'Rule {rule.name} triggered for vehicle {device_id} at {lat},{lon}.',
    {
      type: 'rule.triggered',
      data: { ...fix, rule: { name: rule.name, id: rule.id }, event: { id: executionId } },
    },
  );

  const envelope = {
    id,
    channel: action.channel,
    recipient: action.recipient,
    title: `SONALIT RULE — ${rule.name}`,
    body,
    data: {
      rule_id: rule.id,
      execution_id: executionId,
      device_id: fix.device_id,
      severity: action.severity ?? rule.severity,
    },
    priority: (action.severity === 'critical' || rule.severity === 'critical') ? 'high' : 'normal',
    ttl_ms: 300000,
    idempotency_key: `rule:${rule.id}:exec:${executionId}:action:${action.channel}:${action.recipient}`,
    created_at: new Date().toISOString(),
  };

  const sc = StringCodec();
  getJs().publish(`notifications.${action.channel}`, sc.encode(JSON.stringify(envelope)));

  await query(
    `INSERT INTO rule_action_deliveries
      (execution_id,rule_id,org_id,action_index,action_type,status,idempotency_key,attempt_count,last_attempt_at,delivered_at,response)
     VALUES ($1,$2,$3,$4,'notify','succeeded',$5,1,NOW(),NOW(),$6::jsonb)`,
    [executionId, rule.id, orgId, 0, envelope.idempotency_key, JSON.stringify({ channel: action.channel, recipient: action.recipient })],
  );

  return { type: action.type, status: 'succeeded', channel: action.channel, recipient: action.recipient };
}

async function executeActions(rule: RuleRow, fix: GpsFix, executionId: string, actions: RuleAction[]): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const sc = StringCodec();

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const idempotencyKey = `rule:${rule.id}:exec:${executionId}:action:${index}`;

    try {
      if (rule.mode === 'dry_run') {
        results.push({ type: action.type, status: 'dry_run' });
        continue;
      }

      if (action.type === 'notify') {
        results.push(await emitNotification(rule.org_id, rule, action, fix, executionId));
        continue;
      }

      if (action.type === 'alert' || action.type === 'escalate') {
        const severity = action.severity ?? rule.severity;
        const [alert] = await query(
          `INSERT INTO alerts
             (id,org_id,type,severity,title,description,device_id,status,rule_id,metadata,created_at,updated_at)
           VALUES ($1,$2,'rule_violation',$3,$4,$5,$6,'open',$7,$8::jsonb,NOW(),NOW())
           RETURNING id`,
          [
            randomUUID(), rule.org_id, severity,
            `Rule triggered: ${rule.name}`,
            `Device ${fix.device_id} matched rule ${rule.name} v${rule.version}`,
            fix.device_id, rule.id,
            JSON.stringify({ rule_id: rule.id, rule_version: rule.version, execution_id: executionId, latitude: fix.lat, longitude: fix.lon }),
          ],
        );
        results.push({ type: action.type, status: 'succeeded', alert_id: alert.id });
        continue;
      }

      if (action.type === 'create_incident') {
        const [incident] = await query(
          `INSERT INTO incidents (id,org_id,title,description,severity,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'open',NOW(),NOW()) RETURNING id`,
          [
            randomUUID(), rule.org_id, `Rule incident: ${rule.name}`,
            `Rule ${rule.name} v${rule.version} triggered by device ${fix.device_id}.`,
            action.severity ?? rule.severity,
          ],
        );
        results.push({ type: action.type, status: 'succeeded', incident_id: incident.id });
        continue;
      }

      if (action.type === 'webhook') {
        await query(
          `INSERT INTO rule_action_deliveries
             (execution_id,rule_id,org_id,action_index,action_type,status,idempotency_key,response,last_error)
           VALUES ($1,$2,$3,$4,'webhook','failed',$5,'{}'::jsonb,'Webhook execution is isolated to a dedicated dispatcher')`,
          [executionId, rule.id, rule.org_id, index, idempotencyKey],
        );
        results.push({ type: action.type, status: 'queued', dispatcher: 'rule-action-worker' });
        continue;
      }

      const [delivery] = await query(
        `INSERT INTO rule_action_deliveries
           (execution_id,rule_id,org_id,action_index,action_type,status,idempotency_key,attempt_count,last_attempt_at,response)
         VALUES ($1,$2,$3,$4,$5,'succeeded',$6,1,NOW(),$7::jsonb) RETURNING id`,
        [executionId, rule.id, rule.org_id, index, action.type, idempotencyKey, JSON.stringify({})],
      );
      getJs().publish(`events.alert.${rule.org_id}`, sc.encode(JSON.stringify({
        id: randomUUID(), org_id: rule.org_id, type: 'rule_action', severity: rule.severity,
        title: `Rule action: ${rule.name}`, description: action.type,
        metadata: { rule_id: rule.id, execution_id: executionId, delivery_id: delivery.id },
      })));
      results.push({ type: action.type, status: 'succeeded' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ type: action.type, status: 'failed', error: message });
      log.error({ err: error, ruleId: rule.id, actionIndex: index }, 'Rule action failed');
    }
  }

  return results;
}

async function evaluateRules(fix: GpsFix): Promise<void> {
  const rules = await query<RuleRow>(
    `SELECT * FROM rules
     WHERE org_id=$1 AND enabled=true AND deleted_at IS NULL
       AND COALESCE(status,'active')='active'
     ORDER BY priority DESC, created_at ASC`,
    [fix.org_id],
  );

  const baseData: Record<string, unknown> = {
    ...fix,
    location: { lat: fix.lat, lon: fix.lon },
  };

  for (const rule of rules) {
    let data = baseData;
    let legacyInside: boolean | undefined;

    if ((rule.condition_type === 'geofence_enter' || rule.condition_type === 'geofence_exit') && rule.geofence_id) {
      const [geofence] = await query<Geofence>(
        `SELECT id,min_lat,max_lat,min_lon,max_lon FROM geofences WHERE id=$1 AND deleted_at IS NULL`,
        [rule.geofence_id],
      );
      legacyInside = geofence ? isInsideBoundingBox(fix.lat, fix.lon, geofence) : undefined;
      data = { ...baseData, geofence: { id: rule.geofence_id, inside: legacyInside } };
    }

    let matched = false;
    let traces: unknown[] = [];

    if (asArray(rule.conditions).length) {
      const result = evaluateRule(
        { ...toRuleInput(rule), actions: asArray<RuleAction>(rule.actions) },
        { id: `gps:${fix.ts}:${fix.device_id}`, type: 'telemetry.gps', source: 'guardian', subject_type: 'device', subject_id: fix.device_id, data },
      );
      matched = result.matched;
      traces = result.traces;
    } else {
      matched = legacyMatch(rule, fix, legacyInside);
      traces = [{
        field: rule.condition_type ?? 'unknown',
        operator: 'legacy',
        expected: rule.threshold,
        actual: rule.condition_type === 'speed' ? fix.speed_kmh : legacyInside,
        matched,
      }];
    }

    if (!matched) continue;

    const cooldown = Math.max(0, Number(rule.cooldown_seconds ?? 900));
    const [recent] = await query<{ id: string }>(
      `SELECT id FROM rule_executions
       WHERE rule_id=$1 AND org_id=$2 AND subject_id=$3 AND matched=true AND suppressed=false
         AND evaluated_at > NOW() - make_interval(secs => $4)
       ORDER BY evaluated_at DESC LIMIT 1`,
      [rule.id, rule.org_id, fix.device_id, cooldown],
    );

    const executionId = randomUUID();
    if (recent) {
      await query(
        `INSERT INTO rule_executions
          (id,rule_id,rule_version,org_id,correlation_id,subject_type,subject_id,event_type,event_id,mode,matched,suppressed,suppression_reason,condition_trace,input_snapshot)
         VALUES ($1,$2,$3,$4,$5,'device',$6,'telemetry.gps',$7,$8,true,true,'cooldown',$9::jsonb,$10::jsonb)`,
        [executionId, rule.id, rule.version, rule.org_id, `gps:${fix.ts}:${fix.device_id}`, fix.device_id, `gps:${fix.ts}`, rule.mode ?? 'live', JSON.stringify(traces), JSON.stringify(data)],
      );
      continue;
    }

    const started = Date.now();
    const actionResults = await executeActions(rule, fix, executionId, asArray<RuleAction>(rule.actions).length ? asArray<RuleAction>(rule.actions) : [{ type: rule.action_type === 'notify' ? 'notify' : 'alert' }]);

    await query(
      `INSERT INTO rule_executions
       (id,rule_id,rule_version,org_id,correlation_id,subject_type,subject_id,event_type,event_id,mode,matched,suppressed,decision_ms,condition_trace,input_snapshot,action_results)
       VALUES ($1,$2,$3,$4,$5,'device',$6,'telemetry.gps',$7,$8,true,false,$9,$10::jsonb,$11::jsonb,$12::jsonb)`,
      [
        executionId, rule.id, rule.version, rule.org_id, `gps:${fix.ts}:${fix.device_id}`,
        fix.device_id, `gps:${fix.ts}`, rule.mode ?? 'live', Date.now() - started,
        JSON.stringify(traces), JSON.stringify(data), JSON.stringify(actionResults),
      ],
    );

    await query(
      `UPDATE rules
       SET last_triggered_at=NOW(), trigger_count=COALESCE(trigger_count,0)+1,
           updated_at=updated_at
       WHERE id=$1 AND org_id=$2`,
      [rule.id, rule.org_id],
    );
  }
}

export async function startGpsConsumer(): Promise<void> {
  const js = getJs();
  const sc = StringCodec();
  const consumer = await js.consumers.get('TELEMETRY', 'alerts-gps');
  const messages = await consumer.consume();
  log.info('alerts-svc GPS rules consumer started');
  for await (const msg of messages) {
    try {
      const fix = JSON.parse(sc.decode(msg.data)) as GpsFix;
      await evaluateRules(fix);
      msg.ack();
    } catch (err) {
      log.error({ err }, 'GPS rule evaluation error');
      msg.nak();
    }
  }
}
