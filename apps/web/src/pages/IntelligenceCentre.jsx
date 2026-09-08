import { useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Activity, Newspaper, Shield, Siren } from 'lucide-react';
import CoreIntelligenceCentre from './IntelligenceCentre.tsx';
import IntelligenceLiveNews from './IntelligenceLiveNews.jsx';
import IntelligenceAlerts from './IntelligenceAlerts.tsx';

const MODULES = [
  { id: 'core', label: 'INTELLIGENCE WORKSPACE', caption: 'Situation · Signals · Operations · Atlas · Analysis', icon: Shield },
  { id: 'alerts', label: 'KENYA / EA ALERTS', caption: 'Near-real-time incidents · social signals · 60-minute window', icon: Siren },
  { id: 'newsroom', label: 'LIVE NEWSROOM', caption: 'Multi-source collection · breaking · developing · evidence', icon: Newspaper },
];

function readModule(search) {
  const value = new URLSearchParams(search).get('module');
  return MODULES.some(module => module.id === value) ? value : 'core';
}

export default function IntelligenceCentre() {
  const navigate = useNavigate();
  const search = useRouterState({ select: state => state.location.searchStr });
  const module = useMemo(() => readModule(search), [search]);
  const active = MODULES.find(item => item.id === module) || MODULES[0];

  const selectModule = (next) => {
    void navigate({ search: next === 'core' ? {} : { module: next } });
  };

  return <div className="sonalit-intelligence-shell">
    <style>{`.sonalit-intelligence-shell{min-height:100%;background:#07090c;color:#e7e9ec}.ic-modulebar{position:sticky;top:0;z-index:80;display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid #252b33;background:rgba(7,9,12,.96);backdrop-filter:blur(14px)}.ic-module-brand{display:flex;align-items:center;gap:9px;margin-right:12px;padding-right:15px;border-right:1px solid #252b33;min-width:190px}.ic-module-brand small{display:block;color:#68727f;font-size:8px;letter-spacing:.18em}.ic-module-brand b{display:block;margin-top:2px;font-size:11px;letter-spacing:.08em}.ic-module{display:flex;align-items:center;gap:9px;border:1px solid #252b33;background:#0c1015;color:#9da7b2;padding:8px 11px;border-radius:5px;cursor:pointer;text-align:left}.ic-module:hover{border-color:#3a424d;color:#e7e9ec}.ic-module.active{background:#e7e9ec;color:#07090c;border-color:#e7e9ec}.ic-module svg{flex:0 0 auto}.ic-module span{display:block}.ic-module strong{display:block;font-size:9px;letter-spacing:.12em}.ic-module em{display:block;font-style:normal;font-size:8px;opacity:.62;margin-top:2px;letter-spacing:.03em}.ic-module-state{margin-left:auto;font-size:8px;color:#69737f;letter-spacing:.12em}@media(max-width:760px){.ic-modulebar{overflow-x:auto}.ic-module-brand{min-width:150px}.ic-module-state{display:none}.ic-module{min-width:190px}}`}</style>
    <nav className="ic-modulebar" aria-label="Intelligence Centre modules">
      <div className="ic-module-brand"><Activity size={15}/><div><small>SONALIT</small><b>INTELLIGENCE CENTRE</b></div></div>
      {MODULES.map(item => { const Icon = item.icon; return <button key={item.id} type="button" className={`ic-module ${module === item.id ? 'active' : ''}`} onClick={() => selectModule(item.id)}><Icon size={14}/><span><strong>{item.label}</strong><em>{item.caption}</em></span></button>; })}
      <span className="ic-module-state">MODULE · {active.label}</span>
    </nav>
    {module === 'alerts' ? <IntelligenceAlerts/> : module === 'newsroom' ? <IntelligenceLiveNews/> : <CoreIntelligenceCentre/>}
  </div>;
}
