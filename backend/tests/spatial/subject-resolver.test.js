const {
  resolveSpatialSubject,
  resolveConvoy,
  resolveVehicle,
} = require('../../src/services/spatial/subjectResolver');

const ORG = '00000000-0000-0000-0000-000000000001';
const CONVOY = '00000000-0000-0000-0000-000000000002';
const VEHICLE = '00000000-0000-0000-0000-000000000003';
const CORRIDOR = '00000000-0000-0000-0000-000000000004';
const INCIDENT = '00000000-0000-0000-0000-000000000005';
const CHECKPOINT = '00000000-0000-0000-0000-000000000006';
const PORT = '00000000-0000-0000-0000-000000000007';

function dbFixture() {
  return jest.fn(async (sql, params) => {
    if (sql.includes('FROM convoys')) {
      const id = String(params[0]);
      if (id !== CONVOY) return { rows: [] };
      return { rows: [{ id: CONVOY, name: 'LK008', status: 'active', priority: 'high', region: 'Kenya', route_origin: 'Nairobi', route_destination: 'Mombasa' }] };
    }
    if (sql.includes('FROM vehicles')) {
      const id = String(params[0]);
      if (id !== VEHICLE) return { rows: [] };
      return { rows: [{ id: VEHICLE, registration: 'KCA 123A', latitude: -1.29, longitude: 36.82, assigned_convoy_id: CONVOY }] };
    }
    if (sql.includes('convoy_route_corridors') && sql.includes('crc.id')) {
      const id = String(params[0]);
      if (id !== CORRIDOR) return { rows: [] };
      return { rows: [{ id: CORRIDOR, convoy_id: CONVOY, route_line: [{ lat: -1.29, lng: 36.82 }, { lat: -1.30, lng: 37.0 }], width_km: 2, active: true }] };
    }
    if (sql.includes('convoy_route_corridors') && sql.includes('convoy_id=$1')) {
      return { rows: [{ id: CORRIDOR, convoy_id: CONVOY, route_line: [{ lat: -1.29, lng: 36.82 }, { lat: -1.30, lng: 37.0 }], width_km: 2, active: true }] };
    }
    if (sql.includes('FROM incidents')) {
      const id = String(params[0]);
      if (id !== INCIDENT) return { rows: [] };
      return { rows: [{ id: INCIDENT, convoy_id: CONVOY, title: 'Roadblock', description: 'Test', severity: 'high', status: 'open', lat: -1.31, lng: 36.83 }] };
    }
    if (sql.includes('FROM checkpoints')) {
      const id = String(params[0]);
      if (id !== CHECKPOINT) return { rows: [] };
      return { rows: [{ id: CHECKPOINT, convoy_id: CONVOY, name: 'Gate A', location_name: 'A1', lat: -1.32, lng: 36.84, sequence_order: 1, status: 'pending' }] };
    }
    if (sql.includes('FROM cds_geofences')) {
      const id = String(params[0]);
      if (id !== PORT) return { rows: [] };
      return { rows: [{ id: PORT, name: 'Mombasa Port', type: 'port', category: 'port', center_lat: -4.04, center_lng: 39.66, radius_m: 2500, active: true }] };
    }
    return { rows: [] };
  });
}

describe('spatial subject resolver', () => {
  test('resolves a convoy only inside the authenticated organisation', async () => {
    const db = dbFixture();
    const result = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'convoy', id: CONVOY } });
    expect(result.missionRow.id).toBe(CONVOY);
    expect(result.source).toBe('sonalit:convoy:' + CONVOY);
  });

  test('resolves a vehicle anchor and its assigned tenant-safe convoy', async () => {
    const db = dbFixture();
    const result = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'vehicle', id: VEHICLE } });
    expect(result.vehicleRows[0].id).toBe(VEHICLE);
    expect(result.missionRow.id).toBe(CONVOY);
    expect(result.center).toEqual({ latitude: -1.29, longitude: 36.82 });
  });

  test('resolves route and corridor identities to their owning convoy', async () => {
    const db = dbFixture();
    const route = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'route', id: CORRIDOR } });
    const corridor = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'corridor', id: CORRIDOR } });
    expect(route.missionRow.id).toBe(CONVOY);
    expect(route.routeHint.id).toBe(CORRIDOR);
    expect(corridor.missionRow.id).toBe(CONVOY);
  });

  test('resolves incidents and checkpoints without leaking cross-tenant existence', async () => {
    const db = dbFixture();
    const incident = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'incident', id: INCIDENT } });
    const checkpoint = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'checkpoint', id: CHECKPOINT } });
    expect(incident.center).toEqual({ latitude: -1.31, longitude: 36.83 });
    expect(incident.missionRow.id).toBe(CONVOY);
    expect(checkpoint.center).toEqual({ latitude: -1.32, longitude: 36.84 });

    await expect(resolveSpatialSubject({
      db,
      orgId: ORG,
      subject: { kind: 'incident', id: '00000000-0000-0000-0000-000000000099' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('resolves organisation-scoped port facility anchors', async () => {
    const db = dbFixture();
    const result = await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'port', id: PORT } });
    expect(result.center).toEqual({ latitude: -4.04, longitude: 39.66 });
    expect(result.source).toBe('sonalit:port:' + PORT);
  });

  test('location and none remain explicit non-database subjects', async () => {
    const db = dbFixture();
    expect((await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'none', id: 'context' } })).missionRow).toBeNull();
    expect((await resolveSpatialSubject({ db, orgId: ORG, subject: { kind: 'location', id: 'nairobi' } })).center).toBeNull();
  });

  test('direct helpers fail closed', async () => {
    const db = dbFixture();
    await expect(resolveConvoy(db, ORG, 'not-here')).resolves.toBeNull();
    await expect(resolveVehicle(db, ORG, 'not-here')).resolves.toBeNull();
  });
});
