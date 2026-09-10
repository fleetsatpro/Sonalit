import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, ShieldCheck, CalendarDays, ChevronRight, X } from 'lucide-react'
import { api } from '../lib/api.js'
import '../styles/intelligence-publication-desk.css'

type Row=Record<string,any>
const COUNTRIES=['KE','TZ','UG','RW','BI','SO','ET','SS','DJ','ER','SD','CD']
const TYPES=['daily','weekly','monthly','flash','crisis','country_profile','route_assessment','executive_brief','custom']
function age(v?:string){if(!v)return'—';const m=Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/60000));if(m<1)return'NOW';if(m<60)return`${m}M`;if(m<1440)return`${Math.floor(m/60)}H`;return`${Math.floor(m/1440)}D`}
function severity(v?:string){const s=String(v||'moderate').toLowerCase();return['critical','high','moderate','low','informational'].includes(s)?s:'moderate'}
function title(x:Row){return x.title||`${x.country_code||'REGIONAL'} ${x.publication_type||'publication'}`}
export default function IntelligencePublicationDesk(){
 const [country,setCountry]=useState(''); const [type,setType]=useState(''); const [selected,setSelected]=useState<Row|null>(null)
 const q=useQuery({queryKey:['intel-publications',country,type],queryFn:async()=>{const r=await api.get('/risk/intelligence/publications',{params:{status:'published',...(country?{scope_type:'country',scope_key:country}:{})}});return r.data?.publications||[]},staleTime:15000,refetchInterval:30000,retry:1})
 const items=useMemo(()=>{const xs=(q.data||[]).filter((x:Row)=>!country||x.country_code===country);return type?xs.filter((x:Row)=>x.publication_type===type):xs},[q.data,country,type])
 return <div className="ipd-root">
  <header className="ipd-head"><div><span>SONALIT / 3I NEWSROOM</span><h1>PUBLICATION DESK</h1><p>Daily intelligence products · weekly trend analysis · monthly strategic assessment</p></div><div className="ipd-coverage"><b>{items.length}</b><span>PUBLISHED PRODUCTS</span><small>Evidence-linked dissemination</small></div></header>
  <div className="ipd-controls"><label>COUNTRY<select value={country} onChange={e=>setCountry(e.target.value)}><option value="">ALL EAST &amp; CENTRAL AFRICA</option>{COUNTRIES.map(x=><option key={x}>{x}</option>)}</select></label><label>PRODUCT<select value={type} onChange={e=>setType(e.target.value)}><option value="">ALL PRODUCTS</option>{TYPES.map(x=><option key={x}>{x.toUpperCase()}</option>)}</select></label></div>
  <section className="ipd-grid">{items.map((x:Row,i:number)=><button key={x.id||i} className="ipd-card" onClick={()=>setSelected(x)}><div className="ipd-top"><span><FileText size={13}/> {String(x.publication_type||'custom').toUpperCase()}</span><em className={severity(x.severity)}>{String(x.status||'PUBLISHED').toUpperCase()}</em></div><h2>{title(x)}</h2><p>{x.executive_assessment||x.subtitle||'Evidence-linked intelligence product.'}</p><div className="ipd-meta"><span>{x.country_code||'REGIONAL'}</span><span>{x.evidence?.length||0} EVIDENCE</span><span>{age(x.published_at||x.updated_at)}</span><ChevronRight size={15}/></div></button>)}{!items.length&&<div className="ipd-empty"><ShieldCheck size={20}/><b>NO PUBLISHED PRODUCT FOR THIS FILTER</b><span>The newsroom stays evidence-first; drafts are not presented as published intelligence.</span></div>}</section>
  {selected&&<div className="ipd-modal" onMouseDown={e=>e.currentTarget===e.target&&setSelected(null)}><article><header><div><span>{String(selected.publication_type||'custom').toUpperCase()} · {selected.country_code||'REGIONAL'}</span><h2>{title(selected)}</h2></div><button onClick={()=>setSelected(null)}><X size={18}/></button></header><section className="ipd-summary"><small>EXECUTIVE ASSESSMENT</small><p>{selected.executive_assessment||selected.subtitle||'No executive assessment supplied.'}</p></section><section className="ipd-sections">{Object.entries(selected.body?.sections||{}).map(([k,v])=><div key={k}><small>{k.replace(/_/g,' ').toUpperCase()}</small><p>{typeof v==='string'?v:Array.isArray(v)?v.join(' '):JSON.stringify(v)}</p></div>)}</section><footer><span><CalendarDays size={14}/> {selected.period_start?new Date(selected.period_start).toLocaleDateString():'—'} → {selected.period_end?new Date(selected.period_end).toLocaleDateString():'—'}</span><span><ShieldCheck size={14}/> {selected.body?.generator?.evidence_contract?'EVIDENCE CONTRACT MET':'GOVERNED RECORD'}</span></footer></article></div>}
 </div>
}
