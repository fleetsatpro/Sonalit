// Preload hook: installs durable diagnostics without changing app.js.
// It intentionally records only operationally meaningful messages, not every
// HTTP request, so PostgreSQL remains a diagnostic store rather than a log sink.
require('dotenv').config();

const { recordRuntimeDiagnostic, purgeRuntimeDiagnostics, inferEvent } = require('./runtimeDiagnostics');
const logger = require('./logger');

const original = {};
const levels = ['warn', 'error', 'fatal'];
const infoSignals = [
  /running on port/i,
  /schema check/i,
  /workers? started/i,
  /workers? not started/i,
  /osint/i,
  /collection fabric/i,
  /intelligence/i,
  /scheduled/i,
  /route loaded/i,
  /route .*failed/i,
  /database/i,
  /redis/i,
  /partition/i,
  /cfo/i,
  /telegram/i,
  /reliefweb/i,
  /gdelt/i,
  /acled/i,
  /shutdown initiated/i,
  /hard-exit/i,
];

function stringifyArgs(args) {
  return args.map(value => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }).join(' ').slice(0, 1000);
}

function install() {
  for (const level of [...levels, 'info']) {
    if (typeof logger[level] !== 'function') continue;
    original[level] = logger[level].bind(logger);
    logger[level] = (...args) => {
      const message = stringifyArgs(args);
      const shouldPersist = level !== 'info' || infoSignals.some(re => re.test(message));
      if (shouldPersist) {
        recordRuntimeDiagnostic({
          level,
          event: inferEvent(message),
          message,
          metadata: { pid: process.pid },
        }).catch(() => {});
      }
      return original[level](...args);
    };
  }

  // Capture process failures even if the application later installs its own
  // listeners. We do not exit here; app.js remains the owner of shutdown policy.
  process.on('uncaughtExceptionMonitor', err => {
    recordRuntimeDiagnostic({
      level: 'fatal',
      event: 'process.uncaught_exception',
      message: err?.stack || err?.message || String(err),
      metadata: { pid: process.pid },
    }).catch(() => {});
  });

  process.on('unhandledRejection', reason => {
    recordRuntimeDiagnostic({
      level: 'fatal',
      event: 'process.unhandled_rejection',
      message: reason?.stack || reason?.message || String(reason),
      metadata: { pid: process.pid },
    }).catch(() => {});
  });

  recordRuntimeDiagnostic({
    level: 'info',
    event: 'process.bootstrap',
    message: 'Runtime diagnostics bootstrap installed',
    metadata: { pid: process.pid, node: process.version, environment: process.env.NODE_ENV || 'production' },
  }).catch(() => {});

  // Best-effort retention. Failure is deliberately silent because this hook
  // must never prevent the API from starting.
  purgeRuntimeDiagnostics(process.env.RUNTIME_DIAGNOSTICS_RETENTION_DAYS || 30).catch(() => {});
}

install();

module.exports = { install };
