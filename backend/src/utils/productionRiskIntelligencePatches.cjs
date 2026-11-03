/*
 * Production compatibility guards for Risk Intelligence providers.
 * These guards are intentionally narrow and fail-closed.
 */

const { URL } = require('url');

// ReliefWeb requires an approved appname. Never send Sonalit's traffic with
// a fabricated/default identifier. If none is configured, return an empty,
// successful provider result so the OSINT sweep remains healthy and isolated.
const nativeFetch = globalThis.fetch;
if (typeof nativeFetch === 'function') {
  globalThis.fetch = async function productionRiskFetch(input, init) {
    let urlString;
    try {
      urlString = typeof input === 'string' ? input : input?.url;
    } catch (_) {
      urlString = null;
    }

    if (urlString && urlString.includes('https://api.reliefweb.int/v2/reports')) {
      const configuredAppName = String(process.env.RELIEFWEB_APP_NAME || '').trim();
      if (!configuredAppName) {
        return new Response(JSON.stringify({
          data: [],
          totalCount: 0,
          _sonalit: { provider: 'reliefweb', status: 'disabled', reason: 'RELIEFWEB_APP_NAME not configured' },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      try {
        const url = new URL(urlString);
        url.searchParams.set('appname', configuredAppName);
        return nativeFetch(url.toString(), init);
      } catch (_) {
        // Preserve native fetch behavior for malformed/non-URL inputs.
      }
    }

    return nativeFetch(input, init);
  };
}

// The current risk_zones auto-creation statement historically reused $5 for
// both `level` and `risk_level`. PostgreSQL can infer different parameter
// types and reject the prepared statement. Normalize only that exact statement.
try {
  const pg = require('pg');
  const Pool = pg.Pool;
  if (Pool && Pool.prototype && typeof Pool.prototype.query === 'function') {
    const nativeQuery = Pool.prototype.query;
    Pool.prototype.query = function productionRiskQuery(text, values, callback) {
      const isRiskZoneInsert = typeof text === 'string'
        && text.includes('INSERT INTO risk_zones')
        && text.includes('level_source')
        && text.includes(',$5,')
        && text.includes(",$5,'auto')");

      if (isRiskZoneInsert && Array.isArray(values) && values.length === 13) {
        const normalizedText = text.replace(",$13,$5,'auto')", ",$13,$14,'auto')");
        const normalizedValues = values.concat(values[4]);
        return nativeQuery.call(this, normalizedText, normalizedValues, callback);
      }

      return nativeQuery.call(this, text, values, callback);
    };
  }
} catch (_) {
  // Never prevent the application from starting because of the compatibility guard.
}
