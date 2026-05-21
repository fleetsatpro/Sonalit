import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Wrench, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';

type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'overdue';

interface MaintenanceRecord {
  id: string;
  vehicle_id: string;
  vehicle_plate: string;
  type: string;
  scheduled_date: string;
  status: MaintenanceStatus;
  notes: string;
}

interface CreateMaintenancePayload {
  vehicle_id: string;
  type: string;
  scheduled_date: string;
  notes: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

const STATUS_STYLES: Record<MaintenanceStatus, string> = {
  scheduled: 'bg-blue-800 text-blue-200',
  in_progress: 'bg-amber-800 text-amber-200',
  completed: 'bg-green-800 text-green-200',
  overdue: 'bg-red-900 text-red-200',
};

function isOverdue(record: MaintenanceRecord): boolean {
  return (
    record.status === 'scheduled' &&
    new Date(record.scheduled_date) < new Date()
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateMaintenancePayload>({
    vehicle_id: '',
    type: '',
    scheduled_date: '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateMaintenancePayload) =>
      api.post('/maintenance', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      onClose();
    },
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Schedule Maintenance</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Vehicle ID</label>
          <input
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="VEH-001"
            value={form.vehicle_id}
            onChange={(e) => setForm((f) => ({ ...f, vehicle_id: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Type</label>
          <input
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Oil change, tire rotation…"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Scheduled Date</label>
          <input
            type="date"
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            value={form.scheduled_date}
            onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Notes</label>
          <input
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Optional notes…"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-sm mt-2">Failed to schedule maintenance.</p>
      )}
      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending || !form.vehicle_id || !form.type || !form.scheduled_date}
        className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
      >
        {mutation.isPending ? 'Scheduling…' : 'Schedule'}
      </button>
    </div>
  );
}

export default function Maintenance() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const { data, isLoading, isError } = useQuery<PaginatedResponse<MaintenanceRecord>>({
    queryKey: ['maintenance', page],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<MaintenanceRecord> | MaintenanceRecord[]>('/maintenance', {
        params: { page, per_page: perPage },
      });
      const raw = res.data;
      if (Array.isArray(raw)) {
        return { data: raw, total: raw.length, page: 1, per_page: perPage };
      }
      return raw as PaginatedResponse<MaintenanceRecord>;
    },
  });

  const overdueCount = data?.data?.filter(isOverdue).length ?? 0;
  const totalPages = data?.total ? Math.ceil(data.total / perPage) : 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Wrench size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Maintenance</h1>
          {overdueCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-900 text-red-300 text-xs font-bold">
              {overdueCount} overdue
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          Schedule Maintenance
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading maintenance records…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load maintenance data.</div>
      )}

      {data && (
        <>
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Scheduled</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((record) => {
                  const overdue = isOverdue(record);
                  return (
                    <tr
                      key={record.id}
                      className={`border-t border-slate-700 ${overdue ? 'bg-red-950/30' : 'hover:bg-slate-750'}`}
                    >
                      <td className="px-4 py-3 font-mono font-medium">{record.vehicle_plate}</td>
                      <td className="px-4 py-3 text-slate-300">{record.type}</td>
                      <td className={`px-4 py-3 text-sm ${overdue ? 'text-red-400 font-medium' : 'text-slate-400'}`}>
                        {new Date(record.scheduled_date).toLocaleDateString()}
                        {overdue && ' (overdue)'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[record.status]}`}>
                          {record.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 truncate max-w-xs">
                        {record.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No maintenance records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
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
