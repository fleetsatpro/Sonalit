const logger = require('../utils/logger');

function normalizeCentrifugoUrl(raw) {
  const value = String(raw || 'http://localhost:8000').trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

// Publish API traffic must use an HTTP origin reachable from the backend container.
// Prefer the explicitly named API URL, then the legacy URL, then Railway's
// injected private-domain reference for the Centrifugo service.
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
    });

    let payload = null;
    try {
      payload = await resp.json();
    } catch (_) {
      // Some proxies/load-balancers may return an empty/non-JSON error body.
    }

    if (!resp.ok) {
      logger.warn(`Centrifugo publish failed: HTTP ${resp.status} on ${channel}`);
      return;
    }

    if (payload?.error) {
      logger.warn(`Centrifugo publish rejected: ${payload.error.message || 'unknown error'} (${payload.error.code ?? 'unknown code'}) on ${channel}`);
    }
  } catch (err) {
    logger.warn(`Centrifugo publish error: ${err.message}`);
  }
}

module.exports = { publish };
