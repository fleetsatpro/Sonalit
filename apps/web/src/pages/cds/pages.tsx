import { useState } from 'react';
import { Lock, Truck, MapPin, RefreshCw, CheckCircle2, Unlock, BrainCircuit, AlertTriangle, FileText, FileBarChart, Search, ShieldCheck, Clock3, Battery, BatteryCharging, BatteryWarning, Activity, Zap, ChevronRight, type LucideIcon } from 'lucide-react';

import { useAuthStore } from '../../stores/auth.js';
import { LoadingState } from './CDSDashboard.js';
import { Card, KPICard, Button, StatusBadge, DataTable, DrawerField, FilterChip, Badge } from './components.js';
import FieldAccessPanel from './FieldAccessPanel.js';
import { useDashboardKPIs, useLocks, useLockEvents, useTrips, useBookings, useActivity, useReports, useGenerateReport, useAlerts, useUnclampTrip } from './hooks.js';
import { useCDSStore } from './store.js';
import './CDSPerformanceAnalysis.css';


type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');


const LOCK_HEARTBEAT_STALE_MS = 15 * 60 * 1000;

function lockText(value: unknown, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}
function lockFlag(value: unknown) {
  return value === true || value === 'true' || value === 1;
}
function numericTelemetry(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function lockTelemetryAge(row: Row, timestampKey: string): number | null {
  const raw = row[timestampKey];
  if (!raw) return null;
  const timestamp = new Date(String(raw)).getTime();
  const now = Date.now();
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000) return null;
  return now - timestamp;
}
function lockTelemetryFresh(row: Row, timestampKey: string): boolean {
  const age = lockTelemetryAge(row, timestampKey);
  return age !== null && age <= LOCK_HEARTBEAT_STALE_MS;
}
function lockBattery(row: Row): number | null {
  return lockTelemetryFresh(row, 'reported_battery_at')
    ? numericTelemetry(row['reported_battery_level'], 0, 100) : null;
}
function lockLastReportedBattery(row: Row): number | null {
  return numericTelemetry(row['reported_battery_level'], 0, 100);
}
function lockInventoryBattery(row: Row): number | null {
  return numericTelemetry(row['battery_level'], 0, 100);
}
function lockHeartbeatAge(row: Row): number | null {
  return lockTelemetryAge(row, 'last_heartbeat_event_at');
}
function lockSignal(row: Row): string {
  if (!lockTelemetryFresh(row, 'reported_signal_at')) return 'unverified';
  const raw = row['reported_signal_strength'];
  if (raw === null || raw === undefined || raw === '') return 'unverified';
  const text = String(raw).trim().toLowerCase();
  if (['strong', 'medium', 'weak', 'offline'].includes(text)) return text;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0 && value <= 100) {
    return value >= 70 ? 'strong' : value >= 40 ? 'medium' : value > 0 ? 'weak' : 'offline';
  }
  return text;
}
function lockSolarState(row: Row): 'charging' | 'idle' | 'unverified' {
  if (!lockTelemetryFresh(row, 'reported_solar_at')) return 'unverified';
  const raw = row['reported_solar_charging'];
  if (raw === true || raw === 'true') return 'charging';
  if (raw === false || raw === 'false') return 'idle';
  return 'unverified';
}
function lockTamperState(row: Row): 'active' | 'clear' | 'unverified' {
  if (lockFlag(row['tamper_detected'])) return 'active';
  const raw = row['reported_tamper_detected'];
  if (raw === true || raw === 'true') return 'active';
  if ((raw === false || raw === 'false') && lockTelemetryFresh(row, 'reported_tamper_at')) return 'clear';
  return 'unverified';
}
function lockAgeLabel(value: unknown) {
  if (!value) return 'NOT RECORDED';
  const timestamp = new Date(String(value)).getTime();
  if (!Number.isFinite(timestamp)) return 'TIME UNKNOWN';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return minutes + 'M AGO';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'H AGO';
  return Math.floor(hours / 24) + 'D AGO';
}
function lockHealth(row: Row) {
  const status = lockText(row['status'], '').toLowerCase();
  const signal = lockSignal(row);
  const age = lockHeartbeatAge(row);
  const battery = lockBattery(row);
  const tamper = lockTamperState(row);
  if (tamper === 'active') {
    return { key: 'tamper', label: 'TAMPER DETECTED', note: lockText(row['tamper_status'], 'Device integrity alert') };
  }
  if (status === 'removed') return { key: 'removed', label: 'REMOVED', note: 'Not in active service' };
  if (status === 'maintenance') return { key: 'maintenance', label: 'MAINTENANCE', note: 'Device placed in maintenance' };
  if (status === 'offline' || signal === 'offline') return { key: 'offline', label: 'OFFLINE', note: 'Device reports no link' };
  if (age === null) return { key: 'unverified', label: 'UNVERIFIED', note: 'No persisted heartbeat event' };
  if (age > LOCK_HEARTBEAT_STALE_MS) {
    return { key: 'stale', label: 'STALE TELEMETRY', note: 'Last persisted heartbeat ' + lockAgeLabel(row['last_heartbeat_event_at']) };
  }
  if (battery !== null && battery < 25) return { key: 'low-battery', label: 'LOW BATTERY', note: 'Reported charge below the 25% attention threshold' };
  if (signal === 'weak') return { key: 'degraded', label: 'WEAK SIGNAL', note: 'Reported device link needs attention' };
  return { key: 'secure', label: 'REPORTING', note: 'Persisted heartbeat within 15 minutes' };
}
function LockHealthBadge({ row }: { row: Row }) {
  const health = lockHealth(row);
  return <span className={'cds-lock-health cds-lock-health--' + health.key}><i aria-hidden="true" />{health.label}</span>;
}
function LockBatteryReadout({ row, large = false }: { row: Row; large?: boolean }) {
  const level = lockBattery(row);
  const inventoryLevel = lockInventoryBattery(row);
  const lastReportedLevel = lockLastReportedBattery(row);
  const solar = lockSolarState(row);
  const charging = solar === 'charging';
  const low = level !== null && level < 25;
  const Icon = charging ? BatteryCharging : low ? BatteryWarning : Battery;
  const displayLevel = level !== null ? level + '%' : lastReportedLevel !== null ? lastReportedLevel + '%†' : inventoryLevel !== null ? inventoryLevel + '%*' : '—';
  return (
    <div className={'cds-lock-battery' + (large ? ' cds-lock-battery--large' : '') + (charging ? ' cds-lock-battery--charging' : '') + (low ? ' cds-lock-battery--low' : '') + (level === null ? ' cds-lock-battery--unverified' : '')}>
      <span className="cds-lock-battery__icon" aria-hidden="true"><Icon size={large ? 29 : 21} strokeWidth={1.8} /></span>
      <span className="cds-lock-battery__reading">{displayLevel}</span>
      {charging && <span className="cds-lock-battery__charge"><Zap size={10} aria-hidden="true" /> SOLAR INPUT</span>}
      {level === null && <span className="cds-lock-battery__charge cds-lock-battery__charge--unverified">{lastReportedLevel !== null ? 'LAST REPORT ' + lockAgeLabel(row['reported_battery_at']) : inventoryLevel !== null ? 'REGISTERED · UNVERIFIED' : 'NO BATTERY TELEMETRY'}</span>}
    </div>
  );
}
function LockSignalReadout({ value }: { value: unknown }) {
  const signal = lockText(value, 'unverified').toLowerCase();
  const numeric = Number(signal);
  const isRssi = signal !== 'unverified' && Number.isFinite(numeric) && numeric < 0;
  const bars = signal === 'strong' ? 4 : signal === 'medium' ? 3 : signal === 'weak' ? 1 : 0;
  return (
    <span className={'cds-lock-signal cds-lock-signal--' + (isRssi ? 'rssi' : signal)}>
      <span className="cds-lock-signal__bars" aria-hidden="true">
        {[1, 2, 3, 4].map(level => <i key={level} className={level <= bars ? 'active' : ''} />)}
      </span>
      <span>{signal === 'unverified' ? 'NOT REPORTED' : isRssi ? signal + ' dBm' : signal.toUpperCase()}</span>
    </span>
  );
}


function LockBatteryTrend({ events }: { events: Row[] }) {
  const samples = events.map(event => {
    const data = event['data'] && typeof event['data'] === 'object' ? event['data'] as Record<string, unknown> : {};
    const raw = data['battery_level'] ?? data['battery'] ?? data['level'];
    const level = numericTelemetry(raw, 0, 100);
    const at = event['created_at'] ? new Date(String(event['created_at'])).getTime() : NaN;
    return level === null || !Number.isFinite(at) ? null : { level, at };
  }).filter((sample): sample is { level: number; at: number } => sample !== null)
    .sort((a, b) => a.at - b.at)
    .slice(-12);
  const latest = samples[samples.length - 1];
  const first = samples[0];
  const delta = latest && first ? latest.level - first.level : 0;
  const coordinates = samples.map((sample, index) => ({
    x: samples.length < 2 ? 100 : 5 + index * (190 / (samples.length - 1)),
    y: 47 - sample.level * 0.39,
  }));
  const trace = coordinates.map((point, index) => (index === 0 ? 'M' : 'L') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  return (
    <section className="cds-lock-battery-trend" aria-label="Battery telemetry history">
      <header>
        <div><span>POWER INTELLIGENCE / EVENT-BACKED</span><b>Battery history trace</b></div>
        <div className="cds-lock-battery-trend__reading">
          <strong>{latest ? latest.level + '%' : '—'}</strong>
          <small>{samples.length >= 2 ? (delta > 0 ? '+' : '') + delta.toFixed(0) + ' PTS IN WINDOW' : samples.length === 1 ? 'ONE READING' : 'NO READINGS'}</small>
        </div>
      </header>
      {samples.length >= 2 ? (
        <>
          <svg className="cds-lock-battery-trend__chart" viewBox="0 0 200 54" role="img" aria-label={'Recent battery readings from ' + samples.length + ' persisted device events'}>
            <path d="M5 47H195 M5 27H195 M5 7H195" className="cds-lock-battery-trend__grid" />
            <path d={trace} className="cds-lock-battery-trend__line" />
            {coordinates.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === coordinates.length - 1 ? 3 : 1.8} className="cds-lock-battery-trend__point" />)}
          </svg>
          <div className="cds-lock-battery-trend__range"><span>MIN {Math.min(...samples.map(sample => sample.level))}%</span><span>MAX {Math.max(...samples.map(sample => sample.level))}%</span><span>{samples.length} SAMPLES</span></div>
        </>
      ) : (
        <div className="cds-lock-battery-trend__empty">
          {samples.length === 1 ? 'One battery reading is persisted. A trend needs another device report.' : 'No numeric battery readings are present in the returned device-event window.'}
        </div>
      )}
      <small className="cds-lock-battery-trend__footnote">Observed values only · no remaining-life projection or discharge forecast</small>
    </section>
  );
}

function LockEventHistory({ lockId }: { lockId: string }) {
  const { data, isLoading, isError, isFetching } = useLockEvents(lockId, 16);
  const events = data?.data ?? [];
  return (
    <section className="cds-lock-dossier__history">
      <header>
        <div><span>DEVICE EVIDENCE / EVENT STREAM</span><b>Recent lock events</b></div>
        <small>{isFetching ? 'UPDATING' : (data?.total ?? events.length) + ' RECORDED'}</small>
      </header>
      {!isLoading && !isError && <LockBatteryTrend events={events} />}
      {isLoading ? <div className="cds-lock-dossier__empty">Loading persisted device events…</div>
        : isError ? <div className="cds-lock-dossier__empty is-error">Event history could not be retrieved. Device state has not been inferred from a failed read.</div>
          : events.length ? (
            <div className="cds-lock-event-list">
              {events.map((event, index) => {
                const type = lockText(event['type'], 'event').toLowerCase();
                const eventData = event['data'] && typeof event['data'] === 'object' ? event['data'] as Record<string, unknown> : {};
                const detail = Object.entries(eventData)
                  .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
                  .slice(0, 3)
                  .map(([key, value]) => key.replaceAll('_', ' ') + ': ' + lockText(value, '—'))
                  .join(' · ');
                const timestamp = event['created_at'] ? new Date(String(event['created_at'])) : null;
                return (
                  <article className={'cds-lock-event cds-lock-event--' + type} key={lockText(event['id'], type + '-' + index)}>
                    <span className="cds-lock-event__marker" aria-hidden="true"><Activity size={12} /></span>
                    <div className="cds-lock-event__body">
                      <div><b>{type.replaceAll('_', ' ').toUpperCase()}</b><small>{timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString() : 'TIME NOT RECORDED'}</small></div>
                      {detail && <p>{detail}</p>}
                      {(event['lat'] != null && event['lng'] != null) && <small className="cds-lock-event__coordinates">{Number(event['lat']).toFixed(5)}, {Number(event['lng']).toFixed(5)}</small>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className="cds-lock-dossier__empty">No device event records returned for this lock.</div>}
    </section>
  );
}

function LockDossier({ lock }: { lock: Row }) {
  const temperatureValue = numericTelemetry(lock['reported_temperature'], -80, 150);
  const temperatureFresh = lockTelemetryFresh(lock, 'reported_temperature_at');
  const temperature = temperatureValue === null ? 'NOT REPORTED' : temperatureValue.toFixed(1) + ' °C' + (temperatureFresh ? '' : ' · STALE');
  const coordinates = lock['lat'] != null && lock['lng'] != null
    ? Number(lock['lat']).toFixed(5) + ', ' + Number(lock['lng']).toFixed(5) : 'NOT REPORTED';
  return (
    <div className="cds-lock-dossier">
      <section className={'cds-lock-dossier__hero cds-lock-dossier__hero--' + lockHealth(lock).key}>
        <div className="cds-lock-dossier__identity">
          <span>SECURITY DEVICE / {lockText(lock['provider'], 'PROVIDER NOT RECORDED').toUpperCase()}</span>
          <h3>{lockText(lock['serial'] ?? lock['serial_number'] ?? lock['lock_id'])}</h3>
          <LockHealthBadge row={lock} />
        </div>
        <LockBatteryReadout row={lock} large />
      </section>
      <div className="cds-lock-dossier__metrics">
        <div><small>CONNECTION</small><LockSignalReadout value={lockSignal(lock)} /></div>
        <div><small>LAST HEARTBEAT</small><b>{lockAgeLabel(lock['last_heartbeat_event_at'])}</b><span>{lock['last_heartbeat_event_at'] ? new Date(String(lock['last_heartbeat_event_at'])).toLocaleString() : 'No heartbeat event'}</span></div>
        <div><small>THERMAL TELEMETRY</small><b>{temperature}</b><span>{lockAgeLabel(lock['reported_temperature_at'])} · EVENT-BACKED</span></div>
        <div><small>SOLAR INPUT</small><b>{lockSolarState(lock) === 'charging' ? 'CHARGING' : lockSolarState(lock) === 'idle' ? 'NOT CHARGING' : 'NOT REPORTED'}</b><span>Latest persisted heartbeat payload</span></div>
      </div>
      <section className="cds-lock-dossier__section">
        <header><b>Assignment & device identity</b><span>Persisted inventory fields</span></header>
        <div className="cds-lock-dossier__fields">
          <div><small>CONTAINER</small><b>{lockText(lock['container_number'])}</b></div>
          <div><small>VEHICLE</small><b>{lockText(lock['truck'] ?? lock['vehicle_reg'])}</b></div>
          <div><small>DEVICE STATUS</small><b>{lockText(lock['status']).toUpperCase()}</b></div>
          <div><small>FIRMWARE</small><b>{lockText(lock['firmware_version'], 'NOT RECORDED')}</b></div>
          <div><small>LOCATION</small><b>{lockText(lock['location'], coordinates)}</b></div>
          <div><small>COORDINATES</small><b>{coordinates}</b></div>
          <div><small>LAST DEVICE EVENT</small><b>{lockAgeLabel(lock['last_persisted_event_at'])}</b></div>
          <div><small>TAMPER CHANNEL</small><b>{lockTamperState(lock) === 'active' ? lockText(lock['tamper_status'], 'ALERT ACTIVE').toUpperCase() : lockTamperState(lock) === 'clear' ? 'CLEAR · DEVICE REPORTED' : 'NOT REPORTED'}</b></div>
          <div><small>REGISTERED BATTERY</small><b>{lockInventoryBattery(lock) === null ? 'NOT RECORDED' : lockInventoryBattery(lock) + '% · UNVERIFIED BASELINE'}</b></div>
        </div>
      </section>
      <div className="cds-lock-dossier__notice"><ShieldCheck size={14} aria-hidden="true" /><span>This console presents persisted inventory and device telemetry. Remote lock / unlock actuation is not exposed by the current CDS API, so no hardware command is simulated here.</span></div>
      <LockEventHistory lockId={lockText(lock['id'], '')} />
    </div>
  );
}

export function LocksView() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('priority');
  const { data, isLoading, isError, isFetching, refetch } = useLocks();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;

  const all = (data?.data ?? []) as Row[];
  const total = Number(data?.total ?? all.length);
  const count = (predicate: (row: Row) => boolean) => all.filter(predicate).length;
  const tamper = count(row => lockHealth(row).key === 'tamper');
  const offline = count(row => lockHealth(row).key === 'offline');
  const stale = count(row => lockHealth(row).key === 'stale');
  const fresh = count(row => {
    const age = lockHeartbeatAge(row);
    return age !== null && age <= LOCK_HEARTBEAT_STALE_MS;
  });
  const low = count(row => {
    const battery = lockBattery(row);
    return battery !== null && battery < 25;
  });
  const charging = count(row => lockSolarState(row) === 'charging');
  const attention = count(row => ['tamper', 'offline', 'stale', 'low-battery', 'degraded', 'unverified'].includes(lockHealth(row).key));
  const thermal = count(row => numericTelemetry(row['reported_temperature'], -80, 150) !== null && lockTelemetryFresh(row, 'reported_temperature_at'));
  const filters = [
    { id: 'all', label: 'All devices', total: all.length },
    { id: 'attention', label: 'Needs attention', total: attention },
    { id: 'tamper', label: 'Tamper', total: tamper },
    { id: 'offline', label: 'Offline', total: offline },
    { id: 'stale', label: 'Stale heartbeat', total: stale },
    { id: 'low', label: 'Low battery', total: low },
    { id: 'charging', label: 'Solar charging', total: charging },
    { id: 'maintenance', label: 'Maintenance', total: count(row => lockHealth(row).key === 'maintenance') },
  ];
  const searchTerm = query.trim().toLowerCase();
  const matches = all.filter(row => {
    const health = lockHealth(row).key;
    const battery = lockBattery(row);
    const filterMatch = filter === 'all'
      || (filter === 'attention' && ['tamper', 'offline', 'stale', 'low-battery', 'degraded', 'unverified'].includes(health))
      || (filter === 'low' && battery !== null && battery < 25)
      || (filter === 'charging' && lockSolarState(row) === 'charging')
      || (filter === health);
    if (!filterMatch) return false;
    if (!searchTerm) return true;
    return [
      row['serial'], row['serial_number'], row['provider'], row['container_number'],
      row['truck'], row['vehicle_reg'], row['location'], row['status'],
      row['firmware_version'], row['tamper_status'],
    ].some(value => String(value ?? '').toLowerCase().includes(searchTerm));
  });
  const healthPriority: Record<string, number> = {
    tamper: 0, offline: 1, 'low-battery': 2, stale: 3, degraded: 4,
    unverified: 5, maintenance: 6, removed: 7, secure: 8,
  };
  const rows = [...matches].sort((a, b) => {
    if (sort === 'battery') return (lockBattery(a) ?? 101) - (lockBattery(b) ?? 101);
    if (sort === 'heartbeat') return (lockHeartbeatAge(b) ?? -1) - (lockHeartbeatAge(a) ?? -1);
    if (sort === 'serial') return lockText(a['serial']).localeCompare(lockText(b['serial']));
    return (healthPriority[lockHealth(a).key] ?? 9) - (healthPriority[lockHealth(b).key] ?? 9);
  });
  const powerWatch = [...all]
    .filter(row => lockBattery(row) !== null)
    .sort((a, b) => (lockBattery(a) ?? 101) - (lockBattery(b) ?? 101))
    .slice(0, 4);

  return (
    <div className="cds-lock-console">
      <header className="cds-lock-console__head">
        <div>
          <div className="cds-lock-console__eyebrow"><ShieldCheck size={13} aria-hidden="true" /> HARDWARE SECURITY / DEVICE TELEMETRY</div>
          <h2>E-Lock Control</h2>
          <p>Device posture, power state, signal quality and integrity evidence in one control surface.</p>
        </div>
        <div className="cds-lock-console__head-side">
          <div><small>REGISTERED DEVICES</small><b>{total.toLocaleString()}</b><span>{all.length.toLocaleString()} loaded in this view</span></div>
          <button type="button" onClick={() => { void refetch(); }} disabled={isFetching} aria-label="Refresh e-lock inventory">
            <RefreshCw size={14} className={isFetching ? 'cds-lock-refreshing' : ''} /> {isFetching ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      {isError && <div role="alert" className="cds-lock-console__error">The latest lock inventory request failed. Any already loaded records remain visible; unavailable telemetry is not replaced with assumed values.</div>}

      <section className="cds-lock-metrics" aria-label="E-lock fleet metrics">
        <div><small>FRESH HEARTBEATS</small><b>{fresh}</b><span>{all.length ? Math.round(fresh / all.length * 100) + '% of loaded devices' : 'No device records'}</span></div>
        <div><small>NEEDS ATTENTION</small><b className={attention ? 'alert' : ''}>{attention}</b><span>Derived from persisted device state</span></div>
        <div><small>TAMPER FLAGS</small><b className={tamper ? 'critical' : ''}>{tamper}</b><span>Device-reported integrity state</span></div>
        <div><small>LOW BATTERY</small><b className={low ? 'warning' : ''}>{low}</b><span>Below 25% reported charge</span></div>
        <div><small>OFFLINE / STALE</small><b className={offline + stale ? 'warning' : ''}>{offline + stale}</b><span>No link or heartbeat older than 15m</span></div>
        <div><small>SOLAR CHARGING</small><b>{charging}</b><span>{thermal} devices report temperature</span></div>
      </section>

      <div className="cds-lock-controlbar">
        <label className="cds-lock-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search serial, container, vehicle, provider, firmware…" aria-label="Search e-lock inventory" /></label>
        <label className="cds-lock-sort"><span>SORT</span><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort lock devices"><option value="priority">Risk priority</option><option value="battery">Lowest battery</option><option value="heartbeat">Oldest heartbeat</option><option value="serial">Serial number</option></select></label>
      </div>

      <nav className="cds-lock-filters" aria-label="Filter e-lock inventory">
        {filters.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<b>{item.total}</b></button>)}
      </nav>

      {powerWatch.length > 0 && (
        <section className="cds-lock-power-watch" aria-label="Lowest reported battery devices">
          <header><div><span>POWER INTELLIGENCE / PRIORITY WATCH</span><b>Lowest reported charge</b></div><small>NO BATTERY-LIFE ESTIMATE INFERRED</small></header>
          <div className="cds-lock-power-watch__items">
            {powerWatch.map(row => (
              <button type="button" key={lockText(row['id'])} onClick={() => openDrawer('E-Lock ' + lockText(row['serial']), <LockDossier lock={row} />)}>
                <LockBatteryReadout row={row} />
                <span><b>{lockText(row['serial'])}</b><small>{lockText(row['container_number'], 'UNASSIGNED')}</small></span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="cds-lock-results-head"><div><span>DEVICE REGISTER</span><b>{rows.length} MATCHING / {all.length} LOADED</b></div><small>HEARTBEAT FRESHNESS THRESHOLD · 15 MINUTES</small></div>
      {rows.length ? (
        <div className="cds-lock-grid">
          {rows.map((row, index) => {
            const serial = lockText(row['serial'] ?? row['serial_number'] ?? row['lock_id'], 'LOCK ' + (index + 1));
            const battery = lockBattery(row);
            const signal = lockSignal(row);
            const heartbeatAge = lockHeartbeatAge(row);
            const location = lockText(row['location'], row['lat'] != null && row['lng'] != null
              ? Number(row['lat']).toFixed(4) + ', ' + Number(row['lng']).toFixed(4) : 'LOCATION NOT REPORTED');
            return (
              <button type="button" className={'cds-lock-device cds-lock-device--' + lockHealth(row).key} key={lockText(row['id'], serial)} onClick={() => openDrawer('E-Lock ' + serial, <LockDossier lock={row} />)}>
                <div className="cds-lock-device__top">
                  <div><small>DEVICE / {lockText(row['provider'], 'UNKNOWN PROVIDER').toUpperCase()}</small><b>{serial}</b></div>
                  <LockHealthBadge row={row} />
                </div>
                <div className="cds-lock-device__power">
                  <LockBatteryReadout row={row} />
                  <div className="cds-lock-device__power-track"><i style={{ width: (battery ?? 0) + '%' }} data-missing={battery === null ? 'true' : 'false'} /></div>
                  <small>{lockSolarState(row) === 'charging' ? 'SOLAR INPUT · RECENT HEARTBEAT' : lockSolarState(row) === 'idle' ? 'NOT CHARGING · RECENT HEARTBEAT' : battery === null ? 'POWER STATE UNKNOWN' : battery < 25 ? 'LOW POWER · REVIEW' : 'CHARGE STATE UNVERIFIED'}</small>
                </div>
                <div className="cds-lock-device__telemetry">
                  <div><small>LINK</small><LockSignalReadout value={signal} /></div>
                  <div><small>HEARTBEAT</small><b>{heartbeatAge === null ? 'UNVERIFIED' : lockAgeLabel(row['last_heartbeat_event_at'])}</b></div>
                  <div><small>TEMPERATURE</small><b>{numericTelemetry(row['reported_temperature'], -80, 150) === null ? '—' : numericTelemetry(row['reported_temperature'], -80, 150)!.toFixed(1) + '°C' + (lockTelemetryFresh(row, 'reported_temperature_at') ? '' : ' · STALE')}</b></div>
                </div>
                <div className="cds-lock-device__assignment">
                  <span><MapPin size={12} aria-hidden="true" /> {location}</span>
                  <span><Lock size={12} aria-hidden="true" /> {lockText(row['container_number'], 'UNASSIGNED')}</span>
                </div>
                <footer><span>FW {lockText(row['firmware_version'], '—')}</span><span>LAST EVENT {lockAgeLabel(row['last_persisted_event_at'])}</span><ChevronRight size={14} aria-hidden="true" /></footer>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="cds-lock-empty"><Activity size={21} aria-hidden="true" /><b>{isError && all.length === 0 ? 'LOCK INVENTORY UNAVAILABLE' : 'NO DEVICES MATCH THIS VIEW'}</b><span>{all.length ? 'Adjust the selected health filter or search phrase. The underlying device records are unchanged.' : 'No e-lock records were returned for this organisation. This is not evidence of a healthy or empty device fleet.'}</span></div>
      )}
      {total > all.length && <div className="cds-lock-pagination-note">Showing {all.length} of {total} registered records. The current API read is capped at 200 devices.</div>}
    </div>
  );
}

export function PortView() {
  const { data, isLoading } = useTrips({ status: 'at_port' });
  const { openDrawer, addToast } = useCDSStore();
  // This button used to call addToast('Unclamp initiated…') and nothing else:
  // no request was ever sent. The controller saw the confirmation, the lock
  // stayed installed, the trip stayed open, and the port crew was left holding
  // a container the desk believed was released.
  const unclamp = useUnclampTrip();
  if (isLoading) return <LoadingState />;
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <DataTable
        columns={[
          { id: 'container', header: 'Container', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['container_number'])}</span> },
          { id: 'truck', header: 'Truck', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['vehicle_reg'])}</span> },
          { id: 'dest', header: 'Terminal', accessor: (r: Row) => s(r['destination']) },
          { id: 'arrived', header: 'Arrived', accessor: (r: Row) => r['delivered_at'] ? new Date(s(r['delivered_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'action', header: '', accessor: (r: Row) => (
            <Button
              size="sm"
              disabled={unclamp.isPending}
              onClick={(e) => {
                e.stopPropagation();
                unclamp.mutate({ id: s(r['id']) }, {
                  onSuccess: () => addToast(`Lock removed on ${s(r['container_number'])}`),
                  onError: () => addToast(`Could not unclamp ${s(r['container_number'])} — try again`),
                });
              }}
            >
              {unclamp.isPending ? 'Unclamping…' : 'Unclamp'}
            </Button>
          )},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search port queue…"
        onRowClick={(r: Row) => openDrawer(`Port — ${s(r['container_number'])}`, (
          <>
            <DrawerField label="Container" value={s(r['container_number'])} />
            <DrawerField label="Truck" value={s(r['vehicle_reg'])} />
            <DrawerField label="Driver" value={s(r['driver_name'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Destination" value={s(r['destination'])} />
          </>
        ))}
      />
    </div>
  );
}

const ACTIVE_STATUSES = new Set([
  'created', 'draft', 'pending', 'approved', 'assigned', 'vehicle_assigned',
  'driver_assigned', 'awaiting_lock', 'locked', 'installed', 'dispatched',
  'in_transit', 'transit', 'checkpoint', 'delayed', 'at_port',
]);
const COMPLETED_STATUSES = new Set(['delivered', 'completed', 'billed', 'archived']);
const EXCEPTION_STATUSES = new Set(['delayed', 'cancelled', 'failed']);
const TRANSIT_STATUSES = new Set(['dispatched', 'in_transit', 'transit', 'checkpoint']);

const STALE_HOURS = 48;

function isToday(dateStr: unknown): boolean {
  if (!dateStr) return false;
  const d = new Date(String(dateStr));
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function hoursSince(dateStr: unknown): number {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(String(dateStr)).getTime()) / 3_600_000;
}

function StatusDistribution({ counts, total }: { counts: { label: string; count: number; color: string }[]; total: number }) {
  if (total === 0) return null;
  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] tracking-wider text-text-2">STATUS DISTRIBUTION</span>
        <span className="font-mono text-[10px] text-text-2">{total} bookings</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-ink-3 mb-3">
        {counts.filter(c => c.count > 0).map(c => (
          <div key={c.label} className="h-full transition-all" style={{ width: `${(c.count / total) * 100}%`, background: c.color }} title={`${c.label}: ${c.count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {counts.filter(c => c.count > 0).map(c => (
          <div key={c.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: c.color }} />
            <span className="text-[10px] text-text-2 font-mono">{c.label}</span>
            <span className="text-[10px] text-text-0 font-mono font-bold">{c.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PulseView() {
  const [filter, setFilter] = useState('all');
  const { data, isLoading } = useBookings();
  const { data: alertData } = useAlerts();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;
  const all = (data?.data ?? []) as Row[];
  const alerts = (alertData?.data ?? []) as Row[];

  const activeRows = all.filter(r => ACTIVE_STATUSES.has(s(r['status'])));
  const inTransit = all.filter(r => TRANSIT_STATUSES.has(s(r['status'])));
  const completedToday = all.filter(r => COMPLETED_STATUSES.has(s(r['status'])) && isToday(r['updated_at']));
  const exceptions = all.filter(r => {
    if (EXCEPTION_STATUSES.has(s(r['status']))) return true;
    if (ACTIVE_STATUSES.has(s(r['status'])) && hoursSince(r['updated_at']) > STALE_HOURS) return true;
    return false;
  });
  const staleActive = all.filter(r => ACTIVE_STATUSES.has(s(r['status'])) && !EXCEPTION_STATUSES.has(s(r['status'])) && hoursSince(r['updated_at']) > STALE_HOURS);

  const statusGroups = [
    { label: 'Pending', count: all.filter(r => ['created', 'draft', 'pending', 'approved'].includes(s(r['status']))).length, color: '#64748b' },
    { label: 'Assigned', count: all.filter(r => ['assigned', 'vehicle_assigned', 'driver_assigned'].includes(s(r['status']))).length, color: '#ff7a00' },
    { label: 'In Transit', count: inTransit.length, color: '#37e6ff' },
    { label: 'At Port', count: all.filter(r => s(r['status']) === 'at_port').length, color: '#ffb020' },
    { label: 'Delayed', count: all.filter(r => s(r['status']) === 'delayed').length, color: '#ff5c5c' },
    { label: 'Delivered', count: all.filter(r => s(r['status']) === 'delivered').length, color: '#33d6a8' },
    { label: 'Completed', count: all.filter(r => ['completed', 'billed'].includes(s(r['status']))).length, color: '#22c55e' },
  ];

  const filterMap: Record<string, Row[]> = {
    all,
    active: activeRows,
    transit: inTransit,
    exceptions,
    completed: all.filter(r => COMPLETED_STATUSES.has(s(r['status']))),
  };
  const rows = filterMap[filter] ?? all;

  const isException = (r: Row) => EXCEPTION_STATUSES.has(s(r['status'])) || (ACTIVE_STATUSES.has(s(r['status'])) && hoursSince(r['updated_at']) > STALE_HOURS);

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KPICard label="ACTIVE BOOKINGS" value={String(activeRows.length)} delta={`${all.length} total`} trend="up" />
        <KPICard label="IN TRANSIT" value={String(inTransit.length)} delta="moving now" trend="up" />
        <KPICard label="EXCEPTIONS" value={String(exceptions.length)} delta={staleActive.length > 0 ? `${staleActive.length} stale` : 'none flagged'} trend={exceptions.length > 0 ? 'down' : 'up'} />
        <KPICard label="COMPLETED TODAY" value={String(completedToday.length)} delta={`${alerts.length} alerts`} trend={completedToday.length > 0 ? 'up' : 'down'} />
      </div>

      <StatusDistribution counts={statusGroups} total={all.length} />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          { id: 'all', label: `All (${all.length})` },
          { id: 'active', label: `Active (${activeRows.length})` },
          { id: 'transit', label: `In Transit (${inTransit.length})` },
          { id: 'exceptions', label: `Exceptions (${exceptions.length})` },
          { id: 'completed', label: `Completed (${all.filter(r => COMPLETED_STATUSES.has(s(r['status']))).length})` },
        ].map(f => <FilterChip key={f.id} label={f.label} active={filter === f.id} onClick={() => setFilter(f.id)} />)}
      </div>

      <DataTable
        columns={[
          { id: 'ref', header: 'Booking Ref', accessor: (r: Row) => (
            <div className="flex items-center gap-1.5">
              {isException(r) && <span className="w-1.5 h-1.5 rounded-full bg-cds-red flex-none" style={{ boxShadow: '0 0 6px rgba(255,92,92,.6)' }} />}
              <span className="font-mono font-bold text-cds-orange text-xs">{s(r['booking_number'])}</span>
            </div>
          )},
          { id: 'client', header: 'Client', accessor: (r: Row) => <span className="text-xs truncate max-w-[140px] block">{s(r['customer_name'])}</span> },
          { id: 'route', header: 'Route', accessor: (r: Row) => {
            const from = s(r['pickup_location'] ?? r['origin']);
            const to = s(r['delivery_location'] ?? r['destination']);
            if (from === '—' && to === '—') return <span className="text-text-2 text-xs">—</span>;
            return <span className="text-[10px] font-mono text-text-1 truncate max-w-[180px] block">{from} → {to}</span>;
          }},
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'age', header: 'Last Update', accessor: (r: Row) => {
            const h = hoursSince(r['updated_at']);
            const stale = ACTIVE_STATUSES.has(s(r['status'])) && h > STALE_HOURS;
            if (!isFinite(h)) return <span className="text-text-2 text-[10px] font-mono">—</span>;
            const label = h < 1 ? '<1h ago' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
            return <span className={`text-[10px] font-mono ${stale ? 'text-cds-red font-bold' : 'text-text-2'}`}>{label}{stale ? ' !' : ''}</span>;
          }},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search bookings…"
        onRowClick={(r: Row) => openDrawer(`Pulse — ${s(r['booking_number'])}`, (
          <>
            <DrawerField label="Booking #" value={<span className="text-cds-orange">{s(r['booking_number'])}</span>} />
            {s(r['carrier_reference']) !== '—' && <DrawerField label="Carrier Ref" value={s(r['carrier_reference'])} />}
            <DrawerField label="Client" value={s(r['customer_name'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Commodity" value={s(r['commodity'])} />
            {s(r['pickup_location'] ?? r['origin']) !== '—' && <DrawerField label="From" value={s(r['pickup_location'] ?? r['origin'])} />}
            {s(r['delivery_location'] ?? r['destination']) !== '—' && <DrawerField label="To" value={s(r['delivery_location'] ?? r['destination'])} />}
            {s(r['vessel']) !== '—' && <DrawerField label="Vessel" value={`${s(r['vessel'])} / ${s(r['voyage'])}`} />}
            {s(r['shipping_line']) !== '—' && <DrawerField label="Line" value={s(r['shipping_line'])} />}
            {r['eta'] && <DrawerField label="ETA" value={new Date(s(r['eta'])).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} />}
            <DrawerField label="Last Updated" value={r['updated_at'] ? new Date(s(r['updated_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} />
            <DrawerField label="Created" value={r['created_at'] ? new Date(s(r['created_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} />
            {isException(r) && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-cds-red/10 border border-cds-red/20">
                <div className="text-[10px] font-mono text-cds-red font-bold tracking-wider mb-1">EXCEPTION</div>
                <div className="text-[11px] text-cds-red/80">
                  {EXCEPTION_STATUSES.has(s(r['status'])) ? `Status: ${s(r['status']).toUpperCase()}` : `No update in ${Math.floor(hoursSince(r['updated_at']))}h — possible stall`}
                </div>
              </div>
            )}
          </>
        ))}
      />
    </div>
  );
}

export function InboxView() {
  const [sourceFilter, setSourceFilter] = useState<'all' | 'custody' | 'lock' | 'trip' | 'alert'>('all');
  const [query, setQuery] = useState('');
  const { data: activity, isLoading, isError, refetch, isFetching } = useActivity(100);
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;

  const items = (activity ?? []) as Row[];
  const sourceOf = (item: Row) => String(item['source'] ?? 'other');
  const filtered = items.filter(item => {
    const sourceMatch = sourceFilter === 'all' || sourceOf(item) === sourceFilter;
    const q = query.trim().toLowerCase();
    const searchMatch = !q || [
      item['text'], item['meta'], item['actor'], item['container_number'],
      item['booking_number'], item['trip_number'], item['lock_serial'],
      item['driver_name'], item['vehicle_registration'], item['transporter_name'],
    ].some(value => String(value ?? '').toLowerCase().includes(q));
    return sourceMatch && searchMatch;
  });
  const counts = {
    all: items.length,
    custody: items.filter(item => sourceOf(item) === 'custody').length,
    lock: items.filter(item => sourceOf(item) === 'lock').length,
    trip: items.filter(item => sourceOf(item) === 'trip').length,
    alert: items.filter(item => sourceOf(item) === 'alert').length,
  };
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = items.filter(item => item['created_at'] && new Date(String(item['created_at'])).getTime() >= recentCutoff).length;
  const exceptions = items.filter(item => sourceOf(item) === 'alert').length;

  const iconMap: Record<string, LucideIcon> = {
    clamp: Lock, depart: Truck, checkpoint: MapPin, sync: RefreshCw,
    arrival: CheckCircle2, unclamp: Unlock, ai: BrainCircuit, alert: AlertTriangle,
    lock: Lock, unlock: Unlock,
  };
  const sourceLabel: Record<string, string> = {
    custody: 'Custody event', lock: 'E-lock event', trip: 'Trip transition', alert: 'Alert / exception',
  };
  const sourceTone: Record<string, string> = {
    custody: 'border-cds-teal/20 bg-cds-teal/[.07] text-cds-teal',
    lock: 'border-sky-300/20 bg-sky-300/[.06] text-sky-200',
    trip: 'border-violet-300/20 bg-violet-300/[.06] text-violet-200',
    alert: 'border-red-300/20 bg-red-300/[.06] text-red-200',
  };
  const field = (label: string, value: unknown) => value == null || value === '' ? null : (
    <div key={label} className="min-w-0 rounded-lg border border-white/[.06] bg-white/[.025] p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-text-2">{label}</div>
      <div className="mt-1 break-words text-[11px] font-medium text-text-0">{String(value)}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[.07] pb-4">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[.18em] text-[#8eb9ed]">Operational evidence / Event ledger</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-0 sm:text-2xl">Activity & custody</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-2">A chronological control-room view of physical custody handoffs, e-lock device events, trip transitions and operational exceptions.</p>
        </div>
        <button type="button" disabled={isFetching} onClick={() => void refetch()} className="min-h-[38px] rounded-lg border border-white/10 px-3 text-[11px] font-semibold text-text-1 hover:bg-white/[.05] disabled:opacity-50">
          {isFetching ? 'Refreshing…' : 'Refresh event records'}
        </button>
      </header>
      {isError && <div role="status" className="rounded-lg border border-amber-300/20 bg-amber-300/[.05] p-3 text-xs text-amber-100">The latest event refresh failed. Previously loaded records remain visible; no placeholder events have been added.</div>}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {[
          { label: 'Events loaded', value: counts.all, note: 'Most recent records' },
          { label: 'Custody handoffs', value: counts.custody, note: 'Clamp and unclamp records' },
          { label: 'Last 24 hours', value: recent, note: 'Based on event timestamps' },
          { label: 'Alerts in view', value: exceptions, note: 'Requires review' },
        ].map(metric => (
          <div key={metric.label} className="rounded-xl border border-white/[.07] bg-[#111a28] p-3.5">
            <div className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/45">{metric.label}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">{metric.value.toLocaleString()}</div>
            <div className="mt-1 text-[10px] text-white/40">{metric.note}</div>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-white/[.08] bg-[#0d1726]">
        <div className="border-b border-white/[.07] p-3.5 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search event records</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" aria-hidden="true" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search container, booking, lock, driver, vehicle, partner or event…" className="min-h-[42px] w-full rounded-lg border border-white/[.09] bg-[#101a2a] pl-9 pr-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-[#8eb9ed]/60" />
            </label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter event source">
              {(['all', 'custody', 'lock', 'trip', 'alert'] as const).map(source => (
                <button key={source} type="button" aria-pressed={sourceFilter === source} onClick={() => setSourceFilter(source)} className={'min-h-[36px] rounded-md border px-3 text-[10px] font-semibold capitalize transition-colors ' + (sourceFilter === source ? 'border-[#8eb9ed]/35 bg-[#8eb9ed]/10 text-[#c4def9]' : 'border-white/[.07] text-text-2 hover:bg-white/[.04] hover:text-text-0')}>
                  {source === 'all' ? 'All events' : source === 'lock' ? 'E-lock' : source} <span className="ml-1 font-mono opacity-65">{counts[source]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-2">
            <span>{filtered.length.toLocaleString()} matching records</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 size={12} aria-hidden="true" /> Sorted by recorded event time, newest first</span>
          </div>
        </div>
        <div className="divide-y divide-white/[.055]">
          {filtered.map((item, index) => {
            const source = sourceOf(item);
            const Icon = iconMap[String(item['icon'] ?? item['type'] ?? '')] ?? FileText;
            const timestamp = item['created_at'] ? new Date(String(item['created_at'])) : null;
            const dateLabel = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString() : 'Timestamp unavailable';
            const detailPairs: Array<[string, unknown]> = [
              ['Recorded by', item['actor']], ['Container', item['container_number']],
              ['Booking', item['booking_number']], ['Trip', item['trip_number']],
              ['Lock', item['lock_serial']], ['Driver', item['driver_name']],
              ['Vehicle', item['vehicle_registration']], ['Transport partner', item['transporter_name']],
              ['Severity', item['severity']], ['Evidence type', item['evidence']],
              ['Entity reference', item['entity_id']],
            ];
            return (
              <button key={String(item['id'] ?? index)} type="button" onClick={() => openDrawer(String(item['text'] ?? 'Event detail'), (
                <div className="space-y-4">
                  <div className="rounded-lg border border-white/[.07] bg-white/[.025] p-3">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-[#8eb9ed]">{sourceLabel[source] ?? 'Operational event'}</div>
                    <div className="mt-1 text-sm font-semibold text-text-0">{String(item['text'] ?? 'Untitled event')}</div>
                    <div className="mt-1 text-[10px] text-text-2">{dateLabel}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">{detailPairs.map(([label, value]) => field(label, value)).filter(Boolean)}</div>
                  {item['meta'] ? <div className="rounded-lg border border-white/[.06] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Recorded context</div><p className="mt-1 text-[11px] leading-relaxed text-text-1">{String(item['meta'])}</p></div> : null}
                  {source === 'custody' ? <div className="rounded-lg border border-cds-teal/15 bg-cds-teal/[.04] p-3 text-[10px] leading-relaxed text-text-1">This is a persisted custody-chain event. Open the matching container in Container Register to re-verify the complete per-booking hash chain and review the associated clamp/unclamp handoffs.</div> : null}
                </div>
              ))} className="group flex w-full items-start gap-3 px-3.5 py-3.5 text-left transition-colors hover:bg-white/[.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8eb9ed]/70 sm:px-4">
                <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-white/[.07] bg-white/[.025] text-text-2 group-hover:border-white/15">
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold text-text-0">{String(item['text'] ?? '—')}</span>
                    <span className={'rounded-md border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ' + (sourceTone[source] ?? 'border-white/10 text-text-2')}>{sourceLabel[source] ?? source}</span>
                  </span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-text-2">{String(item['meta'] ?? 'No additional event context recorded.')}</span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-white/40">
                    {item['actor'] ? <span>By {String(item['actor'])}</span> : null}
                    {item['container_number'] ? <span>Container {String(item['container_number'])}</span> : null}
                    {item['lock_serial'] ? <span>Lock {String(item['lock_serial'])}</span> : null}
                  </span>
                </span>
                <span className="ml-2 flex-none text-right">
                  <span className="block whitespace-nowrap text-[10px] font-mono text-text-1">{timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  <span className="mt-1 block whitespace-nowrap text-[9px] text-text-2">{timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleDateString([], { day: '2-digit', month: 'short' }) : ''}</span>
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center">
              <div className="text-sm font-semibold text-text-0">{items.length ? 'No events match this filter' : 'No operational events recorded yet'}</div>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-text-2">{items.length ? 'Change the source filter or search phrase. The underlying event records remain unchanged.' : 'Custody handoffs, lock events, trip transitions and alerts will appear here as the operational workflows record them.'}</p>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[.07] px-4 py-3 text-[10px] text-text-2">
          <span>Showing the latest {items.length.toLocaleString()} source records returned by CDS.</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} aria-hidden="true" /> Chain integrity is verified in each container history</span>
        </footer>
      </section>
    </div>
  );
}

export function ReportsView() {
  const [selected, setSelected] = useState('daily');
  const { addToast } = useCDSStore();
  const { data: reportData, isLoading } = useReports();
  const generateReport = useGenerateReport();
  const types = [
    { id: 'daily', label: 'Daily Report', desc: 'PDF summary', format: 'pdf' as const },
    { id: 'weekly', label: 'Weekly Report', desc: 'Excel export', format: 'excel' as const },
    { id: 'monthly', label: 'Monthly Report', desc: 'Full analytics', format: 'pdf' as const },
    { id: 'custom', label: 'Custom Report', desc: 'Date range export', format: 'csv' as const },
  ];
  const reports = reportData?.data ?? [];

  const handleGenerate = (format: 'pdf' | 'excel' | 'csv') => {
    const t = types.find(x => x.id === selected);
    generateReport.mutate(
      { name: t?.label ?? 'Report', type: selected as 'daily' | 'weekly' | 'monthly' | 'custom', format, parameters: {} },
      { onSuccess: () => addToast('Report generating…'), onError: () => addToast('Failed to generate report', 'error') },
    );
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {types.map(t => (
          <Card key={t.id} className={`p-4 cursor-pointer transition-colors ${selected === t.id ? 'border-cds-orange/50' : ''}`} onClick={() => setSelected(t.id)}>
            <div className="font-bold text-sm text-text-0">{t.label}</div>
            <div className="text-[11px] text-text-2 mt-1">{t.desc}</div>
          </Card>
        ))}
      </div>
      <div className="flex gap-2 mb-5">
        <Button onClick={() => handleGenerate('pdf')} disabled={generateReport.isPending}>Generate PDF</Button>
        <Button variant="ghost" onClick={() => handleGenerate('excel')} disabled={generateReport.isPending}>Excel export</Button>
        <Button variant="ghost" onClick={() => handleGenerate('csv')} disabled={generateReport.isPending}>CSV export</Button>
      </div>
      <Card className="p-4">
        <div className="font-bold text-sm text-text-0 mb-3">Generated Reports</div>
        {isLoading && <div className="text-xs text-text-2 font-mono py-4 text-center">Loading reports…</div>}
        {reports.map(r => (
          <div key={r.id} className="flex items-center gap-3 py-3 border-b border-[rgba(255,255,255,.04)] last:border-0">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-white/[.07] bg-white/[.025] text-text-2">
              {r.format === 'excel'
                ? <FileBarChart size={15} strokeWidth={1.8} aria-hidden="true" />
                : <FileText size={15} strokeWidth={1.8} aria-hidden="true" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-0">{r.name}</div>
              <div className="text-[10px] text-text-2 font-mono mt-0.5">
                {r.format.toUpperCase()} · {r.generatedAt ? new Date(r.generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </div>
            </div>
            <StatusBadge status={r.status} />
            {r.status === 'ready' && r.downloadUrl && (
              <Button size="sm" variant="ghost" onClick={() => window.open(r.downloadUrl!, '_blank')}>Download</Button>
            )}
          </div>
        ))}
        {!isLoading && reports.length === 0 && (
          <div className="text-xs text-text-2 font-mono py-6 text-center">No reports generated yet. Select a type and click Generate.</div>
        )}
      </Card>
    </div>
  );
}

export { AnalyticsView } from './CDSPerformanceAnalysis.js';

export function SettingsView() {
  const [tab, setTab] = useState('profile');
  const tabs = ['profile', 'field access'];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="flex gap-4" style={{ minHeight: 400 }}>
        <div className="w-[180px] flex-none space-y-1">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors capitalize ${tab === t ? 'bg-[rgba(255,255,255,.06)] text-cds-orange' : 'bg-transparent text-text-2 hover:text-text-1'}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'field access' ? (
          <FieldAccessPanel />
        ) : (
          <ProfilePanel />
        )}
      </div>
    </div>
  );
}

function ProfilePanel() {
  const user = useAuthStore(s => s.user);
  if (!user) return null;
  const rows = [
    { label: 'Full name', value: user.name ?? '—' },
    { label: 'Email', value: user.email ?? '—' },
    { label: 'Role', value: (user.role ?? '—').toUpperCase().replace('_', ' ') },
    { label: 'Organisation ID', value: user.org_id ?? '—' },
  ];
  return (
    <Card className="flex-1 p-5">
      <div className="space-y-0">
        {rows.map((row, i) => (
          <div key={row.label} className={`flex items-center justify-between py-3.5 ${i < rows.length - 1 ? 'border-b border-[rgba(255,255,255,.05)]' : ''}`}>
            <div className="text-xs text-text-0">{row.label}</div>
            <span className="text-xs font-mono text-text-1">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
