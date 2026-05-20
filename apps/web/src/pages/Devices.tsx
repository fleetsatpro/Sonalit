import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { api } from '../lib/api.js';

type DeviceStatus = 'online' | 'offline' | 'error';

type Device = {
  id: string;
  serial: string;
  type: string;
  vehicle_plate: string | null;
  status: DeviceStatus;
  firmware_version: string;
  last_ping: string;
  signal_strength: number | null;
  battery_pct: number | null;
};

const STATUS_CONFIG: Record<DeviceStatus, { label: string; dot: string; text: string }> = {
  online: { label: 'Online', dot: 'bg-green-500', text: 'text-green-400' },
  offline: { label: 'Offline', dot: 'bg-slate-500', text: 'text-slate-500' },
  error: { label: 'Error', dot: 'bg-red-500 animate-pulse', text: 'text-red-400' },
};

export default function DevicesPage() {
  const { data, isLoading, isError } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const { data } = await api.get<Device[]>('/devices');
      return data;
    },
    refetchInterval: 30_000,
  });

  const online = data?.filter((d) => d.status === 'online').length ?? 0;
  const errored = data?.filter((d) => d.status === 'error').length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Cpu size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Devices</h1>
        {data && (
          <div className="flex gap-3 text-sm">
            <span className="text-green-400">{online} online</span>
            {errored > 0 && <span className="text-red-400">{errored} errors</span>}
          </div>
        )}
      </div>

      {isLoading && <div className="text-slate-400 text-sm py-12 text-center">Loading devices…</div>}
      {isError && <div className="text-red-400 text-sm py-12 text-center">Failed to load devices.</div>}

      {data && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Serial</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Vehicle</th>
                <th className="px-4 py-3 text-left">Firmware</th>
                <th className="px-4 py-3 text-left">Signal</th>
                <th className="px-4 py-3 text-left">Battery</th>
                <th className="px-4 py-3 text-left">Last Ping</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const cfg = STATUS_CONFIG[d.status];
                return (
                  <tr key={d.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        <span className={`text-xs ${cfg.text}`}>{cfg.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-white text-xs">{d.serial}</td>
                    <td className="px-4 py-3 text-slate-300">{d.type}</td>
                    <td className="px-4 py-3 text-slate-300">{d.vehicle_plate ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{d.firmware_version}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {d.signal_strength !== null ? `${d.signal_strength} dBm` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {d.battery_pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${d.battery_pct > 20 ? 'bg-green-500' : 'bg-red-500'}`}
                              style={{ width: `${d.battery_pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">{d.battery_pct}%</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(d.last_ping).toLocaleString()}</td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">No devices registered.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
