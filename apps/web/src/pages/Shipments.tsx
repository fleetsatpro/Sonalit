import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Package, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';

type ShipmentStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled';

interface Shipment {
  id: string;
  shipment_number: string;
  origin: string;
  destination: string;
  status: ShipmentStatus;
  assigned_vehicle: string | null;
  scheduled_at: string;
  cargo_description: string;
}

interface CreateShipmentPayload {
  origin: string;
  destination: string;
  cargo_description: string;
  scheduled_at: string;
  vehicle_id: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

const STATUS_BADGES: Record<ShipmentStatus, string> = {
  pending: 'bg-slate-600 text-slate-200',
  in_transit: 'bg-blue-700 text-blue-100',
  delivered: 'bg-green-700 text-green-100',
  cancelled: 'bg-red-700 text-red-100',
};

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: 'Pending',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

type FormField = {
  key: keyof CreateShipmentPayload;
  label: string;
  type?: string;
  placeholder?: string;
};

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateShipmentPayload>({
    origin: '',
    destination: '',
    cargo_description: '',
    scheduled_at: '',
    vehicle_id: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateShipmentPayload) =>
      api.post('/shipments', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      onClose();
    },
  });

  const fields: FormField[] = [
    { key: 'origin', label: 'Origin', placeholder: 'Nairobi' },
    { key: 'destination', label: 'Destination', placeholder: 'Mombasa' },
    { key: 'cargo_description', label: 'Cargo Description', placeholder: 'Electronics, 500kg' },
    { key: 'scheduled_at', label: 'Scheduled At', type: 'datetime-local' },
    { key: 'vehicle_id', label: 'Vehicle ID', placeholder: 'VEH-001' },
  ];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">New Shipment</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(({ key, label, type = 'text', placeholder }) => (
          <div key={key}>
            <label className="block text-xs text-slate-400 mb-1">{label}</label>
            <input
              type={type}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder={placeholder}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-sm mt-2">Failed to create shipment.</p>
      )}
      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending || !form.origin || !form.destination}
        className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Creating…' : 'Create Shipment'}
      </button>
    </div>
  );
}

export default function Shipments() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const { data, isLoading, isError } = useQuery<PaginatedResponse<Shipment>>({
    queryKey: ['shipments', page],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Shipment>>('/shipments', {
        params: { page, per_page: perPage },
      });
      return res.data;
    },
  });

  const totalPages = data ? Math.ceil(data.total / perPage) : 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Shipments</h1>
          {data && (
            <span className="text-slate-400 text-sm">({data.total} total)</span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          New Shipment
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

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
                  <th className="px-4 py-3 text-left">Shipment #</th>
                  <th className="px-4 py-3 text-left">Origin</th>
                  <th className="px-4 py-3 text-left">Destination</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id} className="border-t border-slate-700 hover:bg-slate-750">
                    <td className="px-4 py-3 font-medium font-mono text-sm">{s.shipment_number}</td>
                    <td className="px-4 py-3 text-slate-300">{s.origin}</td>
                    <td className="px-4 py-3 text-slate-300">{s.destination}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[s.status]}`}>
                        {STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{s.assigned_vehicle ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(s.scheduled_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
