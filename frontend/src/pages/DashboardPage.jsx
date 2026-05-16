import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Truck, Shield, Bell, TrendingUp, Activity, AlertTriangle,
  MapPin, Clock, CheckCircle2, ArrowUpRight,
  Navigation, Radio, Target, RefreshCw, X, Plus,
} from 'lucide-react';
import { analyticsAPI, vehiclesAPI, convoysAPI, alertsAPI } from '../services/api';
import { useAlertStore } from '../store';
import socketService from '../services/socket';
import { KPICard, Card, Badge, Spinner, SkeletonCard, Skeleton, EmptyState, Modal, Button, Input, Select } from '../components/UI';
import { timeAgo, truncate } from '../utils/helpers';
import { useInterval } from '../hooks';

const CHART_STYLE = {
  contentStyle: {
    background: '#0A0F1A',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8, fontSize: 11, color: '#e2e8f0', padding: '8px 12px',
  },
  cursor: { fill: 'rgba(240,180,41,0.03)' },
};

const FEED_CONFIG = {
  gps:    { color: 'text-success', bg: 'bg-success/10', icon: Navigation },
  alert:  { color: 'text-danger',  bg: 'bg-danger/10',  icon: AlertTriangle },
  convoy: { color: 'text-gold',    bg: 'bg-gold/10',    icon: Shield },
};

// ── New Convoy Modal ───────────────────────────────────────────
function NewConvoyModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: '', origin: '', destination: '', scheduled_start: '', risk_level: 'low' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.origin || !form.destination) { setError('Name, origin and destination are required'); return; }
    setLoading(true); setError('');
    try {
      await convoysAPI.create(form);
      onSuccess('Convoy created successfully');
      onClose();
      setForm({ name: '', origin: '', destination: '', scheduled_start: '', risk_level: 'low' });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create convoy');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Convoy Mission"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Create Convoy</Button></>}>
      {error && <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">{error}</div>}
      <div className="space-y-4">
        <Input label="Convoy Name" placeholder="e.g. CONVOY-DELTA" value={form.name} onChange={e => set('name', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Origin" placeholder="e.g. Nairobi" value={form.origin} onChange={e => set('origin', e.target.value)} />
          <Input label="Destination" placeholder="e.g. Mombasa" value={form.destination} onChange={e => set('destination', e.target.value)} />
        </div>
        <Input label="Scheduled Start" type="datetime-local" value={form.scheduled_start} onChange={e => set('scheduled_start', e.target.value)} />
        <Select label="Risk Level" value={form.risk_level} onChange={e => set('risk_level', e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </Select>
      </div>
    </Modal>
  );
}

// ── Add Vehicle Modal ──────────────────────────────────────────
function AddVehicleModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({ registration: '', type: 'truck', make: '', model: '', year: '', region: 'Kenya' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.registration) { setError('Registration is required'); return; }
    setLoading(true); setError('');
    try {
      await vehiclesAPI.create(form);
      onSuccess('Vehicle added successfully');
      onClose();
      setForm({ registration: '', type: 'truck', make: '', model: '', year: '', region: 'Kenya' });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to add vehicle');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Vehicle"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Add Vehicle</Button></>}>
      {error && <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">{error}</div>}
      <div className="space-y-4">
        <Input label="Registration Plate" placeholder="e.g. KEN-001" value={form.registration} onChange={e => set('registration', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="truck">Truck</option>
            <option value="van">Van</option>
            <option value="suv">SUV</option>
            <option value="motorcycle">Motorcycle</option>
            <option value="armored">Armored</option>
          </Select>
          <Select label="Region" value={form.region} onChange={e => set('region', e.target.value)}>
            <option>Kenya</option>
            <option>Tanzania</option>
            <option>DRC</option>
            <option>Mali</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Make" placeholder="e.g. Toyota" value={form.make} onChange={e => set('make', e.target.value)} />
          <Input label="Model" placeholder="e.g. Land Cruiser" value={form.model} onChange={e => set('model', e.target.value)} />
        </div>
        <Input label="Year" placeholder="e.g. 2022" type="number" value={form.year} onChange={e => set('year', e.target.value)} />
      </div>
    </Modal>
  );
}

// ── Log Alert Modal ────────────────────────────────────────────
function LogAlertModal({ open, onClose, onSuccess }) {
  const [form, setForm] = useState({ type: 'security', severity: 'medium', message: '', location: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.message) { setError('Message is required'); return; }
    setLoading(true); setError('');
    try {
      await alertsAPI.create(form);
      onSuccess('Alert logged successfully');
      onClose();
      setForm({ type: 'security', severity: 'medium', message: '', location: '' });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to log alert');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Alert / Incident"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={submit}>Log Alert</Button></>}>
      {error && <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">{error}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="security">Security</option>
            <option value="mechanical">Mechanical</option>
            <option value="route_deviation">Route Deviation</option>
            <option value="accident">Accident</option>
            <option value="checkpoint">Checkpoint</option>
            <option value="other">Other</option>
          </Select>
          <Select label="Severity" value={form.severity} onChange={e => set('severity', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>
        <Input label="Location" placeholder="e.g. Nairobi Highway KM 45" value={form.location} onChange={e => set('location', e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Message</label>
          <textarea
            rows={3}
            placeholder="Describe the incident..."
            value={form.message}
            onChange={e => set('message', e.target.value)}
            className="bg-navy-800 border border-white/10 focus:border-gold/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Dispatch Modal ─────────────────────────────────────────────
function DispatchModal({ open, onClose, onSuccess }) {
  const [convoys, setConvoys] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (open) {
      setFetching(true);
      convoysAPI.list({ status: 'planned' })
        .then(r => setConvoys(r.data.data || []))
        .catch(() => {})
        .finally(() => setFetching(false));
    }
  }, [open]);

  const submit = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await convoysAPI.updateStatus(selected, 'active');
      onSuccess('Convoy dispatched successfully');
      onClose();
    } catch (e) {
      onSuccess('Dispatch failed — check convoy status');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Dispatch Convoy"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="success" loading={loading} onClick={submit} className="bg-success text-navy-950">Dispatch</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Select a planned convoy to dispatch immediately.</p>
        {fetching ? <Spinner /> : convoys.length === 0 ? (
          <div className="text-center py-6 text-slate-600 text-sm font-mono">NO PLANNED CONVOYS</div>
        ) : (
          <div className="space-y-2">
            {convoys.map(c => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${selected === c.id ? 'border-gold/40 bg-gold/5' : 'border-white/5 hover:border-white/10'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${selected === c.id ? 'bg-gold' : 'bg-slate-600'}`} />
                <div>
                  <p className="text-sm font-medium text-slate-200">{c.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{c.origin} → {c.destination}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Mission Card ───────────────────────────────────────────────
function MissionCard({ mission }) {
  const progress = mission.progress ?? 0;
  const barColor = mission.status === 'delayed' ? '#F59E0B' : mission.status === 'incident' ? '#F25252' : '#F0B429';
  const glowColor = mission.status === 'delayed' ? '#F59E0B' : mission.status === 'incident' ? '#F25252' : '#F0B429';

  return (
    <div className="px-5 py-4 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-slate-300">{mission.name}</span>
            <Badge status={mission.status} dot>{mission.status?.toUpperCase()}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
            <MapPin size={10} /><span>{mission.origin}</span>
            <span className="text-slate-700">→</span><span>{mission.destination}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono flex-shrink-0">
          <Clock size={10} /><span>{mission.eta || '—'}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              background: `linear-gradient(90deg, ${barColor}, transparent)`,
              boxShadow: `0 0 8px ${glowColor}40`,
              width: `${progress}%`,
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-slate-600 w-8 text-right">{progress}%</span>
      </div>
    </div>
  );
}

// ── Quick Action Button ────────────────────────────────────────
function QuickAction({ icon: Icon, label, color, bg, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2.5 p-4 rounded-xl transition-all duration-150 group active:scale-95"
      style={{ background: bg || 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color + '40'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
        style={{ background: color + '15', border: `1px solid ${color}25` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <span
        className="text-[9px] font-mono tracking-wider text-center leading-tight"
        style={{ color: 'rgba(148,163,184,0.8)' }}
      >
        {label}
      </span>
    </button>
  );
}

// ── Toast ──────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, []);
  return (
    <div className="fixed bottom-6 right-4 z-[200] flex items-center gap-3 bg-navy-800 border border-success/30 rounded-xl px-4 py-3 shadow-2xl animate-fade-in">
      <CheckCircle2 size={16} className="text-success flex-shrink-0" />
      <p className="text-sm text-slate-200">{msg}</p>
      <button onClick={onDone} className="text-slate-500 hover:text-slate-300 ml-1"><X size={13} /></button>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────
export default function DashboardPage() {
  const [kpis, setKpis] = useState(null);
  const [convoyMetrics, setConvoyMetrics] = useState([]);
  const [fleetUtil, setFleetUtil] = useState([]);
  const [activeConvoys, setActiveConvoys] = useState([]);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null); // 'convoy'|'vehicle'|'alert'|'dispatch'
  const { alerts, fetchAlerts } = useAlertStore();

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [dash, metrics, util, convoys] = await Promise.all([
        analyticsAPI.dashboard(),
        analyticsAPI.convoyMetrics(),
        analyticsAPI.fleetUtilization(),
        convoysAPI.list({ status: 'active', limit: 5 }),
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
      setActiveConvoys(convoys.data.data || []);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    loadData();
    fetchAlerts({ resolved: 'false', limit: 5 });
    const unsubVehicle = socketService.onVehicleUpdate((data) => setFeed(f => [{ type: 'gps', ...data, ts: new Date() }, ...f].slice(0, 30)));
    const unsubAlert = socketService.onAlertNew((data) => setFeed(f => [{ type: 'alert', ...data, ts: new Date() }, ...f].slice(0, 30)));
    const unsubConvoy = socketService.onConvoyUpdate((data) => setFeed(f => [{ type: 'convoy', ...data, ts: new Date() }, ...f].slice(0, 30)));
    return () => { unsubVehicle(); unsubAlert(); unsubConvoy(); };
  }, []);

  useInterval(() => loadData(), 30000);

  const showToast = (msg) => { setToast(msg); loadData(true); fetchAlerts({ resolved: 'false', limit: 5 }); };

  // Compute threat level from open alerts
  const threatLevel = kpis?.openAlerts > 10 ? 5 : kpis?.openAlerts > 5 ? 4 : kpis?.openAlerts > 2 ? 3 : kpis?.openAlerts > 0 ? 2 : 1;
  const threatLabel = kpis?.openAlerts > 10 ? 'CRITICAL' : kpis?.openAlerts > 5 ? 'HIGH' : kpis?.openAlerts > 2 ? 'ELEVATED' : kpis?.openAlerts > 0 ? 'GUARDED' : 'CLEAR';
  const threatColors = ['#22D3A0', '#22D3A0', '#F0B429', '#F0B429', '#F25252'];

  return (
    <div className="space-y-5 max-w-[1600px]">
      {toast && <Toast msg={toast} onDone={() => setToast('')} />}

      {/* Modals */}
      <NewConvoyModal  open={modal === 'convoy'}   onClose={() => setModal(null)} onSuccess={showToast} />
      <AddVehicleModal open={modal === 'vehicle'}  onClose={() => setModal(null)} onSuccess={showToast} />
      <LogAlertModal   open={modal === 'alert'}    onClose={() => setModal(null)} onSuccess={showToast} />
      <DispatchModal   open={modal === 'dispatch'} onClose={() => setModal(null)} onSuccess={showToast} />

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[9px] font-mono text-slate-600 tracking-[0.25em] uppercase">FleetOps Pro · Command Center · Live</span>
          </div>
          <h1 className="font-display text-2xl font-black text-slate-100 tracking-wider leading-none">
            OPERATIONAL <span style={{ color: '#F0B429' }}>OVERVIEW</span>
          </h1>
        </div>

        {/* Threat level + refresh row */}
        <div className="flex items-center gap-4">
          {/* Threat Level indicator */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '8px 14px' }}>
            <div className="text-[8px] font-mono text-slate-600 tracking-widest mb-1.5">THREAT LEVEL</div>
            <div className="flex items-center gap-1.5">
              {threatColors.map((c, i) => {
                const active = i < threatLevel;
                return (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: active ? c : 'rgba(255,255,255,0.08)',
                    boxShadow: active ? `0 0 8px ${c}` : 'none',
                    transition: 'all 0.4s',
                  }} />
                );
              })}
              <span className="text-[9px] font-mono text-slate-500 ml-1">{threatLabel}</span>
            </div>
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono text-slate-500 hover:text-slate-300 transition-all disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">REFRESH</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Active Convoys"
            value={kpis?.activeConvoys ?? '—'}
            icon={Shield}
            color="text-gold"
            accentColor="#F0B429"
            sub="missions in progress"
          />
          <KPICard
            label="Fleet Utilisation"
            value={kpis ? `${kpis.fleetUtilisation}%` : '—'}
            icon={Truck}
            color="text-success"
            accentColor="#22D3A0"
            sub={`${kpis?.activeVehicles ?? '—'} of ${kpis?.totalVehicles ?? '—'} vehicles`}
          />
          <KPICard
            label="Open Alerts"
            value={kpis?.openAlerts ?? '—'}
            icon={Bell}
            color={kpis?.openAlerts > 0 ? 'text-danger' : 'text-slate-400'}
            accentColor={kpis?.openAlerts > 0 ? '#F25252' : '#475569'}
            pulse={kpis?.openAlerts > 0}
            sub="unresolved incidents"
          />
          <KPICard
            label="On-Time Rate"
            value={kpis ? `${kpis.onTimeRate}%` : '—'}
            icon={TrendingUp}
            color="text-blue-400"
            accentColor="#60a5fa"
            sub="completed missions"
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card header="CONVOY ACTIVITY" accent="#F0B429" className="xl:col-span-2" action={<span className="text-[10px] font-mono text-slate-600">LAST 14 DAYS</span>}>
          <div className="px-4 pb-4 pt-2">
            {loading ? <div className="h-52 flex items-center justify-center"><Spinner /></div>
            : convoyMetrics.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={convoyMetrics} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F0B429" stopOpacity={0.25} /><stop offset="95%" stopColor="#F0B429" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22D3A0" stopOpacity={0.2} /><stop offset="95%" stopColor="#22D3A0" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip {...CHART_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#64748b', paddingTop: 8 }} />
                  <Area type="monotone" dataKey="Completed" stroke="#F0B429" fill="url(#gC)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="On Time"   stroke="#22D3A0" fill="url(#gO)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Delayed"   stroke="#F25252" fill="none"     strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={Activity} title="No convoy data yet" />}
          </div>
        </Card>

        <Card
          header="LIVE EVENT FEED"
          accent="#22D3A0"
          action={
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-[10px] font-mono text-success/70">LIVE</span>
            </div>
          }
          className="xl:col-span-1"
        >
          <div className="terminal-feed max-h-[280px] overflow-y-auto">
            {feed.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Radio size={22} className="text-slate-700" />
                <p className="text-[10px] font-mono text-slate-700 tracking-widest">AWAITING EVENTS…</p>
              </div>
            ) : feed.map((ev, i) => {
              const cfg = FEED_CONFIG[ev.type] || FEED_CONFIG.gps;
              const Icon = cfg.icon;
              const ts = new Date(ev.ts);
              const timeStr = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              return (
                <div key={i} className="terminal-line">
                  <span className="terminal-ts">{timeStr}</span>
                  <Icon size={10} className={`flex-shrink-0 mt-0.5 ${cfg.color}`} />
                  <span className="text-slate-400 flex-1 min-w-0 truncate">
                    {ev.type === 'gps'    && `V/${String(ev.vehicleId || '').slice(-6).toUpperCase()} · ${ev.speed?.toFixed(0) ?? '?'}km/h`}
                    {ev.type === 'alert'  && `${ev.severity?.toUpperCase()} · ${truncate(ev.message, 30)}`}
                    {ev.type === 'convoy' && `CNV/${String(ev.convoyId || '').slice(-6).toUpperCase()} → ${ev.status}`}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card header="FLEET BY REGION" accent="#60a5fa" action={<span className="text-[10px] font-mono text-slate-600">VEHICLES</span>}>
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
                  <Bar dataKey="Maintenance" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={Truck} title="No fleet data" />}
          </div>
        </Card>

        <Card
          header="ACTIVE MISSIONS"
          accent="#F0B429"
          action={<a href="/convoys" className="text-[10px] font-mono text-gold/70 hover:text-gold flex items-center gap-1 transition-colors">VIEW ALL <ArrowUpRight size={10} /></a>}
        >
          {loading ? <div className="p-4 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} lines={2} />)}</div>
          : activeConvoys.length ? <div>{activeConvoys.slice(0, 4).map(c => <MissionCard key={c.id} mission={c} />)}</div>
          : <EmptyState icon={Shield} title="No active missions" subtitle="Dispatch a convoy to see it here" action={<Button size="sm" onClick={() => setModal('dispatch')}>Dispatch Now</Button>} />}
        </Card>

        <div className="space-y-5">
          <Card
            header="RECENT ALERTS"
            accent="#F25252"
            action={<span className="text-[10px] font-mono text-slate-600">{alerts.length} OPEN</span>}
          >
            <div>
              {alerts.slice(0, 4).map((a) => (
                <div
                  key={a.id}
                  className="px-4 py-3 flex items-start gap-3 hover:bg-white/[0.015] transition-colors"
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    borderLeft: `2px solid ${a.severity === 'critical' ? '#F25252' : a.severity === 'high' ? '#F59E0B' : '#475569'}`,
                  }}
                >
                  <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <Badge severity={a.severity} dot>{a.severity?.toUpperCase()}</Badge>
                    <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{truncate(a.message, 50)}</p>
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

          <Card header="QUICK ACTIONS" accent="#22D3A0">
            <div className="p-4 grid grid-cols-2 gap-2">
              <QuickAction icon={Shield} label="NEW CONVOY"  color="#F0B429" onClick={() => setModal('convoy')} />
              <QuickAction icon={Truck}  label="ADD VEHICLE" color="#60a5fa" onClick={() => setModal('vehicle')} />
              <QuickAction icon={Bell}   label="LOG ALERT"   color="#F25252" onClick={() => setModal('alert')} />
              <QuickAction icon={Target} label="DISPATCH"    color="#22D3A0" onClick={() => setModal('dispatch')} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
