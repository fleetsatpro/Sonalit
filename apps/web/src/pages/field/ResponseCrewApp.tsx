import { useEffect, useRef, useState } from 'react';
import { Siren, MapPin, Navigation, CheckCircle, AlertTriangle, Shield, Radio, Target } from 'lucide-react';

import { fieldApi, useFieldAuth } from './fieldAuth.js';
import { OfflineBanner } from './OfflineBanner.js';
import { subscribe } from '../../lib/centrifuge.js';
import { playSiren, stopSiren } from '../../lib/siren.js';

interface DispatchAlert {
  id: string;
  team_name: string;
  team_callsign: string | null;
  priority: 'critical' | 'high' | 'medium';
  status: string;
  reason: string;
  target_lat: number;
  target_lng: number;
  target_label: string | null;
  dispatched_at: string;
}

const PRIORITY_CONFIG: Record<string, {
  bg: string; border: string; glow: string; label: string;
  pulseSpeed: string; sirenBorder: string;
}> = {
  critical: {
    bg: 'bg-red-950', border: 'border-red-600', glow: 'shadow-[0_0_60px_-10px_rgba(239,68,68,.6)]',
    label: 'CRITICAL', pulseSpeed: 'animate-[pulse_0.5s_ease-in-out_infinite]',
    sirenBorder: 'border-red-500',
  },
  high: {
    bg: 'bg-amber-950', border: 'border-amber-600', glow: 'shadow-[0_0_40px_-10px_rgba(245,158,11,.5)]',
    label: 'HIGH PRIORITY', pulseSpeed: 'animate-[pulse_1s_ease-in-out_infinite]',
    sirenBorder: 'border-amber-500',
  },
  medium: {
    bg: 'bg-blue-950', border: 'border-blue-600', glow: 'shadow-[0_0_30px_-10px_rgba(59,130,246,.4)]',
    label: 'MEDIUM', pulseSpeed: '',
    sirenBorder: 'border-blue-500',
  },
};

function DispatchAlertCard({
  alert,
  onAcknowledge,
  onStatusUpdate,
  isAcking,
}: {
  alert: DispatchAlert;
  onAcknowledge: (id: string) => void;
  onStatusUpdate: (id: string, status: string) => void;
  isAcking: boolean;
}) {
  const config = PRIORITY_CONFIG[alert.priority] ?? PRIORITY_CONFIG['high']!;
  const isNew = alert.status === 'dispatched';
  const isActive = ['dispatched', 'acknowledged', 'en_route', 'on_scene'].includes(alert.status);

  const openMaps = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${alert.target_lat},${alert.target_lng}&travelmode=driving`;
    window.open(url, '_blank');
  };

  return (
    <div className={`rounded-2xl border-2 p-5 relative overflow-hidden transition-all ${config.bg} ${config.border} ${isNew ? config.glow : ''}`}>
      {isNew && (
        <>
          <style>{`
            @keyframes intercept-strobe {
              0%, 49% { opacity: 0.15; }
              50%, 100% { opacity: 0; }
            }
          `}</style>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(135deg, rgba(255,0,0,.3), transparent)', animation: 'intercept-strobe 0.8s steps(1, end) infinite' }} />
        </>
      )}

      <div className="relative">
        {/* Priority banner */}
        <div className={`flex items-center gap-2 mb-3 ${config.pulseSpeed}`}>
          <Siren size={22} className="text-red-400" />
          <span className="text-lg font-black tracking-widest text-white">{config.label}</span>
          {isNew && (
            <span className="ml-auto px-2 py-0.5 rounded bg-red-600 text-white text-xs font-bold animate-pulse">
              INTERCEPT NOW
            </span>
          )}
        </div>

        {/* Reason */}
        <p className="text-base font-bold text-white mb-2 leading-snug">{alert.reason}</p>

        {/* Target location — big and clear */}
        <div className={`rounded-xl border p-4 mb-3 ${config.sirenBorder} bg-black/30`}>
          <div className="flex items-center gap-2 mb-2">
            <Target size={18} className="text-red-400" />
            <span className="text-sm font-bold text-white">TARGET LOCATION</span>
          </div>
          {alert.target_label && (
            <p className="text-sm text-gray-300 mb-1 font-semibold">{alert.target_label}</p>
          )}
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={14} className="text-gray-400" />
            <span className="text-lg font-mono font-bold text-white tracking-wide">
              {alert.target_lat.toFixed(6)}, {alert.target_lng.toFixed(6)}
            </span>
          </div>
          <button onClick={openMaps}
            className="w-full py-3 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[.97] transition-transform">
            <Navigation size={16} /> NAVIGATE TO TARGET
          </button>
        </div>

        {/* Team info */}
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
          <Shield size={12} />
          <span>{alert.team_name}{alert.team_callsign ? ` — ${alert.team_callsign}` : ''}</span>
          <span className="ml-auto flex items-center gap-1">
            <Radio size={10} className="text-green-500" />
            {new Date(alert.dispatched_at).toLocaleTimeString()}
          </span>
        </div>

        {/* Action buttons */}
        {isActive && (
          <div className="grid grid-cols-2 gap-2">
            {alert.status === 'dispatched' && (
              <button onClick={() => onAcknowledge(alert.id)} disabled={isAcking}
                className="col-span-2 py-3 rounded-lg bg-amber-600/90 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[.97] transition-all disabled:opacity-40">
                <CheckCircle size={16} /> {isAcking ? 'ACKNOWLEDGING…' : 'ACKNOWLEDGE — CREW RESPONDING'}
              </button>
            )}
            {alert.status === 'acknowledged' && (
              <button onClick={() => onStatusUpdate(alert.id, 'en_route')}
                className="col-span-2 py-3 rounded-lg bg-orange-600/90 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[.97] transition-all">
                <Navigation size={16} /> EN ROUTE TO TARGET
              </button>
            )}
            {alert.status === 'en_route' && (
              <button onClick={() => onStatusUpdate(alert.id, 'on_scene')}
                className="col-span-2 py-3 rounded-lg bg-green-600/90 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[.97] transition-all">
                <MapPin size={16} /> ARRIVED ON SCENE
              </button>
            )}
            {alert.status === 'on_scene' && (
              <button onClick={() => onStatusUpdate(alert.id, 'resolved')}
                className="col-span-2 py-3 rounded-lg bg-green-700/90 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[.97] transition-all">
                <CheckCircle size={16} /> SITUATION RESOLVED
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResponseCrewApp() {
  const worker = useFieldAuth(s => s.worker);
  const [dispatches, setDispatches] = useState<DispatchAlert[]>([]);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const sirenActiveRef = useRef(false);

  // Fetch active dispatches on mount
  useEffect(() => {
    fieldApi.get<{ data: DispatchAlert[] }>('/response-crew/dispatches')
      .then(r => { setDispatches(r.data.data ?? []); })
      .catch(() => {});
    const interval = setInterval(() => {
      fieldApi.get<{ data: DispatchAlert[] }>('/response-crew/dispatches')
        .then(r => { setDispatches(r.data.data ?? []); })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to realtime dispatch events
  useEffect(() => {
    if (!worker?.org_id) return;
    return subscribe<Record<string, unknown>>(`org#${worker.org_id}`, (msg) => {
      if (msg['type'] === 'crew.dispatched') {
        const d: DispatchAlert = {
          id: msg['dispatch_id'] as string,
          team_name: msg['team_name'] as string,
          team_callsign: (msg['team_callsign'] as string) ?? null,
          priority: msg['priority'] as DispatchAlert['priority'],
          status: 'dispatched',
          reason: msg['reason'] as string,
          target_lat: msg['target_lat'] as number,
          target_lng: msg['target_lng'] as number,
          target_label: (msg['target_label'] as string) ?? null,
          dispatched_at: msg['dispatched_at'] as string,
        };
        setDispatches(prev => [d, ...prev.filter(p => p.id !== d.id)]);
        if (!sirenActiveRef.current) {
          sirenActiveRef.current = true;
          playSiren('klaxon', { loop: true });
        }
      }
      if (msg['type'] === 'crew.status_update') {
        const status = msg['status'] as string;
        setDispatches(prev => prev.map(d =>
          d.id === (msg['dispatch_id'] as string) ? { ...d, status } : d
        ));
        if (status === 'resolved' || status === 'cancelled') {
          stopSiren();
          sirenActiveRef.current = false;
        }
      }
    });
  }, [worker?.org_id]);

  // Play siren for any unacknowledged dispatches on load
  useEffect(() => {
    const hasUnacked = dispatches.some(d => d.status === 'dispatched');
    if (hasUnacked && !sirenActiveRef.current) {
      sirenActiveRef.current = true;
      playSiren('klaxon', { loop: true });
    }
    if (!hasUnacked && sirenActiveRef.current) {
      stopSiren();
      sirenActiveRef.current = false;
    }
  }, [dispatches]);

  const handleAcknowledge = async (id: string) => {
    setAckingId(id);
    try {
      await fieldApi.patch(`/response-crew/dispatches/${id}/status`, { status: 'acknowledged' });
      setDispatches(prev => prev.map(d => d.id === id ? { ...d, status: 'acknowledged' } : d));
      stopSiren();
      sirenActiveRef.current = false;
    } catch { /* retry on next poll */ }
    setAckingId(null);
  };

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await fieldApi.patch(`/response-crew/dispatches/${id}/status`, { status });
      setDispatches(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    } catch { /* retry on next poll */ }
  };

  const active = dispatches.filter(d =>
    ['dispatched', 'acknowledged', 'en_route', 'on_scene'].includes(d.status)
  );
  const resolved = dispatches.filter(d =>
    d.status === 'resolved' || d.status === 'cancelled'
  );

  return (
    <div className="min-h-screen w-full bg-ink-0 text-text-0 flex flex-col relative overflow-hidden">
      {/* Emergency glow */}
      {active.some(d => d.status === 'dispatched') && (
        <div className="pointer-events-none absolute inset-0 opacity-[.08]"
          style={{ background: 'radial-gradient(ellipse at center, #ff0000, transparent 70%)', animation: 'intercept-strobe 1.2s steps(1, end) infinite' }} />
      )}

      <header className="relative flex items-center justify-between px-5 pt-6 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}>
            <Shield size={18} strokeWidth={2.5} color="#fff" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-2 leading-none">Sonalit</div>
            <div className="text-[16px] font-bold leading-tight mt-0.5">Response Crew</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-2">
          <Radio size={10} className="text-green-500 animate-pulse" />
          LIVE
        </div>
      </header>

      {worker && (
        <div className="relative px-5 mb-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-bold"
            style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)' }}>
            {worker.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-tight truncate">{worker.name}</div>
            <div className="text-[11px] font-mono text-text-2 mt-0.5">Response Crew</div>
          </div>
        </div>
      )}

      <div className="relative -mx-1">
        <OfflineBanner />
      </div>

      <main className="relative flex-1 px-4 pb-6 space-y-3">
        {active.length === 0 && (
          <div className="text-center py-16 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <Shield size={48} className="mx-auto mb-3 text-gray-700" />
            <p className="text-sm text-gray-500 font-semibold">Standing by</p>
            <p className="text-xs text-gray-600 mt-1">You will be alerted when a dispatch is assigned to your team</p>
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-600 mt-4">
              <Radio size={10} className="text-green-500 animate-pulse" />
              Monitoring control room feed
            </div>
          </div>
        )}

        {active.map(d => (
          <DispatchAlertCard
            key={d.id}
            alert={d}
            onAcknowledge={handleAcknowledge}
            onStatusUpdate={handleStatusUpdate}
            isAcking={ackingId === d.id}
          />
        ))}

        {resolved.length > 0 && (
          <>
            <p className="text-xs text-gray-600 font-medium uppercase tracking-wider pt-2">Previous</p>
            {resolved.slice(0, 5).map(d => (
              <div key={d.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 opacity-50">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <CheckCircle size={12} className="text-green-600" />
                  <span className="font-semibold">{d.reason}</span>
                  <span className="ml-auto">{new Date(d.dispatched_at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </main>

      <footer className="relative p-4 text-center text-[10px] font-mono text-text-2/70 flex items-center justify-center gap-1.5">
        <AlertTriangle size={10} />
        Response Crew — Intercept & Recovery Unit
      </footer>
    </div>
  );
}
