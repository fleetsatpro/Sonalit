import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, BrainCircuit, CheckCircle2, ChevronRight, Clock3, FileSearch, Layers3, MapPin, Network, RefreshCw, Search, ShieldAlert, Sparkles, Target, X, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import IntelligenceScopedWorkspace from './IntelligenceCentreDeep.tsx';
import '../styles/intelligence-centre-synthesis.css';

type Story = {
  id: string;
  rank: number;
  headline: string;
  topic: string;
  brief: string;
  key_facts: string[];
  why_it_matters: string[];
  caveats: string[];
  confidence_label: string;
  operational_relevance: string;
  severity: string;
  country_code?: string | null;
  status: string;
  source_count: number;
  observation_count: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  event_ids: string[];
  events: Record<string, any>[];
};

type Topic = { topic: string; story_count: number; signal_count: number; severity: string; countries: string[] };

type StoriesPayload = { stories: Story[]; topics: Topic[]; changes: Record<string, number>; scope: Record<string, string>; generated_at: string; engine: { name: string; ai_used: boolean; stories_synthesized: number } };

const SCOPE_COUNTRIES=['KE','SO','UG','TZ','RW','ET','DJ','SS','BI','ZM','ZW','CD'];
const sevOrder=['critical','high','moderate','low'];
function age(v?: string | null){if(!v)return'—';const m=Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/60000));if(m<1)return'NOW';if(m<60)return`${m}M`;if(m<1440)return`${Math.floor(m/60)}H`;return`${Math.floor(m/1440)}D`;}
function tone(v?:string){const k=String(v||'low').toLowerCase();return sevOrder.includes(k)?k:'low';}
function Metric({label,value,sub,accent}:{label:string;value:any;sub:string;accent?:boolean}){return <div className={`ics-metric ${accent?'accent':''}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>}
function StoryCard({story,onOpen,featured=false}:{story:Story;onOpen:(story:Story)=>void;featured?:boolean}){return <button className={`ics-story ${featured?'featured':''}`} onClick={()=>onOpen(story)}><div className="ics-story-top"><span className={`ics-severity ${tone(story.severity)}`}><i/>{story.severity.toUpperCase()}</span><span>{story.country_code||'REGIONAL'}</span><span>{age(story.last_seen_at)}</span></div><div className="ics-story-topic">{story.topic}</div><h3>{story.headline}</h3><p>{story.brief}</p><div className="ics-story-bottom"><span>{story.observation_count} OBSERVATIONS</span><span>{story.source_count} EVIDENCE</span><span>{story.operational_relevance} OPERATIONAL</span><ChevronRight size={16}/></div></button>}

export default function IntelligenceCentreSynthesis(){
 const [subview,setSubview]=useState<'overview'|'stories'|'topics'|'signals'|'deep'>('overview');
 const [query,setQuery]=useState('');
 const [windowHours,setWindowHours]=useState(24);
 const [country,setCountry]=useState('');
 const [selected,setSelected]=useState<Story|null>(null);
 const [refreshing,setRefreshing]=useState(false);
 const params={scope_type:country?'country':'global',scope_key:country||'global',window_hours:windowHours,limit:24};
 const synthesis=useQuery<StoriesPayload>({queryKey:['intel-synthesis',params],queryFn:async()=>{const r=await api.get('/risk/intelligence/synthesis/stories',{params});return r.data},staleTime:30_000,refetchInterval:60_000,retry:1});
 const signals=useQuery({queryKey:['intel-synthesis-events',country,windowHours],queryFn:async()=>{const r=await api.get('/risk/intelligence/events',{params:{scope_type:country?'country':'global',scope_key:country||'global',limit:120}});return r.data?.events||[]},staleTime:20_000,refetchInterval:30_000,retry:1});
 const selectedDetail=useQuery({queryKey:['intel-synthesis-story-detail',selected?.id],enabled:Boolean(selected),queryFn:async()=>{const ids=(selected?.event_ids||[]).slice(0,12);const r=await api.get('/risk/intelligence/synthesis/stories/'+selected!.id,{params:{event_ids:ids}});return r.data?.events||[]},staleTime:30_000,retry:1});
 const q=(query||'').trim().toLowerCase();
 const stories=useMemo(()=>{const items=synthesis.data?.stories||[];return q?items.filter(s=>JSON.stringify(s).toLowerCase().includes(q)):items},[synthesis.data,q]);
 const topics=useMemo(()=>synthesis.data?.topics||[],[synthesis.data]);
 const liveSignals=useMemo(()=>{const xs=Array.isArray(signals.data)?signals.data:[];return q?xs.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(q)):xs},[signals.data,q]);
 const top=stories[0];
 const priority=stories.filter(s=>s.severity==='critical'||s.severity==='high').length;
 const change=synthesis.data?.changes||{};
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setSelected(null);if(e.key==='/'&&document.activeElement?.tagName!=='INPUT'){e.preventDefault();document.getElementById('ics-search')?.focus();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 useEffect(()=>{document.body.style.overflow=selected?'hidden':'';return()=>{document.body.style.overflow=''}},[selected]);
 async function refresh(){setRefreshing(true);try{await Promise.all([synthesis.refetch(),signals.refetch()])}finally{setRefreshing(false)}}
 return <div className="ics-root">
  <header className="ics-header">
    <div className="ics-brand"><div className="ics-mark"><span>S</span></div><div><span>SONALIT / SECURITY INTELLIGENCE</span><h1>INTELLIGENCE CENTRE <em>SYNTHESIS</em></h1><p>Source mesh → story fusion → analytical context → operational relevance</p></div></div>
    <div className="ics-live"><span><i/>FABRIC LIVE</span><b>{synthesis.data?.engine?.ai_used?'AI SYNTHESIS ONLINE':'DETERMINISTIC FALLBACK'}</b><small>{age(synthesis.data?.generated_at)}</small><button onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/> REFRESH</button></div>
  </header>

  <section className="ics-controlbar">
    <div className="ics-theatre"><span>ACTIVE THEATRE</span><strong>{country||'GLOBAL'}</strong><small>Server-side scope enforcement active</small></div>
    <label><span>COUNTRY FOCUS</span><select value={country} onChange={e=>setCountry(e.target.value)}><option value="">ALL THEATRES</option>{SCOPE_COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    <label><span>WINDOW</span><select value={windowHours} onChange={e=>setWindowHours(Number(e.target.value))}><option value={6}>6 HOURS</option><option value={24}>24 HOURS</option><option value={72}>72 HOURS</option><option value={168}>7 DAYS</option></select></label>
    <div className="ics-search"><Search size={16}/><input id="ics-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="SEARCH STORIES, TOPICS, ACTORS, PLACES"/><kbd>/</kbd></div>
  </section>

  <nav className="ics-subnav">{[['overview','OPERATING PICTURE'],['stories','STORIES'],['topics','TOPICS'],['signals','LIVE SIGNALS'],['deep','DEEP ANALYSIS']].map(([id,label],i)=><button key={id} className={subview===id?'active':''} onClick={()=>setSubview(id as any)}><span>0{i+1}</span><b>{label}</b></button>)}</nav>

  {subview==='deep'?<IntelligenceScopedWorkspace/>:<main className="ics-main">
    <section className="ics-changebar">
      <div className="ics-change-title"><span>WHAT CHANGED</span><strong>{change.signals_24h||0}</strong><small>signals in active window</small></div>
      <div className="ics-change"><span className="up">↑</span><b>{priority}</b><small>HIGH PRIORITY</small></div>
      <div className="ics-change"><span>◆</span><b>{change.developing_stories||0}</b><small>DEVELOPING STORIES</small></div>
      <div className="ics-change"><span>◉</span><b>{change.source_observations||0}</b><small>EVIDENCE OBSERVATIONS</small></div>
      <div className="ics-engine"><BrainCircuit size={18}/><div><b>SONALIT SYNTHESIS</b><small>{synthesis.data?.engine?.stories_synthesized||0} stories AI-normalized · provenance retained</small></div></div>
    </section>

    {subview==='overview'&&<>
      <section className="ics-hero-grid">
        <div className="ics-hero">
          <div><span className="ics-eyebrow">PRIORITY INTELLIGENCE OBJECT</span><h2>{top?.headline||'WAITING FOR THE INTELLIGENCE FABRIC'}</h2><div className="ics-hero-meta">{top&&<><span className={`ics-severity ${tone(top.severity)}`}><i/>{top.severity.toUpperCase()}</span><span>{top.topic}</span><span>{top.country_code||'REGIONAL'}</span><span>{age(top.last_seen_at)}</span></>}</div><p>{top?.brief||'The synthesis engine will consolidate raw observations into canonical stories as collection data arrives.'}</p>{top&&<button className="ics-primary" onClick={()=>setSelected(top)}>OPEN INTELLIGENCE OBJECT <ArrowRight size={16}/></button>}</div>
          <div className="ics-orb"><div className="ring r1"/><div className="ring r2"/><div className="ring r3"/><Sparkles size={22}/><strong>{stories.length}</strong><small>CANONICAL STORIES</small></div>
        </div>
        <div className="ics-metrics"><Metric label="ACTIVE SIGNALS" value={change.signals_24h||0} sub="within window"/><Metric label="PRIORITY" value={priority} sub="high / critical" accent/><Metric label="TOPICS" value={topics.length} sub="active clusters"/><Metric label="DEVELOPING" value={change.developing_stories||0} sub="needs attention"/><Metric label="EVIDENCE" value={change.source_observations||0} sub="observations"/><Metric label="AI STORIES" value={synthesis.data?.engine?.stories_synthesized||0} sub="synthesized now" accent/></div>
      </section>
      <section className="ics-columns"><div className="ics-panel"><header><div><span>EMERGING TOPICS</span><h3>Live thematic clusters</h3></div><button onClick={()=>setSubview('topics')}>VIEW ALL <ArrowRight size={14}/></button></header><div className="ics-topic-list">{topics.slice(0,6).map((topic,i)=><button key={topic.topic} onClick={()=>{setQuery(topic.topic);setSubview('topics')}}><span>{String(i+1).padStart(2,'0')}</span><div><b>{topic.topic}</b><small>{topic.story_count} stories · {topic.signal_count} signals · {topic.countries.join(' · ')||'REGIONAL'}</small></div><span className={`ics-severity ${tone(topic.severity)}`}><i/>{topic.severity}</span><ChevronRight size={15}/></button>)}{!topics.length&&<div className="ics-empty">NO THEMATIC CLUSTERS YET</div>}</div></div>
        <div className="ics-panel"><header><div><span>PRIORITY SIGNALS</span><h3>Canonical intelligence stories</h3></div><button onClick={()=>setSubview('stories')}>VIEW ALL <ArrowRight size={14}/></button></header><div className="ics-mini-stories">{stories.slice(0,4).map(s=><StoryCard key={s.id} story={s} onOpen={setSelected}/>)}</div></div></section>
    </>}

    {subview==='stories'&&<section className="ics-panel ics-panel-full"><header><div><span>STORY OBJECTS</span><h3>One story. Many observations. No link-chasing.</h3></div><small>{stories.length} RESULTS</small></header><div className="ics-story-grid">{stories.map(s=><StoryCard key={s.id} story={s} onOpen={setSelected} featured={s.rank===1}/>)}</div></section>}

    {subview==='topics'&&<section className="ics-panel ics-panel-full"><header><div><span>TOPIC INTELLIGENCE</span><h3>Living thematic clusters</h3></div><small>SELECT A TOPIC TO FILTER STORIES</small></header><div className="ics-topics-grid">{topics.map((t,i)=><button key={t.topic} className="ics-topic-card" onClick={()=>{setQuery(t.topic);setSubview('stories')}}><span className="topic-index">{String(i+1).padStart(2,'0')}</span><b>{t.topic}</b><strong>{t.signal_count}</strong><small>SIGNALS · {t.story_count} STORIES</small><div className={`ics-topic-bar ${tone(t.severity)}`}><span style={{width:`${Math.min(100,25+t.signal_count*8)}%`}}/></div><em>{t.countries.join(' · ')||'REGIONAL'}</em></button>)}</div></section>}

    {subview==='signals'&&<section className="ics-panel ics-panel-full"><header><div><span>RAW COLLECTION</span><h3>Live signals with synthesis overlay</h3></div><small>{liveSignals.length} SIGNALS</small></header><div className="ics-signal-list">{liveSignals.slice(0,80).map((x:any,i:number)=><button key={x.id||i} onClick={()=>{const story=stories.find(s=>s.event_ids.includes(String(x.id)));if(story)setSelected(story)}}><span>{String(i+1).padStart(2,'0')}</span><div><b>{x.title||x.headline||'UNNAMED SIGNAL'}</b><small>{x.summary||x.description||'No synopsis supplied.'}</small></div><aside><em>{x.country_code||'—'}</em><span className={`ics-severity ${tone(x.severity)}`}><i/>{x.severity||'LOW'}</span><small>{age(x.last_seen_at||x.observed_at)}</small></aside><ChevronRight size={15}/></button>)}</div></section>}
  </main>}

  {selected&&<div className="ics-modal" role="dialog" aria-modal="true" aria-label="Intelligence object" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><article className="ics-object">
    <header><div><span>INTELLIGENCE OBJECT · STORY {selected.id}</span><h2>{selected.headline}</h2><div className="ics-object-tags"><span className={`ics-severity ${tone(selected.severity)}`}><i/>{selected.severity.toUpperCase()}</span><span>{selected.country_code||'REGIONAL'}</span><span>{selected.topic}</span><span>{selected.status}</span></div></div><button className="ics-close" onClick={()=>setSelected(null)} aria-label="Close"><X size={20}/></button></header>
    <div className="ics-object-body">
      <section className="ics-brief"><span>SONALIT INTELLIGENCE BRIEF</span><p>{selected.brief}</p></section>
      <section className="ics-object-grid"><div className="ics-evidence-panel"><header><span>KEY FACTS</span><b>{selected.key_facts?.length||0}</b></header>{(selected.key_facts||[]).map((x,i)=><div className="ics-fact" key={i}><CheckCircle2 size={15}/><span>{x}</span></div>)}</div><div className="ics-evidence-panel"><header><span>WHY THIS MATTERS</span><b>{selected.operational_relevance}</b></header>{(selected.why_it_matters||[]).map((x,i)=><div className="ics-fact" key={i}><Target size={15}/><span>{x}</span></div>)}{!selected.why_it_matters?.length&&<div className="ics-fact muted"><Target size={15}/><span>No operational relevance assessed yet.</span></div>}</div></section>
      <section className="ics-bottom-rail"><div><span>CONFIDENCE</span><strong>{selected.confidence_label}</strong></div><div><span>OBSERVATIONS</span><strong>{selected.observation_count}</strong></div><div><span>EVIDENCE</span><strong>{selected.source_count}</strong></div><div><span>LAST SEEN</span><strong>{age(selected.last_seen_at)}</strong></div></section>
      <section className="ics-tabs"><button className="active"><FileSearch size={15}/> EVIDENCE</button><button><Clock3 size={15}/> TIMELINE</button><button><Network size={15}/> CONNECTIONS</button><button><MapPin size={15}/> SPATIAL</button><button><ShieldAlert size={15}/> IMPACT</button></section>
      <section className="ics-detail-content"><div className="ics-detail-label"><span>OBSERVATION MESH</span><small>{selectedDetail.data?.length||selected.observation_count} linked event observations</small></div>{(selectedDetail.data||selected.events||[]).slice(0,12).map((x:any,i:number)=><div className="ics-observation" key={x.id||i}><span>{String(i+1).padStart(2,'0')}</span><div><b>{x.title||x.headline||'Observation'}</b><p>{x.summary||x.description||'Evidence retained in the underlying event record.'}</p></div><aside><em>{x.country_code||selected.country_code||'—'}</em><small>{age(x.last_seen_at||x.observed_at)}</small></aside></div>)}
      {selected.caveats?.length>0&&<div className="ics-caveat"><Zap size={15}/><div><b>ANALYTICAL CAVEATS</b>{selected.caveats.map((x,i)=><p key={i}>{x}</p>)}</div></div>}</section>
    </div>
    <footer><div><Sparkles size={14}/><span>SONALIT SYNTHESIS</span><small>Canonical headline and topic generated from retained evidence. Original source provenance remains available in the underlying record.</small></div><button onClick={()=>setSubview('deep')}>OPEN DEEP ANALYSIS <ArrowRight size={15}/></button></footer>
  </article></div>}
 </div>;
}
