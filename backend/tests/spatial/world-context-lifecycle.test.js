'use strict';

jest.mock('../../src/services/spatial/spatialEvents', () => ({
  detectSpatialEvents: jest.fn(() => []),
  persistSpatialEvents: jest.fn(async () => ({ created: [], updated: [], resolved: [] })),
  reconcileSpatialEvents: jest.fn(async () => [{ id: 'event-1', event_key: 'STALE_TELEMETRY:vehicle:v1' }]),
}));

const {
  buildWorldContext,
} = require('../../src/services/spatial/worldContextService');

const {
  persistSpatialEvents,
  reconcileSpatialEvents,
} = require('../../src/services/spatial/spatialEvents');

describe('world context spatial lifecycle integration', () => {
  test('persists current events before reconciling stale state', async () => {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const convoyId = '00000000-0000-0000-0000-000000000002';

    const db = jest.fn(async (sql) => {
      if (sql.includes('FROM convoys')) {
        return {
          rows: [{
            id: convoyId,
            name: 'LK008',
            status: 'active',
            priority: 'high',
            region: 'Kenya',
            route_origin: 'Nairobi',
            route_destination: 'Mombasa',
            departure_time: null,
            estimated_arrival: null,
          }],
        };
      }
      return { rows: [] };
    });

    const context = await buildWorldContext({
      orgId,
      db,
      subject: { kind: 'convoy', id: convoyId },
      layers: [],
      persistEvents: true,
      userId: null,
    });

    expect(persistSpatialEvents).toHaveBeenCalledTimes(1);
    expect(reconcileSpatialEvents).toHaveBeenCalledTimes(1);
    expect(reconcileSpatialEvents.mock.invocationCallOrder[0])
      .toBeGreaterThan(persistSpatialEvents.mock.invocationCallOrder[0]);
    expect(reconcileSpatialEvents.mock.calls[0][2]).toEqual([]);
    expect(context.lifecycle).toEqual({
      resolvedEventIds: ['event-1'],
      resolvedEventKeys: ['STALE_TELEMETRY:vehicle:v1'],
    });
  });
});
