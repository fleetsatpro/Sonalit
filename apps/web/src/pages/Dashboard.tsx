import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import '../styles/dashboard.css';

import React, { Suspense, lazy } from 'react';
import { Activity, AlertTriangle, Clock3, MapPinned, Radio, ShieldCheck, Siren, Target } from 'lucide-react';
import EventsTicker from '../components/dashboard/EventsTicker.js';
import InstrumentBar from '../components/dashboard/InstrumentBar.js';
import PriorityQueue, { type QueueItem } from '../components/dashboard/PriorityQueue.js';
const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));
import type { DashboardOverview } from '../stores/dashboardStore.js';

function relTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function CommandHeader() {
  const nav = useNavigate();
  const overview = useDashboardStore((s) => s.overview);
  const alerts = useDashboardStore((s) => s.alerts);
  const convoys = useDashboardStore((s) => s.convoys);
  const incidents = useDashboardStore((s) => s.incidents);
  const panic = useDashboardStore((s) => s.panicState);

  const level = overview?.threat?.level ?? 'secure';
  const posture = level === 'critical' ? 'CRITICAL' : level === 'elevated' ? 'ELEVATED' : 'SECURE';
  const priority = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length;
  const activeConvoys = overview?.kpi?.convoys_active ?? convoys.filter((c) => c.status === 'active' || c.status === 'in_transit').length;
  const liveVehicles = overview?.kpi?.vehicles_live ?? 0;
  const openIssues = overview?.kpi?.incidents_open ?? incidents.filter((i) => i.status !== 'resolved' && i.status !== 'closed').length;
  const shift = overview?.shift_started_at ? new Date(overview.shift_started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <header className={`command-header command-header--${posture.toLowerCase()}`}>
      <div className='command-header__identity'>
        <div className='command-header__mark'>S</div>
        <div>
          <div className='command-header__eyebrow'><span className='command-live-dot' /> SONALIT / COMMAND</div>
          <h1>Operations Command</h1>
          <p>Movement, exceptions and response in one operational view.</p>
        </div>
      </div>

      <div className='command-header__posture'>
        <div className='command-header__posture-label'><ShieldCheck size={14} /> GLOBAL POSTURE</div>
        <div className='command-header__posture-value'>{posture}</div>
        <div className='command-header__posture-meta'>{openIssues} open issues <span>·</span> {priority} priority alerts</div>
      </div>

      <div className='command-header__metrics' aria-label='Live operating counts'>
        <div><span>CONVOYS</span><b>{activeConvoys}</b></div>
        <div><span>VEHICLES</span><b>{liveVehicles}</b></div>
        <div><span>ISSUES</span><b>{openIssues}</b></div>
      </div>

      <div className='command-header__shift'>
        <span><Clock3 size={13} /> SHIFT START</span>
        <strong>{shift}</strong>
        <small>{overview?.shift_started_at ? 'ACTIVE' : 'NOT STARTED'}</small>
      </div>

      <nav className='command-header__actions' aria-label='Command destinations'>
        <button type='button' className={panic ? 'is-critical' : ''} onClick={() => nav({ to: '/panic-center' as any })}>
          <Siren size={15} /><span>PANIC</span><b>{panic ? 'LIVE' : 'OPEN'}</b>
        </button>
        <button type='button' className={priority ? 'has-count' : ''} onClick={() => nav({ to: '/alerts' as any })}>
          <AlertTriangle size={15} /><span>ALERTS</span><b>{priority}</b>
        </button>
        <button type='button' onClick={() => nav({ to: '/messages' as any })}>
          <Radio size={15} /><span>MESSAGES</span><b>OPEN</b>
        </button>
        <button type='button' onClick={() => nav({ to: '/intelligence' as any })}>
          <Target size={15} /><span>INTELLIGENCE</span><b>VIEW</b>
        </button>
      </nav>
    </header>
  );
}

function TheatreHeader() {
  const overview = useDashboardStore((s) => s.overview);
  const vehicles = overview?.kpi?.vehicles_live ?? 0;
  const convoys = overview?.kpi?.convoys_active ?? 0;
  const issues = overview?.kpi?.incidents_open ?? 0;

  return (
    <div className='command-theatre-header'>
      <div>
        <div className='command-theatre-header__eyebrow'><MapPinned size={13} /> OPERATIONS THEATRE</div>
        <h2>Live movement picture</h2>
      </div>
      <div className='command-theatre-header__stats'>
        <span><b>{vehicles}</b> vehicles</span>
        <span><b>{convoys}</b> convoys</span>
        <span><b>{issues}</b> issues</span>
        <span className='command-theatre-header__live'><i /> LIVE</span>
      </div>
    </div>
  );
}

function CommandObject({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const nav = useNavigate();
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prior; };
  }, [onClose]);

  return (
    <div className='command-object-backdrop' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article className='command-object' role='dialog' aria-modal='true' aria-labelledby='command-object-title' onMouseDown={(event) => event.stopPropagation()}>
        <div className='command-object__topline'>
          <span className='command-object__signal' style={{ color: `rgb(${item.chip.hue})`, borderColor: `rgba(${item.chip.hue},.45)`, background: `rgba(${item.chip.hue},.08)` }}>{item.chip.label}</span>
          <span>COMMAND EVENT</span>
          <button type='button' onClick={onClose} aria-label='Close command event'>×</button>
        </div>
        <div className='command-object__hero'>
          <div>
            <span>OPERATIONAL OBJECT</span>
            <h2 id='command-object-title'>{item.title}</h2>
            <p>{item.body || 'Use the linked operational system for full event context and response.'}</p>
          </div>
          <div className='command-object__time'><strong>{relTime(item.at)}</strong><small>OBSERVED</small></div>
        </div>
        <div className='command-object__facts'>
          <div><span>PRIORITY</span><b>{item.rank <= 0 ? 'CRITICAL' : item.rank === 1 ? 'HIGH' : item.chip.label}</b></div>
          <div><span>STATUS</span><b>ACTIVE QUEUE</b></div>
          <div><span>SOURCE</span><b>LIVE FEED</b></div>
          <div><span>NEXT STEP</span><b>OPERATOR REVIEW</b></div>
        </div>
        <div className='command-object__rail'>
          <button type='button' onClick={onClose}>RETURN TO THEATRE</button>
          <button type='button' onClick={() => nav({ to: '/alerts' as any })}>OPEN ALERTS</button>
          <button type='button' onClick={() => nav({ to: '/intelligence' as any })}>OPEN INTELLIGENCE</button>
        </div>
      </article>
    </div>
  );
}

export default function Dashboard() {
  const { setOverview } = useDashboardStore.getState();
  const [selectedCommand, setSelectedCommand] = React.useState<QueueItem | null>(null);

  useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => {
      try {
        const response = await api.get<DashboardOverview>('/dashboard/overview');
        setOverview(response.data);
        return response.data;
      } catch {
        return null;
      }
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  return (
    <main className='d-console d-command-structured'>
      <CommandHeader />

      <section className='command-status-strip' aria-label='Operational instrumentation'>
        <InstrumentBar />
      </section>

      <section className='command-theatre'>
        <TheatreHeader />
        <div className='command-theatre__body'>
          <section className='command-map-panel' aria-label='Live movement map'>
            <div className='command-map-panel__canvas'>
              <Suspense fallback={<div className='command-map-loading'><Activity size={18} /><span>Connecting to live operations theatre…</span></div>}>
                <TacticalMap fill />
              </Suspense>
              <div className='command-map-panel__corner command-map-panel__corner--tl' />
              <div className='command-map-panel__corner command-map-panel__corner--tr' />
              <div className='command-map-panel__corner command-map-panel__corner--bl' />
              <div className='command-map-panel__corner command-map-panel__corner--br' />
              <div className='command-map-panel__hud'><span><span className='command-live-dot' /> LIVE MAP</span><small>SELECTED OBJECTS OPEN IN DETAIL</small></div>
            </div>
          </section>

          <PriorityQueue onSelect={setSelectedCommand} />
        </div>
      </section>

      <footer className='command-footer'><EventsTicker /></footer>
      {selectedCommand && <CommandObject item={selectedCommand} onClose={() => setSelectedCommand(null)} />}

      <style>{`
        .d-command-structured{display:flex;flex-direction:column;gap:0;height:100%;min-height:0;padding:14px 16px 0;overflow:hidden;background:var(--d-void)}
        .command-header{display:grid;grid-template-columns:minmax(300px,1.7fr) minmax(170px,.8fr) auto auto;grid-template-areas:'identity posture metrics shift' 'actions actions actions actions';gap:14px 18px;padding:18px 20px;background:var(--d-carbon);border:1px solid var(--d-rim2);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.22);flex:0 0 auto}
        .command-header__identity{grid-area:identity;display:flex;align-items:center;gap:13px;min-width:0}.command-header__mark{width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--d-rim3);border-radius:10px;background:var(--d-deep);color:var(--d-sig);font-family:var(--d-font-display)!important;font-size:16px;font-weight:800}.command-header__eyebrow,.command-header__posture-label,.command-header__shift span{display:flex;align-items:center;gap:6px;color:var(--d-t3);font-size:9px;font-weight:800;letter-spacing:.14em}.command-header__identity h1{margin:4px 0 3px;font-size:clamp(22px,2vw,29px);line-height:1.05;letter-spacing:-.025em}.command-header__identity p{margin:0;color:var(--d-t2);font-size:11px}.command-live-dot,.command-theatre-header__live i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--d-ok);box-shadow:0 0 8px rgba(41,255,176,.5)}
        .command-header__posture{grid-area:posture;padding:2px 16px;border-left:1px solid var(--d-rim2)}.command-header__posture-value{margin-top:5px;font-size:18px;font-weight:900;letter-spacing:.06em}.command-header--critical .command-header__posture-value{color:var(--d-fire)}.command-header--elevated .command-header__posture-value{color:var(--d-warn)}.command-header--secure .command-header__posture-value{color:var(--d-ok)}.command-header__posture-meta{margin-top:4px;color:var(--d-t2);font-size:10px}.command-header__posture-meta span{color:var(--d-t3);margin:0 3px}
        .command-header__metrics{grid-area:metrics;display:flex;align-items:center;gap:16px}.command-header__metrics div{min-width:58px}.command-header__metrics span{display:block;color:var(--d-t3);font-size:8px;font-weight:800;letter-spacing:.1em}.command-header__metrics b{display:block;margin-top:2px;color:var(--d-t1);font-size:18px}.command-header__shift{grid-area:shift;display:flex;flex-direction:column;justify-content:center;min-width:88px;padding-left:16px;border-left:1px solid var(--d-rim2)}.command-header__shift strong{margin:4px 0 1px;font-family:var(--d-font-mono)!important;font-size:17px;color:var(--d-t1)}.command-header__shift small{color:var(--d-ok);font-size:8px;font-weight:800;letter-spacing:.1em}
        .command-header__actions{grid-area:actions;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding-top:2px;border-top:1px solid var(--d-rim2)}.command-header__actions button{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;min-height:38px;margin-top:10px;padding:0 11px;text-align:left;color:var(--d-t2);background:var(--d-deep);border:1px solid var(--d-rim2);border-radius:8px;cursor:pointer}.command-header__actions button:hover{border-color:var(--d-rim3);color:var(--d-t1);background:var(--d-surf)}.command-header__actions button svg{color:var(--d-sig)}.command-header__actions button.is-critical{border-color:rgba(255,59,92,.42);background:rgba(255,59,92,.06)}.command-header__actions button.is-critical svg,.command-header__actions button.is-critical b{color:var(--d-fire)}.command-header__actions span{font-size:10px;font-weight:850;letter-spacing:.04em}.command-header__actions b{justify-self:end;color:var(--d-t3);font-size:9px;letter-spacing:.05em}.command-header__actions .has-count b{color:var(--d-warn)}
        .command-status-strip{flex:0 0 auto;margin:10px 0}.command-status-strip>*{min-height:0}
        .command-theatre{display:flex;flex-direction:column;flex:1;min-height:0;background:var(--d-carbon);border:1px solid var(--d-rim2);border-radius:14px;overflow:hidden}.command-theatre-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 15px;border-bottom:1px solid var(--d-rim2);background:var(--d-deep);flex:0 0 auto}.command-theatre-header__eyebrow{display:flex;align-items:center;gap:6px;color:var(--d-sig);font-size:9px;font-weight:850;letter-spacing:.13em}.command-theatre-header h2{margin:4px 0 0;font-size:16px;line-height:1.1}.command-theatre-header__stats{display:flex;align-items:center;gap:16px;color:var(--d-t2);font-size:10px}.command-theatre-header__stats b{color:var(--d-t1);font-size:13px;margin-right:3px}.command-theatre-header__live{display:flex;align-items:center;gap:6px;color:var(--d-ok);font-weight:850;letter-spacing:.08em}
        .command-theatre__body{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0;flex:1}.command-map-panel{min-width:0;min-height:0;padding:10px}.command-map-panel__canvas{position:relative;width:100%;height:100%;min-height:340px;overflow:hidden;border:1px solid var(--d-rim2);border-radius:10px;background:#050b16}.command-map-panel__canvas>*:first-child{height:100%}.command-map-panel__hud{position:absolute;top:10px;left:10px;z-index:30;display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid rgba(34,232,255,.22);border-radius:7px;background:rgba(3,7,17,.84);backdrop-filter:blur(8px)}.command-map-panel__hud>span{display:flex;align-items:center;gap:6px;color:var(--d-t1);font-size:9px;font-weight:850;letter-spacing:.08em}.command-map-panel__hud small{color:var(--d-t3);font-size:8px;letter-spacing:.08em}.command-map-panel__corner{position:absolute;z-index:30;width:12px;height:12px;border-color:var(--d-sig);border-style:solid;opacity:.7}.command-map-panel__corner--tl{top:-1px;left:-1px;border-width:2px 0 0 2px}.command-map-panel__corner--tr{top:-1px;right:-1px;border-width:2px 2px 0 0}.command-map-panel__corner--bl{bottom:-1px;left:-1px;border-width:0 0 2px 2px}.command-map-panel__corner--br{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
        .d-command-structured .d-console-queue{width:auto;max-width:none;flex:0 0 auto;border-left:1px solid var(--d-rim2)!important;background:var(--d-deep)!important;overflow-y:auto}.d-command-structured .d-console-queue>div{padding-left:14px;padding-right:14px}.d-command-structured .d-console-queue button{font-family:var(--d-font)!important}.d-command-structured .d-console-queue .d-queue-title{font-size:13px}
        .command-footer{flex:0 0 auto;margin-top:8px}.command-footer>*{max-height:30px;overflow:hidden}
        .command-object-backdrop{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:22px;background:rgba(1,5,11,.78);backdrop-filter:blur(7px)}.command-object{position:relative;width:min(820px,94vw);overflow:hidden;color:var(--d-t1);border:1px solid var(--d-rim3);border-radius:14px;background:var(--d-carbon);box-shadow:0 32px 90px rgba(0,0,0,.55)}.command-object__topline{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--d-rim2);color:var(--d-t3);font-size:9px;font-weight:850;letter-spacing:.12em}.command-object__signal{padding:4px 7px;border:1px solid;border-radius:5px}.command-object__topline button{margin-left:auto;width:30px;height:30px;border:1px solid var(--d-rim2);border-radius:7px;background:var(--d-deep);color:var(--d-t1);font-size:19px;cursor:pointer}.command-object__hero{display:grid;grid-template-columns:minmax(0,1fr) 105px;gap:18px;padding:24px}.command-object__hero>div:first-child>span{color:var(--d-sig);font-size:9px;font-weight:850;letter-spacing:.14em}.command-object__hero h2{margin:6px 0 9px;font-size:clamp(24px,3vw,36px);line-height:1.06;letter-spacing:-.025em}.command-object__hero p{margin:0;color:var(--d-t2);font-size:13px;line-height:1.55}.command-object__time{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding-left:14px;border-left:1px solid var(--d-rim2)}.command-object__time strong{font-size:22px}.command-object__time small{margin-top:4px;color:var(--d-t3);font-size:8px;letter-spacing:.12em}.command-object__facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 24px 20px}.command-object__facts div{padding:10px 11px;border:1px solid var(--d-rim2);border-radius:8px;background:var(--d-deep)}.command-object__facts span{display:block;color:var(--d-t3);font-size:8px;font-weight:800;letter-spacing:.08em}.command-object__facts b{display:block;margin-top:4px;font-size:11px}.command-object__rail{display:flex;gap:8px;padding:12px 24px 16px;border-top:1px solid var(--d-rim2);background:rgba(255,255,255,.015)}.command-object__rail button{min-height:38px;padding:0 12px;border:1px solid var(--d-rim2);border-radius:7px;background:var(--d-deep);color:var(--d-t1);font-size:10px;font-weight:800;cursor:pointer}.command-object__rail button:nth-child(2){color:var(--d-warn)}.command-object__rail button:nth-child(3){color:var(--d-sig)}
        @media (max-width:1200px){.command-header{grid-template-columns:minmax(260px,1.3fr) .9fr auto;grid-template-areas:'identity posture metrics' 'actions actions actions'}.command-header__shift{display:none}.command-theatre__body{grid-template-columns:minmax(0,1fr) 315px}}
        @media (max-width:980px){.d-command-structured{overflow:auto}.command-header{grid-template-columns:1fr}.command-header__posture{padding:0;border-left:0;border-top:1px solid var(--d-rim2);padding-top:11px}.command-header__metrics{border-top:1px solid var(--d-rim2);padding-top:11px}.command-header__actions{grid-template-columns:repeat(2,1fr)}.command-status-strip{overflow:hidden}.command-theatre__body{grid-template-columns:1fr}.command-map-panel{min-height:430px}.d-command-structured .d-console-queue{border-left:0!important;border-top:1px solid var(--d-rim2)!important;max-height:460px}.command-theatre-header__stats{gap:8px;flex-wrap:wrap}}
        @media (max-width:620px){.d-command-structured{padding:8px 8px 0}.command-header{padding:14px}.command-header__identity p{display:none}.command-header__actions{gap:6px}.command-header__actions button{min-height:36px;margin-top:8px;padding:0 8px;gap:6px}.command-header__actions span{font-size:9px}.command-theatre-header{align-items:flex-start;flex-direction:column}.command-theatre-header__stats{width:100%;justify-content:space-between}.command-map-panel{padding:6px;min-height:360px}.command-object__hero{grid-template-columns:1fr;padding:18px}.command-object__time{align-items:flex-start;padding:10px 0 0;border-left:0;border-top:1px solid var(--d-rim2)}.command-object__facts{grid-template-columns:repeat(2,1fr);padding:0 18px 16px}.command-object__rail{padding:10px 18px 14px;flex-wrap:wrap}.command-object__rail button{flex:1 1 130px}.command-footer{margin-top:5px}}
      `}</style>
    </main>
  );
}
