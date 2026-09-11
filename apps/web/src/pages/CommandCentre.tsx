import React, { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Activity, AlertTriangle, Clock3, Crosshair, Radio, Route, ShieldCheck, Siren, Truck, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardOverview } from '../stores/dashboardStore.js';
import PriorityQueue, { type QueueItem } from '../components/dashboard/PriorityQueue.js';
import EventsTicker from '../components/dashboard/EventsTicker.js';

const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatAge(iso?: string | null) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function Metric({ icon: Icon, label, value, detail, tone = 'normal' }: { icon: React.ElementType; label: string; value: string | number; detail?: string; tone?: 'normal' | 'warn' | 'critical' }) {
  return (
    <div className={`cc-metric cc-metric--${tone}`}>
      <Icon size={14} />
      <div className='cc-metric__copy'>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}

function ObjectDrawer({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <div className='cc-drawer-backdrop' role='presentation' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className='cc-drawer' role='dialog' aria-modal='true' aria-label='Operational event detail'>
        <header>
          <div>
            <span className='cc-kicker'>LIVE OBJECT / {item.chip.label}</span>
            <h2>{item.title}</h2>
          </div>
          <button type='button' onClick={onClose} aria-label='Close event'>×</button>
        </header>
        <div className='cc-drawer__signal'>
          <span style={{ background: `rgb(${item.chip.hue})` }} />
          <div><small>OBSERVED</small><strong>{formatAge(item.at)}</strong></div>
          <div><small>QUEUE RANK</small><strong>{item.rank <= 0 ? 'CRITICAL' : item.rank === 1 ? 'HIGH' : 'STANDARD'}</strong></div>
        </div>
        <p>{item.body || 'No additional operator context has been attached to this event yet.'}</p>
        <div className='cc-drawer__facts'>
          <div><span>SOURCE</span><b>LIVE OPERATIONS FEED</b></div>
          <div><span>STATUS</span><b>REQUIRES OPERATOR REVIEW</b></div>
          <div><span>EVENT TIME</span><b>{new Date(item.at).toLocaleString()}</b></div>
        </div>
        <div className='cc-drawer__actions'>
          <button type='button' onClick={() => nav({ to: '/alerts' as any })}>OPEN ALERTS</button>
          <button type='button' onClick={() => nav({ to: '/intelligence' as any })}>OPEN INTELLIGENCE</button>
          <button type='button' onClick={onClose}>RETURN TO MAP</button>
        </div>
      </aside>
    </div>
  );
}

export default function CommandCentre() {
  const nav = useNavigate();
  const { setOverview } = useDashboardStore.getState();
  const overview = useDashboardStore((s) => s.overview);
  const alerts = useDashboardStore((s) => s.alerts);
  const convoys = useDashboardStore((s) => s.convoys);
  const incidents = useDashboardStore((s) => s.incidents);
  const panic = useDashboardStore((s) => s.panicState);
  const [selected, setSelected] = React.useState<QueueItem | null>(null);

  useQuery({
    queryKey: ['command-centre-overview'],
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

  const activeConvoys = overview?.kpi?.convoys_active ?? convoys.filter((c) => c.status === 'active' || c.status === 'in_transit').length;
  const liveVehicles = overview?.kpi?.vehicles_live ?? 0;
  const openIssues = overview?.kpi?.incidents_open ?? incidents.filter((i) => i.status !== 'resolved' && i.status !== 'closed').length;
  const priority = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length;
  const level = overview?.threat?.level ?? 'secure';
  const posture = level === 'critical' ? 'CRITICAL' : level === 'elevated' ? 'ELEVATED' : 'SECURE';
  const nextDelivery = overview?.next_delivery;
  const shift = formatTime(overview?.shift_started_at);

  return (
    <main className='cc-v3'>
      <section className='cc-topline'>
        <div className='cc-brand'>
          <div className='cc-brand__sig'><span />SNL</div>
          <div><span className='cc-kicker'>OPERATIONS / GLOBAL COMMAND</span><h1>Command Centre</h1></div>
        </div>
        <div className='cc-posture'><span className={`cc-state-dot cc-state-dot--${posture.toLowerCase()}`} /> <b>{posture}</b><small>{openIssues} OPEN ISSUES</small></div>
        <div className='cc-topline__right'>
          <span className='cc-live'><i /> LIVE FABRIC</span>
          <span className='cc-clock'><Clock3 size={13} /> SHIFT {shift}</span>
          <button type='button' onClick={() => nav({ to: '/panic-center' as any })} className={panic ? 'cc-panic cc-panic--live' : 'cc-panic'}><Siren size={14} /> {panic ? 'PANIC ACTIVE' : 'PANIC CENTER'}</button>
        </div>
      </section>

      <section className='cc-toolbar' aria-label='Operational controls'>
        <Metric icon={Truck} label='LIVE VEHICLES' value={liveVehicles} detail='tracking now' />
        <Metric icon={Route} label='ACTIVE CONVOYS' value={activeConvoys} detail='in movement' />
        <Metric icon={AlertTriangle} label='PRIORITY' value={priority} detail='high + critical' tone={priority > 0 ? 'warn' : 'normal'} />
        <Metric icon={ShieldCheck} label='OPEN ISSUES' value={openIssues} detail='unresolved' tone={openIssues > 0 ? 'warn' : 'normal'} />
        <Metric icon={Radio} label='COMMS' value='LIVE' detail='operator channels' />
        <div className='cc-toolbar__actions'>
          <button type='button' onClick={() => nav({ to: '/alerts' as any })}>ALERTS <b>{priority}</b></button>
          <button type='button' onClick={() => nav({ to: '/messages' as any })}>MESSAGES</button>
          <button type='button' onClick={() => nav({ to: '/intelligence' as any })}>INTELLIGENCE</button>
        </div>
      </section>

      <section className='cc-main'>
        <div className='cc-map'>
          <header className='cc-map__header'>
            <div><span className='cc-kicker'><Crosshair size={12} /> MOVEMENT PICTURE</span><h2>East Africa / Live theatre</h2></div>
            <div className='cc-map__legend'><span><i className='legend-dot legend-dot--green' /> MOVING</span><span><i className='legend-dot legend-dot--amber' /> EXCEPTION</span><span><i className='legend-dot legend-dot--red' /> CRITICAL</span></div>
          </header>
          <div className='cc-map__body'>
            <Suspense fallback={<div className='cc-map__loading'><Activity size={18} /><span>CONNECTING TO MOVEMENT FABRIC…</span></div>}>
              <TacticalMap fill />
            </Suspense>
            <div className='cc-map__hud cc-map__hud--tl'><b>OPS-01</b><span>GLOBAL MOVEMENT</span></div>
            <div className='cc-map__hud cc-map__hud--tr'><span className='cc-live'><i /> STREAM</span><span>60s REFRESH</span></div>
            <div className='cc-map__hud cc-map__hud--bl'><span>MAP: TACTICAL / OSM</span><span>GEOFENCE + RISK LAYERS</span></div>
            <div className='cc-map__hud cc-map__hud--br'><span>CLICK EVENT → DETAIL</span></div>
            <div className='cc-map__crosshair'><span /><i /></div>
          </div>
        </div>

        <aside className='cc-queue'>
          <div className='cc-queue__head'>
            <div><span className='cc-kicker'>RESPONSE LANE</span><h2>Priority queue</h2></div>
            <span className='cc-count'>{priority > 0 ? `${priority} PRIORITY` : 'CLEAR'}</span>
          </div>
          <div className='cc-queue__body'><PriorityQueue onSelect={setSelected} /></div>
        </aside>
      </section>

      <section className='cc-bottom'>
        <div className='cc-bottom__mission'>
          <div><span className='cc-kicker'>NEXT OPERATIONAL MILESTONE</span><strong>{nextDelivery?.convoy_name ?? convoys[0]?.name ?? 'AWAITING ASSIGNMENT'}</strong></div>
          <div><span>ETA</span><b>{nextDelivery ? formatTime(nextDelivery.eta) : '—'}</b></div>
          <div><span>STATUS</span><b>{nextDelivery ? 'TRACKED' : 'STANDBY'}</b></div>
          <div><span>RISK</span><b>{level.toUpperCase()}</b></div>
        </div>
        <div className='cc-events'><EventsTicker /></div>
      </section>

      {selected && <ObjectDrawer item={selected} onClose={() => setSelected(null)} />}

      <style>{`
        .cc-v3{--cc-border:rgba(255,255,255,.09);--cc-muted:#81909a;--cc-text:#edf3f5;--cc-well:#071115;--cc-panel:#0b171b;position:relative;display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;padding:9px 10px 8px;background:#050b0d;color:var(--cc-text);font-family:Inter,system-ui,sans-serif;overflow:hidden}
        .cc-v3:before{content:'';position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:32px 32px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.8),transparent 95%)}
        .cc-kicker{display:inline-flex;align-items:center;gap:5px;color:#7d8c95;font-size:8px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
        .cc-topline{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:54px;padding:0 8px 7px;border-bottom:1px solid var(--cc-border)}
        .cc-brand{display:flex;align-items:center;gap:11px;min-width:220px}.cc-brand__sig{display:grid;place-items:center;position:relative;width:38px;height:38px;border:1px solid rgba(50,223,174,.35);font:800 10px/1 'JetBrains Mono',monospace;letter-spacing:.08em;color:#a7fff0;background:#061315}.cc-brand__sig span{position:absolute;top:-1px;left:5px;right:5px;height:2px;background:#2edeb0}.cc-brand h1{margin:2px 0 0;font-size:20px;line-height:1;font-weight:700;letter-spacing:-.03em}.cc-posture{display:flex;align-items:center;gap:8px;padding:8px 12px;border-left:1px solid var(--cc-border);border-right:1px solid var(--cc-border);font-size:11px}.cc-posture small{margin-left:6px;color:var(--cc-muted);font:800 8px 'JetBrains Mono',monospace;letter-spacing:.1em}.cc-state-dot{width:7px;height:7px;border-radius:50%;background:#28dfa9}.cc-state-dot--elevated{background:#f2b84b}.cc-state-dot--critical{background:#ff4d6b;box-shadow:0 0 12px rgba(255,77,107,.45)}.cc-topline__right{display:flex;align-items:center;gap:10px;margin-left:auto}.cc-live{display:inline-flex;align-items:center;gap:6px;color:#89a0aa;font:800 8px 'JetBrains Mono',monospace;letter-spacing:.1em}.cc-live i{width:6px;height:6px;border-radius:50%;background:#2edeb0;box-shadow:0 0 8px rgba(46,222,176,.6)}.cc-clock{display:flex;align-items:center;gap:5px;color:#71818a;font:700 9px 'JetBrains Mono',monospace}.cc-panic{display:flex;align-items:center;gap:6px;border:1px solid rgba(255,77,107,.3);background:rgba(255,77,107,.05);color:#ff6c86;border-radius:4px;padding:7px 10px;font:800 8px 'JetBrains Mono',monospace;letter-spacing:.08em;cursor:pointer}.cc-panic--live{background:#7d1329;color:#fff;border-color:#ff5572}
        .cc-toolbar{position:relative;z-index:1;display:flex;align-items:stretch;gap:0;min-height:52px;border:1px solid var(--cc-border);background:rgba(11,23,27,.9);overflow:hidden}.cc-metric{display:flex;align-items:center;gap:9px;min-width:120px;padding:7px 12px;border-right:1px solid var(--cc-border)}.cc-metric>svg{color:#6c8a95}.cc-metric--warn>svg{color:#f2b84b}.cc-metric--critical>svg{color:#ff4d6b}.cc-metric__copy{display:grid;gap:1px}.cc-metric span,.cc-metric small{font:800 7px 'JetBrains Mono',monospace;color:#6f7e86;letter-spacing:.1em}.cc-metric strong{font:800 15px/1 'JetBrains Mono',monospace;color:#eef7f8}.cc-metric small{font-size:7px;font-weight:600;letter-spacing:.03em}.cc-toolbar__actions{display:flex;align-items:center;gap:6px;margin-left:auto;padding:7px}.cc-toolbar__actions button{height:34px;padding:0 10px;border:1px solid var(--cc-border);background:#071115;color:#a9b6bc;border-radius:4px;font:800 8px 'JetBrains Mono',monospace;letter-spacing:.08em;cursor:pointer}.cc-toolbar__actions button:hover{border-color:rgba(50,223,174,.35);color:#efffff}.cc-toolbar__actions b{color:#f2b84b}
        .cc-main{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) 335px;gap:8px;flex:1;min-height:0}.cc-map,.cc-queue{min-height:0;border:1px solid var(--cc-border);background:var(--cc-panel);overflow:hidden}.cc-map{display:flex;flex-direction:column}.cc-map__header{display:flex;align-items:center;justify-content:space-between;padding:8px 11px;border-bottom:1px solid var(--cc-border);background:#091417}.cc-map__header h2,.cc-queue__head h2{margin:2px 0 0;font-size:13px;font-weight:700;letter-spacing:-.02em}.cc-map__legend{display:flex;gap:12px;color:#76858c;font:800 7px 'JetBrains Mono',monospace}.cc-map__legend span{display:flex;align-items:center;gap:4px}.legend-dot{width:5px;height:5px;border-radius:50%}.legend-dot--green{background:#2edeb0}.legend-dot--amber{background:#f2b84b}.legend-dot--red{background:#ff4d6b}.cc-map__body{position:relative;flex:1;min-height:0}.cc-map__body>div:first-child{height:100%}.cc-map__loading{height:100%;display:grid;place-items:center;align-content:center;gap:8px;color:#66767e;font:800 9px 'JetBrains Mono',monospace}.cc-map__hud{position:absolute;z-index:3;display:flex;gap:10px;padding:5px 7px;background:rgba(3,9,11,.78);border:1px solid rgba(255,255,255,.08);color:#8ea0a7;font:800 7px 'JetBrains Mono',monospace;letter-spacing:.08em}.cc-map__hud b{color:#dce8ea}.cc-map__hud--tl{top:9px;left:9px}.cc-map__hud--tr{top:9px;right:9px}.cc-map__hud--bl{bottom:9px;left:9px}.cc-map__hud--br{bottom:9px;right:9px}.cc-map__crosshair{position:absolute;z-index:2;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);opacity:.35;pointer-events:none}.cc-map__crosshair:before,.cc-map__crosshair:after{content:'';position:absolute;background:#2edeb0}.cc-map__crosshair:before{width:1px;height:100%;left:50%}.cc-map__crosshair:after{height:1px;width:100%;top:50%}.cc-map__crosshair span{position:absolute;inset:7px;border:1px solid #2edeb0;border-radius:50%}.cc-queue{display:flex;flex-direction:column}.cc-queue__head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--cc-border);background:#091417}.cc-count{font:800 7px 'JetBrains Mono',monospace;color:#f2b84b;letter-spacing:.08em}.cc-queue__body{flex:1;min-height:0;overflow:auto}.cc-queue__body .d-console-queue{height:100%;border-left:0!important;background:transparent!important}.cc-queue__body .d-console-queue>div:first-child{display:none}.cc-queue__body .d-console-queue>div{padding-left:10px!important;padding-right:10px!important}
        .cc-bottom{position:relative;z-index:1;display:grid;grid-template-columns:minmax(320px, .8fr) minmax(0,1.2fr);gap:8px;min-height:47px}.cc-bottom__mission,.cc-events{border:1px solid var(--cc-border);background:#091417;min-width:0}.cc-bottom__mission{display:grid;grid-template-columns:minmax(0,1fr) 64px 76px 76px;align-items:center}.cc-bottom__mission>div{padding:7px 10px;border-right:1px solid var(--cc-border);display:grid;gap:2px;min-width:0}.cc-bottom__mission>div:last-child{border-right:0}.cc-bottom__mission strong{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cc-bottom__mission span{font:800 7px 'JetBrains Mono',monospace;color:#6f7e86;letter-spacing:.08em}.cc-bottom__mission b{font:800 9px 'JetBrains Mono',monospace}.cc-events{overflow:hidden;padding:0 8px}.cc-events>*{height:100%;margin:0!important;border:0!important;background:transparent!important}
        .cc-drawer-backdrop{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.58);display:flex;justify-content:flex-end}.cc-drawer{width:min(430px,100%);height:100%;padding:18px;background:#071014;border-left:1px solid rgba(255,255,255,.1);box-shadow:-25px 0 70px rgba(0,0,0,.4);overflow:auto}.cc-drawer header{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--cc-border);padding-bottom:14px}.cc-drawer h2{margin:6px 0 0;font-size:22px;line-height:1.15}.cc-drawer header button{width:32px;height:32px;background:transparent;border:1px solid var(--cc-border);color:#87979f;font-size:21px;cursor:pointer}.cc-drawer__signal{display:grid;grid-template-columns:12px 1fr 1fr;gap:10px;padding:14px 0}.cc-drawer__signal>span{width:8px;height:100%;min-height:34px}.cc-drawer__signal small,.cc-drawer__facts span{display:block;font:800 7px 'JetBrains Mono',monospace;color:#66767e;letter-spacing:.1em}.cc-drawer__signal strong{display:block;margin-top:2px;font:800 11px 'JetBrains Mono',monospace}.cc-drawer p{color:#a7b3b8;font-size:13px;line-height:1.55;border-top:1px solid var(--cc-border);border-bottom:1px solid var(--cc-border);padding:15px 0}.cc-drawer__facts{display:grid;gap:10px;padding:14px 0}.cc-drawer__facts b{display:block;margin-top:3px;font-size:10px}.cc-drawer__actions{display:grid;gap:7px;margin-top:8px}.cc-drawer__actions button{height:38px;border:1px solid var(--cc-border);background:#0b181d;color:#d4e0e3;font:800 9px 'JetBrains Mono',monospace;letter-spacing:.08em;cursor:pointer}.cc-drawer__actions button:first-child{border-color:rgba(242,184,75,.35);color:#f2c66e}
        @media (max-width:1050px){.cc-main{grid-template-columns:minmax(0,1fr) 300px}.cc-metric{min-width:100px}.cc-metric__copy small{display:none}.cc-posture{display:none}}
        @media (max-width:820px){.cc-v3{overflow:auto}.cc-topline__right .cc-clock{display:none}.cc-toolbar{overflow:auto}.cc-main{grid-template-columns:1fr;min-height:620px}.cc-queue{min-height:310px}.cc-bottom{grid-template-columns:1fr}.cc-bottom__mission{min-height:47px}}
        @media (max-width:560px){.cc-brand h1{font-size:17px}.cc-brand{min-width:0}.cc-topline__right .cc-live{display:none}.cc-panic{padding:7px}.cc-toolbar__actions{display:none}.cc-metric{min-width:105px}.cc-map__legend{display:none}.cc-bottom__mission{grid-template-columns:1fr 60px 65px 65px}}
      `}</style>
    </main>
  );
}
