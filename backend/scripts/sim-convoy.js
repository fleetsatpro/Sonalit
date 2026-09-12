#!/usr/bin/env node
/**
 * sim-convoy — QA simulator for the portal Live Security feature.
 *
 * Drives a convoy through GPS pings and alert lifecycle events so QA teams
 * can exercise the security portal without real hardware.
 *
 * Usage:
 *   node sim-convoy.js \
 *     --convoy-id <uuid> \
 *     --org-id    <uuid> \
 *     --token     <operator-jwt> \
 *     [--base-url http://localhost:3000] \
 *     [--scenario all|sos|deviation|stop]
 *
 * Scenarios:
 *   all       — runs sos, deviation, stop in sequence (default)
 *   sos       — security SOS alert: detected → responding → resolved
 *   deviation — geofence deviation: detected → resolved
 *   stop      — mechanical stop: detected → responding → resolved
 */

'use strict';

const https = require('https');
const http  = require('http');

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const CONVOY_ID = arg('--convoy-id', null);
const ORG_ID    = arg('--org-id',    null);
const TOKEN     = arg('--token',     null);
const BASE_URL  = arg('--base-url',  'http://localhost:3000');
const SCENARIO  = arg('--scenario',  'all');

if (!CONVOY_ID || !ORG_ID || !TOKEN) {
  console.error('Usage: node sim-convoy.js --convoy-id <uuid> --org-id <uuid> --token <jwt> [--base-url ...] [--scenario all|sos|deviation|stop]');
  process.exit(1);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const transport = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = transport.request(opts, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(`[sim] ${new Date().toISOString()} ${msg}`); }

// ── GPS ping ──────────────────────────────────────────────────────────────────

// A simple Durban → Johannesburg route approximation
const ROUTE = [
  { lat: -29.857, lng: 31.029 },  // Durban
  { lat: -29.500, lng: 30.400 },
  { lat: -28.800, lng: 29.900 },
  { lat: -28.100, lng: 29.400 },
  { lat: -27.800, lng: 29.000 },
  { lat: -27.100, lng: 28.600 },
  { lat: -26.700, lng: 27.900 },
  { lat: -26.200, lng: 28.040 },  // Johannesburg
];

let routeIdx = 0;

async function ping() {
  const pt = ROUTE[Math.min(routeIdx, ROUTE.length - 1)];
  routeIdx++;
  const res = await request('POST', `/api/v1/gps/ping`, {
    convoy_id: CONVOY_ID,
    org_id:    ORG_ID,
    lat:       pt.lat + (Math.random() - 0.5) * 0.005,
    lng:       pt.lng + (Math.random() - 0.5) * 0.005,
    speed_kmh: 80 + Math.floor(Math.random() * 20),
    heading:   45,
  });
  log(`GPS ping → ${pt.lat.toFixed(3)},${pt.lng.toFixed(3)} (${res.status})`);
}

// ── Alert lifecycle ───────────────────────────────────────────────────────────

async function createAlert(type, severity) {
  const res = await request('POST', `/api/v1/alerts`, {
    convoy_id: CONVOY_ID,
    org_id:    ORG_ID,
    type,
    severity,
    message:   `[SIM] ${type} alert triggered by sim-convoy script`,
  });
  const id = res.body?.data?.id ?? null;
  log(`Alert created type=${type} severity=${severity} id=${id} (${res.status})`);
  return id;
}

async function acknowledgeAlert(alertId) {
  const res = await request(
    'POST',
    `/api/v1/portal/convoy/${CONVOY_ID}/incidents/${alertId}/acknowledge`,
    {},
  );
  log(`Alert acknowledged id=${alertId} (${res.status})`);
}

async function resolveAlert(alertId) {
  const res = await request(
    'POST',
    `/api/v1/portal/convoy/${CONVOY_ID}/incidents/${alertId}/resolve`,
    {},
  );
  log(`Alert resolved id=${alertId} (${res.status})`);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

async function scenarioSOS() {
  log('─── Scenario: SOS ───');
  await ping();
  await sleep(1000);
  const id = await createAlert('security', 'critical');
  log('Client portal will show: ALERT / Security alert — response engaged');
  await sleep(4000);
  await acknowledgeAlert(id);
  log('Client portal will show: MONITORING / Escort responding');
  await sleep(5000);
  await resolveAlert(id);
  log('Client portal will show: SECURE / All secure');
}

async function scenarioDeviation() {
  log('─── Scenario: Route Deviation ───');
  await ping();
  await sleep(1000);
  const id = await createAlert('geofence', 'medium');
  log('Client portal will show: MONITORING / Route deviation detected');
  await sleep(4000);
  await resolveAlert(id);
  log('Client portal will show: SECURE / All secure');
}

async function scenarioStop() {
  log('─── Scenario: Unplanned Stop ───');
  await ping();
  await sleep(1000);
  const id = await createAlert('mechanical', 'medium');
  log('Client portal will show: MONITORING / Unplanned stop');
  await sleep(3000);
  await acknowledgeAlert(id);
  log('Client portal will show: MONITORING / Responding');
  await sleep(4000);
  await resolveAlert(id);
  log('Client portal will show: SECURE / All secure');
}

// ── GPS loop in background ────────────────────────────────────────────────────

async function gpsLoop(count) {
  for (let i = 0; i < count; i++) {
    await ping();
    await sleep(3000);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  log(`Starting convoy simulator. convoy_id=${CONVOY_ID} scenario=${SCENARIO}`);

  // 3 GPS pings before any alert
  for (let i = 0; i < 3; i++) { await ping(); await sleep(1500); }

  if (SCENARIO === 'sos' || SCENARIO === 'all') {
    await scenarioSOS();
    await sleep(3000);
  }
  if (SCENARIO === 'deviation' || SCENARIO === 'all') {
    await scenarioDeviation();
    await sleep(3000);
  }
  if (SCENARIO === 'stop' || SCENARIO === 'all') {
    await scenarioStop();
    await sleep(3000);
  }

  // GPS pings to close the route
  await gpsLoop(3);

  log('Simulation complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
