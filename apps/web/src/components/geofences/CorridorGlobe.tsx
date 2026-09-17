import { useMemo, useState } from 'react';
import { Bot, BrainCircuit, Crosshair, DatabaseZap, Eye, Gauge, ScanSearch, ShieldCheck, Sparkles, Timer, Truck, Waypoints, X } from 'lucide-react';
import CorridorWorldScene, { type GlobeMember, type LatLng, type RiskZone } from './CorridorWorldScene.js';
import CorridorOperationalMap from './CorridorOperationalMap.js';
import { runXdSurveillanceAgents, type XdDimension } from './xdSurveillanceAgents.js';

export type { LatLng, GlobeMember, RiskZone };

type Props = { route: LatLng[]; corridorKm: number; members: GlobeMember[]; zones?: RiskZone[]; ceilingM?: number; focusId?: string | null; trail?: LatLng[]; onSelect?: (id: string | null) => void; fill?: boolean };
type View = '2D' | '3D';
const DIMENSIONS: { key: XdDimension; icon: typeof Crosshair }[] = [
  { key: 'SPACE', icon: Crosshair }, { key: 'TIME', icon: Timer }, { key: 'IDENTITY', icon: Truck }, { key: 'MOTION', icon: Gauge },
  { key: 'INTEGRITY', icon: ShieldCheck }, { key: 'SECURITY', icon: Eye }, { key: 'EVIDENCE', icon: DatabaseZap }, { key: 'FUTURE', icon: Waypoints },
];
function context(member?: GlobeMember | null) { const m = member as (GlobeMember & { convoy_name?: string | null; client_name?: string | null }) | undefined; return { convoy: m?.convoy_name ?? null, client: m?.client_name ?? null }; }

export default function CorridorGlobe({ route, corridorKm, members, zones = [], ceilingM = 0, focusId = null, trail, onSelect, fill = false }: Props) {
  const [view, setView] = useState<View>('2D');
  const [dimension, setDimension] = useState<XdDimension>('SPACE');
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [entityOpen, setEntityOpen] = useState(true);
  const live = members.filter(m => m.lat != null && m.lng != null);
  const snapshot = useMemo(() => runXdSurveillanceAgents(route, members, zones), [route, members, zones]);
  const focused = focusId ? members.find(m => m.id === focusId) : null;
  const idContext = context(focused);

  return (
    <div className={`${fill ? 'h-full' : 'h-[520px]'} relative overflow-hidden bg-[#05070b] text-white`}>
      {view === '2D' ? <CorridorOperationalMap route={route} members={members} zones={zones} focusId={focusId} onSelect={onSelect} mapMode="dark" /> : <CorridorWorldScene route={route} corridorKm={corridorKm} members={members} zones={zones} ceilingM={ceilingM} focusId={focusId} trail={trail} onSelect={onSelect} fill />}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-3">
        <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-2">
          <div className="max-w-[72vw] rounded-2xl border border-white/10 bg-[#05070c]/88 px-3.5 py-2.5 shadow-2xl backdrop-blur-2xl">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><ScanSearch size={13} /></span><span className="text-[13px] font-semibold tracking-[0.08em]">XD LIVE SURVEILLANCE</span></div>
              <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-neutral-500">8D WORLD CONTROL</span>
              <span className="h-1 w-1 rounded-full bg-emerald-400" />
              <span className="text-[9px] font-mono text-emerald-300">{live.length} POSITIONED</span>
              <span className="text-[9px] font-mono text-neutral-500">{snapshot.agents.length} SPECIALISTS</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] font-mono text-neutral-500"><span>REAL-TIME WORLD MODEL</span><span>·</span><span>ACTUAL ≠ EXPECTED ≠ PREDICTED</span><span>·</span><span>MAP {view}</span></div>
          </div>
          <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-[#05070c]/88 p-1 shadow-2xl backdrop-blur-2xl">
            <button type="button" onClick={() => setView('2D')} className={`rounded-xl px-2.5 py-1.5 text-[10px] font-mono ${view === '2D' ? 'bg-white/12 text-white' : 'text-neutral-500 hover:text-white'}`}>2D</button>
            <button type="button" onClick={() => setView('3D')} className={`rounded-xl px-2.5 py-1.5 text-[10px] font-mono ${view === '3D' ? 'bg-violet-500/15 text-violet-200' : 'text-neutral-500 hover:text-white'}`}>3D</button>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button type="button" onClick={() => setAgentsOpen(v => !v)} className={`grid h-8 w-8 place-items-center rounded-xl ${agentsOpen ? 'bg-cyan-400/10 text-cyan-200' : 'text-neutral-400 hover:bg-white/10 hover:text-white'}`} aria-label="Toggle specialist swarm"><Bot size={14} /></button>
            <button type="button" onClick={() => setEntityOpen(v => !v)} className={`grid h-8 w-8 place-items-center rounded-xl ${entityOpen ? 'bg-violet-400/10 text-violet-200' : 'text-neutral-400 hover:bg-white/10 hover:text-white'}`} aria-label="Toggle entity intelligence"><Truck size={14} /></button>
          </div>
        </div>
      </div>

      <aside className="pointer-events-none absolute inset-y-0 left-0 z-20 flex w-[58px] flex-col justify-center px-2 pt-16 pb-14">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#05070c]/84 p-1.5 shadow-2xl backdrop-blur-2xl">
          <div className="mb-1 grid h-7 place-items-center rounded-xl text-[8px] font-mono tracking-widest text-neutral-600">8D</div>
          {DIMENSIONS.map(({ key, icon: Icon }) => <button key={key} type="button" onClick={() => setDimension(key)} title={key} aria-label={key} className={`mb-1 grid h-9 w-full place-items-center rounded-xl transition ${dimension === key ? 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/20' : 'text-neutral-500 hover:bg-white/5 hover:text-white'}`}><Icon size={14} /></button>)}
        </div>
      </aside>

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2"><div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-[#05070c]/88 px-3 py-2 shadow-2xl backdrop-blur-2xl"><span className="text-[9px] font-mono uppercase tracking-[0.18em] text-violet-300">{dimension}</span><span className="h-4 w-px bg-white/10" /><span className="text-[9px] font-mono text-neutral-500">GPU/LOD ADAPTIVE</span></div></div>

      {entityOpen && <section className="pointer-events-auto absolute right-3 top-[86px] z-20 w-[min(340px,calc(100vw-88px))] rounded-2xl border border-white/10 bg-[#05070c]/90 p-3 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-2"><div><p className="text-[9px] font-mono uppercase tracking-[0.18em] text-violet-300">ENTITY INTELLIGENCE</p><h3 className="mt-1 text-[13px] font-semibold text-white">{focused?.name ?? 'World overview'}</h3>{focused ? <><p className="mt-1 text-[9px] font-mono text-violet-200">{idContext.convoy ?? 'Convoy unresolved'}{idContext.client ? ` · ${idContext.client}` : ''}</p><div className="mt-2 grid grid-cols-3 gap-1.5 text-[9px] font-mono"><div className="rounded-lg border border-white/5 bg-white/[0.02] p-2"><span className="block text-neutral-600">STATE</span><span className="text-neutral-200">{focused.position_state ?? 'observed'}</span></div><div className="rounded-lg border border-white/5 bg-white/[0.02] p-2"><span className="block text-neutral-600">CONF</span><span className="text-emerald-300">{focused.position_confidence != null ? `${Math.round(focused.position_confidence * 100)}%` : '—'}</span></div><div className="rounded-lg border border-white/5 bg-white/[0.02] p-2"><span className="block text-neutral-600">SPEED</span><span className="text-neutral-200">{focused.speed_kph != null ? `${Math.round(focused.speed_kph)} km/h` : '—'}</span></div></div></> : <p className="mt-1 text-[10px] text-neutral-500">Select a live entity to inspect identity, provenance and current world state.</p>}</div><button type="button" onClick={() => setEntityOpen(false)} className="grid h-7 w-7 place-items-center rounded-lg text-neutral-600 hover:bg-white/5 hover:text-white"><X size={13} /></button></div>
      </section>}

      {agentsOpen && <section className="pointer-events-auto absolute bottom-14 left-[72px] z-20 w-[min(460px,calc(100vw-92px))] rounded-2xl border border-cyan-400/15 bg-[#05070c]/94 p-3 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center justify-between"><div><p className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.18em] text-cyan-300"><Sparkles size={12} /> SPECIALIST SWARM</p><p className="mt-1 text-[10px] text-neutral-500">Independent interpreters; deterministic telemetry, geofences and audit evidence remain authoritative.</p></div><div className="text-right text-[9px] font-mono text-neutral-500"><div>{snapshot.alerts} alert lanes</div><div>{snapshot.visible} positioned</div></div></div>
        <div className="mt-3 grid max-h-[250px] grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">{snapshot.agents.map(agent => <div key={agent.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-[10px] font-semibold text-neutral-200">{agent.label}</span><span className={`rounded-full px-1.5 py-0.5 text-[8px] font-mono uppercase ${agent.state === 'alert' ? 'bg-red-500/10 text-red-300' : agent.state === 'watch' ? 'bg-amber-500/10 text-amber-200' : agent.state === 'degraded' ? 'bg-neutral-500/10 text-neutral-400' : 'bg-emerald-500/10 text-emerald-300'}`}>{agent.state}</span></div><div className="mt-1.5 flex items-center justify-between text-[8px] font-mono text-neutral-600"><span>{agent.dimension}</span><span>{Math.round(agent.confidence * 100)}% confidence</span></div><p className="mt-1 text-[9px] leading-relaxed text-neutral-500">{agent.summary}</p></div>)}</div>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[8px] font-mono text-neutral-600"><BrainCircuit size={11} /><span>OPEN-WEIGHT LANES · QWEN3-VL 30B-A3B · QWEN3-VL 8B · QWEN3-VL 4B/GGUF · ADAPTERS STANDBY</span></div>
      </section>}
    </div>
  );
}
