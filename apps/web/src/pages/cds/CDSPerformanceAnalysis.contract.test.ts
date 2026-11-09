import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const page = read('./pages.tsx');
const dashboard = read('./CDSDashboard.tsx');
const constants = read('./constants.ts');
const component = read('./CDSPerformanceAnalysis.tsx');
const visual = read('./CDSPerformanceAnalysis.css');
const advancedCharts = read('./CDSPerformanceAnalysisAdvancedCharts.tsx');

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

  it('separates current-state operational posture from selected-period activity', () => {
    expect(component).toContain('function SnapshotSignals');
    expect(component).toContain('Snapshot measures · independent of reporting window');
    for (const marker of ['s.delayed_trips', 's.locks_needing_attention', 's.overdue_inspections', 's.trips_with_data_gaps']) {
      expect(component).toContain(marker);
    }
    expect(component).toContain('className="cpa-v2__signals"');
    expect(visual).toContain('.cpa-v2__signals-grid');
  });

  it('reports snapshot age as an observation and avoids an undocumented stale threshold', () => {
    expect(component).toContain("snapshotAge == null ? 'Age unknown'");
    expect(component).not.toContain('snapshotAge > 5');
    expect(component).not.toContain('is-stale');
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
      'Five mutually exclusive stages for bookings created in this reporting window',
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
  it('renders an interactive line, bar and pie chart suite from persisted analytics data', () => {
    for (const marker of [
      'ResponsiveContainer',
      'ComposedChart',
      '<Area',
      '<Line',
      'CorridorActivityChart',
      'BarChart',
      '<Bar',
      'PieChart',
      '<Pie',
      'booking_pipeline',
      'trips_started',
      'containers_handled',
      'Five mutually exclusive stages',
    ]) expect(component).toContain(marker);
    expect(component).toContain('isAnimationActive={!reducedMotion}');
    expect(component).toContain('sort((a, b) => Number(b.trips_started) - Number(a.trips_started))');
    expect(component).toContain('sort((a, b) => Number(b.containers_handled) - Number(a.containers_handled))');
  });

  it('compares equal-length periods only where an explicit prior baseline is returned', () => {
    for (const marker of [
      'function PeriodComparisonChart',
      'data.period_comparison',
      'Current {days}-day window vs the immediately preceding {days} days',
      'metricValue(prior?.bookings_received)',
      'metricValue(prior?.containers_clamped)',
      'metricValue(prior?.trips_started)',
      'metricValue(prior?.deliveries_completed)',
      'No comparable prior-period baseline',
      'Previous period',
    ]) expect(component).toContain(marker);
    expect(component).toContain('row.current != null && row.previous != null');
    expect(component).toContain('cpa-v2__comparison-legend');
    expect(visual).toContain('.cpa-v2__comparison-legend');
  });

  it('promotes a full-width chart stage with data-derived trend context and ranked bar labels', () => {
    for (const marker of [
      'PEAK BUCKET',
      'AVERAGE / BUCKET',
      'ACTIVE DAYS',
      'ReferenceLine',
      'ReferenceDot',
      'throughput-area',
      'ComposedChart',
      'LabelList',
      'dateRangeLabel(peakBucket.start, peakBucket.end)',
      'averagePerBucket',
      'activeDays',
      'cpa-v2__chart-pair',
      'cpa-v2__analysis-grid--hero-chart',
    ]) expect(component).toContain(marker);
    for (const marker of [
      '.cpa-v2__chart-intelligence',
      '.cpa-v2__chart-pair',
      '.cpa-v2__analysis-grid--hero-chart',
      '.cpa-v2__rechart--line',
      'cpa-chart-intel-rise',
    ]) expect(visual).toContain(marker);
    expect(component.indexOf('cpa-v2__analysis-grid--hero-chart')).toBeLessThan(component.indexOf('cpa-v2__chart-pair'));
  });


  it('adds a distribution histogram and selected-day calendar heatmap from daily persisted observations', () => {
    for (const marker of [
      'DailyActivityProfile',
      'buildDailyHistogram',
      'buildActivityCalendar',
      'Events per calendar day',
      'ZERO-ACTIVITY DAYS',
      'SELECT A DAY',
      'aria-pressed={cell.day === currentDay?.day}',
      'level-missing',
    ]) expect(advancedCharts).toContain(marker);
    expect(component).toContain('<Brush');
    expect(component).toContain('AVERAGE / DAY');
    expect(component).toContain('<DailyActivityProfile daily={data.daily} />');
    expect(visual).toContain('.cpa-v2__calendar-grid');
    expect(visual).toContain('.cpa-v2__rechart--histogram');
  });

  it('styles data tooltips and respects reduced-motion preferences in chart rendering', () => {
    expect(component).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    for (const marker of [
      '.cpa-v2__rechart',
      '.cpa-v2__chart-tooltip',
      '.cpa-v2__mix-chart-grid',
      '.cpa-v2__mix-centre',
    ]) expect(visual).toContain(marker);
    expect(visual).toContain('@media (prefers-reduced-motion:reduce)');
  });

});
