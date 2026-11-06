import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Activity, Clock3, ShieldCheck } from 'lucide-react';

const IntelligenceCommandView = lazy(() => import('./IntelligenceCommandView.js'));
const IntelligenceCentreDeep = lazy(() => import('./IntelligenceCentreDeep.tsx'));
const IntelligenceLiveNews = lazy(() => import('./IntelligenceLiveNews.jsx'));
const IntelligenceAlerts = lazy(() => import('./IntelligenceAlerts.tsx'));
const IntelligenceSourceCommand = lazy(() => import('./IntelligenceSourceCommand.js'));
const IntelligencePublicationDesk = lazy(() => import('./IntelligencePublicationDesk.tsx'));

const MODULES = [
  { id: 'command', label: 'COMMAND PICTURE', short: 'Operating picture', caption: 'Theatre posture · event geography · active warnings', glyph: 'command', group: 'OPERATIONS' },
  { id: 'analysis', label: 'ANALYSIS WORKBENCH', short: 'Intel Hub', caption: 'Fusion · storylines · forecasts · entities · assessments', glyph: 'analysis', group: 'OPERATIONS' },
  { id: 'alerts', label: 'INCIDENT FABRIC', short: 'Incident fabric', caption: 'Unverified public-signal detections · rolling 180 minutes', glyph: 'incident', group: 'COLLECTION' },
  { id: 'newsroom', label: 'NEWSROOM', short: 'Newsroom', caption: 'Persisted observations · provenance · source discovery', glyph: 'newsroom', group: 'COLLECTION' },
  { id: 'collection', label: 'COLLECTION CONTROL', short: 'Collection control', caption: 'Source registry · authorized bridges · provider runs', glyph: 'collection', group: 'COLLECTION' },
  { id: 'publications', label: 'PUBLICATIONS', short: 'Publication desk', caption: 'Daily · weekly · monthly country intelligence', glyph: 'publications', group: 'DISSEMINATION' },
];

function IntelligenceGlyph({ name, className = '' }) {
 const p={className:'icw-signature-glyph '+className,viewBox:'0 0 48 48',fill:'none',stroke:'currentColor',strokeWidth:1.65,strokeLinecap:'round',strokeLinejoin:'round','data-glyph':name,'aria-hidden':true,focusable:'false'};
 switch(name){
 case 'brand':return <svg {...p}><ellipse className="ig-rotate" cx="24" cy="24" rx="17" ry="8" transform="rotate(-34 24 24)"/><ellipse className="ig-counter" cx="24" cy="24" rx="17" ry="8" transform="rotate(52 24 24)"/><path d="M15 29.5c2.1 4 6.2 6.5 10.8 6.5 5.7 0 9.7-3.3 10.8-7.8M33 18.5C30.8 14.3 26.8 12 22.4 12c-5.2 0-9.2 3-10.4 7.5"/><circle className="ig-core" cx="24" cy="24" r="3.1"/><circle className="ig-node" cx="9" cy="17" r="1.8"/><circle className="ig-node" cx="37.5" cy="31" r="1.8"/></svg>;
 case 'command':return <svg {...p}><circle className="ig-ring ig-rotate" cx="24" cy="24" r="17.5" strokeDasharray="68 19"/><circle className="ig-ring ig-counter" cx="24" cy="24" r="11.5" strokeDasharray="42 18"/><path d="M24 3.5v9M24 35.5v9M3.5 24h9M35.5 24h9"/><path className="ig-sweep" d="M24 24 36.5 11.5"/><circle className="ig-core" cx="24" cy="24" r="3"/><circle className="ig-node" cx="36.5" cy="11.5" r="2"/></svg>;
 case 'analysis':return <svg {...p}><path className="ig-wire" d="m9 13 14-6 16 9-5 20-16 5L8 27Z"/><path className="ig-wire" d="m9 13 15 11 15-8M24 24 18 41m6-17 10 12m-10-12V7"/><circle className="ig-node" cx="9" cy="13" r="3"/><circle className="ig-node" cx="23" cy="7" r="3"/><circle className="ig-core" cx="24" cy="24" r="4"/><circle className="ig-node" cx="39" cy="16" r="3"/><circle className="ig-node" cx="34" cy="36" r="3"/><circle className="ig-node" cx="18" cy="41" r="3"/></svg>;
 case 'incident':return <svg {...p}><circle className="ig-ring ig-pulse" cx="24" cy="24" r="18"/><circle className="ig-ring" cx="24" cy="24" r="11.5" strokeDasharray="3 4"/><path className="ig-sweep" d="M7 25h8l4-9 6 17 5-11 3 3h8"/><circle className="ig-core" cx="24" cy="24" r="2"/></svg>;
 case 'newsroom':return <svg {...p}><path d="M11 6.5h21l6 6v28H11z"/><path className="ig-wire" d="M32 6.5v7h6M16 19h16M16 24h16M16 29h9M16 35h16"/><path className="ig-news-dot" d="M29 30.5h3.5v4H29z"/><path className="ig-sweep" d="M7 12v30h24"/></svg>;
 case 'collection':return <svg {...p}><path d="M9 19.5c7.5-8 22.5-8 30 0L24 35z"/><path className="ig-wire" d="m9 19.5 15 15.5 15-15.5M24 35v8M18 43h12"/><path className="ig-ring ig-rotate" d="M7 13C16 2 32 2 41 13"/><path d="m34 8 7 5-8 1"/><circle className="ig-core" cx="24" cy="27" r="2.7"/></svg>;
 case 'publications':return <svg {...p}><path d="M11 9.5h19l7 7v25H11z"/><path className="ig-wire" d="M30 9.5v8h7M16 23h16M16 28h16M16 33h10M7 14v30h23"/><path className="ig-node" d="M30 34h5v5h-5z"/></svg>;
 default:return <svg {...p}><circle cx="24" cy="24" r="14"/><path d="M24 10v28M10 24h28"/></svg>;
 }}

function readModule(search) {
  const value = new URLSearchParams(search).get('module');
  if (value === 'core') return 'analysis';
  return MODULES.some(module => module.id === value) ? value : 'command';
}

function IntelligenceFallback({ label }) {
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

  const selectModule = (next) => {
    void navigate({ search: next === 'command' ? {} : { module: next } });
  };

  return <div className="sonalit-intelligence-workspace">
    <div className="icw-shell">
      <aside className="icw-rail" aria-label="Intelligence Centre navigation">
        <div className="icw-brand">
          <div className="icw-brand-mark"><IntelligenceGlyph name="brand" className="icw-brand-artwork"/></div>
          <div className="icw-brand-copy"><strong>SONALIT</strong><small>INTELLIGENCE CENTRE</small><span>COLLECT · FUSE · ASSESS · DISSEMINATE</span></div>
        </div>
        {['OPERATIONS', 'COLLECTION', 'DISSEMINATION'].map(group => <div className="icw-nav-group" key={group}>
          <div className="icw-nav-group-label">{group}</div>
          {MODULES.filter(item => item.group === group).map(item => {
            return <button key={item.id} type="button" className="icw-nav-item" aria-current={module === item.id ? 'page' : undefined} onClick={() => selectModule(item.id)}>
              <span className="icw-nav-icon"><IntelligenceGlyph name={item.glyph} className="icw-nav-artwork"/></span>
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
            <span>SONALIT / INTELLIGENCE / {active.group} / {active.short.toUpperCase()}</span>
            <h1>INTEL HUB</h1>
            <p>{active.caption}</p>
          </div>
          <div className="icw-topbar-meta">
            <span className="icw-secure-tag"><ShieldCheck size={13}/> RESTRICTED WORKSPACE</span>
            <span className="icw-clock-tag"><Clock3 size={13}/> {clock} EAT</span>
          </div>
        </header>

        <nav className="icw-mobile-nav" aria-label="Intelligence workspaces">
          {MODULES.map(item => {
            return <button key={item.id} type="button" aria-current={module === item.id ? 'page' : undefined} onClick={() => selectModule(item.id)}><IntelligenceGlyph name={item.glyph} className="icw-nav-artwork"/><span>{item.short}</span></button>;
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
