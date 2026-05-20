import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '../lib/api.js';

type OfficerStatus = 'active' | 'off_duty' | 'on_patrol';

type FieldOfficer = {
  id: string;
  name: string;
  badge_number: string;
  phone: string;
  status: OfficerStatus;
  current_zone: string | null;
  lat: number | null;
  lon: number | null;
  last_check_in: string;
};

const STATUS_CONFIG: Record<OfficerStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-800 text-green-200' },
  off_duty: { label: 'Off Duty', color: 'bg-slate-700 text-slate-300' },
  on_patrol: { label: 'On Patrol', color: 'bg-blue-800 text-blue-200' },
};

export default function FieldOfficersPage() {
  const { data, isLoading, isError } = useQuery<FieldOfficer[]>({
    queryKey: ['field-officers'],
    queryFn: async () => {
      const { data } = await api.get<FieldOfficer[]>('/field-officers');
      return data;
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Users size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Field Officers</h1>
        {data && <span className="text-sm text-slate-400">{data.length} registered</span>}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading field officers…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load field officers.</div>}

      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Badge</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Zone</th>
                <th className="px-4 py-3 text-left">Last Check-in</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => {
                const cfg = STATUS_CONFIG[o.status];
                return (
                  <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-medium text-white">{o.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{o.badge_number}</td>
                    <td className="px-4 py-3 text-slate-300">{o.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{o.current_zone ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(o.last_check_in).toLocaleString()}</td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No field officers found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
