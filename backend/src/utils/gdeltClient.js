'use strict';

/**
 * Shared GDELT client for Sonalit intelligence collectors.
 *
 * GDELT sometimes returns HTTP 200 with a plain-text query rejection or
 * throttling message. Treating that body as JSON produces an opaque parse
 * error; treating it as an empty result would falsely report a healthy source.
 *
 * The queue serializes callers in this Node process, enforces a bounded request
 * cadence, validates the response contract, and applies one shared cooldown
 * across collection, regional, and specialist-mesh paths.
 */
const MIN_REQUEST_INTERVAL_MS = 15_000;
const COOLDOWN_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

let lastRequestAt = 0;
let cooldownUntil = 0;
let requestTail = Promise.resolve();

function failure(message, failureClass, fields = {}) {
  const error = new Error(message);
  error.failureClass = failureClass;
  Object.assign(error, fields);
  return error;
}

function isRateLimitNotice(body) {
  return /\b(rate.?limit(?:ed|ing)?|too many requests|request quota|query quota|slow down|please wait|try again later|queries per second|requests per second)\b/i.test(String(body || ''));
}

async function readResponseText(response) {
  const contentType = String(response?.headers?.get?.('content-type') || 'unknown')
    .split(';')[0].trim().toLowerCase().slice(0, 100);
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw failure('GDELT response exceeded the configured body limit', 'upstream_protocol', {
      upstreamStatus: Number(response?.status || 0),
      upstreamContentType: contentType,
    });
  }

  let body;
  try {
    body = await response.text();
  } catch (_) {
    throw failure('GDELT response body could not be read', 'upstream_protocol', {
      upstreamStatus: Number(response?.status || 0),
      upstreamContentType: contentType,
    });
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    throw failure('GDELT response exceeded the configured body limit', 'upstream_protocol', {
      upstreamStatus: Number(response?.status || 0),
      upstreamContentType: contentType,
    });
  }
  return { body, contentType };
}

async function inRequestQueue(fn) {
  const previous = requestTail;
  let release;
  requestTail = new Promise(resolve => { release = resolve; });
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

async function fetchGdeltJson(url, options = {}) {
  return inRequestQueue(async () => {
    if (Date.now() < cooldownUntil) {
      throw failure('GDELT cooldown active after a previous provider failure', 'cooldown', {
        retryAt: cooldownUntil,
      });
    }

    const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    if (Date.now() < cooldownUntil) {
      throw failure('GDELT cooldown active after a previous provider failure', 'cooldown', {
        retryAt: cooldownUntil,
      });
    }

    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15_000));
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;
    if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);

    lastRequestAt = Date.now();
    try {
      let response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (error) {
        throw failure(
          'GDELT request failed: ' + (error?.name === 'TimeoutError' ? 'timeout' : 'network error'),
          'upstream_network',
        );
      }

      const status = Number(response?.status || 0);
      if (status === 429) {
        throw failure('GDELT rate limited; circuit opened', 'rate_limited', { upstreamStatus: status });
      }
      if (!response?.ok) {
        throw failure('GDELT HTTP ' + (status || 'unknown'), 'upstream_http', { upstreamStatus: status });
      }

      const { body, contentType } = await readResponseText(response);
      let data;
      try {
        data = JSON.parse(body);
      } catch (_) {
        const statusClass = isRateLimitNotice(body) ? 'rate_limited' : 'upstream_protocol';
        const message = statusClass === 'rate_limited'
          ? 'GDELT rate limited; circuit opened'
          : 'GDELT returned a non-JSON response (HTTP ' + status + ', content-type ' + contentType + ')';
        throw failure(message, statusClass, { upstreamStatus: status, upstreamContentType: contentType });
      }

      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.articles)) {
        throw failure('GDELT JSON response did not contain an articles array', 'upstream_protocol', {
          upstreamStatus: status,
          upstreamContentType: contentType,
        });
      }
      return data;
    } catch (error) {
      // Never include upstream response text in logs/errors; it is untrusted input.
      cooldownUntil = Math.max(cooldownUntil, Date.now() + COOLDOWN_MS);
      throw error;
    }
  });
}

function _resetGdeltStateForTests() {
  lastRequestAt = 0;
  cooldownUntil = 0;
  requestTail = Promise.resolve();
}

module.exports = {
  MIN_REQUEST_INTERVAL_MS,
  COOLDOWN_MS,
  MAX_RESPONSE_BYTES,
  fetchGdeltJson,
  _resetGdeltStateForTests,
};
