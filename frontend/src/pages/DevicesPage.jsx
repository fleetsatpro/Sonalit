
import { useEffect, useState } from 'react';
import { Cpu, Plus, Wifi, WifiOff, Battery, Signal } from 'lucide-react';
import { deviceAPI } from '../services/api';
import { Badge, Card, Button, Modal, Input, Spinner, EmptyState } from '../components/UI';
import { timeAgo } from '../utils/helpers';

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [form, setForm] = useState({ name:'', imei:'', sim_number:'', phone_number:'', status:'inactive' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const load = async () => {
    try { const r = await deviceAPI.list({}); setDevices(r.data.data || []); }
    catch (e) { setDevices([]); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    try { await deviceAPI.create(form); setModal(false); setForm({ name:'', imei:'', sim_number:'', phone_number:'', status:'inactive' }); load(); }
    catch (e) { console.error(e); }
  };

  const toggle = async (id, status) => {
    try { await deviceAPI.update(id, { status: status === 'active' ? 'inactive' : 'active' }); load(); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Device Management</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{devices.length} registered devices</p>
        </div>
        <Button onClick={() => setModal(true)}><Plus size={14} /> Register Device</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['TOTAL',       devices.length,                                    'text-slate-300'],
          ['ONLINE',      devices.filter(d => d.status === 'active').length, 'text-success'],
          ['OFFLINE',     devices.filter(d => d.status !== 'active').length, 'text-danger'],
          ['LOW BATTERY', devices.filter(d => (d.battery || 100) < 20).length, 'text-amber-400'],
        ].map(([l, v, c]) => (
          <div key={l} className="bg-navy-900 border border-white/5 rounded-xl p-4">
            <p className="text-[10px] font-mono text-slate-500 tracking-wider mb-1">{l}</p>
            <p className={`font-display text-3xl font-bold ${c}`}>{v}</p>
          </div>
        ))}
      </div>

      <Card>
        {loading
          ? <div className="flex items-center justify-center py-16"><Spinner /></div>
          : devices.length === 0
            ? <EmptyState icon={Cpu} title="No devices registered" subtitle="Register a GPS device to start tracking"
                action={<Button size="sm" onClick={() => setModal(true)}>Register Device</Button>} />
            : (
              <div className="divide-y divide-white/[0.04]">
                {devices.map(d => (
                  <div key={d.id} className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${d.status==='active'?'bg-success/10 border border-success/20':'bg-slate-700/30 border border-slate-700'}`}>
                      {d.status === 'active' ? <Wifi size={16} className="text-success" /> : <WifiOff size={16} className="text-slate-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200">{d.name}</p>
                      <p className="text-xs font-mono text-slate-500">IMEI: {d.imei || '—'} · SIM: {d.sim_number || '—'}</p>
                      {d.last_ping && <p className="text-[10px] text-slate-600 font-mono mt-0.5">Last ping: {timeAgo(d.last_ping)}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {d.battery !== undefined && <div className="flex items-center gap-1 text-xs font-mono text-slate-500"><Battery size={12} />{d.battery}%</div>}
                      {d.signal  !== undefined && <div className="flex items-center gap-1 text-xs font-mono text-slate-500"><Signal size={12} />{d.signal}</div>}
                      <Badge status={d.status === 'active' ? 'active' : 'offline'}>{d.status?.toUpperCase()}</Badge>
                      <button onClick={() => toggle(d.id, d.status)}
                        className={`px-2.5 py-1 text-xs font-mono rounded-lg border transition-all ${d.status==='active'?'border-danger/20 text-danger hover:bg-danger/10':'border-success/20 text-success hover:bg-success/10'}`}>
                        {d.status === 'active' ? 'DEACTIVATE' : 'ACTIVATE'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Register Device"
        footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button onClick={create}>Register</Button></>}>
        <div className="space-y-4">
          <Input label="Device Name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Tracker Unit 01" />
          <Input label="IMEI Number" value={form.imei} onChange={e => set('imei', e.target.value)} placeholder="15-digit IMEI" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="SIM Number"   value={form.sim_number}   onChange={e => set('sim_number', e.target.value)}   placeholder="SIM card number" />
            <Input label="Phone Number" value={form.phone_number} onChange={e => set('phone_number', e.target.value)} placeholder="+254..." />
          </div>
        </div>
      </Modal>
    </div>
  );
}
