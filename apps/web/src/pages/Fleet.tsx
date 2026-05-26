import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Truck, Search, Plus, X, ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import type { Vehicle, VehicleStatus } from '@sonalit/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ListResponse = NormalizedList<Vehicle>;

// ---------------------------------------------------------------------------
// Form schema — align with CreateVehicleInputSchema from contracts
// ---------------------------------------------------------------------------

const vehicleFormSchema = z.object({
  registration: z.string().min(1, 'Required').max(32),
  make: z.string().min(1, 'Required').max(128),
  model: z.string().min(1, 'Required').max(128),
  year: z.coerce.number().int().min(1900).max(2100),
  type: z.enum(['truck', 'van', 'pickup', 'tanker', 'flatbed', 'refrigerated', 'armoured', 'other']),
  vin: z.string().length(17).regex(/^[A-HJ-NPR-Z0-9]{17}$/).nullable().optional(),
});
type VehicleForm = z.infer<typeof vehicleFormSchema>;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<VehicleStatus, string> = {
  active: 'bg-green-900/60 text-green-300 border-green-700',
  inactive: 'bg-gray-800 text-gray-400 border-gray-600',
  maintenance: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
};

function StatusBadge({ status }: { status: VehicleStatus }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add vehicle form (inline)
// ---------------------------------------------------------------------------

function AddVehicleForm({ onClose }: { onClose: () => void }): React.ReactElement {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VehicleForm>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: { type: 'truck', year: new Date().getFullYear() },
  });

  const createMutation = useMutation<Vehicle, Error, VehicleForm>({
    mutationFn: async (data) => {
      const res = await api.post<Vehicle>('/vehicles', { ...data, org_id: user?.org_id });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      reset();
      onClose();
    },
  });

  const onSubmit = (data: VehicleForm): void => {
    createMutation.mutate(data);
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold">Add Vehicle</h3>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          {/* Registration */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Plate / Registration</label>
            <input {...register('registration')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.registration && <p className="text-red-400 text-xs mt-0.5">{errors.registration.message}</p>}
          </div>
          {/* Make */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Make</label>
            <input {...register('make')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.make && <p className="text-red-400 text-xs mt-0.5">{errors.make.message}</p>}
          </div>
          {/* Model */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Model</label>
            <input {...register('model')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.model && <p className="text-red-400 text-xs mt-0.5">{errors.model.message}</p>}
          </div>
          {/* Year */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Year</label>
            <input type="number" {...register('year')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.year && <p className="text-red-400 text-xs mt-0.5">{errors.year.message}</p>}
          </div>
          {/* Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <select {...register('type')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
              {['truck','van','pickup','tanker','flatbed','refrigerated','armoured','other'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {/* VIN */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">VIN (optional)</label>
            <input {...register('vin')} maxLength={17} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.vin && <p className="text-red-400 text-xs mt-0.5">{errors.vin.message}</p>}
          </div>
        </div>

        {createMutation.isError && (
          <div className="flex items-center gap-2 text-red-400 text-sm mb-3">
            <AlertCircle className="w-4 h-4" />
            <span>{createMutation.error.message}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Vehicle
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export default function Fleet(): React.ReactElement {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ['vehicles', page, search],
    queryFn: async () => {
      const res = await api.get<ListResponse | Vehicle[]>('/vehicles', {
        params: { page, limit: PAGE_SIZE, search: search || undefined },
      });
      return normalizeList<Vehicle>(res.data);
    },
    placeholderData: (prev) => prev,
  });

  const toggleStatus = useMutation<Vehicle, Error, { id: string; status: VehicleStatus }>({
    mutationFn: async ({ id, status }) => {
      const res = await api.patch<Vehicle>(`/vehicles/${id}`, { status });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const nextStatus = (current: VehicleStatus): VehicleStatus => {
    const cycle: VehicleStatus[] = ['active', 'inactive', 'maintenance'];
    return cycle[(cycle.indexOf(current) + 1) % cycle.length]!;
  };

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Fleet</h1>
          {data && <span className="text-sm text-gray-400">{data.total ?? 0} vehicles</span>}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Vehicle
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search plate or make…"
          className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>

      {showForm && <AddVehicleForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading fleet…
        </div>
      )}
      {isError && <p className="text-red-400 text-sm py-8 text-center">Failed to load vehicles.</p>}

      {data && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Plate</th>
                  <th className="px-4 py-3 text-left">Make / Model</th>
                  <th className="px-4 py-3 text-left">Year</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                      No vehicles found.
                    </td>
                  </tr>
                )}
                {data.data.map((v) => (
                  <tr key={v.id} className="border-t border-gray-800 hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-white">{v.registration}</td>
                    <td className="px-4 py-3 text-gray-300">{v.make} {v.model}</td>
                    <td className="px-4 py-3 text-gray-300">{v.year}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleStatus.mutate({ id: v.id, status: nextStatus(v.status) })}
                        disabled={toggleStatus.isPending}
                        className="text-xs text-orange-400 hover:text-orange-300 underline underline-offset-2 disabled:opacity-50"
                      >
                        Set {nextStatus(v.status)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
