'use strict';

const {
  resolveSpatialSubject,
} = require('../../src/services/spatial/subjectResolver');

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';

function dbStub(rowsBySql) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    for (const [needle, rows] of rowsBySql) {
      if (sql.includes(needle)) return { rows };
    }
    return { rows: [] };
  };
  db.calls = calls;
  return db;
}

describe('spatial subject resolver', () => {
  test('resolves an organisation-owned convoy and refuses a cross-tenant convoy', async () => {
    const db = dbStub([
      ['FROM convoys', [{ id: 'c1', name: 'Convoy 1', status: 'active' }]],
    ]);

    const result = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'convoy', id: 'c1' } });
    expect(result.missionRow.id).toBe('c1');
    expect(result.source).toBe('sonalit:convoy:c1');
    expect(db.calls[0].params).toEqual(['c1', ORG]);

    await expect(
      resolveSpatialSubject({
        db: dbStub([['FROM convoys', []]]),
        orgId: ORG,
        subject: { kind: 'convoy', id: 'c-cross-tenant' },
      }),
    ).rejects.toMatchObject({ statusCode: 404, subjectKind: 'convoy' });
  });

  test('resolves vehicle location without trusting an unscoped row', async () => {
    const db = dbStub([
      ['FROM vehicles', [{
        id: 'v1', registration: 'KAA001A', latitude: -1.29, longitude: 36.82, assigned_convoy_id: null,
      }]],
    ]);

    const result = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'vehicle', id: 'v1' } });
    expect(result.center).toEqual({ latitude: -1.29, longitude: 36.82 });
    expect(result.vehicleRows[0].id).toBe('v1');
    expect(db.calls[0].params).toEqual(['v1', ORG]);
  });

  test('resolves route and corridor only through tenant-owned convoy/corridor records', async () => {
    const db = dbStub([
      ['FROM convoy_route_corridors', [{ id: 'r1', convoy_id: 'c1', route_line: [{ lat: 1, lng: 2 }], width_km: 2, active: true }]],
      ['FROM convoys', [{ id: 'c1', name: 'Convoy 1' }]],
    ]);

    const route = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'route', id: 'r1' } });
    expect(route.routeHint.id).toBe('r1');
    expect(route.missionRow.id).toBe('c1');

    const corridor = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'corridor', id: 'r1' } });
    expect(corridor.routeHint.id).toBe('r1');
    expect(corridor.missionRow.id).toBe('c1');
  });

  test('resolves checkpoint and incident anchors with tenant ownership', async () => {
    const db = dbStub([
      ['FROM checkpoints', [{ id: 'cp1', convoy_id: 'c1', name: 'Gate', lat: -1.2, lng: 36.8 }]],
      ['FROM incidents', [{ id: 'i1', convoy_id: 'c1', title: 'Incident', lat: -1.21, lng: 36.81 }]],
      ['FROM convoys', [{ id: 'c1', name: 'Convoy 1' }]],
    ]);

    const checkpoint = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'checkpoint', id: 'cp1' } });
    expect(checkpoint.center).toEqual({ latitude: -1.2, longitude: 36.8 });
    expect(checkpoint.missionRow.id).toBe('c1');

    const incident = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'incident', id: 'i1' } });
    expect(incident.center).toEqual({ latitude: -1.21, longitude: 36.81 });
    expect(incident.missionRow.id).toBe('c1');
  });

  test('resolves organisation-owned port geofence and handles context/location subjects', async () => {
    const db = dbStub([
      ['FROM cds_geofences', [{ id: 'p1', name: 'Port', center_lat: -4.04, center_lng: 39.66, active: true }]],
    ]);

    const port = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'port', id: 'p1' } });
    expect(port.center).toEqual({ latitude: -4.04, longitude: 39.66 });
    expect(port.source).toBe('sonalit:port:p1');

    const location = await resolveSpatialSubject({ db: dbStub([]), orgId: OTHER_ORG, subject: { kind: 'location', id: 'map' } });
    expect(location.missionRow).toBeNull();

    const none = await resolveSpatialSubject({ db: dbStub([]), orgId: OTHER_ORG, subject: { kind: 'none', id: 'context' } });
    expect(none.source).toBeNull();
  });

  test('rejects unsupported subject kinds explicitly', async () => {
    await expect(
      resolveSpatialSubject({ db: dbStub([]), orgId: ORG, subject: { kind: 'person', id: 'p1' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
