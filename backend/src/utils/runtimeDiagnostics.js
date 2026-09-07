const { query } = require('../config/database');

const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|database[_-]?url|redis[_-]?url|private[_-]?key|access[_-]?key)/i;
const MAX_MESSAGE = 1000;
const MAX_METADATA_BYTES = 12000;

function redact(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value).slice(0, 100)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function boundedMetadata(metadata) {
  const safe = redact(metadata || {});
  try {
    const json = JSON.stringify(safe);
    if (Buffer.byteLength(json, 'utf8') <= MAX_METADATA_BYTES) return safe;
    return { diagnostic: 'metadata_truncated', preview: json.slice(0, MAX_METADATA_BYTES) };
  } catch (_) {
    return { diagnostic: 'metadata_unserializable' };
  }
}

function inferEvent(message, fallback = 'runtime.event') {
  const text = String(message || '').toLowerCase();
  if (text.includes('uncaughtexception')) return 'process.uncaught_exception';
  if (text.includes('unhandledrejection')) return 'process.unhandled_rejection';
  if (text.includes('hard-exit')) return 'process.hard_exit';
  if (text.includes('shutdown initiated')) return 'process.shutdown';
  if (text.includes('schema check')) return 'database.schema_check';
  if (text.includes('database')) return 'database.runtime';
  if (text.includes('redis')) return 'redis.runtime';
  if (text.includes('osint')) return 'risk.osint';
  if (text.includes('collection fabric')) return 'intelligence.collection_fabric';
  if (text.includes('worker')) return 'worker.runtime';
  if (text.includes('route')) return 'route.runtime';
  if (text.includes('cron') || text.includes('scheduled')) return 'scheduler.runtime';
  if (text.includes('cfo')) return 'cfo.runtime';
  if (text.includes('telegram')) return 'provider.telegram';
  if (text.includes('reliefweb')) return 'provider.reliefweb';
  if (text.includes('gdelt')) return 'provider.gdelt';
  if (text.includes('acled')) return 'provider.acled';
  return fallback;
}

async function recordRuntimeDiagnostic({ level = 'info', event, message, metadata, requestId, orgId } = {}) {
  const normalizedLevel = ['debug', 'info', 'warn', 'error', 'fatal'].includes(level) ? level : 'info';
  const normalizedMessage = String(message || '').slice(0, MAX_MESSAGE);
  if (!normalizedMessage) return null;

  try {
    const { rows } = await query(
      `INSERT INTO runtime_diagnostics
         (service, environment, level, event, message, metadata, request_id, org_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       RETURNING id, occurred_at`,
      [
        process.env.SERVICE_NAME || 'backend',
        process.env.NODE_ENV || 'production',
        normalizedLevel,
        String(event || inferEvent(normalizedMessage)).slice(0, 160),
        normalizedMessage,
        JSON.stringify(boundedMetadata(metadata)),
        requestId ? String(requestId).slice(0, 128) : null,
        orgId || null,
      ]
    );
    return rows[0] || null;
  } catch (_) {
    // Diagnostics must never become a dependency of the production request path.
    return null;
  }
}

async function purgeRuntimeDiagnostics(retentionDays = 30) {
  const days = Math.max(1, Math.min(Number(retentionDays) || 30, 365));
  try {
    await query('DELETE FROM runtime_diagnostics WHERE occurred_at < NOW() - ($1::int * INTERVAL \'1 day\')', [days]);
  } catch (_) {}
}

module.exports = { recordRuntimeDiagnostic, purgeRuntimeDiagnostics, inferEvent, redact };
