import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Cpu, AlertTriangle } from 'lucide-react';

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
  enrolled_at?: string | null;
}

const STATUS_BADGES: Record<string, string> = {
  enrolled: 'bg-green-800 text-green-200',
  active: 'bg-green-800 text-green-200',
  pending: 'bg-yellow-800 text-yellow-200',
  revoked: 'bg-red-800 text-red-200',
  inactive: 'bg-slate-700 text-slate-300',
};

export default function Devices() {
  const qc = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<GuardianDevice[]>({
    queryKey: ['guardian-devices-inventory'],
    queryFn: async () => {
      const res = await api.get<{ data: GuardianDevice[] } | GuardianDevice[]>('/guardian/devices');
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
    refetchInterval: 30_000,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/guardian/devices/${id}`),
    onMutate: (id) => setRevokingId(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guardian-devices-inventory'] }),
    onSettled: () => setRevokingId(null),
  });

  // A device's `name` is its enrollment identity (the operator/badge code for
  // officer phones) — two non-revoked rows sharing one almost always means
  // the same physical officer re-enrolled on new hardware before the
  // retire-on-re-enroll fix landed, leaving the old row orphaned. Flag them
  // so ops can review and manually revoke the stale one(s) below.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of data ?? []) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
  }, [data]);

  const enrolledCount = data?.filter((d: GuardianDevice) => d.status === 'enrolled' || d.status === 'active').length ?? 0;
  const pendingCount = data?.filter((d: GuardianDevice) => d.status === 'pending').length ?? 0;
  const duplicateCount = data?.filter((d) => duplicateNames.has(d.name)).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Cpu size={20} className="text-orange-400" />
        <h1 className="text-xl font-bold">Guardian Devices</h1>
        {data && (
          <div className="flex gap-3 text-xs ml-1">
            <span className="text-green-400">{enrolledCount} enrolled</span>
            {pendingCount > 0 && <span className="text-yellow-400">{pendingCount} pending</span>}
            {duplicateCount > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle size={12} /> {duplicateCount} possible duplicates
              </span>
            )}
          </div>
        )}
      </div>

      {duplicateCount > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            Rows highlighted below share the same enrollment name — usually the same officer's
            badge code enrolled on more than one physical device (old phone never retired).
            Confirm which one is current, then use <span className="font-mono">Revoke</span> on the stale entry.
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading devices…</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm py-8 text-center">Failed to load devices.</div>
      )}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-x-auto">
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
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((device) => {
                const isDup = duplicateNames.has(device.name);
                return (
                  <tr key={device.id} className={`border-t border-slate-700 hover:bg-slate-750 ${isDup ? 'bg-amber-950/20' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-200">
                      <div className="flex items-center gap-1.5">
                        {device.name}
                        {isDup && <AlertTriangle size={12} className="text-amber-400" />}
                      </div>
                    </td>
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
                    <td className="px-4 py-3">
                      <button
                        onClick={() => window.confirm(`Revoke device "${device.name}"? This cannot be undone from the UI.`) && revokeMutation.mutate(device.id)}
                        disabled={revokingId === device.id}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 font-medium"
                      >
                        {revokingId === device.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
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
