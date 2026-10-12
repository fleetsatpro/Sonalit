'use strict';

const crypto = require('crypto');

const ROLE_RANK = Object.freeze({
  analyst: 1,
  cfo: 1,
  operator: 2,
  dispatcher: 3,
  admin: 4,
});

const READ_ONLY_TOOLS = Object.freeze([
  'query_vehicles',
  'query_shipments',
  'query_geofences',
  'query_maintenance',
  'query_drivers',
  'query_devices',
  'query_convoys',
  'query_alerts',
  'get_weather',
  'check_holidays',
  'get_road_conditions',
  'query_risk_zones',
  'get_world_context',
]);

const ACTION_POLICIES = Object.freeze({
  create_geofence: Object.freeze({
    risk_level: 'medium',
    minimum_role: 'operator',
    requires_confirmation: false,
    description: 'Create a tenant geofence after an explicit user instruction.',
  }),
  create_risk_zone: Object.freeze({
    risk_level: 'high',
    minimum_role: 'dispatcher',
    requires_confirmation: true,
    description: 'Create a persistent operational risk-zone record.',
  }),
});

const INSTRUCTIONAL_PATTERNS = [
  /^\s*(?:how\s+(?:do\s+i|can\s+i|to)\b)/i,
  /^\s*(?:tell\s+me\s+how|explain|describe|teach\s+me|help\s+me\s+understand)\b/i,
  /^\s*(?:what\s+(?:is|are|does|would)\b)/i,
  /^\s*(?:why\s+(?:would|should|does|do)\b|should\s+(?:we|i)\b|when\s+should\b)/i,
];

function isInstructionalQuestion(command) {
  const text = String(command || '').trim();
  return INSTRUCTIONAL_PATTERNS.some(pattern => pattern.test(text));
}

function hasActionVerb(command) {
  return /\b(create|draw|sketch|outline|make|build|set\s+up|mark|flag|designate|establish|define|register|add|place|generate|configure|dispatch|execute|reroute|schedule|approve|resolve|close|send)\b/i.test(String(command || ''));
}

function targetPatternForTool(toolName) {
  if (toolName === 'create_geofence') {
    return /\b(geo[- ]?fence|fence|polygon|administrative\s+boundary|safe\s+zone|exclusion\s+zone|checkpoint\s+zone|patrol\s+zone|corridor\s+geofence|zone|area|corridor|boundary)\b/i;
  }
  if (toolName === 'create_risk_zone') {
    return /\b(risk\s+zone|high[- ]?risk\s+(?:zone|area|corridor)|hazard\s+(?:zone|area)|danger\s+(?:zone|area)|unsafe\s+area|risk\s+area|banditry\s+zone|conflict\s+zone|strike\s+(?:area|zone)|roadblock\s+zone|security\s+hotspot)\b/i;
  }
  return null;
}

function hasExplicitActionIntent(command, toolName) {
  const text = String(command || '').trim();
  if (!text || isInstructionalQuestion(text) || !hasActionVerb(text)) return false;

  const riskZoneIntent = /\b(risk\s+zone|high[- ]?risk\s+(?:zone|area|corridor)|hazard\s+(?:zone|area)|danger\s+(?:zone|area)|unsafe\s+area|risk\s+area|banditry\s+zone|conflict\s+zone|strike\s+(?:area|zone)|roadblock\s+zone|security\s+hotspot)\b/i.test(text);
  const explicitGeofence = /\b(geo[- ]?fence|polygon|administrative\s+boundary|corridor\s+geofence)\b/i.test(text);
  if (toolName === 'create_geofence' && riskZoneIntent && !explicitGeofence) return false;

  const target = targetPatternForTool(toolName);
  if (target && target.test(text)) return true;
  if (toolName === 'create_risk_zone') {
    return /\b(mark|flag|designate|declare|treat)\b[\s\S]{0,100}\b(dangerous|unsafe|hazardous|high[- ]?risk)\b/i.test(text);
  }
  return false;
}

function classifyCopilotCommand(command) {
  const text = String(command || '').trim();

  if (isInstructionalQuestion(text)) {
    return { kind: 'investigation', confidence: 'high', reason: 'instructional_question' };
  }

  if (
    hasExplicitActionIntent(text, 'create_geofence')
    || hasExplicitActionIntent(text, 'create_risk_zone')
  ) {
    return { kind: 'action', confidence: 'high', reason: 'explicit_write_intent' };
  }

  if (
    /^\s*(?:what|which|where|when|why|how|who|is|are|show|list|summari[sz]e|analyse|analyze|assess|investigate|compare|check|find|report|review|explain|describe|tell\s+me|give\s+me)\b/i.test(text)
    || /\b(current|live|overview|status|trend|situation\s+report|what\s+happened|how\s+many)\b/i.test(text)
  ) {
    return { kind: 'investigation', confidence: 'medium', reason: 'read_or_analysis_request' };
  }

  return { kind: 'agent', confidence: 'low', reason: 'general_operational_request' };
}

function authorizeCopilotTool({ toolName, command, user }) {
  if (READ_ONLY_TOOLS.includes(toolName)) {
    return { allowed: true, mutation: false, requires_confirmation: false, risk_level: 'low' };
  }

  const policy = ACTION_POLICIES[toolName];
  if (!policy) {
    return {
      allowed: false,
      code: 'tool_policy_missing',
      reason: 'This tool is not registered in the server-side execution policy.',
    };
  }

  if (!hasExplicitActionIntent(command, toolName)) {
    return {
      allowed: false,
      code: 'explicit_action_required',
      reason: 'Copilot cannot perform a write based only on an inferred or informational request.',
      policy,
    };
  }

  const role = String(user && user.role || '').toLowerCase();
  const rank = ROLE_RANK[role] || 0;
  const requiredRank = ROLE_RANK[policy.minimum_role] || Number.POSITIVE_INFINITY;
  if (!role || rank < requiredRank) {
    return {
      allowed: false,
      code: 'insufficient_role',
      reason: 'Your role is not permitted to perform this operation.',
      minimum_role: policy.minimum_role,
      risk_level: policy.risk_level,
      policy,
    };
  }

  if (!user || !user.id || !user.org_id) {
    return {
      allowed: false,
      code: 'tenant_identity_required',
      reason: 'A verified user and organisation context are required for operational writes.',
      policy,
    };
  }

  return {
    allowed: true,
    mutation: true,
    requires_confirmation: policy.requires_confirmation,
    risk_level: policy.risk_level,
    policy,
  };
}

function confirmationSecret() {
  const value = process.env.COPILOT_ACTION_SECRET || process.env.JWT_SECRET || '';
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('COPILOT_ACTION_SECRET or JWT_SECRET must contain at least 32 bytes to sign action confirmations.');
  }
  return value;
}

function signActionConfirmation({ actionId, orgId, userId, expiresAt }) {
  const expiresSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (!actionId || !orgId || !userId || !Number.isFinite(expiresSeconds)) {
    throw new TypeError('Action confirmation payload is incomplete.');
  }
  const payload = {
    v: 1,
    action_id: String(actionId),
    org_id: String(orgId),
    user_id: String(userId),
    exp: expiresSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', confirmationSecret()).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

function verifyActionConfirmation(token) {
  if (typeof token !== 'string' || token.length > 4096) {
    return { valid: false, code: 'invalid_confirmation_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, code: 'invalid_confirmation_token' };
  }

  let expected;
  try {
    expected = crypto.createHmac('sha256', confirmationSecret()).update(parts[0]).digest();
  } catch (_) {
    return { valid: false, code: 'confirmation_signing_unavailable' };
  }

  let provided;
  try { provided = Buffer.from(parts[1], 'base64url'); } catch (_) {
    return { valid: false, code: 'invalid_confirmation_token' };
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { valid: false, code: 'invalid_confirmation_token' };
  }

  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) {
    return { valid: false, code: 'invalid_confirmation_token' };
  }

  if (
    !payload
    || payload.v !== 1
    || typeof payload.action_id !== 'string'
    || typeof payload.org_id !== 'string'
    || typeof payload.user_id !== 'string'
    || !Number.isInteger(payload.exp)
  ) {
    return { valid: false, code: 'invalid_confirmation_token' };
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { valid: false, code: 'confirmation_expired' };
  }

  return { valid: true, payload };
}

function validatePolicyCoverage(toolNames) {
  const unclassified = [];
  for (const name of toolNames || []) {
    if (!READ_ONLY_TOOLS.includes(name) && !ACTION_POLICIES[name]) unclassified.push(name);
  }
  return { valid: unclassified.length === 0, unclassified_tools: unclassified };
}

module.exports = {
  ACTION_POLICIES,
  READ_ONLY_TOOLS,
  authorizeCopilotTool,
  classifyCopilotCommand,
  hasExplicitActionIntent,
  isInstructionalQuestion,
  signActionConfirmation,
  validatePolicyCoverage,
  verifyActionConfirmation,
};
