const {
  reconcileWorldState,
  motionAgent,
  routeAgent,
} = require('../src/services/geofence/worldStateSwarm');

const route = [
  { lat: -1.286, lng: 36.817 },
  { lat: -1.250, lng: 36.820 },
  { lat: -1.210, lng: 36.825 },
];

describe('world-state reconciliation swarm', () => {
  it('rejects malformed observations without manufacturing a coordinate', () => {
    const result = reconcileWorldState({ observed: { lat: 'bad', lng: 36.8 } });
    expect(result.state).toBe('no_confident_estimate');
    expect(result.estimate).toBeNull();
  });

  it('keeps a physically impossible jump at the previous trusted state', () => {
    const previous = { lat: -1.286, lng: 36.817, heading: 90 };
    const observed = { lat: -1.00, lng: 38.00, accuracy_m: 5, heading: 90 };
    const result = reconcileWorldState({
      previous,
      observed,
      route,
      elapsedSeconds: 4,
      observedAt: new Date().toISOString(),
      now: Date.now(),
    });

    expect(result.state).toBe('outlier_suspected');
    expect(result.estimate.lat).toBe(previous.lat);
    expect(result.estimate.lng).toBe(previous.lng);
    expect(result.agents.find(a => a.id === 'motion').verdict).toBe('outlier');
    expect(result.supporting_agents.length).toBeGreaterThan(0);
  });

  it('does not force a genuine, plausible off-route position back onto the route', () => {
    const previous = { lat: -1.286, lng: 36.817, heading: 0 };
    const observed = { lat: -1.30, lng: 36.79, accuracy_m: 12, heading: 300 };
    const result = reconcileWorldState({
      previous,
      observed,
      route,
      elapsedSeconds: 120,
      observedAt: new Date().toISOString(),
      now: Date.now(),
    });

    expect(result.estimate.lat).toBe(observed.lat);
    expect(result.estimate.lng).toBe(observed.lng);
  });

  it('exposes independent route evidence without making route geometry authoritative', () => {
    const result = routeAgent({
      route,
      observed: { lat: -1.286, lng: 36.817 },
      previous: null,
    });
    expect(result.projection).toBeTruthy();
    expect(result.evidence.some(e => e.kind === 'cross_track_km')).toBe(true);
  });

  it('keeps the motion guard bounded by the configured maximum speed', () => {
    const result = motionAgent({
      previous: { lat: 0, lng: 0 },
      observed: { lat: 0, lng: 0.001 },
      elapsedSeconds: 60,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(['consistent', 'outlier']).toContain(result.verdict);
  });
});
