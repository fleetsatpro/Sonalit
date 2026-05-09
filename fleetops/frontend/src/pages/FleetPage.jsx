import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search, Pencil, Trash2, History, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useVehicleStore } from '../store';
import { vehiclesAPI } from '../services/api';
import { Card, Badge, Button, Modal, ConfirmDialog, Input, Select, Spinner, EmptyState } from '../components/UI';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatDate, timeAgo } from '../utils/helpers';
import { useDebounce } from '../hooks';

const TYPES   = ['SUV', 'Truck', 'APC', 'Motorcycle', 'Van'];
const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];
const STATUSES = ['idle', 'active', 'maintenance', 'offline'];

const schema = z.object({
  type: z.string().min(1, 'Select a type'),
  registration: z.string().min(3).max(20),
  region: z.string().min(1, 'Select a region'),
  capacity: z.coerce.number().int().min(1).max(50),
});

function VehicleModal({ open, onClose, vehicle, onSaved }) {
  const { register, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: vehicle ?? {},
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { reset(vehicle ?? {}); }, [vehicle, open]);

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (vehicle) {
        await vehiclesAPI.update(vehicle.id, data);
        toast.success('Vehicle updated');
      } else {
        await vehiclesAPI.create(data);
        toast.success('Vehicle created');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={vehicle ? 'Edit Vehicle' : 'Add Vehicle'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={handleSubmit(onSubmit)}>{vehicle ? 'Save' : 'Create'}</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Type" error={errors.type?.message} {...register('type')}>
          <option value="">Select type…</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input label="Registration" placeholder="KEN-001" error={errors.registration?.message} {...register('registration')} />
        <Select label="Region" error={errors.region?.message} {...register('region')}>
          <option value="">Select region…</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Input label="Capacity" type="number" min={1} max={50} error={errors.capacity?.message} {...register('capacity')} />
      </div>
    </Modal>
  );
}

function HistoryModal({ vehicleId, registration, open, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !vehicleId) return;
    setLoading(true);
    vehiclesAPI.history(vehicleId)
      .then((r) => setHistory(r.data.data))
      .catch(() => toast.error('Failed to load history'))
      .finally(() => setLoading(false));
  }, [open, vehicleId]);

  const chartData = history.slice(0, 30).reverse().map((p, i) => ({
    t: i + 1,
    speed: parseFloat(p.speed) || 0,
  }));

  return (
    <Modal open={open} onClose={onClose} title={`GPS History — ${registration}`} size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <>
          {chartData.length > 0 && (
            <div className="mb-5">
              <p className="text-xs text-slate-500 font-mono mb-3 uppercase tracking-wider">Speed (last {chartData.length} pings)</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="t" hide />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" km/h" />
                  <Tooltip contentStyle={{ background: '#0D1321', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 11, color: '#e2e8f0' }} />
                  <Line type="monotone" dataKey="speed" stroke="#F0B429" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/5 text-slate-500 font-mono">
                <th className="text-left py-2 pr-4">Timestamp</th>
                <th className="text-left py-2 pr-4">Lat</th>
                <th className="text-left py-2 pr-4">Lng</th>
                <th className="text-left py-2">Speed</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {history.map((p, i) => (
                  <tr key={i} className="text-slate-300 hover:bg-white/2">
                    <td className="py-1.5 pr-4 font-mono text-slate-500">{formatDate(p.timestamp)}</td>
                    <td className="py-1.5 pr-4 font-mono">{parseFloat(p.lat).toFixed(5)}</td>
                    <td className="py-1.5 pr-4 font-mono">{parseFloat(p.lng).toFixed(5)}</td>
                    <td className={`py-1.5 font-mono ${parseFloat(p.speed) > 120 ? 'text-danger' : 'text-slate-300'}`}>{parseFloat(p.speed).toFixed(1)} km/h</td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-600">No GPS data recorded</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function FleetPage() {
  const { vehicles, pagination, loading, fetchVehicles, deleteVehicle } = useVehicleStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editVehicle, setEditVehicle] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const debouncedSearch = useDebounce(search, 400);

  const load = (p = page) => {
    fetchVehicles({ page: p, limit: 15, status: statusFilter || undefined, region: regionFilter || undefined });
  };

  useEffect(() => { load(1); setPage(1); }, [debouncedSearch, statusFilter, regionFilter]);

  const handleDelete = async () => {
    try {
      await deleteVehicle(deleteTarget.id);
      toast.success('Vehicle removed');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-gold tracking-widest">FLEET MANAGEMENT</h1>
          <p className="text-slate-500 text-sm font-mono mt-0.5">{pagination?.totalCount ?? '…'} vehicles registered</p>
        </div>
        <Button onClick={() => { setEditVehicle(null); setModalOpen(true); }}>
          <Plus size={15} /> Add Vehicle
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search registration…"
            className="w-full bg-navy-900 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-gold/40 transition-colors" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-gold/40 transition-colors">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
          className="bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-gold/40 transition-colors">
          <option value="">All regions</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : vehicles.length === 0 ? (
          <EmptyState icon={Search} title="No vehicles found" subtitle="Try adjusting your filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/5 text-slate-500 text-xs font-mono uppercase tracking-wider">
                {['Registration', 'Type', 'Region', 'Status', 'Driver', 'Last Ping', ''].map((h) => (
                  <th key={h} className="text-left px-5 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {vehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-white/2 transition-colors group">
                    <td className="px-5 py-3 font-mono text-slate-200 font-medium">{v.registration}</td>
                    <td className="px-5 py-3 text-slate-400">{v.type}</td>
                    <td className="px-5 py-3 text-slate-400">{v.region}</td>
                    <td className="px-5 py-3"><Badge status={v.status}>{v.status}</Badge></td>
                    <td className="px-5 py-3 text-slate-400">{v.driver_name ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-xs whitespace-nowrap">{timeAgo(v.last_ping)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setHistoryTarget(v)} className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-success" title="GPS History"><History size={13} /></button>
                        <button onClick={() => { setEditVehicle(v); setModalOpen(true); }} className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-gold" title="Edit"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteTarget(v)} className="p-1.5 rounded hover:bg-danger/10 text-slate-500 hover:text-danger" title="Delete"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
            <span className="text-xs text-slate-500 font-mono">
              Page {pagination.page} of {pagination.totalPages} · {pagination.totalCount} total
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1); }}>
                <ChevronLeft size={14} />
              </Button>
              <Button variant="ghost" size="sm" disabled={page >= pagination.totalPages} onClick={() => { setPage(page + 1); load(page + 1); }}>
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <VehicleModal open={modalOpen} onClose={() => setModalOpen(false)} vehicle={editVehicle} onSaved={() => load()} />
      <HistoryModal vehicleId={historyTarget?.id} registration={historyTarget?.registration} open={!!historyTarget} onClose={() => setHistoryTarget(null)} />
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title="Remove Vehicle" message={`Permanently remove ${deleteTarget?.registration}? This action cannot be undone.`}
        confirmLabel="Remove" danger />
    </div>
  );
}
