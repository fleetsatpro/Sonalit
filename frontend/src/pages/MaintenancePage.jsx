import { useEffect, useState, useCallback } from 'react';
import { Wrench, Plus, X, AlertTriangle, CheckCircle2, Clock, TrendingUp, Filter, RefreshCw, Tool, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { vehiclesAPI } from '../services/api';
import { formatDate } from '../utils/helpers';
import { Spinner } from '../components/UI';

const PRIORITY_CONFIG = {
  critical: { color:'text-danger',   bg:'bg-danger/10',   border:'border-danger/30',   dot:'bg-danger animate-pulse' },
  high:     { color:'text-orange-400',bg:'bg-orange-400/10',border:'border-orange-400/20',dot:'bg-orange-400' },
  medium:   { color:'text-amber-400', bg:'bg-amber-400/10', border:'border-amber-400/20', dot:'bg-amber-400' },
  low:      { color:'text-slate-400', bg:'bg-slate-500/10', border:'border-slate-500/20', dot:'bg-slate-500' },
};

const STATUS_CONFIG = {
  scheduled:   { color:'text-blue-400',   icon:'📅' },
  in_progress: { color:'text-amber-400',  icon:'🔧' },
  completed:   { color:'text-success',    icon:'✅' },
  cancelled:   { color:'text-slate-500',  icon:'❌' },
};

const TYPE_ICONS = {
  scheduled:'🔧', breakdown:'🚨', inspection:'🔍', recall:'⚠️', upgrade:'⬆️',
};

export default function MaintenancePage() {
  const [records, setRecords] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vehicle_id:'', type:'scheduled', title:'', description:'', priority:'medium', cost:'', workshop:'', scheduled_at:'' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const [r, o, v] = await Promise.allSettled([
        api.get('/maintenance', { params }),
        api.get('/maintenance/overdue'),
        vehiclesAPI.list({ limit: 100 }),
      ]);
      if (r.status==='fulfilled') setRecords(r.value.data.data||[]);
      if (o.status==='fulfilled') setOverdue(o.value.data.data||[]);
      if (v.status==='fulfilled') setVehicles(v.value.data.data||[]);
    } catch {} finally { setLoading(false); }
  }, [statusFilter, priorityFilter]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.vehicle_id || !form.type || !form.title) { toast.error('Vehicle, type and title required'); return; }
    setSubmitting(true);
    try {
      await api.post('/maintenance', form);
      toast.success('Maintenance record created');
      setShowForm(false);
      setForm({ vehicle_id:'', type:'scheduled', title:'', description:'', priority:'medium', cost:'', workshop:'', scheduled_at:'' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/maintenance/${id}`, { status, ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}) });
      toast.success(`Status → ${status}`);
      load();
    } catch { toast.error('Failed'); }
  };

  const stats = {
    total: records.length,
    scheduled: records.filter(r=>r.status==='scheduled').length,
    in_progress: records.filter(r=>r.status==='in_progress').length,
    overdue_count: overdue.length,
    total_cost: records.filter(r=>r.status==='completed').reduce((s,r) => s + parseFloat(r.cost||0), 0),
  };

  return (
    <div className="space-y-5 max-w-[1800px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">MAINTENANCE</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">Fleet maintenance scheduling & tracking</p>
        </div>
        <button onClick={() => setShowForm(f=>!f)} className="flex items-center gap-2 px-4 py-2.5 bg-gold/10 border border-gold/30 text-gold rounded-xl text-sm font-mono font-bold hover:bg-gold/20 transition-colors">
          {showForm ? <><X size={13}/>CANCEL</> : <><Plus size={13}/>SCHEDULE</>}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ['Total', stats.total, 'text-slate-300'],
          ['Scheduled', stats.scheduled, 'text-blue-400'],
          ['In Progress', stats.in_progress, 'text-amber-400'],
          ['Overdue', stats.overdue_count, 'text-danger'],
          ['Cost (completed)', `$${stats.total_cost.toLocaleString()}`, 'text-success'],
        ].map(([l,v,c]) => (
          <div key={l} className="bg-navy-900 border border-white/5 rounded-xl p-4 text-center">
            <p className={`font-display text-2xl font-bold ${c}`}>{v}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{l.toUpperCase()}</p>
          </div>
        ))}
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div className="bg-danger/10 border border-danger/30 rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle size={16} className="text-danger" />
            <p className="text-sm font-bold text-danger">{overdue.length} OVERDUE / HIGH-RISK MAINTENANCE</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {overdue.slice(0, 6).map(r => (
              <div key={r.id} className="flex items-center gap-2.5 bg-danger/5 border border-danger/10 rounded-lg p-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-mono font-bold text-slate-200 truncate">{r.registration}</p>
                  <p className="text-[10px] text-danger">{r.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New record form */}
      {showForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">SCHEDULE MAINTENANCE</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">VEHICLE *</label>
              <select value={form.vehicle_id} onChange={e=>setForm(f=>({...f,vehicle_id:e.target.value}))} className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                <option value="">Select vehicle</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration} · {v.type}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">TYPE *</label>
              <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {['scheduled','breakdown','inspection','recall','upgrade'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">PRIORITY</label>
              <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">SCHEDULED DATE</label>
              <input type="datetime-local" value={form.scheduled_at} onChange={e=>setForm(f=>({...f,scheduled_at:e.target.value}))} className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[9px] font-mono text-slate-500">TITLE *</label>
              <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Full service + oil change"
                className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">WORKSHOP</label>
              <input value={form.workshop} onChange={e=>setForm(f=>({...f,workshop:e.target.value}))} placeholder="Workshop name"
                className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500">ESTIMATED COST ($)</label>
              <input type="number" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0"
                className="w-full bg-navy-800 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={submit} disabled={submitting} className="px-6 py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold hover:bg-gold/90 disabled:opacity-50">
              {submitting ? 'SCHEDULING…' : 'SCHEDULE MAINTENANCE'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All statuses</option>
          {['scheduled','in_progress','completed','cancelled'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)} className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All priorities</option>
          {['critical','high','medium','low'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Records */}
      {loading ? <div className="flex justify-center py-20"><Spinner/></div> : (
        <div className="space-y-3">
          {records.length === 0 ? (
            <div className="text-center py-20 text-slate-600">
              <Wrench size={32} className="mx-auto mb-3 opacity-30"/>
              <p>No maintenance records</p>
            </div>
          ) : records.map(r => {
            const pc = PRIORITY_CONFIG[r.priority] || PRIORITY_CONFIG.medium;
            const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.scheduled;
            const isOverdue = r.status !== 'completed' && r.scheduled_at && new Date(r.scheduled_at) < new Date();
            return (
              <div key={r.id} className={`bg-navy-900 border rounded-xl p-4 ${pc.border} ${isOverdue ? 'border-danger/40' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <span className="text-lg flex-shrink-0">{TYPE_ICONS[r.type] || '🔧'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-mono font-bold text-slate-200">{r.registration}</p>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${pc.bg} ${pc.border} ${pc.color}`}>
                          {r.priority?.toUpperCase()}
                        </span>
                        {isOverdue && <span className="text-[9px] font-mono font-bold text-danger animate-pulse">OVERDUE</span>}
                      </div>
                      <p className="text-sm text-slate-200 mb-1">{r.title}</p>
                      <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 flex-wrap">
                        <span className={sc.color}>{sc.icon} {r.status?.replace('_',' ').toUpperCase()}</span>
                        {r.scheduled_at && <span className="flex items-center gap-1"><Clock size={9}/>{formatDate(r.scheduled_at)}</span>}
                        {r.workshop && <span>🏭 {r.workshop}</span>}
                        {r.cost && <span className="text-success">${parseFloat(r.cost).toLocaleString()}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-3">
                    {r.status === 'scheduled' && (
                      <button onClick={() => updateStatus(r.id,'in_progress')} className="px-2.5 py-1.5 text-[9px] font-mono font-bold border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors">
                        START
                      </button>
                    )}
                    {r.status === 'in_progress' && (
                      <button onClick={() => updateStatus(r.id,'completed')} className="px-2.5 py-1.5 text-[9px] font-mono font-bold border border-success/30 text-success hover:bg-success/10 rounded-lg transition-colors">
                        COMPLETE
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
