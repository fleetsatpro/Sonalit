import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Clock3, ExternalLink, Globe2, MapPin, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import MapLibreMap, { Marker, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';
import { safeExternalUrl } from '../lib/intelligenceText.js';
import { DARK_STREET_STYLE, STREET_STYLE } from '../lib/mapStyles.js';

type Row = Record<string, any>;
type ScopeType = 'global' | 'continent' | 'region' | 'country';
type Scope = { type: ScopeType; key: string; label: string };

const REGIONS: Record<string, string[]> = {
  'east-africa': ['BI', 'DJ', 'ER', 'ET', 'KE', 'KM', 'MG', 'MU', 'MW', 'MZ', 'RW', 'SC', 'SO', 'SS', 'TZ', 'UG', 'ZM', 'ZW'],
  'west-africa': ['BJ', 'BF', 'CV', 'CI', 'GM', 'GH', 'GN', 'GW', 'LR', 'ML', 'MR', 'NE', 'NG', 'SH', 'SL', 'SN', 'TG'],
  'central-africa': ['AO', 'CF', 'CG', 'CD', 'CM', 'GA', 'GQ', 'ST', 'TD'],
  'north-africa': ['DZ', 'EG', 'LY', 'MA', 'SD', 'TN'],
  'southern-africa': ['BW', 'LS', 'NA', 'SZ', 'ZA'],
};
const COUNTRY_DISPLAY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => COUNTRY_NAMES[code] || COUNTRY_DISPLAY_NAMES.of(code) || 'Country';
const COUNTRY_NAMES: Record<string, string> = {
  BI: 'Burundi', CD: 'DR Congo', DJ: 'Djibouti', ER: 'Eritrea', ET: 'Ethiopia',
  KE: 'Kenya', MG: 'Madagascar', MW: 'Malawi', MZ: 'Mozambique', RW: 'Rwanda',
  SD: 'Sudan', SO: 'Somalia', SS: 'South Sudan', TZ: 'Tanzania', UG: 'Uganda',
  ZM: 'Zambia', ZW: 'Zimbabwe',
};
const WINDOWS = [1, 6, 24, 72, 168];
const REGION_CENTRES: Record<string, { longitude: number; latitude: number; zoom: number }> = {
  'east-africa': { longitude: 37, latitude: -2, zoom: 3.45 },
  'west-africa': { longitude: -3, latitude: 9, zoom: 3.35 },
  'central-africa': { longitude: 19, latitude: 0, zoom: 3.25 },
  'north-africa': { longitude: 17, latitude: 27, zoom: 3.2 },
  'southern-africa': { longitude: 24, latitude: -24, zoom: 3.3 },
};
const COUNTRY_CENTRES: Record<string, { longitude: number; latitude: number; zoom: number }> = {
  BI: { longitude: 29.9, latitude: -3.3, zoom: 6 },
  CD: { longitude: 23.7, latitude: -2.5, zoom: 4.3 },
  DJ: { longitude: 42.6, latitude: 11.8, zoom: 6 },
  ER: { longitude: 39.5, latitude: 15.2, zoom: 5.2 },
  ET: { longitude: 40.5, latitude: 9.1, zoom: 4.5 },
  KE: { longitude: 37.9, latitude: 0.2, zoom: 5 },
  MG: { longitude: 46.5, latitude: -19, zoom: 4.8 },
  MW: { longitude: 34.3, latitude: -13.5, zoom: 5.5 },
  MZ: { longitude: 35.5, latitude: -18.2, zoom: 4.6 },
  RW: { longitude: 29.9, latitude: -1.9, zoom: 6 },
  SD: { longitude: 30.2, latitude: 15.5, zoom: 4.5 },
  SO: { longitude: 46, latitude: 5, zoom: 4.6 },
  SS: { longitude: 31.3, latitude: 7.3, zoom: 5 },
  TZ: { longitude: 34.8, latitude: -6.3, zoom: 4.6 },
  UG: { longitude: 32.3, latitude: 1.4, zoom: 5.3 },
  ZM: { longitude: 27.8, latitude: -13.2, zoom: 4.6 },
  ZW: { longitude: 29.9, latitude: -19, zoom: 5 },
};
const REGION_BY_COUNTRY = new Map(Object.entries(REGIONS).flatMap(([region, countries]) => countries.map(code => [code, region] as const)));
const list = (value: any, key: string): Row[] => Array.isArray(value?.[key]) ? value[key] : [];
const age = (value?: string | null) => {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return String(minutes) + 'm';
  if (minutes < 1440) return String(Math.floor(minutes / 60)) + 'h';
  return String(Math.floor(minutes / 1440)) + 'd';
};
const time = (value?: string | null) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }) + ' EAT';
};
const severity = (value: unknown) => {
  const raw = String(value || '').toLowerCase();
  return ['critical', 'high', 'moderate', 'low', 'informational'].includes(raw) ? raw : 'unclassified';
};
const confidence = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '—';
};
const validCoordinate = (value: unknown, min = -180, max = 180) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

function Metric({ label, value, note, tone = 'normal' }: { label: string; value: number | string; note: string; tone?: string }) {
  return <article className={'icv-metric icv-metric-' + tone}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function EventRow({ event, onOpen }: { event: Row; onOpen: (row: Row) => void }) {
  return <button type="button" className="icv-event-row" onClick={() => onOpen(event)}>
    <span className={'icv-severity-dot icv-severity-' + severity(event.severity)} />
    <span className="icv-event-copy">
      <strong>{event.title || 'Untitled intelligence event'}</strong>
      <small>{event.country_code || 'Geography unresolved'} · {event.category || event.event_type || 'Event type not classified'}</small>
    </span>
    <span className="icv-event-meta">
      <b>{String(severity(event.severity)).toUpperCase()}</b>
      <small>{event.source_count == null ? 'SOURCE COUNT —' : String(event.source_count) + ' OBS.'}</small>
      <small>{age(event.last_seen_at)}</small>
    </span>
    <ArrowUpRight size={15} />
  </button>;
}

function WarningRow({ item, onOpen }: { item: Row; onOpen: (row: Row) => void }) {
  return <button type="button" className={'icv-warning-row icv-severity-' + severity(item.severity)} onClick={() => onOpen(item)}>
    <span className={'icv-warning-bar icv-severity-' + severity(item.severity)} />
    <span><strong>{item.headline || item.title || 'Untitled warning'}</strong><small>{item.country_code || item.scope_key || 'Scope unresolved'} · {age(item.last_detected_at)}</small></span>
    <b>{String(severity(item.severity)).toUpperCase()}</b>
  </button>;
}

export default function IntelligenceCommandView() {
  const [scope, setScope] = useState<Scope>({ type: 'global', key: 'global', label: 'GLOBAL' });
  const [windowHours, setWindowHours] = useState(24);
  const [basemap, setBasemap] = useState<'dark' | 'street'>('dark');
  const [selectedEvent, setSelectedEvent] = useState<Row | null>(null);
  const [selectedWarning, setSelectedWarning] = useState<Row | null>(null);
  const scopeParams = useMemo(() => scope.type === 'global'
    ? { scope_type: 'global', scope_key: 'global' }
    : { scope_type: scope.type, scope_key: scope.key, ...(scope.type === 'country' ? { country_code: scope.key } : {}) },
  [scope.type, scope.key]);

  const overviewQ = useQuery({
    queryKey: ['intel-command-overview', scopeParams, windowHours],
    queryFn: async () => (await api.get('/risk/intelligence/overview', { params: { ...scopeParams, window_hours: windowHours } })).data,
    staleTime: 15000, refetchInterval: 30000, retry: 1,
  });
  const warningsQ = useQuery({
    queryKey: ['intel-command-warnings', scopeParams],
    queryFn: async () => (await api.get('/risk/intelligence/early-warnings', { params: scopeParams })).data,
    staleTime: 20000, refetchInterval: 30000, retry: 1,
  });
  const countriesQ = useQuery({
    queryKey: ['intel-command-countries'],
    queryFn: async () => (await api.get('/risk/intelligence/countries')).data,
    staleTime: 30000, refetchInterval: 60000, retry: 1,
  });
  const eventDetailQ = useQuery({
    queryKey: ['intel-command-event', selectedEvent?.id, scopeParams],
    enabled: Boolean(selectedEvent?.id),
    queryFn: async () => (await api.get('/risk/intelligence/events/' + encodeURIComponent(String(selectedEvent!.id)), { params: scopeParams })).data?.event,
    staleTime: 30000, retry: 1,
  });
  const warningActionsQ = useQuery({
    queryKey: ['intel-command-warning-actions', selectedWarning?.id],
    enabled: Boolean(selectedWarning?.id),
    queryFn: async () => (await api.get('/risk/intelligence/early-warnings/' + encodeURIComponent(String(selectedWarning!.id)) + '/actions')).data,
    staleTime: 30000, retry: 1,
  });

  const overview = overviewQ.data?.summary || null;
  const events = list(overviewQ.data, 'events');
  const warnings = list(warningsQ.data, 'warnings');
  const countries = list(countriesQ.data, 'countries');
  const located = events.filter(event => validCoordinate(event.latitude, -90, 90) && validCoordinate(event.longitude, -180, 180));
  const regionFallback = scope.type === 'region'
    ? REGION_CENTRES[scope.key]
    : scope.type === 'country'
      ? REGION_CENTRES[REGION_BY_COUNTRY.get(scope.key) || 'east-africa']
      : { longitude: 20, latitude: 1, zoom: 3.1 };
  const centre = located[0]
    ? { longitude: Number(located[0].longitude), latitude: Number(located[0].latitude), zoom: 5 }
    : scope.type === 'country'
      ? COUNTRY_CENTRES[scope.key] || regionFallback
      : regionFallback;
  const mapRef = useRef<any>(null);
  const hasAutoCentred = useRef(false);

  useEffect(() => {
    hasAutoCentred.current = false;
  }, [scope.type, scope.key]);

  useEffect(() => {
    if (!overviewQ.isSuccess || !located.length || hasAutoCentred.current) return;
    const first = located[0];
    mapRef.current?.flyTo({
      center: [Number(first.longitude), Number(first.latitude)],
      zoom: scope.type === 'country' ? Math.max(centre.zoom, 5) : Math.max(centre.zoom, 4),
      duration: 650,
    });
    hasAutoCentred.current = true;
  }, [overviewQ.isSuccess, scope.type, scope.key, located.length, events.length, centre.zoom]);
  const visibleCountries = countries.filter(row => {
    const code = String(row.country_code || '').toUpperCase();
    if (scope.type === 'country') return code === scope.key;
    if (scope.type === 'region') return (REGIONS[scope.key] || []).includes(code);
    if (scope.type === 'continent') return Object.values(REGIONS).flat().includes(code);
    return true;
  }).slice(0, 8);
  const maxCountryEvents = Math.max(1, ...visibleCountries.map(row => Number(row.events_24h) || 0));
  const summaryUnavailable = overviewQ.isError || !overview;
  const selected = selectedWarning || eventDetailQ.data || selectedEvent;

  const refresh = () => {
    void overviewQ.refetch(); void warningsQ.refetch(); void countriesQ.refetch();
  };
  const chooseCountry = (code: string) => setScope({ type: 'country', key: code, label: code });
  const clearScope = () => setScope({ type: 'global', key: 'global', label: 'GLOBAL' });

  return <div className="icv-root">
    <header className="icv-heading">
      <div className="icv-title-block">
        <div className="icv-eyebrow">SONALIT / INTELLIGENCE / COMMAND</div>
        <h1>Operating picture</h1>
        <p>Security events, persisted warnings and geographic context across the selected theatre.</p>
      </div>
      <div className="icv-heading-actions">
        <span className="icv-access-tag"><ShieldCheck size={13}/> RESTRICTED · ADMIN</span>
        <button type="button" className="icv-refresh" onClick={refresh}><RefreshCw size={14}/> Refresh snapshot</button>
      </div>
    </header>

    <section className="icv-controls" aria-label="Operating picture filters">
      <div className="icv-control-group"><span>THEATRE</span>
        <select aria-label="Intelligence theatre" value={scope.type === 'global' ? 'global' : scope.type + ':' + scope.key} onChange={event => {
          const value = event.target.value;
          if (value === 'global') return clearScope();
          if (value.startsWith('country:')) return chooseCountry(value.slice(8));
          const [type, key] = value.split(':') as ['continent' | 'region', string];
          setScope({ type, key, label: key.replaceAll('-', ' ').toUpperCase() });
        }}>
          <option value="global">Global</option><option value="continent:africa">Africa</option>
          {Object.keys(REGIONS).map(region => <option key={region} value={'region:' + region}>{region.replaceAll('-', ' ')}</option>)}
          {Object.keys(COUNTRY_NAMES).sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b])).map(code => <option key={code} value={'country:' + code}>{COUNTRY_NAMES[code]}</option>)}
        </select>
        {scope.type !== 'global' && <button type="button" className="icv-clear-scope" onClick={clearScope}>Clear</button>}
      </div>
      <div className="icv-control-group"><span>ANALYTIC WINDOW</span>
        <select aria-label="Analytic time window" value={windowHours} onChange={event => setWindowHours(Number(event.target.value))}>
          {WINDOWS.map(hours => <option key={hours} value={hours}>{hours < 24 ? String(hours) + ' hour' + (hours > 1 ? 's' : '') : hours === 24 ? '24 hours' : String(hours / 24) + ' days'}</option>)}
        </select>
      </div>
      <div className="icv-window-note"><Clock3 size={13}/> Exact server window · {windowHours}h · API snapshot {time(overviewQ.data?.generated_at)}</div>
    </section>
    <section className="icv-metrics" aria-label="Time-window metrics">
      <Metric label={'EVENTS · ' + windowHours + 'H'} value={summaryUnavailable ? '—' : overview.events_in_window ?? '—'} note="Distinct event objects · selected window" tone="aqua"/>
      <Metric label="HIGH / CRITICAL" value={summaryUnavailable ? '—' : overview.priority_events_in_window ?? '—'} note="Persisted event severity · not keyword cues" tone="amber"/>
      <Metric label={'OBSERVATIONS · ' + windowHours + 'H'} value={summaryUnavailable ? '—' : overview.observations_in_window ?? '—'} note="Persisted source observations" />
      <Metric label="ACTIVE WARNINGS" value={summaryUnavailable ? '—' : overview.active_warnings ?? '—'} note="Open · review · acknowledged" tone="red"/>
      <Metric label="OPEN GAPS" value={summaryUnavailable ? '—' : overview.open_gaps ?? '—'} note="Collection and analytic requirements"/>
    </section>

    <div className="icv-main-grid">
      <section className="icv-panel icv-map-panel">
        <header className="icv-panel-head"><div><span>01 / SPATIAL CONTEXT</span><h2>Geographic event picture</h2><p>Only event records with stored coordinates are plotted.</p></div><div className="icv-map-tools"><div className="icv-map-legend"><span><i className="critical"/> Critical</span><span><i className="high"/> High</span><span><i className="other"/> Other / unclassified</span></div><div className="icv-basemap-toggle" role="group" aria-label="Map basemap"><button type="button" className={basemap === 'dark' ? 'active' : ''} aria-pressed={basemap === 'dark'} onClick={() => setBasemap('dark')}>DARK</button><button type="button" className={basemap === 'street' ? 'active' : ''} aria-pressed={basemap === 'street'} onClick={() => setBasemap('street')}>STREET</button></div></div></header>
        <div className="icv-map-canvas">
          <MapLibreMap ref={mapRef} key={scope.type + ':' + scope.key} initialViewState={centre} mapStyle={basemap === 'dark' ? DARK_STREET_STYLE : STREET_STYLE} style={{ width: '100%', height: '100%' }} attributionControl>
            <NavigationControl position="top-right" showCompass={false}/>
            {located.slice(0, 250).map((event, index) => <Marker key={event.id || index} longitude={Number(event.longitude)} latitude={Number(event.latitude)} anchor="center" onClick={click => { click.originalEvent.stopPropagation(); setSelectedEvent(event); setSelectedWarning(null); }}>
              <button type="button" className={'icv-map-marker icv-severity-' + severity(event.severity)} title={event.title || 'Intelligence event'} aria-label={'Open ' + (event.title || 'intelligence event')}><i/></button>
            </Marker>)}
          </MapLibreMap>
          <div className="icv-map-readout"><span>GEOLOCATED EVENT OBJECTS</span><strong>{summaryUnavailable ? '—' : located.length}</strong><small>{events.length} event records returned · {Math.max(0, events.length - located.length)} without coordinates</small></div>
        </div>
        <footer className="icv-map-footer"><span><MapPin size={12}/> Geographic placement reflects recorded coordinates only.</span><span>Basemap: {basemap === 'dark' ? 'OpenFreeMap · Dark' : 'Esri World Street Map'}</span></footer>
      </section>

      <aside className="icv-right-rail">
        <section className="icv-panel">
          <header className="icv-panel-head"><div><span>02 / EARLY WARNING</span><h2>Active warning board</h2><p>Persisted warning objects · not raw news leads.</p></div><b className="icv-panel-count">{warningsQ.isError ? '—' : warnings.length}</b></header>
          <div className="icv-warning-list">
            {warningsQ.isPending ? <div className="icv-panel-state">Checking the warning register…</div> :
             warningsQ.isError ? <div className="icv-panel-state error">Warning service unavailable. Current warning state is unknown.</div> :
             warnings.length ? warnings.slice(0, 6).map(item => <WarningRow key={item.id} item={item} onOpen={item => { setSelectedWarning(item); setSelectedEvent(null); }}/>) :
             <div className="icv-panel-state">No active warning objects were returned for this theatre. This is not proof of an incident-free environment.</div>}
          </div>
        </section>
        <section className="icv-panel icv-country-panel">
          <header className="icv-panel-head"><div><span>03 / COUNTRY WATCH</span><h2>Reported activity by country</h2><p>Server aggregate · 24-hour event window.</p></div><Globe2 size={17}/></header>
          <div className="icv-country-list">
            {countriesQ.isPending ? <div className="icv-panel-state">Loading country aggregates…</div> :
             countriesQ.isError ? <div className="icv-panel-state error">Country register unavailable. Coverage is unknown.</div> :
             visibleCountries.length ? visibleCountries.map(row => <button type="button" className="icv-country-row" key={row.country_code} onClick={() => chooseCountry(row.country_code)}>
               <span><b>{row.country_code}</b><small>{countryName(String(row.country_code || '').toUpperCase())}</small></span>
               <strong>{row.events_24h ?? '—'}</strong>
               <small>{row.confidence == null ? 'CONF —' : 'MEAN EVENT CONF. ' + row.confidence + '%'}</small>
               <span className="icv-country-activity" aria-label={String(row.events_24h ?? 0) + ' events in 24 hours'}><i style={{ width: Math.max(0, Math.min(100, (Number(row.events_24h) || 0) / maxCountryEvents * 100)) + '%' }} /></span>
             </button>) :
             <div className="icv-panel-state">No country-level event aggregates were returned for this theatre.</div>}
          </div>
        </section>
      </aside>
    </div>

    <div className="icv-lower-grid">
      <section className="icv-panel">
        <header className="icv-panel-head"><div><span>04 / EVENT LEDGER</span><h2>Latest event objects</h2><p>Maximum 50 latest records in the selected server-side window.</p></div><b className="icv-panel-count">{overviewQ.isError ? '—' : events.length}</b></header>
        <div className="icv-event-list">
          {overviewQ.isPending ? <div className="icv-panel-state">Retrieving the operating picture…</div> :
           overviewQ.isError ? <div className="icv-panel-state error">Operating picture request failed. Event state is unknown.</div> :
           events.length ? events.slice(0, 12).map(event => <EventRow key={event.id} event={event} onOpen={setSelectedEvent}/>) :
           <div className="icv-panel-state">No event records were returned for this time window. This is not confirmation that the theatre is incident-free.</div>}
        </div>
      </section>
      <section className="icv-panel icv-assurance-panel">
        <header className="icv-panel-head"><div><span>05 / ANALYTIC DISCIPLINE</span><h2>Evidence & confidence</h2><p>Separate source health from analytic judgement.</p></div><ShieldAlert size={17}/></header>
        <div className="icv-assurance-lines">
          <div><span>Latest event update</span><b>{time(overview?.latest_event_at)}</b></div>
          <div><span>Latest observation</span><b>{time(overview?.latest_observation_at)}</b></div>
          
          <div><span>Geolocated events in returned set</span><b>{summaryUnavailable ? '—' : located.length}</b></div>
        </div>
        <p className="icv-assurance-note">Event severity, event confidence, source reliability and collection freshness are independent fields. A recent successful collection run is not proof that all relevant incidents were collected.</p>
      </section>
    </div>

    {(selectedEvent || selectedWarning) && <div className="icv-drawer-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setSelectedEvent(null); setSelectedWarning(null); } }}>
      <aside className="icv-drawer" role="dialog" aria-modal="true" aria-label={selectedWarning ? 'Intelligence warning detail' : 'Intelligence event detail'}>
        <header><div><span>{selectedWarning ? 'EARLY WARNING / REVIEW TRACE' : 'EVENT OBJECT / EVIDENCE TRACE'}</span><h2>{selected?.title || selected?.headline || 'Intelligence record'}</h2></div><button type="button" aria-label="Close intelligence detail" onClick={() => { setSelectedEvent(null); setSelectedWarning(null); }}><X size={18}/></button></header>
        {(selectedWarning ? warningActionsQ.isPending : eventDetailQ.isPending) ? <div className="icv-panel-state">Loading the intelligence record…</div> :
         (selectedWarning ? warningActionsQ.isError : eventDetailQ.isError) ? <div className="icv-panel-state error">The detail request failed. The summary record is retained; evidence or action history is unavailable.</div> :
         <div className="icv-drawer-body">
          <div className="icv-drawer-tags"><span>{String(severity(selected?.severity || selectedEvent?.severity || selectedWarning?.severity)).toUpperCase()}</span><span>{selected?.country_code || selectedEvent?.country_code || selectedWarning?.country_code || 'GEOGRAPHY UNRESOLVED'}</span><span>{selected?.source_count == null ? (selectedWarning ? 'SOURCE COUNT —' : 'SOURCE COUNT —') : String(selected.source_count) + ' LINKED OBSERVATIONS'}</span></div>
          <p>{selected?.summary || selectedEvent?.summary || selectedWarning?.summary || 'No event summary supplied.'}</p>
          <div className="icv-drawer-fields"><div><small>FIRST OCCURRED</small><b>{time(selected?.occurred_from || selectedEvent?.occurred_from || selectedWarning?.occurred_from)}</b></div><div><small>LAST OBSERVED</small><b>{time(selected?.last_seen_at || selectedEvent?.last_seen_at || selectedWarning?.last_detected_at)}</b></div><div><small>EVENT CONFIDENCE</small><b>{confidence(selected?.confidence ?? selectedEvent?.confidence ?? selectedWarning?.confidence)}</b></div><div><small>COORDINATES</small><b>{validCoordinate(selected?.latitude ?? selectedEvent?.latitude ?? selectedWarning?.latitude, -90, 90) && validCoordinate(selected?.longitude ?? selectedEvent?.longitude ?? selectedWarning?.longitude, -180, 180) ? String(selected?.latitude ?? selectedEvent?.latitude ?? selectedWarning?.latitude) + ', ' + String(selected?.longitude ?? selectedEvent?.longitude ?? selectedWarning?.longitude) : 'Not resolved'}</b></div></div>
          {selectedWarning ? <>
            <h3>Warning state</h3>
            <div className="icv-assurance-note">A persisted early-warning object is not the raw observation and is not a verified incident by itself.</div>
            <div className="icv-drawer-fields"><div><small>STATUS</small><b>{selected?.status || selectedWarning.status || 'Not recorded'}</b></div><div><small>LAST DETECTED</small><b>{time(selected?.last_detected_at || selectedWarning.last_detected_at)}</b></div><div><small>CONFIDENCE VALUE</small><b>{confidence(selected?.confidence ?? selectedWarning.confidence)}</b></div><div><small>COUNTRY</small><b>{selected?.country_code || selectedWarning.country_code || 'Unresolved'}</b></div></div>
            <h3>Action history</h3>
            {Array.isArray(warningActionsQ.data?.actions) && warningActionsQ.data.actions.length ? warningActionsQ.data.actions.map((item: Row, index: number) => <article className="icv-evidence-row" key={item.id || index}><div><strong>{item.action || item.action_type || 'Warning action'}</strong><small>{item.actor_name || item.actor_id || 'Actor not returned'} · {time(item.created_at)}</small><p>{item.notes || item.reason || 'No action notes recorded.'}</p></div></article>) : <div className="icv-panel-state">No warning actions were returned.</div>}
          </> : <>
            <h3>Linked observations</h3>
            {Array.isArray(selected?.evidence) && selected.evidence.length ? selected.evidence.map((item: Row, index: number) => { const sourceUrl = safeExternalUrl(item.url); return <article className="icv-evidence-row" key={item.id || index}><div><strong>{item.title || 'Source observation'}</strong><small>{item.source?.name || item.source_name || 'Source not identified'} · {time(item.observed_at)}</small><p>{item.body || 'No source text is attached.'}</p></div>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" aria-label="Open original source"><ExternalLink size={15}/></a>}</article>; }) :
             <div className="icv-panel-state">No linked observations were returned for this event.</div>}
            {Array.isArray(selected?.related_events) && selected.related_events.length > 0 && <><h3>Related event objects</h3>{selected.related_events.map((item: Row, index: number) => <div className="icv-related-row" key={item.event_id || index}><b>{item.title || 'Related event'}</b><span>{item.relationship || 'Relationship not classified'} · {confidence(item.confidence)}</span></div>)}</>}
          </>}
        </div>}
        <footer><ShieldCheck size={13}/> Source observations and warning actions remain distinct from fused event judgement.</footer>
      </aside>
    </div>}
  </div>;
}
