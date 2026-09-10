import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import '../styles/dashboard.css';

import { Suspense, lazy } from 'react';
import { Activity, AlertTriangle, Clock3, MapPinned, Radio, ShieldCheck, Siren, Target, Zap } from 'lucide-react';
import EventsTicker from '../components/dashboard/EventsTicker.js';
import InstrumentBar from '../components/dashboard/InstrumentBar.js';
import PriorityQueue from '../components/dashboard/PriorityQueue.js';
const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));
import type { DashboardOverview } from '../stores/dashboardStore.js';

function CommandMast() {
  const overview = useDashboardStore((s) => s.overview);
  const alerts = useDashboardStore((s) => s.alerts);
  const convoys = useDashboardStore((s) => s.convoys);

  const level = overview?.threat?.level ?? 'secure';
  const critical = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length;
  const active = overview?.kpi?.convoys_active ?? convoys.filter((c) => c.status === 'active').length;
  const vehicles = overview?.kpi?.vehicles_live ?? 0;
  const incidents = overview?.kpi?.incidents_open ?? overview?.threat?.incidents_active ?? 0;

  const tone = level === 'critical' ? 'critical' : level === 'elevated' ? 'elevated' : 'secure';
  const threatLabel = level === 'critical' ? 'CRITICAL' : level === 'elevated' ? 'ELEVATED' : 'SECURE';

  return (
    <section className={`command-mast command-mast--${tone}`} aria-label='Command overview'>
      <div className='command-mast__brand'>
        <div className='command-mast__sigil'>S</div>
        <div>
          <div className='command-mast__eyebrow'><span className='live-dot' /> SONALIT COMMAND</div>
          <h1>Operations Command Workspace</h1>
          <p>One screen for movement posture, threats, exceptions and immediate action.</p>
        </div>
      </div>

      <div className='command-mast__posture'>
        <div className='posture-label'><ShieldCheck size={16} /> GLOBAL POSTURE</div>
        <strong>{threatLabel}</strong>
        <span>{incidents} incidents open · {critical} priority alerts</span>
      </div>

      <div className='command-mast__metrics'>
        <div className='command-mast__metric'>
          <Target size={16} />
          <span>ACTIVE CONVOYS</span>
          <strong>{active}</strong>
        </div>
        <div className='command-mast__metric'>
          <MapPinned size={16} />
          <span>LIVE VEHICLES</span>
          <strong>{vehicles}</strong>
        </div>
        <div className='command-mast__metric'>
          <Siren size={16} />
          <span>OPEN ISSUES</span>
          <strong>{incidents}</strong>
        </div>
      </div>

      <div className='command-mast__clock'>
        <div><Clock3 size={15} /> SHIFT</div>
        <strong>{overview?.shift_started_at ? new Date(overview.shift_started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong>
        <small>{overview?.shift_started_at ? 'ACTIVE' : 'NOT STARTED'}</small>
      </div>
    </section>
  );
}

function MapOverlay() {
  const vehicles = useDashboardStore((s) => s.overview?.kpi?.vehicles_live ?? 0);
  const convoys = useDashboardStore((s) => s.overview?.kpi?.convoys_active ?? 0);
  const incidents = useDashboardStore((s) => s.overview?.kpi?.incidents_open ?? 0);

  return (
    <div className='command-map-overlay'>
      <div className='command-map-overlay__title'><Radio size={15} /> LIVE THEATRE <span>REAL-TIME</span></div>
      <div className='command-map-overlay__grid'>
        <div><b>{vehicles}</b><span>VEHICLES</span></div>
        <div><b>{convoys}</b><span>CONVOYS</span></div>
        <div><b>{incidents}</b><span>ISSUES</span></div>
      </div>
      <div className='command-map-overlay__hint'><Zap size={13} /> Select a vehicle, convoy or alert on the map for detail.</div>
    </div>
  );
}

export default function Dashboard() {
  const { setOverview } = useDashboardStore.getState();

  useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => {
      try {
        const r = await api.get<DashboardOverview>('/dashboard/overview');
        setOverview(r.data);
        return r.data;
      } catch {
        return null;
      }
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  return (
    <div className='d-console d-command-v3'>
      <CommandMast />
      <InstrumentBar />

      <div className='d-console-main'>
        <div className='d-console-map'>
          <div className='command-map-frame'>
            <MapOverlay />
            <Suspense fallback={
              <div className='command-map-loading'>
                <Activity size={18} />
                <span>Connecting to live operations theatre…</span>
              </div>
            }>
              <TacticalMap fill />
            </Suspense>
            <div className='command-map-corners' aria-hidden='true'><i/><i/><i/><i/></div>
          </div>
        </div>
        <PriorityQueue />
      </div>

      <EventsTicker />

      <style>{`
        .d-command-v3 { height: 100%; min-height: 0; }
        .d-command-v3 .d-console-main { flex: 1 1 auto; min-height: 0; display: flex; gap: 10px; padding: 10px; background: var(--d-deep); }
        .d-command-v3 .d-console-map { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }
        .d-command-v3 .d-console-queue { flex: 0 0 360px; max-width: 38vw; border: 1px solid var(--d-rim2); border-radius: 14px; overflow: hidden; box-shadow: 0 18px 45px rgba(0,0,0,.22); }
        .command-mast { flex: 0 0 auto; display: grid; grid-template-columns: minmax(280px,1.4fr) minmax(190px,.75fr) minmax(270px,1fr) 120px; gap: 12px; align-items: stretch; padding: 12px 14px; background: linear-gradient(135deg, rgba(10,17,32,.98), rgba(12,20,40,.94)); border-bottom: 1px solid var(--d-rim2); box-shadow: 0 10px 35px rgba(0,0,0,.22); }
        .command-mast__brand, .command-mast__posture, .command-mast__metrics, .command-mast__clock { min-width: 0; }
        .command-mast__brand { display: flex; align-items: center; gap: 12px; }
        .command-mast__sigil { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(34,232,255,.45); border-radius: 11px; background: radial-gradient(circle at 30% 25%, rgba(34,232,255,.2), rgba(139,107,255,.1) 45%, transparent 75%); color: var(--d-sig); font: 800 20px/1 var(--d-font-display); box-shadow: 0 0 24px rgba(34,232,255,.1); }
        .command-mast__eyebrow, .posture-label { display: flex; align-items: center; gap: 7px; color: var(--d-t2); font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
        .command-mast__brand h1 { margin: 3px 0 2px; color: var(--d-t1); font-size: clamp(19px, 1.6vw, 28px); line-height: 1.05; font-weight: 800; letter-spacing: -.025em; }
        .command-mast__brand p { margin: 0; color: var(--d-t2); font-size: 12px; line-height: 1.4; }
        .live-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--d-ok); box-shadow: 0 0 10px rgba(41,255,176,.7); }
        .command-mast__posture { padding: 9px 12px; border: 1px solid var(--d-rim2); border-left: 3px solid var(--d-sig); border-radius: 11px; background: rgba(255,255,255,.025); }
        .command-mast--elevated .command-mast__posture { border-left-color: var(--d-warn); }
        .command-mast--critical .command-mast__posture { border-left-color: var(--d-fire); }
        .command-mast__posture strong { display: block; margin-top: 4px; color: var(--d-sig); font-size: 24px; line-height: 1; letter-spacing: .04em; }
        .command-mast--elevated .command-mast__posture strong { color: var(--d-warn); }
        .command-mast--critical .command-mast__posture strong { color: var(--d-fire); }
        .command-mast__posture span { display: block; margin-top: 6px; color: var(--d-t2); font-size: 11px; }
        .command-mast__metrics { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
        .command-mast__metric { padding: 9px 10px; border: 1px solid var(--d-rim2); border-radius: 10px; background: rgba(255,255,255,.024); }
        .command-mast__metric svg { color: var(--d-sig); margin-bottom: 4px; }
        .command-mast__metric span { display: block; color: var(--d-t2); font-size: 9px; font-weight: 800; letter-spacing: .09em; }
        .command-mast__metric strong { display: block; margin-top: 1px; color: var(--d-t1); font-size: 24px; line-height: 1; }
        .command-mast__clock { display: flex; flex-direction: column; justify-content: center; padding: 8px 10px; border-left: 1px solid var(--d-rim2); }
        .command-mast__clock div { display:flex; gap:6px; align-items:center; color: var(--d-t2); font-size: 9px; letter-spacing: .1em; font-weight: 800; }
        .command-mast__clock strong { margin-top: 4px; color: var(--d-t1); font-size: 18px; }
        .command-mast__clock small { color: var(--d-ok); font-size: 9px; font-weight: 800; letter-spacing: .08em; }
        .command-map-frame { position: relative; flex: 1; min-height: 0; overflow: hidden; border: 1px solid var(--d-rim2); border-radius: 14px; background: #040914; box-shadow: inset 0 0 0 1px rgba(255,255,255,.018), 0 18px 45px rgba(0,0,0,.25); }
        .command-map-frame::after { content:''; position:absolute; inset:0; pointer-events:none; background: radial-gradient(circle at 50% 45%, transparent 40%, rgba(3,7,17,.14) 76%, rgba(3,7,17,.45) 100%); z-index: 20; }
        .command-map-overlay { position:absolute; top:14px; left:14px; z-index:30; min-width:260px; padding:11px 12px; border:1px solid rgba(34,232,255,.22); border-radius:11px; background:rgba(4,9,18,.84); backdrop-filter: blur(12px); box-shadow:0 14px 35px rgba(0,0,0,.25); }
        .command-map-overlay__title { display:flex; align-items:center; gap:7px; color:var(--d-t1); font-size:11px; font-weight:800; letter-spacing:.08em; }
        .command-map-overlay__title svg { color:var(--d-sig); }
        .command-map-overlay__title span { margin-left:auto; color:var(--d-ok); font-size:9px; letter-spacing:.12em; }
        .command-map-overlay__grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:9px; }
        .command-map-overlay__grid div { padding:7px 8px; border:1px solid var(--d-rim); border-radius:8px; background:rgba(255,255,255,.02); }
        .command-map-overlay__grid b { display:block; color:var(--d-t1); font-size:18px; line-height:1; }
        .command-map-overlay__grid span { display:block; margin-top:4px; color:var(--d-t2); font-size:8px; letter-spacing:.08em; font-weight:800; }
        .command-map-overlay__hint { margin-top:8px; display:flex; align-items:center; gap:6px; color:var(--d-t2); font-size:10px; line-height:1.3; }
        .command-map-overlay__hint svg { color:var(--d-warn); flex-shrink:0; }
        .command-map-loading { position:absolute; inset:0; z-index:15; display:grid; place-items:center; align-content:center; gap:8px; color:var(--d-t2); font-size:12px; }
        .command-map-loading svg { color:var(--d-sig); animation: radar-turn 1.4s linear infinite; }
        .command-map-corners i { position:absolute; width:16px; height:16px; border-color:rgba(34,232,255,.7); border-style:solid; z-index:32; pointer-events:none; }
        .command-map-corners i:nth-child(1){top:8px;left:8px;border-width:2px 0 0 2px}.command-map-corners i:nth-child(2){top:8px;right:8px;border-width:2px 2px 0 0}.command-map-corners i:nth-child(3){bottom:8px;left:8px;border-width:0 0 2px 2px}.command-map-corners i:nth-child(4){bottom:8px;right:8px;border-width:0 2px 2px 0}
        .d-command-v3 .d-console-queue > div:first-child { padding: 14px 16px 10px !important; }
        .d-command-v3 .d-console-queue button { font-family: var(--d-font) !important; }
        .d-command-v3 .d-console-queue { color: var(--d-t1); }
        .d-command-v3 .d-console-queue > div { font-size: 12px; }
        .d-command-v3 .d-console-queue span { line-height: 1.25; }
        .d-command-v3 .d-console-queue [style*="font-size: 8px"] { font-size: 10px !important; }
        .d-command-v3 .d-console-queue [style*="font-size: 9px"] { font-size: 11px !important; }
        .d-command-v3 .d-console-queue [style*="font-size: 10px"] { font-size: 12px !important; }
        .d-command-v3 .d-console-queue [style*="font-size: 11px"] { font-size: 13px !important; }
        .d-command-v3 .d-console-queue [style*="font-family: Orbitron"] { font-size: 12px !important; letter-spacing: .08em !important; }
        .d-command-v3 .d-console-queue a { font-size: 11px !important; }
        .d-command-v3 .d-console-queue .d-queue-title { font-size: 14px; }
        @media (max-width: 1200px) { .command-mast { grid-template-columns: 1.2fr .9fr 1fr; } .command-mast__clock { display:none; } .d-command-v3 .d-console-queue { flex-basis: 330px; } }
        @media (max-width: 999px) { .d-command-v3 .d-console-main { flex-direction: column; } .d-command-v3 .d-console-map { min-height: 430px; } .d-command-v3 .d-console-queue { flex: 1 1 auto; max-width: none; border-left: none; } .command-mast { grid-template-columns: 1fr; } .command-mast__metrics { grid-template-columns: repeat(3,1fr); } }
        @media (max-width: 640px) { .d-command-v3 .d-console-main { padding: 6px; gap: 6px; } .command-mast { padding: 10px; } .command-mast__brand h1 { font-size: 20px; } .command-mast__brand p { font-size: 11px; } .command-mast__metrics strong { font-size: 20px; } .command-map-overlay { left:8px; right:8px; min-width:0; } }
      `}</style>
    </div>
  );
}
