import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  Crosshair,
  Filter,
  Globe2,
  Layers3,
  Map,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  Signal,
  Target,
  Truck,
  X,
} from 'lucide-react'
import { useRiskZones } from '../features/risk-intel/hooks/useRiskZones.js'
import { useLiveFeed } from '../features/risk-intel/hooks/useLiveFeed.js'
import { useRiskTicker } from '../features/risk-intel/hooks/useRiskTicker.js'
import { useRiskConvoys } from '../features/risk-intel/hooks/useRiskConvoys.js'
import type { RiskLevel, RiskZone } from '../features/risk-intel/types/risk.js'
import RiskIntelPage from '../features/risk-intel/RiskIntelPage.js'

type View = 'room' | 'atlas' | 'signals' | 'exposure'

type FeedItem = {
  id: string
  description: string
  level: RiskLevel
  source: string
  external_url: string | null
  occurred_at: string
  zone_code: string
  zone_name: string
  continent: string
}

const LEVEL_META: Record<RiskLevel, { label: string; className: string }> = {
  high: { label: 'HIGH', className: 'intel-high' },
  medium: { label: 'MEDIUM', className: 'intel-medium' },
  low: { label: 'LOW', className: 'intel-low' },
}

function age(iso?: string) {
  if (!iso) return '—'
  const delta = Math.max(0, Date.now() - new Date(iso).getTime())
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function confidence(value?: number) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${Math.round(value > 1 ? value : value * 100)}%`
}

function ZoneRow({ zone, selected, onSelect }: { zone: RiskZone; selected: boolean; onSelect: () => void }) {
  const meta = LEVEL_META[zone.level]
  return (
    <button className={`zone-row ${selected ? 'selected' : ''}`} onClick={onSelect} type="button">
      <span className={`severity-dot ${meta.className}`} />
      <span className="zone-main">
        <span className="zone-name">{zone.name}</span>
        <span className="zone-sub">{zone.region} · {zone.zone_code}</span>
      </span>
      <span className="zone-stat"><b>{zone.events_24h}</b><small>24H</small></span>
      <span className="zone-stat"><b>{confidence(zone.confidence)}</b><small>CONF</small></span>
      <span className={`velocity ${zone.velocity}`}>{zone.velocity === 'rising' ? '↑' : zone.velocity === 'falling' ? '↓' : '→'}</span>
      <ChevronRight size={15} />
    </button>
  )
}

function SignalRow({ item, onSelect }: { item: FeedItem; onSelect: () => void }) {
  const meta = LEVEL_META[item.level]
  return (
    <button className="signal-row" onClick={onSelect} type="button">
      <span className={`severity-line ${meta.className}`} />
      <span className="signal-time">{age(item.occurred_at)}</span>
      <span className="signal-body">
        <strong>{item.zone_name}</strong>
        <span>{item.description}</span>
      </span>
      <span className="signal-source">{item.source}</span>
      <ArrowUpRight size={14} />
    </button>
  )
}

export default function IntelligenceCentre() {
  const [view, setView] = useState<View>('room')
  const [continent, setContinent] = useState('global')
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [selectedSignal, setSelectedSignal] = useState<FeedItem | null>(null)
  const [query, setQuery] = useState('')

  const zonesQuery = useRiskZones(continent)
  const feedQuery = useLiveFeed(continent)
  const tickerQuery = useRiskTicker(continent)
  const convoysQuery = useRiskConvoys(continent)

  const zones = zonesQuery.data?.zones ?? []
  const feed = (feedQuery.data?.items ?? []) as FeedItem[]
  const ticker = tickerQuery.data?.items ?? []
  const convoys = convoysQuery.data?.convoys ?? []

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.id === selectedZoneId) ?? null,
    [zones, selectedZoneId],
  )

  const filteredZones = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return zones
    return zones.filter((zone) => `${zone.name} ${zone.region} ${zone.zone_code} ${zone.tags.join(' ')}`.toLowerCase().includes(needle))
  }, [zones, query])

  const sortedZones = useMemo(
    () => [...filteredZones].sort((a, b) => Number(b.level === 'high') - Number(a.level === 'high') || b.events_24h - a.events_24h),
    [filteredZones],
  )

  const high = zones.filter((z) => z.level === 'high').length
  const rising = zones.filter((z) => z.velocity === 'rising').length
  const affected = convoys.filter((c) => c.affected_zones.length > 0).length
  const isRefreshing = zonesQuery.isFetching || feedQuery.isFetching || convoysQuery.isFetching

  const selectZone = (zone: RiskZone) => setSelectedZoneId((current) => current === zone.id ? null : zone.id)

  return (
    <div className="intel-shell">
      <style>{`
        .intel-shell{min-height:100%;background:#080a0d;color:#e9edf2;display:flex;flex-direction:column;font-family:inherit}
        .intel-top{height:64px;display:flex;align-items:center;gap:24px;padding:0 24px;border-bottom:1px solid #20242a;background:#0a0c10;position:sticky;top:0;z-index:20}
        .intel-brand{display:flex;align-items:center;gap:11px;min-width:245px}.intel-brand-mark{width:30px;height:30px;border:1px solid #4a515a;display:grid;place-items:center;background:#0d1014}.intel-brand h1{font-size:13px;letter-spacing:.16em;font-weight:650;margin:0}.intel-brand span{display:block;font-size:10px;color:#727b86;letter-spacing:.1em;margin-top:3px}
        .intel-nav{display:flex;height:100%;align-items:center;gap:4px}.intel-nav button{height:100%;padding:0 14px;background:transparent;border:0;border-bottom:2px solid transparent;color:#737d88;font:inherit;font-size:12px;cursor:pointer}.intel-nav button.active{color:#eef1f4;border-bottom-color:#c8d0d8}
        .intel-top-actions{margin-left:auto;display:flex;align-items:center;gap:9px}.live-chip{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #252a31;color:#9ca5af;font-size:10px;letter-spacing:.08em}.live-dot{width:6px;height:6px;border-radius:50%;background:#8ed39a;box-shadow:0 0 0 3px #8ed39a18}.icon-btn{width:32px;height:32px;border:1px solid #252a31;background:#0d1014;color:#8f98a2;display:grid;place-items:center;cursor:pointer}.icon-btn:hover{color:#fff;border-color:#444b54}
        .intel-toolbar{min-height:48px;border-bottom:1px solid #1d2127;display:flex;align-items:center;padding:0 24px;gap:8px;background:#090b0e}.scope{display:flex;align-items:center;gap:5px;padding:5px;border:1px solid #242930}.scope button{border:0;background:transparent;color:#707984;font-size:10px;letter-spacing:.08em;padding:6px 10px;cursor:pointer}.scope button.active{background:#e9edf2;color:#080a0d}.searchbox{height:30px;width:210px;margin-left:auto;display:flex;align-items:center;gap:8px;padding:0 9px;border:1px solid #252a31;background:#0c0f13;color:#727b85}.searchbox input{border:0;outline:0;background:transparent;color:#dfe4e9;width:100%;font-size:11px}.refreshing{font-size:10px;color:#606a74;display:flex;gap:6px;align-items:center}
        .intel-content{display:grid;grid-template-columns:minmax(0,1fr) 390px;min-height:calc(100vh - 113px)}
        .main-stage{min-width:0;border-right:1px solid #20242a}.stage-head{height:72px;padding:0 24px;display:flex;align-items:end;justify-content:space-between}.eyebrow{font-size:9px;color:#6d7680;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px}.stage-title{font-size:27px;letter-spacing:-.03em;font-weight:540;margin:0}.stage-copy{font-size:11px;color:#707983;margin-top:6px}.metrics{display:flex;gap:24px;align-items:end}.metric b{font-size:20px;font-weight:520;display:block;text-align:right}.metric span{font-size:9px;color:#69727c;letter-spacing:.11em;display:block;margin-top:3px;text-align:right}
        .decision-strip{margin:22px 24px 0;border:1px solid #272c33;background:#0b0e12;display:grid;grid-template-columns:1.3fr .7fr .7fr}.decision-cell{padding:15px 16px;border-right:1px solid #22272e}.decision-cell:last-child{border-right:0}.decision-label{font-size:9px;color:#68717b;letter-spacing:.13em;text-transform:uppercase}.decision-value{font-size:15px;margin-top:7px}.decision-value em{font-style:normal;color:#d6dce2}.decision-note{font-size:10px;color:#747e88;margin-top:5px;line-height:1.45}
        .workspace{padding:18px 24px 28px}.workspace-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(300px,.7fr);gap:14px}.panel{border:1px solid #252a31;background:#0b0e12;min-width:0}.panel-head{height:48px;padding:0 14px;display:flex;align-items:center;border-bottom:1px solid #22272e}.panel-title{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#aeb6bf}.panel-head .muted{margin-left:auto;font-size:9px;color:#616a74}.zone-list{padding:3px 0}.zone-row{width:100%;display:grid;grid-template-columns:9px minmax(0,1fr) 48px 58px 24px 15px;gap:10px;align-items:center;padding:12px 14px;border:0;border-bottom:1px solid #171b20;background:transparent;color:#dce1e6;text-align:left;cursor:pointer}.zone-row:hover,.zone-row.selected{background:#101419}.severity-dot{width:6px;height:6px;border-radius:50%}.zone-main{min-width:0}.zone-name{font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.zone-sub{font-size:9px;color:#68727c;margin-top:4px;display:block}.zone-stat{text-align:right}.zone-stat b{font-size:11px;font-weight:500;display:block}.zone-stat small{font-size:7px;color:#59626c;letter-spacing:.08em}.velocity{text-align:center;font-size:14px}.velocity.rising{color:#e3a27d}.velocity.stable{color:#8b949d}.velocity.falling{color:#87b991}
        .signal-list{max-height:455px;overflow:auto}.signal-row{width:100%;display:grid;grid-template-columns:2px 32px minmax(0,1fr) 85px 14px;gap:10px;align-items:center;padding:12px 13px;border:0;border-bottom:1px solid #171b20;background:transparent;color:#dce1e6;text-align:left;cursor:pointer}.signal-row:hover{background:#101419}.severity-line{height:31px;width:2px}.signal-time{font-size:9px;color:#606a74}.signal-body{min-width:0}.signal-body strong{font-size:10px;font-weight:600;display:block;color:#bfc6ce}.signal-body span{font-size:10px;color:#747e88;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.signal-source{font-size:8px;color:#59626c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
        .intel-high{background:#d77b67;color:#d77b67}.intel-medium{background:#c4a36a;color:#c4a36a}.intel-low{background:#7ea688;color:#7ea688}
        .atlas-frame{height:calc(100vh - 185px);min-height:620px;background:#07090c;position:relative;overflow:hidden}.atlas-frame .risk-embedded{height:100%}.atlas-frame iframe{width:100%;height:100%;border:0}.atlas-note{position:absolute;left:16px;bottom:16px;border:1px solid #2a3037;background:#090c10e8;padding:9px 11px;font-size:9px;color:#7b848e;z-index:2}.atlas-note b{color:#c7cdd4;font-weight:500}
        .exposure-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.exposure-item{padding:15px;border:1px solid #252a31;background:#0b0e12}.exposure-item strong{font-size:14px;font-weight:500;display:block}.exposure-item span{display:block;color:#6f7882;font-size:10px;margin-top:5px}.exposure-bar{height:2px;background:#22272d;margin-top:16px}.exposure-bar i{display:block;height:100%;background:#b9c1c9}.convoy-row{display:flex;align-items:center;gap:11px;padding:12px 14px;border-bottom:1px solid #171b20}.convoy-icon{width:28px;height:28px;border:1px solid #282e35;display:grid;place-items:center;color:#808993}.convoy-row strong{font-size:10px;font-weight:550}.convoy-row span{font-size:9px;color:#68727c;display:block;margin-top:3px}.convoy-risk{margin-left:auto;font-size:9px;text-transform:uppercase;letter-spacing:.08em}
        .side{background:#090b0e}.side-head{height:72px;padding:0 17px;display:flex;align-items:end;border-bottom:1px solid #20242a}.side-title{font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:16px}.side-section{border-bottom:1px solid #20242a}.side-section-head{padding:13px 17px 9px;font-size:9px;color:#626b75;letter-spacing:.12em;text-transform:uppercase}.detail{padding:14px 17px}.detail-kicker{font-size:9px;color:#6a737d;letter-spacing:.1em}.detail h2{font-size:18px;font-weight:520;margin:6px 0}.detail p{font-size:10px;line-height:1.6;color:#7d8690;margin:0}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#20242a;border:1px solid #20242a;margin-top:14px}.detail-stat{background:#0b0e12;padding:10px}.detail-stat b{font-size:13px;font-weight:500;display:block}.detail-stat span{font-size:8px;color:#626b75;letter-spacing:.08em;margin-top:3px;display:block}.tagline{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}.tag{font-size:8px;color:#858e98;border:1px solid #2a3037;padding:4px 6px}.action{width:100%;height:34px;border:1px solid #384049;background:#dfe4e8;color:#080a0d;font-size:10px;font-weight:600;letter-spacing:.04em;cursor:pointer;margin-top:14px}.action:hover{background:#fff}.empty{padding:30px 18px;color:#616a74;font-size:10px;line-height:1.6}.error{padding:18px;color:#c78979;font-size:10px;border:1px solid #402c28;margin:14px}
        .signal-detail{position:fixed;right:0;top:0;width:390px;height:100vh;background:#0b0e12;border-left:1px solid #343a42;z-index:50;box-shadow:-20px 0 50px #0008;display:flex;flex-direction:column}.signal-detail-head{height:64px;padding:0 16px;display:flex;align-items:center;border-bottom:1px solid #242930}.signal-detail-head span{font-size:9px;color:#66707a;letter-spacing:.12em}.signal-detail-head button{margin-left:auto}.signal-detail-body{padding:22px 18px;overflow:auto}.signal-detail-body h2{font-size:20px;font-weight:520;line-height:1.2;margin:8px 0 12px}.signal-detail-body p{font-size:11px;color:#7e8790;line-height:1.7}.evidence{margin-top:22px;border-top:1px solid #252a31}.evidence-row{padding:12px 0;border-bottom:1px solid #1b2026;display:flex;justify-content:space-between;gap:15px;font-size:9px}.evidence-row span{color:#626c76}.evidence-row b{font-weight:500;color:#c6cdd4;text-align:right}
        @media(max-width:1100px){.intel-content{grid-template-columns:1fr}.side{display:none}.workspace-grid{grid-template-columns:1fr}.intel-nav{display:none}.intel-brand{min-width:auto}.metrics{display:none}.decision-strip{grid-template-columns:1fr}.decision-cell{border-right:0;border-bottom:1px solid #22272e}.decision-cell:last-child{border-bottom:0}}
        @media(max-width:700px){.intel-top{padding:0 14px}.intel-toolbar{padding:0 14px}.stage-head{padding:0 14px}.workspace{padding:14px}.searchbox{width:120px}.zone-row{grid-template-columns:8px minmax(0,1fr) 42px 50px 18px 12px}.signal-source{display:none}.signal-row{grid-template-columns:2px 27px minmax(0,1fr) 14px}.decision-strip{margin:14px}.intel-brand span{display:none}.stage-title{font-size:22px}}
      `}</style>

      <header className="intel-top">
        <div className="intel-brand">
          <div className="intel-brand-mark"><Crosshair size={16} /></div>
          <div><h1>SONALIT / INTELLIGENCE</h1><span>DECISION ENVIRONMENT</span></div>
        </div>
        <nav className="intel-nav" aria-label="Intelligence views">
          {([['room', 'Situation'], ['atlas', 'Atlas'], ['signals', 'Signals'], ['exposure', 'Exposure']] as [View, string][]).map(([id, label]) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)} type="button">{label}</button>
          ))}
        </nav>
        <div className="intel-top-actions">
          <div className="live-chip"><span className="live-dot" /> LIVE DATA</div>
          <button className="icon-btn" title="Refresh intelligence feeds" onClick={() => { void zonesQuery.refetch(); void feedQuery.refetch(); void convoysQuery.refetch() }} type="button"><RefreshCw size={14} className={isRefreshing ? 'spin' : ''} /></button>
        </div>
      </header>

      <div className="intel-toolbar">
        <div className="scope">
          {['global', 'africa', 'mideast'].map((item) => <button key={item} className={continent === item ? 'active' : ''} onClick={() => setContinent(item)} type="button">{item === 'mideast' ? 'MIDDLE EAST' : item.toUpperCase()}</button>)}
        </div>
        <div className="searchbox"><Search size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter live intelligence" aria-label="Filter live intelligence" /></div>
        {isRefreshing && <div className="refreshing"><Activity size={11} /> SYNCING</div>}
      </div>

      {view === 'atlas' ? (
        <main className="atlas-frame">
          <RiskIntelPage />
          <div className="atlas-note"><b>LIVE ATLAS</b> · risk zones and operational intelligence</div>
        </main>
      ) : (
        <div className="intel-content">
          <main className="main-stage">
            <div className="stage-head">
              <div><div className="eyebrow">{view === 'room' ? 'Command view' : view === 'signals' ? 'Evidence stream' : 'Operational exposure'}</div><h2 className="stage-title">{view === 'room' ? 'Situation Room' : view === 'signals' ? 'Signal Stream' : 'Operational Exposure'}</h2><div className="stage-copy">Live operational picture · {continent === 'global' ? 'all monitored regions' : continent}</div></div>
              <div className="metrics"><div className="metric"><b>{zones.length}</b><span>MONITORED</span></div><div className="metric"><b>{high}</b><span>HIGH RISK</span></div><div className="metric"><b>{rising}</b><span>RISING</span></div></div>
            </div>

            {view === 'room' && (
              <>
                <div className="decision-strip">
                  <div className="decision-cell"><div className="decision-label">Current signal</div><div className="decision-value">{ticker[0]?.text ?? 'No current ticker signal'}</div><div className="decision-note">{ticker[0] ? `${ticker[0].zone_code} · ${age(ticker[0].occurred_at)}` : 'The live feed has not returned a current signal.'}</div></div>
                  <div className="decision-cell"><div className="decision-label">Exposure</div><div className="decision-value">{affected} <em>active movement{affected === 1 ? '' : 's'}</em></div><div className="decision-note">movements intersecting monitored risk zones</div></div>
                  <div className="decision-cell"><div className="decision-label">Trajectory</div><div className="decision-value">{rising} <em>rising zone{rising === 1 ? '' : 's'}</em></div><div className="decision-note">derived from live risk-zone telemetry</div></div>
                </div>
                <div className="workspace"><div className="workspace-grid">
                  <section className="panel"><div className="panel-head"><span className="panel-title">Risk environment</span><span className="muted">{filteredZones.length} zones</span></div><div className="zone-list">{zonesQuery.isLoading ? <div className="empty">Loading live risk environment…</div> : sortedZones.length === 0 ? <div className="empty">No risk zones match the current scope or filter.</div> : sortedZones.slice(0, 8).map((zone) => <ZoneRow key={zone.id} zone={zone} selected={zone.id === selectedZoneId} onSelect={() => selectZone(zone)} />)}</div></section>
                  <section className="panel"><div className="panel-head"><span className="panel-title">Latest signals</span><span className="muted">{feed.length} returned</span></div><div className="signal-list">{feedQuery.isLoading ? <div className="empty">Loading live signals…</div> : feed.length === 0 ? <div className="empty">No live signals are currently available for this scope.</div> : feed.slice(0, 8).map((item) => <SignalRow key={item.id} item={item} onSelect={() => setSelectedSignal(item)} />)}</div></section>
                </div></div>
              </>
            )}

            {view === 'signals' && <div className="workspace"><section className="panel"><div className="panel-head"><span className="panel-title">Live evidence</span><span className="muted">ordered by source timestamp</span></div><div className="signal-list">{feedQuery.isLoading ? <div className="empty">Loading live signals…</div> : feed.length === 0 ? <div className="empty">No live signals are currently available.</div> : feed.map((item) => <SignalRow key={item.id} item={item} onSelect={() => setSelectedSignal(item)} />)}</div></section></div>}

            {view === 'exposure' && <div className="workspace"><div className="exposure-grid"><section className="panel"><div className="panel-head"><span className="panel-title">Risk environment</span></div><div className="zone-list">{sortedZones.map((zone) => <ZoneRow key={zone.id} zone={zone} selected={zone.id === selectedZoneId} onSelect={() => selectZone(zone)} />)}</div></section><section className="panel"><div className="panel-head"><span className="panel-title">Affected movements</span><span className="muted">{convoys.length} returned</span></div>{convoys.length === 0 ? <div className="empty">No convoy exposure records are currently returned for this scope.</div> : convoys.map((convoy) => <div className="convoy-row" key={convoy.id}><div className="convoy-icon"><Truck size={14} /></div><div><strong>{convoy.name}</strong><span>{convoy.status} · {convoy.continent}</span></div><div className={`convoy-risk ${convoy.highest_level}`}>{convoy.highest_level}</div></div>)}</section></div></div>}
          </main>

          <aside className="side">
            <div className="side-head"><div className="side-title">Intelligence detail</div></div>
            {selectedZone ? <div className="detail"><div className="detail-kicker">{selectedZone.zone_code} · {selectedZone.level.toUpperCase()}</div><h2>{selectedZone.name}</h2><p>{selectedZone.why}</p><div className="detail-grid"><div className="detail-stat"><b>{selectedZone.events_24h}</b><span>EVENTS / 24H</span></div><div className="detail-stat"><b>{confidence(selectedZone.confidence)}</b><span>CONFIDENCE</span></div><div className="detail-stat"><b>{selectedZone.radius_km} km</b><span>ZONE RADIUS</span></div><div className="detail-stat"><b>{age(selectedZone.updated_at)}</b><span>UPDATED</span></div></div><div className="tagline">{selectedZone.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div><button className="action" type="button" onClick={() => setView('atlas')}>OPEN ON LIVE ATLAS <Map size={13} style={{ verticalAlign: 'middle', marginLeft: 6 }} /></button></div> : <div className="empty">Select a risk zone to inspect its live context, evidence volume and trajectory. Nothing is invented here; every value is drawn from the live intelligence feed.</div>}
            <div className="side-section"><div className="side-section-head">Feed integrity</div><div className="detail"><div className="detail-grid"><div className="detail-stat"><b>{feed.length}</b><span>LIVE SIGNALS</span></div><div className="detail-stat"><b>{convoys.length}</b><span>MOVEMENTS</span></div></div></div></div>
          </aside>
        </div>
      )}

      {selectedSignal && <div className="signal-detail"><div className="signal-detail-head"><span>SIGNAL / {selectedSignal.zone_code}</span><button className="icon-btn" onClick={() => setSelectedSignal(null)} type="button"><X size={14} /></button></div><div className="signal-detail-body"><div className={`eyebrow ${LEVEL_META[selectedSignal.level].className}`}>{selectedSignal.level.toUpperCase()} · {age(selectedSignal.occurred_at)}</div><h2>{selectedSignal.zone_name}</h2><p>{selectedSignal.description}</p><div className="evidence"><div className="evidence-row"><span>Source</span><b>{selectedSignal.source}</b></div><div className="evidence-row"><span>Observed</span><b>{new Date(selectedSignal.occurred_at).toLocaleString()}</b></div><div className="evidence-row"><span>Region</span><b>{selectedSignal.continent}</b></div></div>{selectedSignal.external_url && <button className="action" type="button" onClick={() => window.open(selectedSignal.external_url!, '_blank', 'noopener,noreferrer')}>OPEN SOURCE <ArrowUpRight size={13} style={{ verticalAlign: 'middle', marginLeft: 6 }} /></button>}</div></div>}
    </div>
  )
}
