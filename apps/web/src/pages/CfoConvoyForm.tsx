import React, { useEffect, useRef, useState } from 'react';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useParams, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Route, ShieldAlert, MapPin, Truck, X } from 'lucide-react';
import Dexie from 'dexie';
import { api } from '../lib/api.js';
import type { Vehicle } from '@sonalit/contracts';

const draftDb = new Dexie('sonalit-drafts');
draftDb.version(1).stores({ drafts: 'key' });
const draftsTable = (draftDb as Dexie & { drafts: Dexie.Table<{ key: string; data: unknown }, string> }).drafts;
const DRAFT_KEY = 'cfo-convoy-form';

// ---------------------------------------------------------------------------
// Schema — aligned with backend Joi convoy schema
// ---------------------------------------------------------------------------

const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const convoyFormSchema = z.object({
  name: z.string().min(3, 'At least 3 characters').max(100),
  region: z.enum(REGIONS, { required_error: 'Select a region' }),
  priority: z.enum(PRIORITIES, { required_error: 'Select a priority' }),
  routeOrigin: z.string().min(1, 'Required').max(100),
  routeDestination: z.string().min(1, 'Required').max(100),
  departureTime: z.string().optional(),
  estimatedArrival: z.string().optional(),
  description: z.string().max(500).optional(),
  clientId: z.string().optional(),
  vehicle_ids: z.array(z.string()).default([]),
  cfo_ids: z.array(z.string()).default([]),
});

type ConvoyForm = z.infer<typeof convoyFormSchema>;
type RawConvoy = Record<string, unknown>;
type VehicleListResponse = { data: Vehicle[] };
type CfoUser = { id: string; name: string; email: string };
type CargoClient = { id: string; name: string; company?: string | null; email: string };

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-mono font-medium text-[#607890] mb-1.5 uppercase tracking-[.1em]">
        {label}
      </label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1 font-mono">{error}</p>}
    </div>
  );
}

const BASE_INPUT = [
  'w-full bg-[#09101c] border border-[#122038] rounded-md px-3 py-2.5',
  'text-white text-sm font-mono focus:outline-none focus:ring-1',
  'focus:ring-orange-500 focus:border-orange-500 transition-colors',
  'placeholder-[#304558]',
].join(' ');

// ---------------------------------------------------------------------------
// Checkbox list for multi-select
// ---------------------------------------------------------------------------

function MultiSelectList({ items, value, onChange, emptyLabel = 'No items available', lockedIds }: {
  items: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  emptyLabel?: string;
  /** Already-assigned items — shown checked but not uncheckable. There is no
   * backend endpoint to remove a convoy_assignments/convoy_cfos row, so
   * offering an uncheck here would silently do nothing on submit. */
  lockedIds?: Set<string>;
}) {
  const toggle = (id: string) => {
    if (lockedIds?.has(id)) return;
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  return (
    <div className="max-h-44 overflow-y-auto bg-[#09101c] border border-[#122038] rounded-md divide-y divide-[#0c1424]">
      {items.length === 0 && (
        <p className="text-[#304558] text-xs px-3 py-2.5 font-mono">{emptyLabel}</p>
      )}
      {items.map((item) => {
        const locked = lockedIds?.has(item.id) ?? false;
        return (
          <label key={item.id}
            className={`flex items-center gap-2.5 px-3 py-2 transition-colors select-none ${locked ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-orange-500/5'}`}>
            <input
              type="checkbox"
              checked={value.includes(item.id)}
              onChange={() => toggle(item.id)}
              disabled={locked}
              className="accent-orange-500 w-3.5 h-3.5 flex-shrink-0"
            />
            <span className="text-gray-200 text-xs font-mono leading-snug flex-1">{item.label}</span>
            {locked && <span className="text-[9px] font-mono text-[#607890] uppercase tracking-wide flex-shrink-0">Assigned</span>}
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client picker — selects which cargo owner this convoy runs for, with an
// inline "new client" flow so ops doesn't have to leave the form to register
// one first. Client records themselves (cargo_clients) live in the portal
// client-management screen; this just attaches an existing (or freshly
// created) one to the convoy for classification/reporting.
// ---------------------------------------------------------------------------

function ClientPicker({ value, onChange, clients, onClientCreated }: {
  value: string | undefined;
  onChange: (id: string) => void;
  clients: CargoClient[];
  onClientCreated: (client: CargoClient) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompany, setNewCompany] = useState('');

  const createMutation = useMutation<CargoClient, Error, void>({
    mutationFn: async () => {
      const r = await api.post<{ data: CargoClient }>('/portal/clients', {
        name: newName.trim(), email: newEmail.trim(), company: newCompany.trim() || undefined,
      });
      return r.data.data;
    },
    onSuccess: (client) => {
      onClientCreated(client);
      onChange(client.id);
      setAdding(false);
      setNewName(''); setNewEmail(''); setNewCompany('');
    },
  });

  if (adding) {
    return (
      <div className="bg-[#09101c] border border-[#122038] rounded-md p-3 space-y-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Client name"
          className={BASE_INPUT} />
        <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Contact email" type="email"
          className={BASE_INPUT} />
        <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Company (optional)"
          className={BASE_INPUT} />
        {createMutation.isError && (
          <p className="text-red-400 text-xs font-mono">{extractApiError(createMutation.error, 'Could not create client.')}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={!newName.trim() || !newEmail.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-mono font-semibold px-3 py-1.5 rounded-md text-[10px] uppercase tracking-wider transition-colors">
            {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />} Save Client
          </button>
          <button type="button" onClick={() => setAdding(false)}
            className="px-3 py-1.5 bg-transparent border border-[#122038] text-[#607890] rounded-md text-[10px] font-mono font-semibold uppercase tracking-wider">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={BASE_INPUT + ' cursor-pointer flex-1'}>
        <option value="">No client assigned</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
        ))}
      </select>
      <button type="button" onClick={() => setAdding(true)}
        className="px-3 py-2.5 bg-[#07090f] hover:bg-[#09101c] border border-[#122038] hover:border-orange-500/30 text-[#607890] hover:text-orange-400 rounded-md text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors whitespace-nowrap">
        + New
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CFO truck roster — links an already-assigned vehicle to a driver + position
// (convoy_trucks) and, separately, a CFO to that truck (convoy_cfo_truck_
// assignments). This is what the Guardian CFO app and report generation
// actually read; nothing else in this form writes to either table.
// ---------------------------------------------------------------------------

interface ConvoyTruckRow {
  id: string;
  vehicle_id: string | null;
  registration: string | null;
  driver_name: string;
  driver_phone: string | null;
  driver_license_no: string | null;
  position: number;
}
interface CfoTruckAssignmentRow {
  id: string;
  cfo_user_id: string;
  convoy_truck_id: string;
}

function extractApiError(err: unknown, fallback: string): string {
  type ApiErr = { response?: { data?: { error?: string } } };
  return (err as ApiErr).response?.data?.error ?? fallback;
}

function TruckRosterSection({
  convoyId, vehicles, cfos, trucks, assignments,
}: {
  convoyId: string;
  vehicles: { id: string; registration?: string | null; make?: string | null; model?: string | null }[];
  cfos: { cfo_user_id: string; cfo_name?: string | null; cfo_email?: string | null }[];
  trucks: ConvoyTruckRow[];
  assignments: CfoTruckAssignmentRow[];
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['convoys', convoyId] });
  const [showAdd, setShowAdd] = useState(false);

  const addTruck = useMutation({
    mutationFn: (body: {
      vehicle_id: string | null; registration: string; driver_name: string;
      driver_phone: string; driver_license_no: string; position: number;
    }) => api.post(`/convoys/${convoyId}/trucks`, body),
    onSuccess: () => { invalidate(); setShowAdd(false); },
  });
  const removeTruck = useMutation({
    mutationFn: (truckId: string) => api.delete(`/convoys/${convoyId}/trucks/${truckId}`),
    onSuccess: invalidate,
  });
  const assignCfo = useMutation({
    mutationFn: (body: { cfo_user_id: string; convoy_truck_id: string }) =>
      api.post(`/convoys/${convoyId}/cfo-assignments`, body),
    onSuccess: invalidate,
  });
  const removeAssignment = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/convoys/${convoyId}/cfo-assignments/${assignmentId}`),
    onSuccess: invalidate,
  });

  const nextPosition = Math.min(6, trucks.length + 1);
  const vehicleLabel = (id: string | null) => {
    const v = id ? vehicles.find((x) => x.id === id) : null;
    if (!v) return null;
    return `${v.registration ?? v.id.slice(0, 8)}${v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}`;
  };
  const takenVehicleIds = new Set(trucks.map((t) => t.vehicle_id).filter((x): x is string => !!x));
  const unlinkedVehicles = vehicles.filter((v) => !takenVehicleIds.has(v.id));

  return (
    <Section label="CFO Truck Roster">
      <p className="text-[#607890] text-[10px] font-mono leading-relaxed -mt-1 mb-1">
        The Guardian CFO app and photo reports read from this roster, not from the vehicle list above.
        A truck needs a driver + position here before a CFO can capture photos for it — linking it to a
        fleet vehicle is optional.
      </p>

      <div className="space-y-2">
        {trucks.map((truck) => {
          const assignment = assignments.find((a) => a.convoy_truck_id === truck.id) ?? null;
          const assignedCfo = assignment ? cfos.find((c) => c.cfo_user_id === assignment.cfo_user_id) : null;
          const linkedVehicle = vehicleLabel(truck.vehicle_id);
          const plate = truck.registration ?? (truck.vehicle_id ? vehicles.find((v) => v.id === truck.vehicle_id)?.registration : null);

          return (
            <div key={truck.id} className="bg-[#09101c] border border-[#122038] rounded-md p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-200 min-w-0">
                  <Truck size={13} className="text-orange-400 flex-shrink-0" />
                  <span className="truncate">
                    Position {truck.position} · {plate ?? 'No plate'} · {truck.driver_name}
                    {truck.driver_phone ? ` · ${truck.driver_phone}` : ''}
                    {truck.driver_license_no ? ` · Lic ${truck.driver_license_no}` : ''}
                    {linkedVehicle ? ` · Fleet: ${linkedVehicle}` : ''}
                  </span>
                </div>
                <button type="button" onClick={() => removeTruck.mutate(truck.id)} disabled={removeTruck.isPending}
                  className="text-[#607890] hover:text-red-400 disabled:opacity-50 flex-shrink-0" title="Remove truck">
                  <X size={13} />
                </button>
              </div>

              <div className="pl-[21px] mt-2">
                {assignment ? (
                  <div className="flex items-center justify-between gap-2 bg-orange-500/5 border border-orange-500/20 rounded px-2 py-1.5">
                    <span className="text-[11px] font-mono text-orange-300">
                      CFO: {assignedCfo?.cfo_name ?? assignment.cfo_user_id.slice(0, 8)}
                    </span>
                    <button type="button" onClick={() => removeAssignment.mutate(assignment.id)}
                      disabled={removeAssignment.isPending}
                      className="text-[#607890] hover:text-red-400 disabled:opacity-50" title="Remove assignment">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <AssignCfoRow
                    cfos={cfos}
                    pending={assignCfo.isPending}
                    error={assignCfo.error ? extractApiError(assignCfo.error, 'Failed to assign CFO') : null}
                    onAssign={(cfoUserId) => assignCfo.mutate({ cfo_user_id: cfoUserId, convoy_truck_id: truck.id })}
                  />
                )}
              </div>
            </div>
          );
        })}

        {trucks.length === 0 && (
          <p className="text-[#304558] text-xs font-mono">No trucks registered yet.</p>
        )}

        {showAdd ? (
          <AddTruckForm
            vehicles={unlinkedVehicles}
            defaultPosition={nextPosition}
            pending={addTruck.isPending}
            error={addTruck.error ? extractApiError(addTruck.error, 'Failed to add truck') : null}
            onAdd={(driverName, driverPhone, driverLicenseNo, position, vehicleId, registration) =>
              addTruck.mutate({
                vehicle_id: vehicleId, registration, driver_name: driverName,
                driver_phone: driverPhone, driver_license_no: driverLicenseNo, position,
              })}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button type="button" onClick={() => setShowAdd(true)}
            className="text-xs font-mono text-orange-400 hover:text-orange-300 border border-orange-500/30 rounded-md px-3 py-1.5">
            + Add Truck
          </button>
        )}
      </div>
    </Section>
  );
}

// Known route waypoints (towns/checkpoints along the planned route) — the
// PDF report shows these as a fallback "planned route" whenever live GPS
// tracking has no pings logged for a given day, which is the common case
// rather than the exception for most convoys.
type RouteWaypointRow = { id?: string; name: string; lat?: number | null; lng?: number | null };

function RouteWaypointsSection({ convoyId }: { convoyId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['convoys', convoyId, 'route-waypoints'],
    queryFn: () => api.get<{ data: RouteWaypointRow[] }>(`/convoys/${convoyId}/route-waypoints`).then((r) => r.data.data),
  });
  const [rows, setRows] = useState<RouteWaypointRow[] | null>(null);
  const effectiveRows = rows ?? data ?? [];

  const save = useMutation({
    mutationFn: (waypoints: RouteWaypointRow[]) =>
      api.put(`/convoys/${convoyId}/route-waypoints`, {
        waypoints: waypoints
          .filter((w) => w.name.trim().length > 0)
          .map((w) => ({ name: w.name.trim(), lat: w.lat ?? null, lng: w.lng ?? null })),
      }),
    onSuccess: () => {
      setRows(null);
      void queryClient.invalidateQueries({ queryKey: ['convoys', convoyId, 'route-waypoints'] });
    },
  });

  const updateName = (i: number, name: string) => {
    const next = [...effectiveRows];
    next[i] = { ...next[i], name };
    setRows(next);
  };
  const removeRow = (i: number) => setRows(effectiveRows.filter((_, idx) => idx !== i));
  const addRow = () => setRows([...effectiveRows, { name: '' }]);

  return (
    <Section label="Known Route Waypoints">
      <p className="text-[#607890] text-[10px] font-mono leading-relaxed -mt-1 mb-1">
        Towns or checkpoints along the planned route, in order. Shown on the daily PDF report as the
        planned route whenever live GPS tracking has no pings logged for that day — most convoys don't
        have continuous device tracking, so this is what fills the map section for them.
      </p>

      {isLoading ? (
        <p className="text-[#304558] text-xs font-mono">Loading…</p>
      ) : (
        <div className="space-y-2">
          {effectiveRows.map((wp, i) => (
            <div key={wp.id ?? i} className="flex items-center gap-2">
              <MapPin size={13} className="text-orange-400 flex-shrink-0" />
              <input value={wp.name} onChange={(e) => updateName(i, e.target.value)}
                placeholder={`Stop ${i + 1} (e.g. Lubumbashi)`}
                className={BASE_INPUT + ' !py-1.5 !text-[11px]'} />
              <button type="button" onClick={() => removeRow(i)}
                className="text-[#607890] hover:text-red-400 flex-shrink-0" title="Remove stop">
                <X size={13} />
              </button>
            </div>
          ))}
          {effectiveRows.length === 0 && (
            <p className="text-[#304558] text-xs font-mono">No known waypoints configured yet.</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={addRow}
              className="text-xs font-mono text-orange-400 hover:text-orange-300 border border-orange-500/30 rounded-md px-3 py-1.5">
              + Add Stop
            </button>
            <button type="button" disabled={save.isPending} onClick={() => save.mutate(effectiveRows)}
              className="text-xs font-mono text-gray-200 hover:text-white bg-[#09101c] border border-[#122038] hover:border-[#1a2e4a] disabled:opacity-50 rounded-md px-3 py-1.5">
              {save.isPending ? 'Saving…' : 'Save Route'}
            </button>
            {save.isSuccess && !rows && <span className="text-[11px] font-mono text-green-400">Saved</span>}
            {save.error && (
              <span className="text-[11px] font-mono text-red-400">
                {extractApiError(save.error, 'Failed to save route')}
              </span>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function AddTruckForm({ vehicles, defaultPosition, pending, error, onAdd, onCancel }: {
  vehicles: { id: string; registration?: string | null; make?: string | null; model?: string | null }[];
  defaultPosition: number;
  pending: boolean;
  error: string | null;
  onAdd: (
    driverName: string, driverPhone: string, driverLicenseNo: string,
    position: number, vehicleId: string | null, registration: string,
  ) => void;
  onCancel: () => void;
}) {
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverLicenseNo, setDriverLicenseNo] = useState('');
  const [position, setPosition] = useState(defaultPosition);
  const [vehicleId, setVehicleId] = useState('');
  const [registration, setRegistration] = useState('');

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  // A fleet vehicle already carries its own registration — only prompt for one
  // here when there's no linked vehicle to fall back on.
  const needsRegistration = !vehicleId;
  const canSubmit = driverName.trim().length > 0 && (!needsRegistration || registration.trim().length > 0);

  return (
    <div className="bg-[#09101c] border border-[#122038] rounded-md p-3 flex flex-col gap-1.5">
      {vehicles.length > 0 && (
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
          className={BASE_INPUT + ' !py-1.5 !text-[11px] cursor-pointer'}>
          <option value="">No fleet vehicle linked</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration ?? v.id.slice(0, 8)}{v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-1.5">
        <input value={selectedVehicle ? (selectedVehicle.registration ?? '') : registration}
          onChange={(e) => setRegistration(e.target.value)}
          disabled={!!selectedVehicle}
          placeholder="Plate / registration no."
          className={BASE_INPUT + ' !py-1.5 !text-[11px] flex-1 disabled:opacity-50'} />
        <input type="number" min={1} max={6} value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className={BASE_INPUT + ' !py-1.5 !text-[11px] w-14'} />
      </div>
      {needsRegistration && registration.trim().length === 0 && (
        <p className="text-amber-400 text-[10px] font-mono">Plate/reg. no. is required when no fleet vehicle is linked.</p>
      )}
      <div className="flex gap-1.5">
        <input value={driverName} onChange={(e) => setDriverName(e.target.value)}
          placeholder="Driver name" className={BASE_INPUT + ' !py-1.5 !text-[11px] flex-1'} />
        <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)}
          placeholder="Phone (optional)" className={BASE_INPUT + ' !py-1.5 !text-[11px] flex-1'} />
        <input value={driverLicenseNo} onChange={(e) => setDriverLicenseNo(e.target.value)}
          placeholder="License no. (optional)" className={BASE_INPUT + ' !py-1.5 !text-[11px] flex-1'} />
      </div>
      <div className="flex gap-1.5 justify-end">
        <button type="button" onClick={onCancel} className="text-[11px] font-mono text-[#607890] hover:text-gray-300 px-2">
          Cancel
        </button>
        <button type="button" disabled={!canSubmit || pending}
          onClick={() => onAdd(
            driverName.trim(), driverPhone.trim(), driverLicenseNo.trim(),
            position, vehicleId || null, selectedVehicle ? '' : registration.trim(),
          )}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-[11px] font-mono px-3 rounded-md whitespace-nowrap">
          Add Truck
        </button>
      </div>
      {error && <p className="text-red-400 text-[10px] font-mono">{error}</p>}
    </div>
  );
}

function AssignCfoRow({ cfos, pending, error, onAssign }: {
  cfos: { cfo_user_id: string; cfo_name?: string | null; cfo_email?: string | null }[];
  pending: boolean;
  error: string | null;
  onAssign: (cfoUserId: string) => void;
}) {
  const [selected, setSelected] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className={BASE_INPUT + ' !py-1.5 !text-[11px] flex-1 cursor-pointer'}>
          <option value="">Assign a CFO to this truck…</option>
          {cfos.map((c) => (
            <option key={c.cfo_user_id} value={c.cfo_user_id}>{c.cfo_name ?? c.cfo_email ?? c.cfo_user_id.slice(0, 8)}</option>
          ))}
        </select>
        <button type="button" disabled={!selected || pending} onClick={() => onAssign(selected)}
          className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-[11px] font-mono px-3 rounded-md whitespace-nowrap">
          Assign
        </button>
      </div>
      {error && <p className="text-red-400 text-[10px] font-mono">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export default function CfoConvoyForm(): React.ReactElement {
  const navigate   = useNavigate();
  const queryClient = useQueryClient();
  const params     = useParams({ strict: false }) as { id?: string };
  const isEdit     = Boolean(params.id);

  const { data: existing, isLoading: existingLoading } = useQuery<RawConvoy>({
    queryKey: ['convoys', params.id],
    queryFn: async () => {
      const r = await api.get<{ data: RawConvoy }>(`/convoys/${params.id}`);
      return (r.data as { data?: RawConvoy }).data ?? r.data as RawConvoy;
    },
    enabled: isEdit,
  });

  const { data: vehiclesData } = useQuery<VehicleListResponse>({
    queryKey: ['vehicles', 'form'],
    queryFn: async () => {
      const r = await api.get<VehicleListResponse>('/vehicles', { params: { limit: 200, status: 'active' } });
      return r.data;
    },
  });

  const { data: cfoUsersData } = useQuery<{ data: CfoUser[] }>({
    queryKey: ['cfo-users'],
    queryFn: async () => (await api.get<{ data: CfoUser[] }>('/convoys/cfo-users')).data,
  });

  const { data: clientsData } = useQuery<{ data: CargoClient[] }>({
    queryKey: ['cargo-clients'],
    queryFn: async () => (await api.get<{ data: CargoClient[] }>('/portal/clients')).data,
  });
  // Holds a client created inline via ClientPicker's "+ New" flow so it shows
  // up in the select immediately, without waiting on a cargo-clients refetch.
  const [justCreatedClient, setJustCreatedClient] = useState<CargoClient | null>(null);
  const clientItems = (() => {
    const fromList = clientsData?.data ?? [];
    if (justCreatedClient && !fromList.some((c) => c.id === justCreatedClient.id)) {
      return [...fromList, justCreatedClient];
    }
    return fromList;
  })();

  // Already-assigned vehicles/CFOs — GET /convoys/:id returns these regardless
  // of the vehicle's current status, so a vehicle in maintenance still shows
  // up here even though the active-only /vehicles fetch above would miss it.
  type AssignedVehicle = { id: string; registration?: string | null; make?: string | null; model?: string | null };
  type AssignedCfo = { cfo_user_id: string; cfo_name?: string | null; cfo_email?: string | null };
  const assignedVehicles = (existing?.['vehicles'] as AssignedVehicle[] | undefined) ?? [];
  const assignedCfos = (existing?.['cfos'] as AssignedCfo[] | undefined) ?? [];
  const lockedVehicleIds = new Set(assignedVehicles.map((v) => v.id));
  const lockedCfoIds = new Set(assignedCfos.map((c) => c.cfo_user_id));
  const convoyTrucks = (existing?.['trucks'] as ConvoyTruckRow[] | undefined) ?? [];
  const cfoTruckAssignments = (existing?.['cfo_truck_assignments'] as CfoTruckAssignmentRow[] | undefined) ?? [];

  const vehicleItems = (() => {
    const fromList = vehiclesData?.data.map((v) => ({
      id: v.id,
      label: `${v.registration}${v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}`,
    })) ?? [];
    const seen = new Set(fromList.map((i) => i.id));
    const fromAssigned = assignedVehicles
      .filter((v) => !seen.has(v.id))
      .map((v) => ({ id: v.id, label: `${v.registration ?? v.id.slice(0, 8)}${v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}` }));
    return [...fromList, ...fromAssigned];
  })();

  const cfoItems = (() => {
    const fromList = cfoUsersData?.data.map((u) => ({ id: u.id, label: `${u.name} — ${u.email}` })) ?? [];
    const seen = new Set(fromList.map((i) => i.id));
    const fromAssigned = assignedCfos
      .filter((c) => !seen.has(c.cfo_user_id))
      .map((c) => ({ id: c.cfo_user_id, label: `${c.cfo_name ?? 'CFO'} — ${c.cfo_email ?? c.cfo_user_id.slice(0, 8)}` }));
    return [...fromList, ...fromAssigned];
  })();

  const {
    register, handleSubmit, control, setError, reset, watch,
    formState: { errors, isDirty },
  } = useForm<ConvoyForm>({
    resolver: zodResolver(convoyFormSchema) as Resolver<ConvoyForm>,
    defaultValues: { vehicle_ids: [], cfo_ids: [] },
    ...(existing ? {
      values: {
        name: String(existing['name'] ?? ''),
        region: (existing['region'] as typeof REGIONS[number]) ?? 'Kenya',
        priority: (existing['priority'] as typeof PRIORITIES[number]) ?? 'medium',
        routeOrigin: String(existing['route_origin'] ?? ''),
        routeDestination: String(existing['route_destination'] ?? ''),
        departureTime: existing['departure_time']
          ? String(existing['departure_time']).slice(0, 16) : undefined,
        estimatedArrival: existing['estimated_arrival']
          ? String(existing['estimated_arrival']).slice(0, 16) : undefined,
        description: String(existing['description'] ?? ''),
        clientId: existing['client_id'] ? String(existing['client_id']) : undefined,
        vehicle_ids: [...lockedVehicleIds],
        cfo_ids: [...lockedCfoIds],
      },
    } : {}),
  });

  // Draft persistence (new form only)
  const draftTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isEdit) return;
    draftsTable.get(DRAFT_KEY).then((row) => {
      if (row && confirm('Restore unsaved draft?')) reset(row.data as ConvoyForm);
    }).catch(() => {});
  }, [isEdit, reset]);

  const formValues = watch();
  useEffect(() => {
    if (!isDirty || isEdit) return;
    draftTimer.current = setInterval(() => {
      draftsTable.put({ key: DRAFT_KEY, data: formValues }).catch(() => {});
    }, 2000);
    return () => { if (draftTimer.current) clearInterval(draftTimer.current); };
  }, [isDirty, isEdit, formValues]);

  const mutation = useMutation<void, Error, ConvoyForm>({
    mutationFn: async (data) => {
      const { vehicle_ids, cfo_ids, ...rest } = data;
      let convoyId: string;
      if (isEdit) {
        await api.put(`/convoys/${params.id}`, rest);
        convoyId = params.id!;
      } else {
        const r = await api.post<{ data: { id: string } }>('/convoys', rest);
        convoyId = r.data.data.id;
      }
      // Only submit newly-checked ids — already-assigned ones are locked in
      // the UI and re-posting them would be a redundant (or, for CFOs on a
      // convoy no longer planned/active, rejected) call.
      const newVehicleIds = vehicle_ids.filter((id) => !lockedVehicleIds.has(id));
      const newCfoIds = cfo_ids.filter((id) => !lockedCfoIds.has(id));
      if (newVehicleIds.length) {
        await api.post(`/convoys/${convoyId}/assign`, { vehicleIds: newVehicleIds }).catch(() => {});
      }
      for (const cfo_user_id of newCfoIds) {
        await api.post(`/convoys/${convoyId}/cfos`, { cfo_user_id }).catch(() => {});
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['convoys'] });
      void queryClient.invalidateQueries({ queryKey: ['convoy-reports-overview'] });
      draftsTable.delete(DRAFT_KEY).catch(() => {});
      await navigate({ to: '/convoys' });
    },
    onError: (err) => {
      type ApiErr = { response?: { data?: { error?: string } } };
      const apiMsg = (err as unknown as ApiErr).response?.data?.error;
      setError('root', { message: apiMsg ?? err.message ?? 'Failed to save convoy.' });
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onSubmit = (values: ConvoyForm) => mutation.mutate(values);

  if (isEdit && existingLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 font-mono text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading convoy…
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#04070d] p-6">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
              <Route className="w-4 h-4 text-orange-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide font-mono uppercase">
                {isEdit ? 'Edit Convoy' : 'New Convoy'}
              </h1>
              <p className="text-[10px] text-[#607890] font-mono uppercase tracking-widest mt-0.5">
                {isEdit ? `ID ${params.id?.slice(0, 8)}…` : 'Fleet Operations Center'}
              </p>
            </div>
          </div>
          {isEdit && params.id && (
            <Link to="/route-analysis"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400 border border-white/10 hover:border-orange-500/30 rounded-lg px-3 py-1.5 transition-colors font-mono">
              <ShieldAlert size={12} /> Route Safety
            </Link>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">

          {/* Root error */}
          {errors.root && (
            <div className="flex items-start gap-2.5 bg-red-950/50 border border-red-800/50 rounded-lg px-4 py-3 text-red-400 text-xs font-mono">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {errors.root.message}
            </div>
          )}

          {/* Identity */}
          <Section label="Identity">
            <Field label="Convoy Name" error={errors.name?.message}>
              <input {...register('name')} className={BASE_INPUT} placeholder="KG-003 — Kampala to Goma" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Region" error={errors.region?.message}>
                <select {...register('region')} className={BASE_INPUT + ' cursor-pointer'}>
                  <option value="">Select region…</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Priority" error={errors.priority?.message}>
                <select {...register('priority')} className={BASE_INPUT + ' cursor-pointer'}>
                  <option value="">Select priority…</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Client" error={errors.clientId?.message}>
              <Controller
                name="clientId"
                control={control}
                render={({ field }) => (
                  <ClientPicker
                    value={field.value}
                    onChange={field.onChange}
                    clients={clientItems}
                    onClientCreated={setJustCreatedClient}
                  />
                )}
              />
            </Field>
          </Section>

          {/* Route */}
          <Section label="Route">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Origin" error={errors.routeOrigin?.message}>
                <div className="relative">
                  <MapPin className="absolute left-2.5 top-[11px] w-3 h-3 text-[#304558]" />
                  <input {...register('routeOrigin')} className={BASE_INPUT + ' pl-7'} placeholder="Kampala, UG" />
                </div>
              </Field>
              <Field label="Destination" error={errors.routeDestination?.message}>
                <div className="relative">
                  <MapPin className="absolute left-2.5 top-[11px] w-3 h-3 text-orange-500/50" />
                  <input {...register('routeDestination')} className={BASE_INPUT + ' pl-7'} placeholder="Goma, DRC" />
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Departure" error={errors.departureTime?.message}>
                <input type="datetime-local" {...register('departureTime')}
                  className={BASE_INPUT + ' [color-scheme:dark]'} />
              </Field>
              <Field label="ETA" error={errors.estimatedArrival?.message}>
                <input type="datetime-local" {...register('estimatedArrival')}
                  className={BASE_INPUT + ' [color-scheme:dark]'} />
              </Field>
            </div>
          </Section>

          {/* Assets */}
          <Section label="Assets">
            <Field label="Vehicles" error={errors.vehicle_ids?.message}>
              <Controller
                name="vehicle_ids"
                control={control}
                render={({ field }) => (
                  <MultiSelectList items={vehicleItems} value={field.value} onChange={field.onChange} lockedIds={lockedVehicleIds} />
                )}
              />
              {lockedVehicleIds.size > 0 && (
                <p className="text-[#304558] text-[10px] font-mono mt-1.5">
                  Already-assigned vehicles are locked — removing an assignment isn&apos;t supported from this form yet.
                </p>
              )}
            </Field>
          </Section>

          {/* CFO Assignment */}
          <Section label="CFO Assignment">
            <Field label="Assign CFOs (Guardian App users)" error={undefined}>
              <Controller
                name="cfo_ids"
                control={control}
                render={({ field }) => (
                  <MultiSelectList
                    items={cfoItems}
                    value={field.value}
                    onChange={field.onChange}
                    lockedIds={lockedCfoIds}
                  />
                )}
              />
              {cfoItems.length === 0 && (
                <p className="text-[#304558] text-[10px] font-mono mt-1.5">
                  No CFO users found. Add users with the CFO role in Settings.
                </p>
              )}
            </Field>
          </Section>

          {isEdit && params.id && (
            <TruckRosterSection
              convoyId={params.id}
              vehicles={assignedVehicles}
              cfos={assignedCfos}
              trucks={convoyTrucks}
              assignments={cfoTruckAssignments}
            />
          )}

          {isEdit && params.id && (
            <RouteWaypointsSection convoyId={params.id} />
          )}

          {/* Notes */}
          <Section label="Notes">
            <Field label="Description (optional)" error={errors.description?.message}>
              <textarea {...register('description')} rows={3}
                className={BASE_INPUT + ' resize-none'}
                placeholder="Cargo details, security briefing, special instructions…" />
            </Field>
          </Section>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={mutation.isPending}
              className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-mono font-semibold px-5 py-2.5 rounded-lg text-xs uppercase tracking-wider transition-colors min-w-[148px] justify-center">
              {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Update Convoy' : 'Create Convoy'}
            </button>
            <button type="button" onClick={() => void navigate({ to: '/convoys' })}
              className="px-5 py-2.5 bg-[#07090f] hover:bg-[#09101c] border border-[#122038] hover:border-[#1a2e4a] text-[#607890] hover:text-gray-300 rounded-lg text-xs font-mono font-semibold uppercase tracking-wider transition-colors">
              Cancel
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#07090f] border border-[#122038] rounded-xl p-4 space-y-3">
      <p className="text-[9px] font-mono text-[#304558] uppercase tracking-[.16em] pb-1 border-b border-[#0c1424]">{label}</p>
      {children}
    </div>
  );
}
