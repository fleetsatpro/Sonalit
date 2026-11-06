import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Activity, Clock3, ShieldCheck } from 'lucide-react';
import { NavArtwork } from '../components/layout/Rail.js';
import '../styles/intelligence-centre-workspace.css';

const IntelligenceCommandView = lazy(() => import('./IntelligenceCommandView.js'));
const IntelligenceCentreDeep = lazy(() => import('./IntelligenceCentreDeep.tsx'));
const IntelligenceLiveNews = lazy(() => import('./IntelligenceLiveNews.jsx'));
const IntelligenceAlerts = lazy(() => import('./IntelligenceAlerts.tsx'));
const IntelligenceSourceCommand = lazy(() => import('./IntelligenceSourceCommand.js'));
const IntelligencePublicationDesk = lazy(() => import('./IntelligencePublicationDesk.tsx'));

const MODULES = [
  { id: 'command', label: 'COMMAND PICTURE', short: 'Operating picture', caption: 'Theatre posture · event geography · active warnings', art: 'nav-command', group: 'OPERATIONS' },
  { id: 'analysis', label: 'ANALYSIS WORKBENCH', short: 'Intel Hub', caption: 'Fusion · storylines · forecasts · entities · assessments', art: 'nav-analytics', group: 'OPERATIONS' },
  { id: 'alerts', label: 'INCIDENT FABRIC', short: 'Incident fabric', caption: 'Unverified public-signal detections · rolling 180 minutes', art: 'nav-beacon', group: 'COLLECTION' },
  { id: 'newsroom', label: 'NEWSROOM', short: 'Newsroom', caption: 'Persisted observations · provenance · source discovery', art: 'nav-dossier', group: 'COLLECTION' },
  { id: 'collection', label: 'COLLECTION CONTROL', short: 'Collection control', caption: 'Source registry · authorized bridges · provider runs', art: 'nav-satellite', group: 'COLLECTION' },
  { id: 'publications', label: 'PUBLICATIONS', short: 'Publication desk', caption: 'Daily · weekly · monthly country intelligence', art: 'nav-dossier', group: 'DISSEMINATION' },
] as const;

type ModuleId = typeof MODULES[number]['id'];

function readModule(search: string): ModuleId {
  const value = new URLSearchParams(search).get('module');
  if (value === 'core') return 'analysis';
  return MODULES.some(module => module.id === value) ? value as ModuleId : 'command';
}

function IntelligenceFallback({ label }: { label: string }) {
  return <div className="icw-loading" role="status"><Activity size={17}/><span>Opening {label.toLowerCase()}…</span></div>;
}

export default function IntelligenceCentre() {
  const navigate = useNavigate();
  const search = useRouterState({ select: state => state.location.searchStr });
  const module = useMemo(() => readModule(search), [search]);
  const active = MODULES.find(item => item.id === module) || MODULES[0];
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectModule = (next: ModuleId) => {
    void navigate({ search: next === 'command' ? {} : { module: next } });
  };

  return <div className="sonalit-intelligence-workspace">
    <div className="icw-shell">
      <aside className="icw-rail" aria-label="Intelligence Centre navigation">
        <div className="icw-brand">
          <div className="icw-brand-mark"><NavArtwork name="nav-analytics" className="icw-brand-artwork"/></div>
          <div className="icw-brand-copy"><strong>SONALIT</strong><small>INTELLIGENCE CENTRE</small><span>COLLECT · FUSE · ASSESS · DISSEMINATE</span></div>
        </div>
        {['OPERATIONS', 'COLLECTION', 'DISSEMINATION'].map(group => <div className="icw-nav-group" key={group}>
          <div className="icw-nav-group-label">{group}</div>
          {MODULES.filter(item => item.group === group).map(item => {
            return <button key={item.id} type="button" className="icw-nav-item" aria-current={module === item.id ? 'page' : undefined} onClick={() => selectModule(item.id)}>
              <span className="icw-nav-icon"><NavArtwork name={item.art} className="icw-nav-artwork"/></span>
              <span className="icw-nav-copy"><strong>{item.label}</strong><small>{item.caption}</small></span>
              <span className="icw-nav-index">{String(MODULES.indexOf(item) + 1).padStart(2, '0')}</span>
            </button>;
          })}
        </div>)}
        <div className="icw-rail-foot"><span>ACCESS BOUNDARY</span><strong><ShieldCheck size={12}/> ADMINISTRATOR ONLY</strong><small>Tenant-scoped intelligence workspace</small></div>
      </aside>

      <main className="icw-main">
        <header className="icw-topbar">
          <div className="icw-topbar-title">
            <span>SONALIT / INTELLIGENCE / {active.group}</span>
            <h1>{active.short}</h1>
            <p>{active.caption}</p>
          </div>
          <div className="icw-topbar-meta">
            <span className="icw-secure-tag"><ShieldCheck size={13}/> RESTRICTED WORKSPACE</span>
            <span className="icw-clock-tag"><Clock3 size={13}/> {clock} EAT</span>
          </div>
        </header>

        <nav className="icw-mobile-nav" aria-label="Intelligence workspaces">
          {MODULES.map(item => {
            return <button key={item.id} type="button" aria-current={module === item.id ? 'page' : undefined} onClick={() => selectModule(item.id)}><NavArtwork name={item.art} className="icw-nav-artwork"/><span>{item.short}</span></button>;
          })}
        </nav>

        <div className="icw-main-content">
          <Suspense fallback={<IntelligenceFallback label={active.short}/>}>
            {module === 'command' && <IntelligenceCommandView/>}
            {module === 'analysis' && <IntelligenceCentreDeep/>}
            {module === 'alerts' && <IntelligenceAlerts/>}
            {module === 'newsroom' && <IntelligenceLiveNews/>}
            {module === 'collection' && <IntelligenceSourceCommand/>}
            {module === 'publications' && <IntelligencePublicationDesk/>}
          </Suspense>
        </div>
      </main>
    </div>
  </div>;
}
