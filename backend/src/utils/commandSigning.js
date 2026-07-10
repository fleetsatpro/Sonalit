const crypto = require('crypto');

// Shared by guardian.js and guardian-ops.js so every device_commands row —
// regardless of which route issued it — gets a signature the heartbeat poll's
// `WHERE signature IS NOT NULL` claim query (guardian.js /heartbeat) will pick up.
const COMMAND_SIGNING_SECRET = process.env.COMMAND_SIGNING_SECRET || 'guardian-dev-signing-secret-2024';

// Produce canonical JSON: sorted keys, no whitespace, UTF-8. Handles nested objects/arrays.
function canonicalJson(obj) {
  if (obj == null) return '{}';
  function sorted(val) {
    if (val === null) return 'null';
    if (typeof val === 'boolean' || typeof val === 'number') return String(val);
    if (typeof val === 'string') return JSON.stringify(val);
    if (Array.isArray(val)) return '[' + val.map(sorted).join(',') + ']';
    if (typeof val === 'object') {
      const keys = Object.keys(val).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + sorted(val[k])).join(',') + '}';
    }
    return JSON.stringify(val);
  }
  return sorted(obj);
}

// Signed string: commandId:commandType:sha256(canonicalJson(payload)):issuedAt:expiresAt
function signCommand(commandId, commandType, payload, issuedAt, expiresAt) {
  const ts = issuedAt instanceof Date ? issuedAt.toISOString() : (issuedAt || '');
  const exp = expiresAt instanceof Date ? expiresAt.toISOString() : (expiresAt || '');
  const payloadHash = crypto.createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
  const message = `${commandId}:${commandType}:${payloadHash}:${ts}:${exp}`;
  return crypto.createHmac('sha256', COMMAND_SIGNING_SECRET).update(message).digest('hex');
}

module.exports = { COMMAND_SIGNING_SECRET, canonicalJson, signCommand };
