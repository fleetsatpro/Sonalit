import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from 'recharts';
import { Users, Plus, Search, X, Star, TrendingUp, AlertTriangle, Truck, Phone, Mail, Award, Clock, Navigation, ChevronRight, RefreshCw, Shield, Activity, Gauge } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { formatDate, timeAgo } from '../utils/helpers';
import { Spinner } from '../components/UI';

function ScoreRing({ score, size = 64 }) {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0));
  const dash = (pct / 100) * circ;
  const color = pct >= 80 ? '#22D3A0' : pct >= 60 ? '#F0B429' : pct >= 40 ? '#F97316' : '#F25252';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 1s ease' }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
        style={{ fill: color, fontSize: size * 0.22, fontFamily: 'monospace', fontWeight: 700, transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px` }}>
        {pct}
      </text>
    </svg>
  );
}

function DriverCard({ driver, onSelect, selected }) {
  const statusColor = { active:'text-success', inactive:'text-slate-500', suspended:'text-danger', on_leave:'text-amber-400' };
  const score = driver.driver_score || 100;
  const scoreColor = score >= 80 ? 'text-success' : score >= 60 ? 'text-amber-400' : 'text-danger';
  const initials = driver.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  return (
    <div onClick={() => onSelect(driver)}
      className={`bg-navy-900 border rounded-xl p-4 cursor-pointer hover:border-white/10 transition-all
        ${selected ? 'border-gold/30 ring-1 ring-gold/20' : 'border-white/[0.06]'}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-navy-700 border border-white/10 flex items-center justify-center">
            <span className="font-display text-lg font-bold text-slate-300">{initials}</span>
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-navy-900 ${driver.status === 'active' ? 'bg-success' : driver.status === 'suspended' ? 'bg-danger' : 'bg-slate-500'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-200 truncate">{driver.name}</p>
          <p className="text-[10px] font-mono text-slate-500">{driver.employee_id || '—'}</p>
          <p className={`text-[9px] font-mono font-bold ${statusColor[driver.status] || 'text-slate-500'}`}>{driver.status?.toUpperCase()}</p>
        </div>
        <div className="text-right">
          <ScoreRing score={score} size={44} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center border-t border-white/[0.04] pt-3">
        {[
          ['Trips', driver.total_trips || 0],
          ['KM', parseFloat(driver.total_km || 0).toLocaleString()],
          ['Score', score],
        ].map(([l,v]) => (
          <div key={l}>
            <p className="text-sm font-bold text-slate-200">{v}</p>
            <p className="text-[9px] font-mono text-slate-600">{l}</p>
          </div>
        ))}
      </div>
      {driver.vehicle_registration && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
          <Truck size={10} />{driver.vehicle_registration} · {driver.vehicle_type}
        </div>
      )}
    </div>
  );
}

function DriverDetailPanel({ driver, onClose, onRefresh }) {
  const [scorecard, setScorecard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/drivers/${driver.id}/scorecard`)
      .then(r => setScorecard(r.data.data))
      .catch(() => setScorecard(null))
      .finally(() => setLoading(false));
  }, [driver.id]);

  const radarData = scorecard ? [
    { subject: 'Speed', A: scorecard.scorecard?.speeding || 0 },
    { subject: 'Braking', A: scorecard.scorecard?.harsh_braking || 0 },
    { subject: 'Accel', A: scorecard.scorecard?.harsh_acceleration || 0 },
    { subject: 'Idling', A: scorecard.scorecard?.idling || 0 },
    { subject: 'Route', A: scorecard.scorecard?.route_discipline || 0 },
  ] : [];

  const updateStatus = async (status) => {
    try {
      await api.put(`/drivers/${driver.id}`, { status });
      toast.success('Status updated');
      onRefresh();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="w-96 flex-shrink-0 bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col" style={{maxHeight:'calc(100vh-140px)'}}>
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-navy-700 border border-white/10 flex items-center justify-center">
            <span className="font-display font-bold text-slate-300">{driver.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</span>
          </div>
          <div>
            <p className="font-bold text-slate-200">{driver.name}</p>
            <p className="text-[10px] font-mono text-slate-500">{driver.employee_id}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-white p-1.5 rounded-lg hover:bg-white/5"><X size={14}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Score ring */}
        <div className="flex items-center justify-center py-2">
          <div className="text-center">
            <ScoreRing score={driver.driver_score || 100} size={96} />
            <p className="text-[10px] font-mono text-slate-500 mt-2 tracking-wider">DRIVER SCORE</p>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5 space-y-2">
          {driver.phone && <div className="flex items-center gap-2 text-sm"><Phone size={12} className="text-slate-500"/><span className="text-slate-300">{driver.phone}</span></div>}
          {driver.email && <div className="flex items-center gap-2 text-sm"><Mail size={12} className="text-slate-500"/><span className="text-slate-300">{driver.email}</span></div>}
          {driver.vehicle_registration && <div className="flex items-center gap-2 text-sm"><Truck size={12} className="text-slate-500"/><span className="text-slate-300">{driver.vehicle_registration}</span></div>}
        </div>

        {/* License */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <p className="text-[9px] font-mono text-slate-500 mb-2">LICENSE</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-500">Number:</span> <span className="text-slate-300">{driver.license_number || '—'}</span></div>
            <div><span className="text-slate-500">Class:</span> <span className="text-slate-300">{driver.license_class || '—'}</span></div>
            {driver.license_expiry && (
              <div className="col-span-2 flex items-center justify-between">
                <span className="text-slate-500">Expires:</span>
                <span className={`font-mono text-xs ${new Date(driver.license_expiry) < new Date() ? 'text-danger font-bold' : new Date(driver.license_expiry) < new Date(Date.now() + 30*86400000) ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>
                  {formatDate(driver.license_expiry)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        {loading ? <div className="flex justify-center py-4"><Spinner/></div> : scorecard && (
          <>
            {/* Radar chart */}
            <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
              <p className="text-[9px] font-mono text-slate-500 mb-2">PERFORMANCE RADAR</p>
              <ResponsiveContainer width="100%" height={180}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill:'#64748b', fontSize:9 }} />
                  <Radar dataKey="A" stroke="#F0B429" fill="#F0B429" fillOpacity={0.15} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Score breakdown */}
            <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
              <p className="text-[9px] font-mono text-slate-500 mb-3">SCORE BREAKDOWN</p>
              <div className="space-y-2">
                {Object.entries(scorecard.scorecard || {}).filter(([k]) => k !== 'overall').map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 w-24 capitalize">{key.replace('_',' ')}</span>
                    <div className="flex-1 h-1.5 bg-navy-700 rounded-full">
                      <div className={`h-full rounded-full ${val >= 80 ? 'bg-success' : val >= 60 ? 'bg-amber-400' : 'bg-danger'}`} style={{width:`${val}%`}} />
                    </div>
                    <span className={`text-[10px] font-mono font-bold w-8 text-right ${val >= 80 ? 'text-success' : val >= 60 ? 'text-amber-400' : 'text-danger'}`}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent stats */}
            {scorecard.recentStats && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Trips (30d)', scorecard.recentStats.trips],
                  ['Avg Score', parseFloat(scorecard.recentStats.avg_score || 0).toFixed(0)],
                  ['Total KM', parseFloat(scorecard.recentStats.total_km || 0).toFixed(0)],
                  ['Events', Object.values(scorecard.events || {}).reduce((a,b) => a + parseInt(b), 0)],
                ].map(([l,v]) => (
                  <div key={l} className="bg-navy-800 rounded-lg p-2.5 border border-white/5 text-center">
                    <p className="text-base font-bold text-slate-200">{v || 0}</p>
                    <p className="text-[9px] font-mono text-slate-600">{l}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Status actions */}
        <div>
          <p className="text-[9px] font-mono text-slate-600 mb-2">CHANGE STATUS</p>
          <div className="grid grid-cols-2 gap-2">
            {['active','inactive','suspended','on_leave'].filter(s => s !== driver.status).map(s => (
              <button key={s} onClick={() => updateStatus(s)}
                className="py-2 text-[9px] font-mono font-bold border border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20 rounded-lg transition-colors">
                → {s.replace('_',' ').toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name:'', employee_id:'', phone:'', email:'', license_number:'', license_class:'C', status:'active' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const r = await api.get('/drivers', { params });
      setDrivers(r.data.data || []);
      setTotal(r.data.total || 0);
    } catch {} finally { setLoading(false); }
  }, [statusFilter, search]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const submit = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setSubmitting(true);
    try {
      await api.post('/drivers', form);
      toast.success('Driver registered');
      setShowForm(false);
      setForm({ name:'', employee_id:'', phone:'', email:'', license_number:'', license_class:'C', status:'active' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const topDrivers = [...drivers].sort((a,b) => (b.driver_score||100) - (a.driver_score||100)).slice(0,5);

  return (
    <div className="space-y-5 max-w-[1800px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">DRIVER MANAGEMENT</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{total} registered drivers</p>
        </div>
        <button onClick={() => setShowForm(f=>!f)} className="flex items-center gap-2 px-4 py-2.5 bg-gold/10 border border-gold/30 text-gold rounded-xl text-sm font-mono font-bold hover:bg-gold/20 transition-colors">
          {showForm ? <><X size={13}/>CANCEL</> : <><Plus size={13}/>ADD DRIVER</>}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ['Total',    drivers.length,                                          'text-slate-300'],
          ['Active',   drivers.filter(d=>d.status==='active').length,           'text-success'],
          ['Avg Score',drivers.length ? Math.round(drivers.reduce((s,d)=>s+(d.driver_score||100),0)/drivers.length) : 0, 'text-gold'],
          ['At Risk',  drivers.filter(d=>(d.driver_score||100)<60).length,     'text-danger'],
          ['Suspended',drivers.filter(d=>d.status==='suspended').length,        'text-danger'],
        ].map(([l,v,c]) => (
          <div key={l} className="bg-navy-900 border border-white/5 rounded-xl p-4 text-center">
            <p className={`font-display text-2xl font-bold ${c}`}>{v}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{l.toUpperCase()}</p>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">REGISTER DRIVER</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[['name','Full Name *','text'],['employee_id','Employee ID','text'],['phone','Phone','tel'],['email','Email','email'],['license_number','License No.','text'],['license_class','License Class','text']].map(([key,label,type]) => (
              <div key={key} className="space-y-1">
                <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{label}</label>
                <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={label.replace(' *','')}
                  className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
              </div>
            ))}
            <div className="flex items-end">
              <button onClick={submit} disabled={submitting} className="w-full py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold hover:bg-gold/90 disabled:opacity-50">
                {submitting ? 'SAVING…' : 'REGISTER'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, ID, phone..."
            className="w-full bg-navy-900 border border-white/[0.06] focus:border-gold/40 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none" />
        </div>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All statuses</option>
          {['active','inactive','suspended','on_leave'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
      </div>

      <div className="flex gap-5">
        <div className="flex-1 min-w-0">
          {loading ? <div className="flex justify-center py-20"><Spinner/></div>
            : drivers.length === 0 ? <div className="text-center py-20 text-slate-600"><Users size={32} className="mx-auto mb-3 opacity-30"/><p>No drivers found</p></div>
            : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {drivers.map(d => <DriverCard key={d.id} driver={d} onSelect={setSelected} selected={selected?.id===d.id} />)}
              </div>
          }
        </div>
        {selected && <DriverDetailPanel driver={selected} onClose={()=>setSelected(null)} onRefresh={load} />}
      </div>
    </div>
  );
}
