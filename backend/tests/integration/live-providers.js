'use strict';

/**
 * Reachability probe for the public geo providers the corridor tests use.
 *
 * The corridor integration tests deliberately call the real OSRM demo server
 * and the real Nominatim instance — that is the point of them. But both are
 * free, shared, rate-limited services, so an outage or a 429 caused by someone
 * else's traffic must not turn this repository's CI red: that trains people to
 * ignore a failing pipeline, which costs far more than the coverage is worth.
 *
 * So: probe once, and skip the suites that need a provider when it is
 * unreachable, with a loud warning. Everything that does not need the network —
 * the schema round-trips, the scoring maths, the org isolation — still runs and
 * still fails hard. A logic error can never be skipped past; only an
 * infrastructure outage can.
 *
 * The probe is synchronous on purpose. Jest registers describe() blocks while
 * the module is still evaluating, so an async probe would resolve too late to
 * gate them. curl is used rather than fetch because it is the only HTTP client
 * here that blocks — and, usefully, the only one that reads HTTPS_PROXY without
 * extra flags. If curl is missing the probe reports "reachable" so the suites
 * run and fail loudly, rather than silently skipping and looking green.
 */

const { execFileSync } = require('child_process');

const TIMEOUT_S = 15;

function reachableSync(url) {
  try {
    const code = execFileSync('curl', [
      '-s', '-o', '/dev/null', '-w', '%{http_code}',
      '--max-time', String(TIMEOUT_S),
      '-A', 'Sonalit-Guardian',
      url,
    ], { encoding: 'utf8', timeout: (TIMEOUT_S + 5) * 1000 }).trim();
    return code.startsWith('2');
  } catch (e) {
    // No curl at all: assume up, so a real failure is reported rather than hidden.
    if (e && e.code === 'ENOENT') return true;
    return false;
  }
}

/**
 * @returns {{router:boolean, geocoder:boolean}}
 */
function probeProviders(osrmUrl) {
  const base = (osrmUrl || 'https://router.project-osrm.org').replace(/\/$/, '');
  return {
    // A few-hundred-metre route: cheap, and exercises the planner's own path.
    router: reachableSync(`${base}/route/v1/driving/34.768,-0.0917;34.770,-0.0920?overview=false`),
    geocoder: reachableSync('https://nominatim.openstreetmap.org/search?q=Nairobi&format=jsonv2&limit=1'),
  };
}

/**
 * describe() that becomes describe.skip() when a provider is down, announcing
 * why so an infrastructure skip is never mistaken for a pass.
 */
function describeWhen(ok, label) {
  if (ok) return describe;
  // eslint-disable-next-line no-console
  console.warn(`[integration] SKIPPING "${label}" — provider unreachable. ` +
    'Infrastructure skip, not a pass.');
  return describe.skip;
}

module.exports = { probeProviders, describeWhen, reachableSync };
