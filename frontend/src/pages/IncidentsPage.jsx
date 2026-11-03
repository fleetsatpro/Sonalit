import { useEffect, useState, useCallback } from 'react';
import { Shield, Plus, X, AlertTriangle, Clock, MessageSquare, CheckCircle2, RefreshCw, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { incidentAPI } from '../services/api';
import { Badge, Spinner, EmptyState } from '../components/UI';
import { timeAgo, formatDate } from '../utils/helpers';

const STATUSES = ['open','assigned','investigating','resolved','closed'];
const STATUS_CONFIG = {
  open:          { color:'text-danger',    bg:'bg-danger/10',    border:'border-danger/20'    },
  assigned:      { color:'text-amber-400', bg:'bg-amber-400/10', border:'border-amber-400/20' },
  investigating: { color:'text-blue-400',  bg:'bg-blue-400/10',  border:'border-blue-400/20'  },
  resolved:      { color:'text-success',   bg:'bg-success/10',   border:'border-success/20'   },
  closed:        { color:'text-slate-500', bg:'bg-slate-500/10', border:'border-slate-500/20' },
};
const SEVERITY_CONFIG = {
  critical: 'text-danger',
  high:     'text-orange-400',
  medium:   'text-amber-400',
  low:      'text-slate-400',
};

export default function IncidentsPage() {
  const [incidents, setIncidents]   = useState([]);
  const [loading,   setLoading]     = useState(true);
  const [selected,  setSelected]    = useState(null);
  const [showForm,  setShowForm]    = useState(false);
  const [comment,   setComment]     = useState('');
  const [posting,   setPosting]     = useState(false);
  const [form, setForm] = useState({ title:'', description:'', severity:'medium', convoy_id:'', vehicle_id:'' });
  const [submitting, setSubmitting] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await incidentAPI.list({ limit: 50 });
      setIncidents(r.data.data || []);
    } catch { toast.error('Failed to load incidents'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.title) { toast.error('Title required'); return; }
    setSubmitting(true);
    try {
      const r = await incidentAPI.create(form);
      setIncidents(p => [r.data.data, ...p]);
      toast.success('Incident created');
      setShowForm(false);
      setForm({ title:'', description:'', severity:'medium', convoy_id:'', vehicle_id:'' });
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const updateStatus = async (id, status) => {
    try {
      await incidentAPI.update(id, { status });
      setIncidents(p => p.map(i => i.id === id ? { ...i, status } : i));
      if (selected?.id === id) setSelected(s => ({ ...s, status }));
      toast.success('Status updated');
    } catch { toast.error('Failed'); }
  };

  const postComment = async () => {
    if (!comment.trim() || !selected) return;
    setPosting(true);
    try {
      await incidentAPI.addComment(selected.id, comment);
      setComment('');
      toast.success('Comment added');
      const r = await incidentAPI.list({ limit: 50 });
      setIncidents(r.data.data || []);
    } catch { toast.error('Failed'); }
    finally { setPosting(false); }
  };

  const open_count = incidents.filter(i => i.status === 'open').length;
  const critical_count = incidents.filter(i => i.severity === 'critical').length;

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">INCIDENTS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">
            {open_count} open · {critical_count} critical
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="p-2.5 bg-navy-900 border border-white/10 rounded-xl text-slate-400 hover:text-gold transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowForm(f => !f)} className="btn-primary">
            {showForm ? <><X size={13} />CANCEL</> : <><Plus size={13} />NEW INCIDENT</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
        {STATUSES.map(s => {
          const count = incidents.filter(i => i.status === s).length;
          const sc = STATUS_CONFIG[s];
          return (
            <div key={s} className="bg-navy-900 border border-white/5 rounded-xl p-3 text-center">
              <p className={`font-display text-2xl font-bold ${sc.color}`}>{count}</p>
              <p className="text-[9px] font-mono text-slate-600 tracking-widest mt-1">{s.toUpperCase()}</p>
            </div>
          );
        })}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-navy-900 border border-white/[0.06] rounded-2xl p-5">
          <p className="section-label mb-4">CREATE INCIDENT</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="col-span-2 space-y-1">
              <label className="section-label">Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Incident title…"
                className="input-field" />
            </div>
            <div className="space-y-1">
              <label className="section-label">Severity</label>
              <select value={form.severity} onChange={e => set('severity', e.target.value)} className="input-field">
                {['low','medium','high','critical'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={submit} disabled={submitting} className="btn-primary w-full justify-center">
                {submitting ? 'CREATING…' : 'CREATE'}
              </button>
            </div>
            <div className="col-span-2 lg:col-span-4 space-y-1">
              <label className="section-label">Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="Describe the incident…" rows={3}
                className="input-field resize-none" />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-5">
        {/* Incident list */}
        <div className="flex-1 min-w-0">
          {loading ? <div className="flex justify-center py-20"><Spinner /></div>
            : incidents.length === 0 ? (
              <EmptyState icon={Shield} title="No incidents" subtitle="Create an incident to start tracking" />
            ) : (
              <div className="space-y-2">
                {incidents.map(inc => {
                  const sc = STATUS_CONFIG[inc.status] || STATUS_CONFIG.open;
                  const isSelected = selected?.id === inc.id;
                  return (
                    <div key={inc.id} onClick={() => setSelected(isSelected ? null : inc)}
                      className={`bg-navy-900 border rounded-xl p-4 cursor-pointer hover:border-white/10 transition-all
                        ${isSelected ? 'border-gold/25 ring-1 ring-gold/10' : 'border-white/[0.06]'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.border} ${sc.color}`}>
                              {inc.status?.toUpperCase()}
                            </span>
                            <span className={`text-[10px] font-mono font-bold ${SEVERITY_CONFIG[inc.severity] || 'text-slate-400'}`}>
                              {inc.severity?.toUpperCase()}
                            </span>
                          </div>
                          <p className="font-semibold text-slate-200 text-sm leading-snug">{inc.title}</p>
                          {inc.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{inc.description}</p>}
                        </div>
                        <p className="text-[10px] font-mono text-slate-600 flex-shrink-0">{timeAgo(inc.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 flex-shrink-0 bg-navy-900 border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col" style={{maxHeight:'calc(100vh - 160px)'}}>
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <p className="font-mono font-bold text-sm text-slate-200 truncate">{selected.title}</p>
              <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-white p-1 rounded-lg hover:bg-white/5">
                <X size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Details */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Severity', selected.severity?.toUpperCase()],
                  ['Status', selected.status?.toUpperCase()],
                  ['Created', timeAgo(selected.created_at)],
                  ['Updated', timeAgo(selected.updated_at)],
                ].map(([l,v]) => (
                  <div key={l} className="bg-navy-800 rounded-lg p-2 border border-white/5">
                    <p className="text-[9px] font-mono text-slate-600">{l}</p>
                    <p className="text-xs text-slate-300 font-bold mt-0.5">{v || '—'}</p>
                  </div>
                ))}
              </div>

              {selected.description && (
                <div className="bg-navy-800 rounded-xl p-3 border border-white/5">
                  <p className="text-[9px] font-mono text-slate-500 mb-1">DESCRIPTION</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{selected.description}</p>
                </div>
              )}

              {/* Status transitions */}
              <div>
                <p className="section-label mb-2">UPDATE STATUS</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {STATUSES.filter(s => s !== selected.status).map(s => {
                    const sc = STATUS_CONFIG[s];
                    return (
                      <button key={s} onClick={() => updateStatus(selected.id, s)}
                        className={`py-2 text-[9px] font-mono font-bold border rounded-lg transition-colors ${sc.bg} ${sc.border} ${sc.color} hover:opacity-80`}>
                        → {s.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Comment */}
              <div>
                <p className="section-label mb-2">ADD COMMENT</p>
                <textarea value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="Add an update…" rows={3}
                  className="input-field resize-none text-xs mb-2" />
                <button onClick={postComment} disabled={!comment.trim() || posting}
                  className="btn-primary w-full justify-center text-xs">
                  {posting ? 'POSTING…' : 'POST COMMENT'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
