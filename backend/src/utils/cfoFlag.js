const { query } = require('../config/database');
const logger = require('./logger');

let cachedEnabled = null;
let cacheExpiry = 0;

async function isCfoModuleEnabled() {
  // Env var override — accepts true/1/yes (case-insensitive)
  const env = (process.env.CFO_MODULE_ENABLED || '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(env)) return true;
  if (['false', '0', 'no'].includes(env)) return false;

  if (Date.now() < cacheExpiry && cachedEnabled !== null) return cachedEnabled;
  try {
    const result = await query(
      "SELECT value_int FROM guardian_config WHERE key = 'cfo_module_enabled'",
      []
    );
    cachedEnabled = result.rows.length > 0 && Number(result.rows[0].value_int) === 1;
    cacheExpiry = Date.now() + 30_000;
    return cachedEnabled;
  } catch (err) {
    logger.error(`cfoFlag.isCfoModuleEnabled error: ${err.message}`);
    return false;
  }
}

module.exports = { isCfoModuleEnabled };
