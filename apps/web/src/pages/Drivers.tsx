import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Users, Search, Plus, X, ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import type { Driver, DriverStatus } from '@sonalit/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DriverListResponse = NormalizedList<Driver>;

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const driverFormSchema = z.object({
  name: z.string().min(1, 'Required').max(256),
  license_number: z.string().min(1, 'Required').max(64),
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  email: z.string().email('Invalid email').nullable().optional(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 format required (e.g. +2348012345678)').nullable().optional(),
});
type DriverForm = z.infer<typeof driverFormSchema>;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<DriverStatus, string> = {
  active: 'bg-green-900/60 text-green-300 border-green-700',
  inactive: 'bg-gray-800 text-gray-400 border-gray-600',
  suspended: 'bg-red-900/60 text-red-300 border-red-700',
};

function StatusBadge({ status }: { status: DriverStatus }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add driver inline form
// ---------------------------------------------------------------------------

function AddDriverForm({ onClose }: { onClose: () => void }): React.ReactElement {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<DriverForm>({
    resolver: zodResolver(driverFormSchema),
  });

  const createMutation = useMutation<Driver, Error, DriverForm>({
    mutationFn: async (data) => {
      const res = await api.post<Driver>('/drivers', { ...data, org_id: user?.org_id });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      reset();
      onClose();
    },
  });

  const onSubmit = (data: DriverForm): void => {
    createMutation.mutate(data);
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold">Add Driver</h3>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Full Name</label>
            <input {...register('name')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.name && <p className="text-red-400 text-xs mt-0.5">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">License Number</label>
            <input {...register('license_number')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.license_number && <p className="text-red-400 text-xs mt-0.5">{errors.license_number.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">License Expiry (YYYY-MM-DD)</label>
            <input {...register('license_expiry')} placeholder="2027-12-31" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.license_expiry && <p className="text-red-400 text-xs mt-0.5">{errors.license_expiry.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email (optional)</label>
            <input type="email" {...register('email')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.email && <p className="text-red-400 text-xs mt-0.5">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Phone (E.164, optional)</label>
            <input {...register('phone')} placeholder="+2348012345678" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.phone && <p className="text-red-400 text-xs mt-0.5">{errors.phone.message}</p>}
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
            Add Driver
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg">
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

export default function Drivers(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<DriverListResponse>({
    queryKey: ['drivers', page, search],
    queryFn: async () => {
      const res = await api.get('/drivers', {
        params: { page, limit: PAGE_SIZE, search: search || undefined },
      });
      return normalizeList<Driver>(res.data);
    },
    placeholderData: (prev) => prev,
  });

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Drivers</h1>
          {data && <span className="text-sm text-gray-400">{data.total ?? 0} total</span>}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Driver
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name or email…"
          className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>

      {showForm && <AddDriverForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading drivers…
        </div>
      )}
      {isError && <p className="text-red-400 text-sm py-8 text-center">Failed to load drivers.</p>}

      {data && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-left">License</th>
                  <th className="px-4 py-3 text-left">Expiry</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      No drivers found.
                    </td>
                  </tr>
                )}
                {data.data.map((d) => (
                  <tr key={d.id} className="border-t border-gray-800 hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{d.name}</td>
                    <td className="px-4 py-3 text-gray-300">{d.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">{d.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">{d.license_number}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{d.license_expiry}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-40"
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
