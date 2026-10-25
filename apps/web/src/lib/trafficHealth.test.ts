import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { trafficAvailabilityNotice } from './trafficHealth.js';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('traffic provider availability semantics', () => {
  it('states that road conditions are unknown when the incident request fails', () => {
    expect(trafficAvailabilityNotice(true, 'LIVE'))
      .toBe('Traffic incident data is unavailable. Road conditions are unknown, not confirmed clear.');
  });

  it('warns when observations are stale without presenting them as current', () => {
    expect(trafficAvailabilityNotice(false, 'STALE'))
      .toContain('observations are stale');
    expect(trafficAvailabilityNotice(false, 'STALE'))
      .toContain('may have changed');
  });

  it.each(['PARTIAL', 'UNKNOWN'])('does not infer clear roads from %s coverage', status => {
    expect(trafficAvailabilityNotice(false, status)).toContain('do not confirm clear roads');
  });

  it.each(['UNAVAILABLE', 'AUTH_REQUIRED', 'RATE_LIMITED', 'DEGRADED'])(
    'identifies %s as degraded rather than clear traffic',
    status => {
      expect(trafficAvailabilityNotice(false, status)).toContain('Road conditions are unknown');
    },
  );

  it('does not produce a warning for a healthy, live provider response', () => {
    expect(trafficAvailabilityNotice(false, 'LIVE')).toBeNull();
  });

  it('does not issue a notice before the traffic layer is enabled and queried', () => {
    // Callers gate this presentation function on trafficOn; healthy/unqueried
    // data must not produce a fabricated warning.
    expect(trafficAvailabilityNotice(false, undefined)).toBeNull();
  });
});

describe('active traffic-map degraded-mode contract', () => {
  it('clears the previous Tactical Map incident overlay after a failed refresh', () => {
    const tactical = source('../components/dashboard/TacticalMap.tsx');
    expect(tactical).toContain('isError: trafficIncidentsError');
    expect(tactical).toContain("trafficIncidentsError\n      ? { type: 'FeatureCollection' as const, features: [] }");
    expect(tactical).toContain('trafficAvailabilityNotice(trafficIncidentsError');
    expect(tactical).toContain('ROAD STATE UNKNOWN');
    expect(tactical).toContain('role="status" aria-live="polite"');
  });

  it('clears the previous FleetMap incident overlay after a failed refresh', () => {
    const fleetMap = source('../features/live-fleet/components/FleetMap.tsx');
    expect(fleetMap).toContain('isError: trafficIncidentsError');
    expect(fleetMap).toContain("setTrafficIncidents(map, { type: 'FeatureCollection', features: [] })");
    expect(fleetMap).toContain('trafficAvailabilityNotice(trafficIncidentsError');
    expect(fleetMap).toContain('ROAD STATE UNKNOWN');
    expect(fleetMap).toContain('role="status" aria-live="polite"');
  });
});
