'use strict';

const { toPortalIncident, deriveLevel, buildSecurityStatus } = require('../src/utils/portalSanitiser');

// Helpers to build fake alert rows
function makeAlert(overrides = {}) {
  return {
    id: 'alert-uuid-001',
    convoy_id: 'convoy-uuid-001',
    type: 'security',
    severity: 'high',
    acknowledged_at: null,
    resolved_at: null,
    created_at: new Date('2026-01-01T10:00:00Z'),
    message: 'INTERNAL: armed suspects followed escort at km 42. Law enforcement notified.',
    ...overrides,
  };
}

describe('toPortalIncident — leak boundary', () => {
  test('never exposes raw message field', () => {
    const raw = makeAlert({ message: 'INTERNAL: suspect vehicle spotted, licence XYZ 123' });
    const result = toPortalIncident(raw);
    expect(result).not.toHaveProperty('message');
    expect(JSON.stringify(result)).not.toContain('suspect vehicle');
    expect(JSON.stringify(result)).not.toContain('XYZ 123');
  });

  test('maps security type to sos portal type', () => {
    const result = toPortalIncident(makeAlert({ type: 'security' }));
    expect(result.type).toBe('sos');
  });

  test('maps geofence type to deviation portal type', () => {
    const result = toPortalIncident(makeAlert({ type: 'geofence' }));
    expect(result.type).toBe('deviation');
  });

  test('maps mechanical type to unplanned_stop portal type', () => {
    const result = toPortalIncident(makeAlert({ type: 'mechanical' }));
    expect(result.type).toBe('unplanned_stop');
  });

  test('maps speed and communication types to delay portal type', () => {
    expect(toPortalIncident(makeAlert({ type: 'speed' })).type).toBe('delay');
    expect(toPortalIncident(makeAlert({ type: 'communication' })).type).toBe('delay');
  });

  test('maps high/critical severity to critical portal severity', () => {
    expect(toPortalIncident(makeAlert({ severity: 'high' })).severity).toBe('critical');
    expect(toPortalIncident(makeAlert({ severity: 'critical' })).severity).toBe('critical');
  });

  test('maps low severity to info portal severity', () => {
    expect(toPortalIncident(makeAlert({ severity: 'low' })).severity).toBe('info');
  });

  test('maps medium severity to warning portal severity', () => {
    expect(toPortalIncident(makeAlert({ severity: 'medium' })).severity).toBe('warning');
  });

  test('status is detected when not acked or resolved', () => {
    const result = toPortalIncident(makeAlert());
    expect(result.status).toBe('detected');
  });

  test('status is responding when acked but not resolved', () => {
    const result = toPortalIncident(makeAlert({ acknowledged_at: new Date('2026-01-01T10:05:00Z') }));
    expect(result.status).toBe('responding');
  });

  test('status is resolved when resolved_at set', () => {
    const result = toPortalIncident(makeAlert({
      acknowledged_at: new Date('2026-01-01T10:05:00Z'),
      resolved_at: new Date('2026-01-01T10:30:00Z'),
    }));
    expect(result.status).toBe('resolved');
  });

  test('timeline has detected phase as first event', () => {
    const result = toPortalIncident(makeAlert());
    expect(result.timeline[0].phase).toBe('detected');
    expect(result.timeline[0].at).toBe('2026-01-01T10:00:00.000Z');
  });

  test('timeline has responding phase when acked', () => {
    const result = toPortalIncident(makeAlert({ acknowledged_at: new Date('2026-01-01T10:05:00Z') }));
    expect(result.timeline.some(e => e.phase === 'responding')).toBe(true);
  });

  test('timeline has resolved phase when resolved', () => {
    const result = toPortalIncident(makeAlert({
      acknowledged_at: new Date('2026-01-01T10:05:00Z'),
      resolved_at: new Date('2026-01-01T10:30:00Z'),
    }));
    expect(result.timeline.some(e => e.phase === 'resolved')).toBe(true);
  });

  test('safe title is present and non-empty', () => {
    const result = toPortalIncident(makeAlert());
    expect(typeof result.title).toBe('string');
    expect(result.title.length).toBeGreaterThan(0);
  });

  test('summary is calm and operational-detail-free', () => {
    const result = toPortalIncident(makeAlert({ type: 'security', severity: 'high' }));
    expect(result.summary).not.toMatch(/law enforcement|police|armed|suspect/i);
    expect(result.summary.length).toBeGreaterThan(10);
  });

  test('output shape has only expected keys', () => {
    const result = toPortalIncident(makeAlert());
    const keys = Object.keys(result).sort();
    expect(keys).toEqual([
      'convoy_id', 'id', 'occurred_at', 'resolved_at',
      'severity', 'status', 'summary', 'timeline', 'title', 'type',
    ].sort());
  });
});

describe('deriveLevel', () => {
  const makeIncident = (severity, status) => ({ severity, status });

  test('returns critical when any critical incident is open', () => {
    const incidents = [
      makeIncident('critical', 'detected'),
      makeIncident('info', 'resolved'),
    ];
    expect(deriveLevel(incidents)).toBe('critical');
  });

  test('returns warning when warning incident is open but no critical', () => {
    const incidents = [makeIncident('warning', 'responding')];
    expect(deriveLevel(incidents)).toBe('warning');
  });

  test('returns warning when non-critical info incident is open', () => {
    const incidents = [makeIncident('info', 'detected')];
    expect(deriveLevel(incidents)).toBe('warning');
  });

  test('returns secure when all incidents resolved', () => {
    const incidents = [
      makeIncident('critical', 'resolved'),
      makeIncident('warning', 'resolved'),
    ];
    expect(deriveLevel(incidents)).toBe('secure');
  });

  test('returns secure when incidents list is empty', () => {
    expect(deriveLevel([])).toBe('secure');
  });
});

describe('buildSecurityStatus', () => {
  test('returns secure headline when no open incidents', () => {
    const status = buildSecurityStatus('convoy-1', [], null);
    expect(status.level).toBe('secure');
    expect(status.headline).toBe('All secure');
    expect(status.escort_active).toBe(true);
  });

  test('uses last_ping_at from convoyRow', () => {
    const convoyRow = { last_ping_at: new Date('2026-01-01T09:55:00Z'), updated_at: null };
    const status = buildSecurityStatus('convoy-1', [], convoyRow);
    expect(status.last_checkin_at).toBe('2026-01-01T09:55:00.000Z');
  });

  test('returns null last_checkin_at when convoyRow is null', () => {
    const status = buildSecurityStatus('convoy-1', [], null);
    expect(status.last_checkin_at).toBeNull();
  });
});
