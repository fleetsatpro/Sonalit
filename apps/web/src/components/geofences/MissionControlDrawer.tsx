import { Truck, MapPin, Gauge, Fuel as FuelIcon, Wifi, TrendingUp, Sparkles } from 'lucide-react';
import TrendsPanel from './TrendsPanel.js';
import { STATUS_COLOR, VEHICLE_STATUS_ACTIONS } from './types.js';
import type { MapVehicle, VehicleMeta, VehicleTelemetry, AlertRow, GeofenceEvent } from './types.js';

interface SelectedVehicle { id: string; meta: VehicleMeta | undefined; tel: VehicleTelemetry | undefined; pos: MapVehicle | undefined }

export default function MissionControlDrawer({
  selectedVehicle, vehicles, selectedVehicleId, onSelectVehicle, onSetStatus,
  allAlerts, events, aiText, aiLoading, onFetchAI,
}: {
  selectedVehicle: SelectedVehicle | null;
  vehicles: MapVehicle[];
  selectedVehicleId: string | null;
  onSelectVehicle: (v: MapVehicle) => void;
  onSetStatus: (id: string, status: string) => void;
  allAlerts: AlertRow[];
  events: GeofenceEvent[];
  aiText: string;
  aiLoading: boolean;
  onFetchAI: () => void;
}) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 space-y-4">
      {selectedVehicle ? (
        <div className="bg-gray-900/60 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-black/30 border-b border-gray-700">
            <div className="font-bold text-white">{selectedVehicle.meta?.registration ?? selectedVehicle.pos?.registration}</div>
            <div className="text-xs text-gray-400 font-semibold">{selectedVehicle.meta?.type ?? '—'} · {(selectedVehicle.tel?.status ?? selectedVehicle.pos?.status ?? '—').toUpperCase()}</div>
          </div>
          <div className="p-3 space-y-2 text-sm">
            <Row icon={<Gauge size={13} />} label="Speed" value={`${Math.round(selectedVehicle.tel?.speed_kmh ?? selectedVehicle.pos?.speed_kmh ?? 0)} km/h`} />
            <Row icon={<FuelIcon size={13} />} label="Fuel" value={selectedVehicle.tel?.fuel_pct != null ? `${Math.round(selectedVehicle.tel.fuel_pct)}%` : '—'} />
            <Row icon={<Wifi size={13} />} label="GPS Signal" value={selectedVehicle.tel?.gps_signal_pct != null ? `${Math.round(selectedVehicle.tel.gps_signal_pct)}%` : '—'} />
            <Row icon={<Truck size={13} />} label="Driver" value={selectedVehicle.meta?.driver_name ?? '—'} />
            <Row icon={<MapPin size={13} />} label="Region" value={selectedVehicle.meta?.region ?? '—'} />
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-3 pt-0">
            {VEHICLE_STATUS_ACTIONS.map(a => (
              <button key={a.status} onClick={() => onSetStatus(selectedVehicle.id, a.status)} className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-white py-1.5 rounded">{a.label}</button>
            ))}
          </div>
        </div>
      ) : <div className="text-sm text-gray-400 font-medium bg-gray-900/60 rounded-lg p-3">Select a vehicle marker on the map to view live telemetry and issue commands.</div>}

      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Active Assets ({vehicles.length})</div>
        <div className="max-h-40 overflow-y-auto space-y-1.5">
          {vehicles.map(v => (
            <button key={v.id} onClick={() => onSelectVehicle(v)} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm font-semibold ${selectedVehicleId === v.id ? 'bg-cyan-900/40 text-cyan-300' : 'bg-gray-900/60 text-gray-300 hover:bg-gray-700'}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[v.status] ?? '#666' }} />
              <span className="flex-1 text-left truncate">{v.registration}</span>
              <span className="text-xs text-gray-500 font-medium">{v.status}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><TrendingUp size={12} className="text-orange-400" /> Alert &amp; Event Trends (24h)</div>
        <TrendsPanel alerts={allAlerts} events={events} />
      </div>

      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Sparkles size={12} className="text-violet-400" /> AI Situation Assessment</div>
        {aiLoading && <div className="text-xs text-gray-400 font-medium">Analysing…</div>}
        {!aiLoading && aiText && (
          <div className="bg-gradient-to-br from-cyan-950/40 to-violet-950/40 border border-cyan-800/40 rounded-lg p-3 text-sm text-gray-200 leading-relaxed space-y-2">
            <p>{aiText}</p>
            <button onClick={onFetchAI} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1 rounded">Refresh</button>
          </div>
        )}
        {!aiLoading && !aiText && <button onClick={onFetchAI} className="w-full text-xs font-bold bg-cyan-900/40 border border-cyan-700 text-cyan-300 py-2 rounded">Run AI Assessment</button>}
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-gray-400 font-semibold"><span className="text-gray-500">{icon}</span>{label}</span><span className="font-bold text-white">{value}</span></div>;
}
