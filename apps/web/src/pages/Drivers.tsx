import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '../lib/api.js';

type DriverStatus = 'on_duty' | 'off_duty' | 'suspended';

type Driver = {
  id: string;
  name: string;
  license_number: string;
  phone: string;
  status: DriverStatus;
  current_vehicle_plate: string | null;
  trips_this_month: number;
};

const STATUS_CONFIG: Record<DriverStatus, { label: string; color: string }> = {
  on_duty: { label: 'On Duty', color: 'bg-green-800 text-green-200' },
  off_duty: { label: 'Off Duty', color: 'bg-slate-700 text-slate-300' },
  suspended: { label: 'Suspended', color: 'bg-red-900 text-red-200' },
};

export default function DriversPage() {
  const { data, isLoading, isError } = useQuery<Driver[]>({
    queryKey: ['drivers'],
    queryFn: async () => {
      const { data } = await api.get<Driver[]>('/drivers');
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Users size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Drivers</h1>
        {data && <span className="text-sm text-slate-400">{data.length} registered</span>}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading drivers…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load drivers.</div>}

      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">License</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Vehicle</th>
                <th className="px-4 py-3 text-left">Trips (MTD)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const cfg = STATUS_CONFIG[d.status];
                return (
                  <tr key={d.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-medium text-white">{d.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{d.license_number}</td>
                    <td className="px-4 py-3 text-slate-300">{d.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{d.current_vehicle_plate ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{d.trips_this_month}</td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No drivers found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
