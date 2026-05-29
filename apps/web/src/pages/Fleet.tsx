import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Search, Plus, ChevronLeft, ChevronRight,
  Loader2, MapPin, List, LayoutGrid, X, AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import { AddVehicleForm } from '../components/AddVehicleForm.js';
import { VehicleDetailDrawer } from '../components/VehicleDetailDrawer.js';
import type { Vehicle, VehicleStatus } from '@sonalit/contracts';

type ListResponse = NormalizedList<Vehicle>;

const STATUS_STYLES: Record<VehicleStatus, string> = {
  active: 'bg-green-900/60 text-green-300 border-green-700',
  inactive: 'bg-gray-800 text-gray-400 border-gray-600',
  maintenance: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  retired: 'bg-red-900/60 text-red-400 border-red-700',
};

function StatusBadge({ status }: { status: VehicleStatus }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

interface VehicleDocument {
  expires_at: string | null;
}

function useExpiringDocs(vehicleId: string | undefined) {
  return useQuery<{ data: VehicleDocument[] }>({
    queryKey: ['vehicleDocs', vehicleId],
    queryFn: () => api.get<{ data: VehicleDocument[] }>(`/vehicles/${vehicleId!}/documents`).then((r) => r.data),
    enabled: !!vehicleId,
    select: (d) => d,
  });
}

const PAGE_SIZE = 20;

export default function Fleet(): React.ReactElement {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [expiryBannerDismissed, setExpiryBannerDismissed] = useState(false);

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

  const { data: drawerDocs } = useExpiringDocs(selectedVehicle?.id);

  const expiringCount = drawerDocs?.data.filter((d) => {
    if (!d.expires_at) return false;
    return (new Date(d.expires_at).getTime() - Date.now()) / 86_400_000 < 30;
  }).length ?? 0;

  const toggleStatus = useMutation<Vehicle, Error, { id: string; status: VehicleStatus }>({
    mutationFn: async ({ id, status }) => {
      const res = await api.patch<Vehicle>(`/vehicles/${id}`, { status });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const bulkStatus = useMutation<void, Error, VehicleStatus>({
    mutationFn: async (status) => {
      await Promise.all([...selectedIds].map((id) =>
        api.patch(`/vehicles/${id}`, { status }),
      ));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setSelectedIds(new Set());
    },
  });

  const nextStatus = (current: VehicleStatus): VehicleStatus => {
    const cycle: VehicleStatus[] = ['active', 'inactive', 'maintenance'];
    return cycle[(cycle.indexOf(current) + 1) % cycle.length]!;
  };

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    if (!data) return;
    const allIds = data.data.map((v) => v.id);
    setSelectedIds((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds),
    );
  };

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const allSelected = !!data && data.data.length > 0 && selectedIds.size === data.data.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Fleet</h1>
          {data && <span className="text-sm text-gray-400">{data.total ?? 0} vehicles</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
            >
              <List className="w-4 h-4" /> List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${viewMode === 'map' ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
            >
              <LayoutGrid className="w-4 h-4" /> Map
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
        </div>
      </div>

      {/* Expiry banner (shown when drawer is open and vehicle has expiring docs) */}
      {selectedVehicle && expiringCount > 0 && !expiryBannerDismissed && (
        <div className="flex items-center justify-between bg-amber-900/40 border border-amber-700/60 rounded-lg px-4 py-2.5 text-amber-300 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              {expiringCount} document{expiringCount > 1 ? 's' : ''} for{' '}
              <span className="font-mono font-semibold">{selectedVehicle.registration}</span>{' '}
              expire within 30 days
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpiryBannerDismissed(true)}
            className="text-amber-400 hover:text-amber-200 ml-4"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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

      {/* Bulk ops bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm">
          <span className="text-white font-medium">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-2">
            {(['active', 'inactive', 'maintenance'] as VehicleStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={bulkStatus.isPending}
                onClick={() => bulkStatus.mutate(s)}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50 transition-colors capitalize"
              >
                Set {s}
              </button>
            ))}
          </div>
          {bulkStatus.isPending && <Loader2 className="w-4 h-4 animate-spin text-gray-400 ml-1" />}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading fleet…
        </div>
      )}
      {isError && <p className="text-red-400 text-sm py-8 text-center">Failed to load vehicles.</p>}

      {/* Map view */}
      {viewMode === 'map' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl h-96 flex flex-col items-center justify-center text-gray-500 gap-2">
          <MapPin className="w-8 h-8" />
          <p className="text-sm">Map view — GPS positions shown here</p>
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && data && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-orange-500"
                    />
                  </th>
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
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      No vehicles found.
                    </td>
                  </tr>
                )}
                {data.data.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-gray-800 hover:bg-gray-800/40 transition-colors cursor-pointer"
                    onClick={() => { setSelectedVehicle(v); setExpiryBannerDismissed(false); }}
                  >
                    <td
                      className="px-4 py-3 w-10"
                      onClick={(e) => { e.stopPropagation(); toggleSelect(v.id); }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(v.id)}
                        onChange={() => toggleSelect(v.id)}
                        className="accent-orange-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-white">{v.registration}</td>
                    <td className="px-4 py-3 text-gray-300">{v.make} {v.model}</td>
                    <td className="px-4 py-3 text-gray-300">{v.year}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v.status} />
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
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

      <VehicleDetailDrawer
        vehicle={selectedVehicle}
        onClose={() => setSelectedVehicle(null)}
      />
    </div>
  );
}
