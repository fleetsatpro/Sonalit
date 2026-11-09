import { describe, expect, it } from 'vitest';
import { buildActivityCalendar, buildDailyHistogram } from './CDSPerformanceAnalysisAdvancedCharts.js';
import type { CDSAnalyticsPayload } from './types.js';

const rows: CDSAnalyticsPayload['daily'] = [
  { day: '2026-11-02', bookings_received: 0, containers_clamped: 0, containers_unclamped: 0, trips_started: 0, deliveries_completed: 0 },
  { day: '2026-11-03', bookings_received: 2, containers_clamped: 1, containers_unclamped: 0, trips_started: 1, deliveries_completed: 0 },
  { day: '2026-11-04', bookings_received: 4, containers_clamped: 2, containers_unclamped: 1, trips_started: 2, deliveries_completed: 1 },
  { day: '2026-11-05', bookings_received: 0, containers_clamped: 0, containers_unclamped: 0, trips_started: 0, deliveries_completed: 0 },
  { day: '2026-11-06', bookings_received: 8, containers_clamped: 4, containers_unclamped: 2, trips_started: 3, deliveries_completed: 2 },
  { day: '2026-11-07', bookings_received: 1, containers_clamped: 1, containers_unclamped: 1, trips_started: 1, deliveries_completed: 1 },
  { day: '2026-11-08', bookings_received: 3, containers_clamped: 2, containers_unclamped: 1, trips_started: 2, deliveries_completed: 1 },
];

describe('CDS daily activity visual transforms', () => {
  it('keeps zero-activity dates in the distribution instead of dropping them', () => {
    const result = buildDailyHistogram(rows, 'bookings_received');
    expect(result.observedDays).toBe(7);
    expect(result.zeroDays).toBe(2);
    expect(result.activeDays).toBe(5);
    expect(result.bins.reduce((sum, bin) => sum + bin.days, 0)).toBe(7);
  });

  it('calculates nearest-rank median and 90th percentile from daily observations', () => {
    const result = buildDailyHistogram(rows, 'bookings_received');
    expect(result.median).toBe(2);
    expect(result.p90).toBe(8);
  });

  it('returns a single explicit zero bin when every observed day has zero events', () => {
    const zeroRows = rows.map(row => ({ ...row, bookings_received: 0 }));
    const result = buildDailyHistogram(zeroRows, 'bookings_received');
    expect(result.bins).toEqual([{ key: '0', label: '0', min: 0, max: 0, days: 7 }]);
    expect(result.median).toBe(0);
    expect(result.p90).toBe(0);
  });

  it('lays out the calendar Monday to Sunday and retains every dated observation', () => {
    const weeks = buildActivityCalendar(rows, 'bookings_received');
    const cells = weeks.flatMap(week => week.cells).filter(Boolean);
    expect(cells).toHaveLength(7);
    expect(cells[0]?.day).toBe('2026-11-02');
    expect(cells.at(-1)?.day).toBe('2026-11-08');
    expect(weeks[0].cells.map(cell => cell?.day ?? null)).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
  });

  it('keeps unavailable values separate from zero activity', () => {
    const incomplete = [{ ...rows[0], bookings_received: null as unknown as number }];
    const result = buildActivityCalendar(incomplete, 'bookings_received');
    expect(result[0].cells[0]).toEqual({ day: '2026-11-02', value: null, level: -1 });
    expect(buildDailyHistogram(incomplete, 'bookings_received').observedDays).toBe(0);
  });
});
