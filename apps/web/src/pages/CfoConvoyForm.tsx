import React, { useEffect, useRef, useState } from 'react';
import { useForm, Controller, type SubmitHandler, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useParams, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Route, ShieldAlert } from 'lucide-react';
import Dexie from 'dexie';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import type { Convoy, Vehicle, Driver } from '@sonalit/contracts';

const draftDb = new Dexie('sonalit-drafts');
draftDb.version(1).stores({ drafts: 'key' });
const draftsTable = (draftDb as Dexie & { drafts: Dexie.Table<{ key: string; data: unknown }, string> }).drafts;
const DRAFT_KEY = 'cfo-convoy-form';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const convoyFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(256),
  timezone: z.string().min(1, 'Timezone is required'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  seal_count_per_truck: z.coerce.number().int().min(0).default(0),
  vehicle_ids: z.array(z.string().uuid()).default([]),
  driver_ids: z.array(z.string().uuid()).default([]),
  notes: z.string().max(4096).optional(),
}).refine((d) => d.end_date >= d.start_date, {
  message: 'End date must be on or after start date',
  path: ['end_date'],
});

type ConvoyForm = z.infer<typeof convoyFormSchema>;

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

type VehicleListResponse = { data: Vehicle[]; meta: { total: number; has_more: boolean; next_cursor: string | null } };
type DriverListResponse = { data: Driver[]; meta: { total: number; has_more: boolean; next_cursor: string | null } };

// ---------------------------------------------------------------------------
// Field component
// ---------------------------------------------------------------------------

function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-0.5">{error}</p>}
    </div>
  );
}

const INPUT_CLS = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500';

// ---------------------------------------------------------------------------
// Multi-select checkbox list
// ---------------------------------------------------------------------------

function MultiSelectList<T extends { id: string; label: string }>({
  items,
  value,
  onChange,
}: {
  items: T[];
  value: string[];
  onChange: (v: string[]) => void;
}): React.ReactElement {
  const toggle = (id: string): void => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <div className="max-h-40 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg divide-y divide-gray-700">
      {items.length === 0 && (
        <p className="text-gray-500 text-xs px-3 py-2">No items available</p>
      )}
      {items.map((item) => (
        <label key={item.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-700/50 transition-colors">
          <input
            type="checkbox"
            checked={value.includes(item.id)}
            onChange={() => toggle(item.id)}
            className="accent-indigo-500"
          />
          <span className="text-white text-sm">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form page
// ---------------------------------------------------------------------------

export default function CfoConvoyForm(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const params = useParams({ strict: false }) as { id?: string };
  const isEdit = Boolean(params.id);
  const [, setDraftRestored] = useState<boolean | null>(null);

  // Fetch existing convoy when editing
  const { data: existing, isLoading: existingLoading } = useQuery<Convoy>({
    queryKey: ['convoys', params.id],
    queryFn: async () => {
      const res = await api.get<Convoy>(`/convoys/${params.id}`);
      return res.data;
    },
    enabled: isEdit,
  });

  const { data: vehiclesData } = useQuery<VehicleListResponse>({
    queryKey: ['vehicles', 'form'],
    queryFn: async () => {
      const res = await api.get<VehicleListResponse>('/vehicles', { params: { limit: 200, status: 'active' } });
      return res.data;
    },
  });

  const { data: driversData } = useQuery<DriverListResponse>({
    queryKey: ['drivers', 'form'],
    queryFn: async () => {
      const res = await api.get<DriverListResponse>('/drivers', { params: { limit: 200, status: 'active' } });
      return res.data;
    },
  });

  const vehicleItems = vehiclesData?.data.map((v) => ({ id: v.id, label: `${v.registration} — ${v.make} ${v.model}` })) ?? [];
  const driverItems = driversData?.data.map((d) => ({ id: d.id, label: `${d.name} (${d.license_number})` })) ?? [];

  const {
    register,
    handleSubmit,
    control,
    setError,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<ConvoyForm>({
    resolver: zodResolver(convoyFormSchema) as Resolver<ConvoyForm>,
    defaultValues: { seal_count_per_truck: 0, vehicle_ids: [] as string[], driver_ids: [] as string[] },
    ...(existing
      ? {
          values: {
            name: existing.name,
            timezone: existing.timezone,
            start_date: existing.start_date,
            end_date: existing.end_date,
            seal_count_per_truck: existing.seal_count_per_truck,
            vehicle_ids: [] as string[],
            driver_ids: [] as string[],
            notes: '' as string | undefined,
          },
        }
      : {}),
  });

  // T4.4: Draft persistence — restore on new form mount
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isEdit) { setDraftRestored(false); return; }
    draftsTable.get(DRAFT_KEY).then((row) => {
      if (row && confirm('Restore unsaved draft?')) {
        reset(row.data as ConvoyForm);
        setDraftRestored(true);
      } else {
        setDraftRestored(false);
      }
    }).catch(() => setDraftRestored(false));
  }, [isEdit, reset]);

  const formValues = watch();
  useEffect(() => {
    if (!isDirty || isEdit) return;
    draftTimerRef.current = setInterval(() => {
      draftsTable.put({ key: DRAFT_KEY, data: formValues }).catch(() => {});
    }, 2000);
    return () => { if (draftTimerRef.current) clearInterval(draftTimerRef.current); };
  }, [isDirty, isEdit, formValues]);

  const mutation = useMutation<Convoy, Error, ConvoyForm>({
    mutationFn: async (data) => {
      const payload = { ...data, org_id: user?.org_id };
      if (isEdit) {
        const res = await api.patch<Convoy>(`/convoys/${params.id}`, payload);
        return res.data;
      }
      const res = await api.post<Convoy>('/convoys', payload);
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['convoys'] });
      draftsTable.delete(DRAFT_KEY).catch(() => {});
      await navigate({ to: '/convoys' });
    },
    onError: (err) => {
      setError('root', { message: err.message ?? 'Failed to save convoy.' });
    },
  });

  const onSubmit: SubmitHandler<ConvoyForm> = (values) => {
    mutation.mutate(values);
  };

  if (isEdit && existingLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading convoy…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Route className="w-5 h-5 text-orange-400" />
          <h1 className="text-xl font-bold text-white">{isEdit ? 'Edit Convoy' : 'New Convoy'}</h1>
        </div>
        {isEdit && params.id && (
          <Link
            to="/route-analysis"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-400 border border-white/10 hover:border-orange-500/40 rounded-lg px-3 py-1.5 transition-colors"
          >
            <ShieldAlert size={13} /> Route Safety Analysis
          </Link>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {errors.root && (
          <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {errors.root.message}
          </div>
        )}

        <Field label="Convoy Name" error={errors.name?.message}>
          <input {...register('name')} className={INPUT_CLS} placeholder="Convoy Alpha — Lagos to Abuja" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start Date (YYYY-MM-DD)" error={errors.start_date?.message}>
            <input {...register('start_date')} className={INPUT_CLS} placeholder="2026-06-01" />
          </Field>
          <Field label="End Date (YYYY-MM-DD)" error={errors.end_date?.message}>
            <input {...register('end_date')} className={INPUT_CLS} placeholder="2026-06-03" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Timezone (IANA)" error={errors.timezone?.message}>
            <input {...register('timezone')} className={INPUT_CLS} placeholder="Africa/Lagos" />
          </Field>
          <Field label="Seals per Truck" error={errors.seal_count_per_truck?.message}>
            <input type="number" min={0} {...register('seal_count_per_truck')} className={INPUT_CLS} />
          </Field>
        </div>

        <Field label="Vehicles" error={errors.vehicle_ids?.message}>
          <Controller
            name="vehicle_ids"
            control={control}
            render={({ field }) => (
              <MultiSelectList
                items={vehicleItems}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </Field>

        <Field label="Drivers" error={errors.driver_ids?.message}>
          <Controller
            name="driver_ids"
            control={control}
            render={({ field }) => (
              <MultiSelectList
                items={driverItems}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </Field>

        <Field label="Notes (optional)" error={errors.notes?.message}>
          <textarea
            {...register('notes')}
            rows={3}
            className={`${INPUT_CLS} resize-none`}
            placeholder="Additional details…"
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Update Convoy' : 'Create Convoy'}
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: '/convoys' })}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
