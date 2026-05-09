import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, ChevronRight, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConvoyStore } from '../store';
import { convoysAPI } from '../services/api';
import { Badge, Button, Card, Modal, Input, Select, ConfirmDialog, Spinner, EmptyState } from '../components/UI';
import { formatDate, priorityColor, truncate } from '../utils/helpers';

const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const COLUMNS = ['planned', 'active', 'completed', 'aborted'];
const TRANSITIONS = { planned: ['active'], active: ['completed', 'aborted'], completed: [], aborted: [] };

const schema = z.object({
  name: z.string().min(3).max(100),
  region: z.string().min(1),
  priority: z.string().min(1),
  routeOrigin: z.string().min(2).max(100),
  routeDestination: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  estimatedArrival: z.string().optional(),
});

function ConvoyModal({ open, onClose, onSaved }) {
  const { register, handleSubmit, formState: { errors }, reset } = useForm({ resolver: zodResolver(schema) });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) reset({}); }, [open]);

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      await convoysAPI.create({ ...data, estimatedArrival: data.estimatedArrival || undefined });
      toast.success('Convoy created');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Create failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Convoy" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={handleSubmit(onSubmit)}>Create Convoy</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><Input label="Mission Name" placeholder="Operation Alpha" error={errors.name?.message} {...register('name')} /></div>
        <Select label="Region" error={errors.region?.message} {...register('region')}>
          <option value="">Select region…</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select label="Priority" error={errors.priority?.message} {...register('priority')}>
          <option value="">Select priority…</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </Select>
        <Input label="Route Origin" placeholder="Nairobi" error={errors.routeOrigin?.message} {...register('routeOrigin')} />
        <Input label="Route Destination" placeholder="Mombasa" error={errors.routeDestination?.message} {...register('routeDestination')} />
        <div className="col-span-2">
          <Input label="Estimated Arrival (optional)" type="datetime-local" {...register('estimatedArrival')} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-widest mb-1.5">Description (optional)</label>
          <textarea rows={2} placeholder="Mission details…" {...register('description')}
            className="w-full bg-navy-800 border border-white/10 focus:border-gold/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none resize-none transition-colors" />
        </div>
      </div>
    </Modal>
  );
}

function ConvoyCard({ convoy, onStatusChange, onDelete }) {
  const [eventsOpen, setEventsOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const nextStatuses = TRANSITIONS[convoy.status] || [];
  const dot = { planned: 'bg-blue-400', active: 'bg-success', completed: 'bg-slate-500', aborted: 'bg-danger' };

  const loadEvents = async () => {
    const r = await convoysAPI.events(convoy.id);
    setEvents(r.data.data);
    setEventsOpen(true);
  };

  return (
    <>
      <div className="bg-navy-800 border border-white/5 hover:border-white/10 rounded-xl p-4 space-y-3 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot[convoy.status]}`} />
            <p className="text-sm font-medium text-slate-100 leading-tight">{convoy.name}</p>
          </div>
          <div className="flex gap-1">
            <button onClick={loadEvents} className="p-1 text-slate-600 hover:text-slate-300 transition-colors" title="Timeline"><ChevronRight size={13} /></button>
            {convoy.status === 'planned' && (
              <button onClick={() => onDelete(convoy)} className="p-1 text-slate-600 hover:text-danger transition-colors" title="Delete"><Trash2 size={13} /></button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{convoy.region}</span>
            <span className="font-mono" style={{ color: priorityColor(convoy.priority) }}>{convoy.priority}</span>
          </div>
          <p className="text-xs text-slate-500 font-mono">{convoy.route_origin} → {convoy.route_destination}</p>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Users size={11} />
            <span>{convoy.vehicle_count ?? 0} vehicles</span>
          </div>
          {convoy.description && <p className="text-xs text-slate-600 leading-snug">{truncate(convoy.description, 70)}</p>}
        </div>

        {nextStatuses.length > 0 && (
          <div className="flex gap-1.5 pt-1">
            {nextStatuses.map((s) => (
              <button key={s} onClick={() => onStatusChange(convoy.id, s)}
                className={`flex-1 text-xs py-1 rounded-md border font-medium transition-colors
                  ${s === 'active' ? 'border-success/30 text-success hover:bg-success/10' : ''}
                  ${s === 'completed' ? 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10' : ''}
                  ${s === 'aborted' ? 'border-danger/30 text-danger hover:bg-danger/10' : ''}`}>
                → {s}
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-700 font-mono">{formatDate(convoy.created_at, { day: '2-digit', month: 'short' })}</p>
      </div>

      <Modal open={eventsOpen} onClose={() => setEventsOpen(false)} title={`Timeline — ${convoy.name}`} size="lg"
        footer={<Button variant="ghost" onClick={() => setEventsOpen(false)}>Close</Button>}>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {events.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No events recorded</p>}
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-3 items-start p-3 bg-navy-800 rounded-lg">
              <Badge severity={ev.severity}>{ev.severity}</Badge>
              <div>
                <p className="text-xs text-slate-300">{ev.message || ev.type}</p>
                <p className="text-[10px] text-slate-600 font-mono mt-0.5">{formatDate(ev.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

export default function ConvoysPage() {
  const { convoys, loading, fetchConvoys, updateStatus, deleteConvoy } = useConvoyStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => { fetchConvoys({ limit: 50 }); }, []);

  const handleStatusChange = async (id, status) => {
    try {
      await updateStatus(id, status);
      toast.success(`Convoy → ${status}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Status update failed');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteConvoy(deleteTarget.id);
      toast.success('Convoy removed');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    }
  };

  if (loading) return <div className="flex justify-center pt-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">CONVOY OPERATIONS</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{convoys.length} missions loaded</p>
        </div>
        <Button onClick={() => setModalOpen(true)}><Plus size={15} /> New Convoy</Button>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const cards = convoys.filter((c) => c.status === col);
          const colStyle = { planned: 'border-blue-500/20 bg-blue-500/5', active: 'border-success/20 bg-success/5', completed: 'border-slate-500/20 bg-slate-800/30', aborted: 'border-danger/20 bg-danger/5' };
          return (
            <div key={col} className={`rounded-xl border ${colStyle[col]} p-3`}>
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-xs font-mono uppercase tracking-widest text-slate-400">{col}</p>
                <span className="text-xs font-mono bg-navy-900 px-2 py-0.5 rounded-full text-slate-500">{cards.length}</span>
              </div>
              <div className="space-y-3">
                {cards.map((c) => (
                  <ConvoyCard key={c.id} convoy={c} onStatusChange={handleStatusChange} onDelete={setDeleteTarget} />
                ))}
                {cards.length === 0 && (
                  <p className="text-center text-xs text-slate-700 py-6 font-mono">— empty —</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConvoyModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={() => fetchConvoys({ limit: 50 })} />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title="Delete Convoy" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} confirmLabel="Delete" danger />
    </div>
  );
}
