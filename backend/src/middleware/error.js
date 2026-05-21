const logger = require('../utils/logger');

/**
 * Wraps async route handlers to forward thrown errors to errorHandler.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Global error handler. Must be registered last in Express middleware chain.
 */
function errorHandler(err, req, res, next) {
  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with that value already exists' });
  }
  // Postgres foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  // Postgres NOT NULL violation
  if (err.code === '23502') {
    return res.status(400).json({ error: 'Required field missing' });
  }
  // Postgres invalid input syntax (e.g. bad UUID, bad enum value)
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid value format' });
  }
  // Joi validation
  if (err.isJoi || err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  if (status >= 500) {
    // Include pg error code so Railway logs show the exact DB failure class
    const pgCode = err.code ? ` [pg:${err.code}]` : '';
    logger.error(`[${req.method} ${req.path}]${pgCode} ${err.stack}`);
  } else {
    logger.warn(`[${req.method} ${req.path}] ${status}: ${err.message}`);
  }

  res.status(status).json({ error: message });
}

module.exports = { asyncHandler, errorHandler };
