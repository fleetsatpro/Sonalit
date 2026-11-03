import { useEffect, useState, useCallback } from 'react';
import { Cpu, Plus, X, Wifi, WifiOff, Battery, RefreshCw, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { deviceAPI } from '../services/api';
import { Spinner, EmptyState } from '../components/UI';
import { formatDate, timeAgo } from '../utils/helpers';

const STATUS_CONFIG = {
  online:   { color:'text-success',   dot:'bg-success',   label:'Online'   },
  offline:  { color:'text-danger',    dot:'bg-danger',    label:'Offline'  },
  idle:     { color:'text-amber-400', dot:'bg-amber-400', label:'Idle'     },
  fault:    { color:'text-orange-400',dot:'bg-orange-400',label:'Fault'    },
};

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ serial_number:'', type:'gps_tracker', vehicle_id:'', firmware_version:'' });
  const [submitting, setSubmitting] = useState(false);
  const f = (k,v) => setForm(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await deviceAPI.list({ limit: 100 });
      setDevices(r.data.data || []);
    } catch { toast.error('Failed to load devices'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.serial_number) { toast.error('Serial number required'); return; }
    setSubmitting(true);
    try {
      const r = await deviceAPI.create(form);
      setDevices(p => [r.data.data, ...p]);
      toast.success('Device registered');
      setShowForm(false);
      setForm({ serial_number:'', type:'gps_tracker', vehicle_id:'', firmware_version:'' });
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status === 'offline').length;

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">DEVICES</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{devices.length} registered · {online} online · {offline} offline</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="p-2.5 bg-navy-900 border border-white/10 rounded-xl text-slate-400 hover:text-gold transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowForm(f => !f)} className="btn-primary">
            {showForm ? <><X size={13} />CANCEL</> : <><Plus size={13} />ADD DEVICE</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[['Total',devices.length,'text-slate-300'],['Online',online,'text-success'],['Offline',offline,'text-danger'],['Faults',devices.filter(d=>d.status==='fault').length,'text-orange-400']].map(([l,v,c]) => (
          <div key={l} className="bg-navy-900 border border-white/5 rounded-xl p-4 text-center">
            <p className={`font-display text-2xl font-bold ${c}`}>{v}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{l.toUpperCase()}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="section-label mb-4">REGISTER DEVICE</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[['serial_number','Serial Number *','text'],['firmware_version','Firmware Version','text']].map(([key,label,type]) => (
              <div key={key} className="space-y-1">
                <label className="section-label">{label}</label>
                <input type={type} value={form[key]} onChange={e=>f(key,e.target.value)} placeholder={label.replace(' *','')} className="input-field" />
              </div>
            ))}
            <div className="space-y-1">
              <label className="section-label">Type</label>
              <select value={form.type} onChange={e=>f('type',e.target.value)} className="input-field">
                {['gps_tracker','camera','sensor','beacon','dash_cam'].map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={submit} disabled={submitting} className="btn-primary w-full justify-center">
                {submitting ? 'SAVING…' : 'REGISTER'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? <div className="flex justify-center py-20"><Spinner /></div>
        : devices.length === 0 ? <EmptyState icon={Cpu} title="No devices" subtitle="Register GPS trackers and sensors" />
        : (
          <div className="bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="divide-y divide-white/[0.04]">
              <div className="px-5 py-3 grid grid-cols-5 text-[9px] font-mono text-slate-500 uppercase tracking-widest">
                <span>Serial</span><span>Type</span><span>Vehicle</span><span>Status</span><span>Last Ping</span>
              </div>
              {devices.map(d => {
                const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.offline;
                return (
                  <div key={d.id} className="px-5 py-3.5 grid grid-cols-5 items-center hover:bg-white/[0.01] transition-colors">
                    <div className="flex items-center gap-2">
                      <Cpu size={13} className="text-slate-500 flex-shrink-0" />
                      <span className="font-mono text-sm font-bold text-slate-200">{d.serial_number}</span>
                    </div>
                    <span className="text-xs text-slate-400 capitalize">{d.type?.replace('_',' ')}</span>
                    <span className="text-xs text-slate-400">{d.vehicle_registration || '—'}</span>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot} ${d.status==='online'?'animate-pulse':''}`} />
                      <span className={`text-xs font-mono font-bold ${sc.color}`}>{sc.label}</span>
                    </div>
                    <span className="text-xs font-mono text-slate-500">{d.last_ping ? timeAgo(d.last_ping) : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
}
