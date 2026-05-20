/**
 * k6 load test — telemetry-ingest-svc
 *
 * Simulates 5000 concurrent IoT device connections batching GPS fixes.
 * Stages: 10-min ramp-up → 20-min steady state → 5-min ramp-down.
 *
 * Run:
 *   k6 run --env BASE_URL=https://api.sonalit.io \
 *           --env K6_CLIENT_ID=<id> \
 *           --env K6_CLIENT_SECRET=<secret> \
 *           infra/k6/telemetry-ingest.js
 */

import http from 'k6/http';
import { check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, randomGPSFix, jitteredSleep, randomInt } from './config.js';

export const options = {
  scenarios: {
    telemetry_batch: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10m', target: 5000 },
        { duration: '20m', target: 5000 },
        { duration: '5m',  target: 0 },
      ],
      gracefulRampDown: '60s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed:   ['rate<0.01'],
    telemetry_batch_errors: ['count<100'],
  },
};

const batchErrors   = new Counter('telemetry_batch_errors');
const batchDuration = new Trend('telemetry_batch_duration', true);
const acceptRate    = new Rate('telemetry_batch_accept_rate');

/** Build a realistic telemetry batch payload for one device. */
function buildBatch(deviceId) {
  const fixes = [];
  for (let i = 0; i < 10; i++) {
    fixes.push(randomGPSFix());
  }
  return {
    device_id:   deviceId,
    protocol:    'v4',
    sequence:    randomInt(1, 1_000_000),
    fixes,
    metadata: {
      firmware:   '4.2.1',
      signal_rssi: randomInt(-90, -40),
      battery_pct: randomInt(10, 100),
    },
  };
}

export default function () {
  const deviceId = `dev-${__VU}-${randomInt(1000, 9999)}`;

  group('telemetry batch ingest', () => {
    const payload = JSON.stringify(buildBatch(deviceId));
    const headers = Object.assign({}, DEFAULT_HEADERS, {
      'X-Device-ID': deviceId,
      'X-Protocol-Version': '4',
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/v4/telemetry/batch`, payload, {
      headers,
      timeout: '5s',
      tags: { endpoint: 'telemetry_batch' },
    });
    batchDuration.add(Date.now() - start);

    const ok = check(res, {
      'status is 202': (r) => r.status === 202,
      'response has batch_id': (r) => {
        try {
          return JSON.parse(r.body).batch_id !== undefined;
        } catch {
          return false;
        }
      },
      'response time < 100ms': (r) => r.timings.duration < 100,
    });

    acceptRate.add(res.status === 202);

    if (!ok || res.status !== 202) {
      batchErrors.add(1);
    }
  });

  jitteredSleep(1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const failRate = data.metrics.http_req_failed.values.rate;

  console.log(`\n=== Telemetry Ingest Summary ===`);
  console.log(`p(95) latency : ${p95 ? p95.toFixed(2) : 'N/A'}ms  (threshold <100ms)`);
  console.log(`Failure rate  : ${failRate ? (failRate * 100).toFixed(3) : 'N/A'}%  (threshold <1%)`);
  console.log(`Batch errors  : ${data.metrics.telemetry_batch_errors?.values?.count ?? 0}`);

  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
