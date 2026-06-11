import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Shield } from 'lucide-react';
import { PortalShell } from '../../components/portal/PortalPrimitives.js';
import { SecurityStatusBar } from '../../components/portal/SecurityStatusBar.js';
import { IncidentFeed } from '../../components/portal/IncidentFeed.js';
import { subscribePortal as subscribe } from '../../lib/portalCentrifuge.js';
// ── Animated map overlay ──────────────────────────────────────────────────────
const MAP_STYLE_ID = 'security-map-keyframes';
function ensureMapStyle() {
    if (typeof document === 'undefined')
        return;
    if (document.getElementById(MAP_STYLE_ID))
        return;
    const el = document.createElement('style');
    el.id = MAP_STYLE_ID;
    el.textContent = `
    @media (prefers-reduced-motion: no-preference) {
      @keyframes sos-ring {
        0%   { r: 18; opacity: 0.9; }
        100% { r: 42; opacity: 0; }
      }
      @keyframes drift {
        0%,100% { transform: translateX(0); }
        33%      { transform: translateX(8px) translateY(-4px); }
        66%      { transform: translateX(-4px) translateY(6px); }
      }
      @keyframes freeze-shake {
        0%,100% { transform: translateX(0); }
        25%     { transform: translateX(-2px); }
        75%     { transform: translateX(2px); }
      }
      .security-truck-drift   { animation: drift 4s ease-in-out infinite; }
      .security-truck-freeze  { animation: freeze-shake 0.5s ease-in-out 2; }
      .security-sos-ring      { animation: sos-ring 1.4s ease-out infinite; }
    }
  `;
    document.head.appendChild(el);
}
function SecurityMapOverlay({ level, incidentType }) {
    const ringRef = useRef(null);
    useEffect(() => { ensureMapStyle(); }, []);
    const truckClass = level === 'critical' ? 'security-truck-drift' :
        level === 'warning' && incidentType === 'unplanned_stop' ? 'security-truck-freeze' :
            '';
    const ringColor = level === 'critical' ? '#ef4444' :
        level === 'warning' ? '#f5b042' :
            'transparent';
    return (<div className="relative rounded-2xl overflow-hidden portal-reveal portal-reveal-2" style={{ background: 'var(--p-surface2)', border: '1px solid rgba(255,255,255,0.07)', height: 220 }}>

      {/* Stylised road network */}
      <svg viewBox="0 0 400 220" className="absolute inset-0 w-full h-full">
        {/* Background grid lines (city grid) */}
        <line x1="0" y1="70" x2="400" y2="70" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        <line x1="0" y1="140" x2="400" y2="140" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        <line x1="100" y1="0" x2="100" y2="220" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        <line x1="200" y1="0" x2="200" y2="220" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        <line x1="300" y1="0" x2="300" y2="220" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>

        {/* Main route */}
        <path d="M30,160 Q120,150 200,110 Q280,70 370,60" stroke="rgba(249,115,22,0.35)" strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="6 4"/>

        {/* Route highlight */}
        <path d="M30,160 Q120,150 200,110 Q280,70 370,60" stroke="rgba(249,115,22,0.08)" strokeWidth="10" fill="none" strokeLinecap="round"/>

        {/* Origin dot */}
        <circle cx="30" cy="160" r="5" fill="#f97316" opacity="0.8"/>
        {/* Destination dot */}
        <circle cx="370" cy="60" r="5" fill="#60a5fa" opacity="0.8"/>

        {/* SOS pulsing rings (when critical) */}
        {level === 'critical' && (<>
            <circle ref={ringRef} cx="200" cy="110" r="18" fill="none" stroke={ringColor} strokeWidth="2" className="security-sos-ring" style={{ transformOrigin: '200px 110px' }}/>
            <circle cx="200" cy="110" r="18" fill="none" stroke={ringColor} strokeWidth="1.5" className="security-sos-ring" style={{ animationDelay: '0.7s', transformOrigin: '200px 110px' }}/>
          </>)}
        {/* Warning ring */}
        {level === 'warning' && (<circle cx="200" cy="110" r="20" fill="none" stroke={ringColor} strokeWidth="1.5" opacity="0.5" strokeDasharray="4 3"/>)}

        {/* Truck icon group */}
        <g className={truckClass} style={{ transformOrigin: '200px 110px' }}>
          {/* Truck body */}
          <rect x="191" y="103" width="18" height="12" rx="2" fill={level === 'critical' ? '#ef4444' : level === 'warning' ? '#f5b042' : '#22c55e'} opacity="0.9"/>
          {/* Cabin */}
          <rect x="191" y="105" width="7" height="8" rx="1.5" fill={level === 'critical' ? '#dc2626' : level === 'warning' ? '#d97706' : '#16a34a'} opacity="0.9"/>
          {/* Wheels */}
          <circle cx="194" cy="116" r="2" fill="rgba(255,255,255,0.5)"/>
          <circle cx="205" cy="116" r="2" fill="rgba(255,255,255,0.5)"/>
          {/* Heading arrow */}
          <polygon points="210,107 214,110 210,113" fill={level === 'critical' ? '#ef4444' : level === 'warning' ? '#f5b042' : '#22c55e'} opacity="0.7"/>
        </g>

        {/* Escort vehicles */}
        <g style={{ opacity: 0.5 }}>
          <rect x="178" y="115" width="12" height="8" rx="1.5" fill="#818cf8"/>
          <circle cx="180" cy="124" r="1.5" fill="rgba(255,255,255,0.4)"/>
          <circle cx="188" cy="124" r="1.5" fill="rgba(255,255,255,0.4)"/>
        </g>
      </svg>

      {/* Level badge overlay */}
      <div className="absolute top-3 right-3">
        <span className="text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full" style={{
            color: level === 'critical' ? '#ef4444' : level === 'warning' ? '#f5b042' : '#22c55e',
            background: level === 'critical' ? 'rgba(239,68,68,0.15)' : level === 'warning' ? 'rgba(245,176,66,0.15)' : 'rgba(34,197,94,0.15)',
        }}>
          {level === 'critical' ? 'ALERT' : level === 'warning' ? 'MONITORING' : 'SECURE'}
        </span>
      </div>

      {/* Scale indicator */}
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
        <div className="w-8 h-px" style={{ background: 'rgba(255,255,255,0.2)' }}/>
        <span className="mono text-[10px] text-white/20">Route</span>
      </div>
    </div>);
}
// ── Main page ─────────────────────────────────────────────────────────────────
export default function PortalSecurity() {
    const params = useParams({ strict: false });
    const convoy_id = params.convoy_id ?? '';
    const navigate = useNavigate();
    const [level, setLevel] = useState('secure');
    const [activeType, setActiveType] = useState(null);
    // Subscribe to real-time to track map state separately from status bar
    useEffect(() => {
        if (!convoy_id)
            return;
        return subscribe(`portal#${convoy_id}`, evt => {
            if (evt.type === 'security') {
                setLevel(evt.level);
                if (evt.incident && evt.incident.status !== 'resolved') {
                    setActiveType(evt.incident.type);
                }
                else if (evt.level === 'secure') {
                    setActiveType(null);
                }
            }
        });
    }, [convoy_id]);
    return (<PortalShell>
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]" style={{ background: 'var(--p-bg)' }}>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id } })} className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all">
          <ArrowLeft size={16}/>
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white">Live Security</p>
          <p className="text-xs text-white/30 flex items-center gap-1">
            <Shield size={10}/> Real-time incident feed
          </p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-16 space-y-4">
        {/* Persistent status bar */}
        <SecurityStatusBar convoyId={convoy_id}/>

        {/* Animated map overlay */}
        <SecurityMapOverlay level={level} incidentType={activeType}/>

        {/* Incident feed */}
        <div className="portal-reveal portal-reveal-3">
          <p className="text-[11px] font-semibold tracking-widest text-white/30 uppercase mb-3">
            Incident History
          </p>
          <IncidentFeed convoyId={convoy_id} onLevelChange={l => setLevel(l)}/>
        </div>

        {/* Privacy note */}
        <p className="text-[11px] text-white/20 text-center pb-2 leading-relaxed portal-reveal portal-reveal-5">
          Incident details are summarised to protect operational security.
          <br />Contact your account manager for a full debrief.
        </p>
      </main>
    </PortalShell>);
}
