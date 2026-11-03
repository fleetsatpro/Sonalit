import type { GlobeMember, RiskZone, LatLng } from './CorridorWorldScene.js';

export type XdDimension = 'SPACE' | 'TIME' | 'IDENTITY' | 'MOTION' | 'INTEGRITY' | 'SECURITY' | 'EVIDENCE' | 'FUTURE';
export interface XdAgentFinding { id:string; label:string; dimension:XdDimension; state:'nominal'|'watch'|'alert'|'degraded'; confidence:number; summary:string }
export interface XdSurveillanceSnapshot { agents:XdAgentFinding[]; dimensions:Record<XdDimension,number>; visible:number; alerts:number; riskZones:number }
const DIMENSIONS:XdDimension[]=['SPACE','TIME','IDENTITY','MOTION','INTEGRITY','SECURITY','EVIDENCE','FUTURE'];
const valid=(m:GlobeMember)=>m.lat!=null&&m.lng!=null;
const median=(v:number[])=>{if(!v.length)return 0;const s=[...v].sort((a,b)=>a-b);return s[Math.floor(s.length/2)]??0};
export function runXdSurveillanceAgents(route:LatLng[],members:GlobeMember[],zones:RiskZone[]=[]):XdSurveillanceSnapshot{
 const live=members.filter(valid),off=members.filter(m=>m.status==='off_route').length;
 const degraded=members.filter(m=>['no_fix','tracking_uncertain','source_conflict','outlier_suspected','stale'].includes(m.position_state??'')||m.status==='no_fix').length;
 const highRisk=zones.filter(z=>['critical','no_go','high'].includes(z.risk_level)).length;
 const uncertain=members.filter(m=>(m.position_confidence??1)<0.7||(m.position_uncertainty_m??0)>250).length;
 const speeds=live.map(m=>Number(m.speed_kph)).filter(Number.isFinite),med=median(speeds),ready=route.length>=2;
 const agents:XdAgentFinding[]=[
  {id:'spatial',label:'Spatial Fusion',dimension:'SPACE',state:ready&&live.length?'nominal':'degraded',confidence:ready?0.98:0.35,summary:ready?`${live.length} live entities spatially grounded`:'Route geometry incomplete'},
  {id:'temporal',label:'Temporal Engine',dimension:'TIME',state:'nominal',confidence:0.96,summary:'Live cadence + replay state synchronized'},
  {id:'identity',label:'Entity Resolution',dimension:'IDENTITY',state:members.length?'nominal':'degraded',confidence:members.length?0.99:0.4,summary:`${members.length} tracked identities correlated`},
  {id:'motion',label:'Motion Analyst',dimension:'MOTION',state:off?'watch':'nominal',confidence:live.length?0.93:0.3,summary:live.length?`Median velocity ${Math.round(med)} km/h`:'No live velocity evidence'},
  {id:'integrity',label:'Source Integrity',dimension:'INTEGRITY',state:degraded?'alert':'nominal',confidence:degraded?0.62:0.97,summary:degraded?`${degraded} entities have degraded position evidence`:'Source chain nominal'},
  {id:'security',label:'Security Correlation',dimension:'SECURITY',state:highRisk||off?'alert':'nominal',confidence:zones.length?0.9:0.48,summary:highRisk||off?`${highRisk} high-risk zones · ${off} off-route`:'No elevated spatial security signal'},
  {id:'evidence',label:'Evidence Auditor',dimension:'EVIDENCE',state:uncertain?'watch':'nominal',confidence:members.length?0.91:0.4,summary:uncertain?`${uncertain} positions require evidence-confidence review`:'Evidence coverage consistent'},
  {id:'future',label:'Trajectory Forecaster',dimension:'FUTURE',state:live.length?'watch':'degraded',confidence:live.length?0.78:0.28,summary:live.length?'Forecast lane available; predictions remain separate from facts':'Insufficient live observations'},
  {id:'route',label:'Route Sentinel',dimension:'SPACE',state:off?'alert':'nominal',confidence:ready?0.95:0.35,summary:off?`${off} entities outside intended route posture`:'Corridor adherence nominal'},
  {id:'anomaly',label:'Anomaly Challenger',dimension:'INTEGRITY',state:degraded||uncertain?'alert':'nominal',confidence:members.length?0.88:0.3,summary:degraded||uncertain?'Challenging anomalous or stale observations':'No material observation anomaly detected'},
  {id:'scenario',label:'Scenario Lab',dimension:'FUTURE',state:live.length?'nominal':'degraded',confidence:live.length?0.74:0.25,summary:live.length?'Counterfactual lanes available':'Waiting for sufficient world state'},
  {id:'orchestrator',label:'Swarm Orchestrator',dimension:'TIME',state:'nominal',confidence:0.94,summary:'Specialists synchronized · deterministic facts protected'},
 ];
 const dimensions=Object.fromEntries(DIMENSIONS.map(d=>[d,agents.filter(a=>a.dimension===d).length])) as Record<XdDimension,number>;
 return {agents,dimensions,visible:live.length,alerts:agents.filter(a=>a.state==='alert').length,riskZones:zones.length};
}
