import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Search, Radio, Shield, Sparkles, Timer, TrendingUp, X, ExternalLink, Globe2 } from 'lucide-react';
import { api } from '../lib/api.js';
const EAST_AFRICA=new Set(['KE','TZ','UG','RW','BI','CD','SS','SO','ET']);
const fmtAge=v=>{if(!v)return'—';const m=Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/60000));if(m<1)return'NOW';if(m<60)return`${m}M`;if(m<1440)return`${Math.floor(m/60)}H`;return`${Math.floor(m/1440)}D`};
const triageCue=a=>{const s=`${a?.title||''} ${a?.body||''}`.toLowerCase();if(/attack|bomb|explosion|kidnap|massacre|terror|ambush|gunfire|insurgent/.test(s))return'strong';if(/conflict|clash|unrest|protest|militia|strike|border|sanction|roadblock/.test(s))return'moderate';return'none'};
const cueLabel=cue=>cue==='strong'?'STRONG TEXT CUE':cue==='moderate'?'MODERATE TEXT CUE':'NO KEYWORD CUE';
function NewsCard({item,onSelect}){const cue=triageCue(item);return <button type="button" className="in-card" onClick={()=>onSelect(item)}><div className="in-card-top"><span className={`in-dot cue-${cue}`}/><span>{item.source_name||item.provider||'SOURCE'}</span><time>{fmtAge(item.observed_at)}</time></div><h3>{item.title||'Untitled report'}</h3><div className="in-card-meta"><span>{item.language||'GLOBAL'}</span><span>{item.country_code||'—'}</span><span className={`in-sev cue-${cue}`}>{cueLabel(cue)}</span></div><div className="in-card-foot"><span>{item.category||'OBSERVATION'}</span><ArrowUpRight size={12}/></div></button>}
function Detail({item,onClose}){if(!item)return null;return <div className="ic-evidence-overlay" onClick={onClose}><aside className="ic-evidence-drawer" onClick={e=>e.stopPropagation()}><header><div><span className="ic-command-eyebrow">COLLECTION OBJECT / UNVERIFIED</span><h2>{item.title}</h2></div><button onClick={onClose}><X size={16}/></button></header><div className="ic-evidence-badges"><span><Radio size={12}/> SOURCE OBSERVATION</span><span>{item.country_code||'GLOBAL'}</span><span>{fmtAge(item.observed_at)}</span></div><div className="ic-evidence-grid"><div><small>SOURCE</small><b>{item.source_name||item.provider||'Unknown'}</b></div><div><small>OBSERVED</small><b>{item.observed_at||'—'}</b></div><div><small>LANGUAGE</small><b>{item.language||'—'}</b></div><div><small>ORIGIN</small><b>{item.country_code||'—'}</b></div></div><div className="ic-evidence-note"><Shield size={14}/><div><strong>UNVERIFIED PUBLICATION MATERIAL</strong><p>Persisted collection-fabric material is kept separate from corroborated intelligence until the fusion layer promotes it.</p></div></div>{item.body&&<div className="ic-evidence-body"><small>RAW OBSERVATION</small><p>{item.body}</p></div>}{item.url&&<a className="ic-evidence-open" href={item.url} target="_blank" rel="noreferrer">OPEN ORIGINAL SOURCE <ArrowUpRight size={14}/></a>}</aside></div>}
export default function IntelligenceLiveNews(){
 const [articles,setArticles]=useState([]);const [events,setEvents]=useState([]);const [selected,setSelected]=useState(null);const [mode,setMode]=useState('global');const [q,setQ]=useState('');const [status,setStatus]=useState('CHECKING');const [last,setLast]=useState(null);const hasSuccessfulRead=useRef(false);
 const load=async()=>{if(!hasSuccessfulRead.current)setStatus('CHECKING');try{const [news,ops]=await Promise.all([api.get('/risk/intelligence/observations',{params:{limit:200}}).then(r=>r.data),api.get('/risk/intelligence/overview').then(r=>r.data).catch(()=>null)]);if(!Array.isArray(news?.observations))throw new Error('invalid_observations_payload');const observations=news.observations;setArticles(observations.filter(x=>x.title&&x.url));const o=ops?.events||ops?.event_ledger||ops?.signals||[];setEvents(Array.isArray(o)?o.slice(0,18):[]);setLast(new Date());hasSuccessfulRead.current=true;setStatus('RESPONDING')}catch{setStatus('DEGRADED')}};
 useEffect(()=>{load();const id=setInterval(load,30000);return()=>clearInterval(id)},[]);
 const visible=useMemo(()=>{const needle=q.trim().toLowerCase();return articles.filter(x=>{if(mode==='regional'&&!EAST_AFRICA.has(String(x.country_code||'').toUpperCase()))return false;if(!needle)return true;return `${x.title||''} ${x.body||''} ${x.source_name||''} ${x.country_code||''}`.toLowerCase().includes(needle)});},[articles,mode,q]);
 const strongCues=visible.filter(x=>triageCue(x)==='strong').length;const moderateCues=visible.filter(x=>triageCue(x)==='moderate').length;const uniqueSources=new Set(visible.map(x=>x.source_id||x.source_name||x.provider).filter(Boolean)).size;
 return <div className="intelligence-live">
  <header className="in-head">
   <div className="in-brand">
    <span className="ic-command-eyebrow">SONALIT / INTELLIGENCE / COLLECTION</span>
    <h1>NEWSROOM</h1>
    <p>Persisted observations and source material awaiting analytical corroboration.</p>
    <div className="in-live" data-state={status} role="status" aria-live="polite">
     <i className={status==='RESPONDING'?'ok':status==='DEGRADED'?'stale':''}/>
     <span>{status==='DEGRADED'?'REFRESH FAILED · LAST READ RETAINED':last?'LAST SUCCESSFUL READ':'AWAITING FIRST READ'}</span>
     <b>{last?last.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'—'}</b>
    </div>
   </div>
   <div className="in-search"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search observations, source names or country codes…"/><kbd>/</kbd></div>
   <div className="in-controls">
    <button type="button" className={mode==='global'?'active':''} aria-pressed={mode==='global'} onClick={()=>setMode('global')}><Globe2 size={13}/> GLOBAL</button>
    <button type="button" className={mode==='regional'?'active':''} aria-pressed={mode==='regional'} onClick={()=>setMode('regional')}>EAST AFRICA</button>
    <button type="button" onClick={load} aria-label="Refresh observations"><Radio size={13}/></button>
   </div>
  </header>
  <div className="in-subbar"><span>COLLECTION STREAM</span><b>OBSERVATIONS / PROVENANCE / FUSION HANDOFF</b><span className="in-substatus">{status==='DEGRADED'?'PREVIOUS RESULTS RETAINED':last?'PERSISTED READ · '+last.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'AWAITING FIRST READ'}</span></div>
  <div className="in-grid">
   <main className="in-main">
    <div className="in-strip">
     <div className="in-metric"><small>OBSERVATIONS</small><strong>{visible.length}</strong><span>IN CURRENT VIEW</span></div>
     <div className="in-metric"><small>DISTINCT SOURCES</small><strong>{uniqueSources}</strong><span>IDENTIFIABLE SOURCES</span></div>
     <div className="in-metric"><small>STRONG TEXT CUES</small><strong>{strongCues}</strong><span>LEXICAL TRIAGE ONLY</span></div>
     <div className="in-metric"><small>MODERATE TEXT CUES</small><strong>{moderateCues}</strong><span>LEXICAL TRIAGE ONLY</span></div>
    </div>
    <section className="in-section">
     <div className="in-section-head"><div><span className="ic-command-eyebrow">01 / OBSERVED MATERIAL</span><b><Radio size={12}/> RECENT OBSERVATIONS</b></div><span>UNVERIFIED SOURCE MATERIAL · PERSISTED</span></div>
     {status==='DEGRADED'&&last&&<div className="in-stale-note" role="status">A refresh attempt failed. The observations below are retained from the last successful read at {last.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}; no new coverage is implied.</div>}
     {visible.length?<div className="in-news">{visible.map((x,i)=><NewsCard key={x.id||x.external_id||i} item={x} onSelect={setSelected}/>)}</div>:
      <div className="in-feed-state"><Radio size={20}/><b>{status==='DEGRADED'?'OBSERVATION REGISTER UNAVAILABLE':status==='CHECKING'?'READING THE OBSERVATION REGISTER':'NO PERSISTED OBSERVATIONS MATCH THIS VIEW'}</b><span>The newsroom does not manufacture coverage when the collection fabric is empty.</span></div>}
    </section>
   </main>
   <aside className="in-side">
    <section className="in-section">
     <div className="in-section-head"><div><span className="ic-command-eyebrow">02 / FUSION HANDOFF</span><b><TrendingUp size={12}/> SONALIT SIGNALS</b></div><span>PERSISTED EVENT OBJECTS</span></div>
     {events.length?events.map((e,i)=><button type="button" className="in-event" key={e.id||i} onClick={()=>setSelected(e)}><small>{e.country_code||e.region||'GLOBAL'} · {String(e.severity||'UNCLASSIFIED').toUpperCase()} · {fmtAge(e.last_seen_at)}</small><b>{e.title||e.headline||'Intelligence event'}</b><span>{e.summary||e.judgement||'Evidence-linked event object'}</span></button>):<div className="in-feed-state small">NO FUSED EVENT OBJECTS RETURNED</div>}
    </section>
    <section className="in-section">
     <div className="in-section-head"><div><span className="ic-command-eyebrow">03 / ANALYTIC DISCIPLINE</span><b><Sparkles size={12}/> TRUST MODEL</b></div><span>SEPARATE STATES</span></div>
     <div className="in-analysis">
      <div className="in-principle"><strong>Observation is not judgement.</strong><span>Keyword cues are triage hints, not assessed severity or verified incident status.</span></div>
      <div className="in-principle"><strong>Provenance travels with evidence.</strong><span>Source identity and observation time remain distinguishable from fused event conclusions.</span></div>
      <div className="in-principle"><strong>Promotion requires corroboration.</strong><span>Independent evidence and analyst assessment belong to the fusion workflow.</span></div>
     </div>
    </section>
   </aside>
  </div>
  {selected&&<Detail item={selected} onClose={()=>setSelected(null)}/>}
 </div>;
}
