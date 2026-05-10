require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', err);
});

pool.on('connect', () => {
  logger.info('New PostgreSQL client connected');
});

/**
 * Parameterised query helper.
 * Usage: await query('SELECT * FROM users WHERE id = $1', [userId])
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn(`Slow query detected (${duration}ms): ${text.substring(0, 100)}`);
    }
    return result;
  } catch (err) {
    logger.error(`Database query error: ${err.message}\nQuery: ${text}`);
    throw err;
  }
}

/**
 * Health check — verifies DB is reachable.
 */
async function healthCheck() {
  const result = await query('SELECT NOW() AS now');
  return result.rows[0].now;
}

module.exports = { pool, query, healthCheck };
