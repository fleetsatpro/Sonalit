import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import type { Vehicle } from '@sonalit/contracts';

// Mirrors the backend validator (vehicleController.js): type/region are fixed
// enums, capacity is required, identity fields are optional. The previous form
// posted a different type enum plus an org_id key the API rejects, so vehicle
// creation always failed with a 400.
const VEHICLE_TYPES = ['Truck', 'Van', 'SUV', 'APC', 'Motorcycle'] as const;
const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'] as const;

const vehicleFormSchema = z.object({
  registration: z.string().min(3, 'Min 3 chars').max(20),
  type: z.enum(VEHICLE_TYPES),
  region: z.enum(REGIONS),
  capacity: z.coerce.number().int().min(1).max(50),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  year: z.union([z.coerce.number().int().min(1900).max(2100), z.literal('')]).optional(),
  vin: z.string().max(50).optional(),
});
type VehicleForm = z.infer<typeof vehicleFormSchema>;

interface Props {
  onClose: () => void;
}

export function AddVehicleForm({ onClose }: Props): React.ReactElement {
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VehicleForm>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: { type: 'Truck', region: 'Kenya', capacity: 4 },
  });

  const createMutation = useMutation<Vehicle, Error, VehicleForm>({
    mutationFn: async (data) => {
      const res = await api.post<Vehicle>('/vehicles', {
        registration: data.registration,
        type: data.type,
        region: data.region,
        capacity: data.capacity,
        make: data.make || null,
        model: data.model || null,
        year: data.year === '' || data.year == null ? null : data.year,
        vin: data.vin || null,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      reset();
      onClose();
    },
  });

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold">Add Vehicle</h3>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Plate / Registration *</label>
            <input {...register('registration')} placeholder="KEN-017" className={inputCls} />
            {errors.registration && <p className="text-red-400 text-xs mt-0.5">{errors.registration.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type *</label>
            <select {...register('type')} className={inputCls}>
              {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Region *</label>
            <select {...register('region')} className={inputCls}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Capacity (seats) *</label>
            <input type="number" min={1} max={50} {...register('capacity')} className={inputCls} />
            {errors.capacity && <p className="text-red-400 text-xs mt-0.5">{errors.capacity.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Make</label>
            <input {...register('make')} placeholder="Toyota" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Model</label>
            <input {...register('model')} placeholder="Land Cruiser 79" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Year</label>
            <input type="number" {...register('year')} placeholder="2022" className={inputCls} />
            {errors.year && <p className="text-red-400 text-xs mt-0.5">Enter a valid year</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">VIN</label>
            <input {...register('vin')} maxLength={50} className={`${inputCls} font-mono`} />
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
