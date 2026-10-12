'use strict';

const crypto = require('crypto');
const { withOrg } = require('../utils/orgScopedDb');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') out[key] = canonicalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function actionInputHash({ command, toolName, input }) {
  return crypto.createHash('sha256')
    .update(stableJson({ command: String(command || '').trim(), tool_name: toolName, input }))
    .digest('hex');
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError((field || 'identifier') + ' must be a UUID.');
  }
  return value;
}

async function createActionRun({ orgId, userId, requestId, command, toolName, input, riskLevel, status }) {
  if (!orgId || !userId) throw new Error('Action audit requires an authenticated user and organisation.');
  requireUuid(requestId, 'request_id');
  const hash = actionInputHash({ command, toolName, input });
  const initialStatus = status === 'pending_confirmation' ? status : 'executing';

  return withOrg(orgId, async (client) => {
    const inserted = await client.query(
      "INSERT INTO public.copilot_action_runs\n" +
      "  (org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at)\n" +
      "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,CASE WHEN $9='pending_confirmation' THEN NOW() + INTERVAL '10 minutes' ELSE NULL END)\n" +
      "ON CONFLICT (org_id, request_id) DO NOTHING\n" +
      "RETURNING id, org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at, confirmed_by, confirmed_at, result, error_code, created_at, updated_at, completed_at",
      [orgId, requestId, String(userId), String(command || '').slice(0, 4000), toolName, JSON.stringify(input || {}), hash, riskLevel || 'medium', initialStatus],
    );
    if (inserted.rows && inserted.rows[0]) return { run: inserted.rows[0], duplicate: false };

    const existing = await client.query(
      "SELECT id, org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at, confirmed_by, confirmed_at, result, error_code, created_at, updated_at, completed_at\n" +
      "FROM public.copilot_action_runs WHERE org_id=$1 AND request_id=$2 LIMIT 1 FOR UPDATE",
      [orgId, requestId],
    );
    const run = existing.rows && existing.rows[0];
    if (!run) throw new Error('idempotency_record_unavailable');
    if (run.input_hash !== hash || run.tool_name !== toolName || String(run.user_id) !== String(userId)) {
      throw new Error('idempotency_conflict');
    }
    return { run, duplicate: true };
  });
}

async function getActionRun({ orgId, actionId }) {
  requireUuid(actionId, 'action_id');
  return withOrg(orgId, async (client) => {
    const result = await client.query(
      "SELECT id, org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at, confirmed_by, confirmed_at, result, error_code, created_at, updated_at, completed_at\n" +
      "FROM public.copilot_action_runs WHERE id=$1 AND org_id=$2 LIMIT 1",
      [actionId, orgId],
    );
    return result.rows && result.rows[0] || null;
  });
}

async function listPendingActionRuns({ orgId, userId, limit = 10 }) {
  if (!orgId || !userId) throw new Error('Pending action listing requires tenant and user context.');
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(Number(limit) || 10)));
  return withOrg(orgId, async (client) => {
    const result = await client.query(
      "SELECT id, org_id, request_id, user_id, command, tool_name, action_input, risk_level, status, expires_at, created_at\n" +
      "FROM public.copilot_action_runs\n" +
      "WHERE org_id=$1 AND user_id=$2 AND status='pending_confirmation' AND expires_at > NOW()\n" +
      "ORDER BY created_at DESC LIMIT $3",
      [orgId, String(userId), safeLimit],
    );
    return result.rows || [];
  });
}

async function claimActionRun({ orgId, actionId, userId }) {
  requireUuid(actionId, 'action_id');
  return withOrg(orgId, async (client) => {
    const currentResult = await client.query(
      "SELECT id, org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at, confirmed_by, confirmed_at, result, error_code, created_at, updated_at, completed_at\n" +
      "FROM public.copilot_action_runs WHERE id=$1 AND org_id=$2 FOR UPDATE",
      [actionId, orgId],
    );
    const current = currentResult.rows && currentResult.rows[0];
    if (!current) return { mode: 'not_found', run: null };
    if (String(current.user_id) !== String(userId)) return { mode: 'forbidden', run: current };
    if (current.status === 'succeeded') return { mode: 'replay', run: current };
    if (current.status === 'executing') return { mode: 'in_progress', run: current };
    if (current.status !== 'pending_confirmation') return { mode: current.status, run: current };

    if (!current.expires_at || new Date(current.expires_at).getTime() <= Date.now()) {
      const expired = await client.query(
        "UPDATE public.copilot_action_runs SET status='expired', error_code='confirmation_expired', completed_at=NOW(), updated_at=NOW()\n" +
        "WHERE id=$1 AND org_id=$2 RETURNING id, org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at, confirmed_by, confirmed_at, result, error_code, created_at, updated_at, completed_at",
        [actionId, orgId],
      );
      return { mode: 'expired', run: expired.rows && expired.rows[0] || current };
    }

    const claimed = await client.query(
      "UPDATE public.copilot_action_runs SET status='executing', confirmed_by=$3, confirmed_at=NOW(), updated_at=NOW()\n" +
      "WHERE id=$1 AND org_id=$2 AND status='pending_confirmation'\n" +
      "RETURNING id, org_id, request_id, user_id, command, tool_name, action_input, input_hash, risk_level, status, expires_at, confirmed_by, confirmed_at, result, error_code, created_at, updated_at, completed_at",
      [actionId, orgId, String(userId)],
    );
    return { mode: 'claimed', run: claimed.rows && claimed.rows[0] || null };
  });
}

async function declineActionRun({ orgId, actionId, userId }) {
  requireUuid(actionId, 'action_id');
  return withOrg(orgId, async (client) => {
    const result = await client.query(
      "UPDATE public.copilot_action_runs SET status='denied', error_code='operator_declined', completed_at=NOW(), updated_at=NOW()\n" +
      "WHERE id=$1 AND org_id=$2 AND user_id=$3 AND status='pending_confirmation'\n" +
      "RETURNING id, org_id, request_id, user_id, command, tool_name, risk_level, status, created_at, updated_at, completed_at",
      [actionId, orgId, String(userId)],
    );
    return result.rows && result.rows[0] || null;
  });
}

async function finishActionRun({ orgId, actionId, status, result, errorCode }) {
  requireUuid(actionId, 'action_id');
  if (!['succeeded', 'failed', 'denied', 'expired'].includes(status)) {
    throw new TypeError('Action run terminal status is invalid.');
  }
  return withOrg(orgId, async (client) => {
    const updated = await client.query(
      "UPDATE public.copilot_action_runs SET status=$3, result=$4::jsonb, error_code=$5, completed_at=NOW(), updated_at=NOW()\n" +
      "WHERE id=$1 AND org_id=$2 AND status='executing'\n" +
      "RETURNING id, org_id, request_id, user_id, command, tool_name, risk_level, status, result, error_code, created_at, updated_at, completed_at",
      [actionId, orgId, status, JSON.stringify(result || {}), errorCode || null],
    );
    return updated.rows && updated.rows[0] || null;
  });
}

function makeActionReceipt(run) {
  if (!run) return null;
  return {
    id: run.id,
    request_id: run.request_id,
    tool_name: run.tool_name,
    risk_level: run.risk_level,
    status: run.status,
    created_at: run.created_at,
    completed_at: run.completed_at || null,
  };
}

function summarizeToolInput(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const summary = {};
  for (const [key, value] of Object.entries(source).slice(0, 20)) {
    if (/password|secret|token|api[_-]?key|credential|authorization/i.test(key)) continue;
    if (typeof value === 'string') summary[key] = value.slice(0, 300);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) summary[key] = value;
    else if (Array.isArray(value)) summary[key] = { type: 'array', count: value.length };
    else if (typeof value === 'object') summary[key] = { type: 'object', keys: Object.keys(value).slice(0, 20) };
  }
  return summary;
}

function summarizeToolResult(result) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const counts = {};
  for (const key of ['vehicles', 'convoys', 'shipments', 'alerts', 'geofences', 'risk_zones', 'drivers', 'devices', 'riskZones']) {
    if (Array.isArray(source[key])) counts[key] = source[key].length;
  }
  const summary = { keys: Object.keys(source).slice(0, 30) };
  if (Object.keys(counts).length) summary.counts = counts;
  for (const key of ['created', 'count', 'risk_level', 'confidence', 'precision', 'geometry_source', 'vertex_count', 'geofence_id', 'risk_zone_id']) {
    if (source[key] !== undefined && (typeof source[key] !== 'object' || source[key] === null)) summary[key] = source[key];
  }
  if (source.error) summary.error = String(source.error).slice(0, 250);
  if (source.message) summary.message = String(source.message).slice(0, 300);
  return summary;
}

async function recordToolTrace({ orgId, userId, requestId, ordinal, toolName, status, input, result, latencyMs, provider, errorCode }) {
  if (!orgId || !userId || !UUID_PATTERN.test(String(requestId || ''))) {
    throw new Error('Tool trace requires tenant, user and request UUID.');
  }
  const safeOrdinal = Math.max(0, Math.min(10000, Math.trunc(Number(ordinal) || 0)));
  const safeLatency = Math.max(0, Math.min(120000, Math.trunc(Number(latencyMs) || 0)));
  const traceStatus = ['succeeded', 'failed', 'denied', 'pending_confirmation'].includes(status) ? status : 'failed';
  return withOrg(orgId, async (client) => {
    const inserted = await client.query(
      "INSERT INTO public.copilot_tool_traces\n" +
      " (org_id, request_id, user_id, ordinal, tool_name, status, input_summary, result_summary, latency_ms, provider, error_code)\n" +
      "VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)\n" +
      "ON CONFLICT (org_id, request_id, ordinal) DO NOTHING RETURNING id",
      [orgId, requestId, String(userId), safeOrdinal, String(toolName || 'unknown').slice(0, 100), traceStatus, JSON.stringify(summarizeToolInput(input)), JSON.stringify(summarizeToolResult(result)), safeLatency, provider ? String(provider).slice(0, 100) : null, errorCode ? String(errorCode).slice(0, 100) : null],
    );
    return inserted.rows && inserted.rows[0] ? inserted.rows[0].id : null;
  });
}

module.exports = {
  claimActionRun,
  createActionRun,
  declineActionRun,
  finishActionRun,
  getActionRun,
  listPendingActionRuns,
  makeActionReceipt,
  recordToolTrace,
  summarizeToolInput,
  summarizeToolResult,
};
