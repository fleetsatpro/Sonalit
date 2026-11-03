/**
 * Sentry backend instrumentation — must be required FIRST before any other module.
 * Set SENTRY_DSN in the environment. No-op when DSN is absent (dev/test).
 */
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    // Strip PII from captured events
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-csrf-token'];
      }
      if (event.request?.cookies) event.request.cookies = {};
      return event;
    },
  });
}

module.exports = Sentry;
