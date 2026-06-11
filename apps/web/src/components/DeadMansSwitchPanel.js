import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Timer, Power, PauseCircle, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
export function DeadMansSwitchPanel({ deviceId, deviceName }) {
    const queryClient = useQueryClient();
    const [timeoutMinutes, setTimeoutMinutes] = useState(60);
    const [suspendMinutes, setSuspendMinutes] = useState(30);
    const { data, isLoading, isError } = useQuery({
        queryKey: ['device-dms', deviceId],
        queryFn: () => api.get(`/guardian/devices/${deviceId}/dms`).then((r) => r.data),
    });
    const patchDms = useMutation({
        mutationFn: (body) => api.patch(`/guardian/devices/${deviceId}/dms`, body),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['device-dms', deviceId] });
        },
    });
    const dms = data?.data;
    const isSuspended = !!dms?.dms_suspended_until &&
        new Date(dms.dms_suspended_until).getTime() > Date.now();
    const lastCheckin = dms?.last_checkin_at
        ? new Date(dms.last_checkin_at).toLocaleString()
        : 'Never';
    if (isLoading) {
        return (<div className="flex items-center gap-2 text-gray-400 text-sm p-4">
        <Loader2 className="w-4 h-4 animate-spin"/> Loading DMS config…
      </div>);
    }
    if (isError || !dms) {
        return (<div className="flex items-center gap-2 text-red-400 text-sm p-4">
        <AlertTriangle className="w-4 h-4"/> Failed to load DMS config.
      </div>);
    }
    return (<div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="w-4 h-4 text-orange-400"/>
          <span className="text-sm font-semibold text-white">Dead Man's Switch</span>
          <span className="font-mono text-xs text-gray-500">{deviceName}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border ${dms.dms_enabled
            ? isSuspended
                ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700'
                : 'bg-green-900/50 text-green-300 border-green-700'
            : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
          {dms.dms_enabled ? (isSuspended ? 'suspended' : 'active') : 'disabled'}
        </span>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-800 rounded-lg p-2.5">
          <p className="text-gray-500 mb-0.5">Timeout</p>
          <p className="text-white">{dms.dms_timeout_minutes ?? '—'} min</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-2.5">
          <p className="text-gray-500 mb-0.5">Last check-in</p>
          <p className="text-white">{lastCheckin}</p>
        </div>
        {isSuspended && (<div className="col-span-2 bg-yellow-900/30 border border-yellow-800/50 rounded-lg p-2.5">
            <p className="text-yellow-400 text-xs">
              Suspended until {new Date(dms.dms_suspended_until).toLocaleString()}
            </p>
          </div>)}
      </div>

      {/* Enable / disable */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">Timeout (minutes)</label>
          <input type="number" min={1} max={1440} value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm"/>
        </div>
        {dms.dms_enabled ? (<button type="button" disabled={patchDms.isPending} onClick={() => patchDms.mutate({ dms_enabled: false })} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded transition-colors">
            <Power className="w-3.5 h-3.5"/> Disable
          </button>) : (<button type="button" disabled={patchDms.isPending} onClick={() => patchDms.mutate({ dms_enabled: true, dms_timeout_minutes: timeoutMinutes })} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded transition-colors">
            <Power className="w-3.5 h-3.5"/> Enable
          </button>)}
      </div>

      {/* Suspend */}
      {dms.dms_enabled && (<div className="flex items-end gap-3 pt-1 border-t border-gray-800">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Suspend for (minutes)</label>
            <input type="number" min={1} max={1440} value={suspendMinutes} onChange={(e) => setSuspendMinutes(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm"/>
          </div>
          <button type="button" disabled={patchDms.isPending} onClick={() => patchDms.mutate({ suspend_minutes: suspendMinutes })} className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white text-sm rounded transition-colors">
            <PauseCircle className="w-3.5 h-3.5"/> Suspend
          </button>
          {isSuspended && (<button type="button" disabled={patchDms.isPending} onClick={() => patchDms.mutate({ suspend_minutes: 0 })} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors">
              Clear
            </button>)}
        </div>)}

      {patchDms.isError && (<p className="text-red-400 text-xs flex items-center gap-1">
          <AlertTriangle className="w-3 h-3"/> Failed to update DMS config.
        </p>)}
    </div>);
}
