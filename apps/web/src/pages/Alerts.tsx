import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  IconBell, IconGauge, IconMapPinOff, IconAlertTriangle, IconDroplet, IconTool,
  IconWifi, IconShield, IconCheck, IconDownload, IconLoader2,
  IconMapPin, IconRoute, IconSearch, IconChevronDown, IconX,
} from '@tabler/icons-react'
import { api } from '../lib/api.js'
import { subscribe } from '../lib/centrifuge.js'
import { useAuthStore } from '../stores/auth.js'
import { normalizeList } from '../lib/normalize.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertRow {
  id: string; severity: string; type: string
  title?: string | null; message?: string | null; body?: string | null
  triggered_at?: string | null; created_at?: string | null
  acknowledged_at?: string | null; resolved_at?: string | null
  vehicle_reg?: string | null; convoy_name?: string | null
  lat?: number | null; lng?: number | null
}
type SortMode = 'sev' | 'time' | 'type'

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

const TYPE_ICONS:Record<string,React.ReactElement> = {
  speed:<IconGauge size={11}/>, geofence:<IconMapPinOff size={11}/>,
  'geofence.breach':<IconMapPinOff size={11}/>, panic:<IconAlertTriangle size={11}/>,
  'panic.triggered':<IconAlertTriangle size={11}/>, fuel:<IconDroplet size={11}/>,
  mechanical:<IconTool size={11}/>, communication:<IconWifi size={11}/>, security:<IconShield size={11}/>,
}
const typeIcon = (t:string) => TYPE_ICONS[t?.toLowerCase()] ?? <IconBell size={11}/>

// ── Helpers ───────────────────────────────────────────────────────────────────

const aStatus = (a:AlertRow) => a.resolved_at?'resolved':a.acknowledged_at?'acknowledged':'open'
const aTitle  = (a:AlertRow) => a.title ?? a.message ?? a.type ?? 'Alert'
const aTime   = (a:AlertRow) => a.triggered_at ?? a.created_at ?? ''
const fmtT    = (iso?:string|null) => { if(!iso) return '—'; try{return new Date(iso).toISOString().replace('T',' ').slice(0,16)+' UTC'}catch{return '—'} }
const ago     = (iso?:string|null) => {
  if(!iso) return '—'
  try {
    const d=Math.floor((Date.now()-new Date(iso).getTime())/60000)
    return d<1?'just now':d<60?`${d}m ago`:`${Math.floor(d/60)}h ${d%60}m ago`
  } catch { return '—' }
}

function exportCSV(rows:AlertRow[]) {
  const hdr='ID,Severity,Type,Title,Status,Vehicle,Convoy,Triggered'
  const body=rows.map(a=>[a.id,a.severity,a.type,aTitle(a).replace(/,/g,' '),aStatus(a),a.vehicle_reg??'',a.convoy_name??'',aTime(a)].join(','))
  const blob=new Blob([hdr+'\n'+body.join('\n')],{type:'text/csv'})
  const url=URL.createObjectURL(blob)
  const el=document.createElement('a');el.href=url;el.download='alerts.csv';el.click();URL.revokeObjectURL(url)
}

// ── SevBadge ──────────────────────────────────────────────────────────────────

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

// ── ExpandPanel ───────────────────────────────────────────────────────────────

function ExpandPanel({a,onAck,onRes,ackBusy,resBusy}:{
  a:AlertRow; onAck:()=>void; onRes:()=>void; ackBusy:boolean; resBusy:boolean
}) {
  const navigate = useNavigate()
  const s=gs(a.severity); const st=aStatus(a)
  const loc=a.lat&&a.lng?`${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`:'—'
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
  return (
    <div style={{background:BG,borderTop:`1px solid ${LN2}`,display:'grid',gridTemplateColumns:'1fr 1fr 1fr'}}>
      <div style={col}>
        {hdr('Alert Intel')}
        {row('Alert ID',a.id.slice(0,8)+'…')}
        {row('Vehicle',a.vehicle_reg??'—')}
        {row('Convoy',a.convoy_name??'—')}
        {row('Location',loc)}
        {row('Type',a.type.toUpperCase())}
        {row('Age',ago(aTime(a)),s.c)}
      </div>
      <div style={col}>
        {hdr('Trigger Data')}
        {row('Detail',(a.body??a.message??'No detail').slice(0,42))}
        {row('Severity',s.lbl,s.c)}
        {row('Status',st.toUpperCase(),st==='open'?RE:st==='acknowledged'?AM:GR)}
        {row('Triggered at',fmtT(aTime(a)))}
        {row('Acknowledged',fmtT(a.acknowledged_at))}
        {row('Resolved',fmtT(a.resolved_at))}
      </div>
      <div style={{padding:'16px 20px'}}>
        {hdr('Quick Actions')}
        {st==='open'   && qbtn(<IconCheck size={12}/>,ackBusy?'Acknowledging…':'Acknowledge Alert',onAck,ackBusy,s.c)}
        {st==='acknowledged' && qbtn(<IconCheck size={12}/>,resBusy?'Resolving…':'Mark as Resolved',onRes,resBusy,GR)}
        {st==='resolved' && (
          <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:GR,padding:'8px 11px',marginBottom:4,
            background:'rgba(0,232,122,.07)',border:`1px solid rgba(0,232,122,.2)`,borderRadius:3,
            letterSpacing:'.06em',textAlign:'center'}}>✓ RESOLVED</div>
        )}
        {a.vehicle_reg && qbtn(<IconMapPin size={12}/>,`Track ${a.vehicle_reg}`,()=>void navigate({to:'/gps'}))}
        {a.convoy_name && qbtn(<IconRoute size={12}/>,`Convoy: ${a.convoy_name}`,()=>void navigate({to:'/convoys'}))}
      </div>
    </div>
  )
}

// ── AlertCard ─────────────────────────────────────────────────────────────────

function AlertCard({a,open,onToggle,onAck,onRes,ackBusy,resBusy}:{
  a:AlertRow;open:boolean;onToggle:()=>void
  onAck:()=>void;onRes:()=>void;ackBusy:boolean;resBusy:boolean
}) {
  const s=gs(a.severity);const st=aStatus(a)
  const stColor=st==='open'?T3:st==='acknowledged'?AM:GR
  const stBorder=st==='open'?LN2:st==='acknowledged'?'rgba(255,179,0,.28)':'rgba(0,232,122,.28)'
  const stBg=st==='open'?S3:st==='acknowledged'?'rgba(255,179,0,.1)':'rgba(0,232,122,.1)'
  return (
    <div style={{border:`1px solid ${open?s.c:LN}`,background:open?S2:S1,
      transition:'all .15s',position:'relative',overflow:'hidden',marginBottom:2}}>
      <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:s.c}}/>
      <div style={{display:'grid',gridTemplateColumns:'130px 110px 1fr 140px 190px 100px',
        alignItems:'center',padding:'13px 18px 13px 22px',gap:14,cursor:'pointer'}}
        onClick={onToggle}>
        <div><SevBadge sev={a.severity}/></div>
        <span style={{display:'inline-flex',alignItems:'center',gap:5,fontFamily:'var(--font-mono)',
          fontSize:9,letterSpacing:'.1em',color:T2,background:S3,border:`1px solid ${LN2}`,
          padding:'3px 9px',borderRadius:2,textTransform:'uppercase',whiteSpace:'nowrap'}}>
          {typeIcon(a.type)}{a.type.toUpperCase().slice(0,14)}
        </span>
        <div style={{minWidth:0}}>
          <div style={{fontSize:14,fontWeight:600,color:T1,overflow:'hidden',
            textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{aTitle(a)}</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:2,
            letterSpacing:'.04em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {[a.vehicle_reg,a.convoy_name,a.body??a.message].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div onClick={e=>e.stopPropagation()}>
          <span style={{padding:'4px 10px',borderRadius:100,border:`1px solid ${stBorder}`,
            background:stBg,color:stColor,fontFamily:'var(--font-mono)',fontSize:9,
            letterSpacing:'.08em',textTransform:'uppercase',cursor:'default',whiteSpace:'nowrap'}}>
            {st==='open'?'● OPEN':st==='acknowledged'?'◐ ACK':'✓ RESOLVED'}
          </span>
        </div>
        <div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:T2,letterSpacing:'.04em'}}>{fmtT(aTime(a))}</div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:2}}>{ago(aTime(a))}</div>
        </div>
        <div style={{display:'flex',gap:4,justifyContent:'flex-end',alignItems:'center'}}
          onClick={e=>e.stopPropagation()}>
          {st==='open' && (
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
      {open && <ExpandPanel a={a} onAck={onAck} onRes={onRes} ackBusy={ackBusy} resBusy={resBusy}/>}
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Alerts() {
  const user=useAuthStore(s=>s.user); const orgId=user?.org_id??''; const qc=useQueryClient()
  const [sevFilter,setSevFilter]=useState('all')
  const [staFilter,setStaFilter]=useState('all')
  const [search,setSearch]=useState('')
  const [sort,setSort]=useState<SortMode>('sev')
  const [expanded,setExpanded]=useState<Set<string>>(new Set())
  const [bannerDismissed,setBannerDismissed]=useState(false)
  const [clock,setClock]=useState('')

  const {data,isLoading,isError}=useQuery({
    queryKey:['alerts'],
    queryFn:async()=>{ const r=await api.get('/alerts',{params:{limit:200}}); return normalizeList<AlertRow>(r.data) },
    enabled:!!orgId, placeholderData:(prev)=>prev,
  })

  useEffect(()=>{ if(!orgId)return; return subscribe<{type:string}>(`org#${orgId}`,e=>{ if(e.type==='alert.new')void qc.invalidateQueries({queryKey:['alerts']}) }) },[orgId,qc])

  useEffect(()=>{
    const tick=()=>{
      const eat=new Date(Date.now()+3*3600000)
      setClock([eat.getUTCHours(),eat.getUTCMinutes(),eat.getUTCSeconds()].map(x=>String(x).padStart(2,'0')).join(':')+' EAT')
    }
    tick(); const id=setInterval(tick,1000); return ()=>clearInterval(id)
  },[])

  const ackMut=useMutation({ mutationFn:(id:string)=>api.patch(`/alerts/${id}/acknowledge`), onSuccess:()=>void qc.invalidateQueries({queryKey:['alerts']}) })
  const resMut=useMutation({ mutationFn:(id:string)=>api.patch(`/alerts/${id}/resolve`),     onSuccess:()=>void qc.invalidateQueries({queryKey:['alerts']}) })

  const all=data?.data??[]

  const kpi=useMemo(()=>({
    total:   data?.total??all.length,
    critical:all.filter(a=>a.severity==='critical').length,
    warning: all.filter(a=>['high','warning'].includes(a.severity)).length,
    info:    all.filter(a=>['medium','info','low'].includes(a.severity)).length,
    resolved:all.filter(a=>!!a.resolved_at).length,
  }),[all,data])

  const criticalOpen=useMemo(()=>all.filter(a=>a.severity==='critical'&&aStatus(a)==='open'),[all])

  const rows=useMemo(()=>{
    let list=all.filter(a=>{
      if(sevFilter!=='all'&&a.severity!==sevFilter) return false
      if(staFilter!=='all'&&aStatus(a)!==staFilter) return false
      if(search){const q=search.toLowerCase();if(![aTitle(a),a.type,a.vehicle_reg??'',a.convoy_name??''].join(' ').toLowerCase().includes(q))return false}
      return true
    })
    if(sort==='sev')  list.sort((a,b)=>gs(a.severity).ord-gs(b.severity).ord)
    if(sort==='time') list.sort((a,b)=>new Date(aTime(b)).getTime()-new Date(aTime(a)).getTime())
    if(sort==='type') list.sort((a,b)=>a.type.localeCompare(b.type))
    return list
  },[all,sevFilter,staFilter,search,sort])

  const toggle=useCallback((id:string)=>setExpanded(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n}),[])
  const ackAll=useCallback(async()=>{ for(const a of all.filter(x=>aStatus(x)==='open'))await ackMut.mutateAsync(a.id).catch(()=>{}) },[all,ackMut])

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

      {/* Header */}
      <div style={{padding:'22px 26px 0',borderBottom:`1px solid ${LN}`}}>
        <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.22em',textTransform:'uppercase',
          color:T3,marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:14,height:1,background:RE}}/>Sonalit Fleet OS · Threat Intelligence
        </div>
        <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',paddingBottom:18}}>
          <div>
            <div style={{fontSize:48,letterSpacing:'.04em',lineHeight:.9,fontWeight:800}}>
              ALERT<span style={{color:RE}}>S.</span>
            </div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:9,color:T3,marginTop:6,letterSpacing:'.1em'}}>
              {kpi.critical} CRITICAL · {kpi.warning} WARNING · {kpi.info} INFO · REAL-TIME MONITORING
            </div>
          </div>
          <div style={{display:'flex',gap:6}}>
            {([['ack','Ack All',()=>void ackAll(),false],['exp','Export',()=>exportCSV(rows),false]] as const).map(([k,lbl,fn])=>(
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
      <div style={{display:'flex',borderBottom:`1px solid ${LN}`}}>
        <KpiCard label="Total Alerts" val={kpi.total} color={OR} sub="all severities"     pct={100}                                   onClick={()=>{setSevFilter('all');setStaFilter('all')}}/>
        <KpiCard label="Critical"     val={kpi.critical} color={RE} sub="immediate action" pct={kpi.total?Math.round(kpi.critical/kpi.total*100):0} onClick={()=>setSevFilter('critical')}/>
        <KpiCard label="Warning"      val={kpi.warning} color={AM} sub="review needed"    pct={kpi.total?Math.round(kpi.warning/kpi.total*100):0}  onClick={()=>setSevFilter('warning')}/>
        <KpiCard label="Info"         val={kpi.info}    color={CY} sub="monitor"           pct={kpi.total?Math.round(kpi.info/kpi.total*100):0}     onClick={()=>setSevFilter('info')}/>
        <KpiCard label="Resolved"     val={kpi.resolved} color={GR} sub="cleared"          pct={kpi.total?Math.round(kpi.resolved/kpi.total*100):0} onClick={()=>setStaFilter('resolved')}/>
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
            <strong style={{color:'#FF6680'}}>{criticalOpen.length} CRITICAL ALERT{criticalOpen.length>1?'S':''}</strong>{' '}require immediate attention across active operations.
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
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SEARCH ALERTS…"
            style={{width:'100%',background:S2,border:`1px solid ${LN2}`,borderRadius:4,
              padding:'8px 10px 8px 30px',fontFamily:'var(--font-mono)',fontSize:10,color:T1,
              outline:'none',letterSpacing:'.06em',textTransform:'uppercase'}}/>
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
            {(['all','open','acknowledged','resolved'] as const).map((id,i)=>pill(id,['All','Open','Acked','Resolved'][i]!,staFilter===id,()=>setStaFilter(id)))}
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
            <IconLoader2 size={16} className="animate-spin"/>LOADING ALERTS…
          </div>
        )}
        {isError&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:64,
            color:RE,fontFamily:'var(--font-mono)',fontSize:10}}>
            FAILED TO LOAD ALERTS — CHECK NETWORK CONNECTION
          </div>
        )}
        {!isLoading&&!isError&&rows.length===0&&(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:64,gap:16,textAlign:'center'}}>
            <div style={{width:64,height:64,borderRadius:'50%',background:S3,border:`1px solid ${LN2}`,
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              <IconBell size={28} color={T3}/>
            </div>
            <div style={{fontSize:28,fontWeight:700,color:T3,letterSpacing:'.06em'}}>NO ALERTS</div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:T3,letterSpacing:'.1em'}}>
              ALL CLEAR — NO ALERTS MATCH YOUR FILTERS
            </div>
          </div>
        )}
        {rows.map(a=>(
          <AlertCard key={a.id} a={a} open={expanded.has(a.id)} onToggle={()=>toggle(a.id)}
            onAck={()=>ackMut.mutate(a.id)} onRes={()=>resMut.mutate(a.id)}
            ackBusy={ackMut.isPending&&ackMut.variables===a.id}
            resBusy={resMut.isPending&&resMut.variables===a.id}/>
        ))}
      </div>

      {/* Footer */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 26px',
        borderTop:`1px solid ${LN}`,background:S1}}>
        <div style={{display:'flex',alignItems:'center',gap:14,fontFamily:'var(--font-mono)',fontSize:9,color:T3,letterSpacing:'.08em'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',
            borderRadius:3,background:S2,border:`1px solid ${LN}`}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:RE,animation:'blink 1s ease-in-out infinite'}}/>
            LIVE FEED
          </div>
          <span>Showing <strong style={{color:T2}}>{rows.length}</strong> alert{rows.length!==1?'s':''}</span>
          <span>{clock}</span>
        </div>
        <div style={{display:'flex',gap:6,fontFamily:'var(--font-mono)',fontSize:9,color:T3}}>
          {['Alert Rules','History'].map(lbl=>(
            <div key={lbl} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',
              borderRadius:3,background:S2,border:`1px solid ${LN}`,cursor:'pointer',letterSpacing:'.06em'}}>{lbl}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
