import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, FileText, Plus, Trash2, Loader2, AlertCircle, User } from 'lucide-react';
import { api } from '../lib/api.js';
import type { Vehicle, Driver } from '@sonalit/contracts';

interface VehicleDocument {
  id: string;
  vehicle_id: string;
  type: 'insurance' | 'roadworthy' | 'registration' | 'permit' | 'inspection' | 'other';
  label: string;
  file_key: string;
  expires_at: string | null;
  uploaded_at: string;
}

const DOC_TYPE_STYLES: Record<VehicleDocument['type'], string> = {
  insurance: 'bg-orange-900/50 text-orange-300',
  roadworthy: 'bg-green-900/50 text-green-300',
  registration: 'bg-blue-900/50 text-blue-300',
  permit: 'bg-purple-900/50 text-purple-300',
  inspection: 'bg-yellow-900/50 text-yellow-300',
  other: 'bg-gray-800 text-gray-400',
};

const DOC_TYPES = ['insurance', 'roadworthy', 'registration', 'permit', 'inspection', 'other'] as const;

function expiryLabel(expiresAt: string | null): { text: string; cls: string } | null {
  if (!expiresAt) return null;
  const diff = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  const formatted = new Date(expiresAt).toLocaleDateString();
  if (diff < 0) return { text: 'Expired', cls: 'text-red-400' };
  if (diff < 30) return { text: `Exp ${formatted}`, cls: 'text-red-400' };
  if (diff < 90) return { text: `Exp ${formatted}`, cls: 'text-yellow-400' };
  return { text: `Exp ${formatted}`, cls: 'text-gray-400' };
}

interface AddDocFormProps {
  vehicleId: string;
  onDone: () => void;
}

function AddDocForm({ vehicleId, onDone }: AddDocFormProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [type, setType] = useState<VehicleDocument['type']>('insurance');
  const [label, setLabel] = useState('');
  const [fileKey, setFileKey] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/vehicles/${vehicleId}/documents`, {
        type,
        label,
        file_key: fileKey,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicleDocs', vehicleId] });
      onDone();
    },
  });

  return (
    <div className="bg-gray-800 rounded-lg p-3 mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-0.5">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as VehicleDocument['type'])}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs"
          >
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-0.5">Expiry date</label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-0.5">Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Comprehensive Insurance 2026"
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-0.5">File key</label>
        <input
          value={fileKey}
          onChange={(e) => setFileKey(e.target.value)}
          placeholder="s3://bucket/path/file.pdf"
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs font-mono"
        />
      </div>
      {mutation.isError && (
        <p className="text-red-400 text-xs flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {(mutation.error as Error).message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={mutation.isPending || !label || !fileKey}
          onClick={() => mutation.mutate()}
          className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded transition-colors"
        >
          {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
          Save
        </button>
        <button type="button" onClick={onDone} className="text-gray-400 hover:text-white text-xs px-2 py-1.5 rounded">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver section
// ---------------------------------------------------------------------------

// The /drivers endpoint may return extra fields not in the base Driver contract
interface DriverListItem extends Driver {
  employee_id?: string | null;
  driver_score?: number | null;
  current_vehicle_id?: string | null;
}

interface DriverSectionProps {
  vehicle: Vehicle;
}

function DriverSection({ vehicle }: DriverSectionProps): React.ReactElement {
  const queryClient = useQueryClient();

  const { data: driversData, isLoading } = useQuery<{ data: DriverListItem[] }>({
    queryKey: ['drivers', 'active'],
    queryFn: () =>
      api.get<{ data: DriverListItem[] }>('/drivers?status=active&limit=50').then((r) => r.data),
  });

  const drivers = driversData?.data ?? [];

  const currentDriverId = vehicle.driver_id ?? null;
  const [selectedDriverId, setSelectedDriverId] = useState<string>(currentDriverId ?? '');

  const assignMutation = useMutation({
    mutationFn: (driverId: string | null) =>
      api.put(`/vehicles/${vehicle.id}`, { driverId: driverId ?? null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicleDocs', vehicle.id] });
    },
  });

  const currentDriver = drivers.find((d) => d.id === currentDriverId) ?? null;

  function driverLabel(d: DriverListItem): string {
    if (d.employee_id) return `${d.name} (${d.employee_id})`;
    return d.name;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-2">
        <User className="w-4 h-4 text-gray-400" /> Driver
      </h3>

      <div className="bg-gray-800 rounded-lg p-3 space-y-3">
        {/* Current assignment */}
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Currently assigned</p>
          <div className="flex items-center gap-2">
            {currentDriver ? (
              <>
                <span className="text-sm text-white">{currentDriver.name}</span>
                {currentDriver.driver_score != null && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300 font-medium">
                    {currentDriver.driver_score}
                  </span>
                )}
                {currentDriver.phone && (
                  <span className="text-xs text-gray-400">{currentDriver.phone}</span>
                )}
              </>
            ) : (
              <span className="text-sm text-gray-500 italic">Unassigned</span>
            )}
          </div>
        </div>

        {/* Reassign */}
        <div>
          <label className="block text-xs text-gray-400 mb-0.5">Reassign driver</label>
          <div className="flex gap-2">
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              disabled={isLoading}
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs disabled:opacity-50"
            >
              <option value="">— Unassigned —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {driverLabel(d)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={assignMutation.isPending || selectedDriverId === (currentDriverId ?? '')}
              onClick={() => assignMutation.mutate(selectedDriverId || null)}
              className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded transition-colors whitespace-nowrap"
            >
              {assignMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Assign
            </button>
          </div>
        </div>

        {assignMutation.isError && (
          <p className="text-red-400 text-xs flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {(assignMutation.error as Error).message}
          </p>
        )}
        {assignMutation.isSuccess && (
          <p className="text-green-400 text-xs">Driver updated.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

interface Props {
  vehicle: Vehicle | null;
  onClose: () => void;
}

export function VehicleDetailDrawer({ vehicle, onClose }: Props): React.ReactElement | null {
  const queryClient = useQueryClient();
  const [showAddDoc, setShowAddDoc] = useState(false);

  const { data: docsData } = useQuery<{ data: VehicleDocument[] }>({
    queryKey: ['vehicleDocs', vehicle?.id],
    queryFn: () => api.get<{ data: VehicleDocument[] }>(`/vehicles/${vehicle!.id}/documents`).then((r) => r.data),
    enabled: !!vehicle?.id,
  });

  const deleteDoc = useMutation({
    mutationFn: ({ docId }: { docId: string }) =>
      api.delete(`/vehicles/${vehicle!.id}/documents/${docId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicleDocs', vehicle?.id] });
    },
  });

  if (!vehicle) return null;

  const docs = docsData?.data ?? [];
  const sealNumber = (vehicle as any).seal_number ?? '—';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-30" onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full w-full max-w-lg bg-gray-900 border-l border-gray-700 z-40 flex flex-col overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <p className="text-xl font-mono font-bold text-white">{vehicle.registration}</p>
            <p className="text-sm text-gray-400 mt-0.5">
              {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || `${vehicle.type} · ${vehicle.region}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Status', value: vehicle.status },
              { label: 'Type', value: vehicle.type },
              { label: 'Region', value: vehicle.region },
              { label: 'Capacity', value: vehicle.capacity != null ? `${vehicle.capacity} seats` : '—' },
              { label: 'Colour', value: vehicle.color ?? '—' },
              { label: 'Last ping', value: vehicle.last_ping ? new Date(vehicle.last_ping).toLocaleString() : 'never' },
              { label: 'Insurance', value: vehicle.insurance_expiry ? new Date(vehicle.insurance_expiry).toLocaleDateString() : '—' },
              { label: 'Inspection', value: vehicle.inspection_expiry ? new Date(vehicle.inspection_expiry).toLocaleDateString() : '—' },
              { label: 'VIN', value: vehicle.vin ?? '—', mono: true },
              { label: 'Seal No.', value: sealNumber, mono: true },
            ].map(({ label, value, mono }) => (
              <div key={label} className="bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className={`text-sm text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Driver section */}
          <DriverSection vehicle={vehicle} />

          {/* Documents */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-gray-400" /> Documents
              </h3>
              <button
                type="button"
                onClick={() => setShowAddDoc((v) => !v)}
                className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            {showAddDoc && (
              <AddDocForm vehicleId={vehicle.id} onDone={() => setShowAddDoc(false)} />
            )}

            {docs.length === 0 && !showAddDoc && (
              <p className="text-xs text-gray-500 py-4 text-center">No documents attached.</p>
            )}

            <div className="space-y-2 mt-2">
              {docs.map((doc) => {
                const expiry = expiryLabel(doc.expires_at);
                return (
                  <div key={doc.id} className="flex items-start justify-between bg-gray-800 rounded-lg p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${DOC_TYPE_STYLES[doc.type]}`}>
                          {doc.type}
                        </span>
                        {expiry && (
                          <span className={`text-xs ${expiry.cls}`}>{expiry.text}</span>
                        )}
                      </div>
                      <p className="text-sm text-white truncate">{doc.label}</p>
                      <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{doc.file_key}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteDoc.mutate({ docId: doc.id })}
                      disabled={deleteDoc.isPending}
                      className="ml-2 text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
