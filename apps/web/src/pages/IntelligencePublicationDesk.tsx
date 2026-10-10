import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, ShieldCheck, CalendarDays, ChevronRight, X, MapPinned, Radar, BookOpen, Download, ExternalLink, Sparkles } from 'lucide-react'
import { api } from '../lib/api.js'
import '../styles/intelligence-publication-desk.css'
import { openPublicationPdf } from '../lib/publicationPdf.js'

type Row=Record<string,any>
const COUNTRIES=['KE','TZ','UG','RW','BI','SO','ET','SS','DJ','ER','SD','CD']
const TYPES=['daily','weekly','monthly','flash','crisis','country_profile','route_assessment','executive_brief','custom']
function age(v?:string){if(!v)return'—';const m=Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/60000));if(m<1)return'NOW';if(m<60)return`${m}M`;if(m<1440)return`${Math.floor(m/60)}H`;return`${Math.floor(m/1440)}D`}
function severity(v?:string){const s=String(v||'moderate').toLowerCase();return['critical','high','moderate','low','informational'].includes(s)?s:'moderate'}
function title(x:Row){return x.title||`${x.country_code||'REGIONAL'} ${x.publication_type||'publication'}`}
function releaseLabel(x:Row){
 const status=String(x.status||'unknown').toLowerCase(); const gate=x.body?.release_gate||{};
 const evidence=x.body?.generator?.evidence_contract??x.body?.collection_basis?.publication_evidence_contract_met;
 if(gate.research_release_gate===false)return 'RESEARCH HOLD';
 if(gate.tradecraft_quality_gate===false||x.body?.publication_quality?.passed===false)return 'QUALITY HOLD';
 if(gate.ai_board_gate===false)return 'EDITORIAL HOLD';
 if(evidence===false||evidence==null&&status!=='published')return 'EVIDENCE HOLD';
 if(status==='published'){
  return gate.research_release_gate===true&&gate.tradecraft_quality_gate===true&&gate.ai_board_gate===true&&x.body?.publication_quality?.passed===true&&evidence===true
   ? 'PUBLISHED' : 'PUBLISHED · GATE UNVERIFIED';
 }
 if(status==='review')return 'IN REVIEW';
 return status.toUpperCase();
}
function pdfLabel(x:Row){
 const s=String(x.pdf_status||'not_requested').toLowerCase();
 if(s==='ready')return 'READY';
 if(s==='failed')return 'FAILED';
 if(s==='generating'||s==='processing')return 'GENERATING';
 if(s==='not_requested')return 'NOT REQUESTED';
 return s.toUpperCase();
}
function retryablePublication(x:Row){
 return ['draft','review'].includes(String(x.status||'').toLowerCase())&&['daily','weekly','monthly'].includes(String(x.publication_type||'').toLowerCase());
}
function blocks(body:Row){
 const out:any[]=[]
 if(body?.public_safety_security_overview)out.push({k:'PUBLIC SAFETY & SECURITY OVERVIEW',v:body.public_safety_security_overview.summary})
 if(body?.security_environment)out.push({k:'SECURITY ENVIRONMENT',v:body.security_environment.summary})
 if(Array.isArray(body?.emerging_trends))out.push({k:body.emerging_trends.some((x:any)=>x?.basis==='PERIOD_COMPARISON')?'EMERGING TRENDS':'OBSERVED CONCENTRATIONS',v:body.emerging_trends.map((x:any)=>`${x.theme} — ${x.assessment}`).join(' ')})
 if(Array.isArray(body?.key_drivers))out.push({k:'KEY DRIVERS',v:body.key_drivers.map((x:any)=>`${x.driver}: ${x.evidence}`).join(' ')})
 if(Array.isArray(body?.regional_news))out.push({k:'REGIONAL NEWS',v:body.regional_news.map((r:any)=>`${r.region}: ${(r.items||[]).map((i:any)=>i.headline).join('; ')}`).join(' ')})
 if(Array.isArray(body?.pmesi)){ const active=body.pmesi.filter((x:any)=>x?.update).map((x:any)=>`${x.domain}: ${x.status} — ${x.update}`); const quiet=body.pmesi.filter((x:any)=>!x?.update).map((x:any)=>x?.domain).filter(Boolean); out.push({k:'PMESI STATUS',v:active.concat(quiet.length?[`No material current-period update: ${quiet.join(', ')}.`]:[]).join(' ')}) }
 if(Array.isArray(body?.key_findings_assessment?.findings))out.push({k:'KEY FINDINGS & ASSESSMENT',v:body.key_findings_assessment.findings.map((x:any)=>`${x.headline}: ${x.assessment}`).join(' ')})
 if(Array.isArray(body?.outlook))out.push({k:'OUTLOOK & FORECAST',v:body.outlook.join(' ')})
 if(Array.isArray(body?.intelligence_gaps))out.push({k:'INTELLIGENCE GAPS',v:body.intelligence_gaps.join(' ')})
 if(Array.isArray(body?.references))out.push({k:'REFERENCES',v:`${body.references.length} source reference(s) attached to this product.`})
 return out
}
export default function IntelligencePublicationDesk(){
 const qc=useQueryClient()
 const [country,setCountry]=useState(''); const [type,setType]=useState(''); const [selected,setSelected]=useState<Row|null>(null); const [pdfBusy,setPdfBusy]=useState<null|'preview'|'download'>(null); const [pdfError,setPdfError]=useState<string|null>(null); const [retryMessage,setRetryMessage]=useState<string|null>(null)
 const report=useMutation({mutationFn:(id:string)=>api.post('/admin/communications/publications/'+encodeURIComponent(id)+'/generate-report'),onSuccess:()=>qc.invalidateQueries({queryKey:['intel-publications']})})
 const retryResearch=useMutation({
  mutationFn:(id:string)=>api.post('/admin/communications/publications/'+encodeURIComponent(id)+'/retry-research'),
  onError:(error:any)=>{
   const data=error?.response?.data;
   const retryAt=typeof data?.retry_at==='string'?new Date(data.retry_at):null;
   setRetryMessage(data?.message || (retryAt&&!Number.isNaN(retryAt.getTime())
    ? `Research retry is cooldown-gated until ${retryAt.toLocaleString()}.`
    : 'Research retry failed. The publication has not been confirmed recovered.'));
  },
  onSuccess:async(response:any)=>{
   const data=response?.data?.data;
   const retryAt=typeof data?.research_retry?.retry_at==='string'?new Date(data.research_retry.retry_at):null;
   setRetryMessage(data?.publication_status
    ? `Research retry finished: ${String(data.publication_status).toUpperCase()}.${retryAt&&!Number.isNaN(retryAt.getTime())?` Next manual retry after ${retryAt.toLocaleString()}.`:''}`
    : 'Research retry request completed. Verify the publication state below.');
   setSelected(null);
   await qc.invalidateQueries({queryKey:['intel-publications']});
  }
 })
 const q=useInfiniteQuery({
  queryKey:['intel-publications',country,type],
  initialPageParam:0,
  queryFn:async({pageParam})=>{
   const r=await api.get('/risk/intelligence/publications',{params:{
    limit:300,offset:pageParam,
    ...(country?{scope_type:'country',scope_key:country}:{}),
    ...(type?{publication_type:type}:{})
   }});
   return {
    publications:(r.data?.publications||[]) as Row[],
    total_count:Number(r.data?.total_count||0),
    offset:Number(r.data?.offset??pageParam),
    limit:Number(r.data?.limit||300),
    has_more:Boolean(r.data?.has_more)
   };
  },
  getNextPageParam:(lastPage)=>lastPage.has_more?lastPage.offset+lastPage.publications.length:undefined,
  staleTime:15000,refetchInterval:30000,retry:1
 });
 const items=useMemo(()=> (q.data?.pages||[]).flatMap(page=>page.publications),[q.data]);
 const totalPublications=Number(q.data?.pages?.[0]?.total_count??items.length);
 const researchCoverage=(x:Row)=>Number(x.body?.deep_research?.incidents_researched??x.body?.deep_research?.incidents_web_researched??0);
 const limitedResearch=(x:Row)=>Number(x.body?.deep_research?.incidents_researched_limited??0);
 const runPdf=async(mode:'preview'|'download',id:string)=>{setPdfBusy(mode);setPdfError(null);try{await openPublicationPdf(id,mode)}catch(error:any){setPdfError(error?.response?.data?.error||error?.message||'Unable to retrieve the publication PDF.')}finally{setPdfBusy(null)}};
 return <div className="ipd-root">
  <header className="ipd-head"><div><span>SONALIT / INTEL HUB / SECURITY PUBLICATIONS</span><h1>SECURITY PUBLICATION DESK</h1><p>Daily country security editions, deep incident research and controlled dissemination.</p><div className="ipd-headline-meta"><span>SECURITY ONLY</span><span>PROVENANCE RETAINED</span><span>VECTOR + IMAGERY</span></div></div><div className="ipd-coverage"><b>{totalPublications.toLocaleString()}</b><span>SECURITY PRODUCTS</span><small>{items.length.toLocaleString()} loaded · {items.filter((x:Row)=>String(x.status||'published')==='published').length} published · {items.filter((x:Row)=>researchCoverage(x)>0).length} researched</small></div></header>
  <div className="ipd-controls"><label>COUNTRY<select value={country} onChange={e=>setCountry(e.target.value)}><option value="">ALL EAST &amp; CENTRAL AFRICA</option>{COUNTRIES.map(x=><option key={x}>{x}</option>)}</select></label><label>PRODUCT<select value={type} onChange={e=>setType(e.target.value)}><option value="">ALL PRODUCTS</option>{TYPES.map(x=><option key={x}>{x.toUpperCase()}</option>)}</select></label></div>
  {retryMessage&&<div className="ipd-empty" role="status"><b>RESEARCH RECOVERY RESULT</b><span>{retryMessage}</span><button type="button" onClick={()=>setRetryMessage(null)}>DISMISS</button></div>}
  {q.isPending&&<div className="ipd-empty" role="status"><b>LOADING PUBLICATIONS</b><span>Retrieving the authorized publication register.</span></div>}
  {q.isError&&<div className="ipd-empty" role="alert"><b>PUBLICATION SERVICE UNAVAILABLE</b><span>The publication register could not be loaded. This is not an empty or zero-incident result.</span><button type="button" onClick={()=>void q.refetch()}>RETRY REGISTER</button></div>}
  {retryResearch.isError&&<div className="ipd-empty" role="alert"><b>RESEARCH RETRY NOT COMPLETED</b><span>{retryMessage||'The server did not confirm successful recovery. The publication must not be treated as fixed.'}</span></div>}
  <section className="ipd-grid">{items.map((x:Row,i:number)=>{
 const dr=x.body?.deep_research||{}; const dossierCount=Array.isArray(x.body?.incident_dossiers)?x.body.incident_dossiers.length:0; const pdfReady=String(x.pdf_status||'').toLowerCase()==='ready';
 return <article key={x.id||i} className="ipd-card">
  <button className="ipd-card-main" onClick={()=>setSelected(x)}><div className="ipd-top"><span><FileText size={13}/> {String(x.publication_type||'custom').toUpperCase()}</span><em className={severity(x.severity)}>{releaseLabel(x)}</em></div><h2>{title(x)}</h2><p>{x.executive_assessment||x.subtitle||'Evidence-linked intelligence product.'}</p></button>
  <div className="ipd-signal-row"><div><small>RESEARCH</small><b>{dr.incidents_researched??dr.incidents_web_researched??0}/{dr.incidents_requested??dossierCount}</b><span>{dr.web_sources_discovered??0} web sources{limitedResearch(x)>0?` · ${limitedResearch(x)} limited`:''}</span></div><div><small>DOSSIERS</small><b>{dossierCount}</b><span>incident case files</span></div><div><small>PDF</small><b>{pdfLabel(x)}</b><span>{String(x.pdf_status||'').toLowerCase()==='failed'?(x.pdf_error||'Generation failed; retry report rendering.'):age(x.pdf_generated_at||x.updated_at)}</span></div></div>
  <div className="ipd-card-actions"><span>{x.country_code||'REGIONAL'} · {age(x.published_at||x.updated_at)}</span><button onClick={()=>setSelected(x)}><ChevronRight size={14}/> OPEN DOSSIER</button>{x.status==='published'&&<button onClick={()=>report.mutate(x.id)} disabled={report.isPending}><Sparkles size={12}/>{report.isPending?'GENERATING…':pdfReady?'REGENERATE REPORT':'GENERATE REPORT'}</button>}</div>
 </article>
})}{!q.isPending&&!q.isError&&!items.length&&<div className="ipd-empty"><ShieldCheck size={20}/><b>NO PUBLICATION RECORD FOR THIS FILTER</b><span>No publication rows were returned for this scope. This does not establish that no security incidents occurred.</span></div>}</section>
  {q.hasNextPage&&<div className="ipd-empty ipd-pagination" aria-live="polite"><b>PUBLICATION ARCHIVE</b><span>Loaded {items.length.toLocaleString()} of {totalPublications.toLocaleString()} matching publications. Older editions are available.</span><button type="button" onClick={()=>void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage?'LOADING OLDER EDITIONS…':`LOAD MORE PUBLICATIONS · ${Math.min(300,totalPublications-items.length).toLocaleString()} NEXT`}</button>{q.isFetchNextPageError&&<span role="alert">Could not load the next page. Press load more to retry.</span>}</div>}
  {selected&&<div className="ipd-modal" onMouseDown={e=>e.currentTarget===e.target&&setSelected(null)}><article><header><div><span>{String(selected.publication_type||'custom').toUpperCase()} · {selected.country_code||'REGIONAL'}</span><h2>{title(selected)}</h2></div><button onClick={()=>setSelected(null)}><X size={18}/></button></header><section className="ipd-summary"><div><small>EXECUTIVE ASSESSMENT</small><p>{selected.executive_assessment||selected.subtitle||'No executive assessment supplied.'}</p></div><div className="ipd-command-grid"><div><small>POSTURE</small><b>{String(selected.body?.threat_posture?.level||selected.severity||'—').toUpperCase()}</b></div><div><small>RESEARCH</small><b>{selected.body?.deep_research?.incidents_researched??selected.body?.deep_research?.incidents_web_researched??0}/{selected.body?.deep_research?.incidents_requested??0}</b></div><div><small>SOURCES</small><b>{selected.body?.references?.length??0}</b></div><div><small>PDF</small><b>{String(selected.pdf_status||'NOT READY').toUpperCase()}</b></div></div></section><section className="ipd-sections">{blocks(selected.body).map((b:any)=><div key={b.k}><small>{b.k}</small><p>{b.v}</p></div>)}</section>{Array.isArray(selected.body?.incident_dossiers)&&selected.body.incident_dossiers.length>0&&<section className="ipd-incidents"><div className="ipd-incidents-head"><div><small>INCIDENT RESEARCH</small><h3>Published case files</h3></div><span>{selected.body.incident_dossiers.length} DOSSIERS</span></div><div className="ipd-incident-grid">{selected.body.incident_dossiers.slice(0,8).map((e:any,i:number)=><div key={e.id||i} className="ipd-incident"><div><span>{String(e.severity||'moderate').toUpperCase()}</span><b>{String(e.headline||e.title||'Incident')}</b></div><p>{String(e.what_happened||e.brief||'Research narrative not available.').slice(0,260)}{String(e.what_happened||e.brief||'').length>260?'…':''}</p><footer><span>{String(e.research_status||'NOT RESEARCHED').toUpperCase()}</span><span>{e.research_sources?.length||0} SOURCES</span></footer></div>)}</div></section>}<div className="ipd-empty" role="status">{(selected.body?.deep_research?.last_failure_reason||selected.body?.deep_research?.recovery_exhausted)&&<><b>RESEARCH RECOVERY</b><span>{selected.body?.deep_research?.last_failure_reason||'Automatic research recovery exhausted its retry budget.'}</span><span>Attempts: {Number(selected.body?.deep_research?.recovery_attempts||0)}/{Number(selected.body?.deep_research?.recovery_max_attempts||3)}{selected.body?.deep_research?.recovery_exhausted?' — automatic recovery exhausted':''}</span></>}</div><footer><span><CalendarDays size={14}/> {selected.period_start?new Date(selected.period_start).toLocaleDateString():'—'} → {selected.period_end?new Date(selected.period_end).toLocaleDateString():'—'}</span><span><MapPinned size={14}/> {selected.body?.incident_map?.points?.length||0} MAPPED</span><span><BookOpen size={14}/> {selected.body?.references?.length||0} SOURCES</span><span>{releaseLabel(selected)}</span><span><Radar size={14}/> {selected.body?.generator?.evidence_contract?'EVIDENCE CONTRACT MET':'GOVERNED RECORD'}</span><span className="ipd-pdf-actions">{(selected.body?.generator?.evidence_contract || selected.pdf_status==='ready' || selected.pdf_status==='failed' || retryablePublication(selected)) && <>{selected.pdf_status==='ready'&&<><button onClick={()=>runPdf('preview',selected.id)} disabled={!!pdfBusy} title={pdfError||'Open the generated PDF in a new tab'}><ExternalLink size={13}/> {pdfBusy==='preview'?'OPENING…':'PREVIEW PDF'}</button><button onClick={()=>runPdf('download',selected.id)} disabled={!!pdfBusy} title={pdfError||'Download the generated PDF'}><Download size={13}/> {pdfBusy==='download'?'PREPARING…':'DOWNLOAD PDF'}</button></>}{pdfError&&<span role="status">{pdfError}</span>}{String(selected.pdf_status||'').toLowerCase()==='failed'&&<span role="status">PDF failed: {selected.pdf_error||'the renderer returned an error'}.</span>}{retryablePublication(selected)&&<button onClick={()=>retryResearch.mutate(selected.id)} disabled={retryResearch.isPending||!!pdfBusy}><Sparkles size={13}/> {retryResearch.isPending?'RESEARCHING…':'RETRY RESEARCH'}</button>}{selected.status==='published'&&<button onClick={()=>report.mutate(selected.id)} disabled={report.isPending||!!pdfBusy}><Sparkles size={13}/> {report.isPending?'GENERATING…':selected.pdf_status==='ready'?'REGENERATE REPORT':'GENERATE REPORT'}</button>}</>}</span></footer></article></div>}
 </div>
}
