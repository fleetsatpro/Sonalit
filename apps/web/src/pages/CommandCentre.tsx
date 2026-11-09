import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Clock3,
  Crosshair,
  MapPin,
  Radio,
  RefreshCw,
  Route,
  ShieldAlert,
  Siren,
  Truck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { getSnapshot, subscribe as subscribeConnectivity } from '../lib/offline/connectivity.js';
import { useDashboardStore, type DashboardOverview, type ConvoyUpdate } from '../stores/dashboardStore.js';
import PriorityQueue, { type QueueItem } from '../components/dashboard/PriorityQueue.js';
import '../styles/command-centre.css';

const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));

type CommandConvoy = {
  id: string;
  name: string;
  status: string;
  origin: string | null;
  destination: string | null;
  eta: string | null;
  truck_count: number;
  checkpoints: Array<{ name: string; status: string; reached_at: string | null }>;
};

type CommandConvoyResponse = {
  data?: CommandConvoy[];
  data_quality?: { checkpoints_ready?: boolean; snapshot_at?: string };
};

type CommandTimelineResponse = {
  data?: CommandMilestone[];
  data_quality?: { state?: 'complete' | 'partial'; failed_sources?: string[]; snapshot_at?: string };
};

type CommandVehicle = {
  id: string;
  registration: string;
  convoy_id: string | null;
  status: string;
  speed_kmh: number;
  last_ping_at: string | null;
};

type CommandMilestone = {
  type: 'arrival' | 'checkpoint' | 'shift' | string;
  label: string;
  time: string;
  convoy_id?: string | null;
  fraction: number;
};

type MapSnapshot = {
  vehicles?: unknown[];
  convoys?: unknown[];
  alert_zones?: unknown[];
  geofences?: unknown[];
  riskzones?: unknown[];
};

function ageLabel(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

function timeLabel(value?: string | null): string {
  if (!value) return '—';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime())
    ? '—'
    : stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function dateTimeLabel(value?: string | null): string {
  if (!value) return '—';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime())
    ? '—'
    : stamp.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function positionBand(vehicle: CommandVehicle, now: number): 'fresh' | 'delayed' | 'lost' {
  if (!vehicle.last_ping_at) return 'lost';
  const stamp = new Date(vehicle.last_ping_at).getTime();
  if (!Number.isFinite(stamp)) return 'lost';
  const age = Math.max(0, now - stamp);
  if (age <= 5 * 60_000) return 'fresh';
  if (age <= 15 * 60_000) return 'delayed';
  return 'lost';
}

function convoyTone(status: string): string {
  const value = status.toLowerCase();
  if (value === 'delayed') return 'warning';
  if (value === 'active' || value === 'in_transit') return 'moving';
  return 'neutral';
}

function timelineIcon(type: string) {
  if (type === 'arrival') return Truck;
  if (type === 'checkpoint') return MapPin;
  return CalendarClock;
}

function milestoneDestination(type: string): string {
  return type === 'shift' ? '/shifts' : '/convoys';
}

function PanelState({
  title,
  message,
  action,
  onAction,
  tone = 'neutral',
}: {
  title: string;
  message: string;
  action?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className={'ccx-state ccx-state--' + tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span className='ccx-state__mark' aria-hidden='true'>
        {tone === 'error' ? <AlertOctagon size={17} /> : <Activity size={17} />}
      </span>
      <div className='ccx-state__copy'>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {action && onAction && (
        <button type='button' className='ccx-retry' onClick={onAction}>
          <RefreshCw size={13} /> {action}
        </button>
      )}
    </div>
  );
}

function MetricReadout({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  detail: string;
  tone?: 'default' | 'warning' | 'critical';
}) {
  return (
    <div className={'ccx-metric ccx-metric--' + tone}>
      <span className='ccx-metric__icon'><Icon size={17} strokeWidth={1.9} /></span>
      <span className='ccx-metric__copy'>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function MovementRegister({
  convoys,
  isLoading,
  isError,
  onRetry,
  onOpen,
}: {
  convoys: CommandConvoy[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpen: () => void;
}) {
  return (
    <section className='ccx-panel ccx-movement-panel' aria-labelledby='ccx-movement-title'>
      <header className='ccx-panel-head'>
        <div>
          <span className='ccx-eyebrow'>MOVEMENT REGISTER / 01</span>
          <h2 id='ccx-movement-title'>Active movements</h2>
        </div>
        <button type='button' className='ccx-head-link' onClick={onOpen} aria-label='Open convoy register'>
          REGISTER <ArrowUpRight size={13} />
        </button>
      </header>
      <div className='ccx-movement-list'>
        {isLoading && (
          <div className='ccx-skeleton-list' aria-label='Loading active movements'>
            <span /><span /><span />
          </div>
        )}
        {!isLoading && isError && (
          <PanelState
            title='Movement register unavailable'
            message='The convoy endpoint did not return a usable response.'
            action='RETRY'
            onAction={onRetry}
            tone='error'
          />
        )}
        {!isLoading && !isError && convoys.length === 0 && (
          <PanelState
            title='No active movements'
            message='No active, in-transit or delayed convoy records were returned.'
          />
        )}
        {!isLoading && !isError && convoys.map((convoy) => {
          const completed = convoy.checkpoints.filter((point) => point.status === 'done').length;
          const total = convoy.checkpoints.length;
          const tone = convoyTone(convoy.status);
          return (
            <button
              type='button'
              key={convoy.id}
              className='ccx-movement'
              onClick={onOpen}
              aria-label={'Open convoy register for ' + convoy.name}
            >
              <span className={'ccx-movement__status ccx-movement__status--' + tone}>
                <i aria-hidden='true' />
                {convoy.status.replace(/_/g, ' ').toUpperCase()}
              </span>
              <strong className='ccx-movement__name'>{convoy.name}</strong>
              <span className='ccx-movement__route'>
                <span>{convoy.origin || 'Origin not recorded'}</span>
                <ArrowRight size={12} aria-hidden='true' />
                <span>{convoy.destination || 'Destination not recorded'}</span>
              </span>
              <span className='ccx-movement__meta'>
                <span><Truck size={12} /> {convoy.truck_count} {convoy.truck_count === 1 ? 'vehicle' : 'vehicles'}</span>
                <span><Clock3 size={12} /> ETA {timeLabel(convoy.eta)}</span>
              </span>
              {total > 0 && (
                <span className='ccx-checkpoints' aria-label={completed + ' of ' + total + ' checkpoints reached'}>
                  <span className='ccx-checkpoints__track'><i style={{ width: (completed / total * 100) + '%' }} /></span>
                  <small>{completed}/{total} CHECKPOINTS</small>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FleetSignal({
  vehicles,
  isLoading,
  isError,
  updatedAt,
  now,
  onRetry,
  onOpen,
}: {
  vehicles: CommandVehicle[];
  isLoading: boolean;
  isError: boolean;
  updatedAt: number;
  now: number;
  onRetry: () => void;
  onOpen: () => void;
}) {
  const counts = useMemo(() => {
    const result = { fresh: 0, delayed: 0, lost: 0, flagged: 0 };
    for (const vehicle of vehicles) {
      result[positionBand(vehicle, now)] += 1;
      if (vehicle.status === 'alert') result.flagged += 1;
    }
    return result;
  }, [vehicles, now]);

  return (
    <section className='ccx-panel ccx-fleet-panel' aria-labelledby='ccx-fleet-title'>
      <header className='ccx-panel-head ccx-panel-head--compact'>
        <div>
          <span className='ccx-eyebrow'>POSITION INTEGRITY / 02</span>
          <h2 id='ccx-fleet-title'>Fleet signal</h2>
        </div>
        <button type='button' className='ccx-icon-link' onClick={onOpen} aria-label='Open live fleet view'>
          <Crosshair size={15} />
        </button>
      </header>
      {isLoading && <div className='ccx-fleet-loading'><span /><span /><span /></div>}
      {!isLoading && isError && (
        <PanelState
          title='Position register unavailable'
          message='Vehicle signal data could not be loaded.'
          action='RETRY'
          onAction={onRetry}
          tone='error'
        />
      )}
      {!isLoading && !isError && (
        <>
          <div className='ccx-signal-stack'>
            <div className='ccx-signal-row ccx-signal-row--fresh'>
              <span><i /> Fresh fixes <small>≤ 5 min</small></span>
              <strong>{counts.fresh}</strong>
            </div>
            <div className='ccx-signal-row ccx-signal-row--delayed'>
              <span><i /> Delayed fixes <small>5–15 min</small></span>
              <strong>{counts.delayed}</strong>
            </div>
            <div className='ccx-signal-row ccx-signal-row--lost'>
              <span><i /> No recent fix <small>{'>'} 15 min / none</small></span>
              <strong>{counts.lost}</strong>
            </div>
          </div>
          <div className='ccx-fleet-foot'>
            <span>{counts.flagged} vehicle alert flags</span>
            <span>{updatedAt > 0 ? 'received ' + ageLabel(now - updatedAt) + ' ago' : 'no snapshot yet'}</span>
          </div>
          {vehicles.length === 0 && (
            <p className='ccx-fleet-empty'>No vehicle records were returned for this organisation.</p>
          )}
        </>
      )}
    </section>
  );
}

function MilestoneTimeline({
  items,
  isLoading,
  isError,
  onRetry,
  onOpen,
}: {
  items: CommandMilestone[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpen: (type: string) => void;
}) {
  return (
    <section className='ccx-panel ccx-timeline-panel' aria-labelledby='ccx-timeline-title'>
      <header className='ccx-panel-head ccx-panel-head--timeline'>
        <div>
          <span className='ccx-eyebrow'>FORWARD LOOK / 24 HOURS</span>
          <h2 id='ccx-timeline-title'>Upcoming milestones</h2>
        </div>
        <span className='ccx-timeline-window'>NEXT 24H</span>
      </header>
      {isLoading && <div className='ccx-timeline-loading'><span /><span /><span /></div>}
      {!isLoading && isError && (
        <PanelState
          title='Timeline unavailable'
          message='Upcoming arrivals, checkpoints and shift changes could not be retrieved.'
          action='RETRY'
          onAction={onRetry}
          tone='error'
        />
      )}
      {!isLoading && !isError && items.length === 0 && (
        <PanelState
          title='No scheduled milestones'
          message='There are no recorded arrivals, checkpoints or shift changes in the next 24 hours.'
        />
      )}
      {!isLoading && !isError && items.length > 0 && (
        <div className='ccx-timeline-list'>
          {items.slice(0, 6).map((item, index) => {
            const Icon = timelineIcon(item.type);
            return (
              <button
                type='button'
                className='ccx-milestone'
                key={item.type + '-' + item.time + '-' + index}
                onClick={() => onOpen(item.type)}
              >
                <span className='ccx-milestone__marker'><Icon size={15} /></span>
                <span className='ccx-milestone__body'>
                  <strong>{item.label}</strong>
                  <small>{item.type === 'shift' ? 'SHIFT HANDOVER' : item.type === 'checkpoint' ? 'CHECKPOINT' : 'CONVOY ARRIVAL'}</small>
                </span>
                <span className='ccx-milestone__time'>{timeLabel(item.time)}</span>
                <ArrowUpRight className='ccx-milestone__open' size={13} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RecordDrawer({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  const openSource = () => {
    onClose();
    void navigate({ to: item.destination as any });
  };

  return (
    <div
      className='ccx-drawer-backdrop'
      role='presentation'
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside
        className='ccx-drawer'
        role='dialog'
        aria-modal='true'
        aria-labelledby='ccx-drawer-title'
        ref={dialogRef}
      >
        <header className='ccx-drawer-head'>
          <div>
            <span className='ccx-eyebrow'>OPERATIONAL RECORD / {item.chip.label}</span>
            <h2 id='ccx-drawer-title'>{item.title}</h2>
          </div>
          <button ref={closeRef} type='button' onClick={onClose} className='ccx-drawer-close' aria-label='Close record detail'>
            <X size={18} />
          </button>
        </header>
        <div className='ccx-drawer-grid'>
          <div>
            <small>SEVERITY</small>
            <strong className={'ccx-severity ccx-severity--' + (item.severity || 'unclassified').toLowerCase()}>{(item.severity || 'Unclassified').toUpperCase()}</strong>
          </div>
          <div>
            <small>OBSERVED</small>
            <strong>{ageLabel(Date.now() - new Date(item.at).getTime())} ago</strong>
          </div>
          <div>
            <small>RECORD SOURCE</small>
            <strong>{item.source}</strong>
          </div>
          <div>
            <small>EVENT TIME</small>
            <strong>{dateTimeLabel(item.at)}</strong>
          </div>
        </div>
        <div className='ccx-drawer-evidence'>
          <span className='ccx-eyebrow'>AVAILABLE CONTEXT</span>
          <p>{item.body || 'No additional operator note was attached to this record.'}</p>
        </div>
        <div className='ccx-drawer-action-note'>
          {item.ackId
            ? 'Acknowledgement is available on the originating alert record in the response lane.'
            : 'No acknowledgement action is attached to this event type in the current response lane.'}
        </div>
        <footer className='ccx-drawer-actions'>
          <button type='button' className='ccx-drawer-primary' onClick={openSource}>
            OPEN SOURCE MODULE <ArrowUpRight size={14} />
          </button>
          <button type='button' className='ccx-drawer-secondary' onClick={onClose}>RETURN TO COMMAND</button>
        </footer>
      </aside>
    </div>
  );
}

export default function CommandCentre() {
  const navigate = useNavigate();
  const setOverview = useDashboardStore((state) => state.setOverview);
  const setConvoys = useDashboardStore((state) => state.setConvoys);
  const panic = useDashboardStore((state) => state.panicState);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [connectivity, setConnectivity] = useState(() => getSnapshot());

  const overviewQuery = useQuery<DashboardOverview>({
    queryKey: ['command-centre-overview'],
    queryFn: async () => (await api.get<DashboardOverview>('/dashboard/overview')).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const convoysQuery = useQuery<CommandConvoy[]>({
    queryKey: ['command-centre-convoys'],
    queryFn: async () => {
      const response = await api.get<CommandConvoyResponse>('/dashboard/convoys');
      return response.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const vehiclesQuery = useQuery<CommandVehicle[]>({
    queryKey: ['dashboard-vehicles'],
    queryFn: async () => {
      const response = await api.get<{ data?: CommandVehicle[] }>('/dashboard/vehicles');
      return response.data.data ?? [];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const timelineQuery = useQuery<CommandMilestone[]>({
    queryKey: ['command-centre-timeline'],
    queryFn: async () => {
      const response = await api.get<CommandTimelineResponse>('/dashboard/timeline');
      return response.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const mapQuery = useQuery<MapSnapshot>({
    queryKey: ['dashboard-map'],
    queryFn: async () => (await api.get<MapSnapshot>('/dashboard/map')).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (overviewQuery.data) setOverview(overviewQuery.data);
  }, [overviewQuery.data, setOverview]);

  useEffect(() => {
    if (convoysQuery.data) {
      const records: ConvoyUpdate[] = convoysQuery.data.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
      }));
      setConvoys(records);
    }
  }, [convoysQuery.data, setConvoys]);

  useEffect(() => subscribeConnectivity(setConnectivity), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const closeRecord = useCallback(() => setSelected(null), []);
  const activePanic = panic?.status === 'active';
  const overview = overviewQuery.data ?? null;
  const overviewAge = overviewQuery.dataUpdatedAt > 0 ? Math.max(0, now - overviewQuery.dataUpdatedAt) : null;
  const overviewStale = overviewAge != null && overviewAge > 120_000;
  const threat = overview?.threat.level ?? null;
  const criticalPictureReady = overview?.data_quality?.critical_ready !== false;
  const kpiPictureReady = overview?.data_quality?.kpi_ready !== false;
  const posture = activePanic ? 'PANIC ACTIVE' : !overview || !criticalPictureReady ? 'UNASSESSED' : overviewStale ? 'STALE SNAPSHOT' : threat === 'critical' ? 'CRITICAL' : threat === 'elevated' ? 'ELEVATED' : 'SECURE';
  const postureTone = activePanic || (criticalPictureReady && threat === 'critical') ? 'critical' : criticalPictureReady && threat === 'elevated' ? 'warning' : !overview || !criticalPictureReady || overviewStale || overviewQuery.isRefetchError ? 'unknown' : 'secure';
  const apiTone = !connectivity.apiReachable
    ? connectivity.state === 'OFFLINE' ? 'offline' : 'unknown'
    : connectivity.state === 'DEGRADED' ? 'degraded' : 'online';
  const overviewAgeText = overviewAge == null
    ? overviewQuery.isPending ? 'awaiting first response' : 'no verified response'
    : overviewQuery.isRefetchError
      ? 'refresh failed · last response ' + ageLabel(overviewAge) + ' ago'
      : 'browser received snapshot ' + ageLabel(overviewAge) + ' ago';

  const convoyRecords = convoysQuery.data?.data ?? [];
  const checkpointsReady = convoysQuery.data?.data_quality?.checkpoints_ready !== false;
  const vehicleRecords = vehiclesQuery.data ?? [];
  const milestones = timelineQuery.data?.data ?? [];
  const timelineQuality = timelineQuery.data?.data_quality ?? null;

  const refreshAll = () => {
    void Promise.all([
      overviewQuery.refetch(),
      convoysQuery.refetch(),
      vehiclesQuery.refetch(),
      timelineQuery.refetch(),
      mapQuery.refetch(),
    ]);
  };

  return (
    <main className='ccx-command'>
      <header className='ccx-header'>
        <div className='ccx-identity'>
          <span className='ccx-brand-mark'><Crosshair size={22} strokeWidth={1.7} /></span>
          <div>
            <span className='ccx-eyebrow'>SONALIT / OPERATIONS CONTROL</span>
            <h1>Command Centre</h1>
            <p>East Africa · Common operating picture</p>
          </div>
        </div>

        <div className={'ccx-posture ccx-posture--' + postureTone}>
          <span className='ccx-posture__beam' />
          <div>
            <small>THREAT POSTURE</small>
            <strong>{posture}</strong>
            <em>{overviewAgeText}</em>
          </div>
        </div>

        <div className='ccx-header-actions'>
          <div className='ccx-connection' aria-live='polite'>
            <span className={'ccx-connection__item ccx-connection__item--' + apiTone}>
              {apiTone === 'offline' ? <WifiOff size={14} /> : <Wifi size={14} />}
              <span>API {apiTone.toUpperCase()}</span>
            </span>
            <span className={'ccx-connection__item ' + (connectivity.realtimeConnected ? 'ccx-connection__item--online' : 'ccx-connection__item--offline')}>
              <Radio size={14} />
              <span>STREAM {connectivity.realtimeConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
            </span>
          </div>
          <button type='button' className='ccx-refresh' onClick={refreshAll} aria-label='Refresh all command centre data' title='Refresh operating picture'>
            <RefreshCw size={15} />
            <span>REFRESH</span>
          </button>
          <button
            type='button'
            className={activePanic ? 'ccx-panic ccx-panic--active' : 'ccx-panic'}
            onClick={() => void navigate({ to: '/panic-center' as any })}
          >
            <Siren size={15} /> {activePanic ? 'PANIC ACTIVE' : 'PANIC CENTRE'}
          </button>
        </div>
      </header>

      <section className='ccx-metrics' aria-label='Operational summary'>
        <MetricReadout
          icon={Truck}
          label='VEHICLES REPORTING'
          value={overview && kpiPictureReady ? overview.kpi.vehicles_live : '—'}
          detail='GPS fixes received in the last 5 min'
        />
        <MetricReadout
          icon={Route}
          label='ACTIVE CONVOYS'
          value={overview && kpiPictureReady ? overview.kpi.convoys_active : '—'}
          detail='Active movement records'
        />
        <MetricReadout
          icon={ShieldAlert}
          label='OPEN INCIDENTS'
          value={overview && kpiPictureReady ? overview.kpi.incidents_open : '—'}
          detail='Incident records with open status'
          tone={overview?.kpi.incidents_open ? 'warning' : 'default'}
        />
        <MetricReadout
          icon={AlertOctagon}
          label='OPEN ALERTS + PANIC'
          value={overview && criticalPictureReady ? overview.threat.alerts_open : '—'}
          detail='Unresolved alerts and panic events'
          tone={overview?.threat.alerts_open ? 'critical' : 'default'}
        />
      </section>

      <section className='ccx-command-grid' aria-label='Operational workspaces'>
        <div className='ccx-movement-column'>
          <MovementRegister
            convoys={convoyRecords}
            isLoading={convoysQuery.isPending}
            isError={convoysQuery.isError}
            onRetry={() => void convoysQuery.refetch()}
            onOpen={() => void navigate({ to: '/convoys' as any })}
            checkpointsReady={checkpointsReady}
          />
          <FleetSignal
            vehicles={vehicleRecords}
            isLoading={vehiclesQuery.isPending}
            isError={vehiclesQuery.isError}
            updatedAt={vehiclesQuery.dataUpdatedAt}
            now={now}
            onRetry={() => void vehiclesQuery.refetch()}
            onOpen={() => void navigate({ to: '/gps' as any })}
          />
        </div>

        <section className='ccx-panel ccx-map-panel' aria-label='East Africa operational map'>
          <div className='ccx-map-meta'>
            <div>
              <span className='ccx-eyebrow'>SPATIAL OPERATING PICTURE / 03</span>
              <h2>Regional theatre</h2>
            </div>
            <div className='ccx-map-freshness' aria-live='polite'>
              <span className={'ccx-map-freshness__dot ' + (mapQuery.data ? 'is-present' : 'is-missing')} />
              <span>{mapQuery.dataUpdatedAt > 0 ? 'Map snapshot ' + ageLabel(now - mapQuery.dataUpdatedAt) + ' ago' : mapQuery.isPending ? 'Waiting for map data' : 'No map snapshot'}</span>
              {mapQuery.isRefetchError && <strong>REFRESH FAILED</strong>}
            </div>
          </div>
          <div className='ccx-map-stage'>
            <Suspense fallback={<div className='ccx-map-loading'><Activity size={19} /> Preparing regional map</div>}>
              <TacticalMap fill />
            </Suspense>
            {mapQuery.isError && !mapQuery.data && (
              <div className='ccx-map-error'>
                <AlertOctagon size={17} />
                <span>Map data could not be loaded. The basemap alone is not an operational position feed.</span>
                <button type='button' onClick={() => void mapQuery.refetch()}>RETRY</button>
              </div>
            )}
          </div>
          <div className='ccx-map-foot'>
            <span><i className='ccx-map-key ccx-map-key--moving' /> Reported positions</span>
            <span><i className='ccx-map-key ccx-map-key--warning' /> Warning / alert states</span>
            <span><i className='ccx-map-key ccx-map-key--panic' /> Panic</span>
            <span className='ccx-map-foot__note'>Map and vehicle streams have independent refresh states</span>
          </div>
        </section>

        <aside className='ccx-panel ccx-response-panel' aria-labelledby='ccx-response-title'>
          <header className='ccx-panel-head ccx-response-head'>
            <div>
              <span className='ccx-eyebrow'>DECISION & RESPONSE / 04</span>
              <h2 id='ccx-response-title'>Priority response</h2>
              <p>Select a record to inspect its available context and source.</p>
            </div>
            <span className='ccx-response-mark'><AlertOctagon size={17} /></span>
          </header>
          <div className='ccx-response-content'>
            <PriorityQueue onSelect={setSelected} showNextDelivery={false} />
          </div>
          <footer className='ccx-response-foot'>
            <button type='button' onClick={() => void navigate({ to: '/alerts' as any })}>
              OPEN ALERT REGISTER <ArrowUpRight size={13} />
            </button>
          </footer>
        </aside>
      </section>

      <MilestoneTimeline
        items={milestones}
        isLoading={timelineQuery.isPending}
        isError={timelineQuery.isError}
        onRetry={() => void timelineQuery.refetch()}
        onOpen={(type) => void navigate({ to: milestoneDestination(type) as any })}
        partialSources={timelineQuality?.state === 'partial' ? (timelineQuality.failed_sources ?? []) : []}
      />

      {overviewQuery.isError && !overview && (
        <div className='ccx-page-warning' role='alert'>
          <AlertOctagon size={15} />
          <span>The overview request failed. Threat posture and summary values remain unassessed until a verified response is received.</span>
          <button type='button' onClick={() => void overviewQuery.refetch()}>RETRY OVERVIEW</button>
        </div>
      )}

      {selected && <RecordDrawer item={selected} onClose={closeRecord} />}
    </main>
  );
}
