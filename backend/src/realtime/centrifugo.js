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

// Clear retained publications when an SJM team roster rotates to a new channel epoch.
// Old subscription JWTs remain cryptographically valid until expiry, so history must not
// remain available on the superseded channel after access is revoked.
async function removeChannelHistory(channel) {
  if (!CENTRIFUGO_API_KEY) {
    logger.warn('Centrifugo history removal unavailable: API key is not configured');
    return false;
  }
  try {
    const resp = await fetch(CENTRIFUGO_URL + '/api/history_remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': CENTRIFUGO_API_KEY },
      body: JSON.stringify({ channel }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      logger.warn('Centrifugo history removal failed: HTTP ' + resp.status + ' for ' + channel);
      return false;
    }
    let payload;
    try {
      payload = await resp.json();
    } catch (err) {
      logger.warn('Centrifugo history removal returned an unreadable response for ' + channel + ': ' + err.message);
      return false;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || !Object.prototype.hasOwnProperty.call(payload, 'result')
        || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)
        || payload.error) {
      logger.warn('Centrifugo history removal returned an invalid success response for ' + channel);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('Centrifugo history removal error for ' + channel + ': ' + err.message);
    return false;
  }
}
async function unsubscribeUserFromChannel(userId, channel) {
  if (!CENTRIFUGO_API_KEY) {
    logger.warn('Centrifugo unsubscribe unavailable: API key is not configured');
    return false;
  }
  try {
    const resp = await fetch(`${CENTRIFUGO_URL}/api/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': CENTRIFUGO_API_KEY },
      body: JSON.stringify({ user: String(userId), channel }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      logger.warn(`Centrifugo unsubscribe failed: HTTP ${resp.status} for user ${userId} on ${channel}`);
      return false;
    }

    let payload;
    try {
      payload = await resp.json();
    } catch (err) {
      logger.warn(`Centrifugo unsubscribe returned an unreadable response for user ${userId} on ${channel}: ${err.message}`);
      return false;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || !Object.prototype.hasOwnProperty.call(payload, 'result') || payload.error) {
      logger.warn(`Centrifugo unsubscribe returned an invalid success response for user ${userId} on ${channel}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(`Centrifugo unsubscribe error for user ${userId} on ${channel}: ${err.message}`);
    return false;
  }
}

module.exports = { publish, removeChannelHistory, unsubscribeUserFromChannel, normalizeCentrifugoUrl };
