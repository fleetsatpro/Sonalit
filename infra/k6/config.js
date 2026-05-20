import { sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'https://api.sonalit.io';

export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-Client-Version': 'k6-load-test/1.0',
};

/**
 * Obtain a short-lived access token using client credentials.
 * Reads credentials from environment variables to avoid hardcoding secrets.
 */
export function getAuthToken() {
  const clientId = __ENV.K6_CLIENT_ID;
  const clientSecret = __ENV.K6_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('K6_CLIENT_ID and K6_CLIENT_SECRET must be set');
  }

  const res = http.post(
    `${BASE_URL}/v4/auth/token`,
    JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'telemetry fleet alerts',
    }),
    { headers: DEFAULT_HEADERS, timeout: '10s' },
  );

  if (res.status !== 200) {
    throw new Error(`Auth token request failed: ${res.status} ${res.body}`);
  }

  return JSON.parse(res.body).access_token;
}

/**
 * Return headers with a Bearer token injected.
 * Token is passed in rather than fetched here so callers can share it
 * across requests within the same VU iteration.
 */
export function authHeaders(token) {
  return Object.assign({}, DEFAULT_HEADERS, {
    Authorization: `Bearer ${token}`,
  });
}

/**
 * Return a random element from an array.
 */
export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Return a random integer in [min, max] inclusive.
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random GPS coordinate within a realistic fleet operating area
 * (Nigeria + surrounding West Africa region).
 */
export function randomGPSFix() {
  return {
    lat: +(4.0 + Math.random() * 10.0).toFixed(6),
    lon: +(2.5 + Math.random() * 12.0).toFixed(6),
    alt: +(0 + Math.random() * 500).toFixed(1),
    speed: +(Math.random() * 120).toFixed(1),
    heading: +(Math.random() * 360).toFixed(1),
    accuracy: +(2 + Math.random() * 15).toFixed(1),
    timestamp: new Date(Date.now() - randomInt(0, 5000)).toISOString(),
  };
}

/**
 * Sleep for a jittered duration around a nominal value (±25%).
 */
export function jitteredSleep(nominalSeconds) {
  const jitter = nominalSeconds * 0.25;
  sleep(nominalSeconds - jitter + Math.random() * jitter * 2);
}

// Re-export http so callers can import a single config module.
export { default as http } from 'k6/http';
