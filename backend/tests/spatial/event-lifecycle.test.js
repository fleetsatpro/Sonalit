'use strict';

const {
  detectSpatialEvents,
  persistSpatialEvents,
  eventMode,
  eventCanAutoResolve,
} = require('../../src/services/spatial/spatialEvents');

function dbStub() {
  const open = new Map();
  let nextId = 1;
  const calls = [];
  const db = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id,event_key,event_type')) {
      return { rows: Array.from(open.values()).filter(r => r.status === 'open') };
    }
    if (sql.startsWith('INSERT INTO spatial_events')) {
      const eventKey = params[1];
      if (open.has(eventKey) && open.get(eventKey).status === 'open') return { rows: [] };
      const row = {
        id: 'event-' + nextId++, event_key: eventKey, event_type: params[2],
        subject_type: params[3], subject_id: params[4], convoy_id: params[5], status: params[18] || 'open',
      };
      if (row.status === 'open') open.set(eventKey, row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE spatial_events SET status=\'resolved\'') && sql.includes('event_key=$4')) {
      const key = params[3];
      const row = open.get(key);
      if (!row) return { rows: [] };
      row.status = 'resolved';
      open.delete(key);
      return { rows: [{ id: row.id, event_key: key }] };
    }
    if (sql.startsWith('UPDATE spatial_events SET status=\'resolved\'') && sql.includes('id=$4')) {
      const id = params[3];
      const row = Array.from(open.values()).find(x => x.id === id);
      if (!row) return { rows: [] };
      row.status = 'resolved';
      open.delete(row.event_key);
      return { rows: [{ id: row.id, event_key: row.event_key }] };
    }
    if (sql.startsWith('UPDATE spatial_events SET observed_at=')) {
      const key = params[11];
      const row = open.get(key);
      if (!row) return { rows: [] };
      row.confidence = Number(params[3]);
      row.operational_confidence = Number(params[4]);
      row.last_seen_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO alerts')) return { rows: [{ id: 'alert-' + nextId++ }] };
    return { rows: [] };
  });
  db.open = open;
  db.calls = calls;
  return db;
}

describe('spatial event lifecycle', () => {
  test('marks occurrence events resolved while stateful conditions remain open', () => {
    expect(eventMode('POSITION_JUMP')).toBe('occurrence');
    expect(eventMode('TRAFFIC_CLOSURE')).toBe('stateful');
  });

  test('does not permit external event reconciliation without a fresh authoritative layer', () => {
    const unavailable = {
      coverage: { layersUnavailable: ['traffic'], layersPartial: [] },
      layerHealth: [{ layerId: 'traffic', status: 'UNAVAILABLE' }],
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
    };
    const fresh = {
      coverage: { layersUnavailable: [], layersPartial: [] },
      layerHealth: [{ layerId: 'traffic', status: 'LIVE' }],
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
    };
    expect(eventCanAutoResolve(unavailable, 'TRAFFIC_CLOSURE')).toBe(false);
    expect(eventCanAutoResolve(fresh, 'TRAFFIC_CLOSURE')).toBe(true);
  });

  test('allows reconciliation from a fresh empty provider result when it did not fail', () => {
    const context = {
      coverage: { layersUnavailable: [], layersPartial: ['maritime'] },
      layerHealth: [{ layerId: 'maritime', status: 'PARTIAL', coverageComplete: true }],
      providerHealth: { 'kpler-ais': { status: 'PARTIAL', lastErrorClass: null } },
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
      dataHealth: { ok: true, readErrors: [] },
    };
    expect(eventCanAutoResolve(context, 'VESSEL_APPROACHING_DESTINATION', ['kpler:vessel:123'])).toBe(true);
  });

  test('uses the authoritative source provider when sibling traffic feeds are degraded', () => {
    const context = {
      coverage: { layersUnavailable: [], layersPartial: ['traffic'] },
      layerHealth: [{ layerId: 'traffic', status: 'PARTIAL', coverageComplete: false }],
      providerHealth: {
        'tomtom-traffic-incidents': { status: 'LIVE', lastErrorClass: null },
        'mapbox-traffic': { status: 'UNAVAILABLE', lastErrorClass: 'timeout' },
      },
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
      dataHealth: { ok: true, readErrors: [] },
    };
    expect(eventCanAutoResolve(context, 'TRAFFIC_CLOSURE', ['tomtom:traffic-incident:1'])).toBe(true);
  });

  test('updates an existing open event instead of creating a duplicate alert record', async () => {
    const db = dbStub();
    const context = {
      subject: { kind: 'convoy', id: 'c1' },
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
      coverage: { layersUnavailable: [], layersPartial: [] },
      layerHealth: [],
    };
    const event = {
      eventKey: 'TRAFFIC_CLOSURE:vehicle:v1:road-1',
      eventType: 'TRAFFIC_CLOSURE',
      subjectType: 'vehicle',
      subjectId: 'v1',
      convoyId: 'c1',
      confidence: 0.8,
      operationalConfidence: 0.7,
      evidence: [{ metric: 'distance_m', value: 100 }],
      sourceReferences: ['tomtom:1'],
      uncertainty: [],
      status: 'open',
      observedAt: new Date().toISOString(),
    };
    await persistSpatialEvents(db, [event], { orgId: 'org-1', context });
    await persistSpatialEvents(db, [Object.assign({}, event, { confidence: 0.9 })], { orgId: 'org-1', context });
    expect(db.open.size).toBe(1);
    expect((db.calls.filter(c => c.sql.startsWith('INSERT INTO alerts'))).length).toBe(1);
    expect(db.open.get('TRAFFIC_CLOSURE:vehicle:v1:road-1').confidence).toBe(0.9);
  });

  test('does not reconcile internal events when critical spatial reads failed', () => {
    const context = {
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
      dataHealth: { ok: false, readErrors: [{ message: 'route query failed' }] },
    };
    expect(eventCanAutoResolve(context, 'CORRIDOR_EXIT')).toBe(false);
  });

  test('reconciles a disappeared stateful condition only when fresh authority exists', async () => {
    const db = dbStub();
    const event = {
      eventKey: 'TRAFFIC_CLOSURE:vehicle:v1:road-1',
      eventType: 'TRAFFIC_CLOSURE',
      subjectType: 'vehicle',
      subjectId: 'v1',
      convoyId: 'c1',
      confidence: 0.9,
      operationalConfidence: 0.8,
      evidence: [],
      sourceReferences: ['tomtom:1'],
      uncertainty: [],
      status: 'open',
    };
    const freshContext = {
      subject: { kind: 'convoy', id: 'c1' },
      mission: { convoyId: 'c1' },
      operational: { vehicles: [{ id: 'v1' }] },
      coverage: { layersUnavailable: [], layersPartial: [] },
      layerHealth: [{ layerId: 'traffic', status: 'LIVE' }],
      providerHealth: { 'tomtom-traffic-incidents': { status: 'LIVE', lastErrorClass: null } },
      dataHealth: { ok: true, readErrors: [] },
    };
    await persistSpatialEvents(db, [event], { orgId: 'org-1', context: freshContext });
    await persistSpatialEvents(db, [], { orgId: 'org-1', context: freshContext });
    expect(db.open.size).toBe(0);
  });
});
