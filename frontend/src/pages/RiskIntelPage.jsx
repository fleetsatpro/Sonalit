import { useEffect, useRef, useState } from 'react';

const C = {
  bg:'#060e1a', panel:'#0b1829', surface:'#0d2240',
  cyan:'#00d4ff', cyanBg:'rgba(0,212,255,0.07)', cyanBd:'rgba(0,212,255,0.18)',
  blue:'#0066ff', success:'#00ff88', warning:'#ffaa00',
  danger:'#ff3355', muted:'#4a7090', body:'#c8ddf0', bright:'#e8f4ff',
};

const LAYERS = [
  { id:'theft',     label:'Theft Hotspots',      updated:3  },
  { id:'weather',   label:'Weather Hazards',      updated:1  },
  { id:'conflict',  label:'Conflict Zones',       updated:12 },
  { id:'sanctions', label:'Sanctioned Geography', updated:60 },
  { id:'port',      label:'Port Congestion',      updated:5  },
  { id:'routes',    label:'Active Route Alerts',  updated:2  },
];

const STATIC_ALERTS = [
  {
    id:'ra1',
    riskType:'THEFT HOTSPOT',
    location:'Nairobi Industrial Area',
    severity:'high',
    affectedAssets:4,
    latlng:[-1.286389, 36.817223],
    color: C.danger,
  },
  {
    id:'ra2',
    riskType:'PORT CONGESTION',
    location:'Mombasa Port — Berth 9-11',
    severity:'medium',
    affectedAssets:7,
    latlng:[-4.0435, 39.6682],
    color: C.warning,
  },
  {
    id:'ra3',
    riskType:'CONFLICT ZONE',
    location:'Eastern DRC — North Kivu',
    severity:'critical',
    affectedAssets:2,
    latlng:[-1.5, 29.3],
    color: C.danger,
  },
  {
    id:'ra4',
    riskType:'WEATHER HAZARD',
    location:'Narok–Bomet Corridor',
    severity:'medium',
    affectedAssets:3,
    latlng:[-0.9, 35.6],
    color: C.cyan,
  },
];

const SEV_COLOR = {
  critical: C.danger,
  high:     C.warning,
  medium:   C.cyan,
  low:      C.success,
};

function Toggle({ active, onChange }) {
  return (
    <div
      onClick={() => onChange(!active)}
      style={{
        width:36, height:20, borderRadius:10, cursor:'pointer',
        background: active ? C.cyan : 'rgba(74,112,144,0.3)',
        position:'relative', transition:'background 0.2s ease', flexShrink:0,
      }}
    >
      <div style={{
        position:'absolute', top:2,
        left: active ? 18 : 2,
        width:16, height:16, borderRadius:'50%',
        background: active ? C.bg : C.muted,
        transition:'left 0.2s ease',
      }} />
    </div>
  );
}

function AlertItem({ alert, onFly }) {
  const sevColor = SEV_COLOR[alert.severity] || C.muted;
  return (
    <div
      onClick={() => onFly(alert.latlng)}
      style={{
        background:C.surface, border:`1px solid ${sevColor}30`,
        borderLeft:`3px solid ${sevColor}`, borderRadius:6,
        padding:'10px 12px', cursor:'pointer', marginBottom:8,
      }}
    >
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <span style={{ fontFamily:'IBM Plex Mono', fontSize:9, fontWeight:700, color:sevColor, letterSpacing:'0.12em' }}>
          {alert.riskType}
        </span>
        <span style={{
          fontFamily:'IBM Plex Mono', fontSize:8, color:sevColor,
          background:`${sevColor}20`, border:`1px solid ${sevColor}40`,
          borderRadius:3, padding:'1px 5px', letterSpacing:'0.1em',
        }}>{alert.severity.toUpperCase()}</span>
      </div>
      <div style={{ fontFamily:'IBM Plex Sans, sans-serif', fontSize:11, color:C.body, marginBottom:4 }}>
        {alert.location}
      </div>
      <div style={{ fontFamily:'IBM Plex Mono', fontSize:9, color:C.muted }}>
        {alert.affectedAssets} asset{alert.affectedAssets !== 1 ? 's' : ''} affected · tap to zoom
      </div>
    </div>
  );
}

export default function RiskIntelPage() {
  const mapRef   = useRef(null);
  const leafRef  = useRef(null);
  const [layers, setLayers] = useState({ theft:true, weather:true, conflict:true, sanctions:false, port:true, routes:true });
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);

  useEffect(() => {
    let map;
    let mounted = true;

    async function initMap() {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');

      if (!mounted || !mapRef.current || leafRef.current) return;

      map = L.map(mapRef.current, {
        center: [-1.5, 35],
        zoom: 6,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { subdomains:'abcd', maxZoom:19 }
      ).addTo(map);

      // Theft hotspot — Nairobi
      L.circle([-1.286389, 36.817223], {
        radius:50000, color:C.danger, fillColor:C.danger,
        fillOpacity:0.15, weight:1.5,
      }).addTo(map).bindPopup('<b style="color:#ff3355">Theft Hotspot</b><br>Nairobi Industrial Corridor');

      // Port congestion — Mombasa
      L.circle([-4.0435, 39.6682], {
        radius:20000, color:'#ff8800', fillColor:'#ff8800',
        fillOpacity:0.2, weight:1.5,
      }).addTo(map).bindPopup('<b style="color:#ffaa00">Port Congestion</b><br>Mombasa Port');

      // Conflict zone — DRC (polygon approximation)
      L.polygon([
        [-0.5, 28.8], [-0.5, 29.8], [-2.5, 29.8], [-2.5, 28.8],
      ], {
        color:'#ffaa00', fillColor:'#ffaa00', fillOpacity:0.12, weight:1,
      }).addTo(map).bindPopup('<b style="color:#ffaa00">Conflict Zone</b><br>Eastern DRC — North Kivu');

      leafRef.current = map;
    }

    initMap();

    return () => {
      mounted = false;
      if (leafRef.current) {
        leafRef.current.remove();
        leafRef.current = null;
      }
    };
  }, []);

  function flyTo(latlng) {
    if (leafRef.current) {
      leafRef.current.flyTo(latlng, 9, { duration:1.4 });
    }
  }

  function toggleLayer(id, val) {
    setLayers(prev => ({ ...prev, [id]:val }));
  }

  return (
    <div style={{ display:'flex', height:'100%', background:C.bg, overflow:'hidden' }}>

      {/* ── Map ── */}
      <div style={{ flex:1, position:'relative', isolation:'isolate' }}>
        <div ref={mapRef} style={{ width:'100%', height:'100%' }} />

        {/* Map overlay header */}
        <div style={{
          position:'absolute', top:16, left:16, zIndex:1000,
          background:'rgba(6,14,26,0.88)', border:`1px solid ${C.cyanBd}`,
          borderRadius:8, padding:'8px 14px', backdropFilter:'blur(6px)',
        }}>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.16em' }}>
            RISK INTELLIGENCE MAP
          </div>
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.muted, marginTop:2 }}>
            LIVE · East Africa Region
          </div>
        </div>

        {/* Panel toggle */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          style={{
            position:'absolute', top:16, right:16, zIndex:1000,
            background:'rgba(6,14,26,0.88)', border:`1px solid ${C.cyanBd}`,
            borderRadius:6, padding:'6px 10px', cursor:'pointer',
            fontFamily:'IBM Plex Mono', fontSize:9, color:C.cyan, letterSpacing:'0.1em',
          }}
        >
          {panelOpen ? '▶ HIDE' : '◀ LAYERS'}
        </button>
      </div>

      {/* ── Right Panel — hidden on mobile by default, slide in on open ── */}
      <div style={{
        width: panelOpen ? 320 : 0, flexShrink:0, overflow:'hidden',
        transition:'width 0.25s ease',
        background:C.panel, borderLeft:`1px solid ${C.cyanBd}`,
        display:'flex', flexDirection:'column',
      }}>
        <div style={{ padding:'18px 16px', overflowY:'auto', flex:1 }}>

          {/* Title */}
          <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.cyan, letterSpacing:'0.16em', marginBottom:18 }}>
            RISK LAYERS
          </div>

          {/* Layer toggles */}
          {LAYERS.map(layer => (
            <div key={layer.id} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'10px 0', borderBottom:`1px solid rgba(0,212,255,0.06)`,
            }}>
              <div>
                <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color: layers[layer.id] ? C.bright : C.muted, marginBottom:2 }}>
                  {layer.label}
                </div>
                <div style={{ fontFamily:'IBM Plex Mono', fontSize:8, color:C.muted }}>
                  Updated {layer.updated} min ago
                </div>
              </div>
              <Toggle active={layers[layer.id]} onChange={v => toggleLayer(layer.id, v)} />
            </div>
          ))}

          {/* Active Alerts */}
          <div style={{ marginTop:20 }}>
            <div style={{ fontFamily:'IBM Plex Mono', fontSize:10, color:C.muted, letterSpacing:'0.15em', marginBottom:12 }}>
              ACTIVE ALERTS
            </div>
            {STATIC_ALERTS.map(a => (
              <AlertItem key={a.id} alert={a} onFly={flyTo} />
            ))}
          </div>

        </div>
      </div>

    </div>
  );
}
