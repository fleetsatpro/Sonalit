const logger = require('../utils/logger');

const CENTRIFUGO_URL = (process.env.CENTRIFUGO_URL || 'http://localhost:8000').replace(/\/$/, '');
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
