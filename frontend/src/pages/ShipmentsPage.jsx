import { useEffect, useState, useCallback } from 'react';
import {
  Package, Plus, Search, X, Truck, Clock, CheckCircle2,
  AlertTriangle, Navigation, ChevronRight, Thermometer,
  ShieldAlert, DollarSign, MapPin, RefreshCw, Filter,
  FileText, User, BarChart2, TrendingUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { formatDate, timeAgo } from '../utils/helpers';
import { Spinner } from '../components/UI';

const STATUS_CONFIG = {
  pending:       { color:'text-slate-400', bg:'bg-slate-500/10', border:'border-slate-500/20', label:'Pending' },
  picked_up:     { color:'text-blue-400',  bg:'bg-blue-500/10',  border:'border-blue-500/20',  label:'Picked Up' },
  in_transit:    { color:'text-gold',      bg:'bg-gold/10',      border:'border-gold/20',       label:'In Transit' },
  at_checkpoint: { color:'text-purple-400',bg:'bg-purple-500/10',border:'border-purple-500/20',label:'At Checkpoint' },
  delivered:     { color:'text-success',   bg:'bg-success/10',   border:'border-success/20',    label:'Delivered' },
  failed:        { color:'text-danger',    bg:'bg-danger/10',    border:'border-danger/20',     label:'Failed' },
  returned:      { color:'text-amber-400', bg:'bg-amber-400/10', border:'border-amber-400/20',  label:'Returned' },
};

const PRIORITY_CONFIG = {
  standard:   { color:'text-slate-400', label:'Standard' },
  express:    { color:'text-blue-400',  label:'Express' },
  critical:   { color:'text-danger',    label:'Critical' },
  hazmat:     { color:'text-orange-400',label:'HazMat' },
  cold_chain: { color:'text-cyan-400',  label:'Cold Chain' },
};

function ShipmentCard({ shipment, onSelect }) {
  const sc = STATUS_CONFIG[shipment.status] || STATUS_CONFIG.pending;
  const pc = PRIORITY_CONFIG[shipment.priority] || PRIORITY_CONFIG.standard;
  const isLate = shipment.scheduled_delivery && !shipment.actual_delivery && new Date() > new Date(shipment.scheduled_delivery);

  return (
    <div onClick={() => onSelect(shipment)}
      className={`bg-navy-900 border rounded-xl p-4 cursor-pointer hover:border-white/10 transition-all
        ${isLate ? 'border-amber-400/30' : 'border-white/[0.06]'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono font-bold text-sm text-slate-200">{shipment.tracking_number}</p>
            {shipment.requires_temp_control && <Thermometer size={12} className="text-cyan-400" />}
            {shipment.is_hazmat && <ShieldAlert size={12} className="text-orange-400" />}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">{shipment.customer_name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.border} ${sc.color}`}>
            {sc.label.toUpperCase()}
          </span>
          <span className={`text-[9px] font-mono ${pc.color}`}>{pc.label}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-3">
        <Navigation size={10} className="text-slate-500 flex-shrink-0" />
        <span className="truncate">{shipment.origin_address} → {shipment.destination_address}</span>
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono">
        <div className="flex items-center gap-3 text-slate-500">
          {shipment.cargo_weight_kg && <span>{shipment.cargo_weight_kg}kg</span>}
          {shipment.vehicle_reg && <span className="flex items-center gap-1"><Truck size={9}/>{shipment.vehicle_reg}</span>}
          {shipment.driver_name && <span className="flex items-center gap-1"><User size={9}/>{shipment.driver_name}</span>}
        </div>
        {isLate && <span className="text-amber-400 font-bold animate-pulse">LATE</span>}
        {shipment.scheduled_delivery && !isLate && !shipment.actual_delivery && (
          <span className="text-slate-500">ETA {formatDate(shipment.scheduled_delivery)}</span>
        )}
      </div>
    </div>
  );
}

function ShipmentDetail({ shipment, onClose, onRefresh }) {
  const [updating, setUpdating] = useState(false);
  const sc = STATUS_CONFIG[shipment.status] || STATUS_CONFIG.pending;

  const updateStatus = async (status) => {
    setUpdating(true);
    try {
      await api.patch(`/shipments/${shipment.id}/status`, { status });
      toast.success(`Status → ${status}`);
      onRefresh();
    } catch { toast.error('Update failed'); }
    finally { setUpdating(false); }
  };

  const STATUS_FLOW = ['pending','picked_up','in_transit','at_checkpoint','delivered'];
  const currentIdx = STATUS_FLOW.indexOf(shipment.status);

  return (
    <div className="w-96 flex-shrink-0 bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col" style={{maxHeight:'calc(100vh-140px)'}}>
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <p className="font-mono font-bold text-gold">{shipment.tracking_number}</p>
          <p className="text-xs text-slate-500 mt-0.5">{shipment.customer_name}</p>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status flow */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <p className="text-[9px] font-mono text-slate-500 uppercase tracking-widest mb-3">SHIPMENT STATUS</p>
          <div className="flex items-center">
            {STATUS_FLOW.map((s, i) => {
              const done = i <= currentIdx;
              const active = i === currentIdx;
              return (
                <div key={s} className="flex items-center flex-1 last:flex-none">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2 transition-colors
                    ${active ? 'bg-gold border-gold text-navy-950' : done ? 'bg-success/20 border-success text-success' : 'bg-navy-700 border-white/10 text-slate-600'}`}>
                    {done && !active ? '✓' : i + 1}
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 ${i < currentIdx ? 'bg-success' : 'bg-navy-700'}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2">
            {STATUS_FLOW.map((s) => (
              <span key={s} className="text-[8px] font-mono text-slate-600 capitalize" style={{fontSize:'7px'}}>{s.replace('_',' ')}</span>
            ))}
          </div>
        </div>

        {/* Key details */}
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Priority', shipment.priority?.toUpperCase()],
            ['Weight', shipment.cargo_weight_kg ? `${shipment.cargo_weight_kg}kg` : '—'],
            ['Value', shipment.cargo_value ? `$${parseFloat(shipment.cargo_value).toLocaleString()}` : '—'],
            ['Vehicle', shipment.vehicle_reg || '—'],
            ['Driver', shipment.driver_name || '—'],
            ['Convoy', shipment.convoy_name || '—'],
          ].map(([l,v]) => (
            <div key={l} className="bg-navy-800 rounded-lg p-2.5 border border-white/5">
              <p className="text-[9px] font-mono text-slate-600 mb-1">{l.toUpperCase()}</p>
              <p className="text-xs text-slate-300 truncate">{v}</p>
            </div>
          ))}
        </div>

        {/* Route */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <p className="text-[9px] font-mono text-slate-500 mb-2">ROUTE</p>
          <div className="space-y-2">
            <div className="flex gap-2.5">
              <div className="w-2 h-2 rounded-full bg-gold mt-1 flex-shrink-0" />
              <div>
                <p className="text-[9px] text-slate-500">ORIGIN</p>
                <p className="text-xs text-slate-200">{shipment.origin_address}</p>
              </div>
            </div>
            <div className="ml-1 w-0.5 h-4 bg-navy-600" />
            <div className="flex gap-2.5">
              <div className="w-2 h-2 rounded-full bg-success mt-1 flex-shrink-0" />
              <div>
                <p className="text-[9px] text-slate-500">DESTINATION</p>
                <p className="text-xs text-slate-200">{shipment.destination_address}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
          <p className="text-[9px] font-mono text-slate-500 mb-2">TIMELINE</p>
          <div className="space-y-1.5">
            {[
              ['Scheduled pickup', shipment.scheduled_pickup],
              ['Actual pickup', shipment.actual_pickup],
              ['Scheduled delivery', shipment.scheduled_delivery],
              ['Actual delivery', shipment.actual_delivery],
            ].filter(([,v]) => v).map(([l,v]) => (
              <div key={l} className="flex justify-between text-[10px]">
                <span className="text-slate-500">{l}</span>
                <span className="font-mono text-slate-300">{formatDate(v)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Checkpoints */}
        {shipment.checkpoints?.length > 0 && (
          <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
            <p className="text-[9px] font-mono text-slate-500 mb-2">CHECKPOINTS</p>
            <div className="space-y-2">
              {shipment.checkpoints.map((cp, i) => (
                <div key={cp.id} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border
                    ${cp.status === 'reached' ? 'bg-success/20 border-success text-success' : 'bg-navy-700 border-white/10 text-slate-600'}`}>
                    {cp.status === 'reached' ? '✓' : i + 1}
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-300">{cp.name}</p>
                    {cp.expected_at && <p className="text-[9px] text-slate-600">{formatDate(cp.expected_at)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cargo flags */}
        {(shipment.requires_temp_control || shipment.is_hazmat) && (
          <div className="space-y-2">
            {shipment.requires_temp_control && (
              <div className="flex items-center gap-2 px-3 py-2 bg-cyan-400/10 border border-cyan-400/20 rounded-lg">
                <Thermometer size={13} className="text-cyan-400" />
                <div>
                  <p className="text-[10px] font-mono font-bold text-cyan-400">COLD CHAIN</p>
                  <p className="text-[9px] text-slate-500">{shipment.temp_min}°C to {shipment.temp_max}°C</p>
                </div>
              </div>
            )}
            {shipment.is_hazmat && (
              <div className="flex items-center gap-2 px-3 py-2 bg-orange-400/10 border border-orange-400/20 rounded-lg">
                <ShieldAlert size={13} className="text-orange-400" />
                <div>
                  <p className="text-[10px] font-mono font-bold text-orange-400">HAZARDOUS CARGO</p>
                  <p className="text-[9px] text-slate-500">Class: {shipment.hazmat_class || 'Unspecified'}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {shipment.status !== 'delivered' && shipment.status !== 'failed' && (
          <div>
            <p className="text-[9px] font-mono text-slate-600 mb-2">UPDATE STATUS</p>
            <div className="grid grid-cols-2 gap-2">
              {['picked_up','in_transit','at_checkpoint','delivered','failed'].filter(s => s !== shipment.status).slice(0, 4).map(s => {
                const sc2 = STATUS_CONFIG[s];
                return (
                  <button key={s} onClick={() => updateStatus(s)} disabled={updating}
                    className={`py-2 text-[9px] font-mono font-bold border rounded-lg transition-colors ${sc2.bg} ${sc2.border} ${sc2.color} hover:opacity-80 disabled:opacity-40`}>
                    → {sc2.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({ customer_name:'', origin_address:'', destination_address:'', priority:'standard', cargo_description:'', cargo_weight_kg:'', cargo_value:'' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (search) params.search = search;
      const [sRes, statsRes] = await Promise.allSettled([
        api.get('/shipments', { params }),
        api.get('/shipments/stats/summary'),
      ]);
      if (sRes.status === 'fulfilled') { setShipments(sRes.value.data.data || []); setTotal(sRes.value.data.total || 0); }
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data.data);
    } catch {} finally { setLoading(false); }
  }, [statusFilter, priorityFilter, search]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const submitForm = async () => {
    if (!form.customer_name || !form.origin_address || !form.destination_address) {
      toast.error('Customer, origin and destination required'); return;
    }
    setSubmitting(true);
    try {
      const r = await api.post('/shipments', form);
      toast.success(`Shipment created: ${r.data.data.tracking_number}`);
      setShowForm(false);
      setForm({ customer_name:'', origin_address:'', destination_address:'', priority:'standard', cargo_description:'', cargo_weight_kg:'', cargo_value:'' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-5 max-w-[1800px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">SHIPMENTS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{total} total · Cargo tracking & management</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-2.5 bg-navy-900 border border-white/10 rounded-xl text-slate-400 hover:text-gold transition-colors"><RefreshCw size={14}/></button>
          <button onClick={() => setShowForm(f=>!f)} className="flex items-center gap-2 px-4 py-2.5 bg-gold/10 border border-gold/30 text-gold rounded-xl text-sm font-mono font-bold hover:bg-gold/20 transition-colors">
            {showForm ? <><X size={13}/>CANCEL</> : <><Plus size={13}/>NEW SHIPMENT</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ['Total', stats.total, 'text-slate-300'],
            ['In Transit', stats.in_transit, 'text-gold'],
            ['Delivered', stats.delivered, 'text-success'],
            ['Pending', stats.pending, 'text-slate-400'],
            ['Critical', stats.critical, 'text-danger'],
            ['Failed', stats.failed, 'text-danger'],
          ].map(([l,v,c]) => (
            <div key={l} className="bg-navy-900 border border-white/5 rounded-xl p-3 text-center">
              <p className={`font-display text-2xl font-bold ${c}`}>{v || 0}</p>
              <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{l.toUpperCase()}</p>
            </div>
          ))}
        </div>
      )}

      {/* New shipment form */}
      {showForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-4">CREATE NEW SHIPMENT</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['customer_name','Customer Name *','text'],
              ['origin_address','Origin Address *','text'],
              ['destination_address','Destination Address *','text'],
              ['cargo_description','Cargo Description','text'],
              ['cargo_weight_kg','Weight (kg)','number'],
              ['cargo_value','Value (USD)','number'],
            ].map(([key, label, type]) => (
              <div key={key} className="space-y-1">
                <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{label}</label>
                <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={label.replace(' *','')}
                  className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none placeholder-slate-600" />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Priority</label>
              <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                {Object.entries(PRIORITY_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={submitForm} disabled={submitting} className="w-full py-2.5 bg-gold text-navy-950 rounded-lg text-sm font-mono font-bold hover:bg-gold/90 transition-colors disabled:opacity-50">
                {submitting ? 'CREATING…' : 'CREATE SHIPMENT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tracking number, customer..."
            className="w-full bg-navy-900 border border-white/[0.06] focus:border-gold/40 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none" />
        </div>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)} className="bg-navy-900 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-slate-300 outline-none">
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Content */}
      <div className="flex gap-5">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : shipments.length === 0 ? (
            <div className="text-center py-20 text-slate-600">
              <Package size={32} className="mx-auto mb-3 opacity-30" />
              <p>No shipments found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {shipments.map(s => <ShipmentCard key={s.id} shipment={s} onSelect={setSelected} />)}
            </div>
          )}
        </div>
        {selected && (
          <ShipmentDetail shipment={selected} onClose={() => setSelected(null)} onRefresh={() => { load(); }} />
        )}
      </div>
    </div>
  );
}
