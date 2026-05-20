import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { Shield, Video, List, ChevronDown } from 'lucide-react';

interface CommandLog {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
}

interface ConnectedDevice {
  device_id: string;
}

interface IncidentUpdateEvent {
  incident_id: string;
  action?: string;
  actor?: string;
  devices?: ConnectedDevice[];
}

interface Props {
  incidentId: string;
}

type ActionType = 'dispatch_unit' | 'request_backup' | 'escalate';

export default function WarRoom({ incidentId }: Props) {
  const user = useAuthStore((s) => s.user);
  const [commandLog, setCommandLog] = useState<CommandLog[]>([]);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribe<IncidentUpdateEvent>(
      `org#${user.org_id}`,
      (evt) => {
        if (!evt || evt.incident_id !== incidentId) return;
        if (evt.action) {
          setCommandLog((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              timestamp: new Date().toISOString(),
              action: evt.action ?? '',
              actor: evt.actor ?? 'System',
            },
          ]);
        }
        if (evt.devices) {
          setDevices(evt.devices);
        }
      },
    );
    return unsub;
  }, [user, incidentId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commandLog]);

  const actionMutation = useMutation({
    mutationFn: (action_type: ActionType) =>
      api.post(`/incidents/${incidentId}/actions`, { action_type }),
    onSuccess: (_, action_type) => {
      setCommandLog((prev) => [
        ...prev,
        {
          id: `${Date.now()}-local`,
          timestamp: new Date().toISOString(),
          action: action_type.replace(/_/g, ' '),
          actor: user?.name ?? 'You',
        },
      ]);
    },
  });

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center gap-2 border-b border-slate-700 pb-3">
        <Shield size={18} className="text-blue-400" />
        <h2 className="font-bold text-lg">War Room</h2>
        <span className="text-xs text-slate-400 ml-2">Incident #{incidentId.slice(0, 8)}</span>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        {(['dispatch_unit', 'request_backup', 'escalate'] as ActionType[]).map((action) => (
          <button
            key={action}
            onClick={() => actionMutation.mutate(action)}
            disabled={actionMutation.isPending}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-medium capitalize"
          >
            {action.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Camera Feeds */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Video size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-300">Camera Feeds</span>
        </div>
        {devices.length === 0 ? (
          <div className="bg-slate-900 rounded p-3 text-slate-500 text-sm text-center">
            No devices connected to this incident.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {devices.map((d) => (
              <div
                key={d.device_id}
                className="bg-slate-900 rounded p-3 flex items-center justify-center text-slate-400 text-sm border border-slate-700 aspect-video"
              >
                <div className="text-center">
                  <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-1">
                    <Video size={14} />
                  </div>
                  <span>WebRTC stream: {d.device_id}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Command Log */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <List size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-300">Command Log</span>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-900 rounded border border-slate-700 p-2 space-y-1 max-h-64">
          {commandLog.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">No commands logged yet.</p>
          ) : (
            commandLog.map((entry) => (
              <div key={entry.id} className="flex gap-3 text-xs py-1 border-b border-slate-800 last:border-0">
                <span className="text-slate-500 shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-blue-400 shrink-0 font-medium">{entry.actor}</span>
                <span className="text-slate-300 capitalize">{entry.action}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      <div className="flex items-center gap-1 text-xs text-slate-500">
        <ChevronDown size={12} />
        <span>Live war room — updates via Centrifugo</span>
      </div>
    </div>
  );
}
