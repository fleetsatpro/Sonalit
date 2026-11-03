import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Search, Plus, ChevronLeft, ChevronRight,
  Loader2, List, LayoutGrid, X, Download,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { normalizeList, type NormalizedList } from '../lib/normalize.js';
import { AddVehicleForm } from '../components/AddVehicleForm.js';
import { VehicleDetailDrawer } from '../components/VehicleDetailDrawer.js';
import { useLiveFleet } from '../features/live-fleet/hooks/useLiveFleet.js';
import FleetMap from '../features/live-fleet/components/FleetMap.js';
import type { LiveVehicle } from '../features/live-fleet/types/fleet.js';
import type { Vehicle, VehicleStatus } from '@sonalit/contracts';

type ListResponse = NormalizedList<Vehicle>;

// Status set mirrors the backend (idle/active/maintenance/offline). The page
// previously used a fictional enum (inactive/retired) the API rejected.
const STATUSES: VehicleStatus[] = ['active', 'idle', 'maintenance', 'offline'];
const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'] as const;

const STATUS_STYLES: Record<VehicleStatus, { badge: string; dot: string }> = {
  active:      { badge: 'bg-green-900/60 text-green-300 border-green-700',   dot: 'bg-green-400' },
  idle:        { badge: 'bg-gray-800 text-gray-300 border-gray-600',         dot: 'bg-gray-400' },
  maintenance: { badge: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', dot: 'bg-yellow-400' },
  offline:     { badge: 'bg-red-900/60 text-red-400 border-red-700',         dot: 'bg-red-400' },
};

function StatusBadge({ status }: { status: VehicleStatus }): React.ReactElement {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function identityLine(v: Vehicle): string | null {
  const parts = [v.make, v.model, v.year].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function pingLabel(iso: string | null): { text: string; live: boolean; cls: string } {
  if (!iso) return { text: 'never', live: false, cls: 'text-gray-600' };
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 300) return { text: 'live', live: true, cls: 'text-green-400' };
  if (sec < 3600) return { text: `${Math.floor(sec / 60)}m ago`, live: false, cls: 'text-gray-300' };
  if (sec < 86400) return { text: `${Math.floor(sec / 3600)}h ago`, live: false, cls: 'text-gray-400' };
  return { text: `${Math.floor(sec / 86400)}d ago`, live: false, cls: 'text-gray-500' };
}

// Compliance chip for insurance/inspection expiry dates on the vehicle row.
function ExpiryChip({ label, iso }: { label: string; iso: string | null }): React.ReactElement | null {
  if (!iso) return null;
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000;
  if (days > 90) return null; // fine — don't add noise
  const cls = days < 0
    ? 'bg-red-900/60 text-red-300 border-red-700'
    : days < 30
      ? 'bg-red-900/40 text-red-300 border-red-800'
      : 'bg-yellow-900/40 text-yellow-300 border-yellow-800';
  const text = days < 0 ? `${label} expired` : `${label} ${Math.ceil(days)}d`;
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>
      {text}
    </span>
  );
}

function toCsv(rows: Vehicle[]): string {
  const header = ['Registration', 'Make', 'Model', 'Year', 'Type', 'Region', 'Driver', 'Capacity', 'Status', 'Last Ping', 'Insurance Expiry', 'Inspection Expiry'];
  const lines = rows.map((v) => [
    v.registration, v.make ?? '', v.model ?? '', String(v.year ?? ''),
    v.type ?? '', v.region ?? '', v.driver_name ?? '', String(v.capacity ?? ''), v.status,
    v.last_ping ?? '', v.insurance_expiry ?? '', v.inspection_expiry ?? '',
  ].map((f) => `"${String(f).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...lines].join('\n');
}

function downloadCsv(rows: Vehicle[]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fleet-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Mounted only while the Map tab is active, so the live GPS subscription
// (websocket + polling in useLiveFleet) doesn't run during list view.
function FleetMapView(): React.ReactElement {
  const { groups } = useLiveFleet();
  const vehicles: LiveVehicle[] = useMemo(() => groups.flatMap((g) => g.vehicles), [groups]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl h-[70vh] min-h-80 overflow-hidden">
      <FleetMap vehicles={vehicles} selectedId={selectedId} onSelect={(v) => setSelectedId(v.id)} />
    </div>
  );
}

const PAGE_SIZE = 20;

export default function Fleet(): React.ReactElement {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | ''>('');
  const [regionFilter, setRegionFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ['vehicles', page, search, statusFilter, regionFilter],
    queryFn: async () => {
      const res = await api.get<ListResponse | Vehicle[]>('/vehicles', {
        params: {
          page, limit: PAGE_SIZE,
          search: search || undefined,
          status: statusFilter || undefined,
          region: regionFilter || undefined,
        },
      });
      return normalizeList<Vehicle>(res.data);
    },
    placeholderData: (prev) => prev,
    refetchInterval: 60000,
  });

  const setStatus = useMutation<Vehicle, Error, { id: string; status: VehicleStatus }>({
    mutationFn: async ({ id, status }) => {
      const res = await api.patch<Vehicle>(`/vehicles/${id}/status`, { status });
      return res.data;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vehicles'] }); },
  });

  const bulkStatus = useMutation<void, Error, VehicleStatus>({
    mutationFn: async (status) => {
      await Promise.all([...selectedIds].map((id) => api.patch(`/vehicles/${id}/status`, { status })));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setSelectedIds(new Set());
    },
  });

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
    setSelectedIds((prev) => prev.size === allIds.length ? new Set() : new Set(allIds));
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (data?.data ?? []).forEach((v) => { counts[v.status] = (counts[v.status] ?? 0) + 1; });
    return counts;
  }, [data]);

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const allSelected = !!data && data.data.length > 0 && selectedIds.size === data.data.length;
  const openDrawer = (v: Vehicle): void => setSelectedVehicle(v);

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Fleet</h1>
          {data && <span className="text-sm text-gray-400">{data.total ?? 0} vehicles</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
            onClick={() => data && downloadCsv(data.data)}
            disabled={!data?.data.length}
            title="Export current page as CSV"
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-sm font-medium px-3 py-2 rounded-lg transition-colors border border-gray-700"
          >
            <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span>
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
        </div>
      </div>

      {/* Status summary — tap to filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(statusFilter === s ? '' : s); setPage(1); }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter === s ? 'border-orange-500 text-white bg-gray-800' : 'border-gray-700 text-gray-400 bg-gray-900 hover:text-white'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLES[s].dot}`} />
            {s}
            <span className="font-semibold text-white">{statusCounts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search plate, make or model…"
            className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <select
          value={regionFilter}
          onChange={(e) => { setRegionFilter(e.target.value); setPage(1); }}
          className="bg-gray-900 border border-gray-700 rounded-lg text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="">All regions</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {showForm && <AddVehicleForm onClose={() => setShowForm(false)} />}

      {/* Bulk ops bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm flex-wrap">
          <span className="text-white font-medium">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            {(['active', 'idle', 'maintenance'] as VehicleStatus[]).map((s) => (
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
          {bulkStatus.isPending && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto text-gray-400 hover:text-white">
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

      {viewMode === 'map' && <FleetMapView />}

      {viewMode === 'list' && data && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-orange-500" />
                  </th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Type · Region</th>
                  <th className="px-4 py-3 text-left">Driver</th>
                  <th className="px-4 py-3 text-left">Last Ping</th>
                  <th className="px-4 py-3 text-left">Compliance</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No vehicles found.</td></tr>
                )}
                {data.data.map((v) => {
                  const ping = pingLabel(v.last_ping ?? null);
                  const identity = identityLine(v);
                  return (
                    <tr
                      key={v.id}
                      className="border-t border-gray-800 hover:bg-gray-800/40 transition-colors cursor-pointer"
                      onClick={() => openDrawer(v)}
                    >
                      <td className="px-4 py-3 w-10" onClick={(e) => { e.stopPropagation(); toggleSelect(v.id); }}>
                        <input type="checkbox" checked={selectedIds.has(v.id)} onChange={() => toggleSelect(v.id)} className="accent-orange-500" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono font-medium text-white whitespace-nowrap">{v.registration}</div>
                        {identity && <div className="text-xs text-gray-500">{identity}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{v.type} · {v.region}</td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{v.driver_name ?? <span className="text-gray-600">unassigned</span>}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${ping.cls}`}>
                        {ping.live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse mr-1.5 align-middle" />}
                        {ping.text}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          <ExpiryChip label="INS" iso={v.insurance_expiry ?? null} />
                          <ExpiryChip label="INSP" iso={v.inspection_expiry ?? null} />
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={v.status}
                          disabled={setStatus.isPending}
                          onChange={(e) => setStatus.mutate({ id: v.id, status: e.target.value as VehicleStatus })}
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {data.data.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-10">No vehicles found.</p>
            )}
            {data.data.map((v) => {
              const ping = pingLabel(v.last_ping ?? null);
              const identity = identityLine(v);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => openDrawer(v)}
                  className="w-full text-left bg-gray-900 border border-gray-800 rounded-xl p-3.5 active:bg-gray-800/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-white">{v.registration}</span>
                    <StatusBadge status={v.status} />
                  </div>
                  {identity && <div className="text-xs text-gray-400 mt-0.5">{identity}</div>}
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-gray-400">{v.type} · {v.region}</span>
                    <span className={ping.cls}>
                      {ping.live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse mr-1 align-middle" />}
                      {ping.text}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="text-gray-500">{v.driver_name ?? 'unassigned'}</span>
                    <span className="flex gap-1">
                      <ExpiryChip label="INS" iso={v.insurance_expiry ?? null} />
                      <ExpiryChip label="INSP" iso={v.inspection_expiry ?? null} />
                    </span>
                  </div>
                </button>
              );
            })}
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

      <VehicleDetailDrawer vehicle={selectedVehicle} onClose={() => setSelectedVehicle(null)} />
    </div>
  );
}
