import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';
const CACHE_KEY = 'dashboard_weather_cache';
const CACHE_TTL = 10 * 60 * 1000;
function loadCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw)
            return null;
        const { ts, data } = JSON.parse(raw);
        return Date.now() - ts < CACHE_TTL ? data : null;
    }
    catch {
        return null;
    }
}
function saveCache(data) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    }
    catch { }
}
function etaImpact(cond, wind) {
    const c = cond.toLowerCase();
    if (c.includes('blizzard') || c.includes('storm') || c.includes('hurricane'))
        return 'SEVERE — expect significant delays. Consider route diversion.';
    if (c.includes('thunder'))
        return 'HIGH — thunderstorm risk. Advise drivers to park until clear.';
    if (c.includes('heavy rain') || c.includes('torrential'))
        return 'HIGH — heavy rain reduces visibility. Add 30–60 min buffer.';
    if (c.includes('rain') || c.includes('shower') || c.includes('drizzle'))
        return 'MODERATE — wet roads expected. Reduce speed, increase following distance.';
    if (c.includes('fog') || c.includes('mist') || c.includes('haze'))
        return 'MODERATE — low visibility. Use fog lights, reduce speed.';
    if (wind != null && wind >= 60)
        return 'MODERATE — strong crosswinds. Caution on open roads.';
    if (c.includes('dust') || c.includes('sand'))
        return 'MODERATE — dust reduces visibility. Keep windows closed.';
    return null;
}
const WeatherIntelligence = React.memo(function WeatherIntelligence() {
    const [selectedIdx, setSelectedIdx] = useState(null);
    const { data, isError, refetch } = useQuery({
        queryKey: ['dashboard-weather'],
        queryFn: async () => {
            const cached = loadCache();
            if (cached)
                return cached;
            const r = await api.get('/dashboard/weather');
            const result = r.data.data ?? [];
            saveCache(result);
            return result;
        },
        staleTime: CACHE_TTL,
    });
    if (isError)
        return <DataError section='Weather Intelligence' onRetry={refetch}/>;
    const selected = selectedIdx != null ? (data ?? [])[selectedIdx] ?? null : null;
    return (<div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div className='d-hscroll'>
        {(data ?? []).map((w, i) => {
            const cond = w.condition.toLowerCase();
            const heavyRain = cond.includes('rain') || cond.includes('storm') || cond.includes('thunder') || cond.includes('blizzard');
            const isSelected = selectedIdx === i;
            return (<button key={i} onClick={() => setSelectedIdx(isSelected ? null : i)} style={{
                    flex: '0 0 120px', scrollSnapAlign: 'start',
                    background: isSelected ? 'rgba(249,115,22,.08)' : 'var(--d-surf)',
                    border: `1px solid ${isSelected ? 'var(--d-orange)' : heavyRain ? 'var(--d-warn)' : 'var(--d-rim)'}`,
                    borderRadius: 10, padding: '12px 10px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    cursor: 'pointer', textAlign: 'center',
                    transition: 'background .15s, border-color .15s',
                    outline: 'none',
                }}>
              <div style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: isSelected ? 'var(--d-orange)' : 'var(--d-t3)', letterSpacing: '.06em' }}>{w.city.toUpperCase()}</div>
              <div style={{ fontSize: 28 }}>{w.icon_emoji}</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--d-t1)' }}>
                {w.temp_c != null ? `${w.temp_c}°` : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--d-t2)', textAlign: 'center', lineHeight: 1.3, fontFamily: 'IBM Plex Mono, monospace' }}>{w.condition}</div>
              {w.wind_kmh != null && (<div style={{ fontSize: 9, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>💨 {w.wind_kmh} km/h</div>)}
              {heavyRain && (<div style={{ fontSize: 9, color: 'var(--d-warn)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>ETA IMPACT</div>)}
            </button>);
        })}
        {(!data || data.length === 0) && (<div style={{ color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>Weather unavailable</div>)}
      </div>

      {/* Detail panel — slides in below cards when a city is selected */}
      {selected && (<WeatherDetail city={selected} onClose={() => setSelectedIdx(null)}/>)}
    </div>);
});
function WeatherDetail({ city, onClose }) {
    const impact = etaImpact(city.condition, city.wind_kmh);
    const cond = city.condition.toLowerCase();
    const isAlert = cond.includes('rain') || cond.includes('storm') || cond.includes('thunder') || cond.includes('blizzard') || cond.includes('fog') || (city.wind_kmh != null && city.wind_kmh >= 60);
    return (<div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--d-surf)', border: `1px solid ${isAlert ? 'var(--d-warn)' : 'var(--d-rim)'}`, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }}>{city.icon_emoji}</span>
        <div>
          <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13, color: 'var(--d-t1)', letterSpacing: '.08em' }}>{city.city.toUpperCase()}</div>
          <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', marginTop: 2 }}>{city.condition}</div>
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 28, color: 'var(--d-t1)' }}>{city.temp_c != null ? `${city.temp_c}°C` : '—'}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--d-t3)', fontSize: 16, padding: '4px 6px', lineHeight: 1 }} title='Close'>×</button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <DetailStat label='WIND' value={city.wind_kmh != null ? `${city.wind_kmh} km/h` : '—'}/>
        <DetailStat label='VISIBILITY' value={city.visibility_km != null ? `${city.visibility_km} km` : '—'}/>
        <DetailStat label='CONDITIONS' value={city.condition}/>
      </div>

      {/* ETA impact */}
      {impact && (<div style={{ padding: '8px 12px', background: 'rgba(255,144,64,.08)', border: '1px solid rgba(255,144,64,.25)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-orange)', letterSpacing: '.08em', marginBottom: 4 }}>ETA IMPACT ASSESSMENT</div>
          <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t2)', lineHeight: 1.5 }}>{impact}</div>
        </div>)}
      {!impact && (<div style={{ padding: '6px 12px', background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-ok)', letterSpacing: '.08em' }}>ETA IMPACT — NONE · Conditions nominal for transit</div>
        </div>)}
    </div>);
}
function DetailStat({ label, value }) {
    return (<div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.08em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--d-t1)' }}>{value}</div>
    </div>);
}
function SH() {
    return (<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-sig2)', borderRadius: 2 }}/>
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>WEATHER INTELLIGENCE</span>
      <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>East Africa · 6 waypoints</span>
    </div>);
}
export default WeatherIntelligence;
