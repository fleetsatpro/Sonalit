'use strict';

const { detectStops, buildIncidentTimeline } = require('../src/services/incidents/timeline');
const { sealTimeline, GENESIS } = require('../src/services/incidents/integrity');

describe('detectStops', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const min = 60000;

  test('emits a stop for a stationary run past the threshold', () => {
    const pts = [
      { lat: 1, lng: 1, speed_kmh: 40, ts: t0 },
      { lat: 1, lng: 1, speed_kmh: 0, ts: t0 + 2 * min },
      { lat: 1, lng: 1, speed_kmh: 0, ts: t0 + 6 * min }, // 4 min still
      { lat: 1, lng: 1, speed_kmh: 30, ts: t0 + 7 * min },
    ];
    const stops = detectStops(pts, { minStopMs: 3 * min });
    expect(stops).toHaveLength(1);
    expect(stops[0].durationMs).toBe(4 * min);
  });

  test('ignores brief pauses under the threshold', () => {
    const pts = [
      { lat: 1, lng: 1, speed_kmh: 0, ts: t0 },
      { lat: 1, lng: 1, speed_kmh: 0, ts: t0 + 1 * min },
      { lat: 1, lng: 1, speed_kmh: 50, ts: t0 + 2 * min },
    ];
    expect(detectStops(pts, { minStopMs: 3 * min })).toHaveLength(0);
  });

  test('falls back to distance when speed is missing', () => {
    const pts = [
      { lat: 1.0000, lng: 1.0000, speed_kmh: null, ts: t0 },
      { lat: 1.00001, lng: 1.00001, speed_kmh: null, ts: t0 + 5 * min }, // ~1.5m away
    ];
    const stops = detectStops(pts, { minStopMs: 3 * min });
    expect(stops).toHaveLength(1);
  });

  test('closes an open stop at the end of the trail', () => {
    const pts = [
      { lat: 2, lng: 2, speed_kmh: 60, ts: t0 },
      { lat: 2, lng: 2, speed_kmh: 0, ts: t0 + 1 * min },
      { lat: 2, lng: 2, speed_kmh: 0, ts: t0 + 10 * min },
    ];
    expect(detectStops(pts, { minStopMs: 5 * min })).toHaveLength(1);
  });
});

describe('sealTimeline', () => {
  const events = [
    { id: 'a', ts: '2026-01-01T00:00:00.000Z', type: 'panic', lat: 1, lng: 2 },
    { id: 'b', ts: '2026-01-01T00:05:00.000Z', type: 'capture', lat: null, lng: null },
  ];

  test('is deterministic for the same events', () => {
    expect(sealTimeline(events).digest).toBe(sealTimeline(events).digest);
  });

  test('empty timeline seals to the genesis hash', () => {
    expect(sealTimeline([]).digest).toBe(GENESIS);
    expect(sealTimeline([]).event_count).toBe(0);
  });

  test('reordering events changes the digest (chain, not a set)', () => {
    const reordered = [events[1], events[0]];
    expect(sealTimeline(reordered).digest).not.toBe(sealTimeline(events).digest);
  });

  test('tampering with one event changes the digest', () => {
    const tampered = [{ ...events[0], lat: 9 }, events[1]];
    expect(sealTimeline(tampered).digest).not.toBe(sealTimeline(events).digest);
  });
});

describe('buildIncidentTimeline', () => {
  test('fuses sources into one chronological, typed timeline', async () => {
    const rows = {
      panic_events: [{ id: 'p1', mode: 'silent', lat: 1, lng: 2, message: null, created_at: '2026-01-01T00:10:00Z', resolved_at: null }],
      guardian_captures: [{ id: 'c1', url: 'https://x/y.jpg', lat: 1, lng: 2, camera: 'front', created_at: '2026-01-01T00:11:00Z', ai_summary: 'person', ai_threat_level: 'high', ai_has_weapon: true }],
      guardian_voice_messages: [{ id: 'v1', direction: 'from_device', duration_ms: 4200, created_at: '2026-01-01T00:05:00Z' }],
      device_commands: [{ id: 'd1', command_type: 'trigger_siren', status: 'executed', issued_at: '2026-01-01T00:09:00Z' }],
      convoy_waypoints: [
        { lat: 1, lng: 2, speed_kmh: 0, recorded_at: '2026-01-01T00:00:00Z' },
        { lat: 1, lng: 2, speed_kmh: 0, recorded_at: '2026-01-01T00:20:00Z' },
      ],
    };
    const query = (sql) => {
      const table = Object.keys(rows).find(t => sql.includes(t));
      return Promise.resolve({ rows: rows[table] || [] });
    };

    const events = await buildIncidentTimeline({ query, deviceId: 'dev', from: 'a', to: 'b' });

    // 1 panic + 1 capture + 1 voice + 1 command + 1 stop
    expect(events).toHaveLength(5);
    // chronological
    const ts = events.map(e => e.ts);
    expect(ts).toEqual([...ts].sort());
    // weapon capture escalated to critical
    const cap = events.find(e => e.type === 'capture');
    expect(cap.severity).toBe('critical');
    expect(cap.media_url).toBe('https://x/y.jpg');
    // stationary trail became a stop
    expect(events.some(e => e.type === 'stop')).toBe(true);
    // sealable
    expect(sealTimeline(events).event_count).toBe(5);
  });
});
