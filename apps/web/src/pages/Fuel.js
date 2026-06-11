import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Fuel, AlertTriangle, BarChart3, MapPin, Plus, CheckCircle, XCircle } from 'lucide-react';
const SEVERITY_COLORS = {
    low: 'text-blue-400',
    medium: 'text-yellow-400',
    high: 'text-orange-400',
    critical: 'text-red-400',
};
const TYPE_LABELS = {
    unknown_location: 'Unknown Location',
    volume_mismatch: 'Volume Mismatch',
    consumption_spike: 'Consumption Spike',
    duplicate_entry: 'Duplicate Entry',
    off_route_refuel: 'Off-Route Refuel',
};
function abbrevAmount(v) {
    if (v >= 1_000_000)
        return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)
        return `${(v / 1_000).toFixed(1)}K`;
    return Math.round(v).toString();
}
export default function FuelPage() {
    const [tab, setTab] = useState('log');
    const [showAddEntry, setShowAddEntry] = useState(false);
    const [showAddStation, setShowAddStation] = useState(false);
    const [newEntry, setNewEntry] = useState({ litres: '', station_name: '', total_cost: '', odometer_km: '', vehicle_id: '' });
    const [newStation, setNewStation] = useState({ name: '', lat: '', lng: '', radius_km: '0.5' });
    const qc = useQueryClient();
    const fuelQ = useQuery({
        queryKey: ['fuel-entries'],
        queryFn: () => api.get('/fuel').then(r => r.data),
        enabled: tab === 'log',
    });
    const anomaliesQ = useQuery({
        queryKey: ['fuel-anomalies'],
        queryFn: () => api.get('/fuel/anomalies').then(r => r.data),
        enabled: tab === 'anomalies',
        refetchInterval: tab === 'anomalies' ? 30_000 : false,
    });
    const summaryQ = useQuery({
        queryKey: ['fuel-summary'],
        queryFn: () => api.get('/fuel/summary').then(r => r.data),
        enabled: tab === 'analytics',
    });
    const stationsQ = useQuery({
        queryKey: ['fuel-stations'],
        queryFn: () => api.get('/fuel/stations').then(r => r.data),
        enabled: tab === 'stations',
    });
    const addEntryMut = useMutation({
        mutationFn: (body) => api.post('/fuel', body, {
            headers: { 'X-Idempotency-Key': `manual-${Date.now()}` },
        }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['fuel-entries'] }); setShowAddEntry(false); setNewEntry({ litres: '', station_name: '', total_cost: '', odometer_km: '', vehicle_id: '' }); },
    });
    const resolveMut = useMutation({
        mutationFn: (id) => api.patch(`/fuel/anomalies/${id}/resolve`, { resolution_note: 'Resolved via dashboard' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['fuel-anomalies'] }),
    });
    const addStationMut = useMutation({
        mutationFn: (body) => api.post('/fuel/stations', body),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['fuel-stations'] }); setShowAddStation(false); setNewStation({ name: '', lat: '', lng: '', radius_km: '0.5' }); },
    });
    const deleteStationMut = useMutation({
        mutationFn: (id) => api.delete(`/fuel/stations/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['fuel-stations'] }),
    });
    const tabs = [
        { id: 'log', label: 'Fuel Log', icon: <Fuel className="w-4 h-4"/> },
        { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle className="w-4 h-4"/> },
        { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4"/> },
        { id: 'stations', label: 'Approved Stations', icon: <MapPin className="w-4 h-4"/> },
    ];
    return (<div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Fuel Management</h1>
        {tab === 'log' && (<button onClick={() => setShowAddEntry(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
            <Plus className="w-4 h-4"/> Log Fuel
          </button>)}
        {tab === 'stations' && (<button onClick={() => setShowAddStation(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
            <Plus className="w-4 h-4"/> Add Station
          </button>)}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        {tabs.map(t => (<button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t.icon} {t.label}
          </button>))}
      </div>

      {/* Fuel Log Tab */}
      {tab === 'log' && (<div className="bg-gray-800 rounded-lg overflow-hidden">
          {fuelQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
          {fuelQ.isError && <div className="p-8 text-center text-red-400">Failed to load fuel entries</div>}
          {fuelQ.data && (<table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3 text-left">Vehicle</th>
                  <th className="p-3 text-left">Driver</th>
                  <th className="p-3 text-right">Litres</th>
                  <th className="p-3 text-right">Cost</th>
                  <th className="p-3 text-left">Station</th>
                  <th className="p-3 text-left">Source</th>
                  <th className="p-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {fuelQ.data.data.map(e => (<tr key={e.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="p-3 font-mono text-xs text-gray-300">{e.vehicle_reg ?? e.vehicle_id?.slice(0, 8) ?? '—'}</td>
                    <td className="p-3 text-gray-300">{e.driver_name ?? '—'}</td>
                    <td className="p-3 text-right text-white">{Number(e.litres).toFixed(1)} L</td>
                    <td className="p-3 text-right text-gray-300">{e.total_cost != null ? `${e.currency} ${abbrevAmount(e.total_cost)}` : '—'}</td>
                    <td className="p-3 text-gray-300">{e.station_name ?? '—'}</td>
                    <td className="p-3"><span className="text-xs bg-gray-700 px-2 py-0.5 rounded">{e.source}</span></td>
                    <td className="p-3 text-gray-400 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                  </tr>))}
                {fuelQ.data.data.length === 0 && (<tr><td colSpan={7} className="p-8 text-center text-gray-500">No fuel entries yet</td></tr>)}
              </tbody>
            </table>)}
        </div>)}

      {/* Anomalies Tab */}
      {tab === 'anomalies' && (<div className="bg-gray-800 rounded-lg overflow-hidden">
          {anomaliesQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
          {anomaliesQ.data && (<table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">Severity</th>
                  <th className="p-3 text-left">Vehicle</th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {anomaliesQ.data.data.map(a => (<tr key={a.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="p-3 text-gray-300">{TYPE_LABELS[a.anomaly_type] ?? a.anomaly_type}</td>
                    <td className={`p-3 font-medium capitalize ${SEVERITY_COLORS[a.severity] ?? 'text-gray-300'}`}>{a.severity}</td>
                    <td className="p-3 font-mono text-xs text-gray-300">{a.vehicle_reg ?? a.vehicle_id?.slice(0, 8) ?? '—'}</td>
                    <td className="p-3 text-gray-400 text-xs max-w-xs truncate">{a.description}</td>
                    <td className="p-3">
                      {a.resolved
                        ? <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle className="w-3 h-3"/> Resolved</span>
                        : <span className="flex items-center gap-1 text-yellow-400 text-xs"><AlertTriangle className="w-3 h-3"/> Open</span>}
                    </td>
                    <td className="p-3 text-gray-400 text-xs">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="p-3">
                      {!a.resolved && (<button onClick={() => resolveMut.mutate(a.id)} className="text-xs text-blue-400 hover:text-blue-300">
                          Resolve
                        </button>)}
                    </td>
                  </tr>))}
                {anomaliesQ.data.data.length === 0 && (<tr><td colSpan={7} className="p-8 text-center text-gray-500">No anomalies detected</td></tr>)}
              </tbody>
            </table>)}
        </div>)}

      {/* Analytics Tab */}
      {tab === 'analytics' && (<div className="space-y-4">
          {summaryQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
          {summaryQ.data && (<div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="p-3 text-left">Vehicle</th>
                    <th className="p-3 text-right">Fill-ups</th>
                    <th className="p-3 text-right">Total Litres</th>
                    <th className="p-3 text-right">Total Cost</th>
                    <th className="p-3 text-right">Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryQ.data.data.map(s => (<tr key={s.vehicle_id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="p-3 font-mono text-xs text-gray-300">{s.registration_number ?? s.vehicle_id?.slice(0, 8)}</td>
                      <td className="p-3 text-right text-white">{s.fill_count}</td>
                      <td className="p-3 text-right text-white">{Number(s.total_litres).toFixed(1)} L</td>
                      <td className="p-3 text-right text-gray-300">{s.total_cost != null ? `KES ${Number(s.total_cost).toFixed(2)}` : '—'}</td>
                      <td className={`p-3 text-right ${Number(s.anomaly_count) > 0 ? 'text-red-400 font-medium' : 'text-gray-400'}`}>{s.anomaly_count}</td>
                    </tr>))}
                  {summaryQ.data.data.length === 0 && (<tr><td colSpan={5} className="p-8 text-center text-gray-500">No data yet</td></tr>)}
                </tbody>
              </table>
            </div>)}
        </div>)}

      {/* Stations Tab */}
      {tab === 'stations' && (<div className="bg-gray-800 rounded-lg overflow-hidden">
          {stationsQ.isLoading && <div className="p-8 text-center text-gray-400">Loading...</div>}
          {stationsQ.data && (<table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-right">Lat</th>
                  <th className="p-3 text-right">Lng</th>
                  <th className="p-3 text-right">Radius (km)</th>
                  <th className="p-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {stationsQ.data.data.map(s => (<tr key={s.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="p-3 text-white">{s.name}</td>
                    <td className="p-3 text-right font-mono text-xs text-gray-300">{Number(s.lat).toFixed(5)}</td>
                    <td className="p-3 text-right font-mono text-xs text-gray-300">{Number(s.lng).toFixed(5)}</td>
                    <td className="p-3 text-right text-gray-300">{s.radius_km}</td>
                    <td className="p-3">
                      <button onClick={() => deleteStationMut.mutate(s.id)} className="text-xs text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    </td>
                  </tr>))}
                {stationsQ.data.data.length === 0 && (<tr><td colSpan={5} className="p-8 text-center text-gray-500">No approved stations configured</td></tr>)}
              </tbody>
            </table>)}
        </div>)}

      {/* Add Fuel Entry Modal */}
      {showAddEntry && (<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Log Fuel Entry</h2>
              <button onClick={() => setShowAddEntry(false)} className="text-gray-400 hover:text-white"><XCircle className="w-5 h-5"/></button>
            </div>
            <div className="space-y-3">
              <input placeholder="Litres *" type="number" value={newEntry.litres} onChange={e => setNewEntry(p => ({ ...p, litres: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Station Name" value={newEntry.station_name} onChange={e => setNewEntry(p => ({ ...p, station_name: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Total Cost" type="number" value={newEntry.total_cost} onChange={e => setNewEntry(p => ({ ...p, total_cost: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Odometer (km)" type="number" value={newEntry.odometer_km} onChange={e => setNewEntry(p => ({ ...p, odometer_km: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowAddEntry(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={() => addEntryMut.mutate({
                litres: parseFloat(newEntry.litres),
                station_name: newEntry.station_name || undefined,
                total_cost: newEntry.total_cost ? parseFloat(newEntry.total_cost) : undefined,
                odometer_km: newEntry.odometer_km ? parseFloat(newEntry.odometer_km) : undefined,
            })} disabled={!newEntry.litres || addEntryMut.isPending} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
                {addEntryMut.isPending ? 'Saving...' : 'Save Entry'}
              </button>
            </div>
            {addEntryMut.isError && <p className="text-red-400 text-xs">Failed to save entry</p>}
          </div>
        </div>)}

      {/* Add Station Modal */}
      {showAddStation && (<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Add Approved Station</h2>
              <button onClick={() => setShowAddStation(false)} className="text-gray-400 hover:text-white"><XCircle className="w-5 h-5"/></button>
            </div>
            <div className="space-y-3">
              <input placeholder="Station Name *" value={newStation.name} onChange={e => setNewStation(p => ({ ...p, name: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Latitude *" type="number" value={newStation.lat} onChange={e => setNewStation(p => ({ ...p, lat: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Longitude *" type="number" value={newStation.lng} onChange={e => setNewStation(p => ({ ...p, lng: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
              <input placeholder="Radius (km)" type="number" value={newStation.radius_km} onChange={e => setNewStation(p => ({ ...p, radius_km: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"/>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowAddStation(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={() => addStationMut.mutate({
                name: newStation.name,
                lat: parseFloat(newStation.lat),
                lng: parseFloat(newStation.lng),
                radius_km: parseFloat(newStation.radius_km),
            })} disabled={!newStation.name || !newStation.lat || !newStation.lng || addStationMut.isPending} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
                {addStationMut.isPending ? 'Saving...' : 'Add Station'}
              </button>
            </div>
            {addStationMut.isError && <p className="text-red-400 text-xs">Failed to add station</p>}
          </div>
        </div>)}
    </div>);
}
