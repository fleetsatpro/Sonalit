import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Cpu, Link, X } from 'lucide-react';

type GuardianStatus = 'enrolled' | 'pending' | 'revoked';

interface Device {
  id: string;
  device_id: string;
  vehicle_plate: string | null;
  guardian_status: GuardianStatus;
  last_heartbeat: string;
  battery_level: number | null;
  firmware_version: string;
  cfo_id: string | null;
}

interface LinkCfoPayload {
  cfo_id: string;
}

const STATUS_BADGES: Record<GuardianStatus, string> = {
  enrolled: 'bg-green-800 text-green-200',
  pending: 'bg-yellow-800 text-yellow-200',
  revoked: 'bg-red-800 text-red-200',
};

function LinkCfoForm({
  deviceId,
  onClose,
}: {
  deviceId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [cfoId, setCfoId] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: LinkCfoPayload) =>
      api.post(`/devices/${deviceId}/link-cfo`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      onClose();
    },
  });

  return (
    <div className="flex items-center gap-2 mt-1">
      <input
        className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:border-blue-500"
        placeholder="CFO ID"
        value={cfoId}
        onChange={(e) => setCfoId(e.target.value)}
      />
      <button
        onClick={() => mutation.mutate({ cfo_id: cfoId })}
        disabled={mutation.isPending || !cfoId}
        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-xs"
      >
        {mutation.isPending ? '…' : 'Link'}
      </button>
      <button onClick={onClose} className="text-slate-400 hover:text-white">
        <X size={14} />
      </button>
      {mutation.isError && (
        <span className="text-red-400 text-xs">Failed</span>
      )}
    </div>
  );
}

export default function Devices() {
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await api.get<Device[]>('/devices');
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const enrolledCount = data?.filter((d) => d.guardian_status === 'enrolled').length ?? 0;
  const pendingCount = data?.filter((d) => d.guardian_status === 'pending').length ?? 0;

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
                <th className="px-4 py-3 text-left">Device ID</th>
                <th className="px-4 py-3 text-left">Vehicle</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Heartbeat</th>
                <th className="px-4 py-3 text-left">Battery</th>
                <th className="px-4 py-3 text-left">Firmware</th>
                <th className="px-4 py-3 text-left">CFO</th>
              </tr>
            </thead>
            <tbody>
              {data.map((device) => (
                <tr key={device.id} className="border-t border-slate-700 hover:bg-slate-750">
                  <td className="px-4 py-3 font-mono text-xs text-slate-200">{device.device_id}</td>
                  <td className="px-4 py-3 text-slate-300">{device.vehicle_plate ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[device.guardian_status]}`}>
                      {device.guardian_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(device.last_heartbeat).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {device.battery_level !== null ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              device.battery_level > 20 ? 'bg-green-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${device.battery_level}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{device.battery_level}%</span>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{device.firmware_version}</td>
                  <td className="px-4 py-3">
                    {device.cfo_id ? (
                      <span className="text-xs text-slate-300 font-mono">{device.cfo_id}</span>
                    ) : linkingId === device.id ? (
                      <LinkCfoForm
                        deviceId={device.id}
                        onClose={() => setLinkingId(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setLinkingId(device.id)}
                        className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs"
                      >
                        <Link size={12} />
                        Link CFO
                      </button>
                    )}
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
