import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Cpu } from 'lucide-react';

interface GuardianDevice {
  id: string;
  name: string;
  model: string | null;
  app_version: string | null;
  status: string;
  assignment_type: string | null;
  last_seen: string | null;
  battery_level: number | null;
  pending_commands: number;
}

const STATUS_BADGES: Record<string, string> = {
  enrolled: 'bg-green-800 text-green-200',
  active: 'bg-green-800 text-green-200',
  pending: 'bg-yellow-800 text-yellow-200',
  revoked: 'bg-red-800 text-red-200',
  inactive: 'bg-slate-700 text-slate-300',
};

export default function Devices() {
  const { data, isLoading, isError } = useQuery<GuardianDevice[]>({
    queryKey: ['guardian-devices-inventory'],
    queryFn: async () => {
      const res = await api.get<{ data: GuardianDevice[] } | GuardianDevice[]>('/guardian/devices');
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
    refetchInterval: 30_000,
  });

  const enrolledCount = data?.filter((d: GuardianDevice) => d.status === 'enrolled' || d.status === 'active').length ?? 0;
  const pendingCount = data?.filter((d: GuardianDevice) => d.status === 'pending').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Cpu size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Guardian Devices</h1>
        {data && (
          <div className="flex gap-3 text-xs ml-1">
            <span className="text-green-400">{enrolledCount} enrolled</span>
            {pendingCount > 0 && <span className="text-yellow-400">{pendingCount} pending</span>}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading devices…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load devices.</div>
      )}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Model</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Seen</th>
                <th className="px-4 py-3 text-left">Battery</th>
                <th className="px-4 py-3 text-left">App Version</th>
                <th className="px-4 py-3 text-left">Pending Cmds</th>
              </tr>
            </thead>
            <tbody>
              {data.map((device) => (
                <tr key={device.id} className="border-t border-slate-700 hover:bg-slate-750">
                  <td className="px-4 py-3 font-medium text-slate-200">{device.name}</td>
                  <td className="px-4 py-3 text-slate-300">{device.model ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[device.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {device.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {device.last_seen ? new Date(device.last_seen).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {device.battery_level !== null ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${device.battery_level > 20 ? 'bg-green-500' : 'bg-red-500'}`}
                            style={{ width: `${device.battery_level}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{device.battery_level}%</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{device.app_version ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {device.pending_commands > 0
                      ? <span className="text-yellow-400 font-medium">{device.pending_commands}</span>
                      : <span className="text-slate-500">0</span>}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No devices registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
