import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Route, Plus, X, ChevronRight, Shield, FileText, AlertTriangle, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConvoyStore } from '../store';
import { convoysAPI, documentsAPI } from '../services/api';
import api from '../services/api';
import { Card, Button, Input, Spinner, EmptyState } from '../components/UI';
import { formatDate } from '../utils/helpers';

const convoySchema = z.object({
  name: z.string().min(3, 'Min 3 characters'),
  region: z.string().min(1, 'Required'),
  priority: z.enum(['low','medium','high','critical']),
  route_origin: z.string().min(1, 'Required'),
  route_destination: z.string().min(1, 'Required'),
  description: z.string().optional(),
  departure_time: z.string().optional(),
});

const REGIONS = ['Kenya','Tanzania','DRC','Mali','Nigeria','Ethiopia'];
const STATUS_COLS = ['planned','active','completed','aborted'];

const statusColors = {
  planned:   'border-slate-600/30 bg-slate-800/20',
  active:    'border-success/30 bg-success/5',
  completed: 'border-blue-500/30 bg-blue-500/5',
  aborted:   'border-danger/30 bg-danger/5',
};

const priorityColors = {
  low:      'text-slate-400',
  medium:   'text-blue-400',
  high:     'text-amber-400',
  critical: 'text-danger',
};

const riskColors = {
  LOW:      'text-success bg-success/10 border-success/20',
  MEDIUM:   'text-amber-400 bg-amber-400/10 border-amber-400/20',
  HIGH:     'text-orange-400 bg-orange-400/10 border-orange-400/20',
  CRITICAL: 'text-danger bg-danger/10 border-danger/20',
};

function RiskBadge({ convoyId }) {
  const [risk, setRisk] = useState(null);
  useEffect(() => {
    api.get(`/ai/risk/${convoyId}`)
      .then(r => setRisk(r.data.data))
      .catch(() => {});
  }, [convoyId]);
  if (!risk) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${riskColors[risk.level] || riskColors.LOW}`}>
      <Shield size={9} />
      {risk.level}
    </span>
  );
}

function ConvoyCard({ convoy, onSelect, selected, onStatusChange }) {
  return (
    <div
      onClick={() => onSelect(convoy)}
      className={`bg-navy-900 border rounded-xl p-4 cursor-pointer transition-all hover:border-white/10 mb-3
        ${selected ? 'border-gold/30 bg-gold/5' : 'border-white/[0.04]'}`}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-slate-200">{convoy.name}</p>
        <span className={`text-[10px] font-mono font-bold ${priorityColors[convoy.priority]}`}>
          {convoy.priority?.toUpperCase()}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-2">{convoy.route_origin} → {convoy.route_destination}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-600">{convoy.region}</span>
        <RiskBadge convoyId={convoy.id} />
      </div>
      {convoy.vehicle_count > 0 && (
        <p className="text-[10px] text-slate-600 mt-1.5">
          <Activity size={9} className="inline mr-1" />{convoy.vehicle_count} vehicle{convoy.vehicle_count !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

export default function ConvoysPage() {
  const { convoys, loading, fetchConvoys, createConvoy } = useConvoyStore();
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(convoySchema),
    defaultValues: { priority: 'medium' },
  });

  useEffect(() => { fetchConvoys(); }, []);

  useEffect(() => {
    if (!selected || activeTab !== 'documents') return;
    setDocsLoading(true);
    documentsAPI.list({ convoy_id: selected.id })
      .then(r => setDocuments(r.data.data || []))
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, [selected?.id, activeTab]);

  const onSubmit = async (data) => {
    try {
      await createConvoy(data);
      toast.success('Convoy created');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const changeStatus = async (id, status) => {
    try {
      await convoysAPI.updateStatus(id, status);
      toast.success(`Status → ${status}`);
      fetchConvoys();
      if (selected?.id === id) setSelected(prev => ({ ...prev, status }));
    } catch { toast.error('Update failed'); }
  };

  const byStatus = (status) => convoys.filter(c => c.status === status);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">CONVOY OPERATIONS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{convoys.length} mission{convoys.length !== 1 ? 's' : ''} loaded</p>
        </div>
        <Button onClick={() => setShowForm(f => !f)}>
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? 'Cancel' : '+ New Convoy'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <div className="p-5">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-4">Create Convoy</p>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="Convoy Name *" placeholder="Operation Alpha" {...register('name')} error={errors.name?.message} />
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Region *</label>
                <select {...register('region')} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                  <option value="">Select</option>
                  {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Priority *</label>
                <select {...register('priority')} className="w-full bg-navy-800 border border-white/10 focus:border-gold/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 outline-none">
                  {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <Input label="Origin *" placeholder="Nairobi" {...register('route_origin')} error={errors.route_origin?.message} />
              <Input label="Destination *" placeholder="Mombasa" {...register('route_destination')} error={errors.route_destination?.message} />
              <Input label="Departure time" type="datetime-local" {...register('departure_time')} />
              <div className="sm:col-span-2 lg:col-span-3">
                <Input label="Description" placeholder="Mission briefing..." {...register('description')} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <Button type="submit" loading={isSubmitting}><Route size={14} />Create Convoy</Button>
              </div>
            </form>
          </div>
        </Card>
      )}

      <div className="flex gap-5">
        {/* Kanban board */}
        <div className="flex-1 grid grid-cols-2 xl:grid-cols-4 gap-4 min-w-0">
          {STATUS_COLS.map(status => (
            <div key={status} className={`border rounded-xl p-3 ${statusColors[status]}`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono font-bold text-slate-400 tracking-widest">{status.toUpperCase()}</p>
                <span className="text-[10px] font-mono text-slate-600">{byStatus(status).length}</span>
              </div>
              {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : byStatus(status).length === 0 ? (
                <p className="text-center text-[10px] text-slate-700 py-6">— empty —</p>
              ) : (
                byStatus(status).map(c => (
                  <ConvoyCard key={c.id} convoy={c} onSelect={setSelected} selected={selected?.id === c.id} onStatusChange={changeStatus} />
                ))
              )}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 flex-shrink-0">
            <Card>
              <div className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <p className="font-bold text-gold">{selected.name}</p>
                  <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-white"><X size={14} /></button>
                </div>
                <p className="text-xs text-slate-500 mb-4">{selected.route_origin} → {selected.route_destination}</p>

                {/* Tabs */}
                <div className="flex gap-1 bg-navy-800 rounded-lg p-1 mb-4">
                  {['details','documents'].map(t => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`flex-1 py-1.5 text-[10px] font-mono font-bold rounded-md transition-colors
                        ${activeTab === t ? 'bg-gold/10 text-gold' : 'text-slate-500 hover:text-slate-300'}`}>
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>

                {activeTab === 'details' && (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="text-slate-200 capitalize">{selected.status}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Priority</span><span className={priorityColors[selected.priority]}>{selected.priority?.toUpperCase()}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Region</span><span className="text-slate-200">{selected.region}</span></div>
                    {selected.departure_time && <div className="flex justify-between"><span className="text-slate-500">Departure</span><span className="text-slate-200">{formatDate(selected.departure_time)}</span></div>}
                    <div className="flex justify-between items-center"><span className="text-slate-500">Risk</span><RiskBadge convoyId={selected.id} /></div>

                    {/* Status transitions */}
                    <div className="pt-3 border-t border-white/5">
                      <p className="text-[10px] font-mono text-slate-600 mb-2">CHANGE STATUS</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {STATUS_COLS.filter(s => s !== selected.status).map(s => (
                          <button key={s} onClick={() => changeStatus(selected.id, s)}
                            className="py-1.5 text-[10px] font-mono border border-white/5 hover:border-white/10 text-slate-500 hover:text-slate-300 rounded-lg transition-colors">
                            → {s.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'documents' && (
                  <div className="space-y-3">
                    {docsLoading ? <div className="flex justify-center py-4"><Spinner /></div>
                      : documents.length === 0
                        ? <p className="text-xs text-slate-600 text-center py-4">No documents</p>
                        : documents.map(d => (
                          <div key={d.id} className="flex items-center gap-2.5 p-2.5 bg-navy-800 rounded-lg border border-white/5">
                            <FileText size={13} className="text-slate-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-slate-300 truncate">{d.title}</p>
                              <p className="text-[10px] text-slate-600">{d.type?.replace(/_/g, ' ')}</p>
                            </div>
                            {d.valid_until && new Date(d.valid_until) < new Date(Date.now() + 7*24*3600000) && (
                              <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                            )}
                          </div>
                        ))
                    }
                    <button
                      onClick={async () => {
                        try {
                          await documentsAPI.create({ convoy_id: selected.id, type: 'manifest', title: `Manifest — ${selected.name}` });
                          toast.success('Document added');
                          setActiveTab('documents');
                        } catch { toast.error('Failed'); }
                      }}
                      className="w-full py-2 text-xs border border-dashed border-white/10 hover:border-white/20 text-slate-600 hover:text-slate-400 rounded-lg transition-colors">
                      + Add Document
                    </button>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
