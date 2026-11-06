import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock3, Crosshair, DatabaseZap, ExternalLink, Globe2, Layers3, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import Map, { Marker, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/intelligence-centre-deep.css';
import { api } from '../lib/api.js';
import { displayText } from '../lib/intelligenceText.js';
import { STREET_STYLE } from '../lib/mapStyles.js';

type Row=Record<string,any>;
type View='situation'|'signals'|'operations'|'atlas'|'countries'|'investigations'|'forecasts'|'publications'|'watchlists'|'sources';
type Scope={type:'global'|'continent'|'region'|'country';key:string;label:string};
type Selection={type:string;id:string;data:Row};

type WorkbenchGlyphName='situation'|'signals'|'operations'|'atlas'|'countries'|'investigations'|'forecasts'|'publications'|'watchlists'|'sources';
const NAV:[View,string,WorkbenchGlyphName,string][]=[
 ['situation','OPERATING PICTURE','situation','01'],['signals','SIGNALS','signals','02'],['operations','OPERATIONS','operations','03'],['atlas','SPATIAL THEATRE','atlas','04'],['countries','COUNTRIES','countries','05'],['investigations','INVESTIGATIONS','investigations','06'],['forecasts','FORECASTS','forecasts','07'],['publications','PUBLICATIONS','publications','08'],['watchlists','WATCHLISTS','watchlists','09'],['sources','SOURCES','sources','10']
];
const NAV_GROUPS:[string,string,View[]][]=[
 ['command','COMMAND',['situation','operations']],
 ['evidence','EVIDENCE',['signals','sources']],
 ['geography','GEOGRAPHY',['atlas','countries']],
 ['analysis','ANALYSIS',['investigations','forecasts']],
 ['governance','GOVERNANCE',['watchlists','publications']]
];
function WorkbenchGlyph({name}:{name:WorkbenchGlyphName}){
 const p={className:'icd-workbench-glyph',viewBox:'0 0 40 40',fill:'none',stroke:'currentColor',strokeWidth:1.45,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true,focusable:'false'};
 switch(name){
 case 'situation':return <svg {...p}><circle className="iwg-orbit" cx="20" cy="20" r="15"/><ellipse className="iwg-grid" cx="20" cy="20" rx="6" ry="15"/><path d="M5 20h30M20 5v30"/><circle className="iwg-core" cx="20" cy="20" r="2.5"/><path className="iwg-sweep" d="M20 20 31 11"/></svg>;
 case 'signals':return <svg {...p}><path className="iwg-signal" d="M3 21h5l4-10 6 19 5-14 4 9 4-4h6"/><path className="iwg-wire" d="M6 7c8-5 20-5 28 0M6 33c8 5 20 5 28 0"/><circle className="iwg-core" cx="17" cy="20" r="2.4"/></svg>;
 case 'operations':return <svg {...p}><path className="iwg-route" d="M7 30 15 12l10 13 9-16"/><path d="m27 9 7 0-1 7M7 30h6"/><circle className="iwg-node" cx="7" cy="30" r="3"/><circle className="iwg-node" cx="15" cy="12" r="3"/><circle className="iwg-node" cx="25" cy="25" r="3"/><circle className="iwg-core" cx="34" cy="9" r="3"/></svg>;
 case 'atlas':return <svg {...p}><circle className="iwg-orbit" cx="20" cy="20" r="15"/><ellipse cx="20" cy="20" rx="7" ry="15"/><path d="M5 20h30M8 12h24M8 28h24"/><path className="iwg-sweep" d="M20 5c5 4 8 9 8 15s-3 11-8 15"/></svg>;
 case 'countries':return <svg {...p}><path d="m8 8 7-3 5 3 6-2 7 5-2 7 3 5-6 4-1 7-7-2-4 3-4-8-5-3 3-7-2-9Z"/><path className="iwg-wire" d="m15 5 1 8 8 5-4 8 5 8M8 23l9-2 9 5"/><circle className="iwg-core" cx="23" cy="19" r="2.5"/></svg>;
 case 'investigations':return <svg {...p}><path className="iwg-wire" d="M7 9 20 20 33 8M20 20 10 33M20 20 32 32"/><circle className="iwg-node" cx="7" cy="9" r="3.2"/><circle className="iwg-core" cx="20" cy="20" r="3.3"/><circle className="iwg-node" cx="33" cy="8" r="3.2"/><circle className="iwg-node" cx="10" cy="33" r="3.2"/><circle className="iwg-node" cx="32" cy="32" r="3.2"/></svg>;
 case 'forecasts':return <svg {...p}><path className="iwg-forecast" d="M5 30c7-1 10-4 14-10s9-9 17-10"/><path className="iwg-wire" strokeDasharray="2 4" d="M5 30c7 0 13-3 18-9s9-9 13-11"/><path d="m29 10 7-1-2 7"/><circle className="iwg-node" cx="5" cy="30" r="2.5"/><circle className="iwg-node" cx="19" cy="20" r="2.5"/><circle className="iwg-core" cx="36" cy="10" r="2.8"/></svg>;
 case 'publications':return <svg {...p}><path d="M9 5h16l7 7v23H9z"/><path className="iwg-wire" d="M25 5v8h7M14 18h13M14 23h13M14 28h9"/><path className="iwg-spine" d="M5 10v26h20"/></svg>;
 case 'watchlists':return <svg {...p}><circle className="iwg-orbit" cx="20" cy="20" r="15"/><circle cx="20" cy="20" r="9" strokeDasharray="3 3"/><circle cx="20" cy="20" r="3" className="iwg-core"/><path className="iwg-sweep" d="M20 20 32 10"/><circle className="iwg-node" cx="32" cy="10" r="2.5"/></svg>;
 case 'sources':return <svg {...p}><path d="M20 32V18"/><path className="iwg-wire" d="M10 24a14 14 0 0 1 20 0M5 18a21 21 0 0 1 30 0M14 29a8 8 0 0 1 12 0"/><path d="M15 34h10M12 37h16"/><circle className="iwg-core" cx="20" cy="17" r="2.5"/></svg>;
 default:return <svg {...p}><circle cx="20" cy="20" r="14"/><path d="M20 11v18M11 20h18"/></svg>;
 }
}
const REGIONS:Record<string,string[]>={'east-africa':['BI','DJ','ER','ET','KE','KM','MG','MU','MW','MZ','RW','SC','SO','SS','TZ','UG','ZM','ZW'],'west-africa':['BJ','BF','CV','CI','GM','GH','GN','GW','LR','ML','MR','NE','NG','SH','SL','SN','TG'],'central-africa':['AO','CF','CG','CD','CM','GA','GQ','ST','TD'],'north-africa':['DZ','EG','LY','MA','SD','TN'],'southern-africa':['BW','LS','NA','SZ','ZA']};
const AFRICA=[...new Set(Object.values(REGIONS).flat())];
const ENDPOINTS={events:'/risk/intelligence/events',storylines:'/risk/intelligence/storylines',gaps:'/risk/intelligence/gaps',forecasts:'/risk/intelligence/forecasts',assessments:'/risk/intelligence/assessments',publications:'/risk/intelligence/publications',warnings:'/risk/intelligence/early-warnings',watchlists:'/risk/intelligence/watchlists',entities:'/risk/intelligence/entities',sources:'/risk/intelligence/sources',observations:'/risk/intelligence/observations',quality:'/risk/intelligence/quality'};
const EAST_AFRICA_CODES=['BI','DJ','ER','ET','KE','KM','MG','MU','MW','MZ','RW','SC','SO','SS','TZ','UG','ZM','ZW'];

function list(data:any,key:string):Row[]{if(Array.isArray(data))return data;if(Array.isArray(data?.[key]))return data[key];if(Array.isArray(data?.items))return data.items;return[]}
function titleOf(x:Row){return x.title||x.headline||x.name||x.reference||x.scenario||'INTELLIGENCE OBJECT'}
function textOf(x:Row){if(x.source_type||x.provider){const role=String(x.metadata?.role||'').toLowerCase()==='discovery'?' · DISCOVERY / LINK-OUT':'';return String(x.source_type||'SOURCE').toUpperCase()+' · '+String(x.provider||'PROVIDER').toUpperCase()+role;}return displayText(x.summary||x.description||x.judgement||x.assessment||x.headline||x.status||'No analytical synopsis supplied.',1200)}
function age(v?:string){if(!v)return'—';const m=Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/60000));if(m<1)return'NOW';if(m<60)return`${m}M`;if(m<1440)return`${Math.floor(m/60)}H`;return`${Math.floor(m/1440)}D`}
function sev(v:any){const k=String(v||'informational').toLowerCase();return <span className={`icd-sev ${k}`}><i/>{k.toUpperCase()}</span>}
function scopeMatches(x:Row,s:Scope){if(s.type==='global')return true;const c=String(x.country_code||x.country||x.countryCode||'').toUpperCase();if(s.type==='country')return c===s.key;if(s.type==='region')return Boolean(REGIONS[s.key]?.includes(c))||String(x.scope_key||'').toLowerCase()===s.key;return AFRICA.includes(c)||String(x.scope_key||'').toLowerCase()===s.key}
function Kpi({label,value,sub,accent}:{label:string;value:any;sub:string;accent?:boolean}){return <div className={`icd-kpi ${accent?'accent':''}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>}
function Panel({title,kicker,meta,children,wide=false}:{title:string;kicker?:string;meta?:string;children:any;wide?:boolean}){return <section className={`icd-panel ${wide?'wide':''}`}><header><div><span>{kicker||'SONALIT / INTELLIGENCE'}</span><b>{title}</b></div>{meta&&<small>{meta}</small>}</header>{children}</section>}
function percentValue(value:any):number|null{
 if(value===null||value===undefined||value==='')return null;
 const numeric=Number(value);
 return Number.isFinite(numeric)&&numeric>=0&&numeric<=100?numeric:null;
}
function forecastDate(value:any){
 if(!value)return'NOT RECORDED';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'NOT RECORDED':date.toLocaleString('en-GB',{timeZone:'Africa/Nairobi',dateStyle:'medium',timeStyle:'short'})+' EAT';
}
function forecastLabel(value:any){return String(value||'unspecified').replaceAll('_',' ').replaceAll('-',' ').toUpperCase()}
function detailLabel(value:any){
 if(typeof value==='string')return displayText(value,2000);
 if(value===null||value===undefined)return'Not supplied';
 if(typeof value!=='object')return String(value);
 return value.title||value.label||value.name||value.description||value.statement||value.summary||JSON.stringify(value);
}
function ForecastCard({item,onSelect,index}:{item:Row;onSelect:(item:Row)=>void;index:number}){
 const probability=percentValue(item.probability),confidence=percentValue(item.confidence),status=String(item.status||'unspecified').toLowerCase();
 const assumptions=Array.isArray(item.assumptions)?item.assumptions.length:null;
 const indicators=Array.isArray(item.indicators)?item.indicators.length:null;
 const triggers=Array.isArray(item.invalidation_triggers)?item.invalidation_triggers.length:null;
 const evidence=Array.isArray(item.evidence)?item.evidence.length:null;
 return <button type="button" className="icd-forecast-card" onClick={()=>onSelect(item)} aria-label={'Open forecast '+(item.scenario||item.id||'record')}>
  <div className="icd-forecast-card-head"><span>{String(index+1).padStart(2,'0')} / {forecastLabel(item.horizon)}</span><em data-state={status}>{forecastLabel(status)}</em></div>
  <h3>{item.scenario||'Scenario not named'}</h3><p>{item.judgement||'No forecast judgement was supplied.'}</p>
  <div className="icd-forecast-measures">
   <div className="icd-forecast-measure"><div><small>SCENARIO PROBABILITY</small><strong>{probability===null?'NOT SCORED':probability.toFixed(0)+'%'}</strong></div><div className="icd-forecast-track probability" data-missing={probability===null?'true':'false'}><i style={{width:(probability??0)+'%'}}/></div></div>
   <div className="icd-forecast-measure"><div><small>ANALYST CONFIDENCE</small><strong>{confidence===null?'NOT RECORDED':confidence.toFixed(0)+'%'}</strong></div><div className="icd-forecast-track confidence" data-missing={confidence===null?'true':'false'}><i style={{width:(confidence??0)+'%'}}/></div></div>
  </div>
  <div className="icd-forecast-footprint"><span><b>{assumptions===null?'—':assumptions}</b> ASSUMPTIONS</span><span><b>{indicators===null?'—':indicators}</b> INDICATORS</span><span><b>{triggers===null?'—':triggers}</b> INVALIDATION TRIGGERS</span><span><b>{evidence===null?'—':evidence}</b> EVIDENCE ITEMS</span></div>
  <div className="icd-forecast-validity"><span>VALID FROM <b>{forecastDate(item.valid_from)}</b></span><span>VALID UNTIL <b>{forecastDate(item.valid_until)}</b></span></div>
 </button>;
}
function Rows({items,onSelect,empty='No records returned for this scope. An empty result is not proof that no incidents occurred; review the source register for provider diagnostics.'}:{items:Row[];onSelect:(x:Row)=>void;empty?:string}){return items.length?<div className="icd-rows">{items.slice(0,100).map((x,i)=><button key={x.id||`${i}-${titleOf(x)}`} className="icd-row" onClick={()=>onSelect(x)}><span className="index">{String(i+1).padStart(2,'0')}</span><div><b>{titleOf(x)}</b><span>{textOf(x)}</span></div><aside>{x.country_code&&<em>{String(x.country_code).toUpperCase()}</em>}{x.severity&&sev(x.severity)}<small>{age(x.last_seen_at||x.updated_at||x.observed_at||x.created_at)}</small></aside><ChevronRight size={14}/></button>)}</div>:<div className="icd-empty"><Layers3 size={18}/><b>NO SIGNAL</b><span>{empty}</span></div>}

export default function IntelligenceCentreDeep(){
 const [view,setView]=useState<View>('situation');
 const activeGroup=NAV_GROUPS.find(([, ,views])=>views.includes(view))||NAV_GROUPS[0];
 const [scope,setScope]=useState<Scope>({type:'global',key:'global',label:'GLOBAL'});
 const [query,setQuery]=useState('');
 const queryInputRef=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{const focusSearch=(event:KeyboardEvent)=>{if(event.key!=='/'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;const target=event.target as HTMLElement|null;if(target&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName)))return;event.preventDefault();queryInputRef.current?.focus()};window.addEventListener('keydown',focusSearch);return()=>window.removeEventListener('keydown',focusSearch)},[]);
 const [severity,setSeverity]=useState('all');
 const [status,setStatus]=useState('all');
 const [windowHours,setWindowHours]=useState(24);
 const [selected,setSelected]=useState<Selection|null>(null);
 const [country,setCountry]=useState('');
 const params=scope.type==='global'?{scope_type:'global',scope_key:'global'}:{scope_type:scope.type,scope_key:scope.key,...(scope.type==='country'?{country_code:scope.key}:{})};
 const useIntel=(path:string,extra:Row={})=>useQuery({queryKey:['icd',path,params,extra],queryFn:async()=>{const r=await api.get(path,{params:{...params,...extra}});return r.data},staleTime:15_000,refetchInterval:30_000,retry:1});
 const eventsQ=useIntel(ENDPOINTS.events,{limit:500,window_hours:windowHours});
 const storiesQ=useIntel(ENDPOINTS.storylines);
 const gapsQ=useIntel(ENDPOINTS.gaps);
 const forecastsQ=useIntel(ENDPOINTS.forecasts);
 const assessmentsQ=useIntel(ENDPOINTS.assessments);
 const publicationsQ=useIntel(ENDPOINTS.publications);
 const warningsQ=useIntel(ENDPOINTS.warnings);
 const watchQ=useIntel(ENDPOINTS.watchlists);
 const entitiesQ=useIntel(ENDPOINTS.entities);
 const sourcesQ=useIntel(ENDPOINTS.sources);
 const observationsQ=useIntel(ENDPOINTS.observations,{limit:500});
 const qualityQ=useIntel(ENDPOINTS.quality);
 const trajectoriesQ=useIntel('/risk/intelligence/trajectories',{scope_type:scope.type,scope_key:scope.key,limit:30});
 const exposuresQ=useIntel('/risk/intelligence/exposures');
 const linksQ=useIntel('/risk/intelligence/event-links');
 const requirementsQ=useIntel('/risk/intelligence/requirements'); const countriesQ=useQuery({queryKey:['icd-countries'],queryFn:async()=>{const r=await api.get('/risk/intelligence/countries');return r.data},staleTime:30_000,refetchInterval:60_000,retry:1});
 const filtered=(xs:Row[])=>xs.filter(x=>{const t=new Date(x.last_seen_at||x.updated_at||x.observed_at||x.created_at||0).getTime();const recent=!t||Date.now()-t<=windowHours*3600000;const sevOk=severity==='all'||String(x.severity||'').toLowerCase()===severity;const statusOk=status==='all'||String(x.status||'').toLowerCase()===status;const q=!query.trim()||JSON.stringify(x).toLowerCase().includes(query.trim().toLowerCase());return recent&&sevOk&&statusOk&&q});
 const events=filtered(list(eventsQ.data,'events').filter(x=>scopeMatches(x,scope)));
 const stories=filtered(list(storiesQ.data,'storylines').filter(x=>scopeMatches(x,scope)));
 const gaps=filtered(list(gapsQ.data,'gaps').filter(x=>scopeMatches(x,scope)));
 const forecasts=filtered(list(forecastsQ.data,'forecasts').filter(x=>scopeMatches(x,scope)));
 const assessments=filtered(list(assessmentsQ.data,'assessments').filter(x=>scopeMatches(x,scope)));
 const publications=filtered(list(publicationsQ.data,'publications').filter(x=>scopeMatches(x,scope)));
 const warnings=filtered(list(warningsQ.data,'warnings').filter(x=>scopeMatches(x,scope)));
 const watch=filtered(list(watchQ.data,'watchlists').filter(x=>scopeMatches(x,scope)));
 const entities=filtered(list(entitiesQ.data,'entities').filter(x=>scopeMatches(x,scope)));
 const observations=filtered(list(observationsQ.data,'observations').filter(x=>scopeMatches(x,scope)));
 const sources=list(sourcesQ.data,'sources').filter(x=>scope.type==='global'||String(x.metadata?.role||'').toLowerCase()==='discovery'||observations.some(o=>String(o.source_id)===String(x.id)));
 const countries=list(countriesQ.data,'countries').filter(x=>scopeMatches(x,scope));
 const trajectories=list(trajectoriesQ.data,'trajectories');
 const exposures=list(exposuresQ.data,'exposures');
 const links=list(linksQ.data,'links').filter(x=>scope.type==='global'||scopeMatches(x,scope));
 const requirements=list(requirementsQ.data,'requirements');
 const qd=qualityQ.data?.quality||{};
 const selectedEvent=useQuery({queryKey:['icd-event',selected?.id,params],enabled:selected?.type==='event'&&Boolean(selected.id),queryFn:async()=>{const r=await api.get(`/risk/intelligence/events/${selected!.id}`,{params});return r.data?.event},staleTime:30_000});
 const selectedWarning=useQuery({queryKey:['icd-warning',selected?.id],enabled:selected?.type==='warning'&&Boolean(selected.id),queryFn:async()=>{const r=await api.get(`/risk/intelligence/early-warnings/${selected!.id}/actions`);return r.data},staleTime:30_000});
 const countryAssessment=useQuery({queryKey:['icd-country-assessment',country],enabled:Boolean(country),queryFn:async()=>{const r=await api.get(`/risk/intelligence/countries/${country}/assessment`);return r.data},staleTime:30_000});
 const gps=events.filter(x=>Number.isFinite(Number(x.latitude))&&Number.isFinite(Number(x.longitude)));
 const mapCenter=gps.length?{longitude:Number(gps[0].longitude),latitude:Number(gps[0].latitude),zoom:4.5}:{longitude:37,latitude:-2,zoom:3.7};
 const priority=events.filter(x=>['critical','high'].includes(String(x.severity||'').toLowerCase())).length;
  const select=(type:string,x:Row)=>setSelected({type,id:String(x.id||x.event_id||x.warning_id||x.source_id||x.country_code),data:x});
 const scopeValue=scope.type==='global'?'global':`${scope.type}:${scope.key}`;
 const setScopeValue=(v:string)=>{if(v==='global'){setCountry('');setScope({type:'global',key:'global',label:'GLOBAL'});return}const [type,key]=v.split(':') as ['continent'|'region',string];setCountry('');setScope({type,key,label:key.replaceAll('-',' ').toUpperCase()})};
 const forecastSummary=useMemo(()=>{
  const probabilities=forecasts.map(item=>percentValue(item.probability)).filter((value):value is number=>value!==null);
  const confidences=forecasts.map(item=>percentValue(item.confidence)).filter((value):value is number=>value!==null);
  const buckets=[
   {label:'0–<25%',min:0,max:25},{label:'25–<50%',min:25,max:50},{label:'50–<75%',min:50,max:75},{label:'75–100%',min:75,max:100}
  ].map((bucket,index)=>({...bucket,count:probabilities.filter(value=>value>=bucket.min&&(index===3?value<=bucket.max:value<bucket.max)).length}));
  return {
   scored:probabilities.length,unscored:forecasts.length-probabilities.length,
   verified:forecasts.filter(item=>String(item.status||'').toLowerCase()==='verified').length,
   inReview:forecasts.filter(item=>String(item.status||'').toLowerCase()==='review').length,
   expired:forecasts.filter(item=>String(item.status||'').toLowerCase()==='expired').length,
   validityTracked:forecasts.filter(item=>Boolean(item.valid_until)).length,
   meanConfidence:confidences.length?confidences.reduce((sum,value)=>sum+value,0)/confidences.length:null,buckets
  };
 },[forecasts]);
 const currentData={events,stories,gaps,forecasts,assessments,publications,warnings,watch,entities,observations,sources,countries,trajectories,exposures,links,requirements};
 const refresh=()=>[eventsQ,storiesQ,gapsQ,forecastsQ,assessmentsQ,publicationsQ,warningsQ,watchQ,entitiesQ,sourcesQ,observationsQ,qualityQ,trajectoriesQ,exposuresQ,linksQ,requirementsQ,countriesQ].forEach(q=>q.refetch());
 return <div className="icd-root">
  <header className="icd-top"><div><span className="icd-eyebrow">SONALIT / INTELLIGENCE / ANALYSIS</span><h1>ANALYSIS WORKBENCH</h1><p>Evidence verification · fusion · deep analysis · operational assessment · publication</p></div><div className="icd-header-actions"><span>ANALYTIC SPACE</span><button type="button" onClick={refresh}><RefreshCw size={14}/> REFRESH</button></div></header>
  <section className="icd-theatre"><div className="icd-theatre-id"><span>ACTIVE THEATRE</span><strong>{scope.label}</strong><small>Every query is scoped server-side; empty geography stays empty.</small></div><label><span>THEATRE</span><select value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="global">GLOBAL</option><option value="continent:africa">AFRICA</option>{Object.keys(REGIONS).map(k=><option key={k} value={`region:${k}`}>{k.replaceAll('-',' ').toUpperCase()}</option>)}</select></label><label><span>COUNTRY</span><select value={country} onChange={e=>{setCountry(e.target.value);if(e.target.value)setScope({type:'country',key:e.target.value,label:e.target.value})}}><option value="">ALL COUNTRIES</option>{[...new Set(EAST_AFRICA_CODES.concat(countries.map(c=>String(c.country_code||'').toUpperCase())))].filter(Boolean).map(c=><option key={c} value={c}>{c}</option>)}</select></label><label><span>WINDOW</span><select value={windowHours} onChange={e=>setWindowHours(Number(e.target.value))}><option value={1}>1H</option><option value={6}>6H</option><option value={24}>24H</option><option value={72}>72H</option><option value={168}>7D</option></select></label><div className="icd-query"><Search size={14}/><input ref={queryInputRef} aria-label="Search the active intelligence space" value={query} onChange={e=>setQuery(e.target.value)} placeholder="SEARCH THE ACTIVE INTELLIGENCE SPACE"/><kbd>/</kbd></div></section>
  <nav className="icd-nav" aria-label="Analysis domains">{NAV_GROUPS.map(([id,label,views],index)=><button key={id} type="button" aria-current={activeGroup[0]===id?'page':undefined} className={activeGroup[0]===id?'active':''} onClick={()=>setView(views[0])}><span>{String(index+1).padStart(2,'0')}</span><b>{label}</b><small>{views.length} VIEWS</small></button>)}</nav>
  <nav className="icd-subnav" aria-label={activeGroup[1]+' workspaces'}>{NAV.filter(([id])=>activeGroup[2].includes(id)).map(([id,label,glyph,n])=><button key={id} type="button" aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>setView(id)}><span className="icd-subnav-glyph"><WorkbenchGlyph name={glyph}/></span><span className="icd-subnav-copy"><small>{n} / WORKSPACE</small><b>{label}</b></span><ChevronRight size={14}/></button>)}</nav>
  <section className="icd-filterbar"><span>FILTER</span><select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">ALL SEVERITIES</option><option value="critical">CRITICAL</option><option value="high">HIGH</option><option value="moderate">MODERATE</option><option value="low">LOW</option></select><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">ALL STATUS</option><option value="discovered">DISCOVERED</option><option value="validating">VALIDATING</option><option value="fused">FUSED</option><option value="assessed">ASSESSED</option><option value="open">OPEN</option><option value="monitoring">MONITORING</option></select><span className="scope-chip"><ShieldCheck size={12}/> {scope.label}</span><span className="scope-chip">{events.length} EVENTS · {observations.length} OBSERVATIONS · {sources.length} SOURCES</span></section>

  {view==='situation'&&<main className="icd-main"><section className="icd-hero"><div><span className="icd-kicker">01 / COMMAND PICTURE</span><h2>{scope.label}<br/><em>operating picture</em></h2><p>A unified decision surface connecting recorded events, warnings, trajectories, analytical storylines and operational exposure.</p><div className="icd-hero-pills"><span><Crosshair size={12}/> {priority} PRIORITY</span><span><DatabaseZap size={12}/> {sources.length} SOURCES</span><span><Clock3 size={12}/> LATEST {age(events[0]?.last_seen_at)}</span></div></div><div className="icd-orbit"><div/><div/><div/><strong>{events.length}</strong><small>EVENT OBJECTS</small></div></section><div className="icd-kpis"><Kpi label="EVENTS" value={events.length} sub={`${windowHours}H scoped`} accent/><Kpi label="PRIORITY" value={priority} sub="high / critical"/><Kpi label="WARNINGS" value={warnings.length} sub="active indicators"/><Kpi label="TRAJECTORIES" value={trajectories.length} sub="risk paths"/><Kpi label="EXPOSURES" value={exposures.length} sub="warning-linked"/><Kpi label="SOURCES" value={sources.length} sub="registered source records"/></div><div className="icd-grid"><Panel title="EVENT STREAM" kicker="COLLECTION → FUSION" meta={`${events.length} objects`} wide><Rows items={events} onSelect={x=>select('event',x)} empty="No event records were returned for this scope and time window. This is not confirmation that the theatre is incident-free."/></Panel><Panel title="WARNING BOARD" kicker="DETECTION → WARNING" meta={`${warnings.length} open`}><Rows items={warnings} onSelect={x=>select('warning',x)}/></Panel><Panel title="RISK TRAJECTORY" kicker="FORWARD STATE" meta={`${trajectories.length} snapshots`}><Rows items={trajectories} onSelect={x=>select('trajectory',x)}/></Panel><Panel title="OPERATIONAL EXPOSURE" kicker="INTELLIGENCE → OPERATIONS" meta={`${exposures.length} links`}><Rows items={exposures} onSelect={x=>select('exposure',x)}/></Panel></div></main>}

  {view==='signals'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">02 / SIGNALS</span><h2>Event ledger</h2><p>Detected activity with severity, status, geography, source count and direct evidence drill-down.</p></div><strong>{events.length} MATCHES</strong></div><Panel title="EVENT LEDGER" meta="server-scoped + local analytical filters"><Rows items={events} onSelect={x=>select('event',x)}/></Panel></main>}

  {view==='operations'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">03 / OPERATIONS</span><h2>Risk → movement exposure</h2><p>Warnings are translated into affected operational objects without replacing Fleet Command data.</p></div></div><div className="icd-kpis"><Kpi label="EXPOSURES" value={exposures.length} sub="active links" accent/><Kpi label="OPEN WARNINGS" value={warnings.length} sub="detected"/><Kpi label="HIGH PRIORITY" value={exposures.filter(x=>['high','critical'].includes(String(x.severity||'').toLowerCase())).length} sub="exposure risk"/><Kpi label="MOVEMENT LINKS" value={exposures.filter(x=>x.convoy_id||x.movement_id).length} sub="explicit movement refs"/></div><Panel title="EXPOSURE MATRIX" meta="warning · geography · score"><Rows items={exposures} onSelect={x=>select('exposure',x)} empty="No warning exposure records are currently linked to the active theatre."/></Panel></main>}

  {view==='atlas'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">04 / SPATIAL THEATRE</span><h2>Geographic intelligence theatre</h2><p>Only observations carrying defensible latitude/longitude are plotted; unresolved events remain in the ledger.</p></div><strong>{gps.length} GEOLOCATED</strong></div><div className="icd-map-shell"><Map initialViewState={mapCenter} mapStyle={STREET_STYLE} style={{width:'100%',height:'100%'}} attributionControl={false}><NavigationControl position="top-right" showCompass={false}/>{gps.slice(0,250).map((x,i)=><Marker key={x.id||i} longitude={Number(x.longitude)} latitude={Number(x.latitude)} anchor="center" onClick={()=>select('event',x)}><button className={`icd-marker ${String(x.severity||'low').toLowerCase()}`} aria-label={titleOf(x)}><i/></button></Marker>)}</Map><div className="icd-map-overlay"><span>SPATIAL OBJECTS</span><b>{gps.length}</b><small>unresolved {events.length-gps.length}</small></div></div><Panel title="SPATIAL EVENT QUEUE" meta="map-linked"><Rows items={gps.slice(0,100)} onSelect={x=>select('event',x)}/></Panel></main>}

  {view==='countries'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">05 / COUNTRIES</span><h2>Country intelligence</h2><p>Country posture combines the actual event ledger with first-class country assessments and publication records.</p></div></div><div className="icd-country-grid">{countries.map(x=><button className="icd-country" key={x.country_code} onClick={()=>{setCountry(x.country_code);setScope({type:'country',key:x.country_code,label:x.country_code})}}><div><Globe2 size={14}/><b>{x.country_code}</b><span>{x.severity_rank>=3?'ELEVATED':'MONITOR'}</span></div><strong>{x.events_24h}</strong><small>24H EVENTS · {x.confidence??'—'}% CONF</small><em>Latest {age(x.last_seen_at)}</em></button>)}</div>{country&&<div className="icd-country-detail"><Panel title={`${country} ASSESSMENT`} meta="country-level analytical contract"><Rows items={list(countryAssessment.data?.assessment,'key').length?[]:(countryAssessment.data?.assessment?[countryAssessment.data.assessment]:[])} onSelect={x=>select('assessment',x)} empty="No current assessment narrative returned."/></Panel><Panel title={`${country} EVENT EVIDENCE`} meta={`${events.filter(e=>String(e.country_code).toUpperCase()===country).length} events`}><Rows items={events.filter(e=>String(e.country_code).toUpperCase()===country)} onSelect={x=>select('event',x)}/></Panel></div>}</main>}

  {view==='investigations'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">06 / INVESTIGATIONS</span><h2>Analytical graph</h2><p>Move from isolated alerts to storylines, collection gaps, intelligence requirements and event-to-event relationships.</p></div><span>{links.length} EVENT LINKS</span></div><div className="icd-grid"><Panel title="STORYLINES" meta={`${stories.length} active`}><Rows items={stories} onSelect={x=>select('storyline',x)}/></Panel><Panel title="COLLECTION GAPS" meta={`${gaps.length} outstanding`}><Rows items={gaps} onSelect={x=>select('gap',x)}/></Panel><Panel title="INTELLIGENCE REQUIREMENTS" meta={`${requirements.length} tasked`}><Rows items={requirements} onSelect={x=>select('requirement',x)}/></Panel><Panel title="EVENT RELATIONSHIPS" meta={`${links.length} links`}><Rows items={links} onSelect={x=>select('link',x)}/></Panel></div></main>}

  {view==='forecasts'&&<main className="icd-main">
 <div className="icd-viewhead"><div><span className="icd-kicker">07 / FORECASTS</span><h2>Forward state</h2><p>Scenario probability, analyst confidence, validity and the evidence that could confirm or invalidate each outlook.</p></div><strong>{forecasts.length} FORECAST RECORDS</strong></div>
 <div className="icd-kpis"><Kpi label="FORECAST OBJECTS" value={forecasts.length} sub="Current theatre and time filters" accent/><Kpi label="VERIFIED" value={forecastSummary.verified} sub="Backend status = verified"/><Kpi label="PROBABILITY SCORED" value={forecastSummary.scored} sub={forecastSummary.unscored+' without a usable score'}/><Kpi label="MEAN CONFIDENCE" value={forecastSummary.meanConfidence===null?'—':forecastSummary.meanConfidence.toFixed(0)+'%'} sub="Mean stored analyst confidence"/><Kpi label="VALIDITY RECORDED" value={forecastSummary.validityTracked} sub="Records with valid-until timestamp"/></div>
 <div className="icd-forecast-layout">
  <section className="icd-forecast-register"><header className="icd-forecast-register-head"><div><span>SCENARIO REGISTER / {scope.label}</span><h3>Forecast assessments</h3><p>Probability and confidence are separate stored measures. No value is inferred when a field is absent.</p></div><b>{forecastSummary.scored}/{forecasts.length} SCORED</b></header>
   {forecasts.length?<div className="icd-forecast-list">{forecasts.slice(0,100).map((item,index)=><ForecastCard key={item.id||index} item={item} index={index} onSelect={x=>select('forecast',x)}/>)}</div>:<div className="icd-empty"><Layers3 size={18}/><b>NO FORECAST RECORDS</b><span>No forecast objects were returned for this theatre and filter set. The workspace does not generate placeholder scenarios.</span></div>}
  </section>
  <aside className="icd-forecast-aside">
   <Panel title="PROBABILITY DISTRIBUTION" kicker="SCORED SCENARIOS" meta={forecastSummary.scored+' scored'}>{forecastSummary.scored?<div className="icd-probability-distribution">{forecastSummary.buckets.map(bucket=><div className="icd-probability-bin" key={bucket.label}><span>{bucket.label}</span><div><i style={{width:(bucket.count/Math.max(1,...forecastSummary.buckets.map(item=>item.count))*100)+'%'}}/></div><b>{bucket.count}</b></div>)}<p>Only numeric probability values from 0 to 100 are included. Missing and invalid values are excluded, not treated as zero.</p></div>:<div className="icd-empty"><b>NO SCORED DISTRIBUTION</b><span>There are no usable probability values in the returned forecasts.</span></div>}</Panel>
   <Panel title="REVIEW & VALIDITY" kicker="STORED WORKFLOW STATE" meta="Server-returned status"><div className="icd-forecast-status-grid"><div><small>IN REVIEW</small><b>{forecastSummary.inReview}</b></div><div><small>EXPIRED</small><b>{forecastSummary.expired}</b></div><div><small>VERIFIED</small><b>{forecastSummary.verified}</b></div><div><small>VALID UNTIL RECORDED</small><b>{forecastSummary.validityTracked}</b></div></div><p className="icd-forecast-governance-note">A validity timestamp is displayed as recorded; the interface does not silently promote a draft, infer verification or replace the server's forecast status.</p></Panel>
   <Panel title="ASSESSMENT REGISTER" meta={`${assessments.length} records`}><Rows items={assessments} onSelect={x=>select('assessment',x)} empty="No assessment records were returned for this scope."/></Panel>
   <Panel title="TRAJECTORY REGISTER" meta={`${trajectories.length} snapshots`}><Rows items={trajectories} onSelect={x=>select('trajectory',x)}/></Panel>
  </aside>
 </div>
</main>}

  {view==='publications'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">08 / PUBLICATIONS</span><h2>Dissemination control room</h2><p>Publication register with governance state and review count—separate from raw observation flow.</p></div></div><Panel title="PUBLICATION REGISTER" meta={`${publications.length} scoped products`}><Rows items={publications} onSelect={x=>select('publication',x)}/></Panel></main>}

  {view==='watchlists'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">09 / WATCHLISTS</span><h2>Continuous monitoring</h2><p>Persistent collection targets, early-warning conditions, action history and warning-linked exposure.</p></div></div><div className="icd-grid"><Panel title="WATCHLISTS" meta={`${watch.length} active`}><Rows items={watch} onSelect={x=>select('watchlist',x)}/></Panel><Panel title="EARLY WARNINGS" meta={`${warnings.length} active`}><Rows items={warnings} onSelect={x=>select('warning',x)}/></Panel><Panel title="WARNING EXPOSURE" meta={`${exposures.length} linked`}><Rows items={exposures} onSelect={x=>select('exposure',x)}/></Panel></div></main>}

  {view==='sources'&&<main className="icd-main"><div className="icd-viewhead"><div><span className="icd-kicker">10 / SOURCES</span><h2>Provenance & evidence quality</h2><p>Inspect registered source reliability, observation volume, manipulation flags and evidence provenance. Provider run diagnostics are maintained in Collection Control.</p></div></div><div className="icd-kpis"><Kpi label="OBS / 30D" value={qd.observations_30d??'—'} sub="evidence volume"/><Kpi label="SOURCES / 30D" value={qd.sources_30d??'—'} sub="distinct sources"/><Kpi label="CREDIBILITY" value={qd.avg_credibility!=null?`${qd.avg_credibility}%`:'—'} sub="mean source score"/><Kpi label="MANIPULATION" value={qd.manipulation_flags??'—'} sub="flagged observations" accent/><Kpi label="OPEN GAPS" value={qd.open_gaps??'—'} sub="collection / analysis gaps"/></div><div className="icd-grid"><Panel title="SOURCE REGISTER" meta={`${sources.length} in scope`} wide><Rows items={sources} onSelect={x=>select('source',x)}/></Panel><Panel title="RECENT OBSERVATIONS" meta={`${observations.length} returned`}><Rows items={observations} onSelect={x=>select('observation',x)}/></Panel></div></main>}

  {selected&&<div className="icd-overlay" onClick={()=>setSelected(null)}><aside className="icd-drawer" onClick={e=>e.stopPropagation()}><header><div><span>INTELLIGENCE OBJECT · {selected.type.toUpperCase()}</span><h3>{displayText(titleOf(selectedEvent.data||selected.data),500)}</h3></div><button onClick={()=>setSelected(null)}><X size={16}/></button></header><div className="icd-drawer-meta">{selected.data.severity&&sev(selected.data.severity)}<span>{selected.data.country_code||selected.data.scope_key||scope.label}</span><span>{age(selected.data.last_seen_at||selected.data.updated_at||selected.data.observed_at||selected.data.created_at)}</span></div>{selected.type==='event'&&selectedEvent.data?.evidence&&<section className="icd-evidence"><b>EVIDENCE CHAIN</b><Rows items={selectedEvent.data.evidence} onSelect={x=>select('observation',x)} empty="No linked observations returned."/></section>}{selected.type==='event'&&<section className="icd-severity-brief"><header><b>PRELIMINARY THREAT ASSESSMENT</b><span>{String(selected.data.severity||'UNASSESSED').toUpperCase()} · NOT VERIFIED</span></header><div className="icd-severity-measures"><div><small>IMPACT</small><strong>{String(selected.data.assessment?.severity_assessment?.impact||'NOT ASSESSED').replaceAll('_',' ').toUpperCase()}</strong></div><div><small>URGENCY</small><strong>{String(selected.data.assessment?.severity_assessment?.urgency||'NOT ASSESSED').toUpperCase()}</strong></div><div><small>CONFIDENCE</small><strong>{selected.data.confidence==null?'NOT SCORED':String(selected.data.confidence)+'%'}</strong></div><div><small>INDEPENDENT SOURCES</small><strong>{selected.data.source_count??'—'}</strong></div></div><div className="icd-severity-basis"><b>WHY THIS LEVEL</b>{Array.isArray(selected.data.assessment?.severity_assessment?.basis)&&selected.data.assessment.severity_assessment.basis.length?<ul>{selected.data.assessment.severity_assessment.basis.map((item:string,i:number)=><li key={i}>{displayText(item,400)}</li>)}</ul>:<p>No rationale was stored for this legacy event. Do not treat its severity as analyst-verified.</p>}<p>{displayText(selected.data.assessment?.severity_assessment?.caveat||'Fused means records were grouped; it does not mean the event is verified.',700)}</p></div></section>}{selected.type==='warning'&&<section className="icd-evidence"><b>WARNING ACTIONS</b><Rows items={list(selectedWarning.data,'actions')} onSelect={x=>select('action',x)} empty="No action record returned."/></section>}{selected.type==='country'&&countryAssessment.data?.assessment&&<section className="icd-evidence"><b>COUNTRY ASSESSMENT</b><pre>{JSON.stringify(countryAssessment.data.assessment,null,2)}</pre></section>}<section className="icd-field-grid">{Object.entries(selectedEvent.data||selected.data).filter(([k])=>!['id','org_id','created_by','body','metadata','raw_metadata','assessment','indicators','source_text',...(selected.type==='forecast'?['assumptions','indicators','invalidation_triggers','evidence','model_metadata','judgement','probability','confidence','horizon','status','valid_from','valid_until']:[])].includes(k)).slice(0,35).map(([k,v])=><div key={k}><small>{k.replace(/_/g,' ')}</small><span>{typeof v==='object'?displayText(JSON.stringify(v,null,2),2400):displayText(v??'—',1600)}</span></div>)}</section>{selected.data.url&&<a className="icd-open" href={selected.data.url} target="_blank" rel="noreferrer"><ExternalLink size={13}/> OPEN ORIGINAL SOURCE</a>}{selected.data.source_url&&<a className="icd-open" href={selected.data.source_url} target="_blank" rel="noreferrer"><ExternalLink size={13}/> OPEN SOURCE EVIDENCE</a>}{selected.type==='forecast'&&<section className="icd-forecast-detail">
 <div className="icd-forecast-detail-measures"><div><small>SCENARIO PROBABILITY</small><b>{percentValue(selected.data.probability)===null?'NOT SCORED':percentValue(selected.data.probability)+'%'}</b></div><div><small>ANALYST CONFIDENCE</small><b>{percentValue(selected.data.confidence)===null?'NOT RECORDED':percentValue(selected.data.confidence)+'%'}</b></div><div><small>HORIZON</small><b>{forecastLabel(selected.data.horizon)}</b></div><div><small>STATUS</small><b>{forecastLabel(selected.data.status)}</b></div><div><small>VALID FROM</small><b>{forecastDate(selected.data.valid_from)}</b></div><div><small>VALID UNTIL</small><b>{forecastDate(selected.data.valid_until)}</b></div></div>
 <div className="icd-forecast-detail-section"><h4>FORECAST JUDGEMENT</h4><p>{selected.data.judgement||'No judgement text supplied.'}</p></div>
 {(['assumptions','indicators','invalidation_triggers','evidence'] as const).map(field=><div className="icd-forecast-detail-section" key={field}><h4>{forecastLabel(field)} <span>{Array.isArray(selected.data[field])?selected.data[field].length:'—'}</span></h4>{Array.isArray(selected.data[field])&&selected.data[field].length?<ol>{selected.data[field].map((item:any,index:number)=><li key={item?.id||index}>{detailLabel(item)}</li>)}</ol>:<p>No {forecastLabel(field).toLowerCase()} were returned on this forecast record.</p>}</div>)}
 </section>}<footer><ShieldCheck size={13}/> Provenance retained · automated/public signal status remains visible.</footer></aside></div>}
 </div>;
}
