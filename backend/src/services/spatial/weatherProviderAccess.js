'use strict';

/**
 * Open-Meteo's free API is for non-commercial use only. Sonalit must opt into
 * that service explicitly for non-commercial deployments, otherwise require
 * the licensed customer API key.
 */
function getOpenMeteoAccess(env = process.env) {
  const apiKey = String(env.OPEN_METEO_API_KEY || '').trim();
  const allowFreeNonCommercial = String(env.OPEN_METEO_ALLOW_FREE_NONCOMMERCIAL || '') === 'true';
  return {
    apiKey,
    allowFreeNonCommercial,
    allowed: Boolean(apiKey) || allowFreeNonCommercial,
    apiBase: String(env.OPEN_METEO_API_BASE || (apiKey
      ? 'https://customer-api.open-meteo.com/v1/forecast'
      : 'https://api.open-meteo.com/v1/forecast')),
  };
}

module.exports = { getOpenMeteoAccess };
