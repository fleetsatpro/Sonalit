
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ArrowUp, Filter, RefreshCw, X, Bell } from 'lucide-react';
import { alertsAPI } from '../services/api';
import { Badge, Card, Button, Modal, Spinner, EmptyState } from '../components/UI';
import { timeAgo, truncate } from '../utils/helpers';

const SEVERITIES = ['all','critical','high','medium','low'];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isRefresh=false) => {
    if(isRefresh) setRefreshing(true);
    try {
      const p = filter !== 'all' ? { severity: filter, resolved: false } : { resolved: false };
      const r = await alertsAPI.list(p);
      setAlerts(r.data.data || []);
    } catch(e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const acknowledge = async (id) => {
    try {
      await alertsAPI.acknowledge(id);
      setAlerts(prev => prev.filter(a => a.id !== id));
      setSelected(null);
    } catch(e) { console.error(e); }
  };

  const escalate = async (id) => {
    try {
      await alertsAPI.update?.(id, { severity: 'critical', escalated: true });
      load(true);
      setSelected(null);
    } catch(e) { console.error(e); }
  };

  const sel = selected ? alerts.find(a => a.id === selected) : null;
  const counts = SEVERITIES.slice(1).reduce((acc, s) => ({ ...acc, [s]: alerts.filter(a=>a.severity===s).length }), {});

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Alert Center</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">{alerts.length} unresolved incidents</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 bg-navy-800/60 border border-white/[0.08] rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 transition-all">
          <RefreshCw size={12} className={refreshing?'animate-spin':''} /> REFRESH
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Critical',counts.critical||0,'text-red-400','bg-red-500/10 border-red-500/20'],['High',counts.high||0,'text-amber-400','bg-amber-500/10 border-amber-500/20'],['Medium',counts.medium||0,'text-blue-400','bg-blue-500/10 border-blue-500/20'],['Low',counts.low||0,'text-success','bg-success/10 border-success/20']].map(([l,v,c,bg])=>(
          <div key={l} className={`border rounded-xl p-4 ${bg}`}>
            <p className="text-[10px] font-mono text-slate-500 tracking-wider mb-1">{l.toUpperCase()}</p>
            <p className={`font-display text-3xl font-bold ${c}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-navy-800/60 p-1 rounded-lg border border-white/5 w-fit">
        {SEVERITIES.map(s=>(
          <button key={s} onClick={()=>setFilter(s)}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-all capitalize ${filter===s?'bg-gold text-navy-950 font-bold':'text-slate-500 hover:text-slate-300'}`}>
            {s==='all'?'All':s}
          </button>
        ))}
      </div>

      <Card>
        {loading ? <div className="flex items-center justify-center py-16"><Spinner /></div>
        : alerts.length === 0 ? <EmptyState icon={CheckCircle2} title="No active alerts" subtitle="All clear — no unresolved incidents" />
        : (
          <div className="divide-y divide-white/[0.04]">
            {alerts.map(a => (
              <div key={a.id} onClick={()=>setSelected(a.id)}
                className="px-5 py-4 flex items-start gap-4 hover:bg-white/[0.02] cursor-pointer transition-colors">
                <AlertTriangle size={14} className={`mt-0.5 flex-shrink-0 ${a.severity==='critical'?'text-red-400':a.severity==='high'?'text-amber-400':'text-blue-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge severity={a.severity} dot>{a.severity?.toUpperCase()}</Badge>
                    <span className="text-[10px] font-mono text-slate-500">{a.type}</span>
                  </div>
                  <p className="text-sm text-slate-300 leading-snug">{a.message}</p>
                  <p className="text-[10px] text-slate-600 font-mono mt-1">{timeAgo(a.created_at)}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={e=>{e.stopPropagation();acknowledge(a.id);}}
                    className="px-2.5 py-1 bg-success/10 border border-success/20 rounded-lg text-xs font-mono text-success hover:bg-success/20 transition-all">
                    ACK
                  </button>
                  <button onClick={e=>{e.stopPropagation();escalate(a.id);}}
                    className="px-2.5 py-1 bg-danger/10 border border-danger/20 rounded-lg text-xs font-mono text-danger hover:bg-danger/20 transition-all">
                    ESC
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!sel} onClose={()=>setSelected(null)} title="Alert Detail" size="md"
        footer={<>
          <Button variant="ghost" onClick={()=>setSelected(null)}>Close</Button>
          <Button variant="danger" onClick={()=>sel&&escalate(sel.id)}>Escalate</Button>
          <Button onClick={()=>sel&&acknowledge(sel.id)}>Acknowledge</Button>
        </>}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><Badge severity={sel.severity} dot>{sel.severity?.toUpperCase()}</Badge><span className="text-xs font-mono text-slate-500">{sel.type}</span></div>
            <p className="text-sm text-slate-300 leading-relaxed">{sel.message}</p>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              {sel.location && <div><span className="text-slate-500">Location: </span><span className="text-slate-300">{sel.location}</span></div>}
              {sel.vehicle_id && <div><span className="text-slate-500">Vehicle: </span><span className="text-slate-300">{sel.vehicle_id}</span></div>}
              <div><span className="text-slate-500">Created: </span><span className="text-slate-300">{timeAgo(sel.created_at)}</span></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
