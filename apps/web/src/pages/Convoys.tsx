import { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Search, Truck, Radio, Flag, Pencil, Trash2, MapPin, Plus, X, Zap, Building2, SlidersHorizontal, ChevronDown,
  Download,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { subscribe } from '../lib/centrifuge.js'
import { useAuthStore } from '../stores/auth.js'
import { normalizeList } from '../lib/normalize.js'
import { exportNuclearAnalytics } from '../lib/nuclearAnalyticsExport.js'
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
  client_id?: string | null; client_name?: string | null; client_company?: string | null
  open_alert_count?: number | string | null; open_incident_count?: number | string | null
  seal_intact?: boolean | null
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
  cancelled:  { bg: 'rgba(239,68,68,.08)', color: '#ef4444', border: 'rgba(239,68,68,.2)' },
  delayed:    { bg: 'rgba(245,158,11,.08)', color: '#f59e0b', border: 'rgba(245,158,11,.2)' },
  completing: { bg: 'rgba(168,85,247,.08)', color: '#a855f7', border: 'rgba(168,85,247,.2)' },
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

// Deterministic accent color per client so the same client reads as the same
// color everywhere (table badge, detail panel) without a server-assigned color.
const CLIENT_PALETTE = ['#00d4ff', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#60a5fa', '#f97316', '#14b8a6']
function clientColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return CLIENT_PALETTE[Math.abs(hash) % CLIENT_PALETTE.length]!
}

function ClientBadge({ name }: { name?: string | null | undefined }) {
  if (!name) return <span style={{ fontFamily:MN, fontSize:9, color:'#39424c', letterSpacing:'.06em' }}>UNASSIGNED</span>
  const color = clientColor(name)
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontFamily:SANS, fontSize:12, color:'#c3cad2', maxWidth:170 }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:color, flexShrink:0, boxShadow:`0 0 5px ${color}66` }} />
      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
    </span>
  )
}

// Live health signal — computed from real open alerts/incidents/seal status
// (not the operator-set `priority` field, which is a plan-time classification).
type HealthLevel = 'critical' | 'elevated' | 'clear'
const HEALTH_COLOR: Record<HealthLevel, string> = { critical: '#ef4444', elevated: '#f59e0b', clear: '#22c55e' }

function convoyHealth(c: ConvoyRow): { level: HealthLevel; label: string; detail: string } {
  const alerts = Number(c.open_alert_count ?? 0) || 0
  const incidents = Number(c.open_incident_count ?? 0) || 0
  if (incidents > 0 || c.seal_intact === false) {
    const parts: string[] = []
    if (incidents > 0) parts.push(`${incidents} open incident${incidents === 1 ? '' : 's'}`)
    if (c.seal_intact === false) parts.push('seal breach')
    if (alerts > 0) parts.push(`${alerts} open alert${alerts === 1 ? '' : 's'}`)
    return { level: 'critical', label: 'CRITICAL', detail: parts.join(' · ') }
  }
  if (alerts > 0) return { level: 'elevated', label: 'ELEVATED', detail: `${alerts} open alert${alerts === 1 ? '' : 's'}` }
  return { level: 'clear', label: 'CLEAR', detail: 'No open alerts or incidents' }
}

function HealthBadge({ c }: { c: ConvoyRow }) {
  const h = convoyHealth(c)
  return (
    <span title={h.detail} style={{ display:'inline-flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:8, letterSpacing:'.08em', color:HEALTH_COLOR[h.level] }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:HEALTH_COLOR[h.level], boxShadow: h.level !== 'clear' ? `0 0 5px ${HEALTH_COLOR[h.level]}aa` : 'none', flexShrink:0 }} />
      {h.label}
    </span>
  )
}

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

function RouteProgressCell({ c }: { c: ConvoyRow }) {
  const pct = convoyProgress(c)
  const ss = statusStyle(c.status)
  const origin = c.route_origin ?? c.region ?? '—'
  const dest = c.route_destination ?? '—'
  return (
    <div style={{ minWidth:150 }}>
      <div style={{ display:'flex', alignItems:'center', gap:5, fontFamily:SANS, fontSize:11.5, color:'#8a95a0', marginBottom:4 }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:90 }}>{origin}</span>
        <span style={{ color:'#f97316', fontSize:10, flexShrink:0 }}>→</span>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:90 }}>{dest}</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ flex:1, height:2, background:'rgba(255,255,255,.08)', borderRadius:1 }}>
          <div style={{ height:'100%', width:`${pct}%`, background:ss.color, borderRadius:1, transition:'width .6s' }} />
        </div>
        <span style={{ fontFamily:MN, fontSize:8, color:'#4e5a65', flexShrink:0 }}>{pct}%</span>
      </div>
    </div>
  )
}

function ScheduleCell({ c }: { c: ConvoyRow }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
        <span style={{ fontFamily:MN, fontSize:7, color:'#39424c', letterSpacing:'.1em', width:26, flexShrink:0 }}>OUT</span>
        <span style={{ fontFamily:MN, fontSize:10, color:'#8a95a0' }}>{fmtDate(c.departure_time ?? c.start_date)}</span>
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
        <span style={{ fontFamily:MN, fontSize:7, color:'#39424c', letterSpacing:'.1em', width:26, flexShrink:0 }}>ETA</span>
        <span style={{ fontFamily:MN, fontSize:10, color:'#8a95a0' }}>{fmtTime(c.estimated_arrival ?? c.end_date)}</span>
      </div>
    </div>
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────

function csvValue(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportConvoysCsv(list: ConvoyRow[], filename: string) {
  const headers = ['ID', 'Name', 'Status', 'Client', 'Origin', 'Destination', 'Priority', 'Vehicles', 'Departure', 'ETA', 'Open Alerts', 'Open Incidents', 'Seal Status']
  const lines = [headers.join(',')]
  for (const c of list) {
    lines.push([
      c.id, c.name, c.status, c.client_name ?? '',
      c.route_origin ?? c.region ?? '', c.route_destination ?? '',
      c.priority ?? '', c.vehicle_count ?? '',
      c.departure_time ?? c.start_date ?? '', c.estimated_arrival ?? c.end_date ?? '',
      Number(c.open_alert_count ?? 0) || 0, Number(c.open_incident_count ?? 0) || 0,
      c.seal_intact === false ? 'compromised' : c.seal_intact === true ? 'intact' : 'unverified',
    ].map(csvValue).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function ExportMenu({ list, filenameBase, filters }: {
  list: ConvoyRow[]
  filenameBase: string
  filters?: { status?: string; client?: string; search?: string }
}) {
  const [open, setOpen] = useState(false)
  const disabled = list.length === 0
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="cnv-clear"
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: MN, fontSize: 8, letterSpacing: '.1em', color: '#4e5a65', background: 'none', border: '1px solid rgba(255,255,255,.08)', borderRadius: 3, padding: '5px 8px', cursor: disabled ? 'default' : 'pointer', transition: 'all .12s', opacity: disabled ? .4 : 1 }}>
        <Download size={10} /> EXPORT <ChevronDown size={9} />
      </button>
      {open && !disabled && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 41, background: '#111519', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
            <button
              onClick={() => { exportConvoysCsv(list, `${filenameBase}-${today}.csv`); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(249,115,22,.08)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.08em', color: '#dde3ea' }}>CSV — SIMPLE</div>
              <div style={{ fontFamily: SANS, fontSize: 10, color: '#4e5a65', marginTop: 2 }}>Plain data table, no styling</div>
            </button>
            <button
              onClick={() => { void exportNuclearAnalytics(list, `${filenameBase}-nuclear-analytics-${today}.xlsx`, filters); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(249,115,22,.08)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <div style={{ fontFamily: MN, fontSize: 9, letterSpacing: '.08em', color: '#dde3ea' }}>EXCEL — NUCLEAR ANALYTICS</div>
              <div style={{ fontFamily: SANS, fontSize: 10, color: '#4e5a65', marginTop: 2 }}>Styled multi-sheet workbook: command center, register, risk & compliance</div>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Bulk Broadcast ───────────────────────────────────────────────────────────

function BulkBroadcastModal({ convoys, onClose }: { convoys: { id: string; name: string }[]; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  const send = async () => {
    if (!message.trim()) return
    setSending(true)
    setResult(null)
    const outcomes = await Promise.allSettled(
      convoys.map(c => api.post(`/convoys/${c.id}/broadcast`, { message: message.trim() }, {
        headers: { 'X-Idempotency-Key': `bulk-${c.id}-${Date.now()}` },
      }))
    )
    const sent = outcomes.filter(o => o.status === 'fulfilled').length
    setResult({ sent, failed: outcomes.length - sent })
    setSending(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:60, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#111519', border:'1px solid rgba(255,255,255,.1)', borderRadius:6, width:420, maxWidth:'90vw', padding:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <span style={{ fontFamily:MN, fontSize:11, letterSpacing:'.12em', color:'#dde3ea', display:'flex', alignItems:'center', gap:7 }}>
            <Radio size={13} color="#f97316" /> BULK BROADCAST
          </span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#4e5a65', cursor:'pointer' }}><X size={14} /></button>
        </div>
        <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65', marginBottom:10, lineHeight:1.5 }}>
          Sending to {convoys.length} active convoy{convoys.length === 1 ? '' : 's'}: {convoys.map(c => c.name).join(', ')}
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Message to all drivers…"
          style={{ width:'100%', background:'#09101c', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, color:'#dde3ea', fontFamily:SANS, fontSize:12, padding:8, resize:'none', outline:'none', boxSizing:'border-box' }} />
        {result && (
          <div style={{ marginTop:10, fontFamily:MN, fontSize:9, color: result.failed ? '#f59e0b' : '#22c55e' }}>
            Sent to {result.sent} convoy{result.sent === 1 ? '' : 's'}{result.failed ? `, ${result.failed} failed` : ''}.
          </div>
        )}
        <div style={{ display:'flex', gap:8, marginTop:14 }}>
          <button onClick={send} disabled={sending || !message.trim() || convoys.length === 0}
            style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.1em', padding:'8px 12px', borderRadius:3, background:'#f97316', border:'1px solid #f97316', color:'#000', fontWeight:700, cursor:'pointer', opacity: sending || !message.trim() || convoys.length === 0 ? .5 : 1 }}>
            <Radio size={11} /> {sending ? 'SENDING…' : 'SEND TO ALL'}
          </button>
          <button onClick={onClose} style={{ padding:'8px 12px', borderRadius:3, background:'none', border:'1px solid rgba(255,255,255,.08)', color:'#8a95a0', fontFamily:MN, fontSize:9, cursor:'pointer' }}>CLOSE</button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ id, onClose, onBroadcast, onEnd }: { id: string; onClose: () => void; onBroadcast: () => void; onEnd: () => void }) {
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
    <div style={{ position:'absolute', right:0, top:0, bottom:0, width:380, background:'#0d1014',
      borderLeft:'1px solid rgba(255,255,255,.08)', zIndex:30, display:'flex', flexDirection:'column',
      transform:'translateX(0)', overflowY:'auto' }}>
      {/* header */}
      <div style={{ background:'#111519', borderBottom:'1px solid rgba(255,255,255,.08)', padding:'16px 18px', position:'relative', flexShrink:0 }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg, #f97316, transparent)' }} />
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
          <span style={{ fontFamily:MN, fontSize:8, color:'#4e5a65', letterSpacing:'.18em' }}>{c?.id?.slice(0,8).toUpperCase() ?? '…'}</span>
          {c && <SBadge status={c.status} />}
        </div>
        <div style={{ fontFamily:SANS, fontWeight:700, fontSize:22, color:'#dde3ea', lineHeight:1.1 }}>{c?.name ?? 'Loading…'}</div>
        {c?.client_name && (
          <div style={{ marginTop:6 }}><ClientBadge name={c.client_name} /></div>
        )}
        <button onClick={onClose} style={{ position:'absolute', top:12, right:12, width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', background:'#1c2228', border:'1px solid rgba(255,255,255,.08)', borderRadius:2, cursor:'pointer', color:'#4e5a65' }}>
          <X size={13} />
        </button>
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
          ['Health', c ? <HealthBadge key="h" c={c} /> : '—'],
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
              <div style={{ width:28, height:28, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, display:'flex', alignItems:'center', justifyContent:'center', color:'#4e5a65', flexShrink:0 }}><Truck size={14} /></div>
              <div>
                <div style={{ fontFamily:SANS, fontSize:11, color:'#8a95a0' }}>{t.driver_name}</div>
                <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65' }}>Position {t.position}</div>
              </div>
              <span style={{ marginLeft:'auto', fontFamily:MN, fontSize:8, color:'#00e676' }}>ONLINE</span>
            </div>
          ))}
          {(c.vehicles ?? []).slice(0, c.trucks?.length ? 0 : 5).map(v => (
            <div key={v.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,.04)' }}>
              <div style={{ width:28, height:28, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, display:'flex', alignItems:'center', justifyContent:'center', color:'#4e5a65', flexShrink:0 }}><Truck size={14} /></div>
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
          <MapPin size={11} /> TRACK LIVE
        </Link>
        {c?.status === 'active' && (
          <button onClick={onBroadcast} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.12em', padding:'7px 13px', borderRadius:3, border:'1px solid #f97316', background:'#f97316', color:'#000', fontWeight:700, cursor:'pointer' }}>
            <Radio size={11} /> BROADCAST
          </button>
        )}
        {c?.status === 'active' && (
          <button onClick={onEnd} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.12em', padding:'7px 13px', borderRadius:3, border:'1px solid #a855f7', background:'transparent', color:'#a855f7', fontWeight:700, cursor:'pointer' }}>
            <Flag size={11} /> END CONVOY
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
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [broadcastConvoy, setBroadcastConvoy] = useState<{ id: string; name: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBroadcastOpen, setBulkBroadcastOpen] = useState(false)

  const { data, isLoading, isError } = useQuery<{ data: ConvoyRow[]; pagination?: unknown }>({
    queryKey: ['convoys'],
    queryFn: async () => { const r = await api.get('/convoys?limit=100'); return normalizeList(r.data) },
    staleTime: 15_000, refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!orgId) return
    return subscribe<{ type?: string }>(`org#${orgId}`, ev => {
      if (ev.type === 'convoy.update') {
        void qc.invalidateQueries({ queryKey: ['convoys'] })
        void qc.invalidateQueries({ queryKey: ['convoy-reports-overview'] })
      }
    })
  }, [orgId, qc])

  // Prune selection when convoys drop out of the fetched set (deleted, or no
  // longer within the org's list) rather than silently keeping stale ids.
  useEffect(() => {
    if (!data) return
    const validIds = new Set(data.data.map(c => c.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [data])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/convoys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['convoys'] })
      void qc.invalidateQueries({ queryKey: ['convoy-reports-overview'] })
    },
  })

  const [dispatchingId, setDispatchingId] = useState<string | null>(null)
  const dispatchMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/convoys/${id}/status`, { status: 'active' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['convoys'] })
      void qc.invalidateQueries({ queryKey: ['convoy-reports-overview'] })
    },
    onSettled: () => setDispatchingId(null),
  })

  const [endingId, setEndingId] = useState<string | null>(null)
  const endMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/convoys/${id}/status`, { status: 'completing' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['convoys'] })
      void qc.invalidateQueries({ queryKey: ['convoy-detail', endingId] })
      void qc.invalidateQueries({ queryKey: ['convoy-reports-overview'] })
    },
    onSettled: () => setEndingId(null),
  })

  const clientOptions = useMemo(() => {
    const all: ConvoyRow[] = data?.data ?? []
    const seen = new Map<string, string>()
    for (const c of all) if (c.client_id && c.client_name) seen.set(c.client_id, c.client_name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  const rows = useMemo(() => {
    const all: ConvoyRow[] = data?.data ?? []
    return all.filter(c => {
      const mf = filter === 'all' || c.status === filter
      const mc = clientFilter === 'all' || (clientFilter === 'unassigned' ? !c.client_id : c.client_id === clientFilter)
      const ms = !search || (c.name + (c.route_origin ?? '') + (c.route_destination ?? '') + (c.region ?? '') + (c.client_name ?? '')).toLowerCase().includes(search.toLowerCase())
      return mf && mc && ms
    })
  }, [data, filter, clientFilter, search])

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

  const filtersActive = filter !== 'all' || clientFilter !== 'all' || search !== ''
  const clearFilters = () => { setFilter('all'); setClientFilter('all'); setSearch('') }

  const selectedConvoys = useMemo(() => (data?.data ?? []).filter(c => selectedIds.has(c.id)), [data, selectedIds])
  const selectedActiveConvoys = useMemo(() => selectedConvoys.filter(c => c.status === 'active'), [selectedConvoys])
  const allVisibleSelected = rows.length > 0 && rows.every(c => selectedIds.has(c.id))
  const toggleRow = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAllVisible = () => setSelectedIds(prev => {
    const next = new Set(prev)
    if (allVisibleSelected) rows.forEach(c => next.delete(c.id))
    else rows.forEach(c => next.add(c.id))
    return next
  })

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
        .cnv-select{appearance:none;-webkit-appearance:none}
        .cnv-clear:hover{color:#f97316!important;border-color:rgba(249,115,22,.3)!important}
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
            <Link to="/convoys/new" style={{ display:'flex', alignItems:'center', gap:6, fontFamily:MN, fontSize:9, letterSpacing:'.12em', padding:'8px 14px', borderRadius:3, background:'#f97316', border:'1px solid #f97316', color:'#000', fontWeight:700, cursor:'pointer', textDecoration:'none' }}>
              <Plus size={12} strokeWidth={2.5} /> NEW CONVOY
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
            <div key={sc.label} onClick={() => setFilter(sc.filter as Filter)}
              style={{ background: filter === sc.filter ? '#111519' : '#0d1014', padding:'12px 18px', position:'relative', overflow:'hidden', cursor:'pointer', transition:'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background='#111519')} onMouseLeave={e => (e.currentTarget.style.background = filter === sc.filter ? '#111519' : '#0d1014')}>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${sc.color},transparent)`, opacity: filter === sc.filter ? 1 : 0.5 }} />
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
      <div style={{ display:'flex', alignItems:'center', gap:14, padding:'10px 24px', background:'#0d1014', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0, flexWrap:'wrap' }}>
        <div style={{ position:'relative', flex:'1 1 220px', maxWidth:280 }}>
          <Search size={12} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'#4e5a65', pointerEvents:'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search convoys, routes, clients…"
            style={{ width:'100%', background:'#111519', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, fontFamily:SANS, fontSize:12, color:'#dde3ea', padding:'6px 10px 6px 28px', outline:'none' }}
            onFocus={e => (e.target.style.borderColor='#f97316')} onBlur={e => (e.target.style.borderColor='rgba(255,255,255,.08)')} />
        </div>

        <div style={{ width:1, height:20, background:'rgba(255,255,255,.08)', flexShrink:0 }} />

        <div style={{ display:'flex', gap:2, background:'#111519', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, padding:2, flexShrink:0 }}>
          {(['all','active','completed','planned','cancelled'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`cnv-tab${filter===f?' on':''}`}
              style={{ fontFamily:MN, fontSize:8, letterSpacing:'.12em', padding:'4px 10px', borderRadius:2, cursor:'pointer', border:'none', background:'none', color:'#4e5a65', transition:'all .12s' }}>
              {f === 'planned' ? 'PLANNED' : f.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ position:'relative', flexShrink:0 }}>
          <Building2 size={11} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color: clientFilter === 'all' ? '#4e5a65' : '#f97316', pointerEvents:'none' }} />
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="cnv-select"
            style={{ fontFamily:MN, fontSize:9, letterSpacing:'.08em', padding:'6px 22px 6px 27px', borderRadius:3, cursor:'pointer',
              background:'#111519', border: clientFilter === 'all' ? '1px solid rgba(255,255,255,.08)' : '1px solid rgba(249,115,22,.3)',
              color: clientFilter === 'all' ? '#4e5a65' : '#dde3ea', outline:'none' }}>
            <option value="all">ALL CLIENTS</option>
            <option value="unassigned">UNASSIGNED</option>
            {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <ChevronDown size={10} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'#4e5a65', pointerEvents:'none' }} />
        </div>

        {filtersActive && (
          <button onClick={clearFilters} className="cnv-clear" style={{ display:'flex', alignItems:'center', gap:4, fontFamily:MN, fontSize:8, letterSpacing:'.1em', color:'#4e5a65', background:'none', border:'1px solid rgba(255,255,255,.08)', borderRadius:3, padding:'5px 8px', cursor:'pointer', transition:'all .12s', flexShrink:0 }}>
            <X size={10} /> CLEAR
          </button>
        )}

        <ExportMenu list={rows} filenameBase="convoys" filters={{ status: filter, client: clientFilter, search }} />

        <span style={{ display:'flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:9, color:'#4e5a65', marginLeft:'auto', whiteSpace:'nowrap' }}>
          <SlidersHorizontal size={10} /> {rows.length} convoy{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 24px', background:'rgba(249,115,22,.06)', borderBottom:'1px solid rgba(249,115,22,.2)', flexShrink:0 }}>
          <span style={{ fontFamily:MN, fontSize:9, letterSpacing:'.1em', color:'#f97316', fontWeight:700 }}>
            {selectedIds.size} SELECTED
          </span>
          <button onClick={() => setBulkBroadcastOpen(true)} disabled={selectedActiveConvoys.length === 0}
            title={selectedActiveConvoys.length === 0 ? 'No active convoys in selection' : undefined}
            style={{ display:'flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:8, letterSpacing:'.1em', padding:'5px 9px', borderRadius:3, background:'none', border:'1px solid rgba(249,115,22,.35)', color: selectedActiveConvoys.length === 0 ? '#4e5a65' : '#f97316', cursor: selectedActiveConvoys.length === 0 ? 'default' : 'pointer', opacity: selectedActiveConvoys.length === 0 ? .5 : 1 }}>
            <Radio size={10} /> BROADCAST ({selectedActiveConvoys.length})
          </button>
          <ExportMenu list={selectedConvoys} filenameBase="convoys-selected" filters={{ status: filter, client: clientFilter, search }} />
          <button onClick={() => setSelectedIds(new Set())}
            style={{ display:'flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:8, letterSpacing:'.1em', padding:'5px 9px', borderRadius:3, background:'none', border:'1px solid rgba(255,255,255,.1)', color:'#4e5a65', cursor:'pointer', marginLeft:'auto' }}>
            <X size={10} /> CLEAR SELECTION
          </button>
        </div>
      )}

      {/* ── Table + Panel ── */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', display:'flex' }}>
        <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:'rgba(255,255,255,.08) transparent' }}>
          {isLoading && <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, fontFamily:MN, fontSize:10, color:'#4e5a65', letterSpacing:'.1em' }}>LOADING…</div>}
          {isError && <div style={{ textAlign:'center', padding:32, fontFamily:MN, fontSize:10, color:'#ef4444' }}>FAILED TO LOAD CONVOYS</div>}
          {!isLoading && !isError && (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding:'9px 0 9px 24px', background:'#0d1014', borderBottom:'1px solid rgba(255,255,255,.08)', position:'sticky', top:0, zIndex:2, width:32 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible}
                      style={{ accentColor:'#f97316', cursor:'pointer' }} />
                  </th>
                  {['CONVOY', 'STATUS', 'CLIENT', 'ROUTE / PROGRESS', 'PRIORITY / HEALTH', 'VEHICLES', 'SCHEDULE', ''].map((h, i) => (
                    <th key={i} style={{ fontFamily:MN, fontSize:7, letterSpacing:'.2em', color:'#4e5a65', padding:'9px 14px', textAlign:'left', background:'#0d1014', borderBottom:'1px solid rgba(255,255,255,.08)', position:'sticky', top:0, zIndex:2, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={9} style={{ padding:'60px 24px', textAlign:'center', fontFamily:MN, fontSize:10, color:'#4e5a65', letterSpacing:'.1em' }}>
                    {filtersActive ? 'NO CONVOYS MATCH YOUR FILTERS' : 'NO CONVOYS YET'}
                  </td></tr>
                )}
                {rows.map((c, idx) => {
                  const risk = c.priority ?? '—'
                  const isSel = c.id === selId
                  return (
                    <tr key={c.id} onClick={() => setSelId(isSel ? null : c.id)} className={`cnv-tr${isSel ? ' sel-row' : ''}`}
                      style={{ borderBottom:'1px solid rgba(255,255,255,.04)', cursor:'pointer', position:'relative', animationDelay:`${idx * 20}ms` }}>
                      <div className="cnv-left-border" style={{ position:'absolute', left:0, top:0, bottom:0, width:0, background:'rgba(249,115,22,.5)', transition:'width .15s' }} />
                      <td style={{ padding:'12px 0 12px 24px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleRow(c.id)}
                          style={{ accentColor:'#f97316', cursor:'pointer' }} />
                      </td>
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ fontFamily:MN, fontSize:9, color:'#4e5a65', marginBottom:1 }}>{c.id.slice(0,8).toUpperCase()}</div>
                        <div style={{ fontFamily:SANS, fontWeight:500, fontSize:13, color:'#dde3ea' }}>{c.name}</div>
                      </td>
                      <td style={{ padding:'12px 14px' }}><SBadge status={c.status} /></td>
                      <td style={{ padding:'12px 14px' }}><ClientBadge name={c.client_name} /></td>
                      <td style={{ padding:'12px 14px' }}><RouteProgressCell c={c} /></td>
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                          <span style={{ fontFamily:MN, fontSize:9, fontWeight:700, letterSpacing:'.08em', color:riskColor(risk) }}>{risk.toUpperCase()}</span>
                          <HealthBadge c={c} />
                        </div>
                      </td>
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:5, fontFamily:MN, fontSize:11, color:'#8a95a0' }}>
                          <Truck size={12} style={{ color:'#4e5a65' }} />{c.vehicle_count ?? '—'}
                        </div>
                      </td>
                      <td style={{ padding:'12px 14px' }}><ScheduleCell c={c} /></td>
                      <td style={{ padding:'12px 14px 12px 0' }}>
                        <div style={{ display:'flex', gap:4, alignItems:'center', justifyContent:'flex-end' }} onClick={e => e.stopPropagation()}>
                          {c.status === 'planned' && (
                            <button
                              onClick={() => { if (window.confirm(`Dispatch "${c.name}"? This will mark it active.`)) { setDispatchingId(c.id); dispatchMutation.mutate(c.id) } }}
                              disabled={dispatchingId === c.id}
                              style={{ height:24, padding:'0 8px', display:'flex', alignItems:'center', gap:4, borderRadius:2, background:'#f97316', border:'1px solid #f97316', cursor:'pointer', color:'#000', fontFamily:MN, fontSize:8, fontWeight:700, letterSpacing:'.1em', opacity: dispatchingId === c.id ? 0.5 : 1 }}>
                              <Zap size={10} /> {dispatchingId === c.id ? '…' : 'DISPATCH'}
                            </button>
                          )}
                          {c.status === 'active' && (
                            <button
                              title="Broadcast"
                              onClick={() => setBroadcastConvoy({ id: c.id, name: c.name })}
                              className="cnv-icobtn"
                              style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:2, background:'#161b20', border:'1px solid rgba(249,115,22,.3)', cursor:'pointer', color:'#f97316' }}>
                              <Radio size={11} />
                            </button>
                          )}
                          <Link to="/convoys/$id/edit" params={{ id: c.id }}
                            className="cnv-icobtn" style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:2, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', cursor:'pointer', color:'#4e5a65', textDecoration:'none' }}>
                            <Pencil size={11} />
                          </Link>
                          {c.status !== 'active' && (
                            <button
                              title="Delete convoy"
                              onClick={() => window.confirm(`Delete "${c.name}"?`) && deleteMutation.mutate(c.id)}
                              className="cnv-icobtn" style={{ width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:2, background:'#161b20', border:'1px solid rgba(255,255,255,.08)', cursor:'pointer', color:'#4e5a65' }}>
                              <Trash2 size={11} />
                            </button>
                          )}
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
              onBroadcast={() => { setBroadcastConvoy(selConvoy ? { id: selConvoy.id, name: selConvoy.name } : null); setSelId(null) }}
              onEnd={() => {
                if (!selId || !window.confirm('Mark this convoy as completing? CFOs will be asked to submit a handover form on their final EOD.')) return
                setEndingId(selId)
                endMutation.mutate(selId)
              }} />
          </>
        )}
      </div>

      {broadcastConvoy && (
        <BroadcastPanel convoyId={broadcastConvoy.id} convoyName={broadcastConvoy.name} onClose={() => setBroadcastConvoy(null)} />
      )}

      {bulkBroadcastOpen && (
        <BulkBroadcastModal
          convoys={selectedActiveConvoys.map(c => ({ id: c.id, name: c.name }))}
          onClose={() => setBulkBroadcastOpen(false)}
        />
      )}
    </div>
  )
}
