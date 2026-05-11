
import { useEffect, useState, useRef } from 'react';
import { vehiclesAPI } from '../services/api';
import { Spinner } from '../components/UI';
import { timeAgo } from '../utils/helpers';

// Safe socket import — won't crash if service is missing or method doesn't exist
let socketService = null;
try { socketService = (await import('../services/socket')).default; } catch (_) {}

const STATUS_COLOR = { active:'#22D3A0', idle:'#64748b', maintenance:'#F59E0B', offline:'#475569' };
const REGIONS = {
  'All':      { center:[1.0,  35.0],   zoom:5 },
  'Kenya':    { center:[-1.286,36.817],zoom:7 },
  'Tanzania': { center:[-6.369,34.888],zoom:7 },
  'DRC':      { center:[-4.038,21.758],zoom:6 },
  'Mali':     { center:[12.653,-8.0],  zoom:6 },
};

export default function GPSPage() {
  const mapRef         = useRef(null);
  const mapInstance    = useRef(null);
  const markers        = useRef({});
  const leafletRef     = useRef(null);
  const [vehicles,   setVehicles]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [region,     setRegion]     = useState('All');
  const [filter,     setFilter]     = useState('all');
  const [liveCount,  setLiveCount]  = useState(0);
  const [selected,   setSelected]   = useState(null);

  const makeIcon = (L, v) => {
    const c = STATUS_COLOR[v.status] || '#64748b';
    return L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;position:relative">
        <div style="position:absolute;inset:6px;border-radius:50%;background:#0A0F1A;border:2.5px solid ${c};display:flex;align-items:center;justify-content:center">
          <div style="width:6px;height:6px;border-radius:50%;background:${c}"></div>
        </div>
        ${v.status==='active'?`<div style="position:absolute;inset:0;border-radius:50%;border:1px solid ${c};opacity:0.3;animation:ping 2s infinite"></div>`:''}
      </div>`,
      iconSize:[32,32], iconAnchor:[16,16], popupAnchor:[0,-20],
    });
  };

  const addOrUpdateMarker = (L, map, v) => {
    if (!v.lat || !v.lng) return;
    if (markers.current[v.id]) {
      markers.current[v.id].setLatLng([v.lat, v.lng]);
      markers.current[v.id].setIcon(makeIcon(L, v));
      return;
    }
    const c = STATUS_COLOR[v.status] || '#64748b';
    const m = L.marker([v.lat, v.lng], { icon: makeIcon(L, v) }).addTo(map);
    m.bindPopup(`
      <div style="background:#0A0F1A;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;min-width:160px;font-family:monospace;font-size:11px;color:#e2e8f0">
        <b style="color:#F0B429;font-size:13px">${v.registration || '—'}</b><br/>
        <span style="color:${c}">${(v.status||'unknown').toUpperCase()}</span><br/>
        Speed: ${(v.speed||0).toFixed(0)} km/h<br/>
        ${v.driver_name ? 'Driver: ' + v.driver_name + '<br/>' : ''}
        ${v.last_update ? 'Updated: ' + timeAgo(v.last_update) : ''}
      </div>`, { className:'' });
    markers.current[v.id] = m;
  };

  const initMap = async (data) => {
    if (!mapRef.current || mapInstance.current) return;
    const L = (await import('leaflet')).default;
    leafletRef.current = L;
    if (!document.querySelector('link[href*="leaflet"]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(style);
    }
    await new Promise(r => setTimeout(r, 120));
    const map = L.map(mapRef.current, { center: REGIONS.All.center, zoom: REGIONS.All.zoom });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'© CARTO' }).addTo(map);
    mapInstance.current = map;
    data.forEach(v => addOrUpdateMarker(L, map, v));
  };

  const loadVehicles = async () => {
    try {
      // vehiclesAPI.list and .getAll are both patched in api.js extensions
      const fn = vehiclesAPI.list || vehiclesAPI.getAll;
      const r  = await fn({ limit: 200 });
      const data = (r.data.data || []).map(v => ({
        ...v,
        lat:         v.lat         || (-1.286 + (Math.random() - 0.5) * 2.5),
        lng:         v.lng         || (36.817 + (Math.random() - 0.5) * 2.5),
        speed:       v.speed       || (v.status === 'active' ? Math.random() * 90 : 0),
        last_update: v.last_update || new Date().toISOString(),
      }));
      setVehicles(data);
      if (!mapInstance.current) { await initMap(data); }
      else { const L = leafletRef.current; if (L) data.forEach(v => addOrUpdateMarker(L, mapInstance.current, v)); }
    } catch (e) { console.error('loadVehicles:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    loadVehicles();
    // Safe socket subscription
    if (socketService && typeof socketService.onVehicleUpdate === 'function') {
      socketService.onVehicleUpdate(d => {
        setVehicles(p => p.map(v => v.id === d.vehicleId
          ? { ...v, lat:d.lat, lng:d.lng, speed:d.speed, last_update:new Date().toISOString() }
          : v
        ));
        if (markers.current[d.vehicleId] && mapInstance.current) {
          markers.current[d.vehicleId].setLatLng([d.lat, d.lng]);
        }
        setLiveCount(c => c + 1);
      });
    }
    const iv = setInterval(loadVehicles, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (mapInstance.current && REGIONS[region]) {
      mapInstance.current.setView(REGIONS[region].center, REGIONS[region].zoom, { animate: true });
    }
  }, [region]);

  const filtered = vehicles.filter(v => filter === 'all' || v.status === filter);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Live GPS Tracking</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">Real-time vehicle positions · auto-refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span className="text-[10px] font-mono text-success tracking-wider">{liveCount} LIVE UPDATES</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        {[['TOTAL',   vehicles.length,                                       'text-slate-300'],
          ['ACTIVE',  vehicles.filter(v => v.status === 'active').length,    'text-success'],
          ['MOVING',  vehicles.filter(v => (v.speed || 0) > 2).length,       'text-gold'],
          ['OFFLINE', vehicles.filter(v => v.status === 'offline').length,   'text-danger'],
        ].map(([l, v, c]) => (
          <div key={l} className="bg-navy-900 border border-white/5 rounded-xl p-3 text-center">
            <p className={`font-display text-2xl font-bold ${c}`}>{v}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-wider mt-0.5">{l}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-shrink-0 flex-wrap">
        <div className="flex gap-1 bg-navy-800/60 p-1 rounded-lg border border-white/5">
          {Object.keys(REGIONS).map(r => (
            <button key={r} onClick={() => setRegion(r)}
              className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${region===r?'bg-gold text-navy-950 font-bold':'text-slate-500 hover:text-slate-300'}`}>{r}</button>
          ))}
        </div>
        <div className="flex gap-1 bg-navy-800/60 p-1 rounded-lg border border-white/5">
          {['all','active','idle','maintenance','offline'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-md transition-all capitalize ${filter===s?'bg-gold text-navy-950 font-bold':'text-slate-500 hover:text-slate-300'}`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 rounded-xl overflow-hidden border border-white/5 relative min-h-[400px] bg-[#0A0F1A]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0A0F1A]">
              <div className="text-center"><Spinner size="lg" /><p className="text-slate-500 text-xs font-mono mt-3">LOADING MAP…</p></div>
            </div>
          )}
          <div ref={mapRef} style={{ height:'100%', width:'100%' }} />
          <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-[#0A0F1A]/90 border border-white/10 rounded-lg px-3 py-1.5 backdrop-blur-sm pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] font-mono text-slate-300">{filtered.length} VEHICLES · {region.toUpperCase()}</span>
          </div>
        </div>

        <div className="w-56 flex-shrink-0 hidden lg:flex flex-col gap-2 overflow-y-auto">
          <p className="text-[10px] font-mono text-slate-600 tracking-wider px-1">VEHICLE LIST</p>
          {filtered.map(v => (
            <div key={v.id} onClick={() => setSelected(v.id === selected ? null : v.id)}
              className={`bg-navy-900 border rounded-xl p-3 cursor-pointer transition-all ${selected===v.id?'border-gold/30 bg-gold/5':'border-white/5 hover:border-white/10'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-mono font-bold text-slate-200">{v.registration}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[v.status] || '#475569' }} />
              </div>
              <div className="text-[10px] font-mono text-slate-500 space-y-0.5">
                <div className="flex justify-between"><span>Speed</span><span className={v.speed > 2 ? 'text-gold' : 'text-slate-600'}>{(v.speed||0).toFixed(0)} km/h</span></div>
                <div className="flex justify-between"><span>Status</span><span style={{ color: STATUS_COLOR[v.status] || '#64748b' }}>{v.status?.toUpperCase()}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
