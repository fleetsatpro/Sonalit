import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  CircleDot,
  Command,
  FileText,
  Globe2,
  Link2,
  Network,
  Radar,
  Search,
  ShieldAlert,
  Target,
  TrendingUp,
  Waypoints,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuthStore } from '../stores/auth.js'
import { useRiskZones } from '../features/risk-intel/hooks/useRiskZones.js'
import RiskIntelPage from '../features/risk-intel/RiskIntelPage.js'

type View = 'overview' | 'global' | 'events' | 'countries' | 'operations' | 'investigations' | 'forecast' | 'reports'
type Tone = 'cyan' | 'red' | 'amber' | 'green'

type EventItem = {
  id: string
  time: string
  place: string
  title: string
  detail: string
  severity: 'HIGH' | 'MED'
  confidence: number
  source: string
}

type NavItem = { id: View; label: string; icon: LucideIcon; hint: string }

const NAV: NavItem[] = [
  { id: 'overview', label: 'Situation Room', icon: Globe2, hint: 'Decision-first common operating picture' },
  { id: 'global', label: 'Live Atlas', icon: Radar, hint: 'Geospatial threat and risk picture' },
  { id: 'events', label: 'Signal Stream', icon: Activity, hint: 'Fresh evidence and significant changes' },
  { id: 'countries', label: 'Country Lens', icon: Target, hint: 'Persistent country assessments' },
  { id: 'operations', label: 'Exposure', icon: Waypoints, hint: 'Threats intersecting operations' },
  { id: 'investigations', label: 'Investigations', icon: Network, hint: 'Relationships, evidence and storylines' },
  { id: 'forecast', label: 'Forecast', icon: TrendingUp, hint: 'Scenarios, probabilities and indicators' },
  { id: 'reports', label: 'Publications', icon: FileText, hint: 'Briefs, advisories and intelligence products' },
]

const ROLE_DEPTH: Record<string, { label: string; views: View[] }> = {
  admin: { label: 'FULL INTELLIGENCE', views: NAV.map((item) => item.id) },
  manager: { label: 'OPERATIONAL INTELLIGENCE', views: ['overview', 'global', 'events', 'countries', 'operations', 'investigations', 'forecast'] },
  analyst: { label: 'ANALYST WORKSPACE', views: ['overview', 'global', 'events', 'countries', 'operations', 'investigations', 'forecast', 'reports'] },
  operator: { label: 'OPERATIONAL VIEW', views: ['overview', 'global', 'events', 'operations'] },
  viewer: { label: 'INTELLIGENCE VIEWER', views: ['overview', 'global', 'events', 'countries'] },
}

const EVENTS: EventItem[] = [
  { id: 'SIG-4821', time: '04m', place: 'GOMA', title: 'Risk trajectory changed', detail: 'Multiple signals indicate increased pressure near the primary corridor.', severity: 'HIGH', confidence: 91, source: 'Multi-source fusion' },
  { id: 'SIG-4818', time: '12m', place: 'NORTH KIVU', title: 'Route exposure detected', detail: 'Operational route intersects an elevated risk envelope.', severity: 'HIGH', confidence: 84, source: 'Risk + convoy intersection' },
  { id: 'SIG-4813', time: '26m', place: 'DAR ES SALAAM', title: 'Port congestion signal detected', detail: 'Emerging friction may affect downstream movement timing.', severity: 'MED', confidence: 78, source: 'Operational telemetry' },
  { id: 'SIG-4807', time: '41m', place: 'NAIROBI', title: 'Cross-source anomaly requires review', detail: 'Pattern deviates from recent baseline and needs corroboration.', severity: 'MED', confidence: 73, source: 'Baseline comparison' },
]

const COUNTRIES = [
  ['DRC', 'ELEVATED', '↑', '78', 'Operational exposure rising'],
  ['TANZANIA', 'MODERATE', '→', '41', 'Stable / monitor indicators'],
  ['KENYA', 'MODERATE', '↑', '46', 'Localized signal activity'],
  ['UGANDA', 'LOW', '↓', '28', 'No material deterioration'],
]

const FORECASTS = [
  ['24H', 'BASELINE', '62%', '82%', 'Conditions broadly persist', 'Route access remains the primary watch indicator.'],
  ['72H', 'DETERIORATION', '27%', '71%', 'Risk indicators accelerate', 'Event frequency and source convergence increase.'],
  ['7D', 'IMPROVEMENT', '11%', '64%', 'Pressure indicators ease', 'Requires sustained negative trend reversal.'],
]

const tones: Record<Tone, string> = { cyan: '#54d9ff', red: '#ff667d', amber: '#f7b955', green: '#48e0b0' }

function Pulse({ color = tones.cyan }: { color?: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: 99, display: 'inline-block', background: color, boxShadow: `0 0 0 4px ${color}14, 0 0 15px ${color}80` }} />
}

function Glass({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section style={{ border: '1px solid rgba(255,255,255,.075)', borderRadius: 18, background: 'linear-gradient(145deg,rgba(11,24,40,.94),rgba(6,14,25,.9))', boxShadow: '0 18px 60px rgba(0,0,0,.16)', ...style }}>{children}</section>
}

function Pill({ children, tone = 'cyan' }: { children: ReactNode; tone?: Tone }) {
  const color = tones[tone]
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 7px', borderRadius: 7, border: `1px solid ${color}2a`, background: `${color}0d`, color, fontSize: 8, fontWeight: 750, letterSpacing: '.1em', fontFamily: 'IBM Plex Mono,monospace' }}><CircleDot size={8} />{children}</span>
}

function Section({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 14 }}>
    <div><div style={{ fontSize: 9, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace', letterSpacing: '.16em' }}>{eyebrow}</div><div style={{ fontSize: 18, fontWeight: 720, letterSpacing: '-.025em', marginTop: 4 }}>{title}</div>{detail && <div style={{ fontSize: 10, color: '#71849a', marginTop: 4 }}>{detail}</div>}</div>
    {action}
  </div>
}

function Metric({ label, value, detail, icon: Icon, tone = 'cyan' }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: Tone }) {
  const color = tones[tone]
  return <div style={{ position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, padding: 16, background: 'linear-gradient(145deg,rgba(14,29,47,.96),rgba(7,16,28,.96))' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 9, color: '#70849a', letterSpacing: '.14em', fontFamily: 'IBM Plex Mono,monospace' }}>{label}</span><span style={{ width: 29, height: 29, display: 'grid', placeItems: 'center', borderRadius: 9, background: `${color}0d`, color }}><Icon size={14} /></span></div>
    <div style={{ marginTop: 11, fontSize: 27, lineHeight: 1, fontWeight: 760, letterSpacing: '-.04em', color }}>{value}</div><div style={{ marginTop: 6, fontSize: 10, color: '#72869c' }}>{detail}</div>
  </div>
}

export default function IntelligenceCentre() {
  const user = useAuthStore((state) => state.user)
  const role = String(user?.role ?? 'viewer').toLowerCase()
  const profile = ROLE_DEPTH[role] ?? ROLE_DEPTH.viewer
  const available = NAV.filter((item) => profile.views.includes(item.id))
  const [view, setView] = useState<View>(available[0]?.id ?? 'overview')
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState('')
  const [drawer, setDrawer] = useState<EventItem | null>(null)
  const [scope, setScope] = useState('ALL')
  const { data, isLoading } = useRiskZones('global', 'all')
  const counts = data?.counts ?? { high: 0, medium: 0, low: 0, total: 0 }
  const zones = data?.zones ?? []
  const highZones = useMemo(() => zones.filter((zone: any) => zone.level === 'high').slice(0, 5), [zones])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette((open) => !open) }
      if (event.key === 'Escape') { setPalette(false); setDrawer(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (next: View) => { setView(next); setPalette(false) }

  return <div style={{ minHeight: '100%', background: 'radial-gradient(circle at 75% -10%,rgba(36,116,170,.19),transparent 34%),radial-gradient(circle at 5% 60%,rgba(80,80,180,.06),transparent 27%),#050c16', color: '#e8edf4', fontFamily: 'Inter,system-ui,sans-serif', padding: '18px 22px 42px' }}>
    <header style={{ maxWidth: 1540, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div><div style={{ display: 'flex', alignItems: 'center', gap: 9, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, letterSpacing: '.2em', fontWeight: 750 }}><Pulse color={tones.green} />SONALIT INTELLIGENCE FABRIC · {profile.label}</div><h1 style={{ margin: '9px 0 5px', fontSize: 'clamp(28px,3vw,44px)', lineHeight: 1, letterSpacing: '-.055em' }}>Intelligence Centre</h1><p style={{ margin: 0, maxWidth: 800, color: '#71859b', fontSize: 12, lineHeight: 1.7 }}>A living decision environment connecting signals, geography, entities, operations, forecasts and evidence into one coherent operational picture.</p></div>
        <button onClick={() => setPalette(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: '1px solid rgba(84,217,255,.14)', borderRadius: 10, background: 'rgba(84,217,255,.035)', color: '#90a2b5', cursor: 'pointer', fontSize: 9 }}><Search size={13} /><span>Search intelligence</span><kbd style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, border: '1px solid rgba(255,255,255,.1)', borderRadius: 5, padding: '2px 5px' }}>Ctrl K</kbd></button>
      </div>
      <nav style={{ display: 'flex', gap: 3, overflowX: 'auto', padding: '18px 0 11px', borderBottom: '1px solid rgba(255,255,255,.065)' }}>{available.map((item) => { const Icon = item.icon; const active = view === item.id; return <button key={item.id} onClick={() => setView(item.id)} title={item.hint} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 11px', borderRadius: 9, border: `1px solid ${active ? 'rgba(84,217,255,.24)' : 'transparent'}`, background: active ? 'rgba(84,217,255,.08)' : 'transparent', color: active ? tones.cyan : '#73879d', cursor: 'pointer', fontSize: 10, fontWeight: 650 }}><Icon size={13} />{item.label}</button> })}</nav>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 9, flexWrap: 'wrap' }}><span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#50667b' }}>SCOPE</span>{['ALL', 'EAST AFRICA', 'GREAT LAKES', 'ACTIVE OPERATIONS'].map((item) => <button key={item} onClick={() => setScope(item)} style={{ padding: '6px 8px', borderRadius: 7, border: `1px solid ${scope === item ? 'rgba(84,217,255,.2)' : 'rgba(255,255,255,.05)'}`, background: scope === item ? 'rgba(84,217,255,.06)' : 'transparent', color: scope === item ? tones.cyan : '#61758a', fontSize: 8, cursor: 'pointer' }}>{item}</button>)}<span style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#4f657a' }}><Pulse color={tones.green} /> LIVE · 14s</span></div>
    </header>

    <main style={{ maxWidth: 1540, margin: '0 auto', paddingTop: 14 }}>
      {view === 'overview' && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 9 }}><Metric label="Active risk zones" value={isLoading ? '—' : String(counts.total)} detail="Current spatial picture" icon={Globe2} /><Metric label="High severity" value={isLoading ? '—' : String(counts.high)} detail="Requires attention" icon={ShieldAlert} tone="red" /><Metric label="Signal velocity" value="+14%" detail="vs previous window" icon={Zap} tone="amber" /><Metric label="Intelligence posture" value="LIVE" detail="Realtime + evidence connected" icon={BrainCircuit} tone="green" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(320px,.65fr)', gap: 10, marginTop: 10 }}>
          <Glass style={{ overflow: 'hidden' }}><div style={{ padding: '16px 17px' }}><Section eyebrow="DECISION SURFACE" title="What changed — and what does it expose?" detail="The Centre prioritizes consequence over raw information." action={<button onClick={() => go('global')} style={{ border: 0, background: 'transparent', color: tones.cyan, fontSize: 9, cursor: 'pointer' }}>Open atlas <ArrowUpRight size={11} /></button>} />
            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 10 }}><div style={{ minHeight: 300, borderRadius: 15, position: 'relative', overflow: 'hidden', background: 'radial-gradient(circle at 58% 42%,rgba(255,102,125,.13),transparent 16%),radial-gradient(circle at 28% 66%,rgba(84,217,255,.11),transparent 17%),linear-gradient(145deg,#081827,#06111d)', border: '1px solid rgba(84,217,255,.08)' }}><div style={{ position: 'absolute', inset: 0, opacity: .22, backgroundImage: 'linear-gradient(rgba(84,217,255,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(84,217,255,.12) 1px,transparent 1px)', backgroundSize: '34px 34px' }} /><div style={{ position: 'absolute', left: '49%', top: '39%', width: 155, height: 155, border: '1px solid rgba(255,102,125,.34)', borderRadius: '50%', boxShadow: '0 0 55px rgba(255,102,125,.07)' }} /><div style={{ position: 'absolute', left: '63%', top: '29%', width: 8, height: 8, borderRadius: 99, background: '#ff667d', boxShadow: '0 0 20px #ff667d' }} /><div style={{ position: 'absolute', left: '29%', top: '61%', width: 7, height: 7, borderRadius: 99, background: tones.cyan, boxShadow: `0 0 18px ${tones.cyan}` }} /><div style={{ position: 'absolute', right: 12, top: 12, padding: '5px 7px', borderRadius: 6, background: 'rgba(4,11,19,.78)', fontSize: 8, color: '#6e8499', fontFamily: 'IBM Plex Mono,monospace' }}>FUSED GEOSPATIAL VIEW</div><div style={{ position: 'absolute', left: 13, bottom: 12, fontSize: 8, color: '#71869d', fontFamily: 'IBM Plex Mono,monospace' }}>EAST AFRICA / GREAT LAKES · LIVE</div></div>
              <div style={{ display: 'grid', gap: 7 }}>{highZones.slice(0, 4).map((zone: any, index: number) => <button key={zone.id ?? index} onClick={() => go('global')} style={{ textAlign: 'left', padding: 11, borderRadius: 11, border: '1px solid rgba(255,102,125,.12)', background: 'rgba(255,102,125,.035)', color: '#e8edf4', cursor: 'pointer' }}><div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#ff7184' }}>HIGH · {zone.country_code || 'GLOBAL'}</div><div style={{ marginTop: 6, fontSize: 11, fontWeight: 650 }}>{zone.name || zone.zone_code || 'Active risk zone'}</div><div style={{ marginTop: 3, fontSize: 8, color: '#667b91' }}>Threat envelope · live</div></button>)}{!highZones.length && <div style={{ padding: 25, color: '#63778c', fontSize: 10 }}>No high-severity zones currently returned.</div>}</div>
            </div>
          </div></Glass>
          <Glass style={{ padding: 17 }}><Section eyebrow="SIGNAL QUALITY" title="Trust, not just volume" detail="Severity and confidence remain separate dimensions." /><div style={{ display: 'grid', gap: 10 }}>{[['SOURCE COVERAGE', '84%', 'green'], ['CROSS-SOURCE CORROBORATION', '71%', 'cyan'], ['STALE SIGNALS', '09%', 'amber'], ['UNRESOLVED GAPS', '04', 'red']].map(([label, value, tone]) => <div key={label}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}><span style={{ color: '#73869b' }}>{label}</span><span style={{ color: tones[tone as Tone], fontFamily: 'IBM Plex Mono,monospace' }}>{value}</span></div><div style={{ marginTop: 7, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.06)' }}><div style={{ width: value.includes('%') ? value : '48%', height: '100%', borderRadius: 99, background: tones[tone as Tone] }} /></div></div>)}</div><div style={{ marginTop: 22, padding: 13, borderRadius: 12, background: 'rgba(72,224,176,.035)', border: '1px solid rgba(72,224,176,.11)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Pulse color={tones.green} /><span style={{ fontSize: 9, color: tones.green, fontFamily: 'IBM Plex Mono,monospace' }}>HUMAN + MACHINE</span></div><div style={{ marginTop: 8, fontSize: 10, lineHeight: 1.65, color: '#8194a8' }}>AI surfaces patterns and uncertainty; accountable operators retain the decision.</div></div></Glass>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 10, marginTop: 10 }}><Glass style={{ padding: 17 }}><Section eyebrow="INTELLIGENCE LOOP" title="From raw signal to decision" /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>{['Collect', 'Corroborate', 'Fuse', 'Assess', 'Forecast', 'Expose'].map((step, index) => <div key={step} style={{ padding: 11, borderRadius: 10, background: index === 5 ? 'rgba(84,217,255,.07)' : 'rgba(255,255,255,.025)', border: `1px solid ${index === 5 ? 'rgba(84,217,255,.15)' : 'rgba(255,255,255,.05)'}` }}><div style={{ fontSize: 8, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace' }}>0{index + 1}</div><div style={{ marginTop: 9, fontSize: 10, fontWeight: 650 }}>{step}</div></div>)}</div></Glass><Glass style={{ padding: 17 }}><Section eyebrow="NEXT DECISION" title="Priority attention" /><div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><span style={{ color: '#ff667d', marginTop: 2 }}><ShieldAlert size={18} /></span><div><div style={{ fontSize: 11, fontWeight: 700 }}>North Kivu route exposure</div><div style={{ marginTop: 5, fontSize: 9, color: '#71859a', lineHeight: 1.6 }}>Review corridor status and latest corroborating signals before next movement window.</div><button onClick={() => setDrawer(EVENTS[1])} style={{ marginTop: 12, border: '1px solid rgba(255,102,125,.16)', background: 'rgba(255,102,125,.05)', color: '#ff7184', borderRadius: 8, padding: '7px 9px', fontSize: 8, cursor: 'pointer' }}>Inspect evidence</button></div></div></Glass></div>
      </>}

      {view === 'global' && <Glass style={{ padding: 0, overflow: 'hidden' }}><RiskIntelPage /></Glass>}

      {view === 'events' && <Glass style={{ padding: 17 }}><Section eyebrow="FRESH INTELLIGENCE" title="Signal Stream" detail="Significant changes ordered by recency, consequence and confidence." /><div style={{ display: 'grid', gap: 7 }}>{EVENTS.map((event) => <button key={event.id} onClick={() => setDrawer(event)} style={{ display: 'grid', gridTemplateColumns: '62px 1fr auto', gap: 14, alignItems: 'center', textAlign: 'left', width: '100%', padding: 13, borderRadius: 12, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.018)', color: '#e8edf4', cursor: 'pointer' }}><div><div style={{ fontSize: 8, color: '#60748a', fontFamily: 'IBM Plex Mono,monospace' }}>{event.time}</div><div style={{ marginTop: 4, fontSize: 8, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace' }}>{event.place}</div></div><div><div style={{ fontSize: 11, fontWeight: 700 }}>{event.title}</div><div style={{ marginTop: 4, fontSize: 9, color: '#71859a' }}>{event.detail}</div></div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Pill tone={event.severity === 'HIGH' ? 'red' : 'amber'}>{event.severity}</Pill><span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#91a3b5' }}>{event.confidence}%</span><ChevronRight size={13} color="#496077" /></div></button>)}</div></Glass>}

      {view === 'countries' && <Glass style={{ padding: 17 }}><Section eyebrow="COUNTRY LENS" title="Regional intelligence posture" detail="Persistent assessments, trajectory and operational relevance." /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 9 }}>{COUNTRIES.map(([country, status, trend, score, detail]) => <div key={country} style={{ padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.018)' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 9, color: '#6e8398', fontFamily: 'IBM Plex Mono,monospace' }}>{country}</span><span style={{ color: status === 'ELEVATED' ? '#ff667d' : '#f7b955', fontSize: 11 }}>{trend}</span></div><div style={{ marginTop: 17, fontSize: 27, fontWeight: 760 }}>{score}</div><div style={{ marginTop: 5 }}><Pill tone={status === 'ELEVATED' ? 'red' : 'amber'}>{status}</Pill></div><div style={{ marginTop: 12, fontSize: 9, color: '#71859a', lineHeight: 1.6 }}>{detail}</div></div>)}</div></Glass>}

      {view === 'operations' && <Glass style={{ padding: 17 }}><Section eyebrow="OPERATIONAL EXPOSURE" title="Where intelligence intersects missions" detail="Risk is meaningful when it changes an operational decision." /><div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 10 }}><div style={{ minHeight: 390, borderRadius: 15, position: 'relative', overflow: 'hidden', background: 'radial-gradient(circle at 50% 50%,rgba(84,217,255,.08),transparent 30%),linear-gradient(145deg,#081827,#06111d)', border: '1px solid rgba(84,217,255,.08)' }}><div style={{ position: 'absolute', inset: 0, opacity: .2, backgroundImage: 'linear-gradient(rgba(84,217,255,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(84,217,255,.12) 1px,transparent 1px)', backgroundSize: '40px 40px' }} /><div style={{ position: 'absolute', left: '24%', top: '32%', width: 210, height: 95, border: '1px solid rgba(84,217,255,.32)', transform: 'rotate(-18deg)', borderRadius: 80 }} /><div style={{ position: 'absolute', left: '58%', top: '44%', width: 150, height: 150, border: '1px solid rgba(255,102,125,.34)', borderRadius: '50%' }} /><div style={{ position: 'absolute', left: '62%', top: '49%', color: '#ff667d', fontFamily: 'IBM Plex Mono,monospace', fontSize: 8 }}>EXPOSURE</div><div style={{ position: 'absolute', left: 14, bottom: 13, fontSize: 8, color: '#71869d', fontFamily: 'IBM Plex Mono,monospace' }}>MISSION INTERSECTION MAP · LIVE</div></div><div style={{ display: 'grid', gap: 8 }}>{[['CVY-041', 'North Kivu corridor', 'HIGH', 'red'], ['CDS-118', 'Dar es Salaam → inland', 'MED', 'amber'], ['OPS-207', 'Nairobi staging', 'MED', 'amber']].map(([id, name, severity, tone]) => <div key={id} style={{ padding: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.018)' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 8, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace' }}>{id}</span><Pill tone={tone as Tone}>{severity}</Pill></div><div style={{ marginTop: 10, fontSize: 11, fontWeight: 650 }}>{name}</div><div style={{ marginTop: 5, fontSize: 9, color: '#71859a' }}>Threat-to-operation intersection requires review.</div></div>)}</div></div></Glass>}

      {view === 'investigations' && <Glass style={{ padding: 17 }}><Section eyebrow="INVESTIGATION WORKBENCH" title="Relationship graph" detail="Move from an event to its evidence, sources, places and affected operations." /><div style={{ minHeight: 390, position: 'relative', borderRadius: 15, overflow: 'hidden', border: '1px solid rgba(84,217,255,.08)', background: 'radial-gradient(circle at 50% 50%,rgba(84,217,255,.09),transparent 24%),#07131f' }}>{[['EVENT', 'SIG-4821', 50, 45, 'cyan'], ['SOURCE', 'SRC-19', 22, 25, 'green'], ['LOCATION', 'GOMA', 77, 23, 'red'], ['ASSET', 'CVY-041', 23, 72, 'amber'], ['STORYLINE', 'SL-017', 75, 72, 'cyan']].map(([kind, label, left, top, tone]) => <div key={label} style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, transform: 'translate(-50%,-50%)', width: 120, padding: 11, borderRadius: 12, border: `1px solid ${tones[tone as Tone]}35`, background: `${tones[tone as Tone]}0c`, textAlign: 'center' }}><div style={{ fontSize: 7, color: tones[tone as Tone], fontFamily: 'IBM Plex Mono,monospace' }}>{kind}</div><div style={{ marginTop: 5, fontSize: 10, fontWeight: 700 }}>{label}</div></div>)}<div style={{ position: 'absolute', left: '25%', right: '25%', top: '48%', borderTop: '1px dashed rgba(84,217,255,.2)' }} /><div style={{ position: 'absolute', top: '27%', bottom: '27%', left: '50%', borderLeft: '1px dashed rgba(84,217,255,.2)' }} /></div></Glass>}

      {view === 'forecast' && <Glass style={{ padding: 17 }}><Section eyebrow="FORECAST" title="Scenarios, probabilities and indicators" detail="Probabilistic assessments are explicitly separated from observed facts." /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 9 }}>{FORECASTS.map(([horizon, scenario, probability, confidence, title, detail]) => <div key={horizon} style={{ padding: 17, borderRadius: 15, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.018)' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: tones.cyan }}>{horizon}</span><Pill tone={scenario === 'DETERIORATION' ? 'red' : scenario === 'BASELINE' ? 'cyan' : 'green'}>{scenario}</Pill></div><div style={{ display: 'flex', gap: 22, marginTop: 22 }}><div><div style={{ fontSize: 27, fontWeight: 760 }}>{probability}</div><div style={{ fontSize: 8, color: '#6f8398' }}>PROBABILITY</div></div><div><div style={{ fontSize: 27, fontWeight: 760 }}>{confidence}</div><div style={{ fontSize: 8, color: '#6f8398' }}>CONFIDENCE</div></div></div><div style={{ marginTop: 18, fontSize: 11, fontWeight: 700 }}>{title}</div><div style={{ marginTop: 6, fontSize: 9, color: '#71859a', lineHeight: 1.6 }}>{detail}</div></div>)}</div></Glass>}

      {view === 'reports' && <Glass style={{ padding: 18 }}><Section eyebrow="FINISHED INTELLIGENCE" title="Publications" detail="Governed products with evidence lineage and review state." /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>{['Daily Regional Intelligence Brief', 'Great Lakes Security Outlook', 'Operational Threat Advisory'].map((title, index) => <div key={title} style={{ padding: 17, borderRadius: 15, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.018)' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><FileText size={17} color={tones.cyan} /><Pill tone={index === 0 ? 'green' : index === 1 ? 'amber' : 'cyan'}>{index === 0 ? 'READY' : index === 1 ? 'REVIEW' : 'DRAFT'}</Pill></div><div style={{ marginTop: 16, fontSize: 12, fontWeight: 700 }}>{title}</div><div style={{ marginTop: 6, fontSize: 9, color: '#6c8197' }}>Evidence-backed · linked sources · human reviewed</div><button style={{ marginTop: 18, border: '1px solid rgba(84,217,255,.16)', background: 'rgba(84,217,255,.05)', color: tones.cyan, borderRadius: 8, padding: '7px 10px', fontSize: 9, cursor: 'pointer' }}>Open product <ArrowUpRight size={11} /></button></div>)}</div></Glass>}
    </main>

    {palette && <div onMouseDown={() => setPalette(false)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(1,7,13,.72)', backdropFilter: 'blur(13px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '9vh' }}><div onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(720px,calc(100vw - 26px))', border: '1px solid rgba(84,217,255,.18)', borderRadius: 20, background: '#091624', boxShadow: '0 30px 100px rgba(0,0,0,.62)', overflow: 'hidden' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 17px', borderBottom: '1px solid rgba(255,255,255,.07)' }}><Command size={16} color={tones.cyan} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search intelligence, entities, operations, countries…" style={{ flex: 1, border: 0, outline: 0, background: 'transparent', color: '#e8edf4', fontSize: 13 }} /><button onClick={() => setPalette(false)} style={{ border: 0, background: 'transparent', color: '#71849a', cursor: 'pointer' }}><X size={15} /></button></div><div style={{ padding: 9, maxHeight: '55vh', overflow: 'auto' }}>{NAV.filter((item) => profile.views.includes(item.id)).filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase())).map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => go(item.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 9px', border: 0, borderRadius: 10, background: 'transparent', color: '#dce5ee', cursor: 'pointer', textAlign: 'left' }}><span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'rgba(84,217,255,.06)', color: tones.cyan }}><Icon size={14} /></span><span style={{ flex: 1 }}><b style={{ fontSize: 11 }}>{item.label}</b><small style={{ display: 'block', fontSize: 9, color: '#687c91', marginTop: 3 }}>{item.hint}</small></span><ChevronRight size={13} color="#42566b" /></button> })}{!NAV.some((item) => profile.views.includes(item.id) && `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase())) && <div style={{ padding: 30, textAlign: 'center', color: '#667a90', fontSize: 10 }}>No intelligence surface matches that query.</div>}</div><div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 8, color: '#52667a', fontFamily: 'IBM Plex Mono,monospace' }}>INTELLIGENCE COMMAND<span>ESC TO CLOSE</span></div></div></div>}

    {drawer && <div onMouseDown={() => setDrawer(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(1,7,13,.46)', backdropFilter: 'blur(4px)' }}><aside onMouseDown={(event) => event.stopPropagation()} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 'min(490px,94vw)', background: '#091624', borderLeft: '1px solid rgba(84,217,255,.16)', boxShadow: '-30px 0 90px rgba(0,0,0,.5)', padding: 22, overflow: 'auto' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontSize: 8, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace', letterSpacing: '.16em' }}>INTELLIGENCE OBJECT · {drawer.id}</div><button onClick={() => setDrawer(null)} style={{ border: 0, background: 'transparent', color: '#71849a', cursor: 'pointer' }}><X size={17} /></button></div><div style={{ fontSize: 25, fontWeight: 750, letterSpacing: '-.035em', marginTop: 13 }}>{drawer.title}</div><div style={{ display: 'flex', gap: 6, marginTop: 10 }}><Pill tone={drawer.severity === 'HIGH' ? 'red' : 'amber'}>{drawer.severity} RELEVANCE</Pill><Pill>PROVENANCE LINKED</Pill></div><div style={{ marginTop: 20, padding: 14, borderRadius: 14, border: '1px solid rgba(84,217,255,.1)', background: 'rgba(84,217,255,.03)' }}><div style={{ fontSize: 8, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace' }}>ASSESSMENT</div><div style={{ fontSize: 11, lineHeight: 1.8, marginTop: 7, color: '#c8d3df' }}>{drawer.detail}</div></div><div style={{ marginTop: 20, display: 'grid' }}>{[['CONFIDENCE', `${drawer.confidence}%`], ['RECENCY', drawer.time], ['LOCATION', drawer.place], ['SOURCE', drawer.source], ['OPERATIONAL RELEVANCE', 'ELEVATED']].map(([label, value]) => <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 9 }}><span style={{ color: '#667b90', fontFamily: 'IBM Plex Mono,monospace' }}>{label}</span><span>{value}</span></div>)}</div><div style={{ marginTop: 22, fontSize: 8, color: tones.cyan, fontFamily: 'IBM Plex Mono,monospace', letterSpacing: '.16em' }}>EVIDENCE CHAIN</div><div style={{ marginTop: 9, display: 'grid', gap: 7 }}>{['Observation · OBS-882', `Event · ${drawer.id}`, 'Storyline · SL-017', 'Operation · CVY-041'].map((item, index) => <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.05)', fontSize: 9 }}><Link2 size={12} color={tones.cyan} />{item}{index < 3 && <ChevronRight size={11} color="#40566b" style={{ marginLeft: 'auto' }} />}</div>)}</div></aside></div>}
  </div>
}
