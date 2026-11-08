import React, { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Command,
  Crosshair,
  MessageSquare,
  Radio,
  Route,
  ShieldCheck,
  Siren,
  Truck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardAlert, DashboardOverview } from '../stores/dashboardStore.js';
import PriorityQueue, { type QueueItem } from '../components/dashboard/PriorityQueue.js';
import EventsTicker from '../components/dashboard/EventsTicker.js';
import '../styles/command-centre-premium.css';

const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));

type Freshness = 'CURRENT' | 'REFRESHING' | 'AGING' | 'REFRESH FAILED' | 'STALE' | 'CONNECTING' | 'UNAVAILABLE';

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatAge(iso?: string | null) {
  if (!iso) return '—';
  const stamp = new Date(iso).getTime();
  if (!Number.isFinite(stamp)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'normal',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  detail: string;
  tone?: 'normal' | 'warn' | 'critical';
}) {
  return (
    <article className={'cc-metric cc-metric--' + tone}>
      <span className='cc-metric__icon'><Icon size={17} strokeWidth={1.8} /></span>
      <div className='cc-metric__copy'>
        <span className='cc-metric__label'>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function ObjectDrawer({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const nav = useNavigate();
  const isAlert = item.source === 'ALERT REGISTER';

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
      className='cc-drawer-backdrop'
      role='presentation'
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside className='cc-drawer' role='dialog' aria-modal='true' aria-labelledby='cc-drawer-title'>
        <header className='cc-drawer__header'>
          <div>
            <span className='cc-kicker'>OPERATIONAL RECORD / {item.chip.label}</span>
            <h2 id='cc-drawer-title'>{item.title}</h2>
          </div>
          <button type='button' onClick={onClose} aria-label='Close event detail'>×</button>
        </header>

        <div className='cc-drawer__signal'>
          <span className='cc-drawer__signal-mark' style={{ background: 'rgb(' + item.chip.hue + ')' }} />
          <div><small>OBSERVED</small><strong>{formatAge(item.at)} ago</strong></div>
          <div><small>SEVERITY</small><strong>{(item.severity || 'unclassified').toUpperCase()}</strong></div>
        </div>

        <p className='cc-drawer__body'>
          {item.body || 'No additional operator note is attached to this record.'}
        </p>

        <div className='cc-drawer__facts'>
          <div><span>SOURCE</span><b>{item.source || 'OPERATIONAL FEED'}</b></div>
          <div><span>RECORD STATE</span><b>{item.ackId ? 'ACKNOWLEDGEMENT PENDING' : 'RECORDED'}</b></div>
          <div><span>EVENT TIME</span><b>{formatDateTime(item.at)}</b></div>
        </div>

        <div className='cc-drawer__actions'>
          <button type='button' className='cc-drawer__primary' onClick={() => nav({ to: (isAlert ? '/alerts' : '/fleet') as any })}>
            {isAlert ? 'OPEN ALERT REGISTER' : 'OPEN FLEET VIEW'}
          </button>
          <button type='button' onClick={() => nav({ to: '/intelligence' as any })}>OPEN INTELLIGENCE</button>
          <button type='button' onClick={onClose}>RETURN TO COMMAND</button>
        </div>
      </aside>
    </div>
  );
}

export default function CommandCentre() {
  const nav = useNavigate();
  const setOverview = useDashboardStore.getState().setOverview;
  const setAlerts = useDashboardStore.getState().setAlerts;
  const panic = useDashboardStore((state) => state.panicState);
  const [selected, setSelected] = React.useState<QueueItem | null>(null);
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

  // Share the queue's existing cache key so the header count and queue are
  // driven by the same bounded alert response, not two competing sources.
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
  const ageMs = overviewQuery.dataUpdatedAt > 0
    ? Math.max(0, Date.now() - overviewQuery.dataUpdatedAt)
    : null;

  let freshness: Freshness = 'UNAVAILABLE';
  if (overview) {
    if (ageMs != null && ageMs > 180000) freshness = 'STALE';
    else if (overviewQuery.isRefetchError) freshness = 'REFRESH FAILED';
    else if (overviewQuery.isFetching) freshness = 'REFRESHING';
    else if (ageMs != null && ageMs > 90000) freshness = 'AGING';
    else freshness = 'CURRENT';
  } else if (overviewQuery.isPending) {
    freshness = 'CONNECTING';
  }

  const threatLevel = overview?.threat?.level ?? null;
  const posture = !overview
    ? 'UNASSESSED'
    : freshness === 'STALE'
      ? 'STALE SNAPSHOT'
      : (threatLevel ?? 'unassessed').toUpperCase();

  const postureTone = !overview || freshness === 'STALE' || freshness === 'UNAVAILABLE'
    ? 'unknown'
    : threatLevel === 'critical'
      ? 'critical'
      : threatLevel === 'elevated'
        ? 'warn'
        : freshness === 'REFRESH FAILED' || freshness === 'AGING'
          ? 'degraded'
          : 'normal';

  const priorityCount = alertsQuery.data
    ? alertsQuery.data.filter((alert) => alert.severity === 'critical' || alert.severity === 'high').length
    : null;

  const snapshotDetail = freshness === 'STALE'
    ? 'last successful snapshot · stale'
    : freshness === 'REFRESH FAILED'
      ? 'last successful snapshot · refresh failed'
      : overview
        ? 'last successful overview snapshot'
        : 'awaiting a verified overview response';

  const updatedLabel = overviewQuery.dataUpdatedAt > 0
    ? 'UPDATED ' + formatAge(new Date(overviewQuery.dataUpdatedAt).toISOString()) + ' AGO'
    : 'NO SUCCESSFUL SNAPSHOT';

  const nextDelivery = overview?.next_delivery ?? null;
  const shiftStarted = overview?.shift_started_at ?? null;

  return (
    <main className='cc-command'>
      <section className='cc-topline'>
        <div className='cc-brand'>
          <div className='cc-brand__sig'><Command size={19} strokeWidth={1.8} /></div>
          <div className='cc-brand__copy'>
            <span className='cc-kicker'>SONALIT / OPERATIONS</span>
            <h1>Command Centre</h1>
            <p>One operational picture. Clear signals. Accountable response.</p>
          </div>
        </div>

        <div className={'cc-posture cc-posture--' + postureTone}>
          <div className='cc-posture__top'><span className='cc-state-dot' /><span>THREAT POSTURE</span></div>
          <strong>{posture}</strong>
          <small>{overview ? snapshotDetail : 'No verified overview available'}</small>
        </div>

        <div className='cc-topline__right'>
          <div className={'cc-source cc-source--' + freshness.toLowerCase().replaceAll(' ', '-')}>
            <span className='cc-source__dot' />
            <span className='cc-source__copy'><b>OVERVIEW API</b><strong>{freshness}</strong><small>{updatedLabel}</small></span>
            <button
              type='button'
              onClick={() => { void overviewQuery.refetch(); void alertsQuery.refetch(); }}
              aria-label='Refresh command overview'
              title='Refresh overview and alert window'
            >
              <Activity size={15} />
            </button>
          </div>
          <div className='cc-shift'>
            <span><Clock3 size={13} /> SHIFT START</span>
            <strong>{overview ? formatTime(shiftStarted) : '—'}</strong>
          </div>
          <button
            type='button'
            onClick={() => nav({ to: '/panic-center' as any })}
            className={panic ? 'cc-panic cc-panic--live' : 'cc-panic'}
          >
            <Siren size={14} /> {panic ? 'PANIC ACTIVE' : 'PANIC CENTRE'}
          </button>
        </div>
      </section>

      <section className='cc-toolbar' aria-label='Operational overview metrics'>
        <Metric
          icon={Truck}
          label='LIVE VEHICLES'
          value={overview ? overview.kpi.vehicles_live : '—'}
          detail={snapshotDetail}
        />
        <Metric
          icon={Route}
          label='ACTIVE CONVOYS'
          value={overview ? overview.kpi.convoys_active : '—'}
          detail={snapshotDetail}
        />
        <Metric
          icon={AlertTriangle}
          label='PRIORITY ALERTS'
          value={priorityCount == null ? '—' : priorityCount}
          detail={alertsQuery.isError && !alertsQuery.data ? 'alert feed unavailable' : 'critical + high · latest 10'}
          tone={priorityCount != null && priorityCount > 0 ? 'warn' : 'normal'}
        />
        <Metric
          icon={ShieldCheck}
          label='OPEN INCIDENTS'
          value={overview ? overview.kpi.incidents_open : '—'}
          detail={snapshotDetail}
        />

        <div className='cc-toolbar__actions'>
          <button type='button' onClick={() => nav({ to: '/alerts' as any })}>
            <AlertTriangle size={14} /><span>ALERTS</span><b>{priorityCount == null ? '—' : priorityCount}</b>
          </button>
          <button type='button' onClick={() => nav({ to: '/messages' as any })}>
            <MessageSquare size={14} /><span>MESSAGES</span><ChevronMark />
          </button>
          <button type='button' onClick={() => nav({ to: '/intelligence' as any })}>
            <Crosshair size={14} /><span>INTELLIGENCE</span><ChevronMark />
          </button>
        </div>
      </section>

      <section className='cc-main'>
        <div className='cc-map'>
          <header className='cc-map__header'>
            <div>
              <span className='cc-kicker'><Crosshair size={12} /> OPERATIONS THEATRE</span>
              <h2>East Africa / Movement picture</h2>
              <p>Map layers reflect the available source records; unreported positions remain absent.</p>
            </div>
            <div className='cc-map__legend'>
              <span><i className='legend-dot legend-dot--green' /> MOVING</span>
              <span><i className='legend-dot legend-dot--amber' /> EXCEPTION</span>
              <span><i className='legend-dot legend-dot--red' /> CRITICAL</span>
            </div>
          </header>
          <div className='cc-map__body'>
            <div className='cc-map__canvas'>
              <Suspense fallback={<div className='cc-map__loading'><Activity size={18} /><span>LOADING MAP VIEW…</span></div>}>
                <TacticalMap fill />
              </Suspense>
            </div>
            <div className='cc-map__hud cc-map__hud--tl'><b>OPS / EA</b><span>THEATRE VIEW</span></div>
            <div className='cc-map__hud cc-map__hud--tr'><Radio size={11} /><span>MAP LAYERS</span></div>
            <div className='cc-map__hud cc-map__hud--bl'><span>POSITION DATA IS SOURCE-DEPENDENT</span></div>
            <div className='cc-map__crosshair'><span /><i /></div>
          </div>
        </div>

        <aside className='cc-queue'>
          <div className='cc-queue__head'>
            <div><span className='cc-kicker'>OPERATOR RESPONSE</span><h2>Priority queue</h2></div>
            <span className='cc-count'>
              {priorityCount == null ? 'FEED PENDING' : priorityCount > 0 ? priorityCount + ' HIGH / CRITICAL' : 'NO HIGH / CRITICAL'}
            </span>
          </div>
          <div className='cc-queue__body'><PriorityQueue onSelect={setSelected} /></div>
        </aside>
      </section>

      <section className='cc-bottom'>
        <div className='cc-bottom__mission'>
          <div className='cc-bottom__mission-name'>
            <span className='cc-kicker'>NEXT OPERATIONAL MILESTONE</span>
            <strong>{nextDelivery?.convoy_name ?? 'No next milestone returned'}</strong>
          </div>
          <div><span>ETA</span><b>{nextDelivery ? formatTime(nextDelivery.eta) : '—'}</b></div>
          <div><span>STATUS</span><b>{nextDelivery ? 'API REPORTED' : 'NOT REPORTED'}</b></div>
          <div><span>POSTURE</span><b>{overview ? (freshness === 'STALE' ? 'STALE' : (threatLevel ?? 'UNASSESSED').toUpperCase()) : 'UNASSESSED'}</b></div>
        </div>
        <div className='cc-events'><EventsTicker /></div>
      </section>

      {selected && <ObjectDrawer item={selected} onClose={closeSelected} />}
    </main>
  );
}

function ChevronMark() {
  return <span className='cc-action-chevron' aria-hidden='true'>›</span>;
}
