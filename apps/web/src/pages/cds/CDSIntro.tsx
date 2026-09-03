import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * CDS opening cinematic — "Secured Corridor".
 *
 * Tells the platform's own story in ~3.8s: a logistics corridor draws itself
 * across a control-room map, a container convoy travels it waypoint to
 * waypoint, and the SecuriSat e-lock engages at delivery — the security
 * payoff — before the wordmark resolves. Shown once per session.
 */

const DURATION = 3800;
const GOLD = '#F0B429';
const ORANGE = '#F97316';
const TEAL = '#33d6a8';

// Corridor path in a 1000×560 field. An S-curve reads as a real route rather
// than a straight line, and gives the convoy something to bank into.
const ROUTE = 'M 70 430 C 240 380, 300 200, 470 210 C 620 218, 660 400, 830 350 C 900 330, 930 250, 950 210';
const WAYPOINTS = [
  { f: 0.02, label: 'ORIGIN PORT' },
  { f: 0.36, label: 'CHECKPOINT' },
  { f: 0.68, label: 'HANDOVER' },
  { f: 0.99, label: 'DELIVERY' },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Pt { x: number; y: number; a: number }

interface CDSIntroProps { onDone: () => void }

export function CDSIntro({ onDone }: CDSIntroProps) {
  const [t, setT] = useState(0);
  const [pathLen, setPathLen] = useState(0);
  const [nodes, setNodes] = useState<Pt[]>([]);
  const pathRef = useRef<SVGPathElement | null>(null);
  const doneRef = useRef(false);
  const rafRef = useRef(0);
  const startRef = useRef(0);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    cancelAnimationFrame(rafRef.current);
    onDone();
  }, [onDone]);

  // Sample the path geometry once it's in the DOM so every moving part shares
  // the exact same curve.
  useEffect(() => {
    const p = pathRef.current;
    if (!p) return;
    const len = p.getTotalLength();
    setPathLen(len);
    setNodes(WAYPOINTS.map(w => {
      const a = p.getPointAtLength(len * w.f);
      const b = p.getPointAtLength(Math.min(len, len * w.f + 2));
      return { x: a.x, y: a.y, a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
    }));
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      setT(clamp01(elapsed / DURATION));
      if (elapsed >= DURATION) { finish(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [finish]);

  // Phase progress derived from the single clock.
  const drawFrac = easeOut(clamp01((t - 0.06) / 0.40));
  const convoyFrac = easeInOut(clamp01((t - 0.24) / 0.44));
  const locked = t > 0.70;
  const lockProg = easeOut(clamp01((t - 0.68) / 0.16));
  const titleIn = t > 0.66;

  // Convoy position along the shared path.
  let convoy: Pt | null = null;
  if (pathRef.current && pathLen > 0 && convoyFrac > 0) {
    const at = pathRef.current.getPointAtLength(pathLen * convoyFrac);
    const ahead = pathRef.current.getPointAtLength(Math.min(pathLen, pathLen * convoyFrac + 3));
    convoy = { x: at.x, y: at.y, a: (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI };
  }

  const dest = nodes[nodes.length - 1];

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden select-none"
      style={{ background: 'radial-gradient(130% 110% at 62% 30%, #0b1424 0%, #070b16 45%, #04060d 100%)' }}>
      <style>{styles}</style>

      {/* Ambient starfield for depth */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-70">
        {STAR_SEED.map((sp, i) => (
          <span key={i} className="absolute rounded-full cds-star" style={{
            left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s, height: sp.s,
            background: '#cbd5e1', animationDelay: `${sp.d}s`,
          }} />
        ))}
      </div>

      {/* The map */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="cds-route" x1="0" y1="0" x2="1000" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={ORANGE} />
            <stop offset="0.55" stopColor={GOLD} />
            <stop offset="1" stopColor={TEAL} />
          </linearGradient>
          <radialGradient id="cds-node" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={GOLD} stopOpacity="0.9" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
          <filter id="cds-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Graticule */}
        <g stroke="rgba(148,163,184,0.06)" strokeWidth="1" className="cds-grid">
          {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={i * 100} y1="0" x2={i * 100} y2="560" />)}
          {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 93} x2="1000" y2={i * 93} />)}
        </g>

        {/* Route: faint bed + animated draw on top */}
        <path ref={pathRef} d={ROUTE} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2.5" strokeLinecap="round" />
        {pathLen > 0 && (
          <path d={ROUTE} fill="none" stroke="url(#cds-route)" strokeWidth="3" strokeLinecap="round"
            filter="url(#cds-glow)"
            strokeDasharray={pathLen}
            strokeDashoffset={pathLen * (1 - drawFrac)} />
        )}

        {/* Waypoints */}
        {nodes.map((n, i) => {
          const wp = WAYPOINTS[i];
          if (!wp) return null;
          const reached = drawFrac >= wp.f - 0.01;
          const isDest = i === nodes.length - 1;
          return (
            <g key={i} opacity={reached ? 1 : 0} className="cds-node-in">
              <circle cx={n.x} cy={n.y} r="26" fill="url(#cds-node)" opacity={reached ? 0.5 : 0} />
              <circle cx={n.x} cy={n.y} r="5" fill={isDest && locked ? TEAL : GOLD} filter="url(#cds-glow)" />
              <circle cx={n.x} cy={n.y} r="10" fill="none" stroke={isDest && locked ? TEAL : GOLD} strokeWidth="1" opacity="0.5" />
              <text x={n.x} y={n.y - 20} textAnchor="middle"
                style={{ fontFamily: 'var(--p-mono, ui-monospace, monospace)', fontSize: 11, letterSpacing: 1.5, fill: 'rgba(226,232,240,0.55)' }}>
                {wp.label}
              </text>
            </g>
          );
        })}

        {/* Convoy glyph traveling the route */}
        {convoy && !locked && (
          <g transform={`translate(${convoy.x} ${convoy.y}) rotate(${convoy.a})`} filter="url(#cds-glow)">
            <rect x="-13" y="-7" width="26" height="14" rx="2.5" fill="#0e1626" stroke={GOLD} strokeWidth="1.5" />
            <line x1="-6" y1="-7" x2="-6" y2="7" stroke={GOLD} strokeWidth="1" opacity="0.5" />
            <line x1="1" y1="-7" x2="1" y2="7" stroke={GOLD} strokeWidth="1" opacity="0.5" />
            <line x1="8" y1="-7" x2="8" y2="7" stroke={GOLD} strokeWidth="1" opacity="0.5" />
            <circle cx="16" cy="0" r="2.5" fill={ORANGE} />
          </g>
        )}

        {/* E-lock engagement at destination — the security payoff */}
        {dest && locked && (
          <g transform={`translate(${dest.x} ${dest.y})`}>
            {/* Expanding secure pulse */}
            <circle cx="0" cy="0" r={20 + lockProg * 60} fill="none" stroke={TEAL}
              strokeWidth="2" opacity={0.6 * (1 - lockProg)} />
            <circle cx="0" cy="0" r={20 + lockProg * 30} fill="none" stroke={TEAL}
              strokeWidth="1" opacity={0.4 * (1 - lockProg)} />
            {/* Padlock */}
            <g transform="translate(0 -2)" filter="url(#cds-glow)">
              {/* Shackle snaps down as it locks */}
              <path d={`M -8 ${-6 - (1 - lockProg) * 8} v -3 a 8 8 0 0 1 16 0 v 3`}
                fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinecap="round" />
              <rect x="-11" y="-6" width="22" height="17" rx="3" fill="#0e1626" stroke={TEAL} strokeWidth="2" />
              <circle cx="0" cy="1" r="2.5" fill={TEAL} />
              <rect x="-1" y="1" width="2" height="5" rx="1" fill={TEAL} />
            </g>
          </g>
        )}
      </svg>

      {/* HUD corners */}
      <div className="absolute top-6 left-8 cds-fade" style={{ fontFamily: 'var(--p-mono, monospace)', animationDelay: '.1s' }}>
        <div className="text-[10px] tracking-[0.3em] text-slate-500">SECURISAT · CORRIDOR CONTROL</div>
      </div>
      <div className="absolute top-6 right-8 text-right cds-fade" style={{ fontFamily: 'var(--p-mono, monospace)', animationDelay: '.25s' }}>
        <div className="text-[10px] tracking-[0.25em] text-slate-500">
          LINK <span style={{ color: TEAL }}>● SECURE</span>
        </div>
        <div className="text-[10px] tracking-[0.2em] text-slate-600 mt-1">
          {locked ? 'CUSTODY: CONFIRMED' : 'CUSTODY: IN TRANSIT'}
        </div>
      </div>

      {/* Title reveal */}
      <div className={`absolute left-8 md:left-14 bottom-[16vh] z-30 transition-all duration-700 ${titleIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="text-[11px] tracking-[0.55em] mb-2" style={{ fontFamily: 'var(--p-mono, monospace)', color: GOLD }}>
          SONALIT
        </div>
        <div className="flex items-end gap-3">
          <span className="font-extrabold text-white leading-none"
            style={{ fontFamily: 'var(--p-sans, system-ui)', fontSize: 'clamp(44px, 8vw, 88px)', letterSpacing: '0.02em' }}>
            CDS
          </span>
          <span className="mb-2 text-[13px] tracking-[0.15em] text-slate-400" style={{ fontFamily: 'var(--p-sans, system-ui)' }}>
            CONTAINER DELIVERY SYSTEM
          </span>
        </div>
        <div className="mt-3 h-[2px] origin-left rounded-full"
          style={{ width: 260, background: `linear-gradient(90deg, ${ORANGE}, ${GOLD}, transparent)`, transform: `scaleX(${titleIn ? 1 : 0})`, transition: 'transform .8s cubic-bezier(.16,1,.3,1) .15s' }} />
        {locked && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 cds-fade"
            style={{ background: 'rgba(51,214,168,0.1)', border: `1px solid rgba(51,214,168,0.3)` }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TEAL, boxShadow: `0 0 8px ${TEAL}` }} />
            <span className="text-[10px] tracking-[0.2em]" style={{ fontFamily: 'var(--p-mono, monospace)', color: TEAL }}>
              CONTAINER SECURED · END-TO-END CUSTODY
            </span>
          </div>
        )}
      </div>

      {/* Grain + vignette */}
      <div className="pointer-events-none absolute inset-0 cds-scanlines" />
      <div className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 55% 40%, transparent 35%, rgba(0,0,0,0.7) 100%)' }} />

      <button type="button" onClick={finish}
        className="absolute bottom-6 right-6 z-40 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-[10px] font-medium tracking-[0.15em] text-white/50 backdrop-blur-md transition-all hover:border-white/40 hover:text-white/90 cursor-pointer"
        style={{ fontFamily: 'var(--p-mono, monospace)' }}>
        SKIP
      </button>
    </div>
  );
}

const STAR_SEED = Array.from({ length: 60 }, (_, i) => ({
  x: (i * 61.803) % 100,
  y: (i * 37.51) % 100,
  s: 1 + (i % 3) * 0.6,
  d: (i * 0.11) % 3,
}));

const styles = `
  @keyframes cds-star-tw { 0%,100% { opacity: .15; } 50% { opacity: .7; } }
  .cds-star { animation: cds-star-tw 3s ease-in-out infinite; }
  @keyframes cds-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .cds-fade { animation: cds-fade-in .6s ease-out both; }
  .cds-node-in { transition: opacity .4s ease-out; }
  .cds-grid { animation: cds-fade-in 1s ease-out both; }
  .cds-scanlines {
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,.012) 2px, rgba(255,255,255,.012) 4px);
  }
  @media (prefers-reduced-motion: reduce) {
    .cds-star, .cds-fade, .cds-grid { animation: none !important; }
  }
`;
