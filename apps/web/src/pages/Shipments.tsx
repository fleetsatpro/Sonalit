import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Package, Plus, X, ChevronLeft, ChevronRight, Snowflake, Skull, Gauge, Clock3, CheckCircle2, XCircle } from 'lucide-react';

type ShipmentStatus = 'pending' | 'picked_up' | 'in_transit' | 'at_checkpoint' | 'delivered' | 'failed' | 'returned';
type Priority = 'standard' | 'express' | 'critical' | 'hazmat' | 'cold_chain';

interface Shipment {
  id: string;
  tracking_number: string;
  customer_name: string;
  origin_address: string;
  destination_address: string;
  status: ShipmentStatus;
  priority: Priority;
  vehicle_reg: string | null;
  driver_name: string | null;
  cargo_description: string | null;
  is_hazmat: boolean;
  requires_temp_control: boolean;
  scheduled_delivery: string | null;
  created_at: string;
}

interface Summary {
  total: string;
  in_transit: string;
  delivered: string;
  pending: string;
  failed: string;
  critical: string;
  avg_delay_hours: string | null;
}

interface PaginatedResponse<T> { data: T[]; total: number }

const STATUS_BADGES: Record<ShipmentStatus, string> = {
  pending: 'bg-slate-600 text-slate-200',
  picked_up: 'bg-indigo-700 text-indigo-100',
  in_transit: 'bg-blue-700 text-blue-100',
  at_checkpoint: 'bg-purple-700 text-purple-100',
  delivered: 'bg-green-700 text-green-100',
  failed: 'bg-red-700 text-red-100',
  returned: 'bg-orange-800 text-orange-100',
};

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Pending',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  at_checkpoint: 'At Checkpoint',
  delivered: 'Delivered',
  failed: 'Failed',
  returned: 'Returned',
};

const NEXT_STATUSES: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending: ['picked_up', 'failed'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['at_checkpoint', 'delivered', 'failed'],
  at_checkpoint: ['in_transit', 'delivered', 'failed'],
  delivered: [],
  failed: ['returned'],
  returned: [],
};

const PRIORITY_BADGES: Record<Priority, string> = {
  standard: 'text-slate-400',
  express: 'text-yellow-400',
  critical: 'text-red-400',
  hazmat: 'text-orange-400',
  cold_chain: 'text-cyan-400',
};

interface CreateShipmentPayload {
  customer_name: string;
  customer_ref?: string;
  origin_address: string;
  destination_address: string;
  cargo_description?: string;
  cargo_weight_kg?: number;
  priority: Priority;
  vehicle_id?: string;
  scheduled_pickup?: string;
  scheduled_delivery?: string;
  is_hazmat?: boolean;
  hazmat_class?: string;
  requires_temp_control?: boolean;
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateShipmentPayload>({
    customer_name: '', customer_ref: '', origin_address: '', destination_address: '',
    cargo_description: '', priority: 'standard', vehicle_id: '',
    scheduled_pickup: '', scheduled_delivery: '', is_hazmat: false, hazmat_class: '', requires_temp_control: false,
  });

  const vehiclesQ = useQuery<{ data: { id: string; registration: string }[] }>({
    queryKey: ['vehicles-lite'],
    queryFn: () => api.get('/vehicles?limit=200').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateShipmentPayload) => api.post('/shipments', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['shipments-summary'] });
      onClose();
    },
  });

  const set = <K extends keyof CreateShipmentPayload>(key: K, value: CreateShipmentPayload[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">New Shipment</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Customer Name *</label>
          <input className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Customer Ref</label>
          <input className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" value={form.customer_ref} onChange={e => set('customer_ref', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Origin Address *</label>
          <input className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Nairobi" value={form.origin_address} onChange={e => set('origin_address', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Destination Address *</label>
          <input className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Mombasa" value={form.destination_address} onChange={e => set('destination_address', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Cargo Description</label>
          <input className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" placeholder="Electronics, 500kg" value={form.cargo_description} onChange={e => set('cargo_description', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Priority</label>
          <select className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" value={form.priority} onChange={e => set('priority', e.target.value as Priority)}>
            <option value="standard">Standard</option>
            <option value="express">Express</option>
            <option value="critical">Critical</option>
            <option value="hazmat">Hazmat</option>
            <option value="cold_chain">Cold Chain</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Vehicle</label>
          <select className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)}>
            <option value="">Unassigned</option>
            {vehiclesQ.data?.data.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Scheduled Pickup</label>
          <input type="datetime-local" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" value={form.scheduled_pickup} onChange={e => set('scheduled_pickup', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Scheduled Delivery</label>
          <input type="datetime-local" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-orange-500" value={form.scheduled_delivery} onChange={e => set('scheduled_delivery', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.is_hazmat} onChange={e => set('is_hazmat', e.target.checked)} /> Hazmat cargo
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.requires_temp_control} onChange={e => set('requires_temp_control', e.target.checked)} /> Requires temperature control
        </label>
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-sm mt-2">Failed to create shipment.</p>
      )}
      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending || !form.customer_name || !form.origin_address || !form.destination_address}
        className="mt-3 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Creating…' : 'Create Shipment'}
      </button>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 flex items-center gap-3">
      <div className="text-orange-400">{icon}</div>
      <div>
        <div className="text-lg font-bold leading-none">{value}</div>
        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

export default function Shipments() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const perPage = 20;
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<PaginatedResponse<Shipment>>({
    queryKey: ['shipments', page, status],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Shipment>>('/shipments', {
        params: { limit: perPage, offset: (page - 1) * perPage, status: status || undefined },
      });
      return res.data;
    },
  });

  const summaryQ = useQuery<{ data: Summary }>({
    queryKey: ['shipments-summary'],
    queryFn: () => api.get('/shipments/stats/summary').then(r => r.data),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ShipmentStatus }) => api.patch(`/shipments/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['shipments-summary'] });
    },
  });

  const totalPages = data?.total ? Math.ceil(data.total / perPage) : 1;
  const s = summaryQ.data?.data;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-orange-400" />
          <h1 className="text-xl font-bold">Shipments</h1>
          {data && (
            <span className="text-slate-400 text-sm">({data?.total ?? 0} total)</span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          New Shipment
        </button>
      </div>

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total" value={s.total} icon={<Package size={18} />} />
          <StatCard label="Pending" value={s.pending} icon={<Clock3 size={18} />} />
          <StatCard label="In Transit" value={s.in_transit} icon={<Gauge size={18} />} />
          <StatCard label="Delivered" value={s.delivered} icon={<CheckCircle2 size={18} />} />
          <StatCard label="Failed" value={s.failed} icon={<XCircle size={18} />} />
          <StatCard label="Avg Delay" value={s.avg_delay_hours ? `${Number(s.avg_delay_hours).toFixed(1)}h` : '—'} icon={<Clock3 size={18} />} />
        </div>
      )}

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      <div className="flex gap-2">
        {['', 'pending', 'picked_up', 'in_transit', 'at_checkpoint', 'delivered', 'failed', 'returned'].map(st => (
          <button
            key={st}
            onClick={() => { setStatus(st); setPage(1); }}
            className={`px-3 py-1.5 rounded text-xs font-medium ${status === st ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            {st === '' ? 'All' : STATUS_LABELS[st as ShipmentStatus]}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading shipments…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load shipments.</div>
      )}

      {data && (
        <>
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Tracking #</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Route</th>
                  <th className="px-4 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Delivery ETA</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id} className="border-t border-slate-700 hover:bg-slate-750">
                    <td className="px-4 py-3 font-medium font-mono text-xs">{s.tracking_number}</td>
                    <td className="px-4 py-3 text-slate-300">{s.customer_name}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[220px] truncate">{s.origin_address} → {s.destination_address}</td>
                    <td className={`px-4 py-3 capitalize font-medium ${PRIORITY_BADGES[s.priority]}`}>
                      <span className="flex items-center gap-1">
                        {s.is_hazmat && <Skull size={12} />}
                        {s.requires_temp_control && <Snowflake size={12} />}
                        {s.priority.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[s.status]}`}>
                        {STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{s.vehicle_reg ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {s.scheduled_delivery ? new Date(s.scheduled_delivery).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {NEXT_STATUSES[s.status].map(next => (
                          <button
                            key={next}
                            onClick={() => statusMut.mutate({ id: s.id, status: next })}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            {STATUS_LABELS[next]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No shipments found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
