import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, BookOpen, ChevronRight, CircleDot, FileText, Globe2, Layers3, Radar, RefreshCw, Search, Signal, Target, Truck, X } from 'lucide-react';
import Map, { Marker, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';

type Row = Record<string, any>;
type View = 'situation'|'signals'|'operations'|'atlas'|'countries'|'investigations'|'forecasts'|'publications'|'watchlists'|'sources';
type Scope = { kind:'global'|'continent'|'region'|'country'; key:string; label:string };

const NAV:[View,string,any][] = [
  ['situation','SITUATION',Target],['signals','SIGNALS',Signal],['operations','OPERATIONS',Truck],
  ['atlas','ATLAS',Globe2],['countries','COUNTRIES',Globe2],['investigations','INVESTIGATIONS',Radar],
  ['forecasts','FORECASTS',Activity],['publications','PUBLICATIONS',FileText],['watchlists','WATCHLISTS',CircleDot],['sources','SOURCES',BookOpen],
];
const REGIONS:Record<string,string[]> = {
  'east-africa':['BI','DJ','ER','ET','KE','KM','MG','MU','MW','MZ','RW','SC','SO','SS','TZ','UG','ZM','ZW'],
  'west-africa':['BJ','BF','CV','CI','GM','GH','GN','GW','LR','ML','MR','NE','NG','SH','SL','SN','TG'],
  'central-africa':['AO','CF','CG','CD','CM','GA','GQ','ST','TD'],
  'north-africa':['DZ','EG','LY','MA','SD','TN'],
  'southern-africa':['BW','LS','NA','SZ','ZA'],
};
const AFRICA:string[] = [...new Set(Object.values(REGIONS).flat())];
const ENDPOINTS = {
  events:'/risk/intelligence/events',storylines:'/risk/intelligence/storylines',gaps:'/risk/intelligence/gaps',forecasts:'/risk/intelligence/forecasts',
  assessments:'/risk/intelligence/assessments',publications:'/risk/intelligence/publications',warnings:'/risk/intelligence/early-warnings',
  watchlists:'/risk/intelligence/watchlists',entities:'/risk/intelligence/entities',sources:'/risk/intelligence/sources',observations:'/risk/intelligence/observations',quality:'/risk/intelligence/quality',
};
const OSM_STYLE:any = {version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm'}]};
function list(data:any,key:string):Row[]{if(Array.isArray(data))return data;if(Array.isArray(data?.[key]))return data[key];if(Array.isArray(data?.items))return data.items;return[];}
function code(x:Row){return String(x.country_code||x.country||x.countryCode||'').toUpperCase();}
function scopeMatch(x:Row,s:Scope){if(s.kind==='global')return true;const c=code(x);if(s.kind==='country')return c===s.key;const key=String(x.scope_key||x.scope?.scope_key||'').toLowerCase();return s.kind==='region'?(REGIONS[s.key]?.includes(c)||key===s.key):(AFRICA.includes(c)||key===s.key);}
function age(v?:string){if(!v)return'—';const m=Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/60000));if(m<1)return'NOW';if(m<60)return`${m}M`;if(m<1440)return`${Math.floor(m/60)}H`;return`${Math.floor(m/1440)}D`;}
function severity(v:any){const k=String(v||'informational').toLowerCase();return <span className={`icx-sev ${k}`}><i/>{k.toUpperCase()}</span>;}
function Panel({title,meta,children}:{title:string;meta?:string;children:any}){return <section className="icx-panel"><header><div><small>SONALIT / INTELLIGENCE</small><b>{title}</b></div><span>{meta||''}</span></header>{children}</section>;}
function Rows({items,onSelect}:{items:Row[];onSelect:(x:Row)=>void}){if(!items.length)return <div className="icx-empty"><Layers3 size={17}/><b>NO VERIFIED INTELLIGENCE IN THIS SCOPE</b><span>Unattributed objects are withheld by design.</span></div>;return <div>{items.slice(0,100).map((x,i)=><button className="icx-row" key={x.id||i} onClick={()=>onSelect(x)}><div><b>{x.title||x.headline||x.name||x.reference||x.scenario||'INTELLIGENCE OBJECT'}</b><span>{x.summary||x.description||x.judgement||x.assessment||x.scope_key||x.status||'Verified intelligence object'}</span></div><aside>{x.severity&&severity(x.severity)}<small>{age(x.last_seen_at||x.updated_at||x.observed_at||x.created_at)}</small><ChevronRight size={15}/></aside></button>)}</div>;}
function Drawer({x,onClose}:{x:Row;onClose:()=>void}){return <div className="icx-backdrop" onClick={onClose}><aside className="icx-drawer" onClick={e=>e.stopPropagation()}><header><div><small>SCOPED INTELLIGENCE OBJECT</small><h3>{x.title||x.headline||x.name||x.reference||x.id}</h3></div><button onClick={onClose}><X size={17}/></button></header>{x.country_code&&<div className="icx-chip">COUNTRY · {x.country_code}</div>}<div className="icx-fields">{Object.entries(x).filter(([k])=>!['body','metadata'].includes(k)).map(([k,v])=><div key={k}><small>{k.replace(/_/g,' ')}</small><span>{typeof v==='object'?JSON.stringify(v,null,2):String(v??'—')}</span></div>)}</div></aside></div>;}

export default function IntelligenceCentreScoped(){
  const [view,setView]=useState<View>('situation');
  const [scope,setScope]=useState<Scope>({kind:'global',key:'global',label:'GLOBAL'});
  const [country,setCountry]=useState('');
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<Row|null>(null);
  const params = scope.kind==='global'?{scope_type:'global',scope_key:'global'}:{scope_type:scope.kind,scope_key:scope.key,...(scope.kind==='country'?{country_code:scope.key}:{})};
  const useIntel=(path:string)=>useQuery({queryKey:['intel-centre',path,params],queryFn:async()=>{const r=await api.get(path,{params});return r.data;},staleTime:15000,refetchInterval:30000,retry:1});
  const qs=[useIntel(ENDPOINTS.events),useIntel(ENDPOINTS.storylines),useIntel(ENDPOINTS.gaps),useIntel(ENDPOINTS.forecasts),useIntel(ENDPOINTS.assessments),useIntel(ENDPOINTS.publications),useIntel(ENDPOINTS.warnings),useIntel(ENDPOINTS.watchlists),useIntel(ENDPOINTS.entities),useIntel(ENDPOINTS.sources),useIntel(ENDPOINTS.observations),useIntel(ENDPOINTS.quality)];
  const [eventsQ,storiesQ,gapsQ,forecastsQ,assessmentsQ,publicationsQ,warningsQ,watchQ,entitiesQ,sourcesQ,observationsQ,qualityQ]=qs;
  const events=list(eventsQ.data,'events').filter(x=>scopeMatch(x,scope));
  const stories=list(storiesQ.data,'storylines').filter(x=>scopeMatch(x,scope));
  const gaps=list(gapsQ.data,'gaps').filter(x=>scopeMatch(x,scope));
  const forecasts=list(forecastsQ.data,'forecasts').filter(x=>scopeMatch(x,scope));
  const assessments=list(assessmentsQ.data,'assessments').filter(x=>scopeMatch(x,scope));
  const publications=list(publicationsQ.data,'publications').filter(x=>scopeMatch(x,scope));
  const warnings=list(warningsQ.data,'warnings').filter(x=>scopeMatch(x,scope));
  const watch=list(watchQ.data,'watchlists').filter(x=>scopeMatch(x,scope));
  const entities=list(entitiesQ.data,'entities').filter(x=>scopeMatch(x,scope));
  const observations=list(observationsQ.data,'observations').filter(x=>scopeMatch(x,scope));
  const sources=list(sourcesQ.data,'sources').filter(x=>scope.kind==='global'||observations.some(o=>String(o.source_id)===String(x.id)));
  const countryCodes=[...new Set(events.map(code).filter(Boolean))].sort();
  const query=search.trim().toLowerCase();
  const visible=(xs:Row[])=>query?xs.filter(x=>JSON.stringify(x).toLowerCase().includes(query)):xs;
  const loading=qs.some(q=>q.isLoading); const errors=qs.filter(q=>q.isError);
  const refresh=()=>qs.forEach(q=>q.refetch());
  const setScopeValue=(v:string)=>{if(v==='global'){setCountry('');setScope({kind:'global',key:'global',label:'GLOBAL'});return;}const [kind,key]=v.split(':') as ['continent'|'region',string];setCountry('');setScope({kind,key,label:key.replaceAll('-',' ').toUpperCase()});};
  const applyCountry=(v:string)=>{setCountry(v);if(v)setScope({kind:'country',key:v,label:v});};
  const gpsEvents=events.filter(x=>Number.isFinite(Number(x.latitude))&&Number.isFinite(Number(x.longitude)));
  const initial=gpsEvents.length?{longitude:Number(gpsEvents[0].longitude),latitude:Number(gpsEvents[0].latitude),zoom:4.4}:{longitude:25,latitude:-3,zoom:3.2};
  const countryRows=countryCodes.map(c=>({country_code:c,title:c,summary:`Scoped event count · ${events.filter(e=>code(e)===c).length}`,severity:events.filter(e=>code(e)===c).some(e=>['critical','high'].includes(String(e.severity).toLowerCase()))?'high':'moderate'}));
  return <div className="icx-root">
    <header className="icx-top"><div><div className="icx-brand">SONALIT <span>INTELLIGENCE CENTRE</span></div><div className="icx-status"><i/> LIVE · ORG-ISOLATED · GEO-ENFORCED · FAIL-CLOSED</div></div><button className="icx-refresh" onClick={refresh}><RefreshCw size={15}/> REFRESH</button></header>
    <section className="icx-scope"><div><small>GEOGRAPHIC OPERATING SCOPE</small><strong>{scope.label}</strong><span>{scope.kind==='global'?'All verified organisation intelligence':`Only intelligence attributable to ${scope.label}`}</span></div><select value={scope.kind==='global'?'global':`${scope.kind}:${scope.key}`} onChange={e=>setScopeValue(e.target.value)}><option value="global">GLOBAL</option><option value="continent:africa">AFRICA</option>{Object.keys(REGIONS).map(k=><option key={k} value={`region:${k}`}>{k.replaceAll('-',' ').toUpperCase()}</option>)}</select><select value={country} onChange={e=>applyCountry(e.target.value)}><option value="">COUNTRY — ALL</option>{countryCodes.map(c=><option key={c} value={c}>{c}</option>)}</select><div className="icx-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SEARCH WITHIN ACTIVE GEOGRAPHY"/></div></section>
    <nav className="icx-nav">{NAV.map(([id,label,Icon])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}><Icon size={15}/>{label}</button>)}</nav>
    {errors.length>0&&<div className="icx-warning"><AlertTriangle size={16}/><span>{errors.length} surface(s) failed. No failed surface is replaced with unscoped data.</span><button onClick={refresh}>RETRY</button></div>}
    <main>
      {view==='situation'&&<><div className="icx-hero"><div><small>SCOPED OPERATING PICTURE</small><h1>{scope.label} intelligence, without geographic bleed.</h1><p>Geographic scope is enforced at the API boundary and re-checked in the client. Unattributed objects remain withheld.</p></div><div className="icx-metric"><small>VERIFIED EVENTS</small><b>{events.length}</b><span>{loading?'UPDATING':'CURRENT SCOPE'}</span></div></div><div className="icx-grid"><Panel title="CURRENT SIGNALS" meta={`${visible(events).length} events`}><Rows items={visible(events)} onSelect={setSelected}/></Panel><Panel title="COUNTRY COVERAGE" meta={`${countryRows.length} countries`}><Rows items={visible(countryRows)} onSelect={x=>applyCountry(x.country_code)}/></Panel></div></>}
      {view==='signals'&&<Panel title="SCOPED EVENT LEDGER" meta={`${visible(events).length} events`}><Rows items={visible(events)} onSelect={setSelected}/></Panel>}
      {view==='operations'&&<Panel title="OPERATIONAL RISK EVENTS" meta={`${visible(events).length} scoped events`}><Rows items={visible(events)} onSelect={setSelected}/></Panel>}
      {view==='atlas'&&<Panel title="GEOGRAPHIC INTELLIGENCE THEATRE" meta={`${gpsEvents.length} mapped events`}><div className="icx-map-wrap"><Map initialViewState={initial} mapStyle={OSM_STYLE}><NavigationControl position="top-right"/>{gpsEvents.map((e,i)=><Marker key={e.id||i} longitude={Number(e.longitude)} latitude={Number(e.latitude)} anchor="center"><button className="icx-map-pin" title={e.title||'Event'} onClick={()=>setSelected(e)}/></Marker>)}</Map></div><div className="icx-atlas-grid">{Object.entries(REGIONS).map(([k,c])=><button key={k} onClick={()=>setScope({kind:'region',key:k,label:k.replaceAll('-',' ').toUpperCase()})}><b>{k.replaceAll('-',' ').toUpperCase()}</b><span>{c.length} countries</span></button>)}</div></Panel>}
      {view==='countries'&&<Panel title="COUNTRY INTELLIGENCE" meta={`${visible(countryRows).length} visible`}><Rows items={visible(countryRows)} onSelect={x=>applyCountry(x.country_code)}/></Panel>}
      {view==='investigations'&&<div className="icx-grid"><Panel title="STORYLINES" meta={`${stories.length}`}><Rows items={visible(stories)} onSelect={setSelected}/></Panel><Panel title="COLLECTION GAPS" meta={`${gaps.length}`}><Rows items={visible(gaps)} onSelect={setSelected}/></Panel></div>}
      {view==='forecasts'&&<div className="icx-grid"><Panel title="FORECASTS" meta={`${forecasts.length}`}><Rows items={visible(forecasts)} onSelect={setSelected}/></Panel><Panel title="ASSESSMENTS" meta={`${assessments.length}`}><Rows items={visible(assessments)} onSelect={setSelected}/></Panel></div>}
      {view==='publications'&&<Panel title="PUBLICATION REGISTER" meta={`${publications.length}`}><Rows items={visible(publications)} onSelect={setSelected}/></Panel>}
      {view==='watchlists'&&<div className="icx-grid"><Panel title="WATCHLISTS" meta={`${watch.length}`}><Rows items={visible(watch)} onSelect={setSelected}/></Panel><Panel title="EARLY WARNINGS" meta={`${warnings.length}`}><Rows items={visible(warnings)} onSelect={setSelected}/></Panel></div>}
      {view==='sources'&&<><div className="icx-quality"><div><small>OBSERVATIONS</small><b>{observations.length}</b></div><div><small>SOURCES IN SCOPE</small><b>{sources.length}</b></div><div><small>AVG CREDIBILITY</small><b>{qualityQ.data?.quality?.avg_credibility??'—'}%</b></div><div><small>OPEN GAPS</small><b>{gaps.length}</b></div></div><div className="icx-grid"><Panel title="SOURCES" meta={`${sources.length}`}><Rows items={sources} onSelect={setSelected}/></Panel><Panel title="ENTITIES" meta={`${entities.length}`}><Rows items={entities} onSelect={setSelected}/></Panel></div></>}
    </main>{selected&&<Drawer x={selected} onClose={()=>setSelected(null)}/>}</div>;
}
