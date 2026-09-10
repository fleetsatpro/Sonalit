import { useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Activity, Newspaper, Shield, Siren, Radio, ArrowRight } from 'lucide-react';
import IntelligenceScopedWorkspace from './IntelligenceCentreScoped.tsx';
import IntelligenceLiveNews from './IntelligenceLiveNews.jsx';
import IntelligenceAlerts from './IntelligenceAlerts.tsx';

const MODULES = [
  { id:'core', label:'COMMAND WORKSPACE', caption:'Operating picture · fusion · spatial intelligence', icon:Shield, index:'01' },
  { id:'alerts', label:'INCIDENT FABRIC', caption:'Emerging public-signal detections · 60-minute window', icon:Siren, index:'02' },
  { id:'newsroom', label:'COLLECTION ROOM', caption:'Persisted observations · source provenance · breaking', icon:Newspaper, index:'03' },
];
function readModule(search){const value=new URLSearchParams(search).get('module');return MODULES.some(module=>module.id===value)?value:'core'}
export default function IntelligenceCentre(){
 const navigate=useNavigate();const search=useRouterState({select:state=>state.location.searchStr});const module=useMemo(()=>readModule(search),[search]);const active=MODULES.find(item=>item.id===module)||MODULES[0];
 const selectModule=next=>{void navigate({search:next==='core'?{}:{module:next}})};
 return <div className="sonalit-intelligence-shell">
  <header className="ic-commandbar"><div className="ic-command-brand"><div className="ic-command-mark"><span>S</span></div><div><span className="ic-command-eyebrow">SONALIT / INTELLIGENCE</span><strong>FUSION CENTRE</strong><small>SECURITY · LOGISTICS · GEOSPATIAL</small></div></div><div className="ic-command-status"><span className="live-dot"/> COLLECTION FABRIC <b>LIVE</b><i/> ACTIVE MODULE <strong>{active.index}</strong></div><div className="ic-command-actions"><span className="ic-clock">{new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span><span className="ic-secure">ORG ISOLATED · GEO ENFORCED</span></div></header>
  <nav className="ic-modulebar" aria-label="Intelligence Centre modules"><div className="ic-module-intro"><span className="ic-command-eyebrow">CENTRE LAYERS</span><b>ONE INTELLIGENCE ENVIRONMENT</b><small>Collection → Fusion → Decision support</small></div>{MODULES.map(item=>{const Icon=item.icon;return <button key={item.id} type="button" className={`ic-module ${module===item.id?'active':''}`} onClick={()=>selectModule(item.id)}><span className="ic-module-index">{item.index}</span><Icon size={16}/><span className="ic-module-copy"><strong>{item.label}</strong><em>{item.caption}</em></span><ArrowRight className="ic-module-arrow" size={14}/></button>})}<span className="ic-module-current"><span>CURRENT</span><b>{active.label}</b></span></nav>
  <div className="ic-module-context"><span><Radio size={12}/> DATA FABRIC</span><i/><span>12 LIVE INTELLIGENCE SURFACES</span><i/><span>30s CORE REFRESH</span><i/><span>FAIL-CLOSED SCOPING</span></div>
  {module==='alerts'?<IntelligenceAlerts/>:module==='newsroom'?<IntelligenceLiveNews/>:<IntelligenceScopedWorkspace/>}
 </div>;
}
