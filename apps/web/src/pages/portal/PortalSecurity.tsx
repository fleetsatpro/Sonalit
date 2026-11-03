import React,{useEffect,useState} from 'react';
import {useNavigate,useParams} from '@tanstack/react-router';
import {ArrowLeft,Shield} from 'lucide-react';
import {PortalShell} from '../../components/portal/PortalPrimitives.js';
import {SecurityStatusBar} from '../../components/portal/SecurityStatusBar.js';
import {IncidentFeed} from '../../components/portal/IncidentFeed.js';
import {ClientSecurityMap} from '../../components/portal/ClientSecurityMap.js';
import {subscribePortal} from '../../lib/portalCentrifuge.js';

type SecurityLevel='secure'|'warning'|'critical';
type Rt={type:'security';level:SecurityLevel;incident?:{type:string;status:string}};

export default function PortalSecurity():React.ReactElement{
 const {convoy_id=''}=useParams({strict:false}) as {convoy_id?:string}; const navigate=useNavigate();
 const [level,setLevel]=useState<SecurityLevel>('secure'); const [incidentType,setIncidentType]=useState<string|null>(null); const [fullscreen,setFullscreen]=useState(false);
 useEffect(()=>{if(!convoy_id)return;return subscribePortal<Rt>('portal#'+convoy_id,evt=>{if(evt.type!=='security')return;setLevel(evt.level);if(evt.incident&&evt.incident.status!=='resolved')setIncidentType(evt.incident.type);else if(evt.level==='secure')setIncidentType(null);})},[convoy_id]);
 const alerting=level!=='secure';
 return <PortalShell><div className="min-h-[100dvh] bg-[#050b12] text-white"><header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#070c14]/95 backdrop-blur-xl"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3"><button onClick={()=>void navigate({to:'/portal/convoy/$convoy_id/track',params:{convoy_id}})} className="rounded-lg p-1.5 text-white/40 hover:text-white"><ArrowLeft size={15}/></button><div><p className="text-sm font-semibold text-white">Security</p><p className="mt-0.5 flex items-center gap-1 text-[9px] text-white/25"><Shield size={10}/> {incidentType?incidentType.replace(/_/g,' '):'status'}</p></div></div></header><main className="mx-auto max-w-5xl space-y-4 px-4 pb-16 pt-4"><SecurityStatusBar convoyId={convoy_id}/><ClientSecurityMap convoyId={convoy_id} alerting={alerting} onFullscreen={()=>setFullscreen(true)}/><section><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-white/30">Incidents</p><span className={"font-mono text-[9px] "+(alerting?'text-red-300':'text-emerald-300')}>{alerting?'OPEN':'CLEAR'}</span></div><IncidentFeed convoyId={convoy_id} onLevelChange={l=>setLevel(l as SecurityLevel)}/></section></main>{fullscreen&&<div className="fixed inset-0 z-[120] bg-black p-2"><div className="h-full"><ClientSecurityMap convoyId={convoy_id} alerting={alerting} onFullscreen={()=>setFullscreen(false)}/></div></div>}</div></PortalShell>;
}