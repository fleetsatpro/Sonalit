import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { analyticsAPI } from '../services/api';
import { Card, KPICard, Spinner } from '../components/UI';
import { BarChart3, Truck, Shield, AlertTriangle } from 'lucide-react';
import { useInterval } from '../hooks';

const TT = { contentStyle: { background: '#0D1321', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }, cursor: { fill: 'rgba(240,180,41,0.04)' } };
const PIE_COLORS = ['#22D3A0', '#F0B429', '#F25252', '#60a5fa', '#a78bfa'];

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [util, setUtil] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [d, m, u, h] = await Promise.all([
        analyticsAPI.dashboard(),
        analyticsAPI.convoyMetrics(),
        analyticsAPI.fleetUtilization(),
        analyticsAPI.incidentHeatmap(),
      ]);
      setKpis(d.data.data);
      setMetrics(m.data.data.map((r) => ({
        day: new Date(r.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        Completed: parseInt(r.completed) || 0,
        'On Time': parseInt(r.on_time) || 0,
        Delayed: parseInt(r.delayed) || 0,
        Aborted: parseInt(r.aborted) || 0,
      })));
      setUtil(u.data.data);
      setHeatmap(h.data.data);
    } catch (e) {
      console.error('Analytics load error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useInterval(load, 60000);

  const utilPie = util.flatMap((r) => [
    { name: `${r.region} Active`, value: parseInt(r.active) || 0 },
    { name: `${r.region} Idle`, value: parseInt(r.idle) || 0 },
  ]).filter((d) => d.value > 0);

  if (loading) return <div className="flex justify-center pt-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-bold text-gold tracking-widest">ANALYTICS</h1>
        <p className="text-slate-500 text-sm font-mono mt-0.5">Operational intelligence — live from database</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Active Convoys" value={kpis?.activeConvoys} icon={Shield} color="text-gold" />
        <KPICard label="Fleet Utilisation" value={kpis ? `${kpis.fleetUtilisation}%` : '—'} icon={Truck} color="text-success" />
        <KPICard label="Open Alerts" value={kpis?.openAlerts} icon={AlertTriangle} color={kpis?.openAlerts > 0 ? 'text-danger' : 'text-slate-400'} />
        <KPICard label="On-Time Rate" value={kpis ? `${kpis.onTimeRate}%` : '—'} icon={BarChart3} color="text-blue-400" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 30-day convoy line chart */}
        <Card header="Convoy Activity — Last 30 Days">
          <div className="px-4 pb-4 pt-2">
            {metrics.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TT} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                  <Line type="monotone" dataKey="Completed" stroke="#F0B429" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="On Time" stroke="#22D3A0" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Delayed" stroke="#F25252" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="h-56 flex items-center justify-center text-slate-600 text-sm">No data</div>}
          </div>
        </Card>

        {/* Fleet utilisation bar */}
        <Card header="Fleet by Region">
          <div className="px-4 pb-4 pt-2">
            {util.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={util} barSize={16} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="region" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TT} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                  <Bar dataKey="active" name="Active" fill="#22D3A0" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="idle" name="Idle" fill="#334155" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="maintenance" name="Maintenance" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-56 flex items-center justify-center text-slate-600 text-sm">No data</div>}
          </div>
        </Card>

        {/* Fleet distribution pie */}
        <Card header="Fleet Distribution">
          <div className="px-4 pb-4 pt-2 flex items-center gap-6">
            {utilPie.length ? (
              <>
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie data={utilPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                      {utilPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip {...TT} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {utilPie.slice(0, 8).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-slate-400 flex-1 truncate">{item.name}</span>
                      <span className="font-mono text-slate-200">{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <div className="h-48 w-full flex items-center justify-center text-slate-600 text-sm">No data</div>}
          </div>
        </Card>

        {/* Incident heatmap table */}
        <Card header="Incident Density — Last 90 Days">
          <div className="px-4 pb-4">
            {heatmap.length ? (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/5 text-slate-500 text-xs font-mono uppercase">
                  {['Region', 'Total', 'Critical', 'High', 'Medium'].map((h) => (
                    <th key={h} className={`py-3 ${h === 'Region' ? 'text-left pr-4' : 'text-right'}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-white/5">
                  {heatmap.map((r) => (
                    <tr key={r.region} className="hover:bg-white/2 transition-colors">
                      <td className="py-3 pr-4 text-slate-200 font-medium">{r.region}</td>
                      <td className="py-3 text-right font-mono text-gold font-bold">{r.incident_count}</td>
                      <td className="py-3 text-right font-mono text-red-400">{r.critical || 0}</td>
                      <td className="py-3 text-right font-mono text-amber-400">{r.high || 0}</td>
                      <td className="py-3 text-right font-mono text-blue-400">{r.medium || 0}</td>
                    </tr>
                  ))}
                  {heatmap.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-600 text-sm">No incidents in last 90 days</td></tr>
                  )}
                </tbody>
              </table>
            ) : <div className="py-10 text-center text-slate-600 text-sm">No incident data</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
