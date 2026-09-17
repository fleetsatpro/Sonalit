const logger = require('../utils/logger');

function normalizeCentrifugoUrl(raw) {
  const value = String(raw || 'http://localhost:8000').trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

const CENTRIFUGO_URL = normalizeCentrifugoUrl(process.env.CENTRIFUGO_URL);
const CENTRIFUGO_API_KEY = process.env.CENTRIFUGO_API_KEY || '';

async function publish(channel, data) {
  if (!CENTRIFUGO_API_KEY) return;
  try {
    const resp = await fetch(`${CENTRIFUGO_URL}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `apikey ${CENTRIFUGO_API_KEY}` },
      body: JSON.stringify({ channel, data }),
    });
    if (!resp.ok) logger.warn(`Centrifugo publish failed: ${resp.status} on ${channel}`);
  } catch (err) {
    logger.warn(`Centrifugo publish error: ${err.message}`);
  }
}

module.exports = { publish };
