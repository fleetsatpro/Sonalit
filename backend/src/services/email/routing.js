const OPERATIONAL_SENDER = process.env.RESEND_OPERATIONAL_FROM_EMAIL || 'Sonalit <notifications@sonalit.com>';
const SECURITY_SENDER = process.env.RESEND_SECURITY_FROM_EMAIL || 'Sonalit Security <security@sonalit.com>';

const SECURITY_EVENT_KEYS = new Set([
  'e_lock_tamper', 'lock_tamper', 'unauthorized_unlock', 'forced_unlock',
  'unauthorized_vehicle_movement', 'panic', 'sos', 'security_incident',
  'convoy_security_incident', 'critical_route_deviation', 'route_deviation_critical',
  'prolonged_tracking_loss', 'tracking_loss_critical', 'security_escalation',
]);

const SECURITY_TOKENS = [
  'tamper', 'panic', 'sos', 'forced_unlock', 'unauthorized', 'security',
  'hijack', 'intrusion', 'breach', 'duress', 'dead_man', 'deadman',
];

function normalizeEventKey(value) {
  return String(value || '')
    .trim().toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isSecurityEvent({ type, severity, securityEvent = false } = {}) {
  if (securityEvent) return true;
  const key = normalizeEventKey(type);
  if (SECURITY_EVENT_KEYS.has(key)) return true;
  return SECURITY_TOKENS.some(token => key.includes(token));
}

function resolveEmailRoute({ type, severity, securityEvent = false } = {}) {
  const security = isSecurityEvent({ type, severity, securityEvent });
  return {
    sender: security ? SECURITY_SENDER : OPERATIONAL_SENDER,
    replyTo: security
      ? (process.env.RESEND_SECURITY_REPLY_TO || process.env.RESEND_REPLY_TO || undefined)
      : (process.env.RESEND_OPERATIONAL_REPLY_TO || process.env.RESEND_REPLY_TO || undefined),
    audience: security ? 'security' : 'operational',
    recipientRoles: security ? ['admin', 'dispatcher'] : ['admin', 'dispatcher'],
  };
}

module.exports = {
  OPERATIONAL_SENDER,
  SECURITY_SENDER,
  SECURITY_EVENT_KEYS,
  isSecurityEvent,
  normalizeEventKey,
  resolveEmailRoute,
};
