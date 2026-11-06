import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowUpRight, BookOpen, Database, ExternalLink, Filter, Link2, Radio, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api.js';

type Row = Record<string, any>;
type RunState = { label: string; tone: 'healthy' | 'warning' | 'danger' | 'neutral'; explanation: string };
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }) + ' EAT';
};
const metadata = (source: Row): Row => {
  if (source?.metadata && typeof source.metadata === 'object') return source.metadata;
  if (typeof source?.metadata === 'string') {
    try { return JSON.parse(source.metadata); } catch { return {}; }
  }
  return {};
};
const safeSourceUrl = (value: unknown): string | null => {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const isDiscovery = (source: Row) => {
  const meta = metadata(source);
  return String(meta.role || '').toLowerCase() === 'discovery'
    || String(meta.collection_mode || '').toLowerCase() === 'link_out'
    || meta.observation_ingestion === false;
};
const runState = (source: Row, run?: Row): RunState => {
  const meta = metadata(source);
  if (isDiscovery(source)) return { label: 'DISCOVERY / LINK-OUT', tone: 'neutral', explanation: 'Registered for discovery and navigation only. It is not ingested as an observation feed.' };
  if (meta.authorized_only === true && meta.configured !== true) return { label: 'AUTHORISED FEED PENDING', tone: 'warning', explanation: 'The authorized ingestion bridge is registered but is not configured. No private group scraping is attempted.' };
  if (source.active === false) return { label: 'INACTIVE', tone: 'neutral', explanation: 'The source is disabled in the source registry.' };
  const record = run?.health || null;
  if (!record) return { label: 'NO VERIFIED RUN', tone: 'neutral', explanation: 'The registry returned no provider run record. Collection health is unknown.' };
  const state = String(record.status || '').toLowerCase();
  const errorCount = Number(record.error_count || 0);
  if (['running', 'queued', 'pending', 'started', 'in_progress', 'in-progress'].includes(state)) return { label: 'RUN IN PROGRESS', tone: 'neutral', explanation: 'The latest provider run has not completed.' };
  if (['failed', 'failure', 'error', 'unavailable', 'partial', 'degraded'].includes(state) || errorCount > 0) return { label: 'LATEST RUN FAILED', tone: 'danger', explanation: record.error_message || 'The provider run returned an error. Older observations remain available but do not prove current collection health.' };
  if (['success', 'succeeded', 'complete', 'completed', 'ok'].includes(state)) {
    const finished = Date.parse(record.finished_at || record.started_at || '');
    if (!Number.isFinite(finished)) return { label: 'SUCCESS · TIME UNKNOWN', tone: 'warning', explanation: 'The provider reported success but no usable completion timestamp was returned.' };
    if (Date.now() - finished > 24 * 60 * 60 * 1000) return { label: 'STALE SUCCESS', tone: 'warning', explanation: 'The latest successful run is older than 24 hours.' };
    return { label: 'RECENT RUN SUCCEEDED', tone: 'healthy', explanation: 'A recent run completed without a recorded provider error. This does not establish source completeness.' };
  }
  return { label: 'HEALTH UNKNOWN', tone: 'neutral', explanation: 'The provider returned an unrecognised run state. No healthy status is inferred.' };
};

function SourceCard({ source, run, onOpen }: { source: Row; run?: Row; onOpen: (source: Row) => void }) {
  const meta = metadata(source);
  const state = runState(source, run);
  const observations = run?.metrics?.observations_24h ?? run?.observations_24h ?? null;
  const latest = run?.metrics?.latest_observation || source.latest_observation || source.latest_observation_at || null;
  return <button type="button" className="ics-source-card" onClick={() => onOpen(source)}>
    <div className="ics-source-card-top"><span className="ics-source-type">{String(source.source_type || 'SOURCE').replaceAll('_', ' ').toUpperCase()}</span><span className={'ics-state-pill ' + state.tone}>{state.label}</span></div>
    <h3>{source.name || 'Unnamed source'}</h3>
    <p>{source.provider || 'Provider not identified'}{meta.country_hint ? ' · ' + String(meta.country_hint).toUpperCase() + ' hint' : ''}</p>
    <div className="ics-source-details"><span><small>OBS. 24H</small><b>{observations == null ? '—' : observations}</b></span><span><small>LAST OBSERVED</small><b>{age(latest)}</b></span><span><small>CATALOG RELIABILITY</small><b>{source.reliability == null ? '—' : source.reliability + '/100'}</b></span></div>
    <footer><span>{meta.collection_mode ? String(meta.collection_mode).replaceAll('_', ' ').toUpperCase() : (meta.observation_ingestion === false ? 'LINK OUT ONLY' : 'COLLECTION MODE NOT SET')}</span><ArrowUpRight size={15}/></footer>
  </button>;
}

export default function IntelligenceSourceCommand() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [selected, setSelected] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sourcesQ = useQuery({
    queryKey: ['intel-source-registry'],
    queryFn: async () => (await api.get('/risk/intelligence/sources')).data,
    staleTime: 30000, refetchInterval: 60000, retry: 1,
  });
  const collectionQ = useQuery({
    queryKey: ['intel-source-collection-health'],
    queryFn: async () => (await api.get('/risk/intelligence/collection/status')).data,
    staleTime: 30000, refetchInterval: 60000, retry: 1,
  });
  const qualityQ = useQuery({
    queryKey: ['intel-source-quality'],
    queryFn: async () => (await api.get('/risk/intelligence/quality')).data,
    staleTime: 30000, refetchInterval: 60000, retry: 1,
  });
  const manualRun = useMutation({
    mutationFn: async () => (await api.post('/risk/intelligence/collection/run')).data,
    onSuccess: async response => {
      const collection = response?.collection;
      if (collection?.skipped) {
        setNotice('Manual collection was skipped because another cluster-wide run is already in progress. Check provider run states after that run completes.');
      } else if (collection?.error) {
        setNotice('The collection runner returned an error: ' + String(collection.error));
      } else {
        const outcomes = (Array.isArray(collection?.results) ? collection.results : []).flatMap((org: Row) => Array.isArray(org.collection?.results) ? org.collection.results : []);
        const failed = outcomes.filter((item: Row) => item.status === 'failed').length;
        const succeeded = outcomes.filter((item: Row) => item.status === 'success').length;
        setNotice('Manual collection returned ' + outcomes.length + ' provider outcomes: ' + succeeded + ' succeeded, ' + failed + ' failed. Review provider run timestamps; an HTTP response alone is not a fabric-health claim.');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['intel-source-registry'] }),
        queryClient.invalidateQueries({ queryKey: ['intel-source-collection-health'] }),
        queryClient.invalidateQueries({ queryKey: ['intel-command-collection'] }),
      ]);
    },
    onError: (error: any) => setNotice(error?.response?.data?.message || 'Collection request failed. Existing source records were not changed.'),
  });

  const sources = list(sourcesQ.data, 'sources');
  const runRows = list(collectionQ.data?.collection, 'sources');
  const runsById = useMemo(() => new Map(runRows.map(run => [String(run.id || run.source_id), run])), [runRows]);
  const rows = useMemo(() => sources.map(source => {
    const run = runsById.get(String(source.id));
    return { source, run, state: runState(source, run) };
  }), [sources, runsById]);
  const families = useMemo(() => [...new Set(sources.map(source => String(source.source_type || 'unknown')))].sort(), [sources]);
  const filtered = rows.filter(({ source, state }) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [source.name, source.provider, source.source_type, source.endpoint, metadata(source).country_hint].some(value => String(value || '').toLowerCase().includes(needle));
    const matchesFamily = family === 'all' || String(source.source_type || 'unknown') === family;
    const matchesState = stateFilter === 'all' || (stateFilter === 'issue' ? ['danger', 'warning'].includes(state.tone) : state.tone === stateFilter);
    return matchesSearch && matchesFamily && matchesState;
  });
  const quality = qualityQ.data?.quality || {};
  const failedCount = rows.filter(row => row.state.tone === 'danger').length;
  const warningCount = rows.filter(row => row.state.tone === 'warning').length;
  const discoveryCount = rows.filter(row => isDiscovery(row.source)).length;
  const observations24h = runRows.reduce((sum, run) => sum + (Number(run.metrics?.observations_24h ?? run.observations_24h) || 0), 0);
  const selectedRun = selected ? runsById.get(String(selected.id)) : undefined;
  const selectedState = selected ? runState(selected, selectedRun) : null;
  const selectedMeta = selected ? metadata(selected) : {};

  const refresh = () => {
    void sourcesQ.refetch(); void collectionQ.refetch(); void qualityQ.refetch();
  };

  return <div className="ics-root">
    <header className="ics-heading">
      <div><div className="ics-eyebrow">SONALIT / INTELLIGENCE / COLLECTION MANAGEMENT</div><h1>Source & collection control</h1><p>Registered provenance, authorized bridges, provider run history and evidence quality.</p></div>
      <button type="button" className="ics-run-button" onClick={() => { setNotice(null); manualRun.mutate(); }} disabled={manualRun.isPending}><Radio size={14}/>{manualRun.isPending ? 'REQUESTING…' : 'RUN COLLECTION'}</button>
    </header>
    {notice && <div className="ics-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15}/></button></div>}
    {(sourcesQ.isError || collectionQ.isError || qualityQ.isError) && <div className="ics-service-error" role="alert"><strong>COLLECTION REGISTER PARTIALLY UNAVAILABLE</strong><span>{[sourcesQ.isError ? 'source registry' : '', collectionQ.isError ? 'provider run history' : '', qualityQ.isError ? 'quality metrics' : ''].filter(Boolean).join(', ')} could not be read. Missing data is not counted as zero or healthy.</span><button type="button" onClick={refresh}>Retry reads</button></div>}

    <section className="ics-metrics">
      <div><span>REGISTERED SOURCES</span><strong>{sourcesQ.isError ? '—' : sources.length}</strong><small>Returned by tenant-scoped registry · API limit 300</small></div>
      <div><span>OBSERVATIONS · 24H</span><strong>{collectionQ.isError ? '—' : observations24h}</strong><small>Provider metrics where reported</small></div>
      <div><span>DISCOVERY / LINK-OUT</span><strong>{sourcesQ.isError ? '—' : discoveryCount}</strong><small>Not counted as observation ingestion</small></div>
      <div><span>RUNS WITH ERRORS</span><strong>{collectionQ.isError ? '—' : failedCount}</strong><small>Provider-specific latest run state</small></div>
      <div><span>NEEDS ATTENTION</span><strong>{sourcesQ.isError || collectionQ.isError ? '—' : warningCount}</strong><small>Pending, stale or unverified</small></div>
    </section>

    <section className="ics-quality-strip">
      <div><span>MEAN OBSERVATION CREDIBILITY</span><b>{quality.avg_credibility == null ? '—' : quality.avg_credibility + '/100'}</b></div>
      <div><span>MEAN MANIPULATION SCORE</span><b>{quality.avg_manipulation == null ? '—' : quality.avg_manipulation + '/100'}</b></div>
      <div><span>MANIPULATION FLAGS · 30D</span><b>{quality.manipulation_flags == null ? '—' : quality.manipulation_flags}</b></div>
      <div><span>OPEN INTELLIGENCE GAPS</span><b>{quality.open_gaps == null ? '—' : quality.open_gaps}</b></div>
      <p>These are persisted observation and gap metrics—not a certification that all sources are reliable or complete.</p>
    </section>

    <div className="ics-register-tools">
      <label className="ics-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search source, provider or country hint"/></label>
      <label><Filter size={13}/><select value={family} onChange={event => setFamily(event.target.value)}><option value="all">All source families</option>{families.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <label><Activity size={13}/><select value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option value="all">All run states</option><option value="healthy">Recent success</option><option value="warning">Needs attention</option><option value="danger">Failed</option><option value="neutral">Unknown / discovery</option><option value="issue">All issues</option></select></label>
      <button type="button" className="ics-refresh" onClick={refresh}><RefreshCw size={14}/> Refresh</button>
    </div>

    {sourcesQ.isPending ? <div className="ics-empty">Loading the tenant-scoped source registry…</div> :
     sourcesQ.isError ? <div className="ics-empty error">Source registry unavailable. No source-health conclusions can be made.</div> :
     filtered.length ? <div className="ics-grid">{filtered.map(({ source, run }) => <SourceCard key={source.id} source={source} run={run} onOpen={setSelected}/>)}</div> :
     <div className="ics-empty">No sources match these filters. The register is not being supplemented with sample records.</div>}

    <footer className="ics-footnote"><BookOpen size={14}/> Provenance discipline: catalog reliability is a starting descriptor, not proof. Independent source diversity, original evidence, collection time, contradictions and analyst assessment remain separate.</footer>

    {selected && <div className="ics-drawer-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <aside className="ics-drawer" role="dialog" aria-modal="true" aria-label="Source record detail">
        <header><div><span>SOURCE REGISTER / PROVENANCE</span><h2>{selected.name || 'Unnamed source'}</h2><p>{selected.provider || 'Provider not identified'} · {String(selected.source_type || 'source').replaceAll('_', ' ')}</p></div><button type="button" aria-label="Close source details" onClick={() => setSelected(null)}><X size={17}/></button></header>
        <div className={'ics-state-banner ' + (selectedState?.tone || 'neutral')}><b>{selectedState?.label}</b><span>{selectedState?.explanation}</span></div>
        <div className="ics-detail-grid">
          <div><small>ACTIVE</small><b>{selected.active === false ? 'No' : selected.active === true ? 'Yes' : 'Unknown'}</b></div>
          <div><small>OBSERVATIONS · TOTAL</small><b>{selected.observation_count == null ? '—' : selected.observation_count}</b></div>
          <div><small>LAST OBSERVED</small><b>{time(selected.latest_observation || selectedRun?.metrics?.latest_observation)}</b></div>
          <div><small>LAST RUN FINISHED</small><b>{time(selectedRun?.health?.finished_at)}</b></div>
          <div><small>RUN STATUS</small><b>{selectedRun?.health?.status || 'No run record'}</b></div>
          <div><small>RUN ERROR COUNT</small><b>{selectedRun?.health?.error_count == null ? '—' : selectedRun.health.error_count}</b></div>
          <div><small>COUNTRY HINT</small><b>{selectedMeta.country_hint || 'Not assigned'}</b></div>
          <div><small>COUNTRY HINT AUTHORITY</small><b>{selectedMeta.country_hint_authoritative === true ? 'Authoritative by configuration' : 'Not authoritative'}</b></div>
        </div>
        {selectedMeta.role === 'discovery' && <div className="ics-policy-note"><Link2 size={15}/><span><b>DISCOVERY ONLY</b> This source is a link-out discovery lane. The aggregator is not treated as a direct observation or evidence source.</span></div>}
        {selectedMeta.authorized_only === true && <div className="ics-policy-note"><ShieldCheck size={15}/><span><b>AUTHORIZED INGESTION ONLY</b> This bridge may ingest only from the approved feed endpoint. Private groups are not scraped.</span></div>}
        
        {selectedRun?.health?.error_message && <div className="ics-run-error"><small>LATEST PROVIDER ERROR</small><p>{selectedRun.health.error_message}</p></div>}
        {safeSourceUrl(selected.endpoint) && selectedMeta.authorized_only !== true && <a className="ics-source-link" href={safeSourceUrl(selected.endpoint) || undefined} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Open source endpoint</a>}
        {selectedMeta.configuration_required === true && <div className="ics-detail-field"><small>CONFIGURATION REQUIREMENT</small><b>Required provider configuration is managed outside this view. Secrets are never displayed.</b></div>}
        <footer>Source registry fields and per-provider run telemetry are tenant-scoped. No credentials are displayed in this view.</footer>
      </aside>
    </div>}
  </div>;
}
