
import { useEffect, useState } from 'react';
import { Shield, Plus, Clock, CheckCircle2, AlertTriangle, User } from 'lucide-react';
import { incidentAPI } from '../services/api';
import { Badge, Card, Button, Modal, Input, Select, Spinner, EmptyState } from '../components/UI';
import { timeAgo } from '../utils/helpers';

const STATUSES = ['open','assigned','investigating','resolved','closed'];
const STATUS_COLOR = { open:'text-danger', assigned:'text-amber-400', investigating:'text-blue-400', resolved:'text-success', closed:'text-slate-500' };

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [form, setForm] = useState({ title:'', description:'', severity:'medium', linked_vehicle:'' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const load = async () => {
    try { const r = await incidentAPI.list({}); setIncidents(r.data.data||[]); }
    catch(e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(()=>{ load(); },[]);

  const create = async () => {
    try { await incidentAPI.create(form); setModal(false); setForm({title:'',description:'',severity:'medium',linked_vehicle:''}); load(); }
    catch(e) { console.error(e); }
  };

  const updateStatus = async (id, status) => {
    try { await incidentAPI.update(id, { status }); load(); }
    catch(e) { console.error(e); }
  };

  const addComment = async () => {
    if (!comment.trim() || !selected) return;
    try { await incidentAPI.addComment(selected.id, comment); setComment(''); load(); }
    catch(e) { console.error(e); }
  };

  const sel = selected ? incidents.find(i=>i.id===selected.id) : null;

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Incident Management</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{incidents.filter(i=>i.status==='open').length} open incidents</p>
        </div>
        <Button onClick={()=>setModal(true)}><Plus size={14}/> New Incident</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {STATUSES.map(s=>(
          <div key={s} className="bg-navy-900 border border-white/5 rounded-xl p-4">
            <p className="text-[10px] font-mono text-slate-500 tracking-wider mb-1">{s.toUpperCase()}</p>
            <p className={`font-display text-2xl font-bold ${STATUS_COLOR[s]}`}>{incidents.filter(i=>i.status===s).length}</p>
          </div>
        ))}
      </div>

      <Card>
        {loading ? <div className="flex items-center justify-center py-16"><Spinner/></div>
        : incidents.length===0 ? <EmptyState icon={Shield} title="No incidents" subtitle="Create one to get started"/>
        : <div className="divide-y divide-white/[0.04]">
            {incidents.map(i=>(
              <div key={i.id} onClick={()=>setSelected(i)} className="px-5 py-4 flex items-start gap-4 hover:bg-white/[0.02] cursor-pointer transition-colors">
                <AlertTriangle size={14} className={`mt-0.5 flex-shrink-0 ${i.severity==='critical'?'text-red-400':'text-amber-400'}`}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-200">{i.title}</span>
                    <Badge severity={i.severity}>{i.severity}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">{i.description}</p>
                  <p className="text-[10px] text-slate-600 font-mono mt-1">{timeAgo(i.created_at)}</p>
                </div>
                <span className={`text-xs font-mono font-bold ${STATUS_COLOR[i.status]||'text-slate-400'}`}>{i.status?.toUpperCase()}</span>
              </div>
            ))}
          </div>}
      </Card>

      <Modal open={modal} onClose={()=>setModal(false)} title="Create Incident"
        footer={<><Button variant="ghost" onClick={()=>setModal(false)}>Cancel</Button><Button onClick={create}>Create</Button></>}>
        <div className="space-y-4">
          <Input label="Title" value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Brief incident title"/>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Severity" value={form.severity} onChange={e=>set('severity',e.target.value)}>
              {['low','medium','high','critical'].map(s=><option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Vehicle (optional)" value={form.linked_vehicle} onChange={e=>set('linked_vehicle',e.target.value)} placeholder="Vehicle ID"/>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Description</label>
            <textarea rows={3} value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Describe the incident..." className="bg-navy-800 border border-white/10 focus:border-gold/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors resize-none"/>
          </div>
        </div>
      </Modal>

      <Modal open={!!selected} onClose={()=>setSelected(null)} title={sel?.title||''} size="lg"
        footer={<Button variant="ghost" onClick={()=>setSelected(null)}>Close</Button>}>
        {sel && <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map(s=><button key={s} onClick={()=>updateStatus(sel.id,s)}
              className={`px-3 py-1 text-xs font-mono rounded-lg border transition-all ${sel.status===s?'bg-gold/10 border-gold/30 text-gold':'border-white/5 text-slate-500 hover:border-white/10'}`}>{s.toUpperCase()}</button>)}
          </div>
          <p className="text-sm text-slate-300">{sel.description}</p>
          <div className="border-t border-white/5 pt-4">
            <p className="text-xs font-mono text-slate-500 mb-3">ADD COMMENT</p>
            <div className="flex gap-2">
              <input value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a note..." className="flex-1 bg-navy-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-gold/50"/>
              <Button size="sm" onClick={addComment}>Post</Button>
            </div>
          </div>
        </div>}
      </Modal>
    </div>
  );
}
