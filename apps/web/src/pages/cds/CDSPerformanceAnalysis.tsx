import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, Clock3, Gauge, PackageCheck,
  RefreshCw, ShieldAlert, Truck, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Area, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart,
  ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CDSAnalyticsPayload, CDSAnalyticsSummary } from './types.js';
import { DailyActivityProfile } from './CDSPerformanceAnalysisAdvancedCharts.js';
import { useAcknowledgeAlert, useCDSAnalytics } from './hooks.js';
import { useCDSStore } from './store.js';
import './CDSPerformanceAnalysis.css';

type TrendMetric = 'bookings_received' | 'containers_clamped' | 'containers_unclamped' | 'trips_started' | 'deliveries_completed';
type TrendBucket = {
  start: string; end: string; bookings_received: number; containers_clamped: number;
  containers_unclamped: number; trips_started: number; deliveries_completed: number;
};

const trendOptions: Array<{ id: TrendMetric; label: string; color: string }> = [
  { id: 'bookings_received', label: 'Bookings', color: '#f3bd70' },
  { id: 'containers_clamped', label: 'Clamped', color: '#5ce0c3' },
  { id: 'containers_unclamped', label: 'Unclamped', color: '#83b8ff' },
  { id: 'trips_started', label: 'Trips started', color: '#c0a6ff' },
  { id: 'deliveries_completed', label: 'Delivered', color: '#e5d18a' },
];

const bookingStages = [
  { status: 'clamped', label: 'Clamped', color: '#5ce0c3' },
  { status: 'cancelled', label: 'Cancelled', color: '#f07d88' },
  { status: 'completed', label: 'Completed', color: '#d8bd75' },
  { status: 'yard', label: 'Yard · not yet clamped', color: '#83b8ff' },
  { status: 'in_progress', label: 'In-progress', color: '#b29aff' },
] as const;

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const fmt = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '—' : numberFormat.format(Number(value));
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1) + '%';
const dateLabel = (value: string) => {
  const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const dateRangeLabel = (start: string, end: string) => {
  const first = dateLabel(start);
  const last = dateLabel(end);
  return first === last ? first : first + ' — ' + last;
};
const signedHours = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  return (amount > 0 ? '+' : '') + amount.toFixed(1) + 'h';
};
const duration = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1) + 'h';
const displayDateTime = (value: string | null | undefined) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

function compareLabel(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return 'No comparable baseline';
  const delta = Number(current) - Number(previous);
  if (previous === 0) return delta === 0 ? 'No change' : 'New activity · +' + fmt(delta);
  const change = Math.abs(delta / Number(previous) * 100);
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return sign + fmt(Math.abs(delta)) + ' · ' + sign + change.toFixed(1) + '%';
}

function compareRate(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return 'No comparable sample';
  const delta = Number(current) - Number(previous);
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return delta === 0 ? 'No change' : sign + Math.abs(delta).toFixed(1) + ' percentage points';
}

function SectionHeading({ index, kicker, title, aside }: { index: string; kicker: string; title: string; aside?: ReactNode }) {
  return (
    <div className="cpa-v2__section-heading">
      <div className="min-w-0">
        <div className="cpa-v2__kicker"><span>{index}</span>{kicker}</div>
        <h3>{title}</h3>
      </div>
      {aside}
    </div>
  );
}

function GlassPanel({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={'cpa-v2__panel ' + className}>{children}</section>;
}

function KpiTile({
  label, value, note, comparison, color, icon: Icon, emphasis = false,
}: {
  label: string; value: string; note: string; comparison?: string; color: string;
  icon: LucideIcon; emphasis?: boolean;
}) {
  return (
    <article className={'cpa-v2__kpi cpa-v2__kpi--' + color + (emphasis ? ' is-emphasis' : '')}>
      <div className="cpa-v2__kpi-top">
        <span>{label}</span>
        <span className="cpa-v2__kpi-icon"><Icon size={15} strokeWidth={1.8} /></span>
      </div>
      <strong>{value}</strong>
      <div className="cpa-v2__kpi-foot">
        <span>{note}</span>
        {comparison ? <span className="cpa-v2__delta">{comparison}</span> : null}
      </div>
    </article>
  );
}

function ProgressLine({ label, value, denominator, color, suffix }: {
  label: string; value: number; denominator: number; color: string; suffix?: string;
}) {
  const width = denominator > 0 ? Math.max(0, Math.min(100, value / denominator * 100)) : 0;
  return (
    <div className="cpa-v2__progress-row">
      <div className="cpa-v2__progress-meta">
        <span>{label}</span>
        <strong>{fmt(value)}{suffix ? ' ' + suffix : ''}</strong>
      </div>
      <div className="cpa-v2__progress-track"><span style={{ width: width + '%', background: color }} /></div>
    </div>
  );
}

type ChartTooltipItem = {
  name?: string; value?: unknown; color?: string;
  payload?: { start?: string; end?: string };
};
function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: ChartTooltipItem[]; label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const firstRow = payload[0]?.payload;
  const title = firstRow?.start && firstRow?.end
    ? dateRangeLabel(firstRow.start, firstRow.end)
    : label;
  return (
    <div className="cpa-v2__chart-tooltip">
      {title != null ? <strong className="cpa-v2__chart-tooltip-title">{String(title)}</strong> : null}
      {payload.filter((item, index, rows) => item.value != null
        && rows.findIndex(candidate => candidate.name === item.name && candidate.value === item.value) === index).map((item, index) => (
        <div className="cpa-v2__chart-tooltip-row" key={String(item.name ?? index)}>
          <i style={{ background: item.color ?? '#8eb9ed' }} />
          <span>{item.name ?? 'Value'}</span>
          <b>{typeof item.value === 'number' ? fmt(item.value) : String(item.value)}</b>
        </div>
      ))}
    </div>
  );
}

function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  return reducedMotion;
}

function TrendChart({ daily }: { daily: CDSAnalyticsPayload['daily'] }) {
  const [metric, setMetric] = useState<TrendMetric>('bookings_received');
  const reducedMotion = useReducedMotionPreference();

  const buckets = useMemo<TrendBucket[]>(() => daily.map(row => ({
    start: row.day,
    end: row.day,
    bookings_received: Number(row.bookings_received ?? 0),
    containers_clamped: Number(row.containers_clamped ?? 0),
    containers_unclamped: Number(row.containers_unclamped ?? 0),
    trips_started: Number(row.trips_started ?? 0),
    deliveries_completed: Number(row.deliveries_completed ?? 0),
  })), [daily]);

  const values = buckets.map(row => row[metric]);
  const total = daily.reduce((sum, row) => sum + Number(row[metric] ?? 0), 0);
  const averagePerBucket = buckets.length ? total / buckets.length : 0;
  const activeDays = daily.filter(row => Number(row[metric] ?? 0) > 0).length;
  const peakBucket = buckets.reduce<TrendBucket | null>(
    (peak, row) => !peak || row[metric] > peak[metric] ? row : peak,
    null,
  );
  const selected = trendOptions.find(option => option.id === metric) ?? trendOptions[0];

  return (
    <GlassPanel className="cpa-v2__trend-panel" id="cds-throughput">
      <div className="cpa-v2__panel-head">
        <div>
          <div className="cpa-v2__kicker"><span>01</span> ACTIVITY / EVENT DATE</div>
          <h3>Operational throughput</h3>
          <p>One event stream at a time. Hover or focus a point to inspect the recorded value.</p>
        </div>
        <div className="cpa-v2__metric-select" role="group" aria-label="Select throughput metric">
          {trendOptions.map(option => (
            <button key={option.id} type="button" aria-pressed={metric === option.id} onClick={() => setMetric(option.id)}>
              <i style={{ background: option.color }} />{option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="cpa-v2__chart-intelligence" aria-label={selected.label + ' trend summary'}>
        <div className="cpa-v2__chart-intel-primary">
          <small>WINDOW TOTAL</small>
          <strong>{fmt(total)}</strong>
          <span>{selected.label.toLowerCase()} events</span>
        </div>
        <div>
          <small>PEAK DAY</small>
          <strong>{peakBucket ? fmt(peakBucket[metric]) : '—'}</strong>
          <span>{peakBucket ? dateRangeLabel(peakBucket.start, peakBucket.end) : 'No peak recorded'}</span>
        </div>
        <div>
          <small>AVERAGE / DAY</small>
          <strong>{fmt(averagePerBucket)}</strong>
          <span>Across {fmt(buckets.length)} observed calendar days</span>
        </div>
        <div>
          <small>ACTIVE DAYS</small>
          <strong>{fmt(activeDays)}</strong>
          <span>Days with at least one event</span>
        </div>
      </div>
      {buckets.length && values.some(value => value > 0) ? (
        <div className="cpa-v2__rechart cpa-v2__rechart--line" role="img" aria-label={selected.label + ' line chart across the selected reporting period'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={buckets} margin={{ top: 12, right: 16, bottom: 4, left: -10 }}>
              <defs>
                <linearGradient id="cpa-v2-throughput-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={selected.color} stopOpacity=".76" />
                  <stop offset="52%" stopColor={selected.color} stopOpacity="1" />
                  <stop offset="100%" stopColor="#f0d39b" stopOpacity=".92" />
                </linearGradient>
                <linearGradient id="cpa-v2-throughput-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={selected.color} stopOpacity=".28" />
                  <stop offset="78%" stopColor={selected.color} stopOpacity=".055" />
                  <stop offset="100%" stopColor={selected.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(178,205,233,.12)" strokeDasharray="3 7" />
              <XAxis
                dataKey="start"
                tickFormatter={value => dateLabel(String(value))}
                interval="preserveStartEnd"
                minTickGap={28}
                tick={{ fill: 'rgba(169,194,218,.72)', fontSize: 9 }}
                axisLine={{ stroke: 'rgba(160,198,231,.14)' }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 'auto']}
                allowDecimals={false}
                tickFormatter={value => fmt(Number(value))}
                width={48}
                tick={{ fill: 'rgba(169,194,218,.62)', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: 'rgba(210,226,243,.36)', strokeDasharray: '3 5' }}
                labelFormatter={value => dateLabel(String(value))}
              />
              <Area
                type="linear"
                dataKey={metric}
                name={selected.label}
                stroke="none"
                fill="url(#cpa-v2-throughput-area)"
                fillOpacity={1}
                dot={false}
                activeDot={false}
                isAnimationActive={!reducedMotion}
                animationDuration={900}
                animationEasing="ease-out"
              />
              {total > 0 ? (
                <ReferenceLine
                  y={averagePerBucket}
                  stroke="#e5c17c"
                  strokeOpacity={0.72}
                  strokeDasharray="5 6"
                  ifOverflow="extendDomain"
                  label={{ value: 'MEAN / BUCKET', position: 'insideTopRight', fill: '#e5c17c', fontSize: 8, fontWeight: 700 }}
                />
              ) : null}
              {peakBucket ? (
                <ReferenceDot
                  x={peakBucket.start}
                  y={peakBucket[metric]}
                  r={5}
                  fill="#f0d39b"
                  stroke="#10263a"
                  strokeWidth={2}
                  isFront
                />
              ) : null}
              <Line
                type="linear"
                dataKey={metric}
                name={selected.label}
                stroke="url(#cpa-v2-throughput-line)"
                strokeWidth={2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 2.4, fill: selected.color, stroke: '#071525', strokeWidth: 1.3 }}
                activeDot={{ r: 5.5, stroke: '#071525', strokeWidth: 2, fill: selected.color }}
                isAnimationActive={!reducedMotion}
                animationDuration={950}
                animationEasing="ease-out"
              />
              {buckets.length > 30 ? (
                <Brush
                  dataKey="start"
                  height={18}
                  travellerWidth={8}
                  stroke="#c9ad76"
                  fill="rgba(10,25,41,.86)"
                  gap={1}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="cpa-v2__empty-chart"><BarChart3 size={22} /><strong>No activity recorded in this window</strong><span>The chart will populate from persisted CDS event timestamps when activity exists.</span></div>
      )}
      <div className="cpa-v2__chart-footnote">The plot preserves every recorded calendar day. Use the navigator beneath the axis to zoom into individual dates; zero-event days remain visible as observed dates.</div>
    </GlassPanel>
  );
}

function BookingMix({ data }: { data: CDSAnalyticsPayload }) {
  const reducedMotion = useReducedMotionPreference();
  const rows = bookingStages.map(stage => ({
    ...stage,
    count: Number(data.booking_pipeline.find(row => row.status === stage.status)?.count ?? 0),
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const chartRows = rows.filter(row => row.count > 0);
  return (
    <GlassPanel className="cpa-v2__mix-panel">
      <div className="cpa-v2__panel-head">
        <div><div className="cpa-v2__kicker"><span>02</span> BOOKING COHORT / SNAPSHOT STAGE</div><h3>Booking Mix</h3><p>Five mutually exclusive stages for bookings created in this reporting window.</p></div>
        <div className="cpa-v2__mix-total"><strong>{fmt(total)}</strong><span>bookings received</span></div>
      </div>
      {chartRows.length ? (
        <div className="cpa-v2__mix-chart-grid">
          <div className="cpa-v2__mix-pie" role="img" aria-label={'Booking mix pie chart. ' + rows.map(row => row.label + ': ' + fmt(row.count)).join(', ')}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<ChartTooltip />} />
                <Pie
                  data={chartRows}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={53}
                  outerRadius={88}
                  paddingAngle={2}
                  stroke="#091827"
                  strokeWidth={3}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                  animationEasing="ease-out"
                >
                  {chartRows.map(row => <Cell key={row.status} fill={row.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="cpa-v2__mix-centre" aria-hidden="true"><strong>{fmt(total)}</strong><span>BOOKINGS</span></div>
          </div>
          <div className="cpa-v2__mix-list" aria-label="Booking stage breakdown">
            {rows.map(row => {
              const share = total > 0 ? row.count / total * 100 : 0;
              return (
                <div key={row.status} className="cpa-v2__mix-row">
                  <i style={{ background: row.color }} />
                  <div className="cpa-v2__mix-row-label">
                    <strong>{row.label}</strong>
                    <span className="cpa-v2__mix-share-track"><i style={{ width: share + '%', background: row.color }} /></span>
                  </div>
                  <b>{fmt(row.count)}</b>
                  <small>{share.toFixed(1)}%</small>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="cpa-v2__empty-chart"><PieChart size={22} /><strong>No booking stages recorded</strong><span>There are no booking records in the selected reporting window.</span></div>
      )}
      <div className="cpa-v2__cohort-note">Stage is evaluated from the latest persisted booking, trip and clamp evidence; the reporting-window filter applies to booking creation time.</div>
    </GlassPanel>
  );
}

function BookingCohort({ data }: { data: CDSAnalyticsPayload }) {
  const cohort = data.booking_cohort;
  const received = Number(cohort?.bookings_received ?? 0);
  const steps = [
    { label: 'Booking received', value: received, color: '#f3bd70', note: 'Created in selected window' },
    { label: 'Clamp recorded', value: Number(cohort?.bookings_with_clamp ?? 0), color: '#5ce0c3', note: 'At least one linked clamp timestamp' },
    { label: 'Trip linked', value: Number(cohort?.bookings_with_trip ?? 0), color: '#83b8ff', note: 'At least one linked CDS trip' },
    { label: 'Delivery recorded', value: Number(cohort?.bookings_delivered ?? 0), color: '#d8bd75', note: 'At least one linked delivery timestamp' },
  ];
  return (
    <GlassPanel className="cpa-v2__cohort-panel">
      <div className="cpa-v2__panel-head">
        <div><div className="cpa-v2__kicker"><span>03</span> COHORT CONVERSION</div><h3>Booking progression</h3><p>Distinct bookings are followed through persisted downstream records.</p></div>
        <span className="cpa-v2__tag">SAME BOOKING COHORT</span>
      </div>
      <div className="cpa-v2__cohort-steps">
        {steps.map((step, index) => (
          <div className="cpa-v2__cohort-step" key={step.label}>
            <div className="cpa-v2__cohort-step-head">
              <span className="cpa-v2__cohort-number">{String(index + 1).padStart(2, '0')}</span>
              <span>{step.label}</span>
              <strong>{fmt(step.value)}</strong>
            </div>
            <div className="cpa-v2__progress-track"><span style={{ width: (received > 0 ? Math.min(100, step.value / received * 100) : 0) + '%', background: step.color }} /></div>
            <small>{received > 0 ? (step.value / received * 100).toFixed(1) + '% of cohort' : 'No cohort records'} · {step.note}</small>
          </div>
        ))}
      </div>
      <div className="cpa-v2__cohort-foot">These are evidence milestones, not an assumed funnel: a record can carry a later milestone without every earlier event being present.</div>
    </GlassPanel>
  );
}

function ServiceQuality({ data }: { data: CDSAnalyticsPayload }) {
  const s = data.summary;
  const adherence = s.eta_attainment_pct;
  const etaTone = adherence == null ? 'neutral' : 'observed';
  return (
    <div className="cpa-v2__service-grid" id="cds-service">
      <GlassPanel className="cpa-v2__service-card">
        <div className="cpa-v2__panel-head">
          <div><div className="cpa-v2__kicker"><span>04</span> DELIVERY RELIABILITY</div><h3>ETA adherence</h3></div>
          <span className={'cpa-v2__status-tag is-' + etaTone}>{adherence == null ? 'NO SAMPLE' : 'OBSERVED'}</span>
        </div>
        <div className="cpa-v2__reliability">
          <div className="cpa-v2__reliability-value">{pct(adherence)}</div>
          <div className="cpa-v2__reliability-gauge" style={{ width: Math.max(0, Math.min(100, adherence ?? 0)) + '%' }}><span /></div>
          <div className="cpa-v2__reliability-foot"><span>{fmt(s.eta_met)} on or before ETA</span><strong>{fmt(s.eta_observed)} delivered with ETA</strong></div>
        </div>
        <div className="cpa-v2__stat-pair">
          <div><small>Mean ETA variance</small><strong>{signedHours(s.avg_eta_variance_hours)}</strong><span>Positive = late · negative = early</span></div>
          <div><small>90th percentile lateness</small><strong>{duration(s.p90_eta_late_hours)}</strong><span>Late deliveries only</span></div>
        </div>
      </GlassPanel>
      <GlassPanel className="cpa-v2__service-card">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>05</span> JOURNEY DURATION</div><h3>Transit-time profile</h3></div><span className="cpa-v2__tag">COMPLETED TRIPS</span></div>
        <div className="cpa-v2__transit-main"><strong>{duration(s.p50_transit_hours)}</strong><span>Median transit time</span></div>
        <div className="cpa-v2__stat-pair">
          <div><small>Mean transit</small><strong>{duration(s.avg_transit_hours)}</strong><span>Average of valid trips</span></div>
          <div><small>90th percentile</small><strong>{duration(s.p90_transit_hours)}</strong><span>Long-tail journey duration</span></div>
        </div>
        <p className="cpa-v2__method-note">Transit duration requires both departure and delivery timestamps. Missing timestamps are excluded, not estimated.</p>
      </GlassPanel>
    </div>
  );
}

function PeriodComparisonChart({ data, days }: { data: CDSAnalyticsPayload; days: number }) {
  const reducedMotion = useReducedMotionPreference();
  const prior = data.period_comparison;
  const metricValue = (value: number | null | undefined) =>
    value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  const rows = [
    { metric: 'Bookings', current: metricValue(data.summary.bookings_received), previous: metricValue(prior?.bookings_received) },
    { metric: 'Clamped', current: metricValue(data.summary.containers_clamped), previous: metricValue(prior?.containers_clamped) },
    { metric: 'Trips started', current: metricValue(data.summary.trips_started), previous: metricValue(prior?.trips_started) },
    { metric: 'Delivered', current: metricValue(data.summary.deliveries_completed), previous: metricValue(prior?.deliveries_completed) },
  ].filter((row): row is { metric: string; current: number; previous: number } =>
    row.current != null && row.previous != null
  );

  return (
    <GlassPanel className="cpa-v2__bar-panel cpa-v2__comparison-chart">
      <div className="cpa-v2__panel-head">
        <div>
          <div className="cpa-v2__kicker"><span>02A</span> PERIOD-OVER-PERIOD / EVENT COUNTS</div>
          <h3>Activity vs previous period</h3>
          <p>Current {days}-day window vs the immediately preceding {days} days. Each event family is compared with its own prior-period count.</p>
        </div>
        <span className="cpa-v2__tag">CURRENT / PRIOR</span>
      </div>
      <div className="cpa-v2__comparison-legend" aria-label="Chart legend">
        <span><i className="is-current" />Current period</span>
        <span><i className="is-previous" />Previous period</span>
      </div>
      {rows.length ? (
        <div className="cpa-v2__rechart cpa-v2__rechart--bar" role="img" aria-label="Grouped horizontal bar chart comparing current and previous period event counts">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" barGap={5} barCategoryGap={23} margin={{ top: 7, right: 35, bottom: 3, left: 0 }}>
              <defs>
                <linearGradient id="cpa-v2-period-current" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#b89053" />
                  <stop offset="55%" stopColor="#e7c47f" />
                  <stop offset="100%" stopColor="#f5dfae" />
                </linearGradient>
                <linearGradient id="cpa-v2-period-prior" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#426c88" />
                  <stop offset="100%" stopColor="#79a8c8" />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal={false} stroke="rgba(178,205,233,.1)" strokeDasharray="3 7" />
              <XAxis type="number" domain={[0, 'dataMax']} allowDecimals={false} tickFormatter={value => fmt(Number(value))} tick={{ fill: 'rgba(169,194,218,.65)', fontSize: 9 }} axisLine={{ stroke: 'rgba(160,198,231,.14)' }} tickLine={false} />
              <YAxis type="category" dataKey="metric" width={92} interval={0} tick={{ fill: 'rgba(201,216,233,.82)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(142,185,237,.055)' }} />
              <Bar dataKey="current" name="Current period" fill="url(#cpa-v2-period-current)" barSize={12} radius={[0, 6, 6, 0]} isAnimationActive={!reducedMotion} animationDuration={850} animationEasing="ease-out">
                <LabelList dataKey="current" position="right" fill="#f4e5c5" fontSize={8} fontWeight={700} />
              </Bar>
              <Bar dataKey="previous" name="Previous period" fill="url(#cpa-v2-period-prior)" barSize={12} radius={[0, 6, 6, 0]} isAnimationActive={!reducedMotion} animationDuration={850} animationEasing="ease-out">
                <LabelList dataKey="previous" position="right" fill="#b9d2e5" fontSize={8} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="cpa-v2__empty-chart"><BarChart3 size={22} /><strong>No comparable prior-period baseline</strong><span>The API did not return comparable values for this reporting window. No zero baseline has been substituted.</span></div>
      )}
      <div className="cpa-v2__chart-footnote">Counts remain distinct event families. This comparison does not imply that bookings, clamp events, trip starts and deliveries form a conversion funnel.</div>
    </GlassPanel>
  );
}

function CorridorActivityChart({ data }: { data: CDSAnalyticsPayload }) {
  const reducedMotion = useReducedMotionPreference();
  const rows = [...(data.lanes ?? [])]
    .filter(row => Number(row.trips_started) > 0)
    .sort((a, b) => Number(b.trips_started) - Number(a.trips_started))
    .slice(0, 8)
    .map(row => ({
      corridor: row.origin + ' → ' + row.destination,
      trips_started: Number(row.trips_started),
    }));
  return (
    <GlassPanel className="cpa-v2__bar-panel">
      <div className="cpa-v2__panel-head">
        <div><div className="cpa-v2__kicker"><span>06A</span> ROUTE VOLUME / EVENT COUNT</div><h3>Trip starts by corridor</h3><p>Highest-volume origin and destination pairs, ranked by recorded trip-start timestamps.</p></div>
        <span className="cpa-v2__tag">TOP {rows.length} CORRIDORS</span>
      </div>
      {rows.length ? (
        <div className="cpa-v2__rechart cpa-v2__rechart--bar" role="img" aria-label="Horizontal bar chart ranking corridors by trips started">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 28, bottom: 2, left: 6 }}>
              <defs>
                <linearGradient id="cpa-v2-corridor-fill" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#57cdbd" />
                  <stop offset="58%" stopColor="#8eb9ed" />
                  <stop offset="100%" stopColor="#e5c17c" />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal={false} stroke="rgba(178,205,233,.1)" strokeDasharray="3 7" />
              <XAxis type="number" domain={[0, 'dataMax']} allowDecimals={false} tick={{ fill: 'rgba(169,194,218,.65)', fontSize: 9 }} axisLine={{ stroke: 'rgba(160,198,231,.14)' }} tickLine={false} />
              <YAxis type="category" dataKey="corridor" width={148} interval={0} tickFormatter={value => String(value).length > 23 ? String(value).slice(0, 20) + '…' : String(value)} tick={{ fill: 'rgba(189,208,228,.78)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(142,185,237,.07)' }} />
              <Bar dataKey="trips_started" name="Trips started" fill="url(#cpa-v2-corridor-fill)" barSize={22} radius={[0, 8, 8, 0]} isAnimationActive={!reducedMotion} animationDuration={920} animationEasing="ease-out">
                <LabelList dataKey="trips_started" position="right" fill="#eaf2fb" fontSize={9} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="cpa-v2__empty-state">No corridor trip-start activity is available in this reporting window.</div>}
      <div className="cpa-v2__chart-footnote">Counts are trip-start events grouped by origin and destination. Delivery counts and current delays remain separate measures in the corridor register below.</div>
    </GlassPanel>
  );
}

function LaneAnalysis({ data }: { data: CDSAnalyticsPayload }) {
  const lanes = data.lanes ?? [];
  const highest = Math.max(1, ...lanes.map(row => row.trips_started));
  return (
    <GlassPanel className="cpa-v2__lane-panel" id="cds-lanes">
      <div className="cpa-v2__panel-head">
        <div><div className="cpa-v2__kicker"><span>06</span> NETWORK FLOW</div><h3>Corridor performance</h3><p>Trip-start cohort by origin and destination; completion is observed as of this snapshot.</p></div>
        <span className="cpa-v2__tag">{lanes.length} CORRIDORS</span>
      </div>
      {lanes.length ? (
        <div className="cpa-v2__table-scroll">
          <table className="cpa-v2__table">
            <thead><tr><th>Corridor</th><th>Trips started</th><th>Delivered to date</th><th>Completion</th><th>Median transit</th><th>Delayed now</th></tr></thead>
            <tbody>{lanes.map((lane, index) => (
              <tr key={lane.origin + '|' + lane.destination + '|' + index}>
                <td><strong>{lane.origin}</strong><span>→ {lane.destination}</span></td>
                <td><b>{fmt(lane.trips_started)}</b><i className="cpa-v2__table-meter"><span style={{ width: (lane.trips_started / highest * 100) + '%' }} /></i></td>
                <td>{fmt(lane.deliveries_completed)}</td>
                <td><strong>{pct(lane.delivery_completion_pct)}</strong></td>
                <td>{duration(lane.p50_transit_hours ?? lane.avg_transit_hours)}</td>
                <td><span className={'cpa-v2__number-pill ' + (lane.currently_delayed > 0 ? 'is-risk' : 'is-clear')}>{fmt(lane.currently_delayed)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="cpa-v2__empty-state">No corridor records are available for this reporting window.</div>}
    </GlassPanel>
  );
}

function PartnerVolumeChart({ partners }: {
  partners: NonNullable<CDSAnalyticsPayload['transporter_leaderboard']>;
}) {
  const reducedMotion = useReducedMotionPreference();
  const rows = [...partners]
    .filter(partner => Number(partner.containers_handled) > 0)
    .sort((a, b) => Number(b.containers_handled) - Number(a.containers_handled))
    .slice(0, 8)
    .map(partner => ({ partner: partner.company_name, containers_handled: Number(partner.containers_handled) }));
  return (
    <div className="cpa-v2__partner-volume">
      <div className="cpa-v2__subchart-heading"><strong>Container volume by partner</strong><span>Distinct containers handled · top {rows.length}</span></div>
      {rows.length ? (
        <div className="cpa-v2__rechart cpa-v2__rechart--partner" role="img" aria-label="Horizontal bar chart ranking transport partners by containers handled">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="cpa-v2-partner-fill" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#83b8ff" />
                  <stop offset="60%" stopColor="#b29aff" />
                  <stop offset="100%" stopColor="#e5c17c" />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal={false} stroke="rgba(178,205,233,.09)" strokeDasharray="3 7" />
              <XAxis type="number" domain={[0, 'dataMax']} allowDecimals={false} tick={{ fill: 'rgba(169,194,218,.62)', fontSize: 9 }} axisLine={{ stroke: 'rgba(160,198,231,.12)' }} tickLine={false} />
              <YAxis type="category" dataKey="partner" width={134} interval={0} tickFormatter={value => String(value).length > 19 ? String(value).slice(0, 16) + '…' : String(value)} tick={{ fill: 'rgba(189,208,228,.73)', fontSize: 8 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(178,154,255,.06)' }} />
              <Bar dataKey="containers_handled" name="Containers handled" fill="url(#cpa-v2-partner-fill)" barSize={18} radius={[0, 7, 7, 0]} isAnimationActive={!reducedMotion} animationDuration={880} animationEasing="ease-out">
                <LabelList dataKey="containers_handled" position="right" fill="#eaf2fb" fontSize={9} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="cpa-v2__empty-state">No partner-linked container activity is recorded for this period.</div>}
    </div>
  );
}

function PartnerAnalysis({ data }: { data: CDSAnalyticsPayload }) {
  const partners = data.transporter_leaderboard ?? [];
  return (
    <GlassPanel id="cds-partners" className="cpa-v2__partner-panel">
      <div className="cpa-v2__panel-head">
        <div><div className="cpa-v2__kicker"><span>07</span> CARRIER NETWORK</div><h3>Transport partner scorecard</h3><p>Volume, delivery activity and ETA adherence for completed deliveries with a recorded ETA.</p></div>
        <span className="cpa-v2__tag">{partners.length} ACTIVE PARTNERS</span>
      </div>
      {partners.length ? (
        <>
        <PartnerVolumeChart partners={partners} />
        <div className="cpa-v2__partner-list">
          {partners.slice(0, 8).map((partner, index) => (
            <article className="cpa-v2__partner-row" key={partner.transporter_id}>
              <span className="cpa-v2__rank">{String(index + 1).padStart(2, '0')}</span>
              <div className="cpa-v2__partner-name"><strong>{partner.company_name}</strong><span>{fmt(partner.containers_handled)} containers · {fmt(partner.trips_started)} trips started</span></div>
              <div className="cpa-v2__partner-deliveries"><strong>{fmt(partner.deliveries_completed)}</strong><span>Delivered</span></div>
              <div className="cpa-v2__partner-rate"><strong>{pct(partner.on_time_rate)}</strong><span>{fmt(partner.on_time_deliveries)} / {fmt(partner.delivery_eta_observed)} ETA sample</span></div>
              <span className={'cpa-v2__number-pill ' + (partner.currently_delayed > 0 ? 'is-risk' : 'is-clear')}>{fmt(partner.currently_delayed)} delayed now</span>
            </article>
          ))}
        </div>
        </>
      ) : <div className="cpa-v2__empty-state">No partner-linked trips or container activity in this period.</div>}
      <div className="cpa-v2__method-note">ETA adherence is not a contractual on-time-delivery score unless the recorded ETA represents the agreed customer commitment.</div>
    </GlassPanel>
  );
}

function AssetIntegrity({ data }: { data: CDSAnalyticsPayload }) {
  const s = data.summary;
  return (
    <div className="cpa-v2__asset-grid" id="cds-assets">
      <GlassPanel className="cpa-v2__asset-card">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>08</span> CONTAINER INVENTORY</div><h3>Availability & condition</h3></div><PackageCheck size={17} /></div>
        <div className="cpa-v2__asset-big"><strong>{fmt(s.total_containers)}</strong><span>registered containers</span></div>
        <div className="cpa-v2__asset-stack">
          <ProgressLine label="In use" value={s.containers_in_use} denominator={Math.max(1, s.total_containers)} color="#5ce0c3" />
          <ProgressLine label="Available" value={s.available_containers} denominator={Math.max(1, s.total_containers)} color="#83b8ff" />
          <ProgressLine label="Maintenance" value={s.containers_in_maintenance} denominator={Math.max(1, s.total_containers)} color="#f3bd70" />
        </div>
        <div className="cpa-v2__asset-foot">
          <div><strong>{pct(s.container_utilization_pct)}</strong><span>Registered-fleet share in use</span></div>
          <div><strong>{fmt(s.damaged_containers + s.retired_containers)}</strong><span>Damaged or retired</span></div>
        </div>
        <small className="cpa-v2__method-note">Inventory share is a point-in-time status ratio, not a time-based utilization rate.</small>
      </GlassPanel>
      <GlassPanel className="cpa-v2__asset-card">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>09</span> VEHICLE REGISTER</div><h3>Fleet deployment state</h3></div><Truck size={17} /></div>
        <div className="cpa-v2__asset-big"><strong>{fmt(s.total_vehicles)}</strong><span>registered vehicles</span></div>
        <div className="cpa-v2__asset-stack">
          <ProgressLine label="In use" value={s.vehicles_in_use} denominator={Math.max(1, s.total_vehicles)} color="#5ce0c3" />
          <ProgressLine label="Available" value={s.available_vehicles} denominator={Math.max(1, s.total_vehicles)} color="#83b8ff" />
          <ProgressLine label="Maintenance" value={s.vehicles_in_maintenance} denominator={Math.max(1, s.total_vehicles)} color="#f3bd70" />
        </div>
        <div className="cpa-v2__asset-foot">
          <div><strong>{pct(s.vehicle_utilization_pct)}</strong><span>In-use share of ready vehicles</span></div>
          <div><strong>{fmt(s.active_drivers)}</strong><span>Active drivers</span></div>
        </div>
        <small className="cpa-v2__method-note">Status-derived deployment share; operating hours and idle time are not available in this measure.</small>
      </GlassPanel>
      <GlassPanel className="cpa-v2__asset-card">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>10</span> E-LOCK POSTURE</div><h3>Device integrity</h3></div><ShieldAlert size={17} /></div>
        <div className="cpa-v2__asset-big"><strong>{fmt(s.total_locks)}</strong><span>registered locks</span></div>
        <div className="cpa-v2__lock-tiles">
          <div><strong>{fmt(s.locks_in_use)}</strong><span>Assigned / installed</span></div>
          <div className={s.locks_needing_attention > 0 ? 'is-risk' : ''}><strong>{fmt(s.locks_needing_attention)}</strong><span>Need attention</span></div>
          <div className={s.tampered_locks > 0 ? 'is-risk' : ''}><strong>{fmt(s.tampered_locks)}</strong><span>Tamper flags</span></div>
          <div><strong>{fmt(s.stale_lock_heartbeats)}</strong><span>Stale heartbeat</span></div>
        </div>
        <div className="cpa-v2__asset-foot"><div><strong>{fmt(s.low_battery_locks)}</strong><span>Battery below 25%</span></div><div><strong>{fmt(s.open_incidents)}</strong><span>Open incidents</span></div></div>
        <small className="cpa-v2__method-note">Counts are current persisted inventory fields, not a live hardware poll.</small>
      </GlassPanel>
      <GlassPanel className="cpa-v2__asset-card cpa-v2__inspection-card">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>11</span> READINESS / COMPLIANCE</div><h3>Inspection exposure</h3></div><Clock3 size={17} /></div>
        <div className="cpa-v2__inspection-stats">
          <div className="is-risk"><strong>{fmt(s.overdue_inspections)}</strong><span>Overdue inspections</span></div>
          <div><strong>{fmt(s.inspections_due_30_days)}</strong><span>Due within 30 days</span></div>
          <div><strong>{fmt(s.containers_missing_location)}</strong><span>Without location</span></div>
          <div><strong>{fmt(s.unclamped_locks)}</strong><span>Unclamped locks</span></div>
        </div>
        <small className="cpa-v2__method-note">Missing inspection due dates are not counted as overdue; no date is a separate data gap.</small>
      </GlassPanel>
    </div>
  );
}

function OperationsAnalysis({ data }: { data: CDSAnalyticsPayload }) {
  const s = data.summary;
  const operatorRows = data.operator_leaderboard ?? [];
  const operatorMax = Math.max(1, ...operatorRows.map(row => row.clamp_actions + row.unclamp_actions));
  const dataGaps = [
    { label: 'Vehicle missing', value: s.trips_missing_vehicle },
    { label: 'Driver missing', value: s.trips_missing_driver },
    { label: 'Container missing', value: s.trips_missing_container },
    { label: 'E-Lock missing', value: s.trips_missing_lock },
    { label: 'ETA missing', value: s.trips_missing_eta },
  ];
  const dataGapTotal = dataGaps.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="cpa-v2__ops-grid">
      <GlassPanel className="cpa-v2__operator-panel">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>12</span> FIELD EXECUTION</div><h3>Operator activity</h3><p>Distinct containers and recorded clamp / unclamp audit actions within the selected period.</p></div><Users size={17} /></div>
        {operatorRows.length ? <div className="cpa-v2__operator-list">
          {operatorRows.slice(0, 8).map(operator => {
            const actions = operator.clamp_actions + operator.unclamp_actions;
            return <div className="cpa-v2__operator-row" key={operator.operator_id}>
              <div className="cpa-v2__operator-meta"><strong>{operator.operator_name}</strong><span>{fmt(operator.containers_clamped)} clamped · {fmt(operator.containers_unclamped)} unclamped</span><b>{fmt(actions)} actions</b></div>
              <div className="cpa-v2__progress-track"><span style={{ width: (actions / operatorMax * 100) + '%' }} /></div>
              <small>Last recorded action · {displayDateTime(operator.last_action_at)}</small>
            </div>;
          })}
        </div> : <div className="cpa-v2__empty-state">No clamp or unclamp audit events were attributed to operators in this window.</div>}
        <div className="cpa-v2__method-note">Activity counts are not productivity rankings: labor hours, shift time and task complexity are not part of the source data.</div>
      </GlassPanel>
      <GlassPanel className="cpa-v2__quality-panel">
        <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>13</span> RECORD INTEGRITY</div><h3>Trip data completeness</h3><p>Assignment checks apply only to lifecycle stages that require those fields.</p></div><Gauge size={17} /></div>
        <div className="cpa-v2__quality-total"><strong>{fmt(s.trips_with_data_gaps)}</strong><span>trips with one or more required fields missing</span></div>
        <div className="cpa-v2__quality-list">
          {dataGaps.map(item => <div key={item.label}><span>{item.label}</span><strong>{fmt(item.value)}</strong></div>)}
        </div>
        <div className="cpa-v2__quality-foot">{fmt(dataGapTotal)} missing-field signals across {fmt(s.trips_with_data_gaps)} affected trips. Signals can overlap on the same trip.</div>
      </GlassPanel>
    </div>
  );
}

function ExceptionQueue({ data }: { data: CDSAnalyticsPayload }) {
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const acknowledge = useAcknowledgeAlert();
  const { addToast } = useCDSStore();
  const alerts = (data.alerts ?? []).filter(alert => {
    const severity = String(alert.severity || 'low').toLowerCase();
    const q = query.trim().toLowerCase();
    return (filter === 'all' || severity === filter)
      && (!q || [alert.title, alert.message, alert.type, alert.entity_type, alert.entity_id].some(value => String(value || '').toLowerCase().includes(q)));
  });
  const visible = expanded ? alerts : alerts.slice(0, 5);
  return (
    <GlassPanel id="cds-exceptions" className="cpa-v2__exception-panel">
      <div className="cpa-v2__panel-head">
        <div><div className="cpa-v2__kicker"><span>14</span> ACTION / EXCEPTION REGISTER</div><h3>Exceptions requiring attention</h3><p>Open, unacknowledged alerts returned by the persisted CDS snapshot.</p></div>
        <span className="cpa-v2__tag">{alerts.length} MATCHING</span>
      </div>
      <div className="cpa-v2__exception-tools">
        <div className="cpa-v2__filter-row" role="group" aria-label="Filter alert severity">
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map(level => <button key={level} type="button" aria-pressed={filter === level} onClick={() => { setFilter(level); setExpanded(false); }}>{level === 'all' ? 'All' : level}</button>)}
        </div>
        <input aria-label="Search exceptions" value={query} onChange={event => { setQuery(event.target.value); setExpanded(false); }} placeholder="Search alert, entity or type" />
      </div>
      {visible.length ? <div className="cpa-v2__alert-list">
        {visible.map(alert => {
          const severity = String(alert.severity || 'low').toLowerCase();
          return <article className={'cpa-v2__alert-row is-' + severity} key={alert.id}>
            <span className="cpa-v2__alert-mark"><AlertTriangle size={15} /></span>
            <div className="cpa-v2__alert-copy"><div><strong>{alert.title || alert.message || 'Untitled alert'}</strong><em>{severity.toUpperCase()}</em></div><p>{alert.message && alert.title ? alert.message : 'No additional message was recorded.'}</p><small>{String(alert.type || 'alert').replaceAll('_', ' ')} · {alert.entity_type || 'Unlinked entity'} · {displayDateTime(alert.created_at)}</small></div>
            <button type="button" className="cpa-v2__ack-button" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(alert.id, { onSuccess: () => addToast('Alert acknowledged'), onError: () => addToast('Could not acknowledge this alert', 'error') })}>Acknowledge</button>
          </article>;
        })}
      </div> : <div className="cpa-v2__empty-state">No alert records match these filters.</div>}
      {alerts.length > 5 ? <button type="button" className="cpa-v2__expand-button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer' : 'Show all ' + alerts.length + ' alerts'}</button> : null}
    </GlassPanel>
  );
}

function OverdueClamps({ data }: { data: CDSAnalyticsPayload }) {
  const s = data.summary;
  const rows = data.overdue_clamps ?? [];
  return (
    <GlassPanel className="cpa-v2__overdue-panel">
      <div className="cpa-v2__panel-head"><div><div className="cpa-v2__kicker"><span>15</span> DWELL / UNRESOLVED CLAMPS</div><h3>Clamp dwell exposure</h3><p>Current clamps older than 24 hours, with manifest and audit attribution where recorded.</p></div><span className="cpa-v2__number-pill is-risk">{fmt(s.containers_clamped_over_24h)} overdue</span></div>
      <div className="cpa-v2__dwell-stats">
        <div><small>Currently clamped</small><strong>{fmt(s.containers_currently_clamped)}</strong></div>
        <div><small>Average completed dwell</small><strong>{duration(s.avg_clamp_duration_hours)}</strong></div>
        <div><small>Median completed dwell</small><strong>{duration(s.p50_clamp_duration_hours)}</strong></div>
        <div><small>90th percentile dwell</small><strong>{duration(s.p90_clamp_duration_hours)}</strong></div>
        <div><small>Unclamped after 24h</small><strong>{fmt(s.unclamps_after_24h)}</strong></div>
      </div>
      {rows.length ? <div className="cpa-v2__table-scroll"><table className="cpa-v2__table cpa-v2__clamp-table">
        <thead><tr><th>Container / booking</th><th>Clamp operator</th><th>Driver / lock</th><th>Clamped since</th><th>Elapsed</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.booking_number + '|' + row.container_number + '|' + index}>
          <td><strong>{row.container_number}</strong><span>Booking {row.booking_number}</span></td>
          <td>{row.clamp_operator}</td>
          <td>{row.driver_name}<span>{row.lock_number}</span></td>
          <td>{displayDateTime(row.clamped_at)}</td>
          <td><span className="cpa-v2__number-pill is-risk">{Number(row.hours_clamped).toFixed(1)}h</span></td>
        </tr>)}</tbody>
      </table></div> : <div className="cpa-v2__empty-state cpa-v2__empty-state--clear"><CheckCircle2 size={18} /> No currently active clamp has exceeded 24 hours.</div>}
    </GlassPanel>
  );
}

function SnapshotSignals({ data }: { data: CDSAnalyticsPayload }) {
  const s = data.summary;
  const signals = [
    {
      key: 'delays',
      label: 'Delayed journeys',
      value: s.delayed_trips,
      note: 'Trips currently carrying delayed status',
      tone: s.delayed_trips > 0 ? 'attention' : 'quiet',
    },
    {
      key: 'locks',
      label: 'Lock attention',
      value: s.locks_needing_attention,
      note: fmt(s.tampered_locks) + ' tamper · ' + fmt(s.stale_lock_heartbeats) + ' stale · ' + fmt(s.low_battery_locks) + ' low battery',
      tone: s.locks_needing_attention > 0 ? 'attention' : 'quiet',
    },
    {
      key: 'inspections',
      label: 'Overdue inspections',
      value: s.overdue_inspections,
      note: 'Assets past their recorded inspection date',
      tone: s.overdue_inspections > 0 ? 'attention' : 'quiet',
    },
    {
      key: 'completeness',
      label: 'Trip data gaps',
      value: s.trips_with_data_gaps,
      note: 'Active trips missing one or more required fields',
      tone: s.trips_with_data_gaps > 0 ? 'attention' : 'quiet',
    },
  ];
  return (
    <section className="cpa-v2__signals" aria-label="Current operational posture">
      <div className="cpa-v2__signals-head">
        <div>
          <div className="cpa-v2__kicker"><span>POSTURE</span> CURRENT-STATE EVIDENCE</div>
          <h3>Operational signals</h3>
        </div>
        <span className="cpa-v2__signals-context">Snapshot measures · independent of reporting window</span>
      </div>
      <div className="cpa-v2__signals-grid">
        {signals.map(signal => (
          <article key={signal.key} className={'cpa-v2__signal is-' + signal.tone}>
            <div className="cpa-v2__signal-top"><span>{signal.label}</span><i aria-hidden="true" /></div>
            <strong>{fmt(signal.value)}</strong>
            <small>{signal.note}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AnalyticsView() {
  const [days, setDays] = useState<7 | 30 | 90 | 365>(30);
  const [section, setSection] = useState<'overview' | 'network' | 'fleet' | 'exceptions'>('overview');
  const { data, isLoading, isError, error, isFetching, refetch } = useCDSAnalytics(days);

  if (isLoading) return <div className="cds-performance-analysis-v2"><div className="cpa-v2__loading" role="status" aria-live="polite"><span className="cpa-v2__loading-orbit" aria-hidden="true"><i /></span><strong>Preparing the analysis workspace</strong><small>Retrieving the selected CDS reporting window</small></div></div>;
  if (!data || !data.summary) {
    const details = error && typeof error === 'object'
      ? error as { response?: { status?: unknown; data?: { error?: unknown } }; code?: unknown }
      : null;
    const status = details?.response?.status;
    const failure = typeof status === 'number'
      ? 'The analytics endpoint returned HTTP ' + status + '. No sample data has been substituted.'
      : details?.code === 'ERR_NETWORK'
        ? 'The analytics endpoint did not return an HTTP response. No sample data has been substituted.'
        : 'An authoritative CDS analytics snapshot was not returned. No sample data has been substituted.';
    return <div className="cds-performance-analysis-v2"><div className="cpa-v2__error"><ShieldAlert size={22} /><div><strong>Performance snapshot unavailable</strong><p>{failure}</p><button type="button" onClick={() => { void refetch(); }} disabled={isFetching}><RefreshCw size={14} />{isFetching ? 'Reconnecting' : 'Retry snapshot'}</button></div></div></div>;
  }

  const s: CDSAnalyticsSummary = data.summary;
  const previous = data.period_comparison;
  const comparison = (current: number | null | undefined, old: number | null | undefined) => previous ? compareLabel(current, old) : 'No prior-period baseline';
  const generatedAt = new Date(data.meta.generated_at);
  const snapshotAge = Number.isFinite(generatedAt.getTime())
    ? Math.max(0, Math.floor((Date.now() - generatedAt.getTime()) / 60000))
    : null;

  const kpis = [
    { label: 'Bookings received', value: fmt(s.bookings_received), note: 'New bookings · selected period', comparison: comparison(s.bookings_received, previous?.bookings_received), color: 'gold', icon: PackageCheck },
    { label: 'Containers clamped', value: fmt(s.containers_clamped), note: 'Distinct container records', comparison: comparison(s.containers_clamped, previous?.containers_clamped), color: 'teal', icon: CheckCircle2 },
    { label: 'Trips started', value: fmt(s.trips_started), note: 'Trip creation timestamps', comparison: comparison(s.trips_started, previous?.trips_started), color: 'blue', icon: Truck },
    { label: 'Deliveries completed', value: fmt(s.deliveries_completed), note: 'Delivery timestamps in window', comparison: comparison(s.deliveries_completed, previous?.deliveries_completed), color: 'violet', icon: PackageCheck },
    { label: 'ETA adherence', value: pct(s.eta_attainment_pct), note: fmt(s.eta_met) + ' / ' + fmt(s.eta_observed) + ' known-ETA deliveries', comparison: previous?.eta_observed ? compareRate(s.eta_attainment_pct, previous.eta_attainment_pct) : 'No comparable ETA sample', color: 'blue', icon: Gauge },
    { label: 'Clamped beyond 24h', value: fmt(s.containers_clamped_over_24h), note: 'Current unresolved exposure', color: 'risk', icon: AlertTriangle, emphasis: s.containers_clamped_over_24h > 0 },
  ];

  return (
    <div className="cds-performance-analysis-v2">
      <div className="cpa-v2__space" aria-hidden="true"><span /><i /><b /></div>
      <header className="cpa-v2__hero">
        <div className="cpa-v2__hero-art" aria-hidden="true"><span /><span /><span /></div>
        <div className="cpa-v2__hero-main">
          <div className="cpa-v2__eyebrow"><span className="cpa-v2__brand-mark"><Activity size={14} /></span> SONALIT / CDS INTELLIGENCE <i /> PERFORMANCE ANALYSIS</div>
          <h2>Performance Analysis</h2>
          <p>Throughput, conversion, service reliability and asset exposure — grounded in recorded operations.</p>
          <div className="cpa-v2__hero-meta">
            <span><small>REPORTING PERIOD</small><strong>{dateLabel(data.meta.period_start)} — {dateLabel(data.meta.period_end)}</strong></span>
            <span><small>SNAPSHOT</small><strong>{snapshotAge == null ? 'Age unknown' : snapshotAge < 1 ? 'Just generated' : snapshotAge + ' min ago'}</strong></span>
            <span><small>DATA BASIS</small><strong>Persisted CDS records</strong></span>
          </div>
        </div>
        <div className="cpa-v2__hero-controls">
          <div className="cpa-v2__range-control" role="group" aria-label="Reporting period">
            {([7, 30, 90, 365] as const).map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value}D</button>)}
          </div>
          <button type="button" className="cpa-v2__refresh" disabled={isFetching} onClick={() => { void refetch(); }}><RefreshCw size={14} className={isFetching ? 'is-spinning' : ''} />{isFetching ? 'Updating' : 'Refresh'}</button>
        </div>
      </header>

      <nav className="cpa-v2__section-nav" role="group" aria-label="Performance analysis workspaces">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'network', label: 'Network' },
          { id: 'fleet', label: 'Fleet & equipment' },
          { id: 'exceptions', label: 'Exceptions' },
        ] as const).map(tab => (
          <button key={tab.id} type="button" aria-pressed={section === tab.id}
            onClick={() => setSection(tab.id)}>{tab.label}</button>
        ))}
      </nav>

      {isError ? <div className="cpa-v2__stale-banner"><AlertTriangle size={14} /> Latest refresh failed. The previously loaded database snapshot is retained; it has not been replaced with sample figures.</div> : null}

      <section className="cpa-v2__kpi-grid" aria-label="Performance indicators">
        {kpis.map(kpi => <KpiTile key={kpi.label} {...kpi} />)}
      </section>
      <div className="cpa-v2__comparison-note"><span>PERIOD COMPARISON</span><strong>Current {days} days vs immediately preceding {days} days</strong><small>Volume changes are descriptive; a higher count is not automatically a better outcome.</small></div>
      <SnapshotSignals data={data} />

      {section === 'overview' ? (
        <div id="cpa-panel-overview" className="cpa-v2__workspace" role="region" aria-label="Performance overview" tabIndex={0}>
          <div className="cpa-v2__analysis-grid cpa-v2__analysis-grid--hero-chart">
            <TrendChart daily={data.daily} />
          </div>
          <DailyActivityProfile daily={data.daily} />
          <div className="cpa-v2__chart-pair" aria-label="Booking distribution and period comparison charts">
            <BookingMix data={data} />
            <PeriodComparisonChart data={data} days={days} />
          </div>
          <div className="cpa-v2__analysis-grid cpa-v2__analysis-grid--service">
            <BookingCohort data={data} />
            <ServiceQuality data={data} />
          </div>
        </div>
      ) : null}
      {section === 'network' ? (
        <div id="cpa-panel-network" className="cpa-v2__workspace" role="region" aria-label="Network performance" tabIndex={0}>
          <SectionHeading index="06–07" kicker="CARRIER / CORRIDOR PERFORMANCE" title="Network execution" />
          <CorridorActivityChart data={data} />
          <LaneAnalysis data={data} />
          <PartnerAnalysis data={data} />
        </div>
      ) : null}
      {section === 'fleet' ? (
        <div id="cpa-panel-fleet" className="cpa-v2__workspace" role="region" aria-label="Fleet and equipment performance" tabIndex={0}>
          <SectionHeading index="01–02" kicker="FLEET / EQUIPMENT / ASSURANCE" title="Asset integrity & readiness" />
          <AssetIntegrity data={data} />
          <OperationsAnalysis data={data} />
        </div>
      ) : null}
      {section === 'exceptions' ? (
        <div id="cpa-panel-exceptions" className="cpa-v2__workspace" role="region" aria-label="Operational exceptions" tabIndex={0}>
          <SectionHeading index="14–15" kicker="EXPOSURE / ACTION REQUIRED" title="Operational exceptions" />
          <div className="cpa-v2__ops-grid">
            <OverdueClamps data={data} />
            <ExceptionQueue data={data} />
          </div>
        </div>
      ) : null}

      <footer className="cpa-v2__method">
        <div><strong>Method & interpretation</strong><p>Period activity uses event timestamps. Booking Mix follows the selected-period booking cohort and its latest recorded stage. Conversion steps count distinct bookings with linked evidence. ETA adherence uses completed deliveries with a recorded ETA; a contractual SLA cannot be inferred from ETA alone. Inventory and unresolved exposure panels are current-state snapshots. Missing records are excluded where a metric requires them — they are never imputed.</p></div>
        <div className="cpa-v2__method-stamp"><span>GENERATED</span><strong>{displayDateTime(data.meta.generated_at)}</strong><span>{isFetching ? 'REFRESH IN PROGRESS' : 'PERSISTED SNAPSHOT'}</span></div>
      </footer>
    </div>
  );
}
