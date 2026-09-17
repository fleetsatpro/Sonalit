import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { NotFoundError, ValidationError, AuthError } from '../lib/errors.js';
import { evaluateRule, type RuleAction, type RuleCondition } from '../rules/engine.js';

const ConditionSchema = z.object({
  field: z.string().min(1).max(160),
  operator: z.enum(['eq','neq','gt','gte','lt','lte','in','not_in','contains','exists','between']),
  value: z.unknown().optional(),
  negate: z.boolean().optional(),
});

const ActionSchema = z.object({
  type: z.enum(['alert','create_incident','notify','webhook','escalate','tag','log']),
  channel: z.string().max(40).optional(),
  recipient: z.string().max(320).optional(),
  template: z.string().max(4096).optional(),
  severity: z.enum(['low','medium','high','critical']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const RuleWriteSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().default(true),
  status: z.enum(['draft','active','paused','archived','error']).optional(),
  priority: z.coerce.number().int().min(0).max(1000).default(50),
  severity: z.enum(['low','medium','high','critical']).default('medium'),
  mode: z.enum(['live','dry_run']).default('live'),
  scope: z.record(z.string(), z.unknown()).default({ type: 'org' }),
  conditions: z.array(ConditionSchema).min(1).optional(),
  condition_logic: z.enum(['all','any']).default('all'),
  actions: z.array(ActionSchema).min(1).optional(),
  schedule: z.record(z.string(), z.unknown()).default({ enabled: false }),
  cooldown_seconds: z.coerce.number().int().min(0).max(604800).default(900),
  evaluation_window_seconds: z.coerce.number().int().min(0).max(604800).default(0),
  deduplication: z.record(z.string(), z.unknown()).default({ strategy: 'rule_subject', ttl_seconds: 900 }),
  tags: z.array(z.string().max(80)).max(50).default([]),
  // Compatibility fields for older clients.
  condition_type: z.enum(['speed','geofence','idle','battery']).optional(),
  threshold: z.coerce.number().optional(),
  action_type: z.enum(['alert','notify']).optional(),
});

type RuleRow = Record<string, unknown> & {
  id: string;
  org_id: string;
  version: number;
  name: string;
  enabled: boolean;
  condition_type?: string;
  threshold?: number | null;
  action_type?: string;
};

function requireOrgId(request: FastifyRequest, reply: FastifyReply): string {
  const user = request.user;
  if (!user) {
    const err = new AuthError();
    reply.status(err.statusCode).send({ code: err.code, message: err.message });
    return '';
  }
  return user.org_id;
}

function normalizeConditions(input: z.infer<typeof RuleWriteSchema>): RuleCondition[] {
  if (input.conditions?.length) return input.conditions;
  if (input.condition_type) {
    return [{
      field: input.condition_type === 'speed' ? 'speed_kmh' : input.condition_type,
      operator: 'gt',
      value: input.threshold ?? 0,
    }];
  }
  return [];
}

function normalizeActions(input: z.infer<typeof RuleWriteSchema>): RuleAction[] {
  if (input.actions?.length) return input.actions;
  return [{ type: input.action_type ?? 'alert' }];
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function ruleForEvaluation(row: RuleRow) {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    version: Number(row.version ?? 1),
    priority: Number(row.priority ?? 50),
    severity: (row.severity as 'low'|'medium'|'high'|'critical') ?? 'medium',
    mode: (row.mode as 'live'|'dry_run') ?? 'live',
    conditions: Array.isArray(row.conditions) ? row.conditions as RuleCondition[] : [],
    condition_logic: (row.condition_logic as 'all'|'any') ?? 'all',
    actions: Array.isArray(row.actions) ? row.actions as RuleAction[] : [],
  };
}

function snapshot(row: RuleRow): Record<string, unknown> {
  const copy = { ...row };
  delete copy.deleted_at;
  return copy;
}

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v4/rules', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const rows = await query<RuleRow>(
      `SELECT * FROM rules
       WHERE org_id=$1 AND deleted_at IS NULL
       ORDER BY priority DESC, created_at DESC`,
      [orgId],
    );
    return reply.send({ data: rows });
  });

  app.get('/v4/rules/stats', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const [summary] = await query<Record<string, unknown>>(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND enabled=true AND status='active') AS active,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND mode='dry_run') AS dry_run,
         COALESCE(SUM(trigger_count) FILTER (WHERE deleted_at IS NULL),0) AS executions,
         COALESCE(SUM(failure_count) FILTER (WHERE deleted_at IS NULL),0) AS failures,
         MAX(last_triggered_at) AS last_triggered_at
       FROM rules WHERE org_id=$1`,
      [orgId],
    );
    return reply.send({ data: summary ?? {} });
  });

  app.get('/v4/rules/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const [row] = await query<RuleRow>(
      `SELECT * FROM rules WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    return reply.send(row);
  });

  app.get('/v4/rules/:id/executions', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query ?? {});
    const rows = await query(
      `SELECT id,rule_id,rule_version,correlation_id,subject_type,subject_id,event_type,event_id,
              mode,matched,suppressed,suppression_reason,decision_ms,condition_trace,action_results,error,evaluated_at
       FROM rule_executions
       WHERE rule_id=$1 AND org_id=$2
       ORDER BY evaluated_at DESC LIMIT $3`,
      [id, orgId, parsed.limit],
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/rules', async (request, reply) => {
    const user = request.user;
    if (!user) {
      const err = new AuthError();
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    const parsed = RuleWriteSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    const input = parsed.data;
    const conditions = normalizeConditions(input);
    const actions = normalizeActions(input);
    if (!conditions.length || !actions.length) {
      const err = new ValidationError('A rule needs at least one condition and one action');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const id = randomUUID();
    const [row] = await query<RuleRow>(
      `INSERT INTO rules
       (id,org_id,name,description,condition_type,threshold,action_type,enabled,status,priority,severity,mode,scope,conditions,actions,condition_logic,schedule,cooldown_seconds,evaluation_window_seconds,deduplication,tags,version,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,CASE WHEN $8 THEN 'active' ELSE 'paused' END),$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20::jsonb,$21::jsonb,1,$22,$22)
       RETURNING *`,
      [
        id, user.org_id, input.name, input.description ?? null,
        input.condition_type ?? null, input.threshold ?? null, input.action_type ?? null,
        input.enabled, input.status ?? null, input.priority, input.severity, input.mode,
        json(input.scope), json(conditions), json(actions), input.condition_logic,
        json(input.schedule), input.cooldown_seconds, input.evaluation_window_seconds,
        json(input.deduplication), json(input.tags), user.id,
      ],
    );

    await query(
      `INSERT INTO rule_versions (rule_id,org_id,version,snapshot,change_type,changed_by)
       VALUES ($1,$2,1,$3::jsonb,'create',$4)`,
      [id, user.org_id, 1, json(snapshot(row)), user.id],
    );
    return reply.status(201).send(row);
  });

  app.post('/v4/rules/:id/test', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const { id } = request.params as { id: string };
    const [row] = await query<RuleRow>(
      `SELECT * FROM rules WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    const body = z.object({
      type: z.string().min(1).max(160).default('rules.test'),
      data: z.record(z.string(), z.unknown()).default({}),
      subject_type: z.string().max(80).optional(),
      subject_id: z.string().max(160).optional(),
    }).parse(request.body ?? {});
    const result = evaluateRule(ruleForEvaluation(row), {
      type: body.type, data: body.data,
      subject_type: body.subject_type, subject_id: body.subject_id,
    });
    return reply.send({ data: result });
  });

  app.patch('/v4/rules/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const user = request.user;
    const { id } = request.params as { id: string };
    const parsed = RuleWriteSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const [base] = await query<RuleRow>(
      `SELECT * FROM rules WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [id, orgId],
    );
    if (!base) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const input = parsed.data;
    const merged = { ...base, ...input } as z.infer<typeof RuleWriteSchema>;
    const conditions = input.conditions ? normalizeConditions(merged) : (Array.isArray(base.conditions) ? base.conditions as RuleCondition[] : normalizeConditions(merged));
    const actions = input.actions ? normalizeActions(merged) : (Array.isArray(base.actions) ? base.actions as RuleAction[] : normalizeActions(merged));
    const nextVersion = Number(base.version ?? 1) + 1;

    const [row] = await query<RuleRow>(
      `UPDATE rules SET
       name=$1, description=$2, condition_type=$3, threshold=$4, action_type=$5,
       enabled=$6, status=$7, priority=$8, severity=$9, mode=$10, scope=$11::jsonb,
       conditions=$12::jsonb, actions=$13::jsonb, condition_logic=$14, schedule=$15::jsonb,
       cooldown_seconds=$16, evaluation_window_seconds=$17, deduplication=$18::jsonb,
       tags=$19::jsonb, version=$20, updated_by=$21, updated_at=NOW()
       WHERE id=$22 AND org_id=$23 AND deleted_at IS NULL RETURNING *`,
      [
        input.name ?? base.name, input.description ?? base.description ?? null,
        input.condition_type ?? base.condition_type ?? null, input.threshold ?? base.threshold ?? null,
        input.action_type ?? base.action_type ?? null, input.enabled ?? base.enabled,
        input.status ?? base.status ?? ((input.enabled ?? base.enabled) ? 'active' : 'paused'),
        input.priority ?? Number(base.priority ?? 50), input.severity ?? base.severity ?? 'medium',
        input.mode ?? base.mode ?? 'live', json(input.scope ?? base.scope ?? { type:'org' }),
        json(conditions), json(actions), input.condition_logic ?? base.condition_logic ?? 'all',
        json(input.schedule ?? base.schedule ?? { enabled:false }),
        input.cooldown_seconds ?? Number(base.cooldown_seconds ?? 900),
        input.evaluation_window_seconds ?? Number(base.evaluation_window_seconds ?? 0),
        json(input.deduplication ?? base.deduplication ?? {strategy:'rule_subject',ttl_seconds:900}),
        json(input.tags ?? base.tags ?? []), nextVersion, user?.id ?? null, id, orgId,
      ],
    );

    await query(
      `INSERT INTO rule_versions (rule_id,org_id,version,snapshot,change_type,changed_by)
       VALUES ($1,$2,$3,$4::jsonb,'update',$5)`,
      [id, orgId, nextVersion, json(snapshot(row)), user?.id ?? null],
    );
    return reply.send(row);
  });

  app.delete('/v4/rules/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;
    const user = request.user;
    const { id } = request.params as { id: string };
    const [row] = await query(
      `UPDATE rules SET status='archived',enabled=false,deleted_at=NOW(),updated_at=NOW(),updated_by=$3
       WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, orgId, user?.id ?? null],
    );
    if (!row) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    return reply.status(204).send();
  });
}
