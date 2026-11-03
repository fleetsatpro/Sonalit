
import { useEffect, useState } from 'react';
import { Zap, Plus, Trash2 } from 'lucide-react';
import { ruleAPI } from '../services/api';
import { Card, Button, Modal, Input, Select, Spinner, EmptyState } from '../components/UI';

const CONDITIONS = ['geofence_breach','overspeed','underspeed','device_offline','no_movement','excessive_idle','sos_pressed','low_battery','route_deviation'];
const ACTIONS    = ['notify_user','send_email','create_incident','escalate_severity','send_webhook'];

export default function RulesPage() {
  const [rules,   setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [form, setForm] = useState({ name:'', condition:'overspeed', action:'notify_user', enabled:true, priority:'medium', cooldown_minutes:15 });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const load = async () => {
    try { const r = await ruleAPI.list(); setRules(r.data.data || []); }
    catch (e) { setRules([]); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    try { await ruleAPI.create(form); setModal(false); load(); }
    catch (e) { console.error(e); }
  };

  const toggle = async (id, enabled) => {
    try { await ruleAPI.toggle(id, !enabled); load(); }
    catch (e) { console.error(e); }
  };

  const remove = async (id) => {
    try { await ruleAPI.delete(id); load(); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Automation Rules</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">IF condition → THEN action &nbsp;·&nbsp; {rules.filter(r => r.enabled).length} active</p>
        </div>
        <Button onClick={() => setModal(true)}><Plus size={14} /> New Rule</Button>
      </div>

      <Card>
        {loading
          ? <div className="flex items-center justify-center py-16"><Spinner /></div>
          : rules.length === 0
            ? <EmptyState icon={Zap} title="No automation rules" subtitle="Create rules to automate alerts and actions"
                action={<Button size="sm" onClick={() => setModal(true)}>Create Rule</Button>} />
            : (
              <div className="divide-y divide-white/[0.04]">
                {rules.map(r => (
                  <div key={r.id} className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                    <div className={`w-2 h-10 rounded-full flex-shrink-0 ${r.enabled ? 'bg-success' : 'bg-slate-700'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 mb-1">{r.name}</p>
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded">IF {r.condition?.replace(/_/g,' ')}</span>
                        <span className="text-slate-600">→</span>
                        <span className="px-2 py-0.5 bg-gold/10 border border-gold/20 text-gold rounded">THEN {r.action?.replace(/_/g,' ')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500">cooldown: {r.cooldown_minutes || 15}m</span>
                      <button onClick={() => toggle(r.id, r.enabled)}
                        className={`px-2.5 py-1 text-xs font-mono rounded-lg border transition-all ${r.enabled?'border-success/20 text-success bg-success/5':'border-slate-700 text-slate-500'}`}>
                        {r.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-slate-600 hover:text-danger transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Create Automation Rule"
        footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button onClick={create}>Create Rule</Button></>}>
        <div className="space-y-4">
          <Input label="Rule Name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Alert on overspeed" />
          <div className="grid grid-cols-2 gap-3">
            <Select label="IF (Condition)" value={form.condition} onChange={e => set('condition', e.target.value)}>
              {CONDITIONS.map(c => <option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
            </Select>
            <Select label="THEN (Action)" value={form.action} onChange={e => set('action', e.target.value)}>
              {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g,' ')}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Priority" value={form.priority} onChange={e => set('priority', e.target.value)}>
              {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Input label="Cooldown (minutes)" type="number" value={form.cooldown_minutes} onChange={e => set('cooldown_minutes', e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
