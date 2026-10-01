const logger = require('../utils/logger');

const DEFAULT_CENTRIFUGO_PORT = Number(process.env.CENTRIFUGO_PORT || 8000);

function normalizeCentrifugoUrl(raw) {
  const value = String(raw || '').trim().replace(/\/$/, '');
  if (!value) return `http://localhost:${DEFAULT_CENTRIFUGO_PORT}`;
  if (/^https?:\/\//i.test(value)) return value;
  // Railway RAILWAY_PRIVATE_DOMAIN references are hostname-only. Preserve an
  // explicitly supplied port, but default the internal Centrifugo API to 8000.
  if (/(^localhost$|\.railway\.internal$)/i.test(value) && !/:\d+$/.test(value)) {
    return `http://${value}:${DEFAULT_CENTRIFUGO_PORT}`;
  }
  return `http://${value}`;
}

const CENTRIFUGO_URL = normalizeCentrifugoUrl(
  process.env.CENTRIFUGO_API_URL
  || process.env.CENTRIFUGO_URL
  || (process.env.RAILWAY_SERVICE_CENTRIFUGO_URL
    ? `http://${process.env.RAILWAY_SERVICE_CENTRIFUGO_URL}:8000`
    : 'http://centrifugo.railway.internal:8000')
);
const CENTRIFUGO_API_KEY = process.env.CENTRIFUGO_API_KEY || '';

async function publish(channel, data) {
  if (!CENTRIFUGO_API_KEY) return;
  try {
    const resp = await fetch(`${CENTRIFUGO_URL}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': CENTRIFUGO_API_KEY },
      body: JSON.stringify({ channel, data }),
      signal: AbortSignal.timeout(5_000),
    });
    let payload = null;
    try { payload = await resp.json(); } catch (_) {}

    if (!resp.ok) {
      logger.warn(`Centrifugo publish failed: HTTP ${resp.status} on ${channel}`);
      return;
    }
    if (payload?.error) {
      logger.warn(
        `Centrifugo publish failed: ${payload.error.code || 'unknown'} ${payload.error.message || 'unknown error'} on ${channel}`
      );
    }
  } catch (err) {
    logger.warn(`Centrifugo publish error: ${err.message}`);
  }
}

module.exports = { publish, normalizeCentrifugoUrl };
