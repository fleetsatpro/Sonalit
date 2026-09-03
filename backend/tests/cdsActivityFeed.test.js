/**
 * CDS dispatch log — pure-logic unit tests.
 *
 * The log this builds replaced `cds_activity_feed`, a table the dashboard and
 * the Comms Centre both read and nothing ever wrote to, so the control room
 * reported "no activity" while the yard had containers queued for clamping.
 * These tests pin the properties that made that failure possible or would hide
 * it again: every source actually reaches the merged output, telemetry is kept
 * out of an operator log, ordering is newest-first across sources, and the
 * limit is applied to the merge rather than per source.
 */
const { activityFeed } = require('../src/utils/cdsActivityFeed');

// Stands in for req.db. Routes each query to rows by matching the table it
// reads, and records the SQL so the telemetry exclusion can be asserted.
function fakeDb(rowsByTable) {
  const seen = [];
  const db = async (sql, params) => {
    seen.push({ sql, params });
    const table = ['cds_custody_events', 'cds_lock_events', 'cds_trip_events', 'cds_alerts']
      .find(t => sql.includes(t));
    return { rows: rowsByTable[table] ?? [] };
  };
  db.seen = seen;
  return db;
}

const at = minutesAgo => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const CUSTODY = {
  id: 'c1', created_at: at(16), kind: 'clamped', actor_name: 'Nerbert Lusaka',
  lat: -4.0435, lng: 39.6682, notes: null, seal_number: 'SEAL-9931',
  lock_serial: 'SL-00042', booking_container_id: 'bc1',
  container_number: 'MSCU00042', booking_number: 'TZ_26_09_OB_00042',
};
const LOCK = {
  id: 'l1', created_at: at(15), type: 'lock', lat: -4.0435, lng: 39.6682,
  lock_id: 'lock1', serial: 'SL-00042',
};
const TRIP = {
  id: 't1', created_at: at(12), to_status: 'dispatched', from_status: 'locked',
  actor_name: 'Dispatch Desk', notes: null, lat: null, lng: null,
  trip_id: 'trip1', booking_number: 'TZ_26_09_OB_00042',
};
const ALERT = {
  id: 'a1', created_at: at(2), type: 'lock_tamper', severity: 'critical',
  title: 'Tamper on SL-00042', message: 'Tamper switch tripped in transit',
  entity_type: 'lock', entity_id: 'lock1', acknowledged: false,
};

const allSources = {
  cds_custody_events: [CUSTODY],
  cds_lock_events: [LOCK],
  cds_trip_events: [TRIP],
  cds_alerts: [ALERT],
};

describe('sources', () => {
  it('merges all four sources into one log', async () => {
    const feed = await activityFeed(fakeDb(allSources), 50);
    expect(feed).toHaveLength(4);
    expect(feed.map(i => String(i.id).split(':')[0]).sort())
      .toEqual(['alert', 'custody', 'lock', 'trip']);
  });

  it('namespaces ids by source, so two tables sharing a uuid cannot collide', async () => {
    const sameId = { ...LOCK, id: 'c1' };
    const feed = await activityFeed(
      fakeDb({ ...allSources, cds_lock_events: [sameId] }), 50);
    expect(new Set(feed.map(i => i.id)).size).toBe(feed.length);
  });

  it('leaves heartbeats and GPS pings out of an operator log', async () => {
    const db = fakeDb(allSources);
    await activityFeed(db, 50);
    const lockQuery = db.seen.find(s => s.sql.includes('cds_lock_events'));
    expect(lockQuery.sql).toContain("NOT IN ('heartbeat','gps_update')");
  });

  it('returns an empty log rather than throwing when nothing has happened', async () => {
    await expect(activityFeed(fakeDb({}), 50)).resolves.toEqual([]);
  });
});

describe('ordering and limit', () => {
  it('orders newest first across sources, not per source', async () => {
    const feed = await activityFeed(fakeDb(allSources), 50);
    expect(feed.map(i => i.id)).toEqual(['alert:a1', 'trip:t1', 'lock:l1', 'custody:c1']);
  });

  it('applies the limit to the merge, so one busy source cannot crowd out the rest', async () => {
    // Ten custody rows all older than the single alert: a per-source limit
    // would return ten clamps and drop the alert entirely.
    const custody = Array.from({ length: 10 }, (_, i) => ({
      ...CUSTODY, id: `c${i}`, created_at: at(30 + i),
    }));
    const feed = await activityFeed(
      fakeDb({ ...allSources, cds_custody_events: custody }), 3);
    expect(feed).toHaveLength(3);
    expect(feed[0].id).toBe('alert:a1');
  });

  it('asks each source for at most the limit', async () => {
    const db = fakeDb(allSources);
    await activityFeed(db, 7);
    expect(db.seen).toHaveLength(4);
    for (const { params } of db.seen) expect(params).toEqual([7]);
  });
});

describe('custody entries', () => {
  it('reads as a sentence about a named container, with who and where', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_custody_events: [CUSTODY] }), 50);
    expect(entry.icon).toBe('clamp');
    expect(entry.text).toBe('E-lock clamped on MSCU00042');
    expect(entry.meta).toBe('Nerbert Lusaka · lock SL-00042 · seal SEAL-9931 · -4.0435, 39.6682');
    expect(entry.entity_type).toBe('booking_container');
    expect(entry.entity_id).toBe('bc1');
  });

  it('falls back to the booking when the yard has not entered a container number', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_custody_events: [{ ...CUSTODY, container_number: null }] }), 50);
    expect(entry.text).toBe('E-lock clamped on booking TZ_26_09_OB_00042');
  });

  it('still names the act when neither reference is known', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_custody_events: [{ ...CUSTODY, container_number: null, booking_number: null }] }), 50);
    expect(entry.text).toBe('E-lock clamped on container');
  });

  it('carries an unfamiliar custody kind through instead of dropping the event', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_custody_events: [{ ...CUSTODY, kind: 'resealed' }] }), 50);
    expect(entry.icon).toBe('checkpoint');
    expect(entry.text).toContain('resealed');
  });

  it('omits missing detail rather than printing empty separators', async () => {
    const [entry] = await activityFeed(fakeDb({
      cds_custody_events: [{
        ...CUSTODY, actor_name: null, lock_serial: null, seal_number: null,
        lat: null, lng: null, notes: null,
      }],
    }), 50);
    expect(entry.meta).toBeNull();
  });

  it('keeps a partial position out of the log rather than showing half a fix', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_custody_events: [{ ...CUSTODY, lng: null }] }), 50);
    expect(entry.meta).not.toContain('-4.0435');
  });
});

describe('device, trip and alert entries', () => {
  it('names the lock by serial', async () => {
    const [entry] = await activityFeed(fakeDb({ cds_lock_events: [LOCK] }), 50);
    expect(entry.text).toBe('E-lock SL-00042 locked');
    expect(entry.entity_id).toBe('lock1');
  });

  it('flags a tamper as an alert, not as routine lock traffic', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_lock_events: [{ ...LOCK, type: 'tamper' }] }), 50);
    expect(entry.icon).toBe('alert');
    expect(entry.text).toBe('E-lock SL-00042 reported TAMPER');
  });

  it('describes a trip transition in words, with its booking', async () => {
    const [entry] = await activityFeed(fakeDb({ cds_trip_events: [TRIP] }), 50);
    expect(entry.icon).toBe('depart');
    expect(entry.text).toBe('Trip on booking TZ_26_09_OB_00042 moved to dispatched');
    expect(entry.meta).toBe('Dispatch Desk');
  });

  it('reads a status with underscores as words', async () => {
    const [entry] = await activityFeed(
      fakeDb({ cds_trip_events: [{ ...TRIP, to_status: 'lock_removed' }] }), 50);
    expect(entry.text).toContain('moved to lock removed');
  });

  it('leads an alert with severity and says whether it is still open', async () => {
    const [entry] = await activityFeed(fakeDb({ cds_alerts: [ALERT] }), 50);
    expect(entry.text).toBe('Tamper on SL-00042');
    expect(entry.meta).toBe('CRITICAL · Tamper switch tripped in transit');

    const [ack] = await activityFeed(
      fakeDb({ cds_alerts: [{ ...ALERT, acknowledged: true }] }), 50);
    expect(ack.meta).toContain('acknowledged');
  });
});
