import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid
} from 'recharts';
import {
  Truck, Shield, Bell, TrendingUp, Activity, AlertTriangle,
  MapPin, Clock, CheckCircle2, ArrowUpRight, ArrowDownRight,
  Navigation, Radio, Target, RefreshCw, Zap, Globe,
  Package, DollarSign, Users, Eye, ChevronRight, Fuel,
  Wrench, BarChart2, XCircle, PlayCircle, PauseCircle,
  AlertOctagon, Gauge, Layers, Wifi, WifiOff, Star
} from 'lucide-react';
import { analyticsAPI, vehiclesAPI, convoysAPI, alertsAPI } from '../services/api';
import api from '../services/api';
import { useAlertStore } from '../store';
import socketService from '../services/socket';
import { timeAgo, formatDate } from '../utils/helpers';
import { useInterval } from '../hooks';

const CHART = {
  content: { background:'#0D1321', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, fontSize:11, color:'#e2e8f0', padding:'8px 12px' },
  cursor: { fill:'rgba(240,180,41,0.03)' },
};

function MetricCard({ label, value, sub, icon: Icon, color = 'text-gold', trend, onClick, critical }) {
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden bg-navy-900 border rounded-2xl p-5 transition-all
        ${critical ? 'border-danger/40 bg-danger/5' : 'border-white/[0.06] hover:border-white/10'}
        ${onClick ? 'cursor-pointer' : ''}`}
    >
      {critical && <div className="absolute inset-0 bg-danger/5 animate-pulse" />}
      <div className="relative flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${critical ? 'bg-danger/20 border border-danger/30' : 'bg-white/[0.04] border border-white/[0.06]'}`}>
          <Icon size={18} className={critical ? 'text-danger' : color} />
        </div>
        {trend != null && (
          <div className={`flex items-center gap-1 text-[10px] font-mono font-bold ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
            {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="relative">
        <p className={`font-display text-3xl font-bold leading-none mb-1 ${critical ? 'text-danger' : color}`}>{value}</p>
        <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">{label}</p>
        {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function LiveFeedItem({ event }) {
  const config = {
    alert: { color: 'text-danger', dot: 'bg-danger', icon: AlertTriangle },
    gps: { color: 'text-success', dot: 'bg-success', icon: Navigation },
    convoy: { color: 'text-gold', dot: 'bg-gold', icon: Shield },
    deviation: { color: 'text-orange-400', dot: 'bg-orange-400', icon: AlertOctagon },
    system: { color: 'text-slate-400', dot: 'bg-slate-500', icon: Radio },
  };
  const c = config[event.type] || config.system;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/[0.04] last:border-0">
      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.dot} ${event.type === 'alert' ? 'animate-pulse' : ''}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-200 leading-snug">{event.message}</p>
        <p className={`text-[10px] font-mono mt-0.5 ${c.color}`}>{event.type?.toUpperCase()} · {timeAgo(event.time)}</p>
      </div>
    </div>
  );
}

function ActiveMissionCard({ convoy, onExpand }) {
  const riskColor = { LOW:'text-success', MEDIUM:'text-amber-400', HIGH:'text-orange-400', CRITICAL:'text-danger' };
  const riskBg = { LOW:'bg-success/10 border-success/20', MEDIUM:'bg-amber-400/10 border-amber-400/20', HIGH:'bg-orange-400/10 border-orange-400/20', CRITICAL:'bg-danger/10 border-danger/20' };
  const risk = convoy.risk_score >= 70 ? 'CRITICAL' : convoy.risk_score >= 40 ? 'HIGH' : convoy.risk_score >= 20 ? 'MEDIUM' : 'LOW';
  const progress = convoy.departure_time && convoy.estimated_arrival
    ? Math.min(100, Math.max(0, ((Date.now() - new Date(convoy.departure_time)) / (new Date(convoy.estimated_arrival) - new Date(convoy.departure_time))) * 100))
    : 0;

  return (
    <div onClick={() => onExpand(convoy)} className="bg-navy-800 border border-white/[0.06] rounded-xl p-4 cursor-pointer hover:border-white/10 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-mono font-bold text-sm text-slate-200">{convoy.name}</p>
          <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
            <Navigation size={9} />{convoy.route_origin} → {convoy.route_destination}
          </p>
        </div>
        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${riskBg[risk]} ${riskColor[risk]}`}>
          {risk}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-3 text-[10px] font-mono text-slate-500">
        <span className="flex items-center gap-1"><Truck size={9} />{convoy.vehicle_count || 0}</span>
        <span className="flex items-center gap-1"><MapPin size={9} />{convoy.region}</span>
        {convoy.estimated_arrival && (
          <span className="flex items-center gap-1 text-gold">
            <Clock size={9} />ETA {new Date(convoy.estimated_arrival).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}
          </span>
        )}
      </div>
      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[9px] font-mono text-slate-600">
          <span>{convoy.route_origin}</span>
          <span>{Math.round(progress)}%</span>
          <span>{convoy.route_destination}</span>
        </div>
        <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
          <div className="h-full bg-gold rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}

function SituationBoard({ convoys, vehicles, alerts }) {
  const byRegion = {};
  vehicles.forEach(v => {
    if (!byRegion[v.region]) byRegion[v.region] = { active: 0, idle: 0, maintenance: 0, offline: 0 };
    byRegion[v.region][v.status] = (byRegion[v.region][v.status] || 0) + 1;
  });

  return (
    <div className="grid grid-cols-2 gap-3">
      {Object.entries(byRegion).map(([region, stats]) => {
        const regionAlerts = alerts.filter(a => a.region === region && !a.resolved_at);
        const hasCritical = regionAlerts.some(a => a.severity === 'critical');
        return (
          <div key={region} className={`bg-navy-800 border rounded-xl p-3 ${hasCritical ? 'border-danger/30' : 'border-white/[0.06]'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-bold text-slate-300 tracking-wider">{region.toUpperCase()}</span>
              {hasCritical && <span className="text-[9px] text-danger font-mono font-bold animate-pulse">⚠ CRITICAL</span>}
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              {[['A',stats.active,'text-success'],['I',stats.idle,'text-slate-500'],['M',stats.maintenance,'text-amber-400'],['X',stats.offline,'text-danger']].map(([l,v,c]) => (
                <div key={l}>
                  <p className={`text-sm font-bold font-mono ${c}`}>{v || 0}</p>
                  <p className="text-[8px] text-slate-600">{l}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CommandCenter() {
  const [kpis, setKpis] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [convoys, setConvoys] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [feed, setFeed] = useState([]);
  const [shipmentStats, setShipmentStats] = useState(null);
  const [financeStats, setFinanceStats] = useState(null);
  const [convoyMetrics, setConvoyMetrics] = useState([]);
  const [vehicleStatus, setVehicleStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const { fetchUnread } = useAlertStore();

  const load = useCallback(async () => {
    try {
      const [kpiRes, vRes, cRes, aRes] = await Promise.all([
        analyticsAPI.dashboard(),
        vehiclesAPI.list({ limit: 100 }),
        convoysAPI.list({ status: 'active', limit: 20 }),
        alertsAPI.list({ resolved: 'false', limit: 20 }),
      ]);
      const kpiData = kpiRes.data.data || {};
      setKpis(kpiData);
      setVehicles(vRes.data.data || []);
      setConvoys(cRes.data.data || []);
      setAlerts(aRes.data.data || []);
      setLastRefresh(new Date());

      // Build vehicle status chart
      const vs = vRes.data.data || [];
      const statusMap = {};
      vs.forEach(v => { statusMap[v.status] = (statusMap[v.status] || 0) + 1; });
      setVehicleStatus([
        { name: 'Active', value: statusMap.active || 0, color: '#22D3A0' },
        { name: 'Idle', value: statusMap.idle || 0, color: '#475569' },
        { name: 'Maintenance', value: statusMap.maintenance || 0, color: '#F59E0B' },
        { name: 'Offline', value: statusMap.offline || 0, color: '#F25252' },
      ]);

      // Convoy metrics
      try {
        const cmRes = await analyticsAPI.convoyMetrics();
        setConvoyMetrics(cmRes.data.data || []);
      } catch {}

      // Shipment stats
      try {
        const sRes = await api.get('/shipments/stats/summary');
        setShipmentStats(sRes.data.data);
      } catch {}

      // Finance
      try {
        const fRes = await api.get('/finance/dashboard');
        setFinanceStats(fRes.data.data);
      } catch {}

      fetchUnread();
    } catch (err) {
      console.error('Command center load error:', err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useInterval(load, 30000);

  useEffect(() => {
    socketService.onAlert(data => {
      setFeed(prev => [{
        id: Date.now(), type: 'alert', time: new Date(),
        message: `${data.severity?.toUpperCase()}: ${data.message}`,
      }, ...prev.slice(0, 29)]);
    });
    socketService.onVehicleUpdate(data => {
      if (data.speed > 100) {
        setFeed(prev => [{
          id: Date.now(), type: 'gps', time: new Date(),
          message: `Vehicle moving at ${data.speed} km/h`,
        }, ...prev.slice(0, 29)]);
      }
    });
    socketService.onConvoyDeviation(data => {
      setFeed(prev => [{
        id: Date.now(), type: 'deviation', time: new Date(),
        message: `Route deviation: ${data.deviationKm}km — ${data.convoy_name}`,
      }, ...prev.slice(0, 29)]);
    });
  }, []);

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const activeConvoys = convoys.filter(c => c.status === 'active');

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-gold/20 border-t-gold rounded-full animate-spin mx-auto mb-4" />
        <p className="text-xs font-mono text-slate-500 tracking-widest">INITIALISING COMMAND CENTER…</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-[1900px]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-xl font-bold text-gold tracking-widest">COMMAND CENTER</h1>
            {criticalAlerts.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1 bg-danger/10 border border-danger/30 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                <span className="text-[10px] font-mono font-bold text-danger">{criticalAlerts.length} CRITICAL</span>
              </div>
            )}
          </div>
          <p className="text-slate-500 text-xs font-mono">
            Refreshed {timeAgo(lastRefresh)} · {vehicles.length} vehicles · {activeConvoys.length} active missions
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-navy-900 border border-white/10 rounded-xl text-xs font-mono text-slate-400 hover:text-gold hover:border-gold/30 transition-all">
          <RefreshCw size={12} />REFRESH
        </button>
      </div>

      {/* Critical alert banner */}
      {criticalAlerts.length > 0 && (
        <div className="bg-danger/10 border border-danger/30 rounded-2xl px-5 py-3 flex items-center gap-4">
          <AlertOctagon size={18} className="text-danger flex-shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-sm font-bold text-danger">{criticalAlerts[0].message}</p>
            <p className="text-[10px] font-mono text-danger/70 mt-0.5">{criticalAlerts.length} critical alert{criticalAlerts.length > 1 ? 's' : ''} requiring immediate attention</p>
          </div>
          <a href="/alerts" className="flex items-center gap-1.5 px-3 py-1.5 bg-danger/20 border border-danger/30 rounded-lg text-[10px] font-mono font-bold text-danger hover:bg-danger/30 transition-colors">
            RESPOND <ChevronRight size={10} />
          </a>
        </div>
      )}

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        <MetricCard label="Active Convoys" value={kpis?.activeConvoys ?? '—'} icon={Shield} color="text-gold" sub={`${convoys.length} total missions`} trend={5} />
        <MetricCard label="Active Vehicles" value={kpis?.activeVehicles ?? '—'} icon={Truck} color="text-success" sub={`of ${vehicles.length} registered`} trend={2} />
        <MetricCard label="Open Alerts" value={kpis?.openAlerts ?? '—'} icon={Bell} color={criticalAlerts.length > 0 ? 'text-danger' : 'text-amber-400'} critical={criticalAlerts.length > 0} sub={`${criticalAlerts.length} critical`} />
        <MetricCard label="Fleet Utilisation" value={kpis?.fleetUtilisation != null ? `${kpis.fleetUtilisation}%` : '—'} icon={Gauge} color="text-blue-400" sub="vehicles in active use" />
        <MetricCard label="On-Time Rate" value={kpis?.onTimeRate != null ? `${kpis.onTimeRate}%` : '—'} icon={CheckCircle2} color="text-success" trend={kpis?.onTimeRate >= 80 ? 3 : -5} sub="delivery performance" />
        <MetricCard label="Shipments" value={shipmentStats?.in_transit ?? '—'} icon={Package} color="text-purple-400" sub="in transit now" />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {financeStats?.invoices && (
          <>
            <MetricCard label="Revenue Collected" value={financeStats.invoices.revenue_collected != null ? `$${parseFloat(financeStats.invoices.revenue_collected).toLocaleString()}` : '$0'} icon={DollarSign} color="text-emerald-400" sub="invoices paid" />
            <MetricCard label="Revenue Pending" value={financeStats.invoices.revenue_pending != null ? `$${parseFloat(financeStats.invoices.revenue_pending).toLocaleString()}` : '$0'} icon={TrendingUp} color="text-amber-400" sub="awaiting payment" />
          </>
        )}
        {financeStats?.expenses && (
          <>
            <MetricCard label="Fuel Costs (30d)" value={financeStats.expenses.fuel_costs != null ? `$${parseFloat(financeStats.expenses.fuel_costs).toLocaleString()}` : '$0'} icon={Fuel} color="text-orange-400" sub="last 30 days" />
            <MetricCard label="Maint. Costs (30d)" value={financeStats.expenses.maintenance_costs != null ? `$${parseFloat(financeStats.expenses.maintenance_costs).toLocaleString()}` : '$0'} icon={Wrench} color="text-yellow-400" sub="last 30 days" />
          </>
        )}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Left: Charts */}
        <div className="xl:col-span-2 space-y-5">

          {/* Convoy Activity Chart */}
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-slate-200">Convoy Performance</p>
                <p className="text-[10px] font-mono text-slate-500">Last 14 days · Completed vs On-Time</p>
              </div>
              <BarChart2 size={16} className="text-slate-500" />
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={convoyMetrics} margin={{ top:5, right:5, bottom:5, left:-25 }}>
                <defs>
                  <linearGradient id="cg1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F0B429" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#F0B429" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="cg2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22D3A0" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#22D3A0" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill:'#475569', fontSize:9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill:'#475569', fontSize:9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CHART.content} cursor={CHART.cursor} />
                <Area type="monotone" dataKey="completed" stroke="#F0B429" strokeWidth={2} fill="url(#cg1)" name="Completed" />
                <Area type="monotone" dataKey="onTime" stroke="#22D3A0" strokeWidth={2} fill="url(#cg2)" name="On Time" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Fleet status + Situation board */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Fleet status donut */}
            <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
              <p className="text-sm font-semibold text-slate-200 mb-1">Fleet Status</p>
              <p className="text-[10px] font-mono text-slate-500 mb-4">{vehicles.length} total vehicles</p>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={vehicleStatus} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value">
                    {vehicleStatus.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART.content} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {vehicleStatus.map(s => (
                  <div key={s.name} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-[10px] text-slate-400">{s.name}: <span className="font-bold" style={{ color: s.color }}>{s.value}</span></span>
                  </div>
                ))}
              </div>
            </div>

            {/* Situation board */}
            <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-slate-200">Situation Board</p>
                <Globe size={14} className="text-slate-500" />
              </div>
              <SituationBoard convoys={convoys} vehicles={vehicles} alerts={alerts} />
            </div>
          </div>

          {/* Active Missions */}
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-slate-200">Active Missions</p>
                <p className="text-[10px] font-mono text-slate-500">{activeConvoys.length} convoy{activeConvoys.length !== 1 ? 's' : ''} in operation</p>
              </div>
              <a href="/convoys" className="text-[10px] font-mono text-gold hover:underline flex items-center gap-1">
                VIEW ALL <ChevronRight size={10} />
              </a>
            </div>
            {activeConvoys.length === 0 ? (
              <div className="text-center py-8 text-slate-600">
                <Shield size={24} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">No active missions</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeConvoys.slice(0, 4).map(c => (
                  <ActiveMissionCard key={c.id} convoy={c} onExpand={() => window.location.href = '/convoys'} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Live feed + Alerts + Quick actions */}
        <div className="space-y-5">

          {/* Live event feed */}
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-200">Live Event Feed</p>
                <p className="text-[10px] font-mono text-slate-500">Real-time operational events</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-[9px] font-mono text-success font-bold">LIVE</span>
              </div>
            </div>
            <div className="h-72 overflow-y-auto px-5">
              {feed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-600">
                  <Radio size={24} className="mb-2 opacity-30" />
                  <p className="text-xs">Awaiting events…</p>
                </div>
              ) : feed.map(e => <LiveFeedItem key={e.id} event={e} />)}
            </div>
          </div>

          {/* Recent alerts */}
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-200">Recent Alerts</p>
              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full ${criticalAlerts.length > 0 ? 'bg-danger/20 text-danger' : 'bg-amber-400/20 text-amber-400'}`}>
                {alerts.length} OPEN
              </span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {alerts.slice(0, 5).map(a => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    a.severity === 'critical' ? 'bg-danger animate-pulse' :
                    a.severity === 'high' ? 'bg-orange-400' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 leading-snug truncate">{a.message}</p>
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5">{timeAgo(a.created_at)}</p>
                  </div>
                  <span className={`text-[9px] font-mono font-bold flex-shrink-0 ${
                    a.severity === 'critical' ? 'text-danger' :
                    a.severity === 'high' ? 'text-orange-400' : 'text-amber-400'}`}>
                    {a.severity?.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-white/[0.06]">
              <a href="/alerts" className="text-[10px] font-mono text-gold hover:underline flex items-center gap-1">
                View all alerts <ChevronRight size={10} />
              </a>
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
            <p className="text-sm font-semibold text-slate-200 mb-4">Quick Actions</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'New Convoy', icon: Shield, href: '/convoys', color: 'text-gold border-gold/20 hover:bg-gold/10' },
                { label: 'Add Vehicle', icon: Truck, href: '/fleet', color: 'text-success border-success/20 hover:bg-success/10' },
                { label: 'GPS Track', icon: Navigation, href: '/gps', color: 'text-blue-400 border-blue-400/20 hover:bg-blue-400/10' },
                { label: 'New Shipment', icon: Package, href: '/shipments', color: 'text-purple-400 border-purple-400/20 hover:bg-purple-400/10' },
                { label: 'Maintenance', icon: Wrench, href: '/maintenance', color: 'text-amber-400 border-amber-400/20 hover:bg-amber-400/10' },
                { label: 'Reports', icon: BarChart2, href: '/reports', color: 'text-slate-400 border-white/10 hover:bg-white/5' },
              ].map(({ label, icon: Icon, href, color }) => (
                <a key={label} href={href}
                  className={`flex items-center gap-2.5 px-3 py-2.5 border rounded-xl text-xs font-mono font-bold transition-all ${color}`}>
                  <Icon size={13} />{label}
                </a>
              ))}
            </div>
          </div>

          {/* System health */}
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
            <p className="text-sm font-semibold text-slate-200 mb-4">System Health</p>
            <div className="space-y-3">
              {[
                ['API Gateway', true, '12ms'],
                ['Socket.IO', true, 'Connected'],
                ['Database', true, '4ms'],
                ['GPS Worker', true, 'Active'],
                ['Alert Engine', true, 'Active'],
                ['Queue (Redis)', false, 'Disabled'],
              ].map(([name, ok, detail]) => (
                <div key={name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-success' : 'bg-slate-600'}`} />
                    <span className="text-xs text-slate-400">{name}</span>
                  </div>
                  <span className={`text-[10px] font-mono ${ok ? 'text-slate-500' : 'text-slate-600'}`}>{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
