import { useEffect, useRef, useState, useCallback } from "react";

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pad2(n) { return String(Math.floor(Math.abs(n))).padStart(2,"0"); }
function fmtTime(s) { return `${pad2(s/3600)}:${pad2((s%3600)/60)}:${pad2(s%60)}`; }
function fmtDist(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`; }
function bearing(deg) {
  if (deg == null) return "—";
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(deg/45)%8];
}
function accColor(acc) {
  if (acc == null) return "#6b7280";
  if (acc < 10) return "#22c55e";
  if (acc < 30) return "#eab308";
  return "#ef4444";
}

function Stat({ label, main, unit, sub }) {
  return (
    <div style={{
      background:"#1e293b", borderRadius:10, padding:"10px 8px",
      textAlign:"center", border:"1px solid rgba(255,255,255,0.07)",
    }}>
      <div style={{ fontSize:9, color:"#64748b", textTransform:"uppercase", letterSpacing:1 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:800, color:"white", lineHeight:1.3 }}>{main}</div>
      {unit ? <div style={{ fontSize:11, color:"#3b82f6" }}>{unit}</div> : null}
      {sub ? <div style={{ fontSize:10, color:"#64748b" }}>{sub}</div> : null}
    </div>
  );
}

function MapBtn({ children, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "#3b82f6" : "rgba(15,23,42,0.85)",
      color:"white", border:"1px solid rgba(255,255,255,0.15)",
      borderRadius:8, width:38, height:38, fontSize:18, cursor:"pointer",
      backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center",
    }}>{children}</button>
  );
}

export default function GPSPage() {
  const mapDivRef = useRef(null);
  const mapRef    = useRef(null);
  const tileRef   = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const polyRef   = useRef(null);
  const watchRef  = useRef(null);
  const timerRef  = useRef(null);
  const lastPosRef  = useRef(null);
  const startRef    = useRef(null);
  const pointsRef   = useRef([]);
  const followRef   = useRef(true);

  const [leafletReady, setLeafletReady] = useState(false);
  const [tracking,   setTracking]   = useState(false);
  const [satellite,  setSatellite]  = useState(false);
  const [follow,     setFollow]     = useState(true);
  const [lat,        setLat]        = useState(null);
  const [lng,        setLng]        = useState(null);
  const [speed,      setSpeed]      = useState(null);
  const [heading,    setHeading]    = useState(null);
  const [altitude,   setAltitude]   = useState(null);
  const [accuracy,   setAccuracy]   = useState(null);
  const [distance,   setDistance]   = useState(0);
  const [elapsed,    setElapsed]    = useState(0);
  const [maxSpeed,   setMaxSpeed]   = useState(0);
  const [error,      setError]      = useState(null);

  useEffect(() => {
    if (window.L) { setLeafletReady(true); return; }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => setLeafletReady(true);
    document.head.appendChild(js);
  }, []);

  useEffect(() => {
    if (!leafletReady || !mapDivRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(mapDivRef.current, { center:[20,0], zoom:2, zoomControl:false });
    L.control.zoom({ position:"bottomright" }).addTo(map);
    map.on("dragstart", () => { followRef.current = false; setFollow(false); });
    tileRef.current = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution:"© OpenStreetMap", maxZoom:19 }
    ).addTo(map);
    mapRef.current = map;
  }, [leafletReady]);

  const handlePosition = useCallback((pos) => {
    const { latitude, longitude, speed:spd, heading:hdg, altitude:alt, accuracy:acc } = pos.coords;
    setLat(latitude); setLng(longitude);
    setSpeed(spd); setHeading(hdg); setAltitude(alt); setAccuracy(acc);
    if (spd != null) setMaxSpeed(prev => Math.max(prev, spd));

    if (lastPosRef.current) {
      const d = haversine(lastPosRef.current.lat, lastPosRef.current.lng, latitude, longitude);
      if (d > 3) { setDistance(prev => prev + d); lastPosRef.current = { lat:latitude, lng:longitude }; }
    } else {
      lastPosRef.current = { lat:latitude, lng:longitude };
    }

    const L = window.L;
    const map = mapRef.current;
    if (!map || !L) return;

    if (followRef.current) map.setView([latitude, longitude], Math.max(map.getZoom(), 16), { animate:true });

    const icon = L.divIcon({
      className:"",
      html:`<div style="width:18px;height:18px;background:#3b82f6;border:2.5px solid white;border-radius:50%;box-shadow:0 0 0 5px rgba(59,130,246,0.25);"></div>`,
      iconSize:[18,18], iconAnchor:[9,9],
    });

    if (!markerRef.current) {
      markerRef.current = L.marker([latitude, longitude], { icon }).addTo(map).bindPopup("<b>You are here</b>");
    } else {
      markerRef.current.setLatLng([latitude, longitude]).setIcon(icon);
    }

    if (!circleRef.current) {
      circleRef.current = L.circle([latitude, longitude], {
        radius:acc, color:"#3b82f6", fillColor:"#3b82f6",
        fillOpacity:0.07, weight:1, dashArray:"5 5",
      }).addTo(map);
    } else {
      circleRef.current.setLatLng([latitude, longitude]).setRadius(acc);
    }

    pointsRef.current.push([latitude, longitude]);
    if (!polyRef.current) {
      polyRef.current = L.polyline(pointsRef.current, { color:"#f97316", weight:3, opacity:0.85 }).addTo(map);
    } else {
      polyRef.current.setLatLngs(pointsRef.current);
    }
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) { setError("Geolocation not supported."); return; }
    setError(null); setDistance(0); setElapsed(0); setMaxSpeed(0);
    pointsRef.current = []; lastPosRef.current = null;
    startRef.current = Date.now();
    followRef.current = true; setFollow(true);

    if (polyRef.current)   { polyRef.current.remove();   polyRef.current   = null; }
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (circleRef.current) { circleRef.current.remove(); circleRef.current = null; }

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    watchRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (e) => setError(e.message),
      { enableHighAccuracy:true, maximumAge:0, timeout:15000 }
    );
    setTracking(true);
  }, [handlePosition]);

  const stopTracking = useCallback(() => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setTracking(false);
  }, []);

  const toggleSatellite = useCallback(() => {
    const L = window.L; const map = mapRef.current;
    if (!map || !L || !tileRef.current) return;
    tileRef.current.remove();
    const newSat = !satellite;
    tileRef.current = L.tileLayer(
      newSat
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: newSat ? "© Esri" : "© OpenStreetMap", maxZoom:19 }
    ).addTo(map);
    setSatellite(newSat);
  }, [satellite]);

  const centerMap = useCallback(() => {
    followRef.current = true; setFollow(true);
    if (lat != null && mapRef.current) {
      mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 16), { animate:true });
    }
  }, [lat, lng]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  const kmh    = speed != null ? (speed * 3.6).toFixed(1)   : "—";
  const mph    = speed != null ? (speed * 2.237).toFixed(1) : null;
  const maxKmh = maxSpeed > 0  ? (maxSpeed * 3.6).toFixed(1) : "—";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#0f172a", color:"white", fontFamily:"system-ui,sans-serif", overflow:"hidden" }}>

      <div style={{ flex:1, position:"relative", minHeight:0 }}>
        <div ref={mapDivRef} style={{ width:"100%", height:"100%" }} />

        <div style={{ position:"absolute", top:12, right:12, zIndex:1000, display:"flex", flexDirection:"column", gap:6 }}>
          <MapBtn onClick={toggleSatellite} active={satellite}>{satellite ? "🗺" : "🛰"}</MapBtn>
          <MapBtn onClick={centerMap} active={follow}>📍</MapBtn>
        </div>

        <div style={{
          position:"absolute", top:12, left:12, zIndex:1000,
          width:54, height:54, borderRadius:"50%",
          background:"rgba(15,23,42,0.85)", backdropFilter:"blur(8px)",
          border:"1px solid rgba(255,255,255,0.12)",
          display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column",
        }}>
          <div style={{ transform:`rotate(${heading != null ? -heading : 0}deg)`, transition:"transform 0.4s", fontSize:24 }}>🧭</div>
          <div style={{ fontSize:9, color:"#64748b", marginTop:1 }}>{heading != null ? `${Math.round(heading)}°` : "—"}</div>
        </div>

        {!tracking && !lat && (
          <div style={{
            position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
            background:"rgba(15,23,42,0.9)", backdropFilter:"blur(10px)",
            border:"1px solid rgba(255,255,255,0.1)", borderRadius:16,
            padding:"20px 28px", textAlign:"center", zIndex:1000,
          }}>
            <div style={{ fontSize:36, marginBottom:8 }}>📡</div>
            <div style={{ color:"#94a3b8", fontSize:14 }}>Tap START TRACKING below</div>
          </div>
        )}

        {error && (
          <div style={{
            position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
            background:"#ef4444", color:"white", padding:"8px 14px",
            borderRadius:8, fontSize:13, zIndex:1000, whiteSpace:"nowrap",
          }}>⚠️ {error}</div>
        )}
      </div>

      <div style={{ background:"#0f172a", borderTop:"1px solid rgba(255,255,255,0.08)", padding:"10px 14px 18px", flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#64748b", marginBottom:10 }}>
          <span>📍 {lat != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "Acquiring signal..."}</span>
          <span style={{ color:accColor(accuracy) }}>
            {accuracy != null ? `±${Math.round(accuracy)}m` : "—"}
          </span>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:10 }}>
          <Stat label="Speed"     main={kmh}      unit="km/h"         sub={mph ? `${mph} mph` : null} />
          <Stat label="Max Speed" main={maxKmh}   unit="km/h" />
          <Stat label="Heading"   main={heading != null ? `${Math.round(heading)}°` : "—"} unit={bearing(heading)} />
          <Stat label="Altitude"  main={altitude != null ? `${Math.round(altitude)}` : "—"} unit="m" />
          <Stat label="Distance"  main={fmtDist(distance)} unit="" />
          <Stat label="Time"      main={fmtTime(elapsed)}  unit="" />
        </div>

        <button
          onClick={tracking ? stopTracking : startTracking}
          style={{
            width:"100%", padding:"14px", border:"none", borderRadius:12,
            background: tracking ? "#ef4444" : "#22c55e",
            color:"white", fontSize:15, fontWeight:700, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          }}
        >
          <span style={{ width:10, height:10, borderRadius:tracking ? 2 : "50%", background:"white", display:"inline-block" }} />
          {tracking ? "STOP TRACKING" : "START TRACKING"}
        </button>
      </div>
    </div>
  );
}
