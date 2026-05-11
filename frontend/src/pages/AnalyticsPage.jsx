import { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { FileText, Download, RefreshCw, Clock, AlertTriangle, CheckCircle2, Zap, Printer } from 'lucide-react';
import { analyticsAPI, alertsAPI } from '../services/api';
import { Card, Spinner, Skeleton } from '../components/UI';

const CHART_STYLE = { contentStyle: { background: '#0A0F1A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 11, color: '#e2e8f0', padding: '8px 12px' }, cursor: { fill: 'rgba(240,180,41,0.03)' } };
const COLORS = ['#F0B429','#22D3A0','#3B82F6','#F25252','#A78BFA'];
const REPORT_KEY = 'fleetops_report';

function HealthRing({ score, status }) {
  const color = status === 'critical' ? '#F25252' : status === 'warning' ? '#F59E0B' : '#22D3A0';
  const r = 54; const circ = 2 * Math.PI * r; const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold" style={{ color }}>{score}</span>
          <span className="text-[10px] font-mono text-slate-500">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">{status}</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState(null);
  const [convoyMetrics, setConvoyMetrics] = useState([]);
  const [fleetUtil, setFleetUtil] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const buildReport = (k, m, u, a) => {
    const critical = a.filter(x => x.severity === 'critical').length;
    const delayed = m.reduce((s, d) => s + (d.Delayed || 0), 0);
    const completed = m.reduce((s, d) => s + (d.Completed || 0), 0);
    const score = Math.round(((k?.onTimeRate||0)*0.4)+((k?.fleetUtilisation||0)*0.3)+(Math.max(0,100-(critical*10))*0.3));
    const status = critical > 0 ? 'critical' : delayed > completed * 0.3 ? 'warning' : 'nominal';
    const r = { generated_at: new Date().toISOString(), period: 'Last 14 Days', health_score: score, status, summary: { fleet_utilisation: k?.fleetUtilisation||0, on_time_rate: k?.onTimeRate||0, active_vehicles: k?.activeVehicles||0, total_vehicles: k?.totalVehicles||0, active_convoys: k?.activeConvoys||0, completed_convoys: completed, delayed_convoys: delayed, open_alerts: k?.openAlerts||0, critical_alerts: critical } };
    localStorage.setItem(REPORT_KEY, JSON.stringify(r));
    localStorage.setItem(REPORT_KEY+'_ts', Date.now().toString());
    return r;
  };

  const loadData = async (force = false) => {
    try {
      const [dash, metrics, util, alertsRes] = await Promise.all([analyticsAPI.dashboard(), analyticsAPI.convoyMetrics(), analyticsAPI.fleetUtilization(), alertsAPI.list({ limit: 100 })]);
      const k = dash.data.data;
      const m = metrics.data.data.slice(-14).map(d => ({ day: new Date(d.day).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}), Completed: parseInt(d.completed)||0, 'On Time': parseInt(d.on_time)||0, Delayed: parseInt(d.delayed)||0 }));
      const u = util.data.data.map(r => ({ region: r.region, Active: parseInt(r.active)||0, Idle: parseInt(r.idle)||0, Maintenance: parseInt(r.maintenance)||0 }));
      const a = alertsRes.data.data || [];
      setKpis(k); setConvoyMetrics(m); setFleetUtil(u); setAlerts(a);
      const cached = localStorage.getItem(REPORT_KEY);
      const ts = parseInt(localStorage.getItem(REPORT_KEY+'_ts')||'0');
      if (!force && cached && Date.now()-ts < 86400000) { setReport(JSON.parse(cached)); }
      else { setReport(buildReport(k, m, u, a)); }
    } catch(e) { console.error(e); } finally { setLoading(false); setGenerating(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleGenerate = () => { setGenerating(true); localStorage.removeItem(REPORT_KEY); loadData(true); };

  const handleCSV = () => {
    if (!report) return;
    const s = report.summary;
    const rows = [['Metric','Value'],['Period',report.period],['Generated',report.generated_at],['Health Score',report.health_score],['Fleet Utilisation',s.fleet_utilisation+'%'],['On-Time Rate',s.on_time_rate+'%'],['Active Vehicles',s.active_vehicles+'/'+s.total_vehicles],['Completed Convoys',s.completed_convoys],['Delayed Convoys',s.delayed_convoys],['Critical Alerts',s.critical_alerts]];
    const blob = new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fleetops-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  const statusPie = [{ name:'Active', value: kpis?.activeVehicles||0 },{ name:'Idle', value: Math.max(0,(kpis?.totalVehicles||0)-(kpis?.activeVehicles||0)-2) },{ name:'Maintenance', value: 2 }].filter(d=>d.value>0);
  const alertsPie = ['critical','high','medium','low'].map(s=>({ name:s.charAt(0).toUpperCase()+s.slice(1), value: alerts.filter(a=>a.severity===s).length })).filter(d=>d.value>0);
  const alertColors = ['#F25252','#F59E0B','#3B82F6','#22D3A0'];

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Analytics & Reports</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">Auto-generated every 24h · {report ? new Date(report.generated_at).toLocaleString() : '—'}</p>
        </div>
        <button onClick={handleGenerate} disabled={generating} className={`flex items-center gap-2 px-3 py-2 bg-gold/10 border border-gold/20 rounded-lg text-xs font-mono text-gold hover:bg-gold/15 transition-all ${generating?'opacity-50 pointer-events-none':''}`}>
          <RefreshCw size={12} className={generating?'animate-spin':''} />{generating?'GENERATING…':'GENERATE NOW'}
        </button>
      </div>

      {report && (
        <div className="bg-navy-900 border border-white/5 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center"><FileText size={16} className="text-gold" /></div>
              <div><h3 className="text-sm font-bold text-slate-100 font-display tracking-wide">AUTO-GENERATED REPORT</h3><p className="text-[10px] font-mono text-slate-500">{report.period}</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-800 border border-white/5 rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 transition-all"><Download size={12} />CSV</button>
              <button onClick={()=>window.print()} className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-800 border border-white/5 rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 transition-all"><Printer size={12} />PRINT</button>
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="flex flex-col items-center justify-center py-4">
              <p className="text-[10px] font-mono text-slate-600 tracking-wider mb-4">OPERATIONAL HEALTH</p>
              <HealthRing score={report.health_score} status={report.status} />
            </div>
            <div className="space-y-3">
              <p className="text-[10px] font-mono text-slate-600 tracking-wider">KEY METRICS</p>
              {[['Fleet Utilisation',`${report.summary.fleet_utilisation}%`,'text-success'],['On-Time Rate',`${report.summary.on_time_rate}%`,'text-blue-400'],['Active Vehicles',`${report.summary.active_vehicles}/${report.summary.total_vehicles}`,'text-gold'],['Completed Convoys',report.summary.completed_convoys,'text-success'],['Delayed Convoys',report.summary.delayed_convoys,report.summary.delayed_convoys>0?'text-amber-400':'text-slate-400'],['Critical Alerts',report.summary.critical_alerts,report.summary.critical_alerts>0?'text-danger':'text-slate-400']].map(([l,v,c])=>(
                <div key={l} className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                  <span className="text-xs text-slate-500 font-mono">{l}</span>
                  <span className={`text-sm font-bold font-mono ${c}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-slate-600 tracking-wider">RECOMMENDATIONS</p>
              {report.summary.fleet_utilisation < 60 && <div className="flex items-start gap-2 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg"><AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" /><p className="text-[11px] text-amber-300/80">Fleet below 60% — redeploy idle vehicles.</p></div>}
              {report.summary.critical_alerts > 0 && <div className="flex items-start gap-2 p-2.5 bg-danger/5 border border-danger/20 rounded-lg"><AlertTriangle size={12} className="text-danger mt-0.5 flex-shrink-0" /><p className="text-[11px] text-danger/80">{report.summary.critical_alerts} critical alert(s) need immediate attention.</p></div>}
              {report.summary.on_time_rate < 70 && <div className="flex items-start gap-2 p-2.5 bg-blue-500/5 border border-blue-500/20 rounded-lg"><Clock size={12} className="text-blue-400 mt-0.5 flex-shrink-0" /><p className="text-[11px] text-blue-300/80">On-time rate low — review route planning.</p></div>}
              {report.summary.fleet_utilisation>=60 && report.summary.critical_alerts===0 && report.summary.on_time_rate>=70 && <div className="flex items-start gap-2 p-2.5 bg-success/5 border border-success/20 rounded-lg"><CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" /><p className="text-[11px] text-success/80">Operations running optimally.</p></div>}
              <div className="flex items-start gap-2 p-2.5 bg-navy-800/60 border border-white/5 rounded-lg"><Zap size={12} className="text-gold mt-0.5 flex-shrink-0" /><p className="text-[11px] text-slate-400">Next auto-report in 24 hours.</p></div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-navy-900 border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5"><h3 className="font-semibold text-slate-200 text-sm">Convoy Performance</h3><span className="text-[10px] font-mono text-slate-600">14 DAYS</span></div>
          <div className="px-4 pb-4 pt-2">{loading?<Skeleton className="h-52"/>:<ResponsiveContainer width="100%" height={220}><AreaChart data={convoyMetrics} margin={{left:-20}}><defs><linearGradient id="aC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F0B429" stopOpacity={0.25}/><stop offset="95%" stopColor="#F0B429" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)"/><XAxis dataKey="day" tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip {...CHART_STYLE}/><Legend wrapperStyle={{fontSize:11,color:'#64748b'}}/><Area type="monotone" dataKey="Completed" stroke="#F0B429" fill="url(#aC)" strokeWidth={2} dot={false}/><Area type="monotone" dataKey="On Time" stroke="#22D3A0" fill="none" strokeWidth={2} dot={false}/><Area type="monotone" dataKey="Delayed" stroke="#F25252" fill="none" strokeWidth={1.5} strokeDasharray="4 4" dot={false}/></AreaChart></ResponsiveContainer>}</div>
        </div>
        <div className="bg-navy-900 border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5"><h3 className="font-semibold text-slate-200 text-sm">Fleet by Region</h3></div>
          <div className="px-4 pb-4 pt-2">{loading?<Skeleton className="h-52"/>:<ResponsiveContainer width="100%" height={220}><BarChart data={fleetUtil} barSize={12} margin={{left:-20}}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false}/><XAxis dataKey="region" tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip {...CHART_STYLE}/><Legend wrapperStyle={{fontSize:11,color:'#64748b'}}/><Bar dataKey="Active" fill="#22D3A0" radius={[3,3,0,0]}/><Bar dataKey="Idle" fill="#1e293b" radius={[3,3,0,0]}/><Bar dataKey="Maintenance" fill="#D97706" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>}</div>
        </div>
        <div className="bg-navy-900 border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5"><h3 className="font-semibold text-slate-200 text-sm">Vehicle Status</h3></div>
          <div className="px-4 pb-4 pt-2 flex items-center gap-6">{loading?<Skeleton className="h-48 w-full"/>:<><ResponsiveContainer width="60%" height={200}><PieChart><Pie data={statusPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">{statusPie.map((_,i)=><Cell key={i} fill={COLORS[i]}/>)}</Pie><Tooltip {...CHART_STYLE}/></PieChart></ResponsiveContainer><div className="space-y-2.5 flex-1">{statusPie.map((d,i)=><div key={d.name} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{background:COLORS[i]}}/><span className="text-xs text-slate-400 font-mono">{d.name}</span></div><span className="text-sm font-bold font-mono text-slate-200">{d.value}</span></div>)}</div></>}</div>
        </div>
        <div className="bg-navy-900 border border-white/5 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5"><h3 className="font-semibold text-slate-200 text-sm">Alert Severity</h3></div>
          <div className="px-4 pb-4 pt-2 flex items-center gap-6">{loading?<Skeleton className="h-48 w-full"/>:alertsPie.length?<><ResponsiveContainer width="60%" height={200}><PieChart><Pie data={alertsPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">{alertsPie.map((_,i)=><Cell key={i} fill={alertColors[i]}/>)}</Pie><Tooltip {...CHART_STYLE}/></PieChart></ResponsiveContainer><div className="space-y-2.5 flex-1">{alertsPie.map((d,i)=><div key={d.name} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{background:alertColors[i]}}/><span className="text-xs text-slate-400 font-mono">{d.name}</span></div><span className="text-sm font-bold font-mono text-slate-200">{d.value}</span></div>)}</div></>:<div className="w-full py-8 text-center"><CheckCircle2 size={24} className="mx-auto mb-2 text-success/40"/><p className="text-xs text-slate-600 font-mono">NO ALERTS</p></div>}</div>
        </div>
      </div>
    </div>
  );
}
