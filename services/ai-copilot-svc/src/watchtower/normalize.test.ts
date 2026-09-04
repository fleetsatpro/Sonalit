import { describe, it, expect } from 'vitest';
import { normalise, normaliseBatch, UnnormalisableEventError } from './normalize.js';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OCCURRED = '2026-09-04T10:00:00.000Z';

describe('normalise', () => {
  it('maps a panic event to a panic signal', () => {
    const signal = normalise({
      subject: `events.panic.${ORG}`,
      payload: {
        org_id: ORG,
        device_id: 'dev-1',
        convoy_id: 'convoy-17',
        occurred_at: OCCURRED,
        severity: 'critical',
      },
    });

    expect(signal.type).toBe('panic');
    expect(signal.severity).toBe('critical');
    expect(signal.entity_type).toBe('device');
    expect(signal.convoy_id).toBe('convoy-17');
    expect(signal.observed_at).toEqual(new Date(OCCURRED));
  });

  it('maps legacy alert types into the signal vocabulary', () => {
    const signal = normalise({
      subject: `events.alert.${ORG}`,
      payload: {
        org_id: ORG,
        type: 'route_deviation',
        vehicle_id: 'veh-1',
        created_at: OCCURRED,
        severity: 'high',
      },
    });

    expect(signal.type).toBe('corridor_deviation');
    // The backend's high/medium/low vocabulary folds into the contracts one.
    expect(signal.severity).toBe('warning');
    expect(signal.entity_type).toBe('vehicle');
  });

  // §30 — the raw payload is what a human checks a finding against.
  it('retains the producer payload verbatim as evidence', () => {
    const payload = {
      org_id: ORG,
      vehicle_id: 'veh-1',
      occurred_at: OCCURRED,
      deviation_km: 4.2,
      corridor: 'A109',
    };

    const signal = normalise({ subject: `events.geofence.breach.${ORG}`, payload });

    expect(signal.payload).toEqual(payload);
  });

  // §48 — substituting now() for a missing timestamp would make a stale
  // event look current, which is the failure mode freshness exists to stop.
  it('rejects an event with no parseable producer timestamp', () => {
    expect(() =>
      normalise({
        subject: `events.panic.${ORG}`,
        payload: { org_id: ORG, device_id: 'dev-1' },
      }),
    ).toThrow(UnnormalisableEventError);
  });

  it('rejects an event with no tenant', () => {
    expect(() =>
      normalise({
        subject: `events.panic.${ORG}`,
        payload: { device_id: 'dev-1', occurred_at: OCCURRED },
      }),
    ).toThrow(/no org_id/);
  });

  it('rejects an event naming no correlatable entity', () => {
    expect(() =>
      normalise({
        subject: `events.panic.${ORG}`,
        payload: { org_id: ORG, occurred_at: OCCURRED },
      }),
    ).toThrow(/no vehicle, device or convoy id/);
  });

  it('rejects an unmapped alert type rather than guessing', () => {
    expect(() =>
      normalise({
        subject: `events.alert.${ORG}`,
        payload: { org_id: ORG, type: 'brand_new_type', vehicle_id: 'v1', created_at: OCCURRED },
      }),
    ).toThrow(/no signal mapping/);
  });

  it('rejects a subject it has no rule for', () => {
    expect(() =>
      normalise({
        subject: 'telemetry.gps.org.device',
        payload: { org_id: ORG, vehicle_id: 'v1', occurred_at: OCCURRED },
      }),
    ).toThrow(/no rule for this subject/);
  });

  it('accepts epoch-millisecond timestamps', () => {
    const ms = Date.parse(OCCURRED);
    const signal = normalise({
      subject: `events.panic.${ORG}`,
      payload: { org_id: ORG, device_id: 'd1', occurred_at: ms },
    });

    expect(signal.observed_at).toEqual(new Date(ms));
  });

  it('records ingest time separately from observation time', () => {
    const received = new Date('2026-09-04T10:40:00.000Z');
    const signal = normalise({
      subject: `events.panic.${ORG}`,
      payload: { org_id: ORG, device_id: 'd1', occurred_at: OCCURRED },
      received_at: received,
    });

    // The 40-minute gap is the freshness signal; it must survive.
    expect(signal.ingested_at).toEqual(received);
    expect(signal.observed_at).toEqual(new Date(OCCURRED));
  });
});

describe('normaliseBatch', () => {
  // One malformed producer must not stop the bus being processed.
  it('separates failures instead of aborting the batch', () => {
    const { signals, rejected } = normaliseBatch([
      {
        subject: `events.panic.${ORG}`,
        payload: { org_id: ORG, device_id: 'd1', occurred_at: OCCURRED },
      },
      { subject: 'unknown.subject', payload: { org_id: ORG } },
      {
        subject: `events.geofence.breach.${ORG}`,
        payload: { org_id: ORG, vehicle_id: 'v1', occurred_at: OCCURRED },
      },
    ]);

    expect(signals.map((s) => s.type)).toEqual(['panic', 'geofence_breach']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.subject).toBe('unknown.subject');
  });
});
