const logger = require('../utils/logger');

function normalizeCentrifugoUrl(raw) {
  const value = String(raw || 'http://localhost:8000').trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

const CENTRIFUGO_URL = normalizeCentrifugoUrl(process.env.CENTRIFUGO_API_URL || process.env.CENTRIFUGO_URL);
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
      logger.warn(`Centrifugo publish failed: ${resp.status} on ${channel}`);
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

module.exports = { publish };
