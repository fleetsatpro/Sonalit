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
  // Joi validation
  if (err.isJoi || err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  if (status >= 500) {
    logger.error(`[${req.method} ${req.path}] ${err.stack}`);
  } else {
    logger.warn(`[${req.method} ${req.path}] ${status}: ${err.message}`);
  }

  res.status(status).json({ error: message });
}

module.exports = { asyncHandler, errorHandler };
