import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface WeatherCity {
  city: string; temp_c: number | null; condition: string;
  wind_kmh: number | null; visibility_km: number | null; icon_emoji: string;
}

const CACHE_KEY = 'dashboard_weather_cache';
const CACHE_TTL = 10 * 60 * 1000;

function loadCache(): WeatherCity[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: WeatherCity[] };
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch { return null; }
}

function saveCache(data: WeatherCity[]) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

const WeatherIntelligence = React.memo(function WeatherIntelligence() {
  const { data, isError, refetch } = useQuery<WeatherCity[]>({
    queryKey: ['dashboard-weather'],
    queryFn: async () => {
      const cached = loadCache();
      if (cached) return cached;
      const r = await api.get<WeatherCity[]>('/dashboard/weather');
      const result = Array.isArray(r.data) ? r.data : [];
      saveCache(result);
      return result;
    },
    staleTime: CACHE_TTL,
  });

  if (isError) return <DataError section='Weather Intelligence' onRetry={refetch} />;

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div className='d-hscroll'>
        {(data ?? []).map((w, i) => {
          const heavyRain = w.condition.toLowerCase().includes('rain') || (w.wind_kmh != null && w.wind_kmh > 50);
          return (
            <div key={i} style={{
              flex: '0 0 120px', scrollSnapAlign: 'start',
              background: 'var(--d-surf)',
              border: `1px solid ${heavyRain ? 'var(--d-warn)' : 'var(--d-rim)'}`,
              borderRadius: 10, padding: '12px 10px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <div style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em' }}>{w.city.toUpperCase()}</div>
              <div style={{ fontSize: 28 }}>{w.icon_emoji}</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--d-t1)' }}>
                {w.temp_c != null ? `${w.temp_c}°` : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--d-t2)', textAlign: 'center', lineHeight: 1.3, fontFamily: 'IBM Plex Mono, monospace' }}>{w.condition}</div>
              {w.wind_kmh != null && (
                <div style={{ fontSize: 9, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>💨 {w.wind_kmh} km/h</div>
              )}
              {heavyRain && (
                <div style={{ fontSize: 9, color: 'var(--d-warn)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>ETA IMPACT</div>
              )}
            </div>
          );
        })}
        {(!data || data.length === 0) && (
          <div style={{ color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>Weather unavailable</div>
        )}
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-sig2)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>WEATHER INTELLIGENCE</span>
      <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>East Africa · 6 waypoints</span>
    </div>
  );
}

export default WeatherIntelligence;
