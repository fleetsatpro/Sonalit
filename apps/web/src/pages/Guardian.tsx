import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Shield, Terminal, Clock, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { DeadMansSwitchPanel } from '../components/DeadMansSwitchPanel.js';

interface GuardianDevice {
  id: string;
  name: string;
  model: string | null;
  status: string;
  assignment_type: string | null;
  assignment_id: string | null;
  assigned_officer_name: string | null;
  assigned_officer_badge: string | null;
  last_seen: string | null;
  enrolled_at: string;
  pending_commands: number;
}

interface FieldOfficer {
  id: string;
  name: string;
  badge_number: string;
  phone: string;
  status: string;
}

type CommandType =
  | 'request_location'
  | 'force_sync'
  | 'TAKE_PHOTO'
  | 'lock_screen'
  | 'trigger_siren'
  | 'stop_siren'
  | 'restart_agent'
  | 'LOCKDOWN'
  | 'WIPE';

interface DeviceCommand {
  id: string;
  device_id: string;
  device_name: string;
  command_type: string;
  status: string;
  issued_at: string;
  executed_at: string | null;
  result: string | null;
}

interface IssueCommandForm {
  device_id: string;
  command_type: CommandType;
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-yellow-900/60 text-yellow-300',
  sent:     'bg-blue-900/60 text-orange-300',
  executed: 'bg-green-900/60 text-green-300',
  failed:   'bg-red-900/60 text-red-300',
  expired:  'bg-gray-800 text-gray-400',
};

const COMMAND_LABELS: Record<CommandType, string> = {
  request_location: 'Request Location',
  force_sync:       'Force Sync',
  TAKE_PHOTO:       'Capture Photo',
  lock_screen:      'Lock Screen',
  trigger_siren:    'Trigger Siren',
  stop_siren:       'Stop Siren',
  restart_agent:    'Restart Agent',
  LOCKDOWN:         'Lockdown',
  WIPE:             'Wipe Device',
};

export default function Guardian() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IssueCommandForm>({
    device_id: '',
    command_type: 'request_location',
  });
  const [dmsDeviceId, setDmsDeviceId] = useState<string>('');
  const [assigningDevice, setAssigningDevice] = useState<GuardianDevice | null>(null);
  const [selectedOfficerId, setSelectedOfficerId] = useState<string>('');

  const { data: devices, isLoading: devicesLoading, isError: devicesError } = useQuery<GuardianDevice[]>({
    queryKey: ['guardian-devices'],
    queryFn: async () => {
      const res = await api.get<{ data: GuardianDevice[] } | GuardianDevice[]>('/guardian/devices');
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
  });

  const { data: officers } = useQuery<FieldOfficer[]>({
    queryKey: ['field-officers'],
    queryFn: async () => {
      const res = await api.get<{ data: FieldOfficer[] }>('/field-officers');
      return res.data?.data ?? [];
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ deviceId, officerId }: { deviceId: string; officerId: string | null }) =>
      api.patch(`/guardian/devices/${deviceId}`, officerId
        ? { assignment_type: 'officer', assignment_id: officerId }
        : { assignment_type: null }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardian-devices'] });
      setAssigningDevice(null);
      setSelectedOfficerId('');
    },
  });

  const { data: commands, isLoading: commandsLoading } = useQuery<DeviceCommand[]>({
    queryKey: ['guardian-commands'],
    queryFn: async () => {
      const res = await api.get<{ data: DeviceCommand[] }>('/guardian/commands', { params: { limit: 50 } });
      return res.data?.data ?? [];
    },
    refetchInterval: 15_000,
  });

  const issueMutation = useMutation({
    mutationFn: (f: IssueCommandForm) => {
      const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      return api.post(
        `/guardian/devices/${f.device_id}/command`,
        { command_type: f.command_type, nonce },
        { headers: { 'X-Idempotency-Key': crypto.randomUUID() } },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardian-commands'] });
      setForm((f) => ({ ...f, device_id: '' }));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield size={20} className="text-orange-400" />
        <h1 className="text-xl font-bold text-white">Guardian Management</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Enrolled Devices */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-white">Enrolled Devices</h2>
          </div>
          {devicesLoading && <div className="p-4 text-gray-400 text-sm">Loading…</div>}
          {devicesError && <div className="p-4 text-red-400 text-sm">Failed to load devices.</div>}
          <div className="divide-y divide-gray-800">
            {devices?.map((d) => (
              <div key={d.id} className="px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-white">{d.name}</p>
                  <p className="text-xs text-gray-500">
                    {d.model ?? 'Unknown model'} ·{' '}
                    {d.last_seen ? `Last seen ${new Date(d.last_seen).toLocaleString()}` : 'Never seen'}
                  </p>
                  {d.assigned_officer_name && (
                    <p className="text-xs text-indigo-400 mt-0.5 flex items-center gap-1">
                      <UserCheck size={11} />
                      {d.assigned_officer_name}
                      {d.assigned_officer_badge && ` · #${d.assigned_officer_badge}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {d.pending_commands > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-yellow-900/60 text-yellow-300 rounded">
                      {d.pending_commands} pending
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[d.status] ?? 'bg-gray-800 text-gray-400'}`}>
                    {d.status}
                  </span>
                  <button
                    title="Assign to officer"
                    onClick={() => { setAssigningDevice(d); setSelectedOfficerId(d.assignment_id ?? ''); }}
                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                  >
                    <UserCheck size={14} />
                  </button>
                </div>
              </div>
            ))}
            {!devicesLoading && devices?.length === 0 && (
              <div className="p-6 text-center text-gray-500 text-sm">No enrolled devices.</div>
            )}
          </div>
        </div>

        {/* Issue Command */}
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Terminal size={16} className="text-orange-400" />
              <h2 className="text-sm font-semibold text-white">Issue Command</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Device</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={form.device_id}
                  onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
                >
                  <option value="">Select device…</option>
                  {devices?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Command</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={form.command_type}
                  onChange={(e) => setForm((f) => ({ ...f, command_type: e.target.value as CommandType }))}
                >
                  {(Object.entries(COMMAND_LABELS) as [CommandType, string][]).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
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
                className="w-full py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-sm font-medium text-white"
              >
                {issueMutation.isPending ? 'Issuing…' : 'Issue Command'}
              </button>
            </div>
          </div>

          {/* Dead Man's Switch */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Configure DMS for device</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                value={dmsDeviceId}
                onChange={(e) => setDmsDeviceId(e.target.value)}
              >
                <option value="">Select device…</option>
                {devices?.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.status})</option>
                ))}
              </select>
            </div>
            {dmsDeviceId && (
              <DeadMansSwitchPanel
                deviceId={dmsDeviceId}
                deviceName={devices?.find((d) => d.id === dmsDeviceId)?.name ?? dmsDeviceId}
              />
            )}
          </div>

          {/* Recent Commands */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <Clock size={14} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-white">Command Queue</h2>
            </div>
            {commandsLoading && <div className="p-4 text-gray-400 text-sm">Loading…</div>}
            <div className="divide-y divide-gray-800 max-h-60 overflow-y-auto">
              {commands?.map((cmd) => (
                <div key={cmd.id} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[cmd.status] ?? 'bg-gray-800 text-gray-400'}`}>
                        {cmd.status}
                      </span>
                      <span className="text-xs text-gray-300">{cmd.command_type}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {cmd.device_name} · {new Date(cmd.issued_at).toLocaleString()}
                    </p>
                  </div>
                  {cmd.executed_at && (
                    <p className="text-xs text-gray-500">{new Date(cmd.executed_at).toLocaleTimeString()}</p>
                  )}
                </div>
              ))}
              {!commandsLoading && commands?.length === 0 && (
                <div className="p-6 text-center text-gray-500 text-sm">No commands in queue.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Assign Officer Modal */}
      {assigningDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm mx-4 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Assign Officer — {assigningDevice.name}</h3>
              <button onClick={() => setAssigningDevice(null)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Field Officer</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={selectedOfficerId}
                  onChange={(e) => setSelectedOfficerId(e.target.value)}
                >
                  <option value="">— Unassigned —</option>
                  {officers?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · #{o.badge_number}
                    </option>
                  ))}
                </select>
              </div>
              {assignMutation.isError && (
                <p className="text-red-400 text-xs">Failed to update assignment.</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setAssigningDevice(null)}
                  className="flex-1 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={() => assignMutation.mutate({ deviceId: assigningDevice.id, officerId: selectedOfficerId || null })}
                  disabled={assignMutation.isPending}
                  className="flex-1 py-2 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium text-white"
                >
                  {assignMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
