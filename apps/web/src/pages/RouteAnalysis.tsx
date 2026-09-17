import React, { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, Crosshair, Database,
  FlaskConical, Loader2, MapPinned, Navigation, RefreshCw, Route as RouteIcon,
  ShieldAlert, ShieldCheck, TriangleAlert, XCircle
} from 'lucide-react';
import { api } from '../lib/api.js';
import PortalMap from '../components/PortalMap.js';

interface Waypoint { lat: number; lng: number; }
interface RouteOption {
  label: string; waypoints: Waypoint[]; distance_km: number;
  estimated_duration_minutes: number; risk_score: number;
  risk_factors: string[]; notes: string | null;
}
interface RouteAnalysis {
  id: string; org_id: string; convoy_id: string | null;
  origin_lat: number; origin_lng: number; destination_lat: number; destination_lng: number;
  overall_risk_score: number; primary_risk_factors: string[];
  recommended_route: RouteOption; alternate_routes: RouteOption[];
  ai_summary: string | null; analysed_at: string; requested_by_name: string | null;
  analysis_version?: string; routing_provider?: string | null; route_status?: string;
  risk_zone_count?: number; cache_hit?: boolean; route_evidence?: Record<string, unknown>;
}

interface AnalyseForm {
  origin_lat: string; origin_lng: string; dest_lat: string; dest_lng: string;
  departure_time: string; avoid_night: boolean; convoy_id: string;
}
const EMPTY: AnalyseForm = {
  origin_lat:'', origin_lng:'', dest_lat:'', dest_lng:'', departure_time:'', avoid_night:false, convoy_id:''
};

const factorLabel: Record<string,string> = {
  armed_robbery:'Armed robbery / banditry', carjacking:'Carjacking', road_condition:'Road condition',
  weather:'Weather / natural hazard', civil_unrest:'Civil unrest', border_delay:'Border delay',
  fuel_scarcity:'Fuel scarcity', night_travel:'Night travel', other:'Other'
};

function scoreLabel(score:number){ return score >= 70 ? 'CRITICAL' : score >= 40 ? 'ELEVATED' : score >= 20 ? 'GUARDED' : 'LOW'; }
function scoreTone(score:number){
  return score >= 70 ? 'text-red-300 border-red-400/20 bg-red-400/5'
    : score >= 40 ? 'text-amber-300 border-amber-400/20 bg-amber-400/5'
    : score >= 20 ? 'text-orange-300 border-orange-400/20 bg-orange-400/5'
    : 'text-emerald-300 border-emerald-400/20 bg-emerald-400/5';
}
function extractRoute(value:unknown): Waypoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is Waypoint => Boolean(p) && Number.isFinite(Number((p as Waypoint).lat)) && Number.isFinite(Number((p as Waypoint).lng)));
}

export default function RouteAnalysis(): React.ReactElement {
  const [form,setForm]=useState<AnalyseForm>(EMPTY);
  const [latest,setLatest]=useState<RouteAnalysis|null>(null);
  const [selectedRoute,setSelectedRoute]=useState(0);

  const historyQ=useQuery({
    queryKey:['route-analyses'],
    queryFn:()=>api.get<{data:RouteAnalysis[];total:number}>('/routes/analyses').then(r=>r.data),
  });

  const analyse=useMutation({
    mutationFn:()=>api.post<{data:RouteAnalysis}>('/routes/analyse',{
      origin:{lat:Number(form.origin_lat),lng:Number(form.origin_lng)},
      destination:{lat:Number(form.dest_lat),lng:Number(form.dest_lng)},
      ...(form.convoy_id?{convoy_id:form.convoy_id}:{}),
      ...(form.departure_time?{departure_time:new Date(form.departure_time).toISOString()}:{}),
      preferences:{avoid_night_travel:form.avoid_night},
    }).then(r=>r.data),
    onSuccess:(r)=>{setLatest(r.data);setSelectedRoute(0);void historyQ.refetch();}
  });

  const routes=useMemo(()=>latest?[latest.recommended_route,...(latest.alternate_routes??[])]:[],[latest]);
  const activeRoute=routes[selectedRoute] ?? routes[0];
  const canSubmit=[form.origin_lat,form.origin_lng,form.dest_lat,form.dest_lng].every(v=>v.trim()!=='' && Number.isFinite(Number(v)));

  const field=(key:keyof AnalyseForm,label:string)=>(
    <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input value={form[key] as string} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
        className="w-full rounded-lg border border-white/[0.07] bg-[#081217] px-3 py-2.5 text-xs outline-none focus:border-orange-400/30"
        placeholder="e.g. -1.286389"/>
    </label>
  );

  return <div className="min-h-full bg-[#071014] text-slate-100">
    <div className="border-b border-white/[0.06] bg-[#071014] px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-400/10"><ShieldCheck size={18} className="text-orange-300"/></div>
          <div><div className="flex items-center gap-2"><h1 className="text-lg font-semibold tracking-wide">Route Safety Analysis</h1><span className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2 py-0.5 text-[9px] font-mono text-cyan-300">EVIDENCE-GROUNDED</span></div>
          <p className="mt-1 text-xs text-slate-500">Road geometry → mapped risk exposure → deterministic route ranking → optional AI briefing.</p></div>
        </div>
        <button onClick={()=>{historyQ.refetch();}} className="flex items-center gap-2 rounded-lg border border-white/[0.07] px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.04]"><RefreshCw size={13}/> Refresh</button>
      </div>
      <div className="mt-5 grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        {field('origin_lat','Origin latitude')}{field('origin_lng','Origin longitude')}{field('dest_lat','Destination latitude')}{field('dest_lng','Destination longitude')}
        <button disabled={!canSubmit||analyse.isPending} onClick={()=>analyse.mutate()} className="mt-auto flex h-[39px] items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-xs font-semibold text-slate-950 disabled:opacity-40"><Navigation size={14}/>{analyse.isPending?'Analysing…':'Analyse route'}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={form.avoid_night} onChange={e=>setForm(f=>({...f,avoid_night:e.target.checked}))}/> Avoid night travel</label>
        <input value={form.convoy_id} onChange={e=>setForm(f=>({...f,convoy_id:e.target.value}))} placeholder="Optional convoy UUID" className="w-full max-w-[300px] rounded-lg border border-white/[0.07] bg-[#081217] px-3 py-2 text-[11px] outline-none"/>
      </div>
      {analyse.isError && <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-400/15 bg-red-400/5 px-3 py-2 text-xs text-red-300"><XCircle size={14}/>{analyse.error.message}</div>}
    </div>

    {(latest||historyQ.data?.data?.[0]) ? <div className="grid gap-4 px-6 py-5 xl:grid-cols-[1.6fr_0.9fr]">
      <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#081217]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Operational picture</div><div className="mt-1 text-sm font-semibold">Recommended road geometry</div></div>
          {latest && <div className={`rounded-lg border px-3 py-2 text-right ${scoreTone(latest.overall_risk_score)}`}><div className="text-[9px] uppercase tracking-[0.14em]">Route risk</div><div className="text-lg font-bold tabular-nums">{Math.round(latest.overall_risk_score)} <span className="text-[9px]">{scoreLabel(latest.overall_risk_score)}</span></div></div>}
        </div>
        <div className="h-[440px]"><PortalMap
          currentLocation={null} heading={null} trail={[]} status="not_started"
          routeLine={extractRoute(activeRoute?.waypoints)}
          origin="Origin" destination="Destination"
          originCoords={latest?{lat:latest.origin_lat,lng:latest.origin_lng}:null}
          destinationCoords={latest?{lat:latest.destination_lat,lng:latest.destination_lng}:null}
          noSignal={false}
        /></div>
        {routes.length>0 && <div className="grid gap-2 border-t border-white/[0.06] p-4 md:grid-cols-3">
          {routes.map((r,i)=><button key={i} onClick={()=>setSelectedRoute(i)} className={`rounded-xl border p-3 text-left ${i===selectedRoute?'border-orange-400/25 bg-orange-400/[0.05]':'border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.03]'}`}>
            <div className="flex items-center justify-between"><span className="text-xs font-medium">{i===0?'Recommended':`Alternative ${i}`}</span>{i===0&&<CheckCircle2 size={13} className="text-emerald-300"/>}</div>
            <div className={`mt-2 text-base font-semibold ${scoreTone(r.risk_score).split(' ')[0]}`}>{Math.round(r.risk_score)} <span className="text-[9px] uppercase">{scoreLabel(r.risk_score)}</span></div>
            <div className="mt-1 text-[10px] text-slate-500">{r.distance_km.toFixed(1)} km · {r.estimated_duration_minutes} min</div>
          </button>)}
        </div>}
      </section>

      <aside className="space-y-4">
        {latest && <>
          <section className="rounded-2xl border border-white/[0.06] bg-[#081217] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold"><Crosshair size={13} className="text-orange-300"/> Evidence snapshot</div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[['Routing',latest.routing_provider||'fallback'],['Status',latest.route_status||'unknown'],['Risk zones',String(latest.risk_zone_count??0)],['Cache',latest.cache_hit?'HIT':'FRESH']].map(([k,v])=><div key={k} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3"><div className="text-[9px] uppercase tracking-[0.12em] text-slate-600">{k}</div><div className="mt-1 text-xs font-medium">{v}</div></div>)}
            </div>
          </section>
          <section className="rounded-2xl border border-white/[0.06] bg-[#081217] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold"><TriangleAlert size={13} className="text-amber-300"/> Primary exposures</div>
            <div className="mt-3 space-y-2">{(latest.primary_risk_factors.length?latest.primary_risk_factors:['No mapped primary exposure']).map(f=><div key={f} className="flex items-start gap-2 rounded-lg border border-white/[0.05] px-3 py-2 text-[11px]"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-300"/>{factorLabel[f]??f}</div>)}</div>
          </section>
          <section className="rounded-2xl border border-white/[0.06] bg-[#081217] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold"><FlaskConical size={13} className="text-purple-300"/> AI safety swarm</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[['Agents',String(latest.swarm?.agent_count ?? 0)],['Confidence',Math.round(Number(latest.swarm?.confidence ?? 0)*100)+'%'],['Gate',latest.safety_gate||'CONDITIONAL'],['Provider path',(latest.swarm?.providers||[]).length+' used']].map(([k,v])=><div key={k} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5"><div className="text-[9px] uppercase tracking-[0.12em] text-slate-600">{k}</div><div className="mt-1 text-[10px] font-medium">{v}</div></div>)}
            </div>
            <p className="mt-3 text-[10px] leading-5 text-slate-500">Independent route, security, environment, infrastructure, operations, data-assurance and adversarial agents feed a separate arbiter and critic. AI cannot replace the deterministic route-risk gate.</p>
          </section>
          <section className="rounded-2xl border border-white/[0.06] bg-[#081217] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold"><Database size={13} className="text-cyan-300"/> Assessment</div>
            <p className="mt-3 text-xs leading-5 text-slate-400">{latest.ai_summary}</p>
            <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-600"><ShieldAlert size={12}/> Version {latest.analysis_version||'route-safety-v2'} · generated {new Date(latest.analysed_at).toLocaleString()}</div>
          </section>
          {activeRoute?.notes && <section className="rounded-2xl border border-white/[0.06] bg-[#081217] p-5"><div className="flex items-center gap-2 text-xs font-semibold"><RouteIcon size={13}/> Selected route rationale</div><p className="mt-3 text-xs leading-5 text-slate-400">{activeRoute.notes}</p></section>}
        </>}
      </aside>
    </div> : <div className="px-6 py-16 text-center text-slate-600"><ShieldAlert size={30} className="mx-auto mb-3 opacity-40"/><p className="text-sm">No route safety assessments yet.</p></div>}

    {historyQ.data?.data?.length ? <section className="px-6 pb-8">
      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-600"><Clock3 size={13}/> Recent analyses</div>
      <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#081217]">{historyQ.data.data.slice(0,8).map((a)=><button key={a.id} onClick={()=>{setLatest(a);setSelectedRoute(0)}} className="grid w-full grid-cols-[1.4fr_120px_130px_1fr] gap-4 border-b border-white/[0.04] px-5 py-3 text-left text-xs hover:bg-white/[0.025]">
        <span>{a.origin_lat.toFixed(3)},{a.origin_lng.toFixed(3)} <ArrowRight size={12} className="mx-1 inline text-slate-600"/> {a.destination_lat.toFixed(3)},{a.destination_lng.toFixed(3)}</span>
        <span className="text-slate-400">{Math.round(a.overall_risk_score)} · {scoreLabel(a.overall_risk_score)}</span>
        <span className="text-slate-500">{a.routing_provider||'fallback'}</span>
        <span className="text-slate-600">{new Date(a.analysed_at).toLocaleString()}</span>
      </button>)}</div>
    </section>:null}
  </div>;
}
