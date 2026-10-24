'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/realtime/centrifugo', () => ({ publish: jest.fn() }));

const { query } = require('../src/config/database');
const { attachTruckProgress } = require('../src/controllers/convoyController');

const ORG = '11111111-1111-4111-8111-111111111111';
const CONVOY = '22222222-2222-4222-8222-222222222222';
const ROUTE = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];

function setupQueries({ rosterRows = [], corridorRows = [], waypointRows = [] } = {}) {
  query.mockImplementation((sql) => {
    if (sql.includes('WITH roster AS')) return Promise.resolve({ rows: rosterRows });
    if (sql.includes('FROM convoy_route_corridors crc')) return Promise.resolve({ rows: corridorRows });
    if (sql.includes('FROM convoy_route_waypoints rw')) return Promise.resolve({ rows: waypointRows });
    return Promise.reject(new Error('Unexpected query in convoy progress test'));
  });
}

describe('attachTruckProgress', () => {
  beforeEach(() => query.mockReset());

  test('enriches each convoy with only roster-backed, GPS-derived progress', async () => {
    setupQueries({
      rosterRows: [{
        convoy_id: CONVOY, convoy_truck_id: 'truck-1', vehicle_id: 'vehicle-1',
        position: 1, registration: 'KDA 123A', driver_name: 'Driver One',
        gps_lat: 0, gps_lng: 0.5, speed_kph: 42, last_fix_at: new Date().toISOString(),
      }],
      corridorRows: [{ convoy_id: CONVOY, route_line: ROUTE, width_km: 2 }],
    });

    const [result] = await attachTruckProgress([{ id: CONVOY, vehicle_count: 1 }], ORG);

    expect(result.truck_progress_available).toBe(true);
    expect(result.vehicle_count).toBe(1);
    expect(result.truck_progress).toHaveLength(1);
    expect(result.truck_progress[0]).toMatchObject({
      id: 'truck-1', registration: 'KDA 123A', state: 'live',
      progress_pct: 50, speed_kph: 42,
    });
    expect(result.truck_progress[0].last_fix_at).toBeTruthy();
    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('c.org_id = $2');
      expect(params).toEqual([[CONVOY], ORG]);
    }
  });

  test('supports legacy convoys whose roster lives only in vehicle assignments', async () => {
    setupQueries({
      rosterRows: [{
        convoy_id: CONVOY, convoy_truck_id: null, vehicle_id: 'legacy-vehicle-1',
        position: 1, registration: 'KDA 456B', driver_name: null,
        gps_lat: 0, gps_lng: 0.25, speed_kph: 0, last_fix_at: new Date().toISOString(),
      }],
      corridorRows: [{ convoy_id: CONVOY, route_line: ROUTE, width_km: 2 }],
    });

    const [result] = await attachTruckProgress([{ id: CONVOY, vehicle_count: 1 }], ORG);
    expect(result.truck_progress).toHaveLength(1);
    expect(result.truck_progress[0]).toMatchObject({
      id: CONVOY + ':legacy-vehicle-1',
      vehicle_id: 'legacy-vehicle-1',
      registration: 'KDA 456B',
      state: 'live',
      progress_pct: 25,
    });

    const rosterSql = query.mock.calls.find(([sql]) => sql.includes('WITH roster AS'))[0];
    expect(rosterSql).toContain('UNION ALL');
    expect(rosterSql).toContain('FROM convoy_assignments ca');
    expect(rosterSql).toContain('NOT EXISTS');
  });

  test('uses persisted route waypoints when no active corridor exists', async () => {
    setupQueries({
      rosterRows: [{
        convoy_id: CONVOY, convoy_truck_id: 'truck-1', vehicle_id: 'vehicle-1',
        position: 1, registration: 'KDA 123A', driver_name: 'Driver One',
        gps_lat: 0, gps_lng: 0, speed_kph: 0, last_fix_at: new Date().toISOString(),
      }],
      waypointRows: [
        { convoy_id: CONVOY, seq: 1, lat: 0, lng: 0 },
        { convoy_id: CONVOY, seq: 2, lat: 0, lng: 1 },
      ],
    });

    const [result] = await attachTruckProgress([{ id: CONVOY, vehicle_count: 1 }], ORG);
    expect(result.truck_progress[0].state).toBe('live');
    expect(result.truck_progress[0].progress_pct).toBe(0);
  });

  test('preserves convoy register availability when telemetry enrichment fails', async () => {
    query.mockRejectedValue(new Error('database unavailable'));
    const row = { id: CONVOY, vehicle_count: 3, name: 'Existing convoy' };

    const [result] = await attachTruckProgress([row], ORG);
    expect(result.name).toBe('Existing convoy');
    expect(result.vehicle_count).toBe(3);
    expect(result.truck_progress).toEqual([]);
    expect(result.truck_progress_available).toBe(false);
  });

  test('empty convoy pages do not run telemetry queries', async () => {
    expect(await attachTruckProgress([], ORG)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
