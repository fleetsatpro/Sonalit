import React, { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  Command,
  Crosshair,
  MapPinned,
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

type ResponseState = 'RECEIVED' | 'REFRESHING' | 'RESPONSE AGING' | 'REFRESH FAILED' | 'OLD RESPONSE' | 'CONNECTING' | 'UNAVAILABLE';

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

function Instrument({
  icon: Icon,
  label,
  value,
  note,
  tone = 'neutral',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  note: string;
  tone?: 'neutral' | 'amber' | 'red';
}) {
  return (
    <div className={'cc-instrument cc-instrument--' + tone}>
      <span className='cc-instrument__icon'><Icon size={16} strokeWidth={1.8} /></span>
      <span className='cc-instrument__readout'>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </span>
    </div>
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

  // Share the queue's cache key: the count and the response lane use one
  // bounded alert window, with no second interpretation of the source.
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

  // The overview API does not expose a source-generated timestamp. These states
  // describe only when this browser received the last successful HTTP response;
  // they must not be presented as proof that upstream telemetry is current.
  let responseState: ResponseState = 'UNAVAILABLE';
  if (overview) {
    if (ageMs != null && ageMs > 180000) responseState = 'OLD RESPONSE';
    else if (overviewQuery.isRefetchError) responseState = 'REFRESH FAILED';
    else if (overviewQuery.isFetching) responseState = 'REFRESHING';
    else if (ageMs != null && ageMs > 90000) responseState = 'RESPONSE AGING';
    else responseState = 'RECEIVED';
  } else if (overviewQuery.isPending) {
    responseState = 'CONNECTING';
  }

  const threatLevel = overview?.threat?.level ?? null;
  const posture = !overview
    ? 'UNASSESSED'
    : responseState === 'OLD RESPONSE'
      ? 'OLD RESPONSE'
      : responseState === 'REFRESH FAILED' || responseState === 'RESPONSE AGING'
        ? 'RESPONSE AGING'
        : (threatLevel ?? 'unassessed').toUpperCase();

  const postureTone = !overview || responseState === 'OLD RESPONSE' || responseState === 'UNAVAILABLE'
    ? 'unknown'
    : threatLevel === 'critical'
      ? 'critical'
      : threatLevel === 'elevated'
        ? 'warn'
        : responseState === 'REFRESH FAILED' || responseState === 'RESPONSE AGING'
          ? 'degraded'
          : 'normal';

  const priorityCount = alertsQuery.data
    ? alertsQuery.data.filter((alert) => alert.severity === 'critical' || alert.severity === 'high').length
    : null;

  const responseAgeLabel = overviewQuery.dataUpdatedAt > 0
    ? formatAge(new Date(overviewQuery.dataUpdatedAt).toISOString()) + ' AGO'
    : 'NOT RECEIVED';
  const overviewNote = overview ? 'response received ' + responseAgeLabel.toLowerCase() : 'not available';

  const nextDelivery = overview?.next_delivery ?? null;
  const shiftStarted = overview?.shift_started_at ?? null;

  return (
    <main className='cc-command'>
      <header className='cc-topline'>
        <div className='cc-brand'>
          <div className='cc-brand__sig'><Command size={21} strokeWidth={1.7} /></div>
          <div className='cc-brand__copy'>
            <span className='cc-kicker'>SONALIT <i /> OPERATIONS GRID / 01</span>
            <h1>Command Centre</h1>
          </div>
        </div>

        <div className={'cc-posture cc-posture--' + postureTone}>
          <span className='cc-posture__beam' />
          <div className='cc-posture__copy'>
            <small>GLOBAL POSTURE</small>
            <strong>{posture}</strong>
            <em>{overview ? responseState + ' · RECEIVED ' + responseAgeLabel : responseState + ' · NO VERIFIED OVERVIEW'}</em>
          </div>
        </div>

        <div className='cc-topline__right'>
          <div className='cc-shift'>
            <span><Clock3 size={12} /> SHIFT OPENED</span>
            <strong>{overview ? formatTime(shiftStarted) : '—'}</strong>
          </div>
          <button
            type='button'
            className='cc-refresh'
            onClick={() => { void overviewQuery.refetch(); void alertsQuery.refetch(); }}
            aria-label='Refresh command data'
            title='Refresh overview and alert window'
          >
            <Activity size={15} /><span>REFRESH</span>
          </button>
          <button
            type='button'
            onClick={() => nav({ to: '/panic-center' as any })}
            className={panic ? 'cc-panic cc-panic--live' : 'cc-panic'}
          >
            <Siren size={14} /> {panic ? 'PANIC ACTIVE' : 'PANIC CENTRE'}
          </button>
        </div>
      </header>

      <section className='cc-instrument-rail' aria-label='Operational snapshot'>
        <div className='cc-rail-lead'><span className='cc-kicker'>THEATRE READOUT</span><b>EA / 01</b></div>
        <Instrument
          icon={Truck}
          label='VEHICLES REPORTING'
          value={overview ? overview.kpi.vehicles_live : '—'}
          note={overviewNote}
        />
        <Instrument
          icon={Route}
          label='ACTIVE CONVOYS'
          value={overview ? overview.kpi.convoys_active : '—'}
          note={overviewNote}
        />
        <Instrument
          icon={AlertTriangle}
          label='PRIORITY ALERTS'
          value={priorityCount == null ? '—' : priorityCount}
          note={alertsQuery.isError && !alertsQuery.data ? 'source unavailable' : 'high + critical / 10 loaded'}
          tone={priorityCount != null && priorityCount > 0 ? 'amber' : 'neutral'}
        />
        <Instrument
          icon={ShieldCheck}
          label='OPEN INCIDENTS'
          value={overview ? overview.kpi.incidents_open : '—'}
          note={overviewNote}
          tone={overview?.kpi.incidents_open ? 'red' : 'neutral'}
        />
        <div className='cc-rail-actions'>
          <button type='button' onClick={() => nav({ to: '/alerts' as any })}><AlertTriangle size={13} /><span>ALERTS</span><ArrowUpRight size={12} /></button>
          <button type='button' onClick={() => nav({ to: '/messages' as any })}><MessageSquare size={13} /><span>COMMS</span><ArrowUpRight size={12} /></button>
          <button type='button' onClick={() => nav({ to: '/intelligence' as any })}><Crosshair size={13} /><span>INTEL</span><ArrowUpRight size={12} /></button>
        </div>
      </section>

      <section className='cc-main'>
        <section className='cc-map' aria-label='Operational theatre map'>
          <div className='cc-map__frame'>
            <div className='cc-map__canvas'>
              <Suspense fallback={<div className='cc-map__loading'><Activity size={19} /><span>INITIALISING THEATRE</span></div>}>
                <TacticalMap fill />
              </Suspense>
            </div>
            <div className='cc-map__overlay cc-map__overlay--tl'>
              <span className='cc-orbit-mark'><MapPinned size={13} /></span>
              <span><b>THEATRE / EAST AFRICA</b><small>COMMON OPERATIONAL PICTURE</small></span>
            </div>
            <div className='cc-map__overlay cc-map__overlay--tr'>
              <span className={'cc-freshness-dot cc-freshness-dot--' + responseState.toLowerCase().replaceAll(' ', '-')} />
              <span><b>{responseState}</b><small>OVERVIEW RESPONSE</small></span>
            </div>
            <div className='cc-map__overlay cc-map__overlay--bl'>
              <span>POSITION RECORDS ONLY</span><i />
              <span>UNREPORTED ASSETS REMAIN ABSENT</span>
            </div>
            <div className='cc-map__index'>01 <span>/</span> THEATRE</div>
            <div className='cc-map__crosshair'><span /><i /></div>
          </div>
        </section>

        <aside className='cc-queue'>
          <div className='cc-queue__mast'>
            <div className='cc-queue__heading'>
              <span className='cc-kicker'><Activity size={11} /> RESPONSE / LIVE WORKLIST</span>
              <h2>Priority lane</h2>
            </div>
            <div className='cc-queue__total'>
              <strong>{priorityCount == null ? '—' : String(priorityCount).padStart(2, '0')}</strong>
              <small>HIGH / CRITICAL<br />LATEST 10</small>
            </div>
          </div>
          <div className='cc-queue__body'><PriorityQueue onSelect={setSelected} /></div>
          <div className='cc-queue__foot'>
            <span>QUEUE WINDOW</span><b>{alertsQuery.data ? alertsQuery.data.length + ' ALERT RECORDS' : 'SOURCE NOT CONFIRMED'}</b>
            <button type='button' onClick={() => nav({ to: '/alerts' as any })}>OPEN REGISTER <ArrowUpRight size={12} /></button>
          </div>
        </aside>
      </section>

      <section className='cc-bottom'>
        <div className='cc-milestone'>
          <div className='cc-milestone__mark'><Route size={16} /></div>
          <div className='cc-milestone__main'>
            <span className='cc-kicker'>NEXT OPERATIONAL MILESTONE</span>
            <strong>{nextDelivery?.convoy_name ?? 'No milestone supplied by overview'}</strong>
            <small>{nextDelivery ? 'Returned by the command overview' : 'No next delivery is currently reported'}</small>
          </div>
          <div className='cc-milestone__datum'><small>ETA</small><b>{nextDelivery ? formatTime(nextDelivery.eta) : '—'}</b></div>
          <div className='cc-milestone__datum'><small>SHIFT</small><b>{overview ? formatTime(shiftStarted) : '—'}</b></div>
          <button type='button' onClick={() => nav({ to: '/convoys' as any })}>CONVOYS <ArrowUpRight size={12} /></button>
        </div>
        <div className='cc-events'>
          <div className='cc-events__label'><Radio size={12} /><span>EVENT STREAM</span></div>
          <EventsTicker />
        </div>
      </section>

      {selected && <ObjectDrawer item={selected} onClose={closeSelected} />}
    </main>
  );
}
