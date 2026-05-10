import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Truck, Shield, Bell, TrendingUp, Activity, AlertTriangle,
  MapPin, Clock, CheckCircle2, ArrowUpRight,
  Navigation, Radio, Target, RefreshCw,
} from 'lucide-react';
import { analyticsAPI } from '../services/api';
import { useAlertStore } from '../store';
import socketService from '../services/socket';
import { KPICard, Card, Badge, Spinner, SkeletonCard, Skeleton, EmptyState } from '../components/UI';
import { timeAgo, truncate } from '../utils/helpers';
import { useInterval } from '../hooks';

const CHART_STYLE = {
  contentStyle: {
    background: '#0A0F1A',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    fontSize: 11,
    color: '#e2e8f0',
    padding: '8px 12px',
  },
  cursor: { fill: 'rgba(240,180,41,0.03)' },
};

const FEED_CONFIG = {
  gps:    { color: 'text-success', bg: 'bg-success/10', icon: Navigation },
  alert:  { color: 'text-danger',  bg: 'bg-danger/10',  icon: AlertTriangle },
  convoy: { color: 'text-gold',    bg: 'bg-gold/10',    icon: Shield },
};

function QuickAction({ icon: Icon, label, color }) {
  return (
    <button className="flex flex-col items-center gap-2 p-4 bg-navy-800/60 border border-white/5 rounded-xl hover:border-white/10 hover:bg-navy-800 transition-all duration-150 group">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color} group-hover:scale-110 transition-transform`}>
        <Icon size={16} />
      </div>
      <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-300 tracking-wider transition-colors text-center leading-tight">{label}</span>
    </button>
  );
}

function MissionCard({ mission }) {
  const progress = mission.progress ?? 0;
  return (
    <div className="px-5 py-4 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-slate-300">{mission.name}</span>
            <Badge status={mission.status} dot>{mission.status?.toUpperCase()}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
            <MapPin size={10} />
            <span>{mission.origin}</span>
            <span className="text-slate-700">→</span>
            <span>{mission.destination}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono flex-shrink-0">
          <Clock size={10} />
          <span>{mission.eta || '—'}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1 bg-navy-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${
            mission.status === 'delayed' ? 'bg-amber-500' :
            mission.status === 'incident' ? 'bg-danger' : 'bg-gold'
          }`} style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] font-mono text-slate-600 w-8 text-right">{progress}%</span>
      </div>
    </div>
  );
}

const MOCK_CONVOYS = [
  { id: '1', name: 'CONVOY-ALPHA',   status: 'active',   origin: 'Nairobi',      destination: 'Kisumu',  progress: 67 },
  { id: '2', name: 'CONVOY-BRAVO',   status: 'delayed',  origin: 'Dar es Salaam',destination: 'Dodoma',  progress: 34 },
  { id: '3', name: 'CONVOY-CHARLIE', status: 'planned',  origin: 'Kampala',      destination: 'Jinja',   progress: 0  },
];

export default function DashboardPage() {
  const [kpis, setKpis] = useState(null);
  const [convoyMetrics, setConvoyMetrics] = useState([]);
  const [fleetUtil, setFleetUtil] = useState([]);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { alerts, fetchAlerts } = useAlertStore();

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [dash, metrics, util] = await Promise.all([
        analyticsAPI.dashboard(),
        analyticsAPI.convoyMetrics(),
        analyticsAPI.fleetUtilization(),
      ]);
      setKpis(dash.data.data);
      setConvoyMetrics(metrics.data.data.slice(-14).map((d) => ({
        day: new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        Completed: parseInt(d.completed) || 0,
        'On Time':  parseInt(d.on_time)  || 0,
        Delayed:    parseInt(d.delayed)  || 0,
      })));
      setFleetUtil(util.data.data.map((r) => ({
        region:      r.region,
        Active:      parseInt(r.active)      || 0,
        Idle:        parseInt(r.idle)        || 0,
        Maintenance: parseInt(r.maintenance) || 0,
      })));
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    fetchAlerts({ resolved: 'false', limit: 5 });
    socketService.onVehicleUpdate((data) => {
      setFeed((f) => [{ type: 'gps',    ...data, ts: new Date() }, ...f].slice(0, 30));
    });
    socketService.onAlertNew((data) => {
      setFeed((f) => [{ type: 'alert',  ...data, ts: new Date() }, ...f].slice(0, 30));
    });
    socketService.onConvoyUpdate((data) => {
      setFeed((f) => [{ type: 'convoy', ...data, ts: new Date() }, ...f].slice(0, 30));
    });
  }, []);

  useInterval(() => loadData(), 30000);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono text-slate-700 tracking-[0.2em]">FLEETOPS PRO</span>
            <span className="text-slate-700">·</span>
            <span className="text-[10px] font-mono text-slate-700 tracking-[0.2em]">COMMAND CENTER</span>
          </div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Operational Overview</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">Live · Auto-refresh every 30s</p>
        </div>
        <button onClick={() => loadData(true)}
          className={`flex items-center gap-2 px-3 py-2 bg-navy-800/60 border border-white/[0.08] rounded-lg text-xs font-mono text-slate-500 hover:text-slate-300 hover:border-white/15 transition-all ${refreshing ? 'opacity-50 pointer-events-none' : ''}`}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">REFRESH</span>
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Active Convoys"    value={kpis?.activeConvoys ?? '—'}              icon={Shield}    color="text-gold"      sub="missions in progress" />
          <KPICard label="Fleet Utilisation" value={kpis ? `${kpis.fleetUtilisation}%` : '—'} icon={Truck}     color="text-success"   sub={`${kpis?.activeVehicles ?? '—'} of ${kpis?.totalVehicles ?? '—'} vehicles`} />
          <KPICard label="Open Alerts"       value={kpis?.openAlerts ?? '—'}                 icon={Bell}      color={kpis?.openAlerts > 0 ? 'text-danger' : 'text-slate-400'} sub="unresolved incidents" pulse={kpis?.openAlerts > 0} />
          <KPICard label="On-Time Rate"      value={kpis ? `${kpis.onTimeRate}%` : '—'}      icon={TrendingUp} color="text-blue-400"  sub="completed missions" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card header="Convoy Activity" className="xl:col-span-2" action={<span className="text-[10px] font-mono text-slate-600">LAST 14 DAYS</span>}>
          <div className="px-4 pb-4 pt-2">
            {loading ? (
              <div className="h-52 flex items-center justify-center"><Spinner /></div>
            ) : convoyMetrics.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={convoyMetrics} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#F0B429" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F0B429" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOnTime" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22D3A0" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22D3A0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip {...CHART_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#64748b', paddingTop: 8 }} />
                  <Area type="monotone" dataKey="Completed" stroke="#F0B429" fill="url(#gCompleted)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="On Time"   stroke="#22D3A0" fill="url(#gOnTime)"    strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Delayed"   stroke="#F25252" fill="none"             strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={Activity} title="No convoy data yet" subtitle="Data will appear once missions are active" />}
          </div>
        </Card>

        <Card header="Live Event Feed" action={<div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /><span className="text-[10px] font-mono text-success/70">LIVE</span></div>}>
          <div className="divide-y divide-white/[0.04] max-h-[280px] overflow-y-auto">
            {feed.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Radio size={20} className="mx-auto mb-2 text-slate-700" />
                <p className="text-xs text-slate-600 font-mono">AWAITING EVENTS…</p>
              </div>
            ) : feed.map((ev, i) => {
              const cfg = FEED_CONFIG[ev.type] || FEED_CONFIG.gps;
              const Icon = cfg.icon;
              return (
                <div key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors">
                  <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                    <Icon size={10} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-300 leading-snug">
                      {ev.type === 'gps'    && `Vehicle ${truncate(ev.vehicleId, 8)} — ${ev.speed?.toFixed(0) ?? '?'} km/h`}
                      {ev.type === 'alert'  && `${ev.severity?.toUpperCase()}: ${truncate(ev.message, 32)}`}
                      {ev.type === 'convoy' && `${truncate(ev.convoyId, 8)} → ${ev.status}`}
                    </p>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">{timeAgo(ev.ts)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card header="Fleet by Region" action={<span className="text-[10px] font-mono text-slate-600">VEHICLES</span>}>
          <div className="px-4 pb-4 pt-2">
            {loading ? <div className="h-48 flex items-center justify-center"><Spinner /></div>
            : fleetUtil.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={fleetUtil} barSize={10} barGap={2} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis dataKey="region" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip {...CHART_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#64748b', paddingTop: 8 }} />
                  <Bar dataKey="Active"      fill="#22D3A0" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Idle"        fill="#1e293b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Maintenance" fill="#D97706" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={Truck} title="No fleet data" />}
          </div>
        </Card>

        <Card header="Active Missions" action={<button className="text-[10px] font-mono text-gold/70 hover:text-gold flex items-center gap-1 transition-colors">VIEW ALL <ArrowUpRight size={10} /></button>}>
          {loading ? (
            <div className="p-4 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} lines={2} />)}</div>
          ) : (
            <div>{MOCK_CONVOYS.map(c => <MissionCard key={c.id} mission={c} />)}</div>
          )}
        </Card>

        <div className="space-y-5">
          <Card header="Recent Alerts" action={<span className="text-[10px] font-mono text-slate-600">{alerts.length} OPEN</span>}>
            <div className="divide-y divide-white/[0.04]">
              {alerts.slice(0, 4).map((a) => (
                <div key={a.id} className="px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] transition-colors">
                  <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge severity={a.severity} dot>{a.severity?.toUpperCase()}</Badge>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">{truncate(a.message, 50)}</p>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">{timeAgo(a.created_at)}</p>
                  </div>
                </div>
              ))}
              {alerts.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <CheckCircle2 size={20} className="mx-auto mb-2 text-success/40" />
                  <p className="text-xs text-slate-600 font-mono">ALL CLEAR</p>
                </div>
              )}
            </div>
          </Card>

          <Card header="Quick Actions">
            <div className="p-4 grid grid-cols-2 gap-2">
              <QuickAction icon={Shield} label="NEW CONVOY"  color="bg-gold/10 text-gold" />
              <QuickAction icon={Truck}  label="ADD VEHICLE" color="bg-blue-500/10 text-blue-400" />
              <QuickAction icon={Bell}   label="LOG ALERT"   color="bg-danger/10 text-danger" />
              <QuickAction icon={Target} label="DISPATCH"    color="bg-success/10 text-success" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
