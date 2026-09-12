/**
 * Hybrid Tracking engine — pure-logic unit tests.
 *
 * These cover the decisions that decide what an operator sees on the command
 * board: whether a vehicle counts as LIVE, how much to trust its position, which
 * source wins when two disagree, and which telemetry is physically impossible.
 * Getting any of them wrong shows a lorry somewhere it is not, which is the
 * failure mode the whole multi-source design exists to prevent.
 */
const T = require('../src/utils/trackingEngine');

describe('tokens', () => {
  it('issues long, unique, non-sequential tokens', () => {
    const a = T.newToken();
    const b = T.newToken();
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically and irreversibly', () => {
    const token = T.newToken();
    expect(T.sha256(token)).toBe(T.sha256(token));
    expect(T.sha256(token)).toHaveLength(64);
    expect(T.sha256(token)).not.toContain(token);
  });
});

describe('computeHealth', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  const at = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();

  it('is not_started until a first fix exists', () => {
    expect(T.computeHealth({ status: 'awaiting_location', first_location_at: null }, now)).toBe('not_started');
  });

  it('grades freshness live → delayed → signal_lost → offline', () => {
    const base = { status: 'active', first_location_at: at(600) };
    expect(T.computeHealth({ ...base, last_location_at: at(10) }, now)).toBe('live');
    expect(T.computeHealth({ ...base, last_location_at: at(200) }, now)).toBe('delayed');
    expect(T.computeHealth({ ...base, last_location_at: at(900) }, now)).toBe('signal_lost');
    expect(T.computeHealth({ ...base, last_location_at: at(5000) }, now)).toBe('offline');
  });

  it('never reports a finished journey as live', () => {
    expect(T.computeHealth(
      { status: 'completed', first_location_at: at(600), last_location_at: at(1) }, now
    )).toBe('completed');
  });
});

describe('normaliseCapability', () => {
  it('pins a web runtime to unsupported even when it claims otherwise', () => {
    // The non-negotiable: a browser page cannot hold location once backgrounded,
    // so no client claim may talk Sonalit into showing background tracking.
    expect(T.normaliseCapability({ runtime: 'web', platform: 'android', backgroundStatus: 'granted' }))
      .toEqual({ runtime: 'web', platform: 'android', background_status: 'unsupported' });
  });

  it('accepts granted only from the native runtime', () => {
    expect(T.normaliseCapability({ runtime: 'capacitor', platform: 'android', backgroundStatus: 'granted' }))
      .toEqual({ runtime: 'capacitor', platform: 'android', background_status: 'granted' });
  });

  it('keeps a native shell under-claim rather than inflating it', () => {
    // Capacitor without the background plugin genuinely cannot background-track.
    expect(T.normaliseCapability({ runtime: 'capacitor', platform: 'android', backgroundStatus: 'unsupported' }).background_status)
      .toBe('unsupported');
    expect(T.normaliseCapability({ runtime: 'capacitor', platform: 'ios', backgroundStatus: 'denied' }).background_status)
      .toBe('denied');
  });

  it('never infers capability from an unknown runtime or a bogus value', () => {
    expect(T.normaliseCapability({ runtime: 'nonsense', platform: 'x', backgroundStatus: 'granted' }))
      .toEqual({ runtime: 'unknown', platform: 'unknown', background_status: 'unknown' });
    expect(T.normaliseCapability({ runtime: 'capacitor', platform: 'android', backgroundStatus: 'wat' }).background_status)
      .toBe('unknown');
  });
});

describe('capabilityOf', () => {
  it('keeps tracking status and background capability independent', () => {
    // The case operations must be able to see: telemetry is arriving right now,
    // and it will stop the moment the driver locks the phone.
    const cap = T.capabilityOf({
      runtime: 'web', platform: 'android', background_status: 'unsupported',
      permission_status: 'granted', location_services_enabled: true,
    }, 'live');

    expect(cap.tracking_status).toBe('live');
    expect(cap.background_status).toBe('unsupported');
    expect(cap.background_reliable).toBe(false);
  });

  it('marks background reliable only for a native runtime that confirmed it', () => {
    expect(T.capabilityOf({ runtime: 'capacitor', background_status: 'granted' }, 'live').background_reliable).toBe(true);
    // Granted claimed against a web runtime is not reliability.
    expect(T.capabilityOf({ runtime: 'web', background_status: 'granted' }, 'live').background_reliable).toBe(false);
    expect(T.capabilityOf({ runtime: 'capacitor', background_status: 'denied' }, 'live').background_reliable).toBe(false);
  });
});

describe('computeConfidence', () => {
  it('is high for a fresh, accurate fix', () => {
    expect(T.computeConfidence({ accuracyM: 10, ageSeconds: 20, sourceCount: 1 })).toBe('high');
  });

  it('drops to medium as accuracy or age degrades', () => {
    expect(T.computeConfidence({ accuracyM: 150, ageSeconds: 200 })).toBe('medium');
  });

  it('drops to low when sources disagree beyond the threshold', () => {
    expect(T.computeConfidence({ accuracyM: 10, ageSeconds: 20, sourceCount: 2, agreementKm: 25 })).toBe('low');
  });

  it('is unknown without a usable age', () => {
    expect(T.computeConfidence({ accuracyM: 10, ageSeconds: null })).toBe('unknown');
  });
});

describe('validateFix', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  const iso = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();

  it('accepts an ordinary fix', () => {
    const v = T.validateFix(null, { lat: -1.29, lng: 36.82, accuracy_m: 12, device_time: iso(5) }, now);
    expect(v.quality).toBe('good');
  });

  it('rejects impossible coordinates', () => {
    expect(T.validateFix(null, { lat: 999, lng: 0, device_time: iso(5) }, now).quality).toBe('rejected');
  });

  it('rejects timestamps from the future', () => {
    const v = T.validateFix(null, { lat: -1.29, lng: 36.82, device_time: new Date(now + 600_000).toISOString() }, now);
    expect(v).toMatchObject({ quality: 'rejected', anomaly_reason: 'future_timestamp' });
  });

  it('rejects a jump no vehicle could make', () => {
    // Nairobi → Mombasa (~440 km) in one minute.
    const prev = { lat: -1.29, lng: 36.82, device_time: iso(60) };
    const v = T.validateFix(prev, { lat: -4.04, lng: 39.66, device_time: iso(0) }, now);
    expect(v.quality).toBe('rejected');
    expect(v.anomaly_reason).toMatch(/impossible_speed/);
  });

  it('flags poor accuracy as degraded rather than discarding it', () => {
    const v = T.validateFix(null, { lat: -1.29, lng: 36.82, accuracy_m: 900, device_time: iso(5) }, now);
    expect(v).toMatchObject({ quality: 'degraded', anomaly_reason: 'poor_accuracy' });
  });
});

describe('reconcile', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  const iso = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();

  it('prefers the higher-priority source when both are fresh', () => {
    const chosen = T.reconcile([
      { source: 'guardian_gps', lat: -1.29, lng: 36.82, device_time: iso(5), quality: 'good' },
      { source: 'securisat_elock', lat: -1.29, lng: 36.82, device_time: iso(5), quality: 'good' },
    ], now);
    expect(chosen.source).toBe('securisat_elock');
  });

  it('falls back to a fresh lower-priority source when the primary goes stale', () => {
    // This is the redundancy principle: SecuriSat dropping out must not stop
    // tracking, it must hand over to Guardian GPS.
    const chosen = T.reconcile([
      { source: 'securisat_elock', lat: -1.29, lng: 36.82, device_time: iso(4000), quality: 'good' },
      { source: 'guardian_gps', lat: -1.30, lng: 36.83, device_time: iso(5), quality: 'good' },
    ], now);
    expect(chosen.source).toBe('guardian_gps');
  });

  it('records a discrepancy instead of silently picking one', () => {
    const chosen = T.reconcile([
      { source: 'securisat_elock', lat: -1.29, lng: 36.82, device_time: iso(5), quality: 'good' },
      { source: 'guardian_gps', lat: -1.60, lng: 37.20, device_time: iso(5), quality: 'good' },
    ], now);
    expect(chosen.discrepancy).not.toBeNull();
    expect(chosen.discrepancy.km).toBeGreaterThan(T.thresholds.SOURCE_DISCREPANCY_KM);
    expect(chosen.sourceCount).toBe(2);
  });

  it('ignores rejected telemetry entirely', () => {
    const chosen = T.reconcile([
      { source: 'guardian_gps', lat: -1.29, lng: 36.82, device_time: iso(5), quality: 'rejected' },
    ], now);
    expect(chosen).toBeNull();
  });
});
