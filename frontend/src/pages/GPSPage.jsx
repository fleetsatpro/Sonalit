import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, Truck, Shield, AlertTriangle, Radio, Maximize2, Filter } from 'lucide-react';
import { vehiclesAPI } from '../services/api';
import socketService from '../services/socket';
import { Badge, Card, Spinner } from '../components/UI';
import { timeAgo } from '../utils/helpers';

// Fix leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STATUS_COLOR = {
  active: '#22D3A0',
  idle: '#64748b',
  maintenance: '#F59E0B',
  offline: '#475569',
};

function createVehicleIcon(status, speed) {
  const color = STATUS_COLOR[status] || '#64748b';
  const isMoving = speed > 2;
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:36px;height:36px;">
        ${isMoving ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.2;animation:ping 1.5s ease-in-out infinite;"></div>` : ''}
        <div style="position:absolute;inset:4px;border-radius:50%;background:#0A0F1A;border:2px solid ${color};display:flex;align-items:center;justify-content:center;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${color}">
            <path d="M1 3h15l3 5h4l1 5H1V3zm0 9v6h2a2 2 0 004 0h8a2 2 0 004 0h2v-6H1z"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom || map.getZoom());
  }, [center]);
  return null;
}

function VehicleMarker({ vehicle }) {
  const pos = vehicle.lat && vehicle.lng ? [vehicle.lat, vehicle.lng] : null;
  if (!pos) return null;
  const icon = createVehicleIcon(vehicle.status, vehicle.speed || 0);
  return (
    <Marker position={pos} icon={icon}>
      <Popup className="leaflet-popup-dark">
        <div style={{ background: '#0A0F1A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 12, minWidth: 180, color: '#e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#F0B429', fontSize: 13 }}>{vehicle.registration}</span>
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: vehicle.status === 'active' ? 'rgba(34,211,160,0.15)' : 'rgba(100,116,139,0.15)', color: vehicle.status === 'active' ? '#22D3A0' : '#94a3b8', fontFamily: 'monospace' }}>
              {vehicle.status?.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', lineHeight: 1.8 }}>
            <div>🚀 Speed: <span style={{ color: '#e2e8f0' }}>{vehicle.speed?.toFixed(0) || 0} km/h</span></div>
            <div>📍 {pos[0].toFixed(4)}, {pos[1].toFixed(4)}</div>
            {vehicle.driver_name && <div>👤 {vehicle.driver_name}</div>}
            {vehicle.convoy_name && <div>🛡 {vehicle.convoy_name}</div>}
            {vehicle.last_update && <div>🕐 {timeAgo(vehicle.last_update)}</div>}
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

const REGIONS = {
  'All':      { center: [1.0, 35.0],  zoom: 5  },
  'Kenya':    { center: [-1.286, 36.817], zoom: 7 },
  'Tanzania': { center: [-6.369, 34.888], zoom: 7 },
  'DRC':      { center: [-4.038, 21.758], zoom: 6 },
  'Mali':     { center: [12.653, -8.000], zoom: 6 },
};

export default function GPSPage() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState('All');
  const [filter, setFilter] = useState('all');
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const mapCenter = REGIONS[region];

  // Load vehicles with GPS data
  const loadVehicles = async () => {
    try {
      const r = await vehiclesAPI.list({ limit: 100 });
      const data = r.data.data || [];
      // Seed demo GPS if no coords (for testing)
      const withGPS = data.map((v, i) => ({
        ...v,
        lat: v.lat || (-1.286 + (Math.random() - 0.5) * 4),
        lng: v.lng || (36.817 + (Math.random() - 0.5) * 4),
        speed: v.speed || (v.status === 'active' ? Math.random() * 120 : 0),
        last_update: v.last_update || new Date().toISOString(),
      }));
      setVehicles(withGPS);
    } catch (e) {
      console.error('GPS load error:', e);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    loadVehicles();

    // Live GPS updates via socket
    socketService.onVehicleUpdate((data) => {
      setVehicles(prev => prev.map(v =>
        v.id === data.vehicleId
          ? { ...v, lat: data.lat, lng: data.lng, speed: data.speed, last_update: new Date().toISOString() }
          : v
      ));
      setLiveCount(c => c + 1);
    });

    const interval = setInterval(loadVehicles, 30000);
    return () => clearInterval(interval);
  }, []);

  const filtered = vehicles.filter(v => filter === 'all' || v.status === filter);
  const activeCount = vehicles.filter(v => v.status === 'active').length;
  const movingCount = vehicles.filter(v => (v.speed || 0) > 2).length;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Live GPS Tracking</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">Real-time vehicle positions · Socket.IO</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span className="text-[10px] font-mono text-success tracking-wider">{liveCount} UPDATES</span>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: 'TOTAL',      value: vehicles.length, color: 'text-slate-300' },
          { label: 'ACTIVE',     value: activeCount,     color: 'text-success'   },
          { label: 'MOVING',     value: movingCount,     color: 'text-gold'      },
          { label: 'LIVE PINGS', value: liveCount,       color: 'text-blue-400'  },
        ].map(s => (
          <div key={s.label} className="bg-navy-900 border border-white/5 rounded-xl p-3 text-center">
            <p className={`font-display text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[9px] font-mono text-slate-600 tracking-wider mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        <div className="flex gap-1 bg-navy-800/60 p-1 rounded-lg border border-white/5">
          {Object.keys(REGIONS).map(r => (
            <button key={r} onClick={() => setRegion(r)}
              className={`px-3 py-1 text-xs font-mono rounded-md transition-all ${region === r ? 'bg-gold text-navy-950 font-bold' : 'text-slate-500 hover:text-slate-300'}`}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-navy-800/60 p-1 rounded-lg border border-white/5">
          {['all', 'active', 'idle', 'maintenance', 'offline'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-md transition-all capitalize ${filter === s ? 'bg-gold text-navy-950 font-bold' : 'text-slate-500 hover:text-slate-300'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Map + sidebar */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 rounded-xl overflow-hidden border border-white/5 relative min-h-[400px]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-navy-900">
              <div className="text-center">
                <Spinner size="lg" />
                <p className="text-slate-500 text-xs font-mono mt-3">LOADING MAP…</p>
              </div>
            </div>
          ) : (
            <MapContainer
              center={mapCenter.center}
              zoom={mapCenter.zoom}
              style={{ height: '100%', width: '100%', background: '#060B14' }}
              zoomControl={false}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com">CARTO</a>'
              />
              <MapController center={mapCenter.center} zoom={mapCenter.zoom} />
              {filtered.map(v => <VehicleMarker key={v.id} vehicle={v} />)}
            </MapContainer>
          )}
          {/* Map overlay badge */}
          <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-[#0A0F1A]/90 border border-white/10 rounded-lg px-3 py-1.5 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] font-mono text-slate-300">{filtered.length} VEHICLES · {region.toUpperCase()}</span>
          </div>
        </div>

        {/* Vehicle list sidebar */}
        <div className="w-64 flex-shrink-0 hidden lg:flex flex-col gap-2 overflow-y-auto">
          <p className="text-[10px] font-mono text-slate-600 tracking-wider px-1">VEHICLE LIST</p>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-xs font-mono">NO VEHICLES</div>
          ) : filtered.map(v => (
            <div key={v.id}
              onClick={() => setSelectedVehicle(v.id === selectedVehicle ? null : v.id)}
              className={`bg-navy-900 border rounded-xl p-3 cursor-pointer transition-all ${selectedVehicle === v.id ? 'border-gold/30 bg-gold/5' : 'border-white/5 hover:border-white/10'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-mono font-bold text-slate-200">{v.registration}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[v.status] ? '' : 'bg-slate-600'}`}
                  style={{ background: STATUS_COLOR[v.status] || '#475569' }} />
              </div>
              <div className="text-[10px] font-mono text-slate-500 space-y-0.5">
                <div className="flex justify-between">
                  <span>Speed</span>
                  <span className={v.speed > 2 ? 'text-gold' : 'text-slate-600'}>{v.speed?.toFixed(0) || 0} km/h</span>
                </div>
                <div className="flex justify-between">
                  <span>Status</span>
                  <span style={{ color: STATUS_COLOR[v.status] || '#64748b' }}>{v.status?.toUpperCase()}</span>
                </div>
                {v.driver_name && <div className="flex justify-between"><span>Driver</span><span className="text-slate-400 truncate max-w-[90px]">{v.driver_name}</span></div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
