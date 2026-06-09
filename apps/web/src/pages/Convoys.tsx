import { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../lib/api.js'
import { subscribe } from '../lib/centrifuge.js'
import { useAuthStore } from '../stores/auth.js'
import { normalizeList } from '../lib/normalize.js'
import type { ConvoyStatus } from '@sonalit/contracts'
import BroadcastPanel from '../components/BroadcastPanel.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConvoyRow {
  id: string; name: string; status: ConvoyStatus
  route_origin?: string | null; route_destination?: string | null
  departure_time?: string | null; estimated_arrival?: string | null
  start_date?: string | null; end_date?: string | null
  priority?: string | null; region?: string | null; description?: string | null
  vehicle_count?: number; created_by_name?: string | null
  timezone?: string | null
}
interface ConvoyDetail extends ConvoyRow {
  trucks?: Array<{ id: string; position: number; driver_name: string; driver_phone?: string | null }>
  vehicles?: Array<{ id: string; registration?: string | null; make?: string | null; model?: string | null }>
  cfos?: Array<{ id: string; cfo_name?: string; role?: string }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  HIGH: '#ef4444', HIGH_: '#ef4444', CRITICAL: '#ef4444',
  MED: '#f59e0b', MEDIUM: '#f59e0b',
  LOW: '#22c55e', '—': '#4e5a65',
}
const riskColor = (p?: string | null) => RISK_COLOR[p?.toUpperCase() ?? ''] ?? '#4e5a65'

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  active:    { bg: 'rgba(0,230,118,.08)', color: '#00e676', border: 'rgba(0,230,118,.2)' },
  completed: { bg: 'rgba(0,212,255,.08)', color: '#00d4ff', border: 'rgba(0,212,255,.2)' },
  planned:   { bg: 'rgba(249,115,22,.08)', color: '#f97316', border: 'rgba(249,115,22,.2)' },
  draft:     { bg: 'rgba(255,255,255,.04)', color: '#8a95a0', border: 'rgba(255,255,255,.1)' },
  cancelled: { bg: 'rgba(239,68,68,.08)', color: '#ef4444', border: 'rgba(239,68,68,.2)' },
  delayed:   { bg: 'rgba(245,158,11,.08)', color: '#f59e0b', border: 'rgba(245,158,11,.2)' },
}
const statusStyle = (s: string) => STATUS_STYLE[s] ?? STATUS_STYLE['draft']!

function convoyProgress(c: ConvoyRow): number {
  if (c.status === 'completed') return 100
  if (c.status === 'cancelled' || c.status === 'draft') return 0
  const start = c.departure_time ? new Date(c.departure_time).getTime() : c.start_date ? new Date(c.start_date).getTime() : null
  const end   = c.estimated_arrival ? new Date(c.estimated_arrival).getTime() : c.end_date ? new Date(c.end_date).getTime() : null
  if (!start || !end || end <= start) return c.status === 'active' ? 50 : 0
  const now = Date.now()
  return Math.min(99, Math.max(1, Math.round(((now - start) / (end - start)) * 100)))
}

const fmtDate = (d?: string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}
const fmtTime = (d?: string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })
}

const MN = 'IBM Plex Mono, monospace'
const SANS = 'Archivo, system-ui, sans-serif'

// ─── Sub-components ───────────────────────────────────────────────────────────

function SBadge({ status }: { status: string }) {
  const ss = statusStyle(status)
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:8,
      letterSpacing:'.1em', padding:'3px 8px', borderRadius:2, whiteSpace:'nowrap',
      background:ss.bg, color:ss.color, border:`1px solid ${ss.border}` }}>
      {(status === 'active') && <span style={{ width:5, height:5, borderRadius:'50%', background:ss.color, animation:'cnv-pulse 1.2s ease-in-out infinite' }} />}
      {status.toUpperCase()}
    </span>
  )
}

function ProgressBar({ pct, status }: { pct: number; status: string }) {
  const ss = statusStyle(status)
  return (
    <div style={{ minWidth:100 }}>
      <div style={{ height:2, background:'rgba(255,255,255,.08)', borderRadius:1, marginBottom:3 }}>
        <div style={{ height:'100%', width:`${pct}%`, background:ss.color, borderRadius:1, transition:'width .6s' }} />
      </div>
      <span style={{ fontFamily:MN, fontSize:8, color:'#4e5a65' }}>{pct}%</span>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ id, onClose, onBroadcast }: { id: string; onClose: () => void; onBroadcast: () => void }) {
  const { data: raw } = useQuery<ConvoyDetail>({
    queryKey: ['convoy-detail', id],
    queryFn: async () => { const r = await api.get(`/convoys/${id}`); return r.data.data ?? r.data },
    staleTime: 30_000,
  })
  const c = raw

  const pct = c ? convoyProgress(c) : 0
  const origin = c?.route_origin ?? c?.region ?? '—'
  const dest   = c?.route_destination ?? '—'

  // bezier truck dot
  const t = pct / 100
  const bx = (1-t)*(1-t)*30 + 2*(1-t)*t*180 + t*t*330
  const by = (1-t)*(1-t)*100 + 2*(1-t)*t*65 + t*t*30

  const stages = ['DISPATCH', 'EN ROUTE', 'CHECKPOINT', 'DELIVERY']
  const stageIdx = !c ? -1 : c.status === 'completed' ? 4 : c.status === 'planned' || c.status === 'draft' ? 0 : Math.max(1, Math.floor(pct / 34))

  return (
    <div style={{ position:'absolute', right:0, top:0, bottom:0, width:360, background:'#0d1014',
      borderLeft:'1px solid rgba(255,255,255,.08)', zIndex:30, display:'flex', flexDirection:'column',
      transform:'translateX(0)', overflowY:'auto' }}>
      {/* header */}
      <div style={{ background:'#111519', borderBottom:'1px solid rgba(255,255,255,.08)', padding:'16px 18px', position:'relative', flexShrink:0 }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg, #f97316, transparent)' }} />
        <div style={{ fontFamily:MN, fontSize:8, color:'#4e5a65', letterSpacing:'.18em', marginBottom:3 }}>{c?.id?.slice(0,8).toUpperCase() ?? '…'}</div>
        <div style={{ fontFamily:SANS, fontWeight:700, fontSize:22, color:'#dde3ea', lineHeight:1.1 }}>{c?.name ?? 'Loading…'}</div>
        <button onClick={onClose} style={{ position:'absolute', top:12, right:12, width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', background:'#1c2228', border:'1px solid rgba(255,255,255,.08)', borderRadius:2, cursor:'pointer', color:'#4e5a65', fontSize:14 }}>×</button>
      </div>

      {/* minimap */}
      <div style={{ background:'#111519', borderBottom:'1px solid rgba(255,255,255,.06)', position:'relative', height:130, overflow:'hidden', flexShrink:0 }}>
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px)', backgroundSize:'20px 20px' }} />
        <svg viewBox="0 0 360 130" style={{ width:'100%', height:'100%' }}>
          <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#22c55e"/><stop offset="100%" stopColor="#f97316"/></linearGradient></defs>
          <path d="M30 100 Q180 20 330 30" stroke="url(#rg)" strokeWidth="1.5" fill="none" strokeDasharray="6 4" opacity=".6"/>
          <circle cx="30" cy="100" r="4" fill="#22c55e"/>
          <circle cx="330" cy="30" r="4" fill="#f97316"/>
          <circle cx={bx} cy={by} r="6" fill="#f97316" opacity=".85"/>
          <circle cx={bx} cy={by} r="10" fill="none" stroke="#f97316" strokeWidth=".5" opacity=".4"/>
          <text x="36" y="114" fill="#4e5a65" fontSize="8" fontFamily="monospace">{origin.toUpperCase().slice(0,12)}</text>
          <text x="290" y="25" fill="#4e5a65" fontSize="8" fontFamily="monospace">{dest.toUpperCase().slice(0,12)}</text>
        </svg>
      </div>

      {/* timeline */}
      <div style={{ padding:'10px 18px', borderBottom:'1px solid rgba(255,255,255,.06)', display:'flex', gap:0, position:'relative', flexShrink:0 }}>
        <div style={{ position:'absolute', left:18, right:18, top:18, height:1, background:'rgba(255,255,255,.07)' }} />
        {stages.map((s, i) => {
          const cls = i < stageIdx ? 'done' : i === stageIdx ? 'cur' : 'todo'
          return (
            <div key={s} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, position:'relative' }}>
              <div style={{ width:10, height:10, borderRadius:'50%', zIndex:1, border:'2px solid #0d1014',
                background: cls==='done' ? '#22c55e' : cls==='cur' ? '#f97316' : '#1c2228',
                boxShadow: cls==='done' ? '0 0 6px #22c55e' : cls==='cur' ? '0 0 8px #f97316' : 'none' }} />
              <span style={{ fontFamily:MN, fontSize:7, color:'#4e5a65', letterSpacing:'.08em', textAlign:'center' }}>{s}</span>
            </div>
          )
        })}
      </div>

      {/* stats */}
      <div style={{ padding:'12px 18px', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
        {[
          ['Status', c ? <SBadge key="s" status={c.status} /> : '—'],
          ['Route', c ? `${origin} → ${dest}` : '—'],
          ['Progress', c ? `${pct}%` : '—'],
          ['Vehicles', c?.vehicle_count ?? (c?.trucks?.length ?? c?.vehicles?.length ?? '—')],
          ['Start', fmtTime(c?.departure_time ?? c?.start_date)],
          ['ETA', fmtTime(c?.estimated_arrival ?? c?.end_date)],
          ['Region', c?.region ?? '—'],
          ['Priority', c?.priority ?? '—'],
        ].map(([k, v]) => (
          <div key={String(k)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
            <span style={{ fontFamily:SANS, fontSize:11, color:'#4e5a65' }}>{k}</span>
            <span style={{ fontFamily:MN, fontSize:10, color:'#8a95a0', textAlign:'right' }}>{v as React.ReactNode}</span>
          </div>
        ))}
      </div>

      {/* trucks / vehicles */}
      {c && (c.trucks?.length || c.vehicles?.length) ? (
        <div style={{ padding:'12px 18px', flexShrink:0 }}>
          <div style={{ fontFamily:MN, fontSize:7, letterSpacing:'.22em', color:'#4e5a65', marginBottom:8 }}>VEHICLES</div>
          {(c.trucks ?? []).slice(0, 5).map(t => (
            <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <div style={{ width:28, height:28, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, display:'flex', alignItems:'center', justifyContent:'center', color:'#4e5a65', fontSize:13, flexShrink:0 }}>🚛</div>
              <div>
                <div style={{ fontFamily:SANS, fontSize:11, color:'#8a95a0' }}>{t.driver_name}</div>
                <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65' }}>Position {t.position}</div>
              </div>
              <span style={{ marginLeft:'auto', fontFamily:MN, fontSize:8, color:'#00e676' }}>ONLINE</span>
            </div>
          ))}
          {(c.vehicles ?? []).slice(0, c.trucks?.length ? 0 : 5).map(v => (
            <div key={v.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <div style={{ width:28, height:28, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, display:'flex', alignItems:'center', justifyContent:'center', color:'#4e5a65', fontSize:13, flexShrink:0 }}>🚛</div>
              <div>
                <div style={{ fontFamily:SANS, fontSize:11, color:'#8a95a0' }}>{v.registration ?? v.id.slice(0,8)}</div>
                <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65' }}>{v.make} {v.model}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* footer */}
      <div style={{ padding:'12px 18px', display:'flex', gap:8, borderTop:'1px solid rgba(255,255,255,.08)', flexShrink:0, background:'#0d1014', marginTop:'auto' }}>
        <Link to="/gps" style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.12em', padding:'7px 13px', borderRadius:3, border:'1px solid rgba(255,255,255,.1)', background:'transparent', color:'#8a95a0', cursor:'pointer', textDecoration:'none' }}>
          📍 TRACK LIVE
        </Link>
        {c?.status === 'active' && (
          <button onClick={onBroadcast} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.12em', padding:'7px 13px', borderRadius:3, border:'1px solid #f97316', background:'#f97316', color:'#000', fontWeight:700, cursor:'pointer' }}>
            📡 BROADCAST
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Filter = 'all' | 'active' | 'completed' | 'planned' | 'cancelled'

export default function Convoys() {
  const qc = useQueryClient()
  const orgId = useAuthStore(s => s.user?.org_id)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [broadcastConvoy, setBroadcastConvoy] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading, isError } = useQuery<{ data: ConvoyRow[]; pagination?: unknown }>({
    queryKey: ['convoys'],
    queryFn: async () => { const r = await api.get('/convoys?limit=100'); return normalizeList(r.data) },
    staleTime: 15_000, refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!orgId) return
    return subscribe<{ type?: string }>(`org#${orgId}`, ev => {
      if (ev.type === 'convoy.update') void qc.invalidateQueries({ queryKey: ['convoys'] })
    })
  }, [orgId, qc])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/convoys/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['convoys'] }),
  })

  const [dispatchingId, setDispatchingId] = useState<string | null>(null)
  const dispatchMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/convoys/${id}/status`, { status: 'active' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['convoys'] }),
    onSettled: () => setDispatchingId(null),
  })

  const rows = useMemo(() => {
    const all: ConvoyRow[] = data?.data ?? []
    return all.filter(c => {
      const mf = filter === 'all' || c.status === filter
      const ms = !search || (c.name + (c.route_origin ?? '') + (c.route_destination ?? '') + (c.region ?? '')).toLowerCase().includes(search.toLowerCase())
      return mf && ms
    })
  }, [data, filter, search])

  const counts = useMemo(() => {
    const all: ConvoyRow[] = data?.data ?? []
    return {
      total: all.length,
      active: all.filter(c => c.status === 'active').length,
      completed: all.filter(c => c.status === 'completed').length,
      planned: all.filter(c => c.status === 'planned' || c.status === 'draft').length,
      cancelled: all.filter(c => c.status === 'cancelled').length,
    }
  }, [data])

  const selConvoy = useMemo(() => selId ? (data?.data ?? []).find(c => c.id === selId) : null, [selId, data])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', position:'relative', overflow:'hidden' }}>
      <style>{`
        @keyframes cnv-pulse{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes cnv-row-in{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:none}}
        .cnv-tr{animation:cnv-row-in .18s ease both}
        .cnv-tr:hover{background:rgba(249,115,22,.04)!important}
        .cnv-tr:hover .cnv-left-border{width:3px!important}
        .cnv-tr.sel-row{background:rgba(249,115,22,.07)!important}
        .cnv-tr.sel-row .cnv-left-border{width:3px!important;background:#f97316!important}
        .cnv-icobtn:hover{border-color:#f97316!important;color:#f97316!important}
        .cnv-tab.on{background:#f97316;color:#000;font-weight:700}
        .cnv-tab:not(.on):hover{color:#dde3ea}
      `}</style>

      {/* ── Page Header ── */}
      <div style={{ background:'linear-gradient(180deg,#111519 0%,#0d1014 100%)', borderBottom:'1px solid rgba(255,255,255,.08)', padding:'16px 24px 0', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
          <div>
            <div style={{ fontFamily:MN, fontSize:8, letterSpacing:'.22em', color:'#f97316', marginBottom:4, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ display:'inline-block', width:3, height:14, background:'#f97316', borderRadius:1 }} />
              FLEET OS · CONVOY MANAGEMENT
            </div>
            <div style={{ fontFamily:SANS, fontWeight:700, fontSize:42, lineHeight:.9, letterSpacing:'.04em', color:'#dde3ea' }}>
              CONVOY<span style={{ color:'#f97316' }}>S.</span>
            </div>
            <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65', letterSpacing:'.12em', marginTop:6 }}>
              {counts.total} TOTAL · {counts.active} ACTIVE · {counts.completed} COMPLETED
            </div>
          </div>
          <div style={{ display:'flex', gap:8, paddingTop:6 }}>
            <Link to="/convoys/new" style={{ display:'flex', alignItems:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.12em', padding:'7px 13px', borderRadius:3, background:'#f97316', border:'1px solid #f97316', color:'#000', fontWeight:700, cursor:'pointer', textDecoration:'none' }}>
              + NEW CONVOY
            </Link>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, background:'rgba(255,255,255,.06)', borderTop:'1px solid rgba(255,255,255,.06)' }}>
          {([
            { label:'TOTAL CONVOYS', val:counts.total, color:'#f97316', filter:'all' },
            { label:'ACTIVE NOW',    val:counts.active, color:'#00e676', filter:'active' },
            { label:'COMPLETED',     val:counts.completed, color:'#00d4ff', filter:'completed' },
            { label:'PLANNED',       val:counts.planned, color:'#f59e0b', filter:'planned' },
          ] as const).map(sc => (
            <div key={sc.label} onClick={() => setFilter(sc.filter as Filter)} style={{ background:'#0d1014', padding:'12px 18px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background='#111519')} onMouseLeave={e => (e.currentTarget.style.background='#0d1014')}>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${sc.color},transparent)` }} />
              <div style={{ fontFamily:MN, fontSize:7, letterSpacing:'.2em', color:'#4e5a65', marginBottom:4 }}>{sc.label}</div>
              <div style={{ fontFamily:SANS, fontWeight:700, fontSize:36, lineHeight:1, color:sc.color }}>{sc.val}</div>
              <div style={{ height:2, background:'rgba(255,255,255,.06)', borderRadius:1, marginTop:10 }}>
                <div style={{ height:'100%', width:`${counts.total ? Math.round((sc.val/counts.total)*100) : 0}%`, background:sc.color, borderRadius:1, transition:'width .8s cubic-bezier(.4,0,.2,1)' }} />
              </div>
              <div style={{ position:'absolute', bottom:4, right:8, fontFamily:SANS, fontSize:44, fontWeight:700, opacity:.04, lineHeight:1 }}>{sc.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 24px', background:'#0d1014', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
        <div style={{ position:'relative', flex:1, maxWidth:300 }}>
          <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'#4e5a65', pointerEvents:'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search convoys, routes, regions…"
            style={{ width:'100%', background:'#111519', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, fontFamily:SANS, fontSize:12, color:'#dde3ea', padding:'6px 10px 6px 28px', outline:'none' }}
            onFocus={e => (e.target.style.borderColor='#f97316')} onBlur={e => (e.target.style.borderColor='rgba(255,255,255,.08)')} />
        </div>
        <div style={{ display:'flex', gap:2, background:'#111519', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, padding:2 }}>
          {(['all','active','completed','planned','cancelled'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`cnv-tab${filter===f?' on':''}`}
              style={{ fontFamily:MN, fontSize:8, letterSpacing:'.12em', padding:'4px 10px', borderRadius:2, cursor:'pointer', border:'none', background:'none', color:'#4e5a65', transition:'all .12s' }}>
              {f === 'planned' ? 'PLANNED' : f.toUpperCase()}
            </button>
          ))}
        </div>
        <span style={{ fontFamily:MN, fontSize:9, color:'#4e5a65', marginLeft:'auto', whiteSpace:'nowrap' }}>{rows.length} convoy{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Table + Panel ── */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', display:'flex' }}>
        <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:'rgba(255,255,255,.08) transparent' }}>
          {isLoading && <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, fontFamily:MN, fontSize:10, color:'#4e5a65', letterSpacing:'.1em' }}>LOADING…</div>}
          {isError && <div style={{ textAlign:'center', padding:32, fontFamily:MN, fontSize:10, color:'#ef4444' }}>FAILED TO LOAD CONVOYS</div>}
          {!isLoading && !isError && (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['CONVOY ID / NAME','STATUS','ROUTE','PROGRESS','RISK','VEHICLES','START DATE','ETA',''].map((h, i) => (
                    <th key={i} style={{ fontFamily:MN, fontSize:7, letterSpacing:'.2em', color:'#4e5a65', padding:'8px 14px', textAlign:'left', background:'#0d1014', borderBottom:'1px solid rgba(255,255,255,.08)', position:'sticky', top:0, zIndex:2, whiteSpace:'nowrap', paddingLeft: i===0?24:14 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={9} style={{ padding:'60px 24px', textAlign:'center', fontFamily:MN, fontSize:10, color:'#4e5a65', letterSpacing:'.1em' }}>NO CONVOYS MATCH YOUR SEARCH</td></tr>
                )}
                {rows.map((c, idx) => {
                  const pct = convoyProgress(c)
                  const origin = c.route_origin ?? c.region ?? '—'
                  const dest = c.route_destination ?? '—'
                  const risk = c.priority ?? '—'
                  const isSel = c.id === selId
                  return (
                    <tr key={c.id} onClick={() => setSelId(isSel ? null : c.id)} className={`cnv-tr${isSel ? ' sel-row' : ''}`}
                      style={{ borderBottom:'1px solid rgba(255,255,255,.04)', cursor:'pointer', position:'relative', animationDelay:`${idx * 20}ms` }}>
                      <div className="cnv-left-border" style={{ position:'absolute', left:0, top:0, bottom:0, width:0, background:'rgba(249,115,22,.5)', transition:'width .15s' }} />
                      <td style={{ padding:'11px 14px', paddingLeft:24 }}>
                        <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65', marginBottom:1 }}>{c.id.slice(0,8).toUpperCase()}</div>
                        <div style={{ fontFamily:SANS, fontWeight:500, fontSize:13, color:'#dde3ea' }}>{c.name}</div>
                      </td>
                      <td style={{ padding:'11px 14px' }}><SBadge status={c.status} /></td>
                      <td style={{ padding:'11px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:4, fontFamily:SANS, fontSize:11, color:'#8a95a0' }}>
                          <span>{origin}</span><span style={{ color:'#f97316', fontSize:10 }}>→</span><span>{dest}</span>
                        </div>
                      </td>
                      <td style={{ padding:'11px 14px' }}><ProgressBar pct={pct} status={c.status} /></td>
                      <td style={{ padding:'11px 14px' }}>
                        <span style={{ fontFamily:MN, fontSize:9, fontWeight:700, letterSpacing:'.08em', color:riskColor(risk) }}>{risk.toUpperCase()}</span>
                      </td>
                      <td style={{ padding:'11px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:11, color:'#8a95a0' }}>
                          <span style={{ fontSize:11, color:'#4e5a65' }}>🚛</span>{c.vehicle_count ?? '—'}
                        </div>
                      </td>
                      <td style={{ padding:'11px 14px', fontFamily:MN, fontSize:10, color:'#8a95a0' }}>{fmtDate(c.departure_time ?? c.start_date)}</td>
                      <td style={{ padding:'11px 14px', fontFamily:MN, fontSize:10, color:'#8a95a0' }}>{fmtTime(c.estimated_arrival ?? c.end_date)}</td>
                      <td style={{ padding:'11px 14px 11px 0' }}>
                        <div style={{ display:'flex', gap:4, alignItems:'center' }} onClick={e => e.stopPropagation()}>
                          {c.status === 'planned' && (
                            <button
                              onClick={() => { if (window.confirm(`Dispatch "${c.name}"? This will mark it active.`)) { setDispatchingId(c.id); dispatchMutation.mutate(c.id) } }}
                              disabled={dispatchingId === c.id}
                              style={{ height:24, padding:'0 8px', display:'flex', alignItems:'center', gap:4, borderRadius:2, background:'#f97316', border:'1px solid #f97316', cursor:'pointer', color:'#000', fontFamily:MN, fontSize:8, fontWeight:700, letterSpacing:'.1em', opacity: dispatchingId === c.id ? 0.5 : 1 }}>
                              ⚡ {dispatchingId === c.id ? '…' : 'DISPATCH'}
                            </button>
                          )}
                          <Link to="/convoys/$id/edit" params={{ id: c.id }}
                            className="cnv-icobtn" style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:2, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', cursor:'pointer', color:'#4e5a65', fontSize:11, textDecoration:'none' }}>✏</Link>
                          <button onClick={() => window.confirm(`Delete "${c.name}"?`) && deleteMutation.mutate(c.id)}
                            className="cnv-icobtn" style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:2, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', cursor:'pointer', color:'#4e5a65', fontSize:11 }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selId && (
          <>
            <div onClick={() => setSelId(null)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.45)', zIndex:25 }} />
            <DetailPanel id={selId}
              onClose={() => setSelId(null)}
              onBroadcast={() => { setBroadcastConvoy(selConvoy ? { id: selConvoy.id, name: selConvoy.name } : null); setSelId(null) }} />
          </>
        )}
      </div>

      {broadcastConvoy && (
        <BroadcastPanel convoyId={broadcastConvoy.id} convoyName={broadcastConvoy.name} onClose={() => setBroadcastConvoy(null)} />
      )}
    </div>
  )
}
