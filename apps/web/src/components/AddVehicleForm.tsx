import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import type { Vehicle } from '@sonalit/contracts';

const vehicleFormSchema = z.object({
  registration: z.string().min(1, 'Required').max(32),
  make: z.string().min(1, 'Required').max(128),
  model: z.string().min(1, 'Required').max(128),
  year: z.coerce.number().int().min(1900).max(2100),
  type: z.enum(['truck', 'van', 'pickup', 'tanker', 'flatbed', 'refrigerated', 'armoured', 'other']),
  vin: z.string().length(17).regex(/^[A-HJ-NPR-Z0-9]{17}$/).nullable().optional(),
});
type VehicleForm = z.infer<typeof vehicleFormSchema>;

interface Props {
  onClose: () => void;
}

export function AddVehicleForm({ onClose }: Props): React.ReactElement {
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
            <label className="block text-xs text-gray-400 mb-1">Plate / Registration</label>
            <input {...register('registration')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.registration && <p className="text-red-400 text-xs mt-0.5">{errors.registration.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Make</label>
            <input {...register('make')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.make && <p className="text-red-400 text-xs mt-0.5">{errors.make.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Model</label>
            <input {...register('model')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.model && <p className="text-red-400 text-xs mt-0.5">{errors.model.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Year</label>
            <input type="number" {...register('year')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            {errors.year && <p className="text-red-400 text-xs mt-0.5">{errors.year.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <select {...register('type')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
              {['truck','van','pickup','tanker','flatbed','refrigerated','armoured','other'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
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
