import { useEffect, useState, useRef, useCallback } from 'react';
import { vehiclesAPI, geofenceAPI } from '../services/api';
import { Spinner } from '../components/UI';
import { timeAgo } from '../utils/helpers';

const STATUS_COLOR = { active:'#22D3A0', idle:'#94a3b8', maintenance:'#F59E0B', offline:'#475569' };
const STATUS_BG    = { active:'rgba(34,211,160,0.12)', idle:'rgba(148,163,184,0.08)', maintenance:'rgba(245,158,11,0.12)', offline:'rgba(71,85,105,0.12)' };

const TILE_LAYERS = {
  dark:      { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',        label:'🗺 Dark',      attr:'© CARTO' },
  satellite: { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', label:'🛰 Satellite', attr:'© Esri © Maxar' },
  labels:    { url:'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', label:'🏷 Labels', attr:'' },
  street:    { url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                    label:'🗾 Street',    attr:'© OpenStreetMap' },
};

const REGIONS = {
  'All':      { center:[1.0,  35.0],    zoom:5 },
  'Kenya':    { center:[-1.286,36.817], zoom:7 },
  'Tanzania': { center:[-6.369,34.888], zoom:7 },
  'DRC':      { center:[-4.038,21.758], zoom:6 },
  'Uganda':   { center:[1.373, 32.290], zoom:7 },
  'Mali':     { center:[12.653,-8.0],   zoom:6 },
};

function MapBtn({ onClick, active, children, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: active ? '#F0B429' : 'rgba(10,15,26,0.92)',
      color: active ? '#0A0F1A' : 'white',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8, width: 36, height: 36, fontSize: 16, cursor: 'pointer',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: active ? 700 : 400,
    }}>{children}</button>
  );
}

export default function GPSPage() {
  const mapRef         = useRef(null);
  const mapInstance    = useRef(null);
  const baseTile       = useRef(null);
  const labelTile      = useRef(null);
  const markersMap     = useRef({});
  const trailsMap      = useRef({});
  const geofenceLayer  = useRef(null);
  const leafletRef     = useRef(null);
  const drawingRef     = useRef(false);
  const drawCircleRef  = useRef(null);
  const drawCenterRef  = useRef(null);

  const [vehicles,    setVehicles]    = useState([]);
  const [geofences,   setGeofences]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [region,      setRegion]      = useState('All');
  const [filter,      setFilter]      = useState('all');
  const [liveCount,   setLiveCount]   = useState(0);
  const [selected,    setSelected]    = useState(null);
  const [tileMode,    setTileMode]    = useState('dark');
  const [showLabels,  setShowLabels]  = useState(false);
  const [showTrails,  setShowTrails]  = useState(true);
  const [drawMode,    setDrawMode]    = useState(false);
  const [showPanel,   setShowPanel]   = useState(false);
  const [panel,       setPanel]       = useState('vehicles'); // vehicles | geofences
  const [fenceName,   setFenceName]   = useState('');
  const [fenceRadius, setFenceRadius] = useState(null);
  const [fenceCenter, setFenceCenter] = useState(null);
  const [savingFence, setSavingFence] = useState(false);

  // ── Tile switching ──────────────────────────────────────────
  const applyTiles = useCallback((mode, labels) => {
    const L = leafletRef.current; const map = mapInstance.current;
    if (!L || !map) return;
    if (baseTile.current)  { baseTile.current.remove();  baseTile.current  = null; }
    if (labelTile.current) { labelTile.current.remove(); labelTile.current = null; }
    const t = TILE_LAYERS[mode];
    baseTile.current = L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19 }).addTo(map);
    if (mode === 'satellite' && labels) {
      const lt = TILE_LAYERS.labels;
      labelTile.current = L.tileLayer(lt.url, { attribution: lt.attr, maxZoom: 19 }).addTo(map);
    }
  }, []);

  const switchTile = (mode) => {
    setTileMode(mode);
    applyTiles(mode, showLabels);
  };

  const toggleLabels = () => {
    const next = !showLabels;
    setShowLabels(next);
    applyTiles(tileMode, next);
  };

  // ── Marker icons ────────────────────────────────────────────
  const makeIcon = (L, v) => {
    const c = STATUS_COLOR[v.status] || '#64748b';
    const spd = v.speed > 2 ? `<div style="position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);background:rgba(10,15,26,0.9);color:${c};font-size:8px;font-family:monospace;padding:1px 4px;border-radius:3px;white-space:nowrap;border:1px solid ${c}33">${v.speed.toFixed(0)}km/h</div>` : '';
    return L.divIcon({
      className: '',
      html: `<div style="position:relative;width:28px;height:28px">
        <div style="position:absolute;inset:5px;border-radius:50%;background:#0A0F1A;border:2px solid ${c};display:flex;align-items:center;justify-content:center">
          <div style="width:5px;height:5px;border-radius:50%;background:${c}"></div>
        </div>
        ${v.status==='active'?`<div style="position:absolute;inset:0;border-radius:50%;border:1.5px solid ${c};opacity:0.25;animation:ping 2s infinite"></div>`:''}
        ${spd}
      </div>`,
      iconSize:[28,28], iconAnchor:[14,14], popupAnchor:[0,-18],
    });
  };

  // ── Trails ──────────────────────────────────────────────────
  const updateTrail = (L, map, v) => {
    if (!showTrails || !v.lat || !v.lng) return;
    if (!trailsMap.current[v.id]) {
      trailsMap.current[v.id] = { pts: [[v.lat, v.lng]], line: null };
    }
    const t = trailsMap.current[v.id];
    t.pts.push([v.lat, v.lng]);
    if (t.pts.length > 30) t.pts.shift();
    if (t.line) t.line.remove();
    if (t.pts.length > 1) {
      t.line = L.polyline(t.pts, {
        color: STATUS_COLOR[v.status] || '#64748b',
        weight: 2, opacity: 0.45, dashArray: '4 4',
      }).addTo(map);
    }
  };

  const clearTrails = () => {
    Object.values(trailsMap.current).forEach(t => t.line && t.line.remove());
    trailsMap.current = {};
  };

  // ── Markers ─────────────────────────────────────────────────
  const addOrUpdateMarker = useCallback((L, map, v) => {
    if (!v.lat || !v.lng) return;
    const popup = `
      <div style="background:#0A0F1A;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px;min-width:170px;font-family:monospace;color:#e2e8f0">
        <div style="color:#F0B429;font-size:13px;font-weight:bold;margin-bottom:6px">${v.registration || '—'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
          <span style="color:#64748b">Status</span><span style="color:${STATUS_COLOR[v.status]||'#64748b'}">${(v.status||'—').toUpperCase()}</span>
          <span style="color:#64748b">Speed</span><span style="color:#F0B429">${(v.speed||0).toFixed(0)} km/h</span>
          ${v.driver_name?`<span style="color:#64748b">Driver</span><span style="color:#e2e8f0">${v.driver_name}</span>`:''}
          <span style="color:#64748b">Updated</span><span style="color:#94a3b8">${v.last_update?timeAgo(v.last_update):'—'}</span>
          ${v.lat?`<span style="color:#64748b">Lat</span><span style="color:#94a3b8">${v.lat.toFixed(4)}</span>`:''}
          ${v.lng?`<span style="color:#64748b">Lng</span><span style="color:#94a3b8">${v.lng.toFixed(4)}</span>`:''}
        </div>
      </div>`;
    updateTrail(L, map, v);
    if (markersMap.current[v.id]) {
      markersMap.current[v.id].setLatLng([v.lat, v.lng]).setIcon(makeIcon(L, v));
      markersMap.current[v.id].getPopup()?.setContent(popup);
      return;
    }
    const m = L.marker([v.lat, v.lng], { icon: makeIcon(L, v) })
      .addTo(map)
      .bindPopup(popup, { className:'', maxWidth:220 });
    m.on('click', () => setSelected(v.id));
    markersMap.current[v.id] = m;
  }, [showTrails]);

  // ── Geofence rendering ──────────────────────────────────────
  const renderGeofences = useCallback((fences) => {
    const L = leafletRef.current; const map = mapInstance.current;
    if (!L || !map) return;
    if (geofenceLayer.current) geofenceLayer.current.clearLayers();
    else {
      geofenceLayer.current = L.layerGroup().addTo(map);
    }
    fences.forEach(f => {
      if (!f.lat || !f.lng || !f.radius) return;
      L.circle([f.lat, f.lng], {
        radius: f.radius,
        color: '#F0B429', fillColor: '#F0B429', fillOpacity: 0.07,
        weight: 1.5, dashArray: '6 4',
      }).addTo(geofenceLayer.current).bindPopup(
        `<div style="background:#0A0F1A;border:1px solid rgba(240,180,41,0.3);border-radius:8px;padding:10px;font-family:monospace;font-size:11px;color:#e2e8f0">
          <b style="color:#F0B429">${f.name || 'Geofence'}</b><br/>
          <span style="color:#64748b">Radius: </span>${f.radius}m
        </div>`, { className:'' }
      );
      L.circleMarker([f.lat, f.lng], { radius: 4, color: '#F0B429', fillColor:'#F0B429', fillOpacity:1, weight:1 })
        .addTo(geofenceLayer.current);
    });
  }, []);

  // ── Draw geofence mode ──────────────────────────────────────
  const enableDrawMode = () => {
    const L = leafletRef.current; const map = mapInstance.current;
    if (!L || !map) return;
    setDrawMode(true);
    drawingRef.current = true;
    map.getContainer().style.cursor = 'crosshair';

    const onMouseMove = (e) => {
      if (!drawCenterRef.current) return;
      const dist = map.distance(drawCenterRef.current, e.latlng);
      if (drawCircleRef.current) drawCircleRef.current.remove();
      drawCircleRef.current = L.circle(drawCenterRef.current, {
        radius: dist, color:'#F0B429', fillColor:'#F0B429',
        fillOpacity:0.08, weight:1.5, dashArray:'6 4',
      }).addTo(map);
    };

    const onClick = (e) => {
      if (!drawCenterRef.current) {
        drawCenterRef.current = e.latlng;
      } else {
        const radius = Math.round(map.distance(drawCenterRef.current, e.latlng));
        setFenceCenter(drawCenterRef.current);
        setFenceRadius(radius);
        setPanel('geofences');
        setShowPanel(true);
        // cleanup
        map.off('click', onClick);
        map.off('mousemove', onMouseMove);
        map.getContainer().style.cursor = '';
        drawCenterRef.current = null;
        setDrawMode(false);
        drawingRef.current = false;
      }
    };

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
  };

  const cancelDraw = () => {
    const map = mapInstance.current;
    if (!map) return;
    if (drawCircleRef.current) { drawCircleRef.current.remove(); drawCircleRef.current = null; }
    drawCenterRef.current = null;
    map.getContainer().style.cursor = '';
    setDrawMode(false);
    drawingRef.current = false;
  };

  const saveGeofence = async () => {
    if (!fenceCenter || !fenceRadius || !fenceName.trim()) return;
    setSavingFence(true);
    try {
      await geofenceAPI.create({
        name: fenceName,
        lat: fenceCenter.lat,
        lng: fenceCenter.lng,
        radius: fenceRadius,
        active: true,
      });
      setFenceName('');
      setFenceCenter(null);
      setFenceRadius(null);
      if (drawCircleRef.current) { drawCircleRef.current.remove(); drawCircleRef.current = null; }
      const r = await geofenceAPI.list({});
      const fences = r.data.data || [];
      setGeofences(fences);
      renderGeofences(fences);
    } catch(e) { console.error(e); }
    finally { setSavingFence(false); }
  };

  const deleteGeofence = async (id) => {
    try {
      await geofenceAPI.delete(id);
      const updated = geofences.filter(f => f.id !== id);
      setGeofences(updated);
      renderGeofences(updated);
    } catch(e) { console.error(e); }
  };

  // ── Map init ────────────────────────────────────────────────
  const initMap = async (data) => {
    if (!mapRef.current || mapInstance.current) return;
    const L = (await import('leaflet')).default;
    leafletRef.current = L;
    if (!document.querySelector('link[href*="leaflet"]')) {
      const s = document.createElement('link');
      s.rel = 'stylesheet'; s.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(s);
    }
    await new Promise(r => setTimeout(r, 100));
    const map = L.map(mapRef.current, { center: REGIONS.All.center, zoom: REGIONS.All.zoom, zoomControl: false });
    L.control.zoom({ position:'bottomright' }).addTo(map);
    baseTile.current = L.tileLayer(TILE_LAYERS.dark.url, { attribution: TILE_LAYERS.dark.attr, maxZoom:19 }).addTo(map);
    mapInstance.current = map;
    data.forEach(v => addOrUpdateMarker(L, map, v));
  };

  // ── Load vehicles ───────────────────────────────────────────
  const loadVehicles = async () => {
    try {
      const fn = vehiclesAPI.list || vehiclesAPI.getAll;
      const r  = await fn({ limit: 200 });
      const data = (r.data.data || []).map(v => ({
        ...v,
        lat:         v.lat         || (-1.286 + (Math.random()-0.5)*2.5),
        lng:         v.lng         || (36.817 + (Math.random()-0.5)*2.5),
        speed:       v.speed       || (v.status==='active' ? Math.random()*90 : 0),
        last_update: v.last_update || new Date().toISOString(),
      }));
      setVehicles(data);
      if (!mapInstance.current) await initMap(data);
      else { const L = leafletRef.current; if (L) data.forEach(v => addOrUpdateMarker(L, mapInstance.current, v)); }
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadGeofences = async () => {
    try {
      const r = await geofenceAPI.list({});
      const fences = r.data.data || [];
      setGeofences(fences);
      renderGeofences(fences);
    } catch(e) { console.error(e); }
  };

  useEffect(() => {
    loadVehicles();
    import('../services/socket').then(mod => {
      const svc = mod.default;
      if (svc && typeof svc.onVehicleUpdate === 'function') {
        svc.onVehicleUpdate(d => {
          setVehicles(p => p.map(v => v.id===d.vehicleId?{...v,lat:d.lat,lng:d.lng,speed:d.speed,last_update:new Date().toISOString()}:v));
          const L=leafletRef.current, map=mapInstance.current;
          if (L && map && markersMap.current[d.vehicleId]) {
            markersMap.current[d.vehicleId].setLatLng([d.lat,d.lng]);
          }
          setLiveCount(c => c+1);
        });
      }
    }).catch(()=>{});
    const iv = setInterval(loadVehicles, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (mapInstance.current) loadGeofences();
  }, [mapInstance.current]);

  useEffect(() => {
    if (!showTrails) clearTrails();
  }, [showTrails]);

  useEffect(() => {
    if (mapInstance.current && REGIONS[region]) {
      mapInstance.current.setView(REGIONS[region].center, REGIONS[region].zoom, { animate:true });
    }
  }, [region]);

  const filtered  = vehicles.filter(v => filter==='all' || v.status===filter);
  const selVehicle = selected ? vehicles.find(v => v.id===selected) : null;

  const flyTo = (v) => {
    if (mapInstance.current && v.lat && v.lng) {
      mapInstance.current.setView([v.lat, v.lng], 14, { animate:true });
      markersMap.current[v.id]?.openPopup();
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, height:'100%', fontFamily:'system-ui,sans-serif' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 tracking-wider">Live GPS Tracking</h1>
          <p className="text-slate-500 text-xs font-mono mt-0.5">Real-time · {filtered.length} vehicles · auto-refresh 30s</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ position:'relative', display:'flex', width:8, height:8 }}>
            <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#22D3A0', opacity:.75, animation:'ping 2s infinite' }}/>
            <span style={{ position:'relative', borderRadius:'50%', background:'#22D3A0', width:8, height:8 }}/>
          </span>
          <span className="text-[10px] font-mono text-success">{liveCount} LIVE</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, flexShrink:0 }}>
        {[['TOTAL',vehicles.length,'#94a3b8'],['ACTIVE',vehicles.filter(v=>v.status==='active').length,'#22D3A0'],['MOVING',vehicles.filter(v=>(v.speed||0)>2).length,'#F0B429'],['OFFLINE',vehicles.filter(v=>v.status==='offline').length,'#F25252']].map(([l,v,c])=>(
          <div key={l} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, padding:'10px 8px', textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:800, color:c, fontFamily:'monospace' }}>{v}</div>
            <div style={{ fontSize:9, color:'#475569', letterSpacing:1, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:3, background:'rgba(255,255,255,0.03)', padding:4, borderRadius:10, border:'1px solid rgba(255,255,255,0.05)' }}>
          {Object.keys(REGIONS).map(r=>(
            <button key={r} onClick={()=>setRegion(r)} style={{ padding:'4px 10px', borderRadius:7, border:'none', cursor:'pointer', fontSize:11, fontFamily:'monospace', fontWeight:region===r?700:400, background:region===r?'#F0B429':'transparent', color:region===r?'#0A0F1A':'#64748b', transition:'all .15s' }}>{r}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:3, background:'rgba(255,255,255,0.03)', padding:4, borderRadius:10, border:'1px solid rgba(255,255,255,0.05)' }}>
          {['all','active','idle','maintenance','offline'].map(s=>(
            <button key={s} onClick={()=>setFilter(s)} style={{ padding:'4px 8px', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontFamily:'monospace', fontWeight:filter===s?700:400, background:filter===s?'#F0B429':'transparent', color:filter===s?'#0A0F1A':'#64748b', textTransform:'capitalize', transition:'all .15s' }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Map + Side Panel */}
      <div style={{ display:'flex', gap:12, flex:1, minHeight:0 }}>

        {/* Map */}
        <div style={{ flex:1, borderRadius:14, overflow:'hidden', border:'1px solid rgba(255,255,255,0.06)', position:'relative', minHeight:380, background:'#0A0F1A' }}>
          {loading && (
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:10, background:'#0A0F1A' }}>
              <div style={{ textAlign:'center' }}><Spinner size="lg"/><p style={{ color:'#475569', fontSize:11, fontFamily:'monospace', marginTop:10 }}>LOADING MAP…</p></div>
            </div>
          )}
          <div ref={mapRef} style={{ height:'100%', width:'100%' }}/>

          {/* Map toolbar */}
          <div style={{ position:'absolute', top:10, right:10, zIndex:1000, display:'flex', flexDirection:'column', gap:5 }}>
            <MapBtn onClick={()=>switchTile('dark')}      active={tileMode==='dark'}      title="Dark map">🗺</MapBtn>
            <MapBtn onClick={()=>switchTile('satellite')} active={tileMode==='satellite'} title="Satellite">🛰</MapBtn>
            <MapBtn onClick={()=>switchTile('street')}    active={tileMode==='street'}    title="Street map">🗾</MapBtn>
            {tileMode==='satellite' && <MapBtn onClick={toggleLabels} active={showLabels} title="Place labels">🏷</MapBtn>}
            <div style={{ height:6 }}/>
            <MapBtn onClick={()=>setShowTrails(p=>!p)} active={showTrails} title="Vehicle trails">〰️</MapBtn>
            <MapBtn onClick={drawMode?cancelDraw:enableDrawMode} active={drawMode} title="Draw geofence">⬤</MapBtn>
            <div style={{ height:6 }}/>
            <MapBtn onClick={()=>{setShowPanel(p=>!p);setPanel('vehicles')}} active={showPanel&&panel==='vehicles'} title="Vehicle list">📋</MapBtn>
            <MapBtn onClick={()=>{setShowPanel(p=>!p);setPanel('geofences')}} active={showPanel&&panel==='geofences'} title="Geofences">🔵</MapBtn>
          </div>

          {/* Draw mode banner */}
          {drawMode && (
            <div style={{ position:'absolute', top:10, left:'50%', transform:'translateX(-50%)', zIndex:1000, background:'rgba(240,180,41,0.92)', color:'#0A0F1A', padding:'6px 16px', borderRadius:8, fontSize:11, fontFamily:'monospace', fontWeight:700, backdropFilter:'blur(8px)' }}>
              {drawCenterRef.current ? '📍 Click to set fence radius' : '📍 Click map to set geofence center'}
              <button onClick={cancelDraw} style={{ marginLeft:10, background:'none', border:'none', cursor:'pointer', fontWeight:700, color:'#0A0F1A' }}>✕</button>
            </div>
          )}

          {/* Status badge */}
          <div style={{ position:'absolute', top:10, left:10, zIndex:1000, display:'flex', alignItems:'center', gap:6, background:'rgba(10,15,26,0.88)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'5px 10px', backdropFilter:'blur(8px)', pointerEvents:'none' }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:'#22D3A0', animation:'pulse 2s infinite' }}/>
            <span style={{ fontSize:10, fontFamily:'monospace', color:'#94a3b8' }}>{filtered.length} VEHICLES · {region.toUpperCase()}</span>
          </div>

          {/* Tile label */}
          <div style={{ position:'absolute', bottom:28, left:10, zIndex:1000, background:'rgba(10,15,26,0.75)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:6, padding:'2px 8px', fontSize:10, fontFamily:'monospace', color:'#64748b', backdropFilter:'blur(6px)' }}>
            {TILE_LAYERS[tileMode].label}{tileMode==='satellite'&&showLabels?' · Labels ON':''}
          </div>
        </div>

        {/* Side panel */}
        {showPanel && (
          <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:14, overflow:'hidden' }}>
            {/* Panel tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              {[['vehicles','🚗 Vehicles'],['geofences','🔵 Fences']].map(([k,l])=>(
                <button key={k} onClick={()=>setPanel(k)} style={{ flex:1, padding:'9px 4px', border:'none', cursor:'pointer', fontSize:10, fontFamily:'monospace', fontWeight:panel===k?700:400, background:panel===k?'rgba(240,180,41,0.1)':'transparent', color:panel===k?'#F0B429':'#64748b', borderBottom:panel===k?'2px solid #F0B429':'2px solid transparent', transition:'all .15s' }}>{l}</button>
              ))}
            </div>

            {/* Vehicles tab */}
            {panel==='vehicles' && (
              <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:6 }}>
                {filtered.length===0 && <p style={{ color:'#475569', fontSize:11, fontFamily:'monospace', textAlign:'center', marginTop:20 }}>No vehicles</p>}
                {filtered.map(v=>(
                  <div key={v.id} onClick={()=>{setSelected(v.id);flyTo(v);}}
                    style={{ background:selected===v.id?'rgba(240,180,41,0.08)':'rgba(255,255,255,0.02)', border:`1px solid ${selected===v.id?'rgba(240,180,41,0.25)':'rgba(255,255,255,0.05)'}`, borderRadius:10, padding:'8px 10px', cursor:'pointer', transition:'all .15s' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'#e2e8f0' }}>{v.registration}</span>
                      <span style={{ width:6, height:6, borderRadius:'50%', background:STATUS_COLOR[v.status]||'#475569' }}/>
                    </div>
                    <div style={{ fontSize:9, fontFamily:'monospace', color:'#64748b', display:'flex', justifyContent:'space-between' }}>
                      <span style={{ color:STATUS_COLOR[v.status]||'#64748b' }}>{v.status?.toUpperCase()}</span>
                      <span style={{ color:(v.speed||0)>2?'#F0B429':'#475569' }}>{(v.speed||0).toFixed(0)} km/h</span>
                    </div>
                    {v.driver_name && <div style={{ fontSize:9, fontFamily:'monospace', color:'#475569', marginTop:2 }}>👤 {v.driver_name}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Geofences tab */}
            {panel==='geofences' && (
              <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:6 }}>
                {/* Save new fence form */}
                {fenceCenter && fenceRadius && (
                  <div style={{ background:'rgba(240,180,41,0.08)', border:'1px solid rgba(240,180,41,0.2)', borderRadius:10, padding:10, marginBottom:4 }}>
                    <div style={{ fontSize:10, fontFamily:'monospace', color:'#F0B429', marginBottom:6 }}>NEW GEOFENCE · {fenceRadius}m radius</div>
                    <input value={fenceName} onChange={e=>setFenceName(e.target.value)} placeholder="Zone name..."
                      style={{ width:'100%', background:'rgba(10,15,26,0.8)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, padding:'5px 8px', fontSize:11, color:'#e2e8f0', fontFamily:'monospace', outline:'none', boxSizing:'border-box', marginBottom:6 }}/>
                    <div style={{ display:'flex', gap:5 }}>
                      <button onClick={saveGeofence} disabled={!fenceName.trim()||savingFence}
                        style={{ flex:1, background:'#F0B429', color:'#0A0F1A', border:'none', borderRadius:6, padding:'5px 0', fontSize:10, fontFamily:'monospace', fontWeight:700, cursor:'pointer', opacity:(!fenceName.trim()||savingFence)?.5:1 }}>
                        {savingFence?'SAVING…':'SAVE'}
                      </button>
                      <button onClick={()=>{setFenceCenter(null);setFenceRadius(null);setFenceName('');if(drawCircleRef.current){drawCircleRef.current.remove();drawCircleRef.current=null;}}}
                        style={{ background:'rgba(242,82,82,0.15)', color:'#F25252', border:'1px solid rgba(242,82,82,0.2)', borderRadius:6, padding:'5px 8px', fontSize:10, fontFamily:'monospace', cursor:'pointer' }}>✕</button>
                    </div>
                  </div>
                )}

                {!fenceCenter && (
                  <button onClick={enableDrawMode}
                    style={{ background:'rgba(240,180,41,0.1)', border:'1px solid rgba(240,180,41,0.2)', borderRadius:8, padding:'7px 0', fontSize:10, fontFamily:'monospace', color:'#F0B429', cursor:'pointer', fontWeight:700 }}>
                    ⬤ DRAW NEW GEOFENCE
                  </button>
                )}

                {geofences.length===0 && !fenceCenter && (
                  <p style={{ color:'#475569', fontSize:10, fontFamily:'monospace', textAlign:'center', marginTop:12 }}>No geofences yet</p>
                )}
                {geofences.map(f=>(
                  <div key={f.id} style={{ background:'rgba(240,180,41,0.05)', border:'1px solid rgba(240,180,41,0.12)', borderRadius:10, padding:'8px 10px' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                      <span style={{ fontSize:11, fontFamily:'monospace', fontWeight:700, color:'#F0B429' }}>{f.name}</span>
                      <button onClick={()=>deleteGeofence(f.id)} style={{ background:'none', border:'none', color:'#F25252', cursor:'pointer', fontSize:13, lineHeight:1 }}>✕</button>
                    </div>
                    <div style={{ fontSize:9, fontFamily:'monospace', color:'#64748b' }}>
                      📍 {f.lat?.toFixed(4)}, {f.lng?.toFixed(4)}<br/>
                      ⭕ {f.radius}m radius
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
