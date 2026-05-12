import { useEffect, useState, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { vehiclesAPI, alertsAPI, geofenceAPI } from '../services/api';
import api from '../services/api';
import socketService from '../services/socket';
import { Spinner } from '../components/UI';
import { timeAgo, formatDate } from '../utils/helpers';

const SC = { active:'#22D3A0', idle:'#94a3b8', maintenance:'#F59E0B', offline:'#ef4444' };
const SR = { active:'rgba(34,211,160,0.15)', idle:'rgba(148,163,184,0.08)', maintenance:'rgba(245,158,11,0.15)', offline:'rgba(239,68,68,0.15)' };

const TILE_LAYERS = {
  dark:      { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', label:'Dark' },
  satellite: { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', label:'Satellite' },
  street:    { url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', label:'Street' },
};

const REGIONS = {
  All:      { center:[1.0,35.0], zoom:5 },
  Kenya:    { center:[-1.286,36.817], zoom:7 },
  Tanzania: { center:[-6.369,34.888], zoom:7 },
  DRC:      { center:[-4.038,21.758], zoom:6 },
  Uganda:   { center:[1.373,32.290], zoom:7 },
  Mali:     { center:[12.653,-8.0], zoom:6 },
};

function speedColor(speed) {
  if (!speed || speed < 2) return '#94a3b8';
  if (speed < 40) return '#22D3A0';
  if (speed < 80) return '#F0B429';
  if (speed < 120) return '#F97316';
  return '#ef4444';
}

function fuelColor(fuel) {
  const f = parseFloat(fuel || 100);
  if (f < 20) return '#ef4444';
  if (f < 40) return '#F97316';
  if (f < 70) return '#F0B429';
  return '#22D3A0';
}

export default function GPSPage() {
  const mapRef        = useRef(null);
  const mapInst       = useRef(null);
  const baseTile      = useRef(null);
  const labelTile     = useRef(null);
  const markersMap    = useRef({});
  const trailsMap     = useRef({});
  const geofenceLayer = useRef(null);
  const heatLayer     = useRef(null);
  const leafletRef    = useRef(null);
  const drawingRef    = useRef(false);
  const drawCircleRef = useRef(null);
  const alertMarkersRef = useRef({});

  const [vehicles,   setVehicles]   = useState([]);
  const [alerts,     setAlerts]     = useState([]);
  const [geofences,  setGeofences]  = useState([]);
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [region,     setRegion]     = useState('All');
  const [filter,     setFilter]     = useState('all');
  const [tileMode,   setTileMode]   = useState('dark');
  const [showLabels, setShowLabels] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [showHeat,   setShowHeat]   = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);
  const [drawMode,   setDrawMode]   = useState(false);
  const [fenceCenter,setFenceCenter]= useState(null);
  const [fenceRadius,setFenceRadius]= useState(null);
  const [fenceName,  setFenceName]  = useState('');
  const [savingFence,setSavingFence]= useState(false);
  const [liveCount,  setLiveCount]  = useState(0);
  const [selected,   setSelected]   = useState(null);
  const [rightPanel, setRightPanel] = useState('fleet'); // fleet | detail | events | geofences
  const [speedHistory, setSpeedHistory] = useState([]);
  const [fuelHistory,  setFuelHistory]  = useState([]);
  const [sensorData,   setSensorData]   = useState(null);
  const [loadingDetail,setLoadingDetail]= useState(false);

  // ── Leaflet init ───────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInst.current || !mapRef.current) return;
    import('leaflet').then(L => {
      leafletRef.current = L.default || L;
      const Lf = leafletRef.current;
      delete Lf.Icon.Default.prototype._getIconUrl;
      Lf.Icon.Default.mergeOptions({ iconRetinaUrl:'', iconUrl:'', shadowUrl:'' });

      const map = Lf.map(mapRef.current, { center:[1,35], zoom:5, zoomControl:false, attributionControl:true });
      mapInst.current = map;

      baseTile.current = Lf.tileLayer(TILE_LAYERS.dark.url, { attribution:'© CARTO', maxZoom:19 }).addTo(map);
      Lf.control.zoom({ position:'bottomright' }).addTo(map);

      geofenceLayer.current = Lf.layerGroup().addTo(map);

      map.on('click', e => {
        if (!drawingRef.current) return;
        const { lat, lng } = e.latlng;
        setFenceCenter({ lat, lng });
        setFenceRadius(500);
        if (drawCircleRef.current) drawCircleRef.current.remove();
        drawCircleRef.current = Lf.circle([lat, lng], {
          radius:500, color:'#F0B429', fillColor:'#F0B429', fillOpacity:.15, weight:2,
        }).addTo(map);
      });

      loadVehicles(Lf, map);
      loadGeofences(Lf);
      setLoading(false);

      const iv = setInterval(() => loadVehicles(Lf, map), 15000);
      return () => clearInterval(iv);
    });
  }, []);

  // ── Socket live updates ────────────────────────────────────────────────
  useEffect(() => {
    socketService.onVehicleUpdate(data => {
      setVehicles(prev => prev.map(v =>
        v.id === data.vehicleId ? { ...v, lat: data.lat, lng: data.lng, speed: data.speed || v.speed } : v
      ));
      if (leafletRef.current && markersMap.current[data.vehicleId] && data.lat && data.lng) {
        markersMap.current[data.vehicleId].setLatLng([data.lat, data.lng]);
        updateTrail(leafletRef.current, data.vehicleId, data.lat, data.lng);
      }
      setLiveCount(c => c + 1);
      setEvents(prev => [{
        id: Date.now(), time: new Date(), type: 'position',
        text: `Vehicle updated — ${data.speed || 0} km/h`,
        color: speedColor(data.speed),
      }, ...prev.slice(0, 49)]);
    });

    socketService.onAlert(data => {
      setAlerts(prev => [data, ...prev.slice(0, 19)]);
      setEvents(prev => [{
        id: Date.now(), time: new Date(), type: 'alert',
        text: `${data.severity?.toUpperCase()}: ${data.message}`,
        color: data.severity === 'critical' ? '#ef4444' : '#F97316',
      }, ...prev.slice(0, 49)]);
    });

    socketService.onConvoyDeviation(data => {
      setEvents(prev => [{
        id: Date.now(), time: new Date(), type: 'deviation',
        text: `Route deviation: ${data.deviationKm}km off route`,
        color: '#ef4444',
      }, ...prev.slice(0, 49)]);
    });
  }, []);

  const loadVehicles = useCallback(async (Lf, map) => {
    try {
      const r = await vehiclesAPI.list({ limit: 100 });
      const vs = r.data.data || [];
      setVehicles(vs);

      const Lfl = Lf || leafletRef.current;
      const mapI = map || mapInst.current;
      if (!Lfl || !mapI) return;

      vs.forEach(v => {
        if (!v.lat || !v.lng) return;
        const color = SC[v.status] || '#94a3b8';
        const spColor = speedColor(v.speed);
        const hasAlert = alerts.some(a => a.vehicle_id === v.id && !a.resolved_at);

        const svgIcon = `
          <svg width="40" height="48" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">
            ${hasAlert ? `<circle cx="30" cy="10" r="8" fill="#ef4444" stroke="#0A0F1A" stroke-width="2">
              <animate attributeName="r" values="8;11;8" dur="1.5s" repeatCount="indefinite"/>
            </circle>` : ''}
            <circle cx="20" cy="20" r="14" fill="${SR[v.status] || 'rgba(148,163,184,0.08)'}" stroke="${color}" stroke-width="1.5" opacity="0.6"/>
            <circle cx="20" cy="20" r="8" fill="${color}" stroke="#0A0F1A" stroke-width="2"/>
            <circle cx="20" cy="20" r="3" fill="#0A0F1A"/>
            ${(v.speed||0) > 2 ? `
              <line x1="20" y1="20" x2="${20 + 12 * Math.sin((v.heading||0)*Math.PI/180)}" y2="${20 - 12 * Math.cos((v.heading||0)*Math.PI/180)}"
                stroke="${spColor}" stroke-width="2.5" stroke-linecap="round"/>
            ` : ''}
          </svg>`;

        const icon = Lfl.divIcon({
          html: `<div style="position:relative">${svgIcon}</div>`,
          iconSize: [40, 48], iconAnchor: [20, 20], className: '',
        });

        const popup = `
          <div style="background:#0D1321;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;min-width:180px;font-family:monospace">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <strong style="color:#F0B429;font-size:13px">${v.registration}</strong>
              <span style="background:${SR[v.status]};color:${color};font-size:9px;padding:2px 8px;border-radius:20px;border:1px solid ${color}20">${v.status?.toUpperCase()}</span>
            </div>
            <div style="font-size:10px;color:#64748b;line-height:1.8">
              <div>Type: <span style="color:#e2e8f0">${v.type}</span></div>
              <div>Speed: <span style="color:${spColor};font-weight:700">${(v.speed||0).toFixed(0)} km/h</span></div>
              ${v.fuel_level != null ? `<div>Fuel: <span style="color:${fuelColor(v.fuel_level)};font-weight:700">${parseFloat(v.fuel_level).toFixed(0)}%</span></div>` : ''}
              <div>Driver: <span style="color:#e2e8f0">${v.driver_name || '—'}</span></div>
              <div>Region: <span style="color:#e2e8f0">${v.region}</span></div>
              ${v.last_ping ? `<div>Ping: <span style="color:#e2e8f0">${timeAgo(v.last_ping)}</span></div>` : ''}
            </div>
          </div>`;

        if (markersMap.current[v.id]) {
          markersMap.current[v.id].setLatLng([v.lat, v.lng]).setIcon(icon).bindPopup(popup);
        } else {
          const marker = Lfl.marker([v.lat, v.lng], { icon }).bindPopup(popup);
          marker.on('click', () => { setSelected(v.id); setRightPanel('detail'); loadVehicleDetail(v); });
          marker.addTo(mapI);
          markersMap.current[v.id] = marker;
        }
        if (showTrails) updateTrail(Lfl, v.id, v.lat, v.lng);
      });

      if (showHeat) updateHeatmap(Lfl, mapI, vs);
    } catch(e) { console.error(e); }
  }, [alerts, showTrails, showHeat]);

  const updateTrail = (Lf, vehicleId, lat, lng) => {
    if (!trailsMap.current[vehicleId]) trailsMap.current[vehicleId] = { pts:[], line:null };
    const t = trailsMap.current[vehicleId];
    t.pts.push([lat, lng]);
    if (t.pts.length > 30) t.pts.shift();
    if (t.line) t.line.remove();
    if (t.pts.length > 1) {
      t.line = leafletRef.current.polyline(t.pts, {
        color: SC[vehicles.find(v=>v.id===vehicleId)?.status] || '#94a3b8',
        weight: 2, opacity: 0.5, dashArray: '4,4',
      }).addTo(mapInst.current);
      trailsMap.current[vehicleId].line = t.line;
    }
  };

  const updateHeatmap = (Lf, map, vs) => {
    if (heatLayer.current) heatLayer.current.remove();
    const pts = vs.filter(v => v.lat && v.lng).map(v => [v.lat, v.lng, 0.8]);
    if (pts.length && Lf.heatLayer) {
      heatLayer.current = Lf.heatLayer(pts, { radius:25, blur:20, maxZoom:10 }).addTo(map);
    }
  };

  const loadGeofences = async (Lf) => {
    try {
      const r = await geofenceAPI.list();
      const fences = r.data.data || [];
      setGeofences(fences);
      const Lfl = Lf || leafletRef.current;
      if (!Lfl || !geofenceLayer.current) return;
      geofenceLayer.current.clearLayers();
      fences.forEach(f => {
        if (!f.lat || !f.lng) return;
        Lfl.circle([f.lat, f.lng], {
          radius: f.radius || 500, color:'#F0B429', fillColor:'#F0B429', fillOpacity:.08, weight:1.5, dashArray:'6,4',
        }).bindTooltip(`<span style="font-family:monospace;font-size:11px;color:#F0B429">${f.name}</span>`, { permanent:false })
          .addTo(geofenceLayer.current);
      });
    } catch(e) {}
  };

  const loadVehicleDetail = async (vehicle) => {
    setLoadingDetail(true);
    try {
      const [histRes, sensorRes, alertRes] = await Promise.allSettled([
        api.get('/gps', { params: { vehicle_id: vehicle.id, limit: 24 } }),
        api.get('/sensors/' + vehicle.id + '/latest'),
        alertsAPI.list({ vehicle_id: vehicle.id, resolved: 'false', limit: 5 }),
      ]);
      if (histRes.status === 'fulfilled') {
        const pts = (histRes.value.data.data || []).reverse();
        setSpeedHistory(pts.map((p, i) => ({ t: i, speed: parseFloat(p.speed || 0).toFixed(0) * 1 })));
      }
      if (sensorRes.status === 'fulfilled') setSensorData(sensorRes.value.data.data);
    } catch(e) {}
    finally { setLoadingDetail(false); }
  };

  const switchTile = (mode) => {
    const Lf = leafletRef.current;
    const map = mapInst.current;
    if (!Lf || !map) return;
    if (baseTile.current) baseTile.current.remove();
    baseTile.current = Lf.tileLayer(TILE_LAYERS[mode].url, { maxZoom:19 }).addTo(map);
    setTileMode(mode);
  };

  const toggleLabels = () => {
    const Lf = leafletRef.current;
    if (!Lf || !mapInst.current) return;
    if (showLabels && labelTile.current) { labelTile.current.remove(); labelTile.current = null; }
    else labelTile.current = Lf.tileLayer(TILE_LAYERS.dark.url, { maxZoom:19, opacity:.5 }).addTo(mapInst.current);
    setShowLabels(p => !p);
  };

  const saveGeofence = async () => {
    if (!fenceCenter || !fenceName.trim()) return;
    setSavingFence(true);
    try {
      await geofenceAPI.create({ name: fenceName, lat: fenceCenter.lat, lng: fenceCenter.lng, radius: fenceRadius, type:'circle' });
      toast && toast.success('Geofence saved');
      setFenceName(''); setFenceCenter(null); setFenceRadius(null);
      setDrawMode(false); drawingRef.current = false;
      if (drawCircleRef.current) { drawCircleRef.current.remove(); drawCircleRef.current = null; }
      loadGeofences();
    } catch(e) {} finally { setSavingFence(false); }
  };

  const enableDrawMode = () => { setDrawMode(true); drawingRef.current = true; };
  const cancelDraw = () => {
    setDrawMode(false); drawingRef.current = false;
    setFenceCenter(null); setFenceRadius(null);
    if (drawCircleRef.current) { drawCircleRef.current.remove(); drawCircleRef.current = null; }
  };

  const flyTo = (v) => {
    if (mapInst.current && v.lat && v.lng) {
      mapInst.current.flyTo([v.lat, v.lng], 14, { animate:true, duration:.8 });
      markersMap.current[v.id]?.openPopup();
    }
  };

  useEffect(() => {
    if (!showTrails) {
      Object.values(trailsMap.current).forEach(t => t.line?.remove());
      trailsMap.current = {};
    }
  }, [showTrails]);

  useEffect(() => {
    if (mapInst.current && REGIONS[region]) {
      mapInst.current.flyTo(REGIONS[region].center, REGIONS[region].zoom, { animate:true, duration:.6 });
    }
  }, [region]);

  const filtered = vehicles.filter(v => filter === 'all' || v.status === filter);
  const selectedVehicle = selected ? vehicles.find(v => v.id === selected) : null;
  const activeAlerts = alerts.filter(a => !a.resolved_at);

  const B = ({ onClick, active, title, children }) => (
    <button onClick={onClick} title={title} style={{
      background: active ? '#F0B429' : 'rgba(10,15,26,0.92)',
      color: active ? '#0A0F1A' : '#94a3b8',
      border: '1px solid ' + (active ? '#F0B429' : 'rgba(255,255,255,0.1)'),
      borderRadius: 8, width: 34, height: 34, fontSize: 14, cursor: 'pointer',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</button>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 90px)', gap:10, fontFamily:'monospace' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <h1 style={{ fontSize:16, fontWeight:800, color:'#F0B429', letterSpacing:4, margin:0, fontFamily:'monospace' }}>LIVE GPS TRACKING</h1>
          <p style={{ fontSize:10, color:'#475569', margin:'2px 0 0', letterSpacing:1 }}>
            Real-time · {filtered.length} vehicles · {activeAlerts.length} open alerts
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {activeAlerts.length > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:8, padding:'5px 10px' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'#ef4444', animation:'ping 1s infinite' }} />
              <span style={{ fontSize:9, color:'#ef4444', fontWeight:700, letterSpacing:1 }}>{activeAlerts.length} ALERTS ACTIVE</span>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ position:'relative', display:'flex', width:8, height:8 }}>
              <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#22D3A0', opacity:.6, animation:'ping 2s infinite' }} />
              <div style={{ position:'relative', borderRadius:'50%', background:'#22D3A0', width:8, height:8 }} />
            </div>
            <span style={{ fontSize:10, color:'#22D3A0', fontWeight:700, letterSpacing:1 }}>{liveCount} LIVE</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:6, flexShrink:0 }}>
        {[
          ['TOTAL',   vehicles.length, '#94a3b8'],
          ['ACTIVE',  vehicles.filter(v=>v.status==='active').length, '#22D3A0'],
          ['IDLE',    vehicles.filter(v=>v.status==='idle').length, '#64748b'],
          ['MAINT',   vehicles.filter(v=>v.status==='maintenance').length, '#F59E0B'],
          ['MOVING',  vehicles.filter(v=>(v.speed||0)>2).length, '#F0B429'],
          ['OFFLINE', vehicles.filter(v=>v.status==='offline').length, '#ef4444'],
        ].map(([l,v,c]) => (
          <div key={l} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:10, padding:'8px 6px', textAlign:'center' }}>
            <div style={{ fontSize:20, fontWeight:800, color:c, lineHeight:1 }}>{v}</div>
            <div style={{ fontSize:8, color:'#475569', letterSpacing:1, marginTop:3 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ display:'flex', gap:3, background:'rgba(255,255,255,0.02)', padding:3, borderRadius:9, border:'1px solid rgba(255,255,255,0.05)' }}>
          {Object.keys(REGIONS).map(r => (
            <button key={r} onClick={() => setRegion(r)} style={{
              padding:'4px 10px', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontWeight:region===r?700:400,
              background:region===r?'#F0B429':'transparent', color:region===r?'#0A0F1A':'#64748b', transition:'all .15s',
            }}>{r}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:3, background:'rgba(255,255,255,0.02)', padding:3, borderRadius:9, border:'1px solid rgba(255,255,255,0.05)' }}>
          {['all','active','idle','maintenance','offline'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding:'4px 8px', borderRadius:7, border:'none', cursor:'pointer', fontSize:9, fontWeight:filter===s?700:400, textTransform:'capitalize',
              background:filter===s?'#F0B429':'transparent', color:filter===s?'#0A0F1A':'#64748b', transition:'all .15s',
            }}>{s}</button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {[
            ['fleet','📋','Vehicle list'],['events','⚡','Live events'],['geofences','🔵','Geofences'],
          ].map(([key,icon,title]) => (
            <button key={key} onClick={() => setRightPanel(p => p===key?null:key)} title={title} style={{
              padding:'5px 12px', borderRadius:8, border:'1px solid ' + (rightPanel===key?'rgba(240,180,41,0.4)':'rgba(255,255,255,0.08)'),
              background: rightPanel===key?'rgba(240,180,41,0.1)':'rgba(255,255,255,0.02)',
              color: rightPanel===key?'#F0B429':'#64748b', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', gap:5,
            }}>{icon} {title}</button>
          ))}
        </div>
      </div>

      {/* Map + Right Panel */}
      <div style={{ display:'flex', gap:10, flex:1, minHeight:0 }}>

        {/* Map */}
        <div style={{ flex:1, borderRadius:14, overflow:'hidden', border:'1px solid rgba(255,255,255,0.06)', position:'relative', background:'#0A0F1A' }}>
          {loading && (
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:10, background:'#0A0F1A' }}>
              <div style={{ textAlign:'center' }}><Spinner /><p style={{ color:'#475569', fontSize:10, marginTop:8 }}>INITIALISING MAP…</p></div>
            </div>
          )}
          <div ref={mapRef} style={{ height:'100%', width:'100%' }} />

          {/* Draw banner */}
          {drawMode && (
            <div style={{ position:'absolute', top:10, left:'50%', transform:'translateX(-50%)', zIndex:2000, background:'rgba(240,180,41,0.15)', border:'1px solid rgba(240,180,41,0.4)', borderRadius:10, padding:'8px 16px', fontSize:11, color:'#F0B429', fontWeight:700, backdropFilter:'blur(8px)', display:'flex', alignItems:'center', gap:10 }}>
              ⬤ CLICK MAP TO PLACE GEOFENCE CENTER
              <button onClick={cancelDraw} style={{ background:'rgba(239,68,68,0.2)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:6, color:'#ef4444', padding:'2px 8px', cursor:'pointer', fontSize:10 }}>CANCEL</button>
            </div>
          )}

          {/* Tile mode */}
          <div style={{ position:'absolute', bottom:28, left:10, zIndex:1000, background:'rgba(10,15,26,0.8)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:6, padding:'3px 8px', fontSize:9, color:'#64748b', backdropFilter:'blur(6px)' }}>
            {TILE_LAYERS[tileMode].label} · Leaflet © CARTO
          </div>

          {/* Map toolbar */}
          <div style={{ position:'absolute', top:10, right:10, zIndex:1000, display:'flex', flexDirection:'column', gap:5 }}>
            <B onClick={() => switchTile('dark')}      active={tileMode==='dark'}      title="Dark map">🗺</B>
            <B onClick={() => switchTile('satellite')} active={tileMode==='satellite'} title="Satellite">🛰</B>
            <B onClick={() => switchTile('street')}    active={tileMode==='street'}    title="Street">🗾</B>
            <div style={{ height:4 }} />
            <B onClick={() => setShowTrails(p=>!p)}    active={showTrails}             title="Vehicle trails">〰️</B>
            <B onClick={() => setShowAlerts(p=>!p)}    active={showAlerts}             title="Alert indicators">🔴</B>
            <div style={{ height:4 }} />
            <B onClick={drawMode?cancelDraw:enableDrawMode} active={drawMode}          title="Draw geofence">⬤</B>
          </div>
        </div>

        {/* Right panel */}
        {rightPanel && (
          <div style={{ width:280, flexShrink:0, display:'flex', flexDirection:'column', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:14, overflow:'hidden' }}>

            {/* Fleet list */}
            {rightPanel === 'fleet' && (
              <>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:9, color:'#64748b', letterSpacing:2 }}>VEHICLE INTELLIGENCE</span>
                  <span style={{ fontSize:9, color:'#22D3A0' }}>{filtered.length} units</span>
                </div>
                <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:6 }}>
                  {filtered.map(v => {
                    const color = SC[v.status]||'#94a3b8';
                    const fuel = parseFloat(v.fuel_level||100);
                    const isSelected = selected === v.id;
                    return (
                      <div key={v.id} onClick={() => { setSelected(v.id); setRightPanel('detail'); loadVehicleDetail(v); flyTo(v); }}
                        style={{ background: isSelected?'rgba(240,180,41,0.06)':'rgba(255,255,255,0.02)', border:`1px solid ${isSelected?'rgba(240,180,41,0.25)':'rgba(255,255,255,0.05)'}`, borderRadius:10, padding:'8px 10px', cursor:'pointer', transition:'all .15s' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                            <div style={{ width:8, height:8, borderRadius:'50%', background:color, boxShadow:`0 0 6px ${color}` }} />
                            <span style={{ fontSize:12, fontWeight:700, color:'#e2e8f0' }}>{v.registration}</span>
                          </div>
                          <div style={{ display:'flex', align:'center', gap:6 }}>
                            <span style={{ fontSize:9, color:speedColor(v.speed), fontWeight:700 }}>{(v.speed||0).toFixed(0)}km/h</span>
                          </div>
                        </div>
                        <div style={{ fontSize:9, color:'#64748b', marginBottom:5 }}>{v.type} · {v.region}</div>
                        {/* Fuel mini-bar */}
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:8, color:'#475569', minWidth:20 }}>⛽</span>
                          <div style={{ flex:1, height:3, background:'rgba(255,255,255,0.06)', borderRadius:2 }}>
                            <div style={{ width:fuel+'%', height:'100%', background:fuelColor(fuel), borderRadius:2 }} />
                          </div>
                          <span style={{ fontSize:8, color:fuelColor(fuel), fontWeight:700, minWidth:24 }}>{fuel.toFixed(0)}%</span>
                        </div>
                        {v.driver_name && <div style={{ fontSize:9, color:'#475569', marginTop:4 }}>👤 {v.driver_name}</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Vehicle detail */}
            {rightPanel === 'detail' && selectedVehicle && (
              <>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <span style={{ fontSize:12, fontWeight:700, color:'#F0B429' }}>{selectedVehicle.registration}</span>
                    <p style={{ fontSize:9, color:'#64748b', margin:0 }}>{selectedVehicle.type}</p>
                  </div>
                  <button onClick={() => setRightPanel('fleet')} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:16 }}>←</button>
                </div>
                <div style={{ flex:1, overflowY:'auto', padding:10, display:'flex', flexDirection:'column', gap:10 }}>

                  {/* Live stats */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    {[
                      ['SPEED', (selectedVehicle.speed||0).toFixed(0)+' km/h', speedColor(selectedVehicle.speed)],
                      ['FUEL', parseFloat(selectedVehicle.fuel_level||100).toFixed(0)+'%', fuelColor(selectedVehicle.fuel_level)],
                      ['STATUS', selectedVehicle.status?.toUpperCase(), SC[selectedVehicle.status]||'#94a3b8'],
                      ['REGION', selectedVehicle.region, '#94a3b8'],
                      ['ENG HRS', parseFloat(selectedVehicle.engine_hours||0).toFixed(0)+'h', '#64748b'],
                      ['ODO', parseFloat(selectedVehicle.odometer||0).toLocaleString()+'km', '#64748b'],
                    ].map(([l,v,c]) => (
                      <div key={l} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:8, padding:'7px 8px' }}>
                        <div style={{ fontSize:8, color:'#475569', letterSpacing:1, marginBottom:3 }}>{l}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:c }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Speed history chart */}
                  {loadingDetail ? (
                    <div style={{ display:'flex', justifyContent:'center', padding:16 }}><Spinner /></div>
                  ) : speedHistory.length > 1 && (
                    <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:10, padding:'10px 6px' }}>
                      <div style={{ fontSize:8, color:'#475569', letterSpacing:2, marginBottom:6, paddingLeft:4 }}>SPEED HISTORY</div>
                      <ResponsiveContainer width="100%" height={80}>
                        <AreaChart data={speedHistory} margin={{ top:2, right:4, bottom:0, left:-20 }}>
                          <defs>
                            <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#F0B429" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#F0B429" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="t" hide />
                          <YAxis tick={{ fontSize:8, fill:'#475569' }} />
                          <Tooltip contentStyle={{ background:'#0D1321', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, fontSize:10 }} labelStyle={{ color:'#64748b' }} itemStyle={{ color:'#F0B429' }} formatter={(v) => [v+' km/h', 'Speed']} />
                          <Area type="monotone" dataKey="speed" stroke="#F0B429" strokeWidth={2} fill="url(#speedGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Fuel bar */}
                  <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:10, padding:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                      <span style={{ fontSize:8, color:'#475569', letterSpacing:2 }}>FUEL LEVEL</span>
                      <span style={{ fontSize:9, fontWeight:700, color:fuelColor(selectedVehicle.fuel_level) }}>{parseFloat(selectedVehicle.fuel_level||100).toFixed(0)}%</span>
                    </div>
                    <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:3 }}>
                      <div style={{ width:parseFloat(selectedVehicle.fuel_level||100)+'%', height:'100%', background:fuelColor(selectedVehicle.fuel_level), borderRadius:3, transition:'width .5s' }} />
                    </div>
                    {selectedVehicle.fuel_capacity && (
                      <div style={{ fontSize:8, color:'#475569', marginTop:4 }}>
                        {(selectedVehicle.fuel_capacity * parseFloat(selectedVehicle.fuel_level||100) / 100).toFixed(0)}L remaining of {selectedVehicle.fuel_capacity}L
                      </div>
                    )}
                  </div>

                  {/* Maintenance */}
                  {selectedVehicle.maintenance_score != null && (
                    <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:10, padding:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                        <span style={{ fontSize:8, color:'#475569', letterSpacing:2 }}>MAINTENANCE SCORE</span>
                        <span style={{ fontSize:9, fontWeight:700, color: selectedVehicle.maintenance_score>80?'#ef4444':selectedVehicle.maintenance_score>50?'#F59E0B':'#22D3A0' }}>
                          {parseInt(selectedVehicle.maintenance_score)}/100
                        </span>
                      </div>
                      <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:2 }}>
                        <div style={{ width:selectedVehicle.maintenance_score+'%', height:'100%', background:selectedVehicle.maintenance_score>80?'#ef4444':selectedVehicle.maintenance_score>50?'#F59E0B':'#22D3A0', borderRadius:2 }} />
                      </div>
                    </div>
                  )}

                  {/* Sensors */}
                  {sensorData && (
                    <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:10, padding:10 }}>
                      <div style={{ fontSize:8, color:'#475569', letterSpacing:2, marginBottom:8 }}>CARGO SENSORS</div>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {sensorData.temperature != null && (
                          <div style={{ display:'flex', justifyContent:'space-between' }}>
                            <span style={{ fontSize:9, color:'#64748b' }}>🌡 Temperature</span>
                            <span style={{ fontSize:9, fontWeight:700, color:sensorData.temperature>30?'#ef4444':'#22D3A0' }}>{sensorData.temperature}°C</span>
                          </div>
                        )}
                        {sensorData.humidity != null && (
                          <div style={{ display:'flex', justifyContent:'space-between' }}>
                            <span style={{ fontSize:9, color:'#64748b' }}>💧 Humidity</span>
                            <span style={{ fontSize:9, fontWeight:700, color:sensorData.humidity>85?'#ef4444':'#22D3A0' }}>{sensorData.humidity}%</span>
                          </div>
                        )}
                        {sensorData.shock_g != null && (
                          <div style={{ display:'flex', justifyContent:'space-between' }}>
                            <span style={{ fontSize:9, color:'#64748b' }}>⚡ Shock</span>
                            <span style={{ fontSize:9, fontWeight:700, color:sensorData.shock_g>3?'#ef4444':'#22D3A0' }}>{sensorData.shock_g}G</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Driver */}
                  {selectedVehicle.driver_name && (
                    <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:10, padding:10 }}>
                      <div style={{ fontSize:8, color:'#475569', letterSpacing:2, marginBottom:6 }}>DRIVER</div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:28, height:28, borderRadius:8, background:'rgba(240,180,41,0.12)', border:'1px solid rgba(240,180,41,0.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#F0B429' }}>
                          {selectedVehicle.driver_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:'#e2e8f0' }}>{selectedVehicle.driver_name}</div>
                          <div style={{ fontSize:9, color:'#64748b' }}>Score: {selectedVehicle.driver_score || 100}/100</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedVehicle.last_ping && (
                    <div style={{ fontSize:9, color:'#475569', textAlign:'center' }}>Last ping: {timeAgo(selectedVehicle.last_ping)}</div>
                  )}
                </div>
              </>
            )}

            {/* Live events */}
            {rightPanel === 'events' && (
              <>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:9, color:'#64748b', letterSpacing:2 }}>LIVE EVENT FEED</span>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:5, height:5, borderRadius:'50%', background:'#22D3A0', animation:'ping 1.5s infinite' }} />
                    <span style={{ fontSize:8, color:'#22D3A0' }}>LIVE</span>
                  </div>
                </div>
                <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:5 }}>
                  {events.length === 0 && <p style={{ color:'#475569', fontSize:10, textAlign:'center', marginTop:20 }}>Awaiting events…</p>}
                  {events.map(e => (
                    <div key={e.id} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:8, padding:'7px 9px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                        <div style={{ width:5, height:5, borderRadius:'50%', background:e.color, flexShrink:0 }} />
                        <span style={{ fontSize:8, color:'#475569', letterSpacing:1 }}>{e.type?.toUpperCase()}</span>
                        <span style={{ fontSize:8, color:'#334155', marginLeft:'auto' }}>{timeAgo(e.time)}</span>
                      </div>
                      <p style={{ fontSize:10, color:'#94a3b8', margin:0, lineHeight:1.4 }}>{e.text}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Geofences */}
            {rightPanel === 'geofences' && (
              <>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ fontSize:9, color:'#64748b', letterSpacing:2 }}>GEOFENCE ZONES</span>
                </div>
                <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:6 }}>
                  {!fenceCenter ? (
                    <button onClick={enableDrawMode} style={{ background:'rgba(240,180,41,0.08)', border:'1px solid rgba(240,180,41,0.2)', borderRadius:9, padding:'8px', fontSize:10, color:'#F0B429', cursor:'pointer', fontWeight:700 }}>
                      ⬤ DRAW NEW GEOFENCE
                    </button>
                  ) : (
                    <div style={{ background:'rgba(240,180,41,0.08)', border:'1px solid rgba(240,180,41,0.2)', borderRadius:10, padding:10 }}>
                      <div style={{ fontSize:9, color:'#F0B429', fontWeight:700, marginBottom:6 }}>NEW ZONE · {fenceRadius}m radius</div>
                      <input value={fenceName} onChange={e=>setFenceName(e.target.value)} placeholder="Zone name..."
                        style={{ width:'100%', background:'rgba(10,15,26,0.8)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, padding:'5px 8px', fontSize:11, color:'#e2e8f0', outline:'none', boxSizing:'border-box', marginBottom:6 }}/>
                      <div style={{ display:'flex', gap:5 }}>
                        <button onClick={saveGeofence} disabled={!fenceName.trim()||savingFence}
                          style={{ flex:1, background:'#F0B429', color:'#0A0F1A', border:'none', borderRadius:6, padding:'5px 0', fontSize:10, fontWeight:700, cursor:'pointer', opacity:(!fenceName.trim()||savingFence)?0.5:1 }}>
                          {savingFence?'SAVING…':'SAVE ZONE'}
                        </button>
                        <button onClick={cancelDraw} style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.2)', borderRadius:6, padding:'5px 8px', fontSize:10, cursor:'pointer' }}>✕</button>
                      </div>
                    </div>
                  )}
                  {geofences.length === 0 && !fenceCenter && (
                    <p style={{ color:'#475569', fontSize:10, textAlign:'center', marginTop:12 }}>No geofences configured</p>
                  )}
                  {geofences.map(f => (
                    <div key={f.id} style={{ background:'rgba(240,180,41,0.04)', border:'1px solid rgba(240,180,41,0.1)', borderRadius:10, padding:'9px 10px' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'#F0B429' }}>{f.name}</span>
                        <button onClick={async () => { await geofenceAPI.delete(f.id); loadGeofences(); }}
                          style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:13, lineHeight:1 }}>✕</button>
                      </div>
                      <div style={{ fontSize:9, color:'#475569' }}>
                        📍 {parseFloat(f.lat||0).toFixed(4)}, {parseFloat(f.lng||0).toFixed(4)}<br/>
                        ⭕ {f.radius || 500}m radius
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
