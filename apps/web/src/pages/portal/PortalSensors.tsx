import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Loader2, Package } from 'lucide-react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

interface SensorReading {
  vehicle_id: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  shock_g: number | null;
  recorded_at: string;
}

const CARD: React.CSSProperties = { background: 'var(--p-surface)' };

function fmtTime(val: string): string {
  return new Date(val).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function stat(vals: number[]): { min: number; max: number; avg: number } | null {
  const v = vals.filter(x => x != null);
  if (!v.length) return null;
  const min = Math.min(...v), max = Math.max(...v);
  const avg = v.reduce((s, x) => s + x, 0) / v.length;
  return { min, max, avg };
}

function StatCard({ label, unit, s }: { label: string; unit: string; s: { min: number; max: number; avg: number } | null }): React.ReactElement {
  if (!s) return (
    <div className="rounded-lg border border-white/[0.07] px-4 py-3" style={CARD}>
      <p className="text-xs text-white/40">{label}</p>
      <p className="text-sm text-white/30 mt-1">No data</p>
    </div>
  );
  return (
    <div className="rounded-lg border border-white/[0.07] px-4 py-3" style={CARD}>
      <p className="text-xs text-white/40 mb-2">{label}</p>
      <div className="flex gap-4 text-xs">
        <div><span className="text-white/40">Min </span><span className="text-blue-300 font-mono">{s.min.toFixed(1)}{unit}</span></div>
        <div><span className="text-white/40">Avg </span><span className="text-white font-mono">{s.avg.toFixed(1)}{unit}</span></div>
        <div><span className="text-white/40">Max </span><span className="text-red-300 font-mono">{s.max.toFixed(1)}{unit}</span></div>
      </div>
    </div>
  );
}

export default function PortalSensors(): React.ReactElement {
  const navigate = useNavigate();
  const { convoy_id } = useParams({ strict: false }) as { convoy_id?: string };
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [hours, setHours] = useState(24);

  useEffect(() => {
    if (!convoy_id) { setErrorMsg('No convoy ID'); setLoading(false); return; }
    setLoading(true);
    fetch(`${API_BASE}/portal/convoy/${convoy_id}/sensors?hours=${hours}`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        return res.json() as Promise<{ data: SensorReading[] }>;
      })
      .then(json => { if (json) setReadings(json.data); })
      .catch((err: Error) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, [convoy_id, navigate, hours]);

  const chartData = useMemo(() =>
    readings.map(r => ({
      t: fmtTime(r.recorded_at),
      temp: r.temperature_c,
      humidity: r.humidity_pct,
      shock: r.shock_g,
    })),
  [readings]);

  const tempVals = readings.map(r => r.temperature_c).filter(x => x != null) as number[];
  const humVals = readings.map(r => r.humidity_pct).filter(x => x != null) as number[];
  const shockVals = readings.map(r => r.shock_g).filter(x => x != null) as number[];

  const hasTemp = tempVals.length > 0;
  const hasHum = humVals.length > 0;
  const hasShock = shockVals.length > 0;

  return (
    <div className="portal-root" style={{ background: 'var(--p-bg)' }}>
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center gap-3">
        <button onClick={() => void navigate({ to: '/portal/dashboard' })} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <Package size={18} className="text-orange-400 shrink-0" />
        <span
          className="font-black text-base tracking-wider uppercase"
          style={{ fontFamily: 'var(--p-sans)', background: 'linear-gradient(90deg,#ff9040,#f07020)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          SONALIT
        </span>
        <span className="text-xs text-gray-500">/ Sensor Telemetry</span>

        {/* Time range selector */}
        <div className="ml-auto flex gap-1">
          {[6, 24, 72].map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                hours === h
                  ? 'border-orange-500/60 text-orange-300 bg-orange-500/10'
                  : 'border-white/[0.08] text-white/40 hover:text-white/70'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-6 pb-12">
        {loading && <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-orange-400" /></div>}

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        )}

        {!loading && !errorMsg && !hasTemp && !hasHum && !hasShock && (
          <div className="flex flex-col items-center justify-center py-20">
            <Package size={40} className="text-white/10 mb-4" />
            <p className="text-white/40 text-sm">No sensor data in the last {hours}h.</p>
          </div>
        )}

        {!loading && !errorMsg && (hasTemp || hasHum || hasShock) && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              <StatCard label="Temperature" unit="°C" s={stat(tempVals)} />
              <StatCard label="Humidity" unit="%" s={stat(humVals)} />
              <StatCard label="Shock" unit="G" s={stat(shockVals)} />
            </div>

            {/* Temperature chart */}
            {hasTemp && (
              <div className="rounded-xl border border-white/[0.07] p-5 mb-4" style={CARD}>
                <p className="text-xs text-white/40 mb-4">Temperature (°C)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} />
                    <Tooltip
                      contentStyle={{ background: '#0d1426', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                      itemStyle={{ color: '#f97316' }}
                    />
                    <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={1.5} dot={false} name="°C" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Humidity chart */}
            {hasHum && (
              <div className="rounded-xl border border-white/[0.07] p-5 mb-4" style={CARD}>
                <p className="text-xs text-white/40 mb-4">Humidity (%)</p>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} />
                    <Tooltip
                      contentStyle={{ background: '#0d1426', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                      itemStyle={{ color: '#60a5fa' }}
                    />
                    <Line type="monotone" dataKey="humidity" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="%" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Shock events */}
            {hasShock && (
              <div className="rounded-xl border border-white/[0.07] p-5" style={CARD}>
                <p className="text-xs text-white/40 mb-4">Shock (G-force)</p>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} />
                    <Tooltip
                      contentStyle={{ background: '#0d1426', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                      itemStyle={{ color: '#f87171' }}
                    />
                    <Line type="monotone" dataKey="shock" stroke="#f87171" strokeWidth={1.5} dot={false} name="G" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
