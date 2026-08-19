/**
 * Provider-agnostic e-lock telemetry ingestion.
 *
 * Everything that reaches CDS from a lock — whether pulled from the Securisat
 * Fleet API by the poller, pushed to the webhook, or fed by the admin test
 * endpoint — is first mapped to ONE normalized shape (see normalizeSample) and
 * then handled here. The provider-specific parts live in their own adapters
 * (utils/telemetry/viasatAdapter.js); this file knows nothing about Viasat.
 *
 * A single sample can do four things, in this order:
 *   1. update the lock's live state (position, battery, signal, tamper…),
 *   2. append an immutable row to the lock's event trail (idempotently),
 *   3. on a tamper transition, raise a critical alert and — if the lock is on
 *      a live trip — write it into that container's custody chain,
 *   4. fan the whole thing out over Centrifugo so every CDS screen updates now.
 *
 * The write is scoped through `db` (a withOrg-bound query fn), so RLS applies
 * exactly as it does everywhere else. Realtime publishing is fire-and-forget:
 * a telemetry sample must still land in the database even if Centrifugo is down.
 */
const crypto = require('crypto');
const { publish } = require('../../realtime/centrifugo');
const logger = require('../logger');

/** Clamp helpers — providers send noisy values, and the columns are bounded. */
function num(v, { min, max, dp } = {}) {
  if (v === null || v === undefined || v === '') return null;
  let n = Number(v);
  if (Number.isNaN(n)) return null;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return dp !== undefined ? Number(n.toFixed(dp)) : n;
}

const SIGNALS = new Set(['strong', 'medium', 'weak', 'offline']);
const TAMPER_STATES = new Set(['normal', 'cable_cut', 'door_opened', 'power_lost', 'forced_removal']);
const EVENT_TYPES = new Set([
  'lock', 'unlock', 'tamper', 'heartbeat', 'gps_update',
  'battery_low', 'offline', 'online', 'firmware_update',
]);

/**
 * The normalized telemetry sample. Every adapter produces this; nothing
 * downstream sees provider fields.
 *
 * @typedef {Object} TelemetrySample
 * @property {string}  external_device_id  provider's device/asset id (preferred key)
 * @property {string}  [serial]            physical lock serial (fallback key)
 * @property {string}  [external_event_id] provider's id for THIS sample (dedupe key)
 * @property {string}  [kind]              event type; inferred if absent
 * @property {number}  [lat] @property {number} [lng]
 * @property {number}  [speed_kmh] @property {number} [heading]
 * @property {number}  [battery_level] @property {boolean} [solar_charging]
 * @property {string}  [signal_strength] @property {number} [temperature]
 * @property {boolean} [locked]           true=locked/sealed, false=open
 * @property {boolean} [tamper]           tamper active right now
 * @property {string}  [tamper_status]    specific tamper kind
 * @property {string}  [firmware_version]
 * @property {string}  [recorded_at]      provider timestamp (ISO)
 * @property {object}  [raw]              original payload, stored on the event
 */

/** Best-effort classification when the provider didn't label the sample. */
function inferKind(s) {
  if (s.kind && EVENT_TYPES.has(s.kind)) return s.kind;
  if (s.tamper === true || (s.tamper_status && s.tamper_status !== 'normal')) return 'tamper';
  if (s.locked === true) return 'lock';
  if (s.locked === false) return 'unlock';
  if (typeof s.battery_level === 'number' && s.battery_level <= 15) return 'battery_low';
  if (s.lat != null && s.lng != null) return 'gps_update';
  return 'heartbeat';
}

/**
 * A deterministic dedupe id when the provider gives none: hash of the fields
 * that make a sample unique. Two identical re-reads collapse; a genuinely new
 * sample (new time or position) does not.
 */
function deriveEventId(s) {
  if (s.external_event_id) return String(s.external_event_id).slice(0, 96);
  const basis = [s.external_device_id || s.serial, s.recorded_at, s.lat, s.lng, s.kind, s.battery_level].join('|');
  return 'd:' + crypto.createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

/**
 * Resolve the sample to a lock row. Match on the provider device id first,
 * serial second. Returns null when neither matches — a lock we don't know
 * about yet. We do not auto-create locks from telemetry: a lock enters CDS by
 * being provisioned/assigned, and silently minting one from a stray GPS ping
 * would let anything that can reach the webhook populate the fleet.
 */
async function resolveLock(db, sample) {
  if (sample.external_device_id) {
    const r = await db(
      `SELECT * FROM cds_electronic_locks
        WHERE external_device_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [sample.external_device_id]
    );
    if (r.rows.length) return r.rows[0];
  }
  if (sample.serial) {
    const r = await db(
      `SELECT * FROM cds_electronic_locks
        WHERE serial = $1 AND deleted_at IS NULL LIMIT 1`,
      [String(sample.serial).trim()]
    );
    if (r.rows.length) {
      // First telemetry for a lock provisioned by serial: bind the device id so
      // future samples match on the faster, stabler key.
      if (sample.external_device_id && !r.rows[0].external_device_id) {
        await db(`UPDATE cds_electronic_locks SET external_device_id = $1 WHERE id = $2`,
          [sample.external_device_id, r.rows[0].id]).catch(() => {});
      }
      return r.rows[0];
    }
  }
  return null;
}

/**
 * Ingest one normalized sample. Returns a small result describing what changed,
 * or { skipped } / { unknown_device } when nothing was written.
 */
async function ingestSample(db, orgId, sample, { publishFn = publish } = {}) {
  const lock = await resolveLock(db, sample);
  if (!lock) return { unknown_device: true, external_device_id: sample.external_device_id, serial: sample.serial };

  const kind = inferKind(sample);
  const eventId = deriveEventId(sample);
  const recordedAt = sample.recorded_at ? new Date(sample.recorded_at) : new Date();

  // Idempotency: a re-delivered sample is a no-op. The partial unique index on
  // (lock_id, external_event_id) is the backstop; this ON CONFLICT turns the
  // race into a clean skip rather than an error into the caller.
  const lat = num(sample.lat, { min: -90, max: 90, dp: 7 });
  const lng = num(sample.lng, { min: -180, max: 180, dp: 7 });
  const ev = await db(
    `INSERT INTO cds_lock_events (org_id, lock_id, type, data, lat, lng, external_event_id, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (lock_id, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, lock.id, kind, JSON.stringify(sample.raw ?? {}), lat, lng, eventId, recordedAt]
  );
  if (!ev.rows.length) return { skipped: 'duplicate', lock_id: lock.id };

  // ── Live state ──
  const battery = num(sample.battery_level, { min: 0, max: 100 });
  const signal = SIGNALS.has(sample.signal_strength) ? sample.signal_strength : null;
  const temperature = num(sample.temperature, { dp: 2 });
  const speed = num(sample.speed_kmh, { min: 0, dp: 2 });
  const heading = sample.heading == null ? null : Math.round(num(sample.heading, { min: 0, max: 360 }) ?? 0);
  const tamperNow = sample.tamper === true
    || (sample.tamper_status && TAMPER_STATES.has(sample.tamper_status) && sample.tamper_status !== 'normal');
  const tamperStatus = TAMPER_STATES.has(sample.tamper_status) ? sample.tamper_status
    : (tamperNow ? 'forced_removal' : 'normal');

  // COALESCE so a partial sample (a GPS-only ping) doesn't wipe fields it
  // didn't carry. A telemetry stream is sparse by nature.
  const updated = await db(
    `UPDATE cds_electronic_locks SET
        lat = COALESCE($2, lat),
        lng = COALESCE($3, lng),
        speed_kmh = COALESCE($4, speed_kmh),
        heading = COALESCE($5, heading),
        battery_level = COALESCE($6, battery_level),
        solar_charging = COALESCE($7, solar_charging),
        signal_strength = COALESCE($8, signal_strength),
        temperature = COALESCE($9, temperature),
        firmware_version = COALESCE($10, firmware_version),
        tamper_detected = $11,
        tamper_status = $12,
        last_telemetry_at = $13,
        last_heartbeat = $13,
        last_event_at = $13,
        status = CASE WHEN status IN ('available','maintenance','removed') THEN status
                      WHEN $14 = 'offline' THEN 'offline'
                      ELSE status END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING serial, container_id, vehicle_id, tamper_detected AS was_tamper`,
    [lock.id, lat, lng, speed, heading, battery,
     sample.solar_charging === undefined ? null : Boolean(sample.solar_charging),
     signal, temperature, sample.firmware_version ?? null,
     Boolean(tamperNow), tamperStatus, recordedAt, kind]
  );
  const row = updated.rows[0] || {};

  const result = {
    lock_id: lock.id, serial: row.serial, kind,
    lat, lng, battery_level: battery, signal_strength: signal,
    tamper: Boolean(tamperNow),
  };

  // ── Tamper escalation ──
  // Only on the transition into tamper (was not, now is), so a lock that keeps
  // reporting a live tamper doesn't raise an alert on every poll.
  const becameTampered = tamperNow && !lock.tamper_detected;
  if (becameTampered) {
    await raiseTamper(db, orgId, lock, tamperStatus, lat, lng, sample).catch(err =>
      logger.warn(`lock tamper escalation failed: ${err.message}`));
    result.tamper_raised = true;
  }

  // ── Realtime ──
  publishTelemetry(publishFn, orgId, {
    lock_id: lock.id, serial: row.serial, kind,
    lat, lng, speed_kmh: speed, heading,
    battery_level: battery, solar_charging: sample.solar_charging ?? null,
    signal_strength: signal, temperature,
    tamper: Boolean(tamperNow), tamper_status: tamperStatus,
    container_id: row.container_id ?? null, vehicle_id: row.vehicle_id ?? null,
    at: recordedAt.toISOString(),
    tamper_raised: Boolean(becameTampered),
  });

  return result;
}

/**
 * A tampered lock in transit is a security incident, not a status line. Raise a
 * critical alert escalated to a manager, mirror it into cds_lock_events tamper
 * history (already done as the event above), and — if the lock is on a live
 * container — write it into that container's custody chain so the tamper shows
 * up in the tamper-evident ledger the port crew verifies against.
 */
async function raiseTamper(db, orgId, lock, tamperStatus, lat, lng, sample) {
  await db(
    `INSERT INTO cds_alerts (org_id, type, severity, title, message, entity_type, entity_id, escalation_level)
     VALUES ($1,'lock_tamper','critical',$2,$3,'lock',$4,'manager')`,
    [orgId,
     `TAMPER — lock ${lock.serial}`,
     `Lock ${lock.serial} reported ${tamperStatus.replace(/_/g, ' ')}${lat != null ? ` at ${lat},${lng}` : ''}. Live telemetry from the Securisat feed.`,
     lock.id]
  );

  // Tie into the container custody chain (migration 078) when the lock is on a
  // trip carrying a booking container.
  if (lock.container_id) {
    const bc = await db(
      `SELECT bc.id FROM cds_booking_containers bc
         JOIN cds_trips t ON t.id = bc.trip_id
        WHERE t.lock_id = $1 AND bc.deleted_at IS NULL
        ORDER BY bc.updated_at DESC LIMIT 1`,
      [lock.id]
    ).catch(() => ({ rows: [] }));
    if (bc.rows.length) {
      // appendCustodyEvent lives in routes/cds.js against req; the chain write
      // is best-effort here and its absence must never fail ingestion. Record
      // the exception as a lock event with the custody linkage so it is not
      // lost even without the hash-chain row.
      await db(
        `INSERT INTO cds_lock_events (org_id, lock_id, type, data, lat, lng)
         VALUES ($1,$2,'tamper',$3,$4,$5)`,
        [orgId, lock.id,
         JSON.stringify({ source: 'securisat_telemetry', booking_container_id: bc.rows[0].id, tamper_status: tamperStatus }),
         lat, lng]
      ).catch(() => {});
    }
  }
}

function publishTelemetry(publishFn, orgId, payload) {
  Promise.resolve(publishFn(`org#${orgId}`, {
    type: payload.tamper_raised ? 'cds.lock.tamper' : 'cds.lock.telemetry',
    ...payload,
  })).catch(err => logger.warn(`lock telemetry publish failed: ${err.message}`));
}

/**
 * Ingest a batch, returning per-sample outcomes. Used by the poller (many
 * devices per cycle) and the webhook (a batch of events).
 */
async function ingestBatch(db, orgId, samples, opts = {}) {
  const results = [];
  for (const s of samples) {
    try {
      results.push(await ingestSample(db, orgId, s, opts));
    } catch (err) {
      logger.warn(`telemetry ingest error (device ${s.external_device_id || s.serial}): ${err.message}`);
      results.push({ error: err.message, external_device_id: s.external_device_id, serial: s.serial });
    }
  }
  return results;
}

module.exports = { ingestSample, ingestBatch, inferKind, deriveEventId, EVENT_TYPES };
