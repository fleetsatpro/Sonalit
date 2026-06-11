import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import WarRoom from '../components/WarRoom.js';
import { AlertTriangle, Circle } from 'lucide-react';
const SEVERITY_COLORS = {
    low: 'text-slate-400',
    medium: 'text-yellow-400',
    high: 'text-orange-400',
    critical: 'text-red-400',
};
const STATUS_COLORS = {
    open: 'text-orange-400',
    investigating: 'text-purple-400',
    resolved: 'text-green-400',
    closed: 'text-slate-500',
};
const CAMERA_DEVICE_IDS = ['CAM-001', 'CAM-002', 'CAM-003', 'CAM-004'];
function CameraFeeds({ incidentId }) {
    return (<div className="mt-4">
      <p className="text-xs text-slate-400 uppercase font-medium mb-2">Camera Feeds</p>
      <div className="grid grid-cols-2 gap-2">
        {CAMERA_DEVICE_IDS.map((deviceId) => (<div key={`${incidentId}-${deviceId}`} className="bg-slate-900 border border-slate-700 rounded aspect-video flex items-center justify-center text-slate-500 text-xs">
            <div className="text-center">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-1">
                <span className="text-base">📹</span>
              </div>
              <span>WebRTC stream: {deviceId}</span>
            </div>
          </div>))}
      </div>
    </div>);
}
export default function IncidentCenter() {
    const [selectedId, setSelectedId] = useState(null);
    const { data, isLoading, isError } = useQuery({
        queryKey: ['incidents', 'active'],
        queryFn: async () => {
            const res = await api.get('/incidents');
            const raw = res.data;
            return Array.isArray(raw) ? raw : (raw?.data ?? []);
        },
    });
    const selectedIncident = data?.find((i) => i.id === selectedId) ?? null;
    return (<div className="flex flex-col md:flex-row h-full gap-0 -m-4 md:-m-6">
      {/* Left panel: active incident list */}
      <div className="w-full md:w-80 shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-700 flex flex-col max-h-56 md:max-h-none overflow-y-auto">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-orange-400"/>
            <h2 className="font-bold">Active Incidents</h2>
          </div>
        </div>

        {isLoading && (<div className="p-4 text-slate-400 text-sm">Loading incidents…</div>)}
        {isError && (<div className="p-4 text-red-400 text-sm">Failed to load incidents.</div>)}

        <div className="flex-1 overflow-y-auto">
          {data?.map((incident) => (<button key={incident.id} className={`w-full text-left px-4 py-3 border-b border-slate-700 hover:bg-slate-800 transition-colors ${selectedId === incident.id ? 'bg-slate-800 border-l-2 border-l-blue-500' : ''}`} onClick={() => setSelectedId(incident.id)}>
              <div className="flex items-start gap-2">
                <Circle size={8} className={`mt-1.5 shrink-0 fill-current ${SEVERITY_COLORS[incident.severity]}`}/>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{incident.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs ${SEVERITY_COLORS[incident.severity]}`}>
                      {incident.severity}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className={`text-xs ${STATUS_COLORS[incident.status]}`}>
                      {incident.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(incident.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </button>))}
          {data?.length === 0 && (<div className="p-6 text-center text-slate-500 text-sm">
              No active incidents.
            </div>)}
        </div>
      </div>

      {/* Right panel: selected incident detail + WarRoom */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedIncident ? (<div className="flex items-center justify-center h-full text-slate-500">
            <div className="text-center">
              <AlertTriangle size={48} className="mx-auto mb-3 opacity-30"/>
              <p>Select an incident to open the War Room</p>
            </div>
          </div>) : (<div className="space-y-4">
            <div>
              <h1 className="text-xl font-bold">{selectedIncident.title}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-sm ${SEVERITY_COLORS[selectedIncident.severity]}`}>
                  {selectedIncident.severity} severity
                </span>
                <span className="text-slate-600">·</span>
                <span className={`text-sm ${STATUS_COLORS[selectedIncident.status]}`}>
                  {selectedIncident.status}
                </span>
                {selectedIncident.assigned_to && (<>
                    <span className="text-slate-600">·</span>
                    <span className="text-sm text-slate-400">
                      Assigned: {selectedIncident.assigned_to}
                    </span>
                  </>)}
              </div>
            </div>

            <CameraFeeds incidentId={selectedIncident.id}/>

            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <WarRoom incidentId={selectedIncident.id}/>
            </div>
          </div>)}
      </div>
    </div>);
}
