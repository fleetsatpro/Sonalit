/**
 * Securisat / Viasat Connect Fleet API adapter — THE ONLY FILE that knows the
 * provider's wire format.
 *
 *   Platform: https://dev.viasatconnect.be/fleet/  (Securysat Fleet API)
 *
 * Everything provider-specific is contained here: the HTTP client, the auth
 * header, and the field mapping from their payloads to the normalized
 * TelemetrySample shape (utils/telemetry/ingest.js). To point this at a
 * different provider, or to correct it against Securisat's real API once we
 * have the docs/credentials, this is the single file to change — nothing
 * downstream references a Viasat field name.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ FIELD MAPPING IS PROVISIONAL. The endpoint paths and JSON keys below   │
 * │ are the plausible shape of a fleet telematics REST API, written so the   │
 * │ pipeline is complete and testable end to end. When the Securisat docs or │
 * │ a sample payload are available, correct mapPosition/mapDevice/mapAlarm   │
 * │ and the endpoint paths — and nothing else needs to move.                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Secrets come from env, never the database:
 *   SECURISAT_BASE_URL   e.g. https://dev.viasatconnect.be/fleet/api
 *   SECURISAT_API_KEY    bearer/api key issued by Securisat
 *   SECURISAT_WEBHOOK_SECRET  HMAC secret for pushed events (webhook path)
 */
const logger = require('../logger');

const DEFAULT_BASE_URL = process.env.SECURISAT_BASE_URL || 'https://dev.viasatconnect.be/fleet/api';
const TIMEOUT_MS = 15_000;

function isConfigured() {
  return Boolean(process.env.SECURISAT_API_KEY);
}

/** First non-null among several possible key spellings — providers rename fields. */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

/** Map the provider's signal metric (often 0-31 or 0-100) to our enum. */
function mapSignal(raw) {
  const v = pick(raw, 'signal', 'signalStrength', 'gsmSignal', 'rssi', 'csq');
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) {
    const s = String(v).toLowerCase();
    return ['strong', 'medium', 'weak', 'offline'].includes(s) ? s : undefined;
  }
  // Assume a 0-31 CSQ-style scale; collapse anything larger onto 0-100.
  const pct = n > 31 ? n : (n / 31) * 100;
  if (pct <= 0) return 'offline';
  if (pct < 33) return 'weak';
  if (pct < 66) return 'medium';
  return 'strong';
}

/** Their tamper/alarm label → our tamper_status enum. */
function mapTamperStatus(raw) {
  const v = String(pick(raw, 'tamperStatus', 'alarmType', 'alarm', 'event') || '').toLowerCase();
  if (!v) return undefined;
  if (v.includes('cable')) return 'cable_cut';
  if (v.includes('door') || v.includes('open')) return 'door_opened';
  if (v.includes('power') || v.includes('battery removed')) return 'power_lost';
  if (v.includes('remov') || v.includes('forced') || v.includes('tamper')) return 'forced_removal';
  return undefined;
}

/**
 * A device/position record from the fleet API → normalized sample.
 * Handles both a "device with embedded lastPosition" shape and a flat
 * position record, since fleet APIs vary.
 */
function mapPosition(raw) {
  const pos = raw.lastPosition || raw.position || raw;
  const tamperStatus = mapTamperStatus(raw) || mapTamperStatus(pos);
  const lockedRaw = pick(raw, 'locked', 'lockState', 'sealed');
  return {
    external_device_id: String(pick(raw, 'deviceId', 'id', 'unitId', 'assetId', 'imei') ?? ''),
    serial: pick(raw, 'serial', 'serialNumber', 'name', 'label'),
    external_event_id: pick(pos, 'positionId', 'eventId', 'messageId', 'id'),
    lat: pick(pos, 'lat', 'latitude', 'y'),
    lng: pick(pos, 'lng', 'lon', 'longitude', 'x'),
    speed_kmh: pick(pos, 'speed', 'speedKmh', 'velocity'),
    heading: pick(pos, 'heading', 'course', 'bearing', 'direction'),
    battery_level: pick(raw, 'battery', 'batteryLevel', 'batteryPercent') ?? pick(pos, 'battery'),
    solar_charging: (() => {
      const v = pick(raw, 'solarCharging', 'charging', 'solar');
      return v === undefined ? undefined : Boolean(v);
    })(),
    signal_strength: mapSignal(raw) ?? mapSignal(pos),
    temperature: pick(raw, 'temperature', 'temp') ?? pick(pos, 'temperature'),
    firmware_version: pick(raw, 'firmware', 'firmwareVersion', 'fwVersion'),
    locked: lockedRaw === undefined ? undefined
      : (typeof lockedRaw === 'string' ? /lock|seal|closed/i.test(lockedRaw) : Boolean(lockedRaw)),
    tamper: tamperStatus ? true : undefined,
    tamper_status: tamperStatus,
    recorded_at: pick(pos, 'timestamp', 'time', 'gpsTime', 'recordedAt', 'fixTime')
      || pick(raw, 'timestamp', 'lastUpdate'),
    raw,
  };
}

/** A pushed alarm/event (webhook) → normalized sample. */
function mapAlarm(raw) {
  const base = mapPosition(raw);
  const tamperStatus = mapTamperStatus(raw) || base.tamper_status;
  return {
    ...base,
    kind: tamperStatus ? 'tamper' : undefined,
    tamper: tamperStatus ? true : base.tamper,
    tamper_status: tamperStatus,
    external_event_id: pick(raw, 'eventId', 'alarmId', 'messageId', 'id') || base.external_event_id,
  };
}

async function httpGet(path, { baseUrl } = {}) {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        // Provisional: some Securisat/Viasat deployments use a bearer token,
        // others an X-Api-Key. Send both; the wrong one is ignored.
        Authorization: `Bearer ${process.env.SECURISAT_API_KEY}`,
        'X-Api-Key': process.env.SECURISAT_API_KEY,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Securisat ${resp.status} on ${path}: ${body.slice(0, 200)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pull current telemetry for every device on an account.
 *
 * Returns normalized samples. The provider's list shape (array vs
 * { data: [...] } vs { devices: [...] }) is unwrapped here so the caller only
 * ever sees samples.
 */
async function fetchDeviceTelemetry({ baseUrl, accountId } = {}) {
  if (!isConfigured()) throw Object.assign(new Error('SECURISAT_API_KEY not set'), { notConfigured: true });
  const q = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
  const json = await httpGet(`/devices${q}`, { baseUrl });
  const list = Array.isArray(json) ? json : (json.data || json.devices || json.items || json.results || []);
  return list.map(mapPosition).filter(s => s.external_device_id || s.serial);
}

module.exports = {
  isConfigured,
  fetchDeviceTelemetry,
  mapPosition,
  mapAlarm,
  mapSignal,
  mapTamperStatus,
  DEFAULT_BASE_URL,
};
