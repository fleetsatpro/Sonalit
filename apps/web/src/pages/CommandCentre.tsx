import React, { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  RefreshCw,
  Route,
  Siren,
  Truck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardAlert, DashboardOverview } from '../stores/dashboardStore.js';
import CommandPriorityLane, { type CommandRecord } from '../components/dashboard/CommandPriorityLane.js';
import '../styles/command-centre-premium.css';

const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));

function formatTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatAge(value?: string | null) {
  if (!value) return '—';
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  note,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  tone?: 'neutral' | 'amber' | 'red';
  note?: string;
}) {
  return (
    <div className={'cc2-metric cc2-metric--' + tone}>
      <span className='cc2-metric__icon'><Icon size={18} strokeWidth={2} /></span>
      <span className='cc2-metric__copy'>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </span>
    </div>
  );
}

function RecordDetail({
  record,
  onClose,
}: {
  record: CommandRecord;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const isAlert = Boolean(record.ackId) || record.source === 'Alert register';

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className='cc2-detail-backdrop'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className='cc2-detail' role='dialog' aria-modal='true' aria-labelledby='cc2-detail-title'>
        <header className='cc2-detail__header'>
          <div>
            <span className='cc2-section-label'>{record.source}</span>
            <h2 id='cc2-detail-title'>{record.title}</h2>
          </div>
          <button type='button' onClick={onClose} aria-label='Close event detail'>×</button>
        </header>
        <div className='cc2-detail__facts'>
          <div>
            <span>Severity</span>
            <strong>{record.severity.toUpperCase()}</strong>
          </div>
          <div>
            <span>Event time</span>
            <strong>{formatDateTime(record.at)}</strong>
          </div>
        </div>
        <p className='cc2-detail__summary'>
          {record.summary || 'No additional operator note is attached to this record.'}
        </p>
        <footer className='cc2-detail__actions'>
          <button type='button' onClick={onClose}>Close details</button>
          <button
            type='button'
            className='cc2-button cc2-button--primary'
            onClick={() => navigate({ to: (isAlert ? '/alerts' : '/intelligence') as any })}
          >
            {isAlert ? 'Open alert register' : 'Open intelligence'} <ArrowUpRight size={14} />
          </button>
        </footer>
      </aside>
    </div>
  );
}

export default function CommandCentre() {
  const navigate = useNavigate();
  const setOverview = useDashboardStore.getState().setOverview;
  const setAlerts = useDashboardStore.getState().setAlerts;
  const recentEvents = useDashboardStore((state) => state.tickerEvents);
  const panic = useDashboardStore((state) => state.panicState);
  const [selected, setSelected] = React.useState<CommandRecord | null>(null);
  const closeSelected = React.useCallback(() => setSelected(null), []);

  const overviewQuery = useQuery({
    queryKey: ['command-centre-overview'],
    queryFn: async () => {
      const response = await api.get<DashboardOverview>('/dashboard/overview');
      setOverview(response.data);
      return response.data;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const alertsQuery = useQuery({
    queryKey: ['dashboard-alerts-ops'],
    queryFn: async () => {
      const response = await api.get<{ data?: DashboardAlert[] }>('/dashboard/alerts?limit=10');
      const records = response.data.data ?? [];
      setAlerts(records);
      return records;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const overview = overviewQuery.data ?? null;
  const responseAge = overviewQuery.dataUpdatedAt > 0
    ? formatAge(new Date(overviewQuery.dataUpdatedAt).toISOString())
    : null;
  const responseCaption = overview
    ? (overviewQuery.isRefetchError
      ? 'Refresh failed · last response received ' + responseAge + ' ago'
      : 'Overview response received ' + responseAge + ' ago')
    : overviewQuery.isPending
      ? 'Waiting for the first overview response'
      : 'Overview unavailable';

  const priorityCount = alertsQuery.data
    ? alertsQuery.data.filter((alert) => alert.severity === 'critical' || alert.severity === 'high').length
    : '—';

  const nextDelivery = overview?.next_delivery ?? null;
  const latestEvents = recentEvents.slice(-3).reverse();

  return (
    <main className='cc2-command'>
      <header className='cc2-header'>
        <div className='cc2-header__identity'>
          <span className='cc2-brand-mark'><Activity size={20} strokeWidth={2} /></span>
          <div>
            <span className='cc2-section-label'>SONALIT / OPERATIONS</span>
            <h1>Command Centre</h1>
          </div>
        </div>

        <div className='cc2-header__actions'>
          <div className='cc2-response-age'>
            <span className={'cc2-response-age__dot ' + (overview ? 'is-received' : 'is-unknown')} />
            <span>{responseCaption}</span>
          </div>
          {overview?.shift_started_at && (
            <span className='cc2-shift'>
              <Clock3 size={14} /> Shift opened {formatTime(overview.shift_started_at)}
            </span>
          )}
          <button
            type='button'
            className='cc2-button'
            onClick={() => { void overviewQuery.refetch(); void alertsQuery.refetch(); }}
            disabled={overviewQuery.isFetching || alertsQuery.isFetching}
          >
            <RefreshCw size={15} className={overviewQuery.isFetching || alertsQuery.isFetching ? 'cc2-spin' : ''} />
            Refresh
          </button>
          <button
            type='button'
            className='cc2-button cc2-button--panic'
            onClick={() => navigate({ to: '/panic-center' as any })}
          >
            <Siren size={15} /> Panic Centre
            {panic && <span className='cc2-button__active'>Active</span>}
          </button>
        </div>
      </header>

      <section className='cc2-metrics' aria-label='Operational overview'>
        <Metric icon={Truck} label='Vehicles reporting' value={overview ? overview.kpi.vehicles_live : '—'} />
        <Metric icon={Route} label='Active convoys' value={overview ? overview.kpi.convoys_active : '—'} />
        <Metric icon={AlertTriangle} label='Priority alerts' value={priorityCount} note='High + critical · latest 10' tone={priorityCount !== '—' && priorityCount > 0 ? 'amber' : 'neutral'} />
        <Metric icon={Siren} label='Open incidents' value={overview ? overview.kpi.incidents_open : '—'} tone={overview?.kpi.incidents_open ? 'red' : 'neutral'} />
      </section>

      <section className='cc2-workspace'>
        <section className='cc2-map-panel' aria-label='Operational map'>
          <header className='cc2-panel-header'>
            <div>
              <span className='cc2-section-label'>OPERATIONAL MAP</span>
              <h2>East Africa</h2>
              <p>Reported vehicle and convoy positions</p>
            </div>
          </header>
          <div className='cc2-map-stage'>
            <Suspense fallback={<div className='cc2-map-loading'><Activity size={18} /> Loading map…</div>}>
              <TacticalMap fill presentation='command' />
            </Suspense>
          </div>
        </section>

        <CommandPriorityLane
          alerts={alertsQuery.data}
          loading={alertsQuery.isPending}
          unavailable={alertsQuery.isError && !alertsQuery.data}
          onSelect={setSelected}
        />
      </section>

      {(nextDelivery || latestEvents.length > 0) && (
        <section className='cc2-lower'>
          {nextDelivery && (
            <article className='cc2-next-delivery'>
              <span className='cc2-lower__icon'><Route size={17} /></span>
              <div className='cc2-lower__copy'>
                <span className='cc2-section-label'>NEXT DELIVERY</span>
                <strong>{nextDelivery.convoy_name}</strong>
              </div>
              <div className='cc2-lower__eta'>
                <span>ETA</span>
                <strong>{formatTime(nextDelivery.eta)}</strong>
              </div>
              <button type='button' onClick={() => navigate({ to: '/convoys' as any })}>
                View convoy <ArrowUpRight size={14} />
              </button>
            </article>
          )}

          {latestEvents.length > 0 && (
            <article className='cc2-recent-activity'>
              <div className='cc2-recent-activity__heading'>
                <span className='cc2-section-label'>RECENT ACTIVITY</span>
                <span>{latestEvents.length} updates</span>
              </div>
              <div className='cc2-recent-activity__items'>
                {latestEvents.map((event) => (
                  <div className='cc2-activity-item' key={event.id}>
                    <span className={'cc2-activity-item__dot cc2-activity-item__dot--' + event.severity} />
                    <span>{event.message}</span>
                  </div>
                ))}
              </div>
            </article>
          )}
        </section>
      )}

      {selected && <RecordDetail record={selected} onClose={closeSelected} />}
    </main>
  );
}
