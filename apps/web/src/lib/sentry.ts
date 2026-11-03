/**
 * Sentry frontend instrumentation.
 * No-op when VITE_SENTRY_DSN is absent (dev / CI without Sentry).
 */
import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env['VITE_APP_VERSION'] as string | undefined,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    // Strip PII
    beforeSend(event) {
      if (event.request?.headers) {
        delete (event.request.headers as Record<string, unknown>)['Authorization'];
        delete (event.request.headers as Record<string, unknown>)['Cookie'];
      }
      return event;
    },
  });
}

export { Sentry };
