import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const page = read('./pages.tsx');
const dashboard = read('./CDSDashboard.tsx');
const constants = read('./constants.ts');
const component = read('./CDSPerformanceAnalysis.tsx');
const visual = read('./CDSPerformanceAnalysis.css');

describe('CDS Performance Analysis v2 contract', () => {
  it('mounts the dedicated analysis workspace without leaving the legacy implementation active', () => {
    expect(constants).toContain("label: 'Performance Analysis'");
    expect(dashboard).toContain('PERFORMANCE ANALYSIS / OPERATIONAL EVIDENCE');
    expect(page).toContain("export { AnalyticsView } from './CDSPerformanceAnalysis.js';");
    expect(component).toContain('export function AnalyticsView()');
  });

  it('uses a spatial glass environment with restrained metallic edge treatment', () => {
    for (const marker of [
      '.cds-performance-analysis-v2',
      '.cpa-v2__space',
      'backdrop-filter:blur(22px)',
      'rgba(168,207,239,.21)',
      'cpa-v2-star-drift',
      'cpa-v2-orbit',
      '@media (prefers-reduced-motion:reduce)',
    ]) expect(visual).toContain(marker);
    expect(component).toContain('className="cpa-v2__space"');
    expect(visual).not.toMatch(/(^|\n)\s*color:\s*#fff\s*;\s*background:\s*#fff/);
  });

  it('compares equivalent consecutive periods from explicit prior-period API metrics', () => {
    expect(component).toContain('data.period_comparison');
    expect(component).toContain('Current {days} days vs immediately preceding {days} days');
    expect(component).toContain('No prior-period baseline');
  });

  it('uses a single event stream per throughput chart to avoid mixing unlike units', () => {
    expect(component).toContain('type TrendMetric');
    expect(component).toContain('setMetric(option.id)');
    expect(component).toContain('selected.label');
    expect(component).toContain('Different event streams are not treated as a conversion funnel');
    expect(component).not.toContain('visibleSeries.map');
  });

  it('tracks a selected booking cohort through four distinct evidence milestones', () => {
    for (const marker of [
      'booking_cohort',
      'bookings_with_clamp',
      'bookings_with_trip',
      'bookings_delivered',
      'SAME BOOKING COHORT',
      'Five exclusive stages for bookings created in this reporting window',
    ]) expect(component).toContain(marker);
  });

  it('retains the five mandated mutually-exclusive Booking Mix stages', () => {
    for (const marker of [
      "status: 'clamped', label: 'Clamped'",
      "status: 'cancelled', label: 'Cancelled'",
      "status: 'completed', label: 'Completed'",
      "status: 'yard', label: 'Yard · not yet clamped'",
      "status: 'in_progress', label: 'In-progress'",
    ]) expect(component).toContain(marker);
  });

  it('exposes distributions, medians, tail latency, ETA variance and trip-level data completeness', () => {
    for (const marker of [
      'avg_eta_variance_hours',
      'p90_eta_late_hours',
      'p50_transit_hours',
      'p90_transit_hours',
      'p50_clamp_duration_hours',
      'p90_clamp_duration_hours',
      'trips_with_data_gaps',
      'delivery_completion_pct',
    ]) expect(component).toContain(marker);
  });

  it('does not manufacture service-grade thresholds without an agreed target', () => {
    expect(component).not.toContain('adherence >= 90');
    expect(component).not.toContain('adherence >= 75');
    expect(component).not.toContain('BELOW THRESHOLD');
    expect(component).toContain("adherence == null ? 'NO SAMPLE' : 'OBSERVED'");
  });

  it('labels inventory ratios, operator actions and ETA evidence without inventing productivity or SLA claims', () => {
    for (const marker of [
      'Registered-fleet share in use',
      'Status-derived deployment share',
      'not productivity rankings',
      'contractual SLA cannot be inferred',
      'not a time-based utilization rate',
    ]) expect(component).toContain(marker);
  });
});
