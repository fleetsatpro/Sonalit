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
  vehicle_ids: z.array(z.string()).default([]),
  cfo_ids: z.array(z.string()).default([]),
});

type ConvoyForm = z.infer<typeof convoyFormSchema>;
type RawConvoy = Record<string, unknown>;
type VehicleListResponse = { data: Vehicle[] };
type CfoUser = { id: string; name: string; email: string };

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
// CFO truck roster — links an already-assigned vehicle to a driver + position
// (convoy_trucks) and, separately, a CFO to that truck (convoy_cfo_truck_
// assignments). This is what the Guardian CFO app and report generation
// actually read; nothing else in this form writes to either table.
// ---------------------------------------------------------------------------

interface ConvoyTruckRow {
  id: string;
  vehicle_id: string;
  driver_name: string;
  driver_phone: string | null;
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

  const addTruck = useMutation({
    mutationFn: (body: { vehicle_id: string; driver_name: string; driver_phone: string; position: number }) =>
      api.post(`/convoys/${convoyId}/trucks`, body),
    onSuccess: invalidate,
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

  return (
    <Section label="CFO Truck Roster">
      <p className="text-[#607890] text-[10px] font-mono leading-relaxed -mt-1 mb-1">
        The Guardian CFO app and photo reports read from this roster, not from the vehicle list above.
        Each assigned vehicle needs a driver + position here before a CFO can capture photos for it.
      </p>
      {vehicles.length === 0 && (
        <p className="text-[#304558] text-xs font-mono">Assign vehicles above first.</p>
      )}
      <div className="space-y-2">
        {vehicles.map((v) => {
          const truck = trucks.find((t) => t.vehicle_id === v.id) ?? null;
          const assignment = truck ? assignments.find((a) => a.convoy_truck_id === truck.id) ?? null : null;
          const assignedCfo = assignment ? cfos.find((c) => c.cfo_user_id === assignment.cfo_user_id) : null;
          const label = `${v.registration ?? v.id.slice(0, 8)}${v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}`;

          return (
            <div key={v.id} className="bg-[#09101c] border border-[#122038] rounded-md p-3">
              <div className="flex items-center gap-2 text-xs font-mono text-gray-200 mb-2">
                <Truck size={13} className="text-orange-400 flex-shrink-0" />
                <span className="flex-1 truncate">{label}</span>
              </div>

              {!truck ? (
                <AddTruckRow
                  defaultPosition={nextPosition}
                  pending={addTruck.isPending}
                  error={addTruck.error ? extractApiError(addTruck.error, 'Failed to add truck') : null}
                  onAdd={(driverName, driverPhone, position) =>
                    addTruck.mutate({ vehicle_id: v.id, driver_name: driverName, driver_phone: driverPhone, position })}
                />
              ) : (
                <div className="flex items-center justify-between gap-2 pl-[21px]">
                  <div className="text-[11px] font-mono text-[#8098b0]">
                    Position {truck.position} · {truck.driver_name}
                    {truck.driver_phone ? ` · ${truck.driver_phone}` : ''}
                  </div>
                  <button type="button" onClick={() => removeTruck.mutate(truck.id)} disabled={removeTruck.isPending}
                    className="text-[#607890] hover:text-red-400 disabled:opacity-50" title="Remove truck">
                    <X size={13} />
                  </button>
                </div>
              )}

              {truck && (
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
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function AddTruckRow({ defaultPosition, pending, error, onAdd }: {
  defaultPosition: number;
  pending: boolean;
  error: string | null;
  onAdd: (driverName: string, driverPhone: string, position: number) => void;
}) {
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [position, setPosition] = useState(defaultPosition);

  return (
    <div className="pl-[21px] flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input value={driverName} onChange={(e) => setDriverName(e.target.value)}
          placeholder="Driver name" className={BASE_INPUT + ' !py-1.5 !text-[11px] flex-1'} />
        <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)}
          placeholder="Phone (optional)" className={BASE_INPUT + ' !py-1.5 !text-[11px] w-28'} />
        <input type="number" min={1} max={6} value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className={BASE_INPUT + ' !py-1.5 !text-[11px] w-14'} />
        <button type="button" disabled={!driverName.trim() || pending}
          onClick={() => onAdd(driverName.trim(), driverPhone.trim(), position)}
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
