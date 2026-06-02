import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';

interface MapConvoy { id: string; name: string; status: string; lat: number | null; lng: number | null; heading: number; color: string }
interface AlertZone { lat: number; lng: number; radius_m: number; severity: string }
interface MapData { convoys: MapConvoy[]; alert_zones: AlertZone[] }

interface VehicleTelemetry { id: string; registration: string; convoy_id: string | null; status: string; speed_kmh: number; fuel_pct: number | null; engine_temp_c: number | null; gps_signal_pct: number | null; last_ping_at: string | null }

// East Africa viewport
const EA_CENTER: [number, number] = [35.5, 1.2];
const EA_ZOOM = 5.2;

const GAUGE_PATH = 'M 31.1 98.9 A 48 48 0 1 1 98.9 98.9';
const ARC_LEN = 226.2;

function gaugeOffset(value: number, max: number): number {
  return ARC_LEN * (1 - Math.min(1, value / max));
}

function gaugeColor(type: string, value: number | null): string {
  if (value == null) return 'var(--d-t4)';
  switch (type) {
    case 'speed':  return value >= 100 ? 'var(--d-fire)' : value >= 80 ? 'var(--d-warn)' : 'var(--d-sig)';
    case 'fuel':   return value <= 25 ? 'var(--d-fire)' : value <= 50 ? 'var(--d-warn)' : 'var(--d-sig)';
    case 'temp':   return value >= 100 ? 'var(--d-fire)' : value >= 90 ? 'var(--d-warn)' : 'var(--d-ok)';
    case 'signal': return value <= 50 ? 'var(--d-fire)' : value <= 80 ? 'var(--d-warn)' : 'var(--d-sig)';
    default: return 'var(--d-sig)';
  }
}

function Gauge({ label, value, max, unit, type }: { label: string; value: number | null; max: number; unit: string; type: string }) {
  const pathRef = useRef<SVGPathElement>(null);
  const color = gaugeColor(type, value);
  const target = value != null ? gaugeOffset(value, max) : ARC_LEN;

  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(ARC_LEN);
    requestAnimationFrame(() => {
      el.style.transition = 'stroke-dashoffset 1s ease, stroke .4s';
      el.style.strokeDashoffset = String(target);
      el.style.stroke = color;
    });
  }, [target, color]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg viewBox='0 0 130 130' width={80} height={80} style={{ overflow: 'visible' }}>
        <path d={GAUGE_PATH} fill='none' stroke='var(--d-lift2)' strokeWidth={8} strokeLinecap='round' />
        <path ref={pathRef} d={GAUGE_PATH} fill='none' stroke={color} strokeWidth={8} strokeLinecap='round'
          strokeDasharray={ARC_LEN}
          strokeDashoffset={ARC_LEN}
          style={{ willChange: 'stroke-dashoffset' }}
        />
        <text x={65} y={72} textAnchor='middle' fill={value != null ? 'var(--d-t1)' : 'var(--d-t4)'}
          fontFamily='Orbitron, sans-serif' fontWeight={700} fontSize={18}>
          {value != null ? Math.round(value) : '—'}
        </text>
        <text x={65} y={86} textAnchor='middle' fill='var(--d-t3)' fontFamily='IBM Plex Mono, monospace' fontSize={9}>
          {unit}
        </text>
      </svg>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em', textAlign: 'center' }}>{label}</div>
    </div>
  );
}

const TacticalMap = React.memo(function TacticalMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRafRef = useRef<Map<string, number>>(new Map());
  const vehiclePositions = useDashboardStore((s) => s.vehiclePositions);
  const selectedVehicleId = useDashboardStore((s) => s.selectedVehicleId);
  const { setSelectedVehicle } = useDashboardStore.getState();

  const { data: mapData } = useQuery<MapData>({
    queryKey: ['dashboard-map'],
    queryFn: async () => { const r = await api.get<MapData>('/dashboard/map'); return r.data; },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: vehicles } = useQuery<VehicleTelemetry[]>({
    queryKey: ['dashboard-vehicles'],
    queryFn: async () => { const r = await api.get<{ data: VehicleTelemetry[] }>('/dashboard/vehicles'); return r.data.data ?? []; },
    staleTime: 15000,
    refetchInterval: 30000,
  });

  // Init map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      // No glyphs URL — we only use raster tiles, no vector text labels
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© CartoDB',
          },
        },
        layers: [{ id: 'carto-tiles', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.85 } }],
      },
      center: EA_CENTER,
      zoom: EA_ZOOM,
      attributionControl: false,
    });

    // Silence tile errors so a blocked CDN doesn't bubble to the console
    map.on('error', () => {});

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update convoy marker positions via RAF
  useEffect(() => {
    vehiclePositions.forEach((pos, vehicleId) => {
      const existing = markerRafRef.current.get(vehicleId);
      if (existing) cancelAnimationFrame(existing);

      const el = document.getElementById(`convoy-marker-${vehicleId}`);
      if (!el || !mapRef.current) return;

      const map = mapRef.current;
      const startLng = parseFloat(el.dataset['lng'] ?? String(pos.lng));
      const startLat = parseFloat(el.dataset['lat'] ?? String(pos.lat));
      const endLng = pos.lng;
      const endLat = pos.lat;

      let startTime: number | null = null;
      const DURATION = 800;

      const animate = (time: number) => {
        if (!startTime) startTime = time;
        const t = Math.min(1, (time - startTime) / DURATION);
        const ease = 1 - Math.pow(1 - t, 2);
        const lng = startLng + (endLng - startLng) * ease;
        const lat = startLat + (endLat - startLat) * ease;

        const projected = map.project([lng, lat]);
        el.style.transform = `translate(${projected.x}px, ${projected.y}px) rotate(${pos.heading}deg)`;
        el.dataset['lng'] = String(lng);
        el.dataset['lat'] = String(lat);

        if (t < 1) markerRafRef.current.set(vehicleId, requestAnimationFrame(animate));
      };

      markerRafRef.current.set(vehicleId, requestAnimationFrame(animate));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclePositions]);

  const selectedVehicle = vehicles?.find(v => v.id === selectedVehicleId) ?? vehicles?.[0] ?? null;

  return (
    <div className='d-section-reveal' style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 3, height: 14, background: 'var(--d-sig)', borderRadius: 2 }} />
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>TACTICAL MAP</span>
        <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>East Africa · Live positioning</span>
      </div>

      {/* Map container */}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--d-rim2)', marginBottom: 12 }}>
        <div ref={mapContainer} style={{ width: '100%', height: 252, background: 'var(--d-deep)' }} />

        {/* SVG overlay */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox='0 0 720 252'
          preserveAspectRatio='none'
        >
          {/* Radar */}
          <g>
            {[80, 60, 40, 20].map((r, i) => (
              <circle key={r} cx={120} cy={126} r={r} fill='none' stroke='rgba(0,255,204,.07)' strokeWidth={1} strokeDasharray={i % 2 === 0 ? '4 4' : 'none'} />
            ))}
          </g>
          <g className='radar-rotate' style={{ transformOrigin: '120px 126px', animation: 'radar-turn 8s linear infinite' }}>
            <path d={`M 120 126 L ${120 + 80 * Math.cos(-Math.PI/2)} ${126 + 80 * Math.sin(-Math.PI/2)}`}
              stroke='var(--d-sig)' strokeWidth={1.5} opacity={0.8} />
            <path d={`M 120 126 L 120 ${126 - 80}`} fill='none' stroke='transparent' />
            <path d='M 120 126 L 120 46 A 80 80 0 0 1 189.3 166' fill='rgba(0,255,204,.04)' />
            <path d='M 120 126 L 189.3 166 A 80 80 0 0 1 50.7 166' fill='rgba(0,255,204,.02)' />
          </g>
          <line x1={116} y1={126} x2={124} y2={126} stroke='rgba(0,255,204,.4)' strokeWidth={1} />
          <line x1={120} y1={122} x2={120} y2={130} stroke='rgba(0,255,204,.4)' strokeWidth={1} />

          {/* Alert zones */}
          {(mapData?.alert_zones ?? []).map((_zone, i) => (
            <g key={i}>
              {[1, 2, 3].map(ring => (
                <circle key={ring} cx={360} cy={126} r={ring * 14} fill='none' stroke='var(--d-fire)' strokeWidth={1} opacity={0.3 / ring}>
                  <animate attributeName='r' from={ring * 14} to={ring * 20} dur='2s' repeatCount='indefinite' />
                  <animate attributeName='opacity' from={0.3} to={0} dur='2s' repeatCount='indefinite' />
                </circle>
              ))}
              <line x1={357} y1={126} x2={363} y2={126} stroke='var(--d-fire)' strokeWidth={1.5} />
              <line x1={360} y1={123} x2={360} y2={129} stroke='var(--d-fire)' strokeWidth={1.5} />
            </g>
          ))}

          {/* City labels */}
          {[
            { name: 'Kampala', x: 280, y: 148 }, { name: 'Nairobi', x: 400, y: 178 },
            { name: 'Mombasa', x: 450, y: 205 }, { name: 'Kigali', x: 230, y: 170 },
          ].map(city => (
            <g key={city.name}>
              <line x1={city.x - 4} y1={city.y} x2={city.x + 4} y2={city.y} stroke='rgba(0,255,204,.3)' strokeWidth={1} />
              <line x1={city.x} y1={city.y - 4} x2={city.x} y2={city.y + 4} stroke='rgba(0,255,204,.3)' strokeWidth={1} />
              <text x={city.x + 6} y={city.y - 4} fill='rgba(0,255,204,.5)' fontSize={8} fontFamily='IBM Plex Mono, monospace'>{city.name}</text>
            </g>
          ))}
        </svg>

        {/* Convoy markers via absolutely positioned DOM elements (RAF-animated) */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {(mapData?.convoys ?? []).filter(c => c.lat && c.lng).map(c => (
            <div
              key={c.id}
              id={`convoy-marker-${c.id}`}
              data-lng={c.lng}
              data-lat={c.lat}
              style={{
                position: 'absolute', top: 0, left: 0,
                transform: `translate(${(((c.lng ?? 0) - 28) / (42 - 28)) * 720}px, ${((1 - ((c.lat ?? 0) - (-4)) / (10 - (-4)))) * 252}px) rotate(${c.heading}deg)`,
                pointerEvents: 'none',
                willChange: 'transform',
              }}
            >
              <svg width={16} height={16} viewBox='0 0 16 16' style={{ marginLeft: -8, marginTop: -8 }}>
                <circle cx={8} cy={8} r={7} fill='none' stroke={c.color} strokeWidth={1.5} opacity={0.4} />
                <circle cx={8} cy={8} r={4} fill={c.color} opacity={0.8} />
                <circle cx={8} cy={8} r={2} fill={c.color} />
              </svg>
            </div>
          ))}
        </div>

        {/* Grid overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(0,255,204,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,204,.02) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }} />

        {/* Scanline */}
        <div style={{
          position: 'absolute', left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(0,255,204,.15), transparent)',
          animation: 'd-scanv 4s linear infinite',
          pointerEvents: 'none',
        }} />

        {/* Edge vignette */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.55))',
        }} />
      </div>

      {/* Vehicle chips */}
      {vehicles && vehicles.length > 0 && (
        <div className='d-hscroll' style={{ marginBottom: 12, gap: 8 }}>
          {vehicles.map(v => (
            <button
              key={v.id}
              onClick={() => setSelectedVehicle(v.id === selectedVehicleId ? null : v.id)}
              style={{
                flex: '0 0 auto', scrollSnapAlign: 'start',
                padding: '6px 12px',
                background: v.id === selectedVehicleId ? 'var(--d-sg)' : 'var(--d-well)',
                border: `1px solid ${v.id === selectedVehicleId ? 'var(--d-sig)' : 'var(--d-rim2)'}`,
                borderRadius: 6, cursor: 'pointer',
                color: v.id === selectedVehicleId ? 'var(--d-sig)' : 'var(--d-t2)',
                fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
              }}
            >{v.registration}</button>
          ))}
        </div>
      )}

      {/* Telemetry row */}
      {selectedVehicle && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--d-well)', borderRadius: 8, border: '1px solid var(--d-rim2)' }}>
          <TelItem label='Speed' value={`${Math.round(selectedVehicle.speed_kmh)} km/h`} />
          <TelItem label='Status' value={selectedVehicle.status.toUpperCase()} color={selectedVehicle.status === 'alert' ? 'var(--d-fire)' : selectedVehicle.status === 'moving' ? 'var(--d-ok)' : 'var(--d-t3)'} />
          <TelItem label='Last Ping' value={selectedVehicle.last_ping_at ? relSec(selectedVehicle.last_ping_at) + 's ago' : '—'} />
        </div>
      )}

      {/* Gauges */}
      {selectedVehicle && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          <Gauge label='SPEED' value={selectedVehicle.speed_kmh} max={120} unit='km/h' type='speed' />
          <Gauge label='FUEL' value={selectedVehicle.fuel_pct} max={100} unit='%' type='fuel' />
          <Gauge label='ENGINE' value={selectedVehicle.engine_temp_c} max={120} unit='°C' type='temp' />
          <Gauge label='GPS SIG' value={selectedVehicle.gps_signal_pct} max={100} unit='%' type='signal' />
        </div>
      )}

      {/* Fleet bars */}
      <FleetBars vehicles={vehicles ?? []} />
    </div>
  );
});

function TelItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color ?? 'var(--d-t1)', fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
    </div>
  );
}

function FleetBars({ vehicles }: { vehicles: VehicleTelemetry[] }) {
  const total = vehicles.length;
  if (total === 0) return null;
  const transit = vehicles.filter(v => v.status === 'moving').length;
  const idle = vehicles.filter(v => v.status === 'idle').length;
  const alert = vehicles.filter(v => v.status === 'alert').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      <FleetBar label='In Transit' count={transit} total={total} color='var(--d-sig)' />
      <FleetBar label='Idle' count={idle} total={total} color='var(--d-t3)' />
      <FleetBar label='Alert' count={alert} total={total} color='var(--d-fire)' />
    </div>
  );
}

function FleetBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.style.transition = 'width 1.2s ease'; el.style.width = `${pct}%`; });
  }, [pct]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', width: 70, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden' }}>
        <div ref={barRef} style={{ height: '100%', width: 0, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color, width: 20, textAlign: 'right', flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function relSec(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

export default TacticalMap;
