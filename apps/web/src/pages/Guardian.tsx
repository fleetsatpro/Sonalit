import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Shield, Terminal, Clock } from 'lucide-react';
import { useState } from 'react';

interface GuardianDevice {
  id: string;
  device_id: string;
  vehicle_plate: string | null;
  enrolled_at: string;
  status: string;
}

type CommandType = 'reboot' | 'lock' | 'wipe' | 'photo';

interface PendingCommand {
  id: string;
  device_id: string;
  command_type: CommandType;
  created_at: string;
  ack: boolean;
  ack_at: string | null;
}

interface IssueCommandPayload {
  device_id: string;
  command_type: CommandType;
}

const COMMAND_COLORS: Record<CommandType, string> = {
  reboot: 'bg-blue-800 text-blue-200',
  lock: 'bg-yellow-800 text-yellow-200',
  wipe: 'bg-red-800 text-red-200',
  photo: 'bg-green-800 text-green-200',
};

export default function Guardian() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IssueCommandPayload>({
    device_id: '',
    command_type: 'reboot',
  });

  const { data: devices, isLoading: devicesLoading, isError: devicesError } = useQuery<GuardianDevice[]>({
    queryKey: ['guardian-devices'],
    queryFn: async () => {
      const res = await api.get<GuardianDevice[]>('/guardian/devices');
      return res.data;
    },
  });

  const { data: commands, isLoading: commandsLoading } = useQuery<PendingCommand[]>({
    queryKey: ['guardian-commands'],
    queryFn: async () => {
      const res = await api.get<PendingCommand[]>('/guardian/commands');
      return res.data;
    },
    refetchInterval: 15_000,
  });

  const issueMutation = useMutation({
    mutationFn: (payload: IssueCommandPayload) =>
      api.post('/guardian/commands', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardian-commands'] });
      setForm((f) => ({ ...f, device_id: '' }));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold">Guardian Management</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Enrolled Devices */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-900">
            <h2 className="text-sm font-semibold">Enrolled Devices</h2>
          </div>
          {devicesLoading && (
            <div className="p-4 text-slate-400 text-sm">Loading…</div>
          )}
          {devicesError && (
            <div className="p-4 text-red-400 text-sm">Failed to load devices.</div>
          )}
          <div className="divide-y divide-slate-700">
            {devices?.map((d) => (
              <div key={d.id} className="px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-sm font-mono font-medium">{d.device_id}</p>
                  <p className="text-xs text-slate-500">
                    {d.vehicle_plate ?? 'Unassigned'} · Enrolled {new Date(d.enrolled_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 bg-green-800 text-green-200 rounded">{d.status}</span>
              </div>
            ))}
            {devices?.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-sm">No enrolled devices.</div>
            )}
          </div>
        </div>

        {/* Issue Command */}
        <div className="space-y-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Terminal size={16} className="text-blue-400" />
              <h2 className="text-sm font-semibold">Issue Command</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Device ID</label>
                <select
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  value={form.device_id}
                  onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
                >
                  <option value="">Select device…</option>
                  {devices?.map((d) => (
                    <option key={d.id} value={d.device_id}>
                      {d.device_id}{d.vehicle_plate ? ` (${d.vehicle_plate})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Command</label>
                <select
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  value={form.command_type}
                  onChange={(e) => setForm((f) => ({ ...f, command_type: e.target.value as CommandType }))}
                >
                  <option value="reboot">Reboot</option>
                  <option value="lock">Lock</option>
                  <option value="wipe">Wipe</option>
                  <option value="photo">Capture Photo</option>
                </select>
              </div>
              {issueMutation.isError && (
                <p className="text-red-400 text-xs">Failed to issue command.</p>
              )}
              {issueMutation.isSuccess && (
                <p className="text-green-400 text-xs">Command issued successfully.</p>
              )}
              <button
                onClick={() => issueMutation.mutate(form)}
                disabled={issueMutation.isPending || !form.device_id}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
              >
                {issueMutation.isPending ? 'Issuing…' : 'Issue Command'}
              </button>
            </div>
          </div>

          {/* Pending Commands */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 bg-slate-900 flex items-center gap-2">
              <Clock size={14} className="text-slate-400" />
              <h2 className="text-sm font-semibold">Command Queue</h2>
            </div>
            {commandsLoading && (
              <div className="p-4 text-slate-400 text-sm">Loading…</div>
            )}
            <div className="divide-y divide-slate-700 max-h-56 overflow-y-auto">
              {commands?.map((cmd) => (
                <div key={cmd.id} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${COMMAND_COLORS[cmd.command_type]}`}>
                        {cmd.command_type}
                      </span>
                      <span className="text-xs font-mono text-slate-300">{cmd.device_id}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(cmd.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    {cmd.ack ? (
                      <span className="text-xs text-green-400">ACK'd</span>
                    ) : (
                      <span className="text-xs text-yellow-400">Pending</span>
                    )}
                    {cmd.ack_at && (
                      <p className="text-xs text-slate-500">{new Date(cmd.ack_at).toLocaleTimeString()}</p>
                    )}
                  </div>
                </div>
              ))}
              {commands?.length === 0 && (
                <div className="p-6 text-center text-slate-500 text-sm">No commands in queue.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
