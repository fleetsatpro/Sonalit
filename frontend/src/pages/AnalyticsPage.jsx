import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  TrendingUp, FileText, Download, RefreshCw, Clock,
  Shield, Truck, Bell, CheckCircle2, AlertTriangle,
  BarChart3, Calendar, Printer, Zap,
} from 'lucide-react';
import { analyticsAPI, vehiclesAPI, convoysAPI, alertsAPI } from '../services/api';
import { Card, Badge, Spinner, Skeleton, Button } from '../components/UI';

const CHART_STYLE = {
  contentStyle: {
    background: '#0A0F1A', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8, fontSize: 11, color: '#e2e8f0', padding: '8px 12px',
  },
  cursor: { fill: 'rgba(240,180,41,0.03)' },
};

const COLORS = ['#F0B429', '#22D3A0', '#3B82F6', '#F25252', '#A78BFA'];

// ── Auto Report Engine ─────────────────────────────────────────
const REPORT_KEY = 'fleetops_auto_report';
const REPORT_INTERVAL = 24 * 60 * 60 * 1000; // 24h

async function generateReport(kpis, convoyMetrics, fleetUtil, alerts) {
  const now = new Date();
  const totalConvoys = convoyMetrics.reduce((a, d) => a + (d.Completed || 0), 0);
  const totalDelayed = convoyMetrics.reduce((a, d) => a + (d.Delayed || 0), 0);
  const totalAlerts = alerts?.length || 0;
  const criticalAlerts = alerts?.filter(a => a.severity === 'critical').length || 0;

  const report = {
    generated_at: now.toISOString(),
    period: 'Last 14 Days',
    summary: {
      fleet_utilisation: kpis?.fleetUtilisation || 0,
      active_vehicles: kpis?.activeVehicles || 0,
      total_vehicles: kpis?.totalVehicles || 0,
      active_convoys: kpis?.activeConvoys || 0,
      on_time_rate: kpis?.onTimeRate || 0,
      open_alerts: kpis?.openAlerts || 0,
      total_completed_convoys: totalConvoys,
      total_delayed_convoys: totalDelayed,
      total_alerts: totalAlerts,
      critical_alerts: criticalAlerts,
    },
    fleet_by_region: fleetUtil,
    convoy_trend: convoyMetrics,
    health_score: Math.round(
      ((kpis?.onTimeRate || 0) * 0.4) +
      ((kpis?.fleetUtilisation || 0) * 0.3) +
      (Math.max(0, 100 - (criticalAlerts * 10)) * 0.3)
    ),
    status: criticalAlerts > 0 ? 'critical' : totalDelayed > totalConvoys * 0.3 ? 'warning' : 'nominal',
  };

  localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  localStorage.setItem(REPORT_KEY + '_ts', now.getTime().toString());
  return report;
}

function loadCachedReport() {
  try {
    const ts = parseInt(localStorage.getItem(REPORT_KEY + '_ts') || '0');
    const data = localStorage.getItem(REPORT_KEY);
    if (data && Date.now() - ts < REPORT_INTERVAL) {
      return { report: JSON.parse(data), fresh: false };
    }
  } catch {}
  return null;
}

// ── Health Score Ring ──────────────────────────────────────────
function HealthRing({ score, status }) {
  const color = status === 'critical' ? '#F25252' : status === 'warning' ? '#F59E0B' : '#22D3A0';
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold" style={{ color }}>{score}</span>
          <span className="text-[10px] font-mono text-slate-500">/ 100</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">{status}</span>
      </div>
    </div>
  );
}

// ── Report Card ────────────────────────────────────────────────
function ReportCard({ report, onExportCSV, onPrint }) {
  const s = report.summary;
  const age = Math.round((Date.now() - new Date(report.generated_at).getTime()) / 60000);
  const ageText = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.round(age/60)}h ago`;

  return (
    <Card className="overflow-visible">
      {/* Report header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center">
            <FileText size={16} className="text-gold" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 font-display tracking-wide">AUTO-GENERATED REPORT</h3>
            <p className="text-[10px] font-mono text-slate-500">{report.period} · Generated {ageText}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-800 border border-white/5 rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 hover:border-white/10 transition-all">
            <Download size={12} /> CSV
          </button>
          <button onClick={onPrint}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-800 border border-white/5 rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 hover:border-white/10 transition-all">
            <Printer size={12} /> PRINT
          </button>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Health score */}
        <div className="flex flex-col items-center justify-center py-4">
          <p className="text-[10px] font-mono text-slate-600 tracking-wider mb-4">OPERATIONAL HEALTH</p>
          <HealthRing score={report.health_score} status={report.status} />
        </div>

        {/* Key metrics */}
        <div className="space-y-3">
          <p className="text-[10px] font-mono text-slate-600 tracking-wider">KEY METRICS</p>
          {[
            { label: 'Fleet Utilisation',     value: `${s.fleet_utilisation}%`,            color: 'text-success'   },
            { label: 'On-Time Rate',          value: `${s.on_time_rate}%`,                 color: 'text-blue-400'  },
            { label: 'Active Vehicles',       value: `${s.active_vehicles}/${s.total_vehicles}`, color: 'text-gold' },
            { label: 'Completed Convoys',     value: s.total_completed_convoys,            color: 'text-success'   },
            { label: 'Delayed Convoys',       value: s.total_delayed_convoys,              color: s.total_delayed_convoys > 0 ? 'text-amber-400' : 'text-slate-400' },
            { label: 'Critical Alerts',       value: s.critical_alerts,                   color: s.critical_alerts > 0 ? 'text-danger' : 'text-slate-400' },
          ].map(m => (
            <div key={m.label} className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
              <span className="text-xs text-slate-500 font-mono">{m.label}</span>
              <span className={`text-sm font-bold font-mono ${m.color}`}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Recommendations */}
        <div className="space-y-3">
          <p className="text-[10px] font-mono text-slate-600 tracking-wider">RECOMMENDATIONS</p>
          <div className="space-y-2">
            {s.fleet_utilisation < 60 && (
              <div className="flex items-start gap-2 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-amber-300/80 leading-snug">Fleet utilisation is below 60%. Consider redeploying idle vehicles.</p>
              </div>
            )}
            {s.critical_alerts > 0 && (
              <div className="flex items-start gap-2 p-2.5 bg-danger/5 border border-danger/20 rounded-lg">
                <AlertTriangle size={12} className="text-danger mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-danger/80 leading-snug">{s.critical_alerts} critical alert(s) require immediate attention.</p>
              </div>
            )}
            {s.on_time_rate < 70 && (
              <div className="flex items-start gap-2 p-2.5 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <Clock size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-blue-300/80 leading-snug">On-time rate below 70%. Review route planning and scheduling.</p>
              </div>
            )}
            {s.fleet_utilisation >= 60 && s.critical_alerts === 0 && s.on_time_rate >= 70 && (
              <div className="flex items-start gap-2 p-2.5 bg-success/5 border border-success/20 rounded-lg">
                <CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-success/80 leading-snug">Operations are running optimally. Maintain current performance.</p>
              </div>
            )}
            <div className="flex items-start gap-2 p-2.5 bg-navy-800/60 border border-white/5 rounded-lg">
              <Zap size={12} className="text-gold mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-slate-400 leading-snug">Next auto-report generates in 24 hours automatically.</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Main Analytics Page ────────────────────────────────────────
export default function AnalyticsPage() {
  const [kpis, setKpis] = useState(null);
  const [convoyMetrics, setConvoyMetrics] = useState([]);
  const [fleetUtil, setFleetUtil] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState(null);

  const loadData = async () => {
    try {
      const [dash, metrics, util, alertsRes] = await Promise.all([
        analyticsAPI.dashboard(),
        analyticsAPI.convoyMetrics(),
        analyticsAPI.fleetUtilization(),
        alertsAPI.list({ limit: 100 }),
      ]);
      const kpisData = dash.data.data;
      const metricsData = metrics.data.data.slice(-14).map(d => ({
        day: new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        Completed: parseInt(d.completed) || 0,
        'On Time': parseInt(d.on_time) || 0,
        Delayed: parseInt(d.delayed) || 0,
      }));
      const utilData = util.data.data.map(r => ({
        region: r.region,
        Active: parseInt(r.active) || 0,
        Idle: parseInt(r.idle) || 0,
        Maintenance: parseInt(r.maintenance) || 0,
      }));
      const alertsData = alertsRes.data.data || [];

      setKpis(kpisData);
      setConvoyMetrics(metricsData);
      setFleetUtil(utilData);
      setAlerts(alertsData);

      // Check if auto-report needed
      const cached = loadCachedReport();
      if (cached) {
        setReport(cached.report);
        setLastGenerated(new Date(cached.report.generated_at));
      } else {
        // Auto-generate
        const r = await generateReport(kpisData, metricsData, utilData, alertsData);
        setReport(r);
        setLastGenerated(new Date(r.generated_at));
      }
    } catch (e) {
      console.error('Analytics load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNow = async () => {
    setGenerating(true);
    localStorage.removeItem(REPORT_KEY);
    localStorage.removeItem(REPORT_KEY + '_ts');
    const r = await generateReport(kpis, convoyMetrics, fleetUtil, alerts);
    setReport(r);
    setLastGenerated(new Date(r.generated_at));
    setGenerating(false);
  };

  const handleExportCSV = () => {
    if (!report) return;
    const s = report.summary;
    const rows = [
      ['Metric', 'Value'],
      ['Report Period', report.period],
      ['Generated At', report.generated_at],
      ['Health Score', report.health_score],
      ['Fleet Utilisation', `${s.fleet_utilisation}%`],
      ['On-Time Rate', `${s.on_time_rate}%`],
      ['Active Vehicles', s.active_vehicles],
      ['Total Vehicles', s.total_vehicles],
      ['Active Convoys', s.active_convoys],
      ['Completed Convoys', s.total_completed_convoys],
      ['Delayed Convoys', s.total_delayed_convoys],
      ['Open Alerts', s.open_alerts],
      ['Critical Alerts', s.critical_alerts],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleetops-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  useEffect(() => { loadData(); }, []);

  // Pie chart data
  const statusPie = [
    { name: 'Active',      value: kpis?.activeVehicles || 0 },
    { name: 'Idle',        value: (kpis?.totalVehicles || 0) - (kpis?.activeVehicles || 0) - 2 },
    { name: 'Maintenance', value: 2 },
  ].filter(d => d.value > 0);

  const alertsPie = [
    { name: 'Critical', value: alerts.filter(a => a.severity === 'critical').length },
    { name: 'High',     value: alerts.filter(a => a.severity === 'high').length },
    { name: 'Medium',   value: alerts.filter(a => a.severity === 'medium').length },
    { name: 'Low',      value: alerts.filter(a => a.severity === 'low').length },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Analytics & Reports</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">
            Auto-reports every 24h · Last: {lastGenerated ? lastGenerated.toLocaleString() : '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleGenerateNow} disabled={generating}
            className={`flex items-center gap-2 px-3 py-2 bg-gold/10 border border-gold/20 rounded-lg text-xs font-mono text-gold hover:bg-gold/15 transition-all ${generating ? 'opacity-50 pointer-events-none' : ''}`}>
            <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
            {generating ? 'GENERATING…' : 'GENERATE NOW'}
          </button>
        </div>
      </div>

      {/* Auto Report */}
      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="text-slate-500 text-xs font-mono mt-3">COMPILING REPORT…</p>
          </div>
        </div>
      ) : report ? (
        <ReportCard report={report} onExportCSV={handleExportCSV} onPrint={handlePrint} />
      ) : null}

      {/* Charts grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* Convoy trend */}
        <Card header="Convoy Performance Trend" action={<span className="text-[10px] font-mono text-slate-600">14 DAYS</span>}>
          <div className="px-4 pb-4 pt-2">
            {loading ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={convoyMetrics} margin={{ left: -20 }}>
                  <defs>
                    <linearGradient id="aC" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F0B429" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F0B429" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip {...CHART_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
                  <Area type="monotone" dataKey="Completed" stroke="#F0B429" fill="url(#aC)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="On Time"   stroke="#22D3A0" fill="none" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Delayed"   stroke="#F25252" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Fleet by region */}
        <Card header="Fleet Distribution by Region">
          <div className="px-4 pb-4 pt-2">
            {loading ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={fleetUtil} barSize={12} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis dataKey="region" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip {...CHART_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
                  <Bar dataKey="Active"      fill="#22D3A0" radius={[3,3,0,0]} />
                  <Bar dataKey="Idle"        fill="#1e293b" radius={[3,3,0,0]} />
                  <Bar dataKey="Maintenance" fill="#D97706" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Vehicle status pie */}
        <Card header="Vehicle Status Breakdown">
          <div className="px-4 pb-4 pt-2 flex items-center gap-6">
            {loading ? <Skeleton className="h-48 w-full" /> : (
              <>
                <ResponsiveContainer width="60%" height={200}>
                  <PieChart>
                    <Pie data={statusPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                      paddingAngle={3} dataKey="value">
                      {statusPie.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Tooltip {...CHART_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2.5 flex-1">
                  {statusPie.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                        <span className="text-xs text-slate-400 font-mono">{d.name}</span>
                      </div>
                      <span className="text-sm font-bold font-mono text-slate-200">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Alerts pie */}
        <Card header="Alert Severity Distribution">
          <div className="px-4 pb-4 pt-2 flex items-center gap-6">
            {loading ? <Skeleton className="h-48 w-full" /> : alertsPie.length ? (
              <>
                <ResponsiveContainer width="60%" height={200}>
                  <PieChart>
                    <Pie data={alertsPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                      paddingAngle={3} dataKey="value">
                      {alertsPie.map((_, i) => <Cell key={i} fill={['#F25252','#F59E0B','#3B82F6','#22D3A0'][i]} />)}
                    </Pie>
                    <Tooltip {...CHART_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2.5 flex-1">
                  {alertsPie.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: ['#F25252','#F59E0B','#3B82F6','#22D3A0'][i] }} />
                        <span className="text-xs text-slate-400 font-mono">{d.name}</span>
                      </div>
                      <span className="text-sm font-bold font-mono text-slate-200">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="w-full py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto mb-2 text-success/40" />
                <p className="text-xs text-slate-600 font-mono">NO ALERTS</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
