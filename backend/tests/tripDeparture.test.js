/**
 * Departure — the three paths that can establish that a truck has left.
 *
 * The properties under test are the ones an operator would notice if they
 * broke: a departure happens once and keeps its first timestamp, a bad GPS fix
 * cannot dispatch a stationary truck, and a derived departure is dated to when
 * the truck actually left rather than when we noticed.
 */

const D = require('../src/utils/tripDeparture');
const T = require('../src/utils/trackingEngine');
const F = require('../src/utils/telemetryFabric');

/**
 * A database stand-in that answers by SQL shape.
 *
 * `trip` is mutated by the UPDATE exactly as Postgres would: the WHERE clause's
 * `departed_at IS NULL` is what makes the second caller lose, so the fake has
 * to honour it or the idempotency test would pass against a fake that cannot
 * fail.
 */
function fakeDb({ trip, fixes = [], sessionId = 'sess-1' }) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/UPDATE cds_trips/.test(sql)) {
      if (trip.deleted_at || trip.departed_at) return { rows: [] };
      trip.status = trip.status === 'locked' ? 'dispatched' : trip.status;
      trip.departed_at = params[1] || new Date().toISOString();
      trip.departure_source = params[2];
      trip.departed_by = params[3];
      trip.departure_note = params[4];
      return { rows: [{ ...trip }] };
    }
    if (/SELECT \* FROM cds_trips/.test(sql)) return { rows: [{ ...trip }] };
    if (/FROM tracking_sessions/.test(sql)) {
      return { rows: sessionId ? [{ id: sessionId }] : [] };
    }
    if (/FROM tracking_locations/.test(sql)) return { rows: fixes };
    if (/INSERT INTO reconciliation_decisions/.test(sql)) return { rows: [{ id: 'dec-1' }] };
    return { rows: [] };
  };
  db.calls = calls;
  return db;
}

const trip = (over = {}) => ({
  id: 'trip-1', trip_number: 'CDS-1', booking_id: 'bk-1', status: 'locked',
  departed_at: null, deleted_at: null, clamp_lat: -1.3, clamp_lng: 36.8, ...over,
});

/** A fix `metres` due north of the clamp point, `secondsAgo` in the past. */
const fixAt = (id, metres, secondsAgo, anchor = { lat: -1.3, lng: 36.8 }) => ({
  id,
  lat: anchor.lat + metres / 111_320,
  lng: anchor.lng,
  device_time: new Date(Date.now() - secondsAgo * 1000).toISOString(),
});

beforeEach(() => {
  // Realtime is fire-and-forget in production; here it would reach Centrifugo.
  jest.spyOn(T, 'publishTracking').mockImplementation(() => {});
  jest.spyOn(F, 'recordDecision').mockResolvedValue({ id: 'dec-1' });
});
afterEach(() => jest.restoreAllMocks());

describe('markDeparted', () => {
  test('rejects a source it cannot record honestly', async () => {
    await expect(D.markDeparted(fakeDb({ trip: trip() }), 'org', 'trip-1', { source: 'guess' }))
      .rejects.toThrow(/unknown source/);
  });

  test.each(['manual', 'derived', 'operator'])('%s departure moves the trip and is recorded', async (source) => {
    const t = trip();
    const db = fakeDb({ trip: t });
    const { trip: out, already } = await D.markDeparted(db, 'org', 'trip-1', { source });

    expect(already).toBe(false);
    expect(out.status).toBe('dispatched');
    expect(out.departed_at).toBeTruthy();
    // The column exists so "how do we know it left?" is answerable later.
    expect(out.departure_source).toBe(source);
  });

  test('a second mark does not rewrite the first timestamp', async () => {
    const t = trip();
    const db = fakeDb({ trip: t });
    const first = await D.markDeparted(db, 'org', 'trip-1',
      { source: 'manual', at: '2026-09-04T06:10:00.000Z' });
    const second = await D.markDeparted(db, 'org', 'trip-1',
      { source: 'operator', at: '2026-09-04T09:00:00.000Z' });

    expect(first.already).toBe(false);
    expect(second.already).toBe(true);
    // The yard's 06:10 stands. A retry three hours later must not turn a
    // morning departure into a mid-morning one and distort every transit time
    // derived from it.
    expect(second.trip.departed_at).toBe('2026-09-04T06:10:00.000Z');
    expect(second.trip.departure_source).toBe('manual');
  });

  test('a trip already past locked keeps its own status', async () => {
    const t = trip({ status: 'checkpoint' });
    const { trip: out } = await D.markDeparted(fakeDb({ trip: t }), 'org', 'trip-1',
      { source: 'operator' });
    expect(out.status).toBe('checkpoint');
    expect(out.departed_at).toBeTruthy();
  });

  test('a failed audit write never blocks the operational fact', async () => {
    F.recordDecision.mockRejectedValue(new Error('audit table unavailable'));
    const { trip: out, already } = await D.markDeparted(fakeDb({ trip: trip() }), 'org', 'trip-1',
      { source: 'manual' });
    // The truck left whether or not we managed to write down why we think so.
    expect(already).toBe(false);
    expect(out.departed_at).toBeTruthy();
  });

  test('human departures are confirmed, derived ones only probable', async () => {
    await D.markDeparted(fakeDb({ trip: trip() }), 'org', 'trip-1', { source: 'manual' });
    expect(F.recordDecision.mock.calls[0][2].certainty).toBe('confirmed');

    F.recordDecision.mockClear();
    await D.markDeparted(fakeDb({ trip: trip() }), 'org', 'trip-1', { source: 'derived' });
    expect(F.recordDecision.mock.calls[0][2].certainty).toBe('probable');
  });
});

describe('maybeDeriveDeparture', () => {
  test('does nothing for a trip that already departed', async () => {
    const db = fakeDb({ trip: trip() });
    expect(await D.maybeDeriveDeparture(db, 'org', trip({ departed_at: new Date().toISOString() })))
      .toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  test('does nothing without a clamp anchor', async () => {
    // A clamp submitted with location denied is still a valid clamp; there is
    // simply nothing to measure movement against. Manual departure covers it.
    const db = fakeDb({ trip: trip() });
    expect(await D.maybeDeriveDeparture(db, 'org', trip({ clamp_lat: null, clamp_lng: null })))
      .toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  test('a truck shunting inside the yard has not departed', async () => {
    const t = trip();
    const fixes = [fixAt(1, 200, 10), fixAt(2, 150, 200), fixAt(3, 80, 400)];
    expect(await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org', t)).toBeNull();
    expect(t.departed_at).toBeNull();
  });

  test('one wild fix cannot dispatch a stationary truck', async () => {
    const t = trip();
    // The classic yard failure: GPS bounces a kilometre off a container stack
    // and comes straight back. Newest-first, the run breaks at the second fix.
    const fixes = [fixAt(1, 1200, 5), fixAt(2, 90, 60), fixAt(3, 85, 120), fixAt(4, 95, 180)];
    expect(await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org', t)).toBeNull();
    expect(t.departed_at).toBeNull();
  });

  test('two wild fixes ten minutes apart are still not a departure', async () => {
    const t = trip();
    // The case that decides between "break on the first fix inside the radius"
    // and "collect every fix outside it": a truck parked in the yard all
    // morning throws two reflections off the stacks, minutes apart, with good
    // in-yard fixes between them. Counting only the outliers would see 600s of
    // sustained distance and dispatch a truck that never moved.
    const fixes = [fixAt(1, 1200, 5), fixAt(2, 90, 60), fixAt(3, 85, 120),
                   fixAt(4, 900, 600), fixAt(5, 80, 700)];
    expect(await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org', t)).toBeNull();
    expect(t.departed_at).toBeNull();
  });

  test('distance without duration is not yet a departure', async () => {
    const t = trip();
    // Both beyond the radius, but only 30s apart — short of the sustain floor.
    const fixes = [fixAt(1, 900, 5), fixAt(2, 800, 35), fixAt(3, 100, 400)];
    expect(await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org', t)).toBeNull();
    expect(t.departed_at).toBeNull();
  });

  test('sustained movement beyond the radius departs the trip', async () => {
    const t = trip();
    const fixes = [fixAt(1, 4000, 10), fixAt(2, 2500, 90), fixAt(3, 1200, 200), fixAt(4, 100, 400)];
    const result = await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org', t);

    expect(result.already).toBe(false);
    expect(t.status).toBe('dispatched');
    expect(t.departure_source).toBe('derived');
    // Dated to the FIRST fix beyond the radius (the 200s-old one), not to now:
    // recording the moment we noticed would put every departure minutes late.
    expect(t.departed_at).toBe(fixes[2].device_time);
  });

  test('the derivation carries the evidence it used', async () => {
    const t = trip();
    const fixes = [fixAt(11, 4000, 10), fixAt(12, 2500, 90), fixAt(13, 1200, 200), fixAt(14, 100, 400)];
    await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org', t);

    const decision = F.recordDecision.mock.calls[0][2];
    expect(decision.subject).toBe('departure');
    expect(decision.chosenSource).toBe('guardian_gps');
    // Only the fixes actually beyond the radius — the in-yard one is not
    // evidence of leaving.
    expect(decision.supporting).toEqual([11, 12, 13]);
    expect(decision.inputs.radius_m).toBe(D.DEPARTURE_RADIUS_M);
    expect(decision.inputs.fixes_beyond).toBe(3);
  });

  test('a single fix is never enough, however far away', async () => {
    const t = trip();
    expect(await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes: [fixAt(1, 50_000, 10)] }), 'org', t))
      .toBeNull();
  });

  test('derivation loses to a yard mark that got there first', async () => {
    const t = trip({ departed_at: null });
    const db = fakeDb({ trip: t });
    await D.markDeparted(db, 'org', 'trip-1', { source: 'manual', at: '2026-09-04T06:10:00.000Z' });

    const fixes = [fixAt(1, 4000, 10), fixAt(2, 2500, 90), fixAt(3, 1200, 200)];
    // Passing the pre-departure trip object simulates the race: the derivation
    // read the row before the yard's tap landed.
    const result = await D.maybeDeriveDeparture(fakeDb({ trip: t, fixes }), 'org',
      { ...t, departed_at: null });

    expect(result.already).toBe(true);
    expect(t.departed_at).toBe('2026-09-04T06:10:00.000Z');
    expect(t.departure_source).toBe('manual');
  });
});

describe('haversineM', () => {
  test('measures a known distance to within a metre', () => {
    // One degree of latitude at the equator ≈ 110.57 km.
    expect(D.haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
    expect(D.haversineM(-1.3, 36.8, -1.3, 36.8)).toBe(0);
  });
});
