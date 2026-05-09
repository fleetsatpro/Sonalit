import { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Truck, Shield, Bell, TrendingUp, Activity, AlertTriangle } from 'lucide-react';
import { analyticsAPI } from '../services/api';
import { useAlertStore, useVehicleStore } from '../store';
import socketService from '../services/socket';
import { KPICard, Card, Badge, Spinner } from '../components/UI';
import { timeAgo, truncate } from '../utils/helpers';
import { useInterval } from '../hooks';

const TOOLTIP_STYLE = { contentStyle: { background: '#0D1321', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }, cursor: { fill: 'rgba(240,180,41,0.04)' } };

export default function DashboardPage() {
  const [kpis, setKpis] = useState(null);
  const [convoyMetrics, setConvoyMetrics] = useState([]);
  const [fleetUtil, setFleetUtil] = useState([]);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const { alerts, fetchAlerts } = useAlertStore();

  const loadData = async () => {
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
        'On Time': parseInt(d.on_time) || 0,
        Delayed: parseInt(d.delayed) || 0,
      })));
      setFleetUtil(util.data.data.map((r) => ({
        region: r.region,
        Active: parseInt(r.active) || 0,
        Idle: parseInt(r.idle) || 0,
        Maintenance: parseInt(r.maintenance) || 0,
      })));
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    fetchAlerts({ resolved: 'false', limit: 5 });

    // Live feed from socket
    socketService.onVehicleUpdate((data) => {
      setFeed((f) => [{ type: 'gps', ...data, ts: new Date() }, ...f].slice(0, 20));
    });
    socketService.onAlertNew((data) => {
      setFeed((f) => [{ type: 'alert', ...data, ts: new Date() }, ...f].slice(0, 20));
    });
    socketService.onConvoyUpdate((data) => {
      setFeed((f) => [{ type: 'convoy', ...data, ts: new Date() }, ...f].slice(0, 20));
    });
  }, []);

  useInterval(loadData, 30000); // Refresh KPIs every 30s

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-bold text-gold tracking-widest">COMMAND DASHBOARD</h1>
        <p className="text-slate-500 text-sm font-mono mt-0.5">Real-time operational overview</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Active Convoys" value={kpis?.activeConvoys ?? '—'} icon={Shield} color="text-gold" sub="missions in progress" />
        <KPICard label="Fleet Utilisation" value={kpis ? `${kpis.fleetUtilisation}%` : '—'} icon={Truck} color="text-success" sub={`${kpis?.activeVehicles} of ${kpis?.totalVehicles} vehicles`} />
        <KPICard label="Open Alerts" value={kpis?.openAlerts ?? '—'} icon={Bell} color={kpis?.openAlerts > 0 ? 'text-danger' : 'text-slate-400'} sub="unresolved" />
        <KPICard label="On-Time Rate" value={kpis ? `${kpis.onTimeRate}%` : '—'} icon={TrendingUp} color="text-blue-400" sub="completed missions" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Convoy Metrics Chart */}
        <Card header="Convoy Activity — Last 14 Days" className="xl:col-span-2">
          <div className="px-4 pb-4 pt-2">
            {convoyMetrics.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={convoyMetrics}>
                  <defs>
                    <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F0B429" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#F0B429" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOnTime" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22D3A0" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22D3A0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  <Area type="monotone" dataKey="Completed" stroke="#F0B429" fill="url(#gCompleted)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="On Time" stroke="#22D3A0" fill="url(#gOnTime)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Delayed" stroke="#F25252" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="h-56 flex items-center justify-center text-slate-600 text-sm">No convoy data yet</div>}
          </div>
        </Card>

        {/* Live Event Feed */}
        <Card header="Live Event Feed">
          <div className="divide-y divide-white/5 max-h-[280px] overflow-y-auto">
            {feed.length === 0 ? (
              <div className="px-4 py-10 text-center text-slate-600 text-sm">
                <Activity size={24} className="mx-auto mb-2 opacity-30" />
                Waiting for events…
              </div>
            ) : feed.map((ev, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-white/2 transition-colors">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${ev.type === 'alert' ? 'bg-danger' : ev.type === 'convoy' ? 'bg-gold' : 'bg-success'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300 leading-snug">
                    {ev.type === 'gps' && `Vehicle ${truncate(ev.vehicleId, 8)} moved — ${ev.speed?.toFixed(0)} km/h`}
                    {ev.type === 'alert' && `${ev.severity?.toUpperCase()} alert: ${truncate(ev.message, 35)}`}
                    {ev.type === 'convoy' && `Convoy ${truncate(ev.convoyId, 8)} → ${ev.status}`}
                  </p>
                  <p className="text-[10px] text-slate-600 font-mono mt-0.5">{timeAgo(ev.ts)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Fleet Utilisation */}
        <Card header="Fleet by Region">
          <div className="px-4 pb-4 pt-2">
            {fleetUtil.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={fleetUtil} barSize={14} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="region" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  <Bar dataKey="Active" fill="#22D3A0" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Idle" fill="#334155" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Maintenance" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No data</div>}
          </div>
        </Card>

        {/* Recent Alerts */}
        <Card header="Recent Alerts" action={<span className="text-xs text-slate-500 font-mono">{alerts.length} unresolved</span>}>
          <div className="divide-y divide-white/5">
            {alerts.slice(0, 5).map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={14} className={a.severity === 'critical' ? 'text-red-400 mt-0.5' : 'text-amber-400 mt-0.5'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge severity={a.severity}>{a.severity}</Badge>
                    <span className="text-xs font-mono text-slate-500">{a.type}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-snug">{truncate(a.message, 60)}</p>
                  <p className="text-[10px] text-slate-600 font-mono mt-0.5">{timeAgo(a.created_at)}</p>
                </div>
              </div>
            ))}
            {alerts.length === 0 && (
              <div className="px-4 py-10 text-center text-slate-600 text-sm">No open alerts</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
