import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CDSAnalyticsPayload } from './types.js';

export type DailyMetric =
  | 'bookings_received'
  | 'containers_clamped'
  | 'containers_unclamped'
  | 'trips_started'
  | 'deliveries_completed';

type DailyRows = CDSAnalyticsPayload['daily'];

export const dailyMetricOptions: Array<{ id: DailyMetric; label: string; color: string }> = [
  { id: 'bookings_received', label: 'Bookings', color: '#e5c17c' },
  { id: 'containers_clamped', label: 'Clamped', color: '#5ce0c3' },
  { id: 'containers_unclamped', label: 'Unclamped', color: '#83b8ff' },
  { id: 'trips_started', label: 'Trips started', color: '#b49aff' },
  { id: 'deliveries_completed', label: 'Delivered', color: '#d8bd75' },
];

const valueOf = (row: DailyRows[number], metric: DailyMetric): number | null => {
  const raw = row[metric];
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
};

const percentile = (values: number[], ratio: number): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ratio * ordered.length) - 1)];
};

export type DailyHistogramBin = {
  key: string;
  label: string;
  min: number;
  max: number;
  days: number;
};

export function buildDailyHistogram(daily: DailyRows, metric: DailyMetric) {
  const values = daily.map(row => valueOf(row, metric)).filter((value): value is number => value != null);
  const zeroDays = values.filter(value => value === 0).length;
  const activeDays = values.length - zeroDays;
  if (!values.length) return { bins: [] as DailyHistogramBin[], median: null, p90: null, zeroDays: 0, activeDays: 0, observedDays: 0 };

  const maximum = Math.max(...values);
  if (maximum === 0) {
    return {
      bins: [{ key: '0', label: '0', min: 0, max: 0, days: values.length }],
      median: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      zeroDays,
      activeDays,
      observedDays: values.length,
    };
  }

  const targetBins = Math.max(4, Math.min(10, Math.ceil(Math.sqrt(values.length))));
  const roughStep = Math.max(1, Math.ceil((maximum + 1) / targetBins));
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const binCount = Math.max(1, Math.ceil((maximum + 1) / step));
  const bins: DailyHistogramBin[] = Array.from({ length: binCount }, (_, index) => {
    const min = index * step;
    const max = Math.min((index + 1) * step - 1, maximum);
    return { key: String(index), label: min === max ? String(min) : min + '–' + max, min, max, days: 0 };
  });

  values.forEach(value => {
    const index = Math.min(binCount - 1, Math.floor(value / step));
    bins[index].days += 1;
  });

  return {
    bins,
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    zeroDays,
    activeDays,
    observedDays: values.length,
  };
}

export type ActivityCalendarCell = { day: string; value: number | null; level: number };
export type ActivityCalendarWeek = { start: string; monthLabel: string; cells: Array<ActivityCalendarCell | null> };

const utcDate = (day: string) => new Date(day + 'T00:00:00.000Z');
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildActivityCalendar(daily: DailyRows, metric: DailyMetric): ActivityCalendarWeek[] {
  if (!daily.length) return [];
  const ordered = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const firstDate = utcDate(ordered[0].day);
  const lastDate = utcDate(ordered[ordered.length - 1].day);
  if (!Number.isFinite(firstDate.getTime()) || !Number.isFinite(lastDate.getTime())) return [];

  const mondayOffset = (firstDate.getUTCDay() + 6) % 7;
  const gridStart = new Date(firstDate.getTime() - mondayOffset * DAY_MS);
  const spanDays = Math.floor((lastDate.getTime() - gridStart.getTime()) / DAY_MS) + 1;
  const weekCount = Math.ceil(spanDays / 7);
  const values = ordered.map(row => valueOf(row, metric)).filter((value): value is number => value != null && value > 0);
  const q25 = percentile(values, 0.25);
  const q50 = percentile(values, 0.5);
  const q75 = percentile(values, 0.75);

  const weeks: ActivityCalendarWeek[] = Array.from({ length: weekCount }, (_, index) => {
    const start = new Date(gridStart.getTime() + index * 7 * DAY_MS);
    const startMs = start.getTime();
    const monthAnchor = ordered.find(row => {
      const dateMs = utcDate(row.day).getTime();
      return dateMs >= startMs && dateMs < startMs + 7 * DAY_MS && row.day.slice(8, 10) === '01';
    });
    const firstObserved = ordered.find(row => {
      const dateMs = utcDate(row.day).getTime();
      return dateMs >= startMs && dateMs < startMs + 7 * DAY_MS;
    });
    const monthDate = (monthAnchor?.day ?? (index === 0 ? firstObserved?.day : undefined));
    const monthLabel = monthDate
      ? utcDate(monthDate).toLocaleDateString([], { month: 'short', timeZone: 'UTC' })
      : '';
    return {
      start: isoDay(start),
      monthLabel,
      cells: Array.from({ length: 7 }, () => null),
    };
  });

  ordered.forEach(row => {
    const date = utcDate(row.day);
    const offset = Math.floor((date.getTime() - gridStart.getTime()) / DAY_MS);
    if (!Number.isFinite(offset) || offset < 0) return;
    const weekIndex = Math.floor(offset / 7);
    const weekdayIndex = offset % 7;
    const value = valueOf(row, metric);
    const level = value == null ? -1
      : value === 0 ? 0
      : value <= (q25 ?? value) ? 1
      : value <= (q50 ?? value) ? 2
      : value <= (q75 ?? value) ? 3
      : 4;
    if (weeks[weekIndex]) weeks[weekIndex].cells[weekdayIndex] = { day: row.day, value, level };
  });

  return weeks;
}

const shortDate = (day: string) => {
  const date = new Date(day + 'T12:00:00');
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const fmt = (value: number | null) => value == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

function HistogramTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value?: number }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cpa-v2__chart-tooltip">
      <strong className="cpa-v2__chart-tooltip-title">{label} events per day</strong>
      <div className="cpa-v2__chart-tooltip-row"><i style={{ background: '#e5c17c' }} /><span>Calendar days</span><b>{fmt(payload[0]?.value ?? null)}</b></div>
    </div>
  );
}

export function DailyActivityProfile({ daily }: { daily: DailyRows }) {
  const [metric, setMetric] = useState<DailyMetric>('bookings_received');
  const [selectedDay, setSelectedDay] = useState(() => daily[daily.length - 1]?.day ?? '');
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const histogram = useMemo(() => buildDailyHistogram(daily, metric), [daily, metric]);
  const weeks = useMemo(() => buildActivityCalendar(daily, metric), [daily, metric]);
  const selectedMetric = dailyMetricOptions.find(option => option.id === metric) ?? dailyMetricOptions[0];
  const p90BinKey = histogram.bins.find(bin => histogram.p90 != null && histogram.p90 >= bin.min && histogram.p90 <= bin.max)?.key;
  const currentDay = daily.find(row => row.day === selectedDay) ?? daily[daily.length - 1] ?? null;
  const currentValue = currentDay ? valueOf(currentDay, metric) : null;
  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const dayValues = [
    { id: 'bookings_received', label: 'Bookings', value: currentDay ? valueOf(currentDay, 'bookings_received') : null, color: '#e5c17c' },
    { id: 'containers_clamped', label: 'Clamped', value: currentDay ? valueOf(currentDay, 'containers_clamped') : null, color: '#5ce0c3' },
    { id: 'containers_unclamped', label: 'Unclamped', value: currentDay ? valueOf(currentDay, 'containers_unclamped') : null, color: '#83b8ff' },
    { id: 'trips_started', label: 'Trips started', value: currentDay ? valueOf(currentDay, 'trips_started') : null, color: '#b49aff' },
    { id: 'deliveries_completed', label: 'Delivered', value: currentDay ? valueOf(currentDay, 'deliveries_completed') : null, color: '#d8bd75' },
  ];

  return (
    <section className="cpa-v2__panel cpa-v2__activity-profile" aria-label="Daily activity distribution and calendar">
      <div className="cpa-v2__profile-head">
        <div>
          <div className="cpa-v2__kicker"><span>02B</span> DAILY FREQUENCY / CALENDAR INTENSITY</div>
          <h3>Activity profile</h3>
          <p>See how frequently events occur, then locate each active day across the reporting window.</p>
        </div>
        <div className="cpa-v2__profile-metric" role="group" aria-label="Select activity profile metric">
          {dailyMetricOptions.map(option => (
            <button key={option.id} type="button" aria-pressed={metric === option.id}
              onClick={() => setMetric(option.id)}>
              <i style={{ background: option.color }} />{option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cpa-v2__rhythm-grid">
        <article className="cpa-v2__profile-card cpa-v2__distribution-card">
          <div className="cpa-v2__profile-card-head">
            <div><small>VOLUME DISTRIBUTION</small><strong>Events per calendar day</strong></div>
            <span>{histogram.observedDays} observed days</span>
          </div>
          <div className="cpa-v2__distribution-stats">
            <div><small>MEDIAN / DAY</small><strong>{fmt(histogram.median)}</strong></div>
            <div><small>90TH PERCENTILE</small><strong>{fmt(histogram.p90)}</strong></div>
            <div><small>ZERO-ACTIVITY DAYS</small><strong>{fmt(histogram.zeroDays)}</strong></div>
          </div>
          {histogram.bins.length ? (
            <div className="cpa-v2__rechart cpa-v2__rechart--histogram" role="img"
              aria-label={selectedMetric.label + ' daily event distribution histogram. Median ' + fmt(histogram.median) + ', 90th percentile ' + fmt(histogram.p90)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogram.bins} margin={{ top: 17, right: 8, bottom: 5, left: -15 }}>
                  <defs>
                    <linearGradient id="cpa-v2-histogram-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={selectedMetric.color} stopOpacity=".96" />
                      <stop offset="100%" stopColor="#4d7896" stopOpacity=".52" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(178,205,233,.1)" strokeDasharray="3 6" />
                  <XAxis dataKey="label" interval={0} tick={{ fill: 'rgba(169,194,218,.68)', fontSize: 8 }}
                    axisLine={{ stroke: 'rgba(160,198,231,.14)' }} tickLine={false} />
                  <YAxis allowDecimals={false} width={34} tick={{ fill: 'rgba(169,194,218,.62)', fontSize: 8 }}
                    axisLine={false} tickLine={false} />
                  <Tooltip content={<HistogramTooltip />} cursor={{ fill: 'rgba(142,185,237,.06)' }} />
                  <Bar dataKey="days" name="Calendar days" radius={[5, 5, 1, 1]} maxBarSize={42}
                    isAnimationActive={!reducedMotion} animationDuration={620} animationEasing="ease-out">
                    {histogram.bins.map(bin => (
                      <Cell key={bin.key} fill={bin.key === p90BinKey
                        ? 'url(#cpa-v2-histogram-fill)'
                        : selectedMetric.color} fillOpacity={bin.key === p90BinKey ? 1 : .72} />
                    ))}
                    <LabelList dataKey="days" position="top" fill="#dce9f6" fontSize={8} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="cpa-v2__empty-chart"><strong>No daily observations</strong><span>The analytics response contains no calendar-day values for this window.</span></div>
          )}
          <div className="cpa-v2__profile-foot">The histogram counts observed calendar days in each event-volume band. Days with zero events remain in the distribution.</div>
        </article>

        <article className="cpa-v2__profile-card cpa-v2__calendar-card">
          <div className="cpa-v2__profile-card-head">
            <div><small>CALENDAR INTENSITY</small><strong>Daily activity map</strong></div>
            <span>SELECT A DAY</span>
          </div>
          {weeks.length ? (
            <>
              <div className="cpa-v2__calendar-wrap">
                <div className="cpa-v2__weekday-labels">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
                <div className="cpa-v2__calendar-scroll">
                  <div className="cpa-v2__calendar-months" style={{ gridTemplateColumns: 'repeat(' + weeks.length + ', 12px)' }}>
                    {weeks.map((week, index) => <span key={week.start} style={{ gridColumn: index + 1 }}>{week.monthLabel}</span>)}
                  </div>
                  <div className="cpa-v2__calendar-grid" style={{ gridTemplateColumns: 'repeat(' + weeks.length + ', 12px)' }}>
                    {weeks.flatMap((week, weekIndex) => week.cells.map((cell, weekdayIndex) => cell ? (
                      <button key={cell.day} type="button"
                        className={'cpa-v2__calendar-cell level-' + (cell.level < 0 ? 'missing' : cell.level) + (cell.day === currentDay?.day ? ' is-selected' : '')}
                        style={{ gridColumn: weekIndex + 1, gridRow: weekdayIndex + 1 }}
                        title={shortDate(cell.day) + ' · ' + (cell.value == null ? 'Value unavailable' : fmt(cell.value) + ' ' + selectedMetric.label.toLowerCase())}
                        aria-label={shortDate(cell.day) + ': ' + (cell.value == null ? 'value unavailable' : fmt(cell.value) + ' ' + selectedMetric.label.toLowerCase())}
                        aria-pressed={cell.day === currentDay?.day}
                        onClick={() => setSelectedDay(cell.day)} />
                    ) : null))}
                  </div>
                </div>
              </div>
              <div className="cpa-v2__calendar-legend">
                <span>0 events</span>{[1, 2, 3, 4].map(level => <i key={level} className={'level-' + level} />)}<span>Higher volume</span>
              </div>
            </>
          ) : (
            <div className="cpa-v2__empty-chart"><strong>No calendar observations</strong><span>There are no daily records to plot for this window.</span></div>
          )}
          <div className="cpa-v2__selected-day">
            <div className="cpa-v2__selected-day-head">
              <small>SELECTED DAY</small>
              <strong>{currentDay ? shortDate(currentDay.day) : 'No date selected'}</strong>
              <span>{fmt(currentValue)} {selectedMetric.label.toLowerCase()}</span>
            </div>
            <div className="cpa-v2__selected-day-values">
              {dayValues.map(item => <div key={item.id}><i style={{ background: item.color }} /><span>{item.label}</span><b>{fmt(item.value)}</b></div>)}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
