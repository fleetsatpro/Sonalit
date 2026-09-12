/**
 * Telemetry fabric — source registry and degradation semantics.
 *
 * The property under test throughout: no source is required. A journey carried
 * by one source is a real journey with lower confidence, never an error, and
 * SecuriSat being absent must never stop the fabric working.
 */

const F = require('../src/utils/telemetryFabric');

/** Minimal health row; overrides express the case under test. */
const row = (over = {}) => ({
  source: 'guardian_gps',
  last_event_at: new Date().toISOString(),
  events_received: 100, events_accepted: 100, events_rejected: 0,
  sequence_gaps: 0, revoked_at: null, state_reason: null,
  ...over,
});

describe('source registry', () => {
  test('every declared source has a priority and an auth mode', () => {
    for (const [id, meta] of Object.entries(F.SOURCES)) {
      expect(meta.id).toBe(id);
      expect(typeof meta.priority).toBe('number');
      expect(['session', 'ingest_key']).toContain(meta.auth);
    }
  });

  test('SecuriSat outranks telematics, which outranks the driver phone', () => {
    expect(F.SOURCES.securisat_elock.priority)
      .toBeGreaterThan(F.SOURCES.device_telematics.priority);
    expect(F.SOURCES.device_telematics.priority)
      .toBeGreaterThan(F.SOURCES.guardian_gps.priority);
  });

  test('machine sources are ingestable; the driver session is not', () => {
    expect(F.INGESTABLE).toContain('device_telematics');
    expect(F.INGESTABLE).toContain('securisat_elock');
    // The driver authenticates with a session token, never an ingest key —
    // otherwise a leaked provider key could impersonate a driver's journey.
    expect(F.INGESTABLE).not.toContain('guardian_gps');
  });

  test('telematics is usable today without SecuriSat being integrated', () => {
    expect(F.SOURCES.device_telematics.integrated).toBe(true);
    expect(F.SOURCES.securisat_elock.integrated).toBe(false);
  });
});

describe('deriveSourceState', () => {
  test('a fresh, clean source is healthy', () => {
    expect(F.deriveSourceState(row()).state).toBe('healthy');
  });

  test('no adapter reads unavailable, NOT offline', () => {
    // The distinction operations depends on: "we were never connected to this"
    // is a different fact from "this went quiet", and collapsing them makes an
    // unintegrated provider look broken.
    const s = F.deriveSourceState(row({ source: 'securisat_elock' }));
    expect(s.state).toBe('unavailable');
  });

  test('a source with no events yet is initializing, not offline', () => {
    expect(F.deriveSourceState(row({ last_event_at: null })).state).toBe('initializing');
  });

  test('late events degrade rather than kill', () => {
    const late = new Date(Date.now() - 200_000).toISOString();   // past LIVE, inside DELAYED
    expect(F.deriveSourceState(row({ last_event_at: late })).state).toBe('degraded');
  });

  test('a long silence is stale, then offline', () => {
    const quiet = new Date(Date.now() - 600_000).toISOString();
    expect(F.deriveSourceState(row({ last_event_at: quiet })).state).toBe('stale');
    const gone = new Date(Date.now() - 4_000_000).toISOString();
    expect(F.deriveSourceState(row({ last_event_at: gone })).state).toBe('offline');
  });

  test('arriving but mostly unusable is degraded, not healthy', () => {
    const s = F.deriveSourceState(row({ events_received: 100, events_rejected: 40 }));
    expect(s.state).toBe('degraded');
    expect(s.reason).toMatch(/rejected/);
  });

  test('a small sample of rejects does not trip degraded', () => {
    // One bad fix out of three is noise, not a failing source.
    expect(F.deriveSourceState(row({ events_received: 3, events_rejected: 1 })).state)
      .toBe('healthy');
  });

  test('delivering again after a gap is recovering, not healthy', () => {
    // The gap happened and the backlog may still be draining; hiding that
    // behind "healthy" throws away the fact that evidence was lost.
    expect(F.deriveSourceState(row({ sequence_gaps: 2 })).state).toBe('recovering');
  });

  test('a revoked credential is revoked, whatever its freshness', () => {
    expect(F.deriveSourceState(row({ revoked_at: new Date().toISOString() })).state)
      .toBe('revoked');
  });

  test('a source is never simultaneously lost and live', () => {
    // §39 invariant, at the code level: one state per evaluation, always.
    for (const over of [{}, { last_event_at: null }, { sequence_gaps: 5 },
                        { revoked_at: new Date().toISOString() },
                        { last_event_at: new Date(Date.now() - 4e6).toISOString() }]) {
      const s = F.deriveSourceState(row(over));
      expect(typeof s.state).toBe('string');
      expect(['initializing','healthy','degraded','stale','offline',
              'recovering','unavailable','revoked','conflicted']).toContain(s.state);
    }
  });
});
