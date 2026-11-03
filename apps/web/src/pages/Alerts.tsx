import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  IconBell, IconGauge, IconMapPinOff, IconAlertTriangle, IconDroplet, IconTool,
  IconWifi, IconShield, IconCheck, IconDownload, IconLoader2,
  IconMapPin, IconRoute, IconSearch, IconChevronDown, IconX, IconPlus,
  IconArrowUpRight, IconFolder,
} from '@tabler/icons-react'
import { api } from '../lib/api.js'
import { subscribe } from '../lib/centrifuge.js'
import { useAuthStore } from '../stores/auth.js'
import { normalizeList } from '../lib/normalize.js'

// ── Types ─────────────────────────────────────────────────────────────────────
// Alerts and incidents are the same underlying concept — "something bad
// happened" — split across two tables that differ only in provenance:
// alerts are machine-detected, typed, auto-generated signals; incidents are
// human-curated case files (notes, an assignee, a longer status lifecycle).
// This page merges both into one feed instead of pretending they're
// unrelated, with an explicit "Promote to Incident" action connecting them.

type Kind = 'alert' | 'incident'
type Status = 'open' | 'acknowledged' | 'investigating' | 'escalated' | 'resolved' | 'closed'

interface AlertApiRow {
  id: string; severity: string; type: string
  title?: string | null; message?: string | null; body?: string | null
  triggered_at?: string | null; created_at?: string | null
  acknowledged_at?: string | null; resolved_at?: string | null
  vehicle_reg?: string | null; convoy_name?: string | null
  lat?: number | null; lng?: number | null
}

interface IncidentApiRow {
  id: string; title: string; description: string | null
  severity: string; status: string
  type?: string | null; assigned_to?: string | null; notes?: string | null
  source_alert_id?: string | null
  created_at: string; updated_at?: string
}

interface FeedRow {
  kind: Kind; id: string; severity: string; status: Status
  title: string; detail: string; type: string
  vehicle_reg?: string | null | undefined; convoy_name?: string | null | undefined
  created_at: string
  acknowledged_at?: string | null | undefined; resolved_at?: string | null | undefined
  assigned_to?: string | null | undefined; notes?: string | null | undefined; source_alert_id?: string | null | undefined
  lat?: number | null | undefined; lng?: number | null | undefined
}

type SortMode = 'sev' | 'time' | 'type'
type KindFilter = 'all' | Kind

// ── Palette ───────────────────────────────────────────────────────────────────

const BG='#080809',S1='#0D0D10',S2='#121217',S3='#18181F',S4='#1E1E27'
const T1='#F0F0F8',T2='#8888A0',T3='#44445A'
const LN='rgba(255,255,255,0.055)',LN2='rgba(255,255,255,0.10)'
const RE='#FF2040',AM='#FFB300',CY='#00CFFF',GR='#00E87A',OR='#FF6200',PU='#A855F7'

interface SC { c:string; bg:string; bd:string; lbl:string; ord:number }
const SEV:Record<string,SC> = {
  critical:{c:RE,bg:'rgba(255,32,64,.12)',   bd:'rgba(255,32,64,.28)',   lbl:'CRITICAL',ord:0},
  high:    {c:AM,bg:'rgba(255,179,0,.12)',    bd:'rgba(255,179,0,.28)',   lbl:'HIGH',    ord:1},
  warning: {c:AM,bg:'rgba(255,179,0,.12)',    bd:'rgba(255,179,0,.28)',   lbl:'WARNING', ord:1},
  medium:  {c:CY,bg:'rgba(0,207,255,.09)',    bd:'rgba(0,207,255,.22)',   lbl:'MEDIUM',  ord:2},
  info:    {c:CY,bg:'rgba(0,207,255,.09)',    bd:'rgba(0,207,255,.22)',   lbl:'INFO',    ord:2},
  low:     {c:PU,bg:'rgba(168,85,247,.10)',  bd:'rgba(168,85,247,.25)', lbl:'LOW',     ord:3},
}
const gs = (s:string):SC => SEV[s?.toLowerCase()] ?? SEV['info']!

const STATUS_META:Record<Status,{c:string;lbl:string}> = {
  open:          {c:T3, lbl:'● OPEN'},
  acknowledged:  {c:AM, lbl:'◐ ACK'},
  investigating: {c:AM, lbl:'◐ INVESTIGATING'},
  escalated:     {c:RE, lbl:'▲ ESCALATED'},
  resolved:      {c:GR, lbl:'✓ RESOLVED'},
  closed:        {c:T3, lbl:'✓ CLOSED'},
}
const isClosedBucket = (st:Status) => st==='resolved' || st==='closed'

const TYPE_ICONS:Record<string,React.ReactElement> = {
  speed:<IconGauge size={11}/>, geofence:<IconMapPinOff size={11}/>,
  'geofence.breach':<IconMapPinOff size={11}/>, panic:<IconAlertTriangle size={11}/>,
  'panic.triggered':<IconAlertTriangle size={11}/>, fuel:<IconDroplet size={11}/>,
  mechanical:<IconTool size={11}/>, communication:<IconWifi size={11}/>, security:<IconShield size={11}/>,
  incident:<IconFolder size={11}/>,
}
const typeIcon = (t:string) => TYPE_ICONS[t?.toLowerCase()] ?? <IconBell size={11}/>

// ── Mapping ───────────────────────────────────────────────────────────────────

function alertToRow(a:AlertApiRow):FeedRow {
  return {
    kind:'alert', id:a.id, severity:a.severity,
    status: a.resolved_at?'resolved':a.acknowledged_at?'acknowledged':'open',
    title: a.title ?? a.message ?? a.type ?? 'Alert', detail: a.body ?? a.message ?? '',
    type: a.type, vehicle_reg:a.vehicle_reg, convoy_name:a.convoy_name,
    created_at: a.triggered_at ?? a.created_at ?? '',
    acknowledged_at:a.acknowledged_at, resolved_at:a.resolved_at,
    lat:a.lat, lng:a.lng,
  }
}
function incidentToRow(i:IncidentApiRow):FeedRow {
  return {
    kind:'incident', id:i.id, severity:i.severity, status: i.status as Status,
    title: i.title, detail: i.description ?? '', type: i.type ?? 'incident',
    created_at: i.created_at,
    assigned_to:i.assigned_to, notes:i.notes, source_alert_id:i.source_alert_id,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtT = (iso?:string|null) => { if(!iso) return '—'; try{return new Date(iso).toISOString().replace('T',' ').slice(0,16)+' UTC'}catch{return '—'} }
const ago  = (iso?:string|null) => {
  if(!iso) return '—'
  try {
    const d=Math.floor((Date.now()-new Date(iso).getTime())/60000)
    return d<1?'just now':d<60?`${d}m ago`:`${Math.floor(d/60)}h ${d%60}m ago`
  } catch { return '—' }
}

function exportCSV(rows:FeedRow[]) {
  const hdr='Kind,ID,Severity,Type,Title,Status,Vehicle,Convoy,Assigned,Created'
  const body=rows.map(r=>[r.kind,r.id,r.severity,r.type,r.title.replace(/,/g,' '),r.status,r.vehicle_reg??'',r.convoy_name??'',r.assigned_to??'',r.created_at].join(','))
  const blob=new Blob([hdr+'\n'+body.join('\n')],{type:'text/csv'})
  const url=URL.createObjectURL(blob)
  const el=document.createElement('a');el.href=url;el.download='alerts-incidents.csv';el.click();URL.revokeObjectURL(url)
}

// ── SevBadge / KindBadge ──────────────────────────────────────────────────────

function SevBadge({sev}:{sev:string}) {
  const s=gs(sev)
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 9px',borderRadius:2,
      background:s.bg,border:`1px solid ${s.bd}`,color:s.c,fontFamily:'var(--font-mono)',
      fontSize:9,fontWeight:700,letterSpacing:'.1em',whiteSpace:'nowrap'}}>
      <span style={{width:4,height:4,borderRadius:'50%',background:s.c,flexShrink:0,
        ...(sev==='critical'?{animation:'blink 1s ease-in-out infinite'}:{})}}/>
      {s.lbl}
    </span>
  )
}

function KindBadge({kind}:{kind:Kind}) {
  const isIncident = kind==='incident'
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 7px',borderRadius:2,
      background:isIncident?'rgba(168,85,247,.10)':'rgba(255,98,0,.10)',
      border:`1px solid ${isIncident?'rgba(168,85,247,.25)':'rgba(255,98,0,.25)'}`,
      color:isIncident?PU:OR,fontFamily:'var(--font-mono)',fontSize:8,fontWeight:700,
      letterSpacing:'.08em',whiteSpace:'nowrap'}}>
      {isIncident?<IconFolder size={9}/>:<IconBell size={9}/>}
      {isIncident?'CASE':'ALERT'}
    </span>
  )
}

// ── Case file editor (incidents only) ────────────────────────────────────────

function CaseFileEditor({r,onSave,busy}:{r:FeedRow;onSave:(patch:{assigned_to?:string;notes?:string})=>void;busy:boolean}) {
  const [assignee,setAssignee]=useState(r.assigned_to??'')
  const [notes,setNotes]=useState(r.notes??'')
  const dirty = assignee!==(r.assigned_to??'') || notes!==(r.notes??'')
  return (
    <div>
      <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,marginBottom:5,textTransform:'uppercase'}}>Assigned To</div>
      <input value={assignee} onChange={e=>setAssignee(e.target.value)} placeholder="Unassigned"
        style={{width:'100%',background:S2,border:`1px solid ${LN2}`,borderRadius:3,padding:'6px 9px',
          fontFamily:'var(--font-mono)',fontSize:10,color:T1,outline:'none',marginBottom:10}}/>
      <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,marginBottom:5,textTransform:'uppercase'}}>Notes</div>
      <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="Add case notes…"
        style={{width:'100%',background:S2,border:`1px solid ${LN2}`,borderRadius:3,padding:'6px 9px',
          fontFamily:'var(--font-mono)',fontSize:10,color:T1,outline:'none',resize:'vertical',marginBottom:8}}/>
      <button type="button" disabled={!dirty||busy} onClick={()=>onSave({assigned_to:assignee,notes})}
        style={{width:'100%',padding:'7px',borderRadius:3,background:dirty?PU:S2,
          border:`1px solid ${dirty?PU:LN}`,color:dirty?'#fff':T3,fontFamily:'var(--font-mono)',
          fontSize:9,letterSpacing:'.08em',textTransform:'uppercase',cursor:dirty&&!busy?'pointer':'default'}}>
        {busy?'Saving…':'Save Case File'}
      </button>
    </div>
  )
}

// ── ExpandPanel ───────────────────────────────────────────────────────────────

function ExpandPanel({r,onAck,onRes,onPromote,onStatusChange,onCaseSave,ackBusy,resBusy,promoteBusy,statusBusy,caseBusy}:{
  r:FeedRow
  onAck:()=>void; onRes:()=>void; onPromote:()=>void
  onStatusChange:(status:Status)=>void
  onCaseSave:(patch:{assigned_to?:string;notes?:string})=>void
  ackBusy:boolean; resBusy:boolean; promoteBusy:boolean; statusBusy:boolean; caseBusy:boolean
}) {
  const navigate = useNavigate()
  const s=gs(r.severity)
  const loc=r.lat&&r.lng?`${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`:'—'
  const col:React.CSSProperties={padding:'16px 20px',borderRight:`1px solid ${LN}`}
  const hdr=(lbl:string)=>(
    <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.2em',textTransform:'uppercase',
      color:s.c,marginBottom:11,display:'flex',alignItems:'center',gap:7}}>
      {lbl}<div style={{flex:1,height:1,background:`${s.c}30`}}/>
    </div>
  )
  const row=(k:string,v:string,vc?:string)=>(
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
      padding:'5px 0',borderBottom:`1px solid rgba(255,255,255,.03)`}}>
      <span style={{color:T3,fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'.06em'}}>{k}</span>
      <span style={{color:vc??T1,fontFamily:'var(--font-mono)',fontSize:10}}>{v}</span>
    </div>
  )
  const qbtn=(icon:React.ReactNode,lbl:string,fn:()=>void,disabled?:boolean,color?:string)=>(
    <button type="button" onClick={fn} disabled={disabled}
      style={{display:'flex',alignItems:'center',gap:7,padding:'8px 11px',borderRadius:3,
        background:S2,border:`1px solid ${LN}`,fontFamily:'var(--font-mono)',fontSize:9,
        color:disabled?T3:(color??T2),cursor:disabled?'not-allowed':'pointer',marginBottom:4,
        letterSpacing:'.06em',textTransform:'uppercase',width:'100%',
        opacity:disabled?.5:1,transition:'all .13s'}}>
      {icon}<span style={{flex:1,textAlign:'left'}}>{lbl}</span>
      <span style={{color:T3,fontSize:10}}>↗</span>
    </button>
  )

  const STATUS_OPTIONS:Status[] = ['open','investigating','escalated','resolved','closed']

  return (
    <div style={{background:BG,borderTop:`1px solid ${LN2}`,display:'grid',gridTemplateColumns:'1fr 1fr 1fr'}}>
      <div style={col}>
        {hdr(r.kind==='incident'?'Case Intel':'Alert Intel')}
        {row(r.kind==='incident'?'Case ID':'Alert ID',r.id.slice(0,8)+'…')}
        {r.kind==='alert' && row('Vehicle',r.vehicle_reg??'—')}
        {r.kind==='alert' && row('Convoy',r.convoy_name??'—')}
        {r.kind==='alert' && row('Location',loc)}
        {r.kind==='incident' && row('Source Alert',r.source_alert_id?r.source_alert_id.slice(0,8)+'…':'—')}
        {row('Type',r.type.toUpperCase())}
        {row('Age',ago(r.created_at),s.c)}
      </div>
      <div style={col}>
        {hdr(r.kind==='incident'?'Case Details':'Trigger Data')}
        {row('Detail',(r.detail||'No detail').slice(0,80))}
        {row('Severity',s.lbl,s.c)}
        {r.kind==='alert' ? (
          <>
            {row('Status',STATUS_META[r.status].lbl.replace(/^[●◐▲✓]\s*/,''),STATUS_META[r.status].c)}
            {row('Triggered at',fmtT(r.created_at))}
            {row('Acknowledged',fmtT(r.acknowledged_at))}
            {row('Resolved',fmtT(r.resolved_at))}
          </>
        ) : (
          <>
            <div style={{padding:'8px 0 4px'}}>
              <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,marginBottom:6,textTransform:'uppercase'}}>Status</div>
              <select value={r.status} disabled={statusBusy} onChange={e=>onStatusChange(e.target.value as Status)}
                style={{width:'100%',background:S2,border:`1px solid ${LN2}`,borderRadius:3,padding:'6px 9px',
                  fontFamily:'var(--font-mono)',fontSize:10,color:STATUS_META[r.status].c,outline:'none',cursor:'pointer'}}>
                {STATUS_OPTIONS.map(st=>(<option key={st} value={st}>{st.toUpperCase()}</option>))}
              </select>
            </div>
            {row('Created',fmtT(r.created_at))}
          </>
        )}
      </div>
      <div style={{padding:'16px 20px'}}>
        {r.kind==='alert' ? (
          <>
            {hdr('Quick Actions')}
            {r.status==='open'   && qbtn(<IconCheck size={12}/>,ackBusy?'Acknowledging…':'Acknowledge Alert',onAck,ackBusy,s.c)}
            {r.status==='acknowledged' && qbtn(<IconCheck size={12}/>,resBusy?'Resolving…':'Mark as Resolved',onRes,resBusy,GR)}
            {r.status==='resolved' && (
              <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:GR,padding:'8px 11px',marginBottom:4,
                background:'rgba(0,232,122,.07)',border:`1px solid rgba(0,232,122,.2)`,borderRadius:3,
                letterSpacing:'.06em',textAlign:'center'}}>✓ RESOLVED</div>
            )}
            {!r.source_alert_id && qbtn(<IconArrowUpRight size={12}/>,promoteBusy?'Promoting…':'Promote to Incident',onPromote,promoteBusy,PU)}
            {r.vehicle_reg && qbtn(<IconMapPin size={12}/>,`Track ${r.vehicle_reg}`,()=>void navigate({to:'/gps'}))}
            {r.convoy_name && qbtn(<IconRoute size={12}/>,`Convoy: ${r.convoy_name}`,()=>void navigate({to:'/convoys'}))}
          </>
        ) : (
          <CaseFileEditor r={r} onSave={onCaseSave} busy={caseBusy}/>
        )}
      </div>
    </div>
  )
}

// ── FeedCard ──────────────────────────────────────────────────────────────────

function FeedCard({r,open,onToggle,onAck,onRes,onPromote,onStatusChange,onCaseSave,ackBusy,resBusy,promoteBusy,statusBusy,caseBusy}:{
  r:FeedRow; open:boolean; onToggle:()=>void
  onAck:()=>void; onRes:()=>void; onPromote:()=>void
  onStatusChange:(status:Status)=>void
  onCaseSave:(patch:{assigned_to?:string;notes?:string})=>void
  ackBusy:boolean; resBusy:boolean; promoteBusy:boolean; statusBusy:boolean; caseBusy:boolean
}) {
  const s=gs(r.severity)
  const st=STATUS_META[r.status]
  return (
    <div style={{border:`1px solid ${open?s.c:LN}`,background:open?S2:S1,
      transition:'all .15s',position:'relative',overflow:'hidden',marginBottom:2}}>
      <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:s.c}}/>
      <div style={{display:'grid',gridTemplateColumns:'80px 130px 110px 1fr 150px 190px 100px',
        alignItems:'center',padding:'13px 18px 13px 22px',gap:14,cursor:'pointer'}}
        onClick={onToggle}>
        <div><KindBadge kind={r.kind}/></div>
        <div><SevBadge sev={r.severity}/></div>
        <span style={{display:'inline-flex',alignItems:'center',gap:5,fontFamily:'var(--font-mono)',
          fontSize:9,letterSpacing:'.1em',color:T2,background:S3,border:`1px solid ${LN2}`,
          padding:'3px 9px',borderRadius:2,textTransform:'uppercase',whiteSpace:'nowrap'}}>
          {typeIcon(r.type)}{r.type.toUpperCase().slice(0,14)}
        </span>
        <div style={{minWidth:0}}>
          <div style={{fontSize:14,fontWeight:600,color:T1,overflow:'hidden',
            textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title}</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:2,
            letterSpacing:'.04em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {[r.vehicle_reg,r.convoy_name,r.assigned_to?`@${r.assigned_to}`:null,r.detail].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div onClick={e=>e.stopPropagation()}>
          <span style={{padding:'4px 10px',borderRadius:100,border:`1px solid ${st.c}55`,
            background:`${st.c}18`,color:st.c,fontFamily:'var(--font-mono)',fontSize:9,
            letterSpacing:'.08em',textTransform:'uppercase',cursor:'default',whiteSpace:'nowrap'}}>
            {st.lbl}
          </span>
        </div>
        <div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:T2,letterSpacing:'.04em'}}>{fmtT(r.created_at)}</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:2}}>{ago(r.created_at)}</div>
        </div>
        <div style={{display:'flex',gap:4,justifyContent:'flex-end',alignItems:'center'}}
          onClick={e=>e.stopPropagation()}>
          {r.kind==='alert' && r.status==='open' && (
            <button type="button" onClick={onAck} disabled={ackBusy} title="Acknowledge"
              style={{width:28,height:28,borderRadius:3,background:S3,border:`1px solid ${LN}`,
                display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:T3}}>
              {ackBusy?<IconLoader2 size={12} className="animate-spin"/>:<IconCheck size={12}/>}
            </button>
          )}
          <button type="button" onClick={onToggle}
            style={{width:28,height:28,borderRadius:3,background:S3,border:`1px solid ${LN}`,
              display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:T3}}>
            <IconChevronDown size={12} style={{transform:open?'rotate(180deg)':'none',transition:'transform .2s'}}/>
          </button>
        </div>
      </div>
      {open && <ExpandPanel r={r} onAck={onAck} onRes={onRes} onPromote={onPromote}
        onStatusChange={onStatusChange} onCaseSave={onCaseSave}
        ackBusy={ackBusy} resBusy={resBusy} promoteBusy={promoteBusy} statusBusy={statusBusy} caseBusy={caseBusy}/>}
    </div>
  )
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

function KpiCard({label,val,color,sub,pct,onClick}:{label:string;val:number;color:string;sub:string;pct:number;onClick:()=>void}) {
  return (
    <button type="button" onClick={onClick}
      style={{padding:'16px 20px 14px',borderRight:`1px solid ${LN}`,position:'relative',
        overflow:'hidden',cursor:'pointer',background:S1,border:'none',textAlign:'left',flex:1,
        transition:'background .13s'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:color}}/>
      <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',textTransform:'uppercase',color:T3,marginBottom:8}}>{label}</div>
      <div style={{fontSize:36,fontWeight:700,letterSpacing:'.02em',lineHeight:1,color}}>{val}</div>
      <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:5}}>{sub}</div>
      <div style={{height:2,background:S4,marginTop:10}}>
        <div style={{height:'100%',background:color,width:`${Math.min(100,pct)}%`,transition:'width .5s'}}/>
      </div>
    </button>
  )
}

// ── Create Incident Modal ────────────────────────────────────────────────────

function CreateIncidentModal({onClose,onCreate,busy,error}:{
  onClose:()=>void; onCreate:(payload:{title:string;description:string;severity:string})=>void
  busy:boolean; error:boolean
}) {
  const [title,setTitle]=useState('')
  const [description,setDescription]=useState('')
  const [severity,setSeverity]=useState('medium')
  const inputStyle:React.CSSProperties={width:'100%',background:S2,border:`1px solid ${LN2}`,borderRadius:4,
    padding:'9px 11px',fontFamily:'var(--font-mono)',fontSize:11,color:T1,outline:'none',marginBottom:12}
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={onClose}>
      <div style={{background:S1,border:`1px solid ${LN2}`,borderRadius:6,padding:22,width:420,maxWidth:'90vw'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700,color:T1}}>New Incident</div>
          <button type="button" onClick={onClose} style={{background:'none',border:'none',color:T3,cursor:'pointer'}}><IconX size={16}/></button>
        </div>
        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,marginBottom:6,textTransform:'uppercase'}}>Title</div>
        <input style={inputStyle} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Brief incident title"/>
        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,marginBottom:6,textTransform:'uppercase'}}>Description</div>
        <textarea style={{...inputStyle,resize:'vertical'}} rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What happened…"/>
        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,marginBottom:6,textTransform:'uppercase'}}>Severity</div>
        <select style={{...inputStyle,cursor:'pointer'}} value={severity} onChange={e=>setSeverity(e.target.value)}>
          <option value="low">Low</option><option value="medium">Medium</option>
          <option value="high">High</option><option value="critical">Critical</option>
        </select>
        {error && <div style={{color:RE,fontFamily:'var(--font-mono)',fontSize:10,marginBottom:10}}>Failed to create incident.</div>}
        <button type="button" disabled={busy||!title.trim()} onClick={()=>onCreate({title:title.trim(),description,severity})}
          style={{width:'100%',padding:'10px',borderRadius:4,background:title.trim()?PU:S3,
            border:`1px solid ${title.trim()?PU:LN}`,color:title.trim()?'#fff':T3,fontFamily:'var(--font-mono)',
            fontSize:11,letterSpacing:'.08em',textTransform:'uppercase',cursor:title.trim()&&!busy?'pointer':'default'}}>
          {busy?'Creating…':'Create Incident'}
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Alerts() {
  const user=useAuthStore(s=>s.user); const orgId=user?.org_id??''; const qc=useQueryClient()
  const [kindFilter,setKindFilter]=useState<KindFilter>('all')
  const [sevFilter,setSevFilter]=useState('all')
  const [staFilter,setStaFilter]=useState('all') // all | open | resolved
  const [search,setSearch]=useState('')
  const [sort,setSort]=useState<SortMode>('sev')
  const [expanded,setExpanded]=useState<Set<string>>(new Set())
  const [bannerDismissed,setBannerDismissed]=useState(false)
  const [clock,setClock]=useState('')
  const [showCreate,setShowCreate]=useState(false)

  const alertsQ=useQuery({
    queryKey:['alerts'],
    queryFn:async()=>{ const r=await api.get('/alerts',{params:{limit:200}}); return normalizeList<AlertApiRow>(r.data) },
    enabled:!!orgId, placeholderData:(prev)=>prev,
  })
  const incidentsQ=useQuery({
    queryKey:['incidents'],
    queryFn:async()=>{ const r=await api.get('/incidents',{params:{limit:200}}); return normalizeList<IncidentApiRow>(r.data) },
    enabled:!!orgId, placeholderData:(prev)=>prev,
  })
  const isLoading = alertsQ.isLoading || incidentsQ.isLoading
  const isError = alertsQ.isError || incidentsQ.isError

  useEffect(()=>{
    if(!orgId) return
    return subscribe<{type:string}>(`org#${orgId}`,e=>{
      if(e.type==='alert.new') void qc.invalidateQueries({queryKey:['alerts']})
      if(e.type==='incident.new'||e.type==='incident.updated') void qc.invalidateQueries({queryKey:['incidents']})
    })
  },[orgId,qc])

  useEffect(()=>{
    const tick=()=>{
      const eat=new Date(Date.now()+3*3600000)
      setClock([eat.getUTCHours(),eat.getUTCMinutes(),eat.getUTCSeconds()].map(x=>String(x).padStart(2,'0')).join(':')+' EAT')
    }
    tick(); const id=setInterval(tick,1000); return ()=>clearInterval(id)
  },[])

  const invalidateBoth=()=>{ void qc.invalidateQueries({queryKey:['alerts']}); void qc.invalidateQueries({queryKey:['incidents']}) }

  const ackMut=useMutation({ mutationFn:(id:string)=>api.patch(`/alerts/${id}/acknowledge`), onSuccess:()=>void qc.invalidateQueries({queryKey:['alerts']}) })
  const resMut=useMutation({ mutationFn:(id:string)=>api.patch(`/alerts/${id}/resolve`),     onSuccess:()=>void qc.invalidateQueries({queryKey:['alerts']}) })
  const promoteMut=useMutation({ mutationFn:(id:string)=>api.post(`/alerts/${id}/promote`),  onSuccess:invalidateBoth })
  const statusMut=useMutation({ mutationFn:({id,status}:{id:string;status:Status})=>api.patch(`/incidents/${id}`,{status}), onSuccess:()=>void qc.invalidateQueries({queryKey:['incidents']}) })
  const caseMut=useMutation({ mutationFn:({id,patch}:{id:string;patch:{assigned_to?:string;notes?:string}})=>api.patch(`/incidents/${id}`,patch), onSuccess:()=>void qc.invalidateQueries({queryKey:['incidents']}) })
  const createMut=useMutation({
    mutationFn:(payload:{title:string;description:string;severity:string})=>api.post('/incidents',payload),
    onSuccess:()=>{ void qc.invalidateQueries({queryKey:['incidents']}); setShowCreate(false) },
  })

  const all=useMemo<FeedRow[]>(()=>[
    ...(alertsQ.data?.data??[]).map(alertToRow),
    ...(incidentsQ.data?.data??[]).map(incidentToRow),
  ],[alertsQ.data,incidentsQ.data])

  const kpi=useMemo(()=>({
    total:   all.length,
    critical:all.filter(r=>r.severity==='critical').length,
    warning: all.filter(r=>['high','warning'].includes(r.severity)).length,
    incidents: all.filter(r=>r.kind==='incident').length,
    resolved:all.filter(r=>isClosedBucket(r.status)).length,
  }),[all])

  const criticalOpen=useMemo(()=>all.filter(r=>r.severity==='critical'&&!isClosedBucket(r.status)),[all])

  const rows=useMemo(()=>{
    let list=all.filter(r=>{
      if(kindFilter!=='all'&&r.kind!==kindFilter) return false
      if(sevFilter!=='all'&&r.severity!==sevFilter) return false
      if(staFilter==='open'&&isClosedBucket(r.status)) return false
      if(staFilter==='resolved'&&!isClosedBucket(r.status)) return false
      if(search){const q=search.toLowerCase();if(![r.title,r.type,r.vehicle_reg??'',r.convoy_name??'',r.assigned_to??''].join(' ').toLowerCase().includes(q))return false}
      return true
    })
    if(sort==='sev')  list.sort((a,b)=>gs(a.severity).ord-gs(b.severity).ord)
    if(sort==='time') list.sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
    if(sort==='type') list.sort((a,b)=>a.type.localeCompare(b.type))
    return list
  },[all,kindFilter,sevFilter,staFilter,search,sort])

  const toggle=useCallback((id:string)=>setExpanded(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n}),[])
  const ackAll=useCallback(async()=>{ for(const r of all.filter(x=>x.kind==='alert'&&x.status==='open'))await ackMut.mutateAsync(r.id).catch(()=>{}) },[all,ackMut])

  const pill=(id:string,lbl:string,active:boolean,fn:()=>void)=>(
    <button key={id} type="button" onClick={fn}
      style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'.1em',padding:'7px 13px',
        borderRadius:3,cursor:'pointer',textTransform:'uppercase' as const,border:`1px solid ${active?RE:LN}`,
        background:active?RE:'transparent',color:active?'#fff':T3,transition:'all .13s',
        fontWeight:active?700:400,whiteSpace:'nowrap'}}>
      {lbl}
    </button>
  )

  return (
    <div style={{background:BG,color:T1,minHeight:'100%',display:'flex',flexDirection:'column'}}>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}`}</style>
      {showCreate && (
        <CreateIncidentModal onClose={()=>setShowCreate(false)} busy={createMut.isPending} error={createMut.isError}
          onCreate={p=>createMut.mutate(p)}/>
      )}

      {/* Header */}
      <div style={{padding:'22px 26px 0',borderBottom:`1px solid ${LN}`}}>
        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.22em',textTransform:'uppercase',
          color:T3,marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:14,height:1,background:RE}}/>Sonalit Fleet OS · Threat Intelligence
        </div>
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',paddingBottom:18,flexWrap:'wrap',gap:12}}>
          <div>
            <div style={{fontSize:48,letterSpacing:'.04em',lineHeight:.9,fontWeight:800}}>
              ALERTS<span style={{color:RE}}>.</span>
            </div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:6,letterSpacing:'.1em'}}>
              {kpi.critical} CRITICAL · {kpi.warning} WARNING · {kpi.incidents} OPEN CASES · REAL-TIME MONITORING
            </div>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button type="button" onClick={()=>setShowCreate(true)}
              style={{fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'.08em',padding:'9px 16px',
                borderRadius:4,cursor:'pointer',border:`1px solid rgba(168,85,247,.4)`,background:'rgba(168,85,247,.12)',
                color:PU,display:'flex',alignItems:'center',gap:6,textTransform:'uppercase'}}>
              <IconPlus size={13}/>New Incident
            </button>
            {([['ack','Ack All',()=>void ackAll()],['exp','Export',()=>exportCSV(rows)]] as const).map(([k,lbl,fn])=>(
              <button key={k} type="button" onClick={fn}
                style={{fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'.08em',padding:'9px 16px',
                  borderRadius:4,cursor:'pointer',border:`1px solid ${LN2}`,background:S3,
                  color:T2,display:'flex',alignItems:'center',gap:6,transition:'all .13s',
                  textTransform:'uppercase'}}>
                {k==='ack'?<IconCheck size={13}/>:<IconDownload size={13}/>}{lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{display:'flex',borderBottom:`1px solid ${LN}`,flexWrap:'wrap'}}>
        <KpiCard label="Total"     val={kpi.total} color={OR} sub="alerts + incidents" pct={100}                                   onClick={()=>{setKindFilter('all');setSevFilter('all');setStaFilter('all')}}/>
        <KpiCard label="Critical"  val={kpi.critical} color={RE} sub="immediate action" pct={kpi.total?Math.round(kpi.critical/kpi.total*100):0} onClick={()=>setSevFilter('critical')}/>
        <KpiCard label="Warning"   val={kpi.warning} color={AM} sub="review needed"    pct={kpi.total?Math.round(kpi.warning/kpi.total*100):0}  onClick={()=>setSevFilter('warning')}/>
        <KpiCard label="Cases"     val={kpi.incidents} color={PU} sub="curated incidents" pct={kpi.total?Math.round(kpi.incidents/kpi.total*100):0} onClick={()=>setKindFilter('incident')}/>
        <KpiCard label="Resolved"  val={kpi.resolved} color={GR} sub="cleared"          pct={kpi.total?Math.round(kpi.resolved/kpi.total*100):0} onClick={()=>setStaFilter('resolved')}/>
      </div>

      {/* Critical banner */}
      {!bannerDismissed&&criticalOpen.length>0&&(
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 26px',
          background:'rgba(255,32,64,.07)',borderBottom:`1px solid rgba(255,32,64,.18)`,
          fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'.06em'}}>
          <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(255,32,64,.12)',
            border:'1px solid rgba(255,32,64,.28)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <IconAlertTriangle size={12} color={RE}/>
          </div>
          <div style={{flex:1,color:'rgba(255,180,190,.9)'}}>
            <strong style={{color:'#FF6680'}}>{criticalOpen.length} CRITICAL ITEM{criticalOpen.length>1?'S':''}</strong>{' '}require immediate attention across active operations.
          </div>
          <button type="button" onClick={()=>setBannerDismissed(true)}
            style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,cursor:'pointer',
              padding:'4px 10px',border:`1px solid ${LN}`,borderRadius:3,background:'transparent',
              letterSpacing:'.08em',display:'flex',alignItems:'center',gap:5}}>
            <IconX size={10}/>DISMISS
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 26px',
        borderBottom:`1px solid ${LN}`,background:S1,flexWrap:'wrap'}}>
        <div style={{position:'relative',flex:1,minWidth:180,maxWidth:280}}>
          <IconSearch size={13} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:T3,pointerEvents:'none'}}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SEARCH…"
            style={{width:'100%',background:S2,border:`1px solid ${LN2}`,borderRadius:4,
              padding:'8px 10px 8px 30px',fontFamily:'var(--font-mono)',fontSize:10,color:T1,
              outline:'none',letterSpacing:'.06em',textTransform:'uppercase'}}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,textTransform:'uppercase'}}>Kind</div>
          <div style={{display:'flex',gap:2}}>
            {(['all','alert','incident'] as const).map((id,i)=>pill(id,['All','Alerts','Cases'][i]!,kindFilter===id,()=>setKindFilter(id)))}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,textTransform:'uppercase'}}>Severity</div>
          <div style={{display:'flex',gap:2}}>
            {(['all','critical','warning','info','low'] as const).map((id,i)=>pill(id,['All','Critical','Warning','Info','Low'][i]!,sevFilter===id,()=>setSevFilter(id)))}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.16em',color:T3,textTransform:'uppercase'}}>Status</div>
          <div style={{display:'flex',gap:2}}>
            {(['all','open','resolved'] as const).map((id,i)=>pill(id,['All','Open','Resolved'][i]!,staFilter===id,()=>setStaFilter(id)))}
          </div>
        </div>
        <select value={sort} onChange={e=>setSort(e.target.value as SortMode)}
          style={{background:S2,border:`1px solid ${LN2}`,borderRadius:4,padding:'7px 10px',
            fontFamily:'var(--font-mono)',fontSize:9,color:T2,outline:'none',cursor:'pointer',
            letterSpacing:'.08em',marginLeft:'auto'}}>
          <option value="sev">Sort: Severity</option>
          <option value="time">Sort: Time</option>
          <option value="type">Sort: Type</option>
        </select>
      </div>

      {/* Body */}
      <div style={{flex:1,padding:'16px 26px'}}>
        {isLoading&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:64,
            color:T3,gap:8,fontFamily:'var(--font-mono)',fontSize:10}}>
            <IconLoader2 size={16} className="animate-spin"/>LOADING FEED…
          </div>
        )}
        {isError&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:64,
            color:RE,fontFamily:'var(--font-mono)',fontSize:10}}>
            FAILED TO LOAD — CHECK NETWORK CONNECTION
          </div>
        )}
        {!isLoading&&!isError&&rows.length===0&&(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:64,gap:16,textAlign:'center'}}>
            <div style={{width:64,height:64,borderRadius:'50%',background:S3,border:`1px solid ${LN2}`,
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              <IconBell size={28} color={T3}/>
            </div>
            <div style={{fontSize:28,fontWeight:700,color:T3,letterSpacing:'.06em'}}>ALL CLEAR</div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:T3,letterSpacing:'.1em'}}>
              NOTHING MATCHES YOUR FILTERS
            </div>
          </div>
        )}
        {rows.map(r=>(
          <FeedCard key={`${r.kind}-${r.id}`} r={r} open={expanded.has(r.id)} onToggle={()=>toggle(r.id)}
            onAck={()=>ackMut.mutate(r.id)} onRes={()=>resMut.mutate(r.id)} onPromote={()=>promoteMut.mutate(r.id)}
            onStatusChange={(status)=>statusMut.mutate({id:r.id,status})}
            onCaseSave={(patch)=>caseMut.mutate({id:r.id,patch})}
            ackBusy={ackMut.isPending&&ackMut.variables===r.id}
            resBusy={resMut.isPending&&resMut.variables===r.id}
            promoteBusy={promoteMut.isPending&&promoteMut.variables===r.id}
            statusBusy={statusMut.isPending&&statusMut.variables?.id===r.id}
            caseBusy={caseMut.isPending&&caseMut.variables?.id===r.id}/>
        ))}
      </div>

      {/* Footer */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 26px',
        borderTop:`1px solid ${LN}`,background:S1,flexWrap:'wrap',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:14,fontFamily:'var(--font-mono)',fontSize:9,color:T3,letterSpacing:'.08em'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',
            borderRadius:3,background:S2,border:`1px solid ${LN}`}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:RE,animation:'blink 1s ease-in-out infinite'}}/>
            LIVE FEED
          </div>
          <span>Showing <strong style={{color:T2}}>{rows.length}</strong> item{rows.length!==1?'s':''}</span>
          <span>{clock}</span>
        </div>
      </div>
    </div>
  )
}
