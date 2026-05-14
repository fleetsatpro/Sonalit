import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import { Maximize2, X, AlertTriangle, Activity, Truck } from 'lucide-react';
import { alertsAPI, analyticsAPI, vehiclesAPI } from '../services/api';
import socketService from '../services/socket';

const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];

export default function WarRoom() {
  const [active, setActive] = useState(false);
  const [kpis, setKpis] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [regionIdx, setRegionIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      const [kpiRes, alertRes, vRes] = await Promise.all([
        analyticsAPI.dashboard(),
        alertsAPI.list({ resolved: 'false', limit: 10 }),
        vehiclesAPI.list({ limit: 50 }),
      ]);
      setKpis(kpiRes.data.data);
      setAlerts(alertRes.data.data || []);
      setVehicles(vRes.data.data || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const interval = setInterval(load, 15000);
    const rotator = setInterval(() => setRegionIdx(i => (i + 1) % REGIONS.length), 30000);

    const unsubAlert = socketService.onAlert(() => load());
    const unsubVehicle = socketService.onVehicleUpdate((data) => {
      setVehicles(prev => prev.map(v => v.id === data.vehicleId ? { ...v, lat: data.lat, lng: data.lng, speed: data.speed } : v));
    });

    return () => { clearInterval(interval); clearInterval(rotator); unsubAlert(); unsubVehicle(); };
  }, [active, load]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'F11' || (e.altKey && e.key === 'w')) { e.preventDefault(); setActive(a => !a); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!active) return (
    <button onClick={() => setActive(true)}
      className="fixed top-4 right-4 z-40 p-2 bg-navy-800 border border-white/10 rounded-lg text-slate-400 hover:text-gold hover:border-gold/30 transition-all"
      title="War-room mode (Alt+W)">
      <Maximize2 size={14} />
    </button>
  );

  const currentRegion = REGIONS[regionIdx];
  const regionVehicles = vehicles.filter(v => v.region === currentRegion && v.lat && v.lng);
  const center = regionVehicles.length
    ? [regionVehicles.reduce((s,v) => s+v.lat,0)/regionVehicles.length, regionVehicles.reduce((s,v) => s+v.lng,0)/regionVehicles.length]
    : [-1.2921, 36.8219];

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');

  return (
    <div className="fixed inset-0 z-[200] bg-[#030B18] flex flex-col" style={{fontFamily:'var(--font-mono)'}}>
      {/* Top KPI strip */}
      <div className="h-14 flex items-center px-6 gap-8 border-b border-white/5 bg-navy-950">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gold rounded-lg flex items-center justify-center text-navy-950 font-black text-xs">F</div>
          <span className="text-gold font-bold tracking-widest text-sm">FLEETOPS WAR ROOM</span>
        </div>
        <div className="flex items-center gap-1 ml-4">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-success text-xs">LIVE</span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-10">
          {[
            ['ACTIVE CONVOYS', kpis?.activeConvoys ?? '—'],
            ['ACTIVE VEHICLES', kpis?.activeVehicles ?? '—'],
            ['OPEN ALERTS', kpis?.openAlerts ?? '—'],
            ['ON-TIME RATE', kpis?.onTimeRate != null ? `${kpis.onTimeRate}%` : '—'],
            ['FLEET UTIL', kpis?.fleetUtilisation != null ? `${kpis.fleetUtilisation}%` : '—'],
          ].map(([label, val]) => (
            <div key={label} className="text-center">
              <div className="text-[10px] text-slate-500 tracking-widest">{label}</div>
              <div className={`text-xl font-bold ${label.includes('ALERTS') && parseInt(val) > 0 ? 'text-danger' : 'text-gold'}`}>{val}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] text-slate-500">REGION</div>
            <div className="text-sm text-gold font-bold">{currentRegion.toUpperCase()}</div>
          </div>
          <button onClick={() => setActive(false)} className="p-2 hover:text-white text-slate-500 border border-white/10 rounded-lg">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map - 70% */}
        <div className="flex-1" style={{minWidth:0}}>
          <MapContainer
            center={center} zoom={7}
            style={{ width: '100%', height: '100%' }}
            key={currentRegion}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            {regionVehicles.map(v => (
              <Marker key={v.id} position={[v.lat, v.lng]}>
                <Popup>{v.registration} — {v.status} — {v.speed || 0} km/h</Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Alert feed - 30% */}
        <div className="w-80 flex-shrink-0 border-l border-white/5 flex flex-col bg-navy-950">
          <div className="px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-danger" />
              <span className="text-xs text-slate-400 tracking-widest">LIVE ALERTS</span>
              {criticalAlerts.length > 0 && (
                <span className="ml-auto text-[10px] bg-danger/20 text-danger px-2 py-0.5 rounded-full font-bold">
                  {criticalAlerts.length} CRITICAL
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-xs">No open alerts</div>
            ) : alerts.map(a => (
              <div key={a.id} className={`mx-2 mb-2 p-3 rounded-lg border text-xs
                ${a.severity === 'critical' ? 'bg-danger/10 border-danger/20' :
                  a.severity === 'high' ? 'bg-amber-500/10 border-amber-500/20' :
                  'bg-navy-900 border-white/5'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-bold uppercase tracking-wider text-[10px]
                    ${a.severity === 'critical' ? 'text-danger' : a.severity === 'high' ? 'text-amber-400' : 'text-slate-400'}`}>
                    {a.severity}
                  </span>
                  <span className="text-slate-600 text-[10px]">{a.type}</span>
                </div>
                <p className="text-slate-300 leading-snug">{a.message}</p>
                {a.vehicle_reg && <p className="text-slate-500 mt-1">{a.vehicle_reg}</p>}
              </div>
            ))}
          </div>

          {/* Region rotation indicator */}
          <div className="px-4 py-3 border-t border-white/5">
            <div className="flex gap-1.5 justify-center">
              {REGIONS.map((r, i) => (
                <button key={r} onClick={() => setRegionIdx(i)}
                  className={`flex-1 py-1 text-[10px] rounded font-bold transition-colors
                    ${i === regionIdx ? 'bg-gold/20 text-gold border border-gold/30' : 'text-slate-600 hover:text-slate-400'}`}>
                  {r.substring(0,3).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
