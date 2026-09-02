import { useEffect, useRef, useState, useCallback } from 'react';

const BOOT_LINES = [
  { text: 'INITIALIZING CDS KERNEL', delay: 0 },
  { text: 'LOADING SECURITY PROTOCOLS', delay: 200 },
  { text: 'GPS TRACKING MODULE .......... ONLINE', delay: 450 },
  { text: 'E-LOCK MESH NETWORK .......... ACTIVE', delay: 650 },
  { text: 'CONTAINER REGISTRY ........... SYNCED', delay: 850 },
  { text: 'ANOMALY DETECTION ENGINE ..... ARMED', delay: 1050 },
  { text: 'FLEET TELEMETRY STREAM ....... LIVE', delay: 1200 },
  { text: 'ENCRYPTION LAYER ............. AES-256', delay: 1350 },
];

const HEX_COUNT = 35;
const PARTICLE_COUNT = 50;
const TOTAL_DURATION = 4200;

interface CDSIntroProps { onDone: () => void }

export function CDSIntro({ onDone }: CDSIntroProps) {
  const [phase, setPhase] = useState<'boot' | 'reveal' | 'done'>('boot');
  const [visibleLines, setVisibleLines] = useState(0);
  const [scanAngle, setScanAngle] = useState(0);
  const done = useRef(false);
  const rafRef = useRef<number>(0);
  const startRef = useRef(0);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    cancelAnimationFrame(rafRef.current);
    onDone();
  }, [onDone]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    startRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      setScanAngle((elapsed * 0.12) % 360);

      let shown = 0;
      for (const line of BOOT_LINES) { if (elapsed > line.delay + 300) shown++; }
      setVisibleLines(shown);

      if (elapsed > TOTAL_DURATION - 800 && phase === 'boot') setPhase('reveal');
      if (elapsed > TOTAL_DURATION) { finish(); return; }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [finish, phase]);

  if (phase === 'done') return null;

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-[#030508] select-none">
      <style>{introStyles}</style>

      {/* Hex grid */}
      <div className="absolute inset-0 overflow-hidden opacity-[0.07]">
        {Array.from({ length: HEX_COUNT }, (_, i) => {
          const x = (i * 137.508) % 100;
          const y = (i * 61.803) % 100;
          const d = 20 + (i % 5) * 8;
          return (
            <div key={i} className="absolute cds-hex" style={{
              left: `${x}%`, top: `${y}%`, width: d, height: d,
              animationDelay: `${i * 0.08}s`,
            }} />
          );
        })}
      </div>

      {/* Scanning ring */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: 320, height: 320 }}>
          {/* Outer ring */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 320">
            <circle cx="160" cy="160" r="140" fill="none" stroke="rgba(240,180,41,.12)" strokeWidth="1" />
            <circle cx="160" cy="160" r="110" fill="none" stroke="rgba(240,180,41,.08)" strokeWidth="1" strokeDasharray="4 8" />
            <circle cx="160" cy="160" r="80" fill="none" stroke="rgba(240,180,41,.06)" strokeWidth="1" />
            {/* Scan sweep */}
            <path
              d={`M160 160 L${160 + 140 * Math.cos((scanAngle * Math.PI) / 180)} ${160 + 140 * Math.sin((scanAngle * Math.PI) / 180)} A140 140 0 0 0 ${160 + 140 * Math.cos(((scanAngle - 40) * Math.PI) / 180)} ${160 + 140 * Math.sin(((scanAngle - 40) * Math.PI) / 180)} Z`}
              fill="url(#scanGrad)" opacity="0.35"
            />
            <defs>
              <radialGradient id="scanGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#F0B429" stopOpacity="0" />
                <stop offset="100%" stopColor="#F0B429" stopOpacity=".5" />
              </radialGradient>
            </defs>
            {/* Tick marks */}
            {Array.from({ length: 36 }, (_, i) => {
              const a = (i * 10 * Math.PI) / 180;
              const r1 = 136, r2 = i % 3 === 0 ? 145 : 141;
              return <line key={i} x1={160 + r1 * Math.cos(a)} y1={160 + r1 * Math.sin(a)}
                x2={160 + r2 * Math.cos(a)} y2={160 + r2 * Math.sin(a)}
                stroke="rgba(240,180,41,.3)" strokeWidth={i % 3 === 0 ? 2 : 1} />;
            })}
          </svg>
          {/* Center emblem */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`cds-emblem ${phase === 'reveal' ? 'cds-emblem-reveal' : ''}`}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <path d="M20 7H4c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2ZM8 15H6v-6h2v6Zm4 0h-2v-6h2v6Zm4 0h-2v-6h2v6Zm4 0h-2v-6h2v6ZM21 4H3a1 1 0 0 0 0 2h18a1 1 0 0 0 0-2ZM21 18H3a1 1 0 0 0 0 2h18a1 1 0 0 0 0-2Z"
                  fill="url(#emblemGrad)" />
                <defs>
                  <linearGradient id="emblemGrad" x1="2" y1="4" x2="22" y2="20">
                    <stop stopColor="#F0B429" /><stop offset="1" stopColor="#ff7a00" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
          <div key={i} className="absolute w-px h-px rounded-full bg-[#F0B429] cds-particle" style={{
            left: `${(i * 83.7) % 100}%`,
            top: `${(i * 47.3) % 100}%`,
            animationDelay: `${(i * 0.13) % 3}s`,
            animationDuration: `${2 + (i % 3)}s`,
          }} />
        ))}
      </div>

      {/* Title block */}
      <div className="absolute left-8 top-[12vh] md:left-14 z-30">
        <div className="text-[10px] font-mono tracking-[0.6em] text-[#F0B429]/60 cds-fade-in">
          SONALIT
        </div>
        <div className="mt-2 cds-fade-in" style={{ animationDelay: '.2s' }}>
          <span className="text-[26px] md:text-[36px] font-bold tracking-[0.12em] text-white/95"
            style={{ fontFamily: 'system-ui, sans-serif' }}>
            CDS
          </span>
        </div>
        <div className="mt-1 h-px bg-gradient-to-r from-[#F0B429] to-transparent cds-wipe" style={{ width: 120 }} />
        <div className="mt-3 text-[9px] tracking-[0.35em] text-white/40 font-mono cds-fade-in" style={{ animationDelay: '.5s' }}>
          CONTAINER DELIVERY SYSTEM
        </div>
      </div>

      {/* Boot log */}
      <div className="absolute left-8 bottom-[14vh] md:left-14 z-30 font-mono" style={{ maxWidth: 420 }}>
        {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
          <div key={i} className="cds-line-in text-[10px] leading-[1.8] tracking-wider"
            style={{ color: i === visibleLines - 1 ? '#F0B429' : 'rgba(255,255,255,.3)' }}>
            {line.text}
          </div>
        ))}
        {visibleLines >= BOOT_LINES.length && (
          <div className="mt-3 cds-line-in">
            <span className="text-[11px] font-bold tracking-[0.3em]"
              style={{ color: '#33d6a8' }}>
              SYSTEM READY
            </span>
          </div>
        )}
      </div>

      {/* Corner markers */}
      <div className="absolute top-6 right-6 z-30">
        <div className="text-[9px] font-mono tracking-wider text-white/20 text-right">
          <div>SEC LEVEL: ALPHA</div>
          <div className="mt-0.5">PROTOCOL: ACTIVE</div>
        </div>
      </div>

      {/* Scanlines overlay */}
      <div className="pointer-events-none absolute inset-0 cds-scanlines" />

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.75) 100%)' }} />

      {/* Reveal flash */}
      {phase === 'reveal' && (
        <div className="absolute inset-0 cds-flash pointer-events-none"
          style={{ background: 'radial-gradient(circle at 50% 50%, rgba(240,180,41,.15), transparent 70%)' }} />
      )}

      {/* Skip */}
      <button type="button" onClick={finish}
        className="absolute bottom-6 right-6 z-40 rounded-full border border-white/15 bg-black/40 px-4 py-2 text-[10px] font-medium tracking-[0.15em] text-white/50 backdrop-blur-md transition-all hover:border-[#F0B429]/40 hover:text-white/80 cursor-pointer">
        SKIP
      </button>
    </div>
  );
}

const introStyles = `
  @keyframes cds-hex-pulse {
    0%, 100% { opacity: 0; transform: scale(.8); }
    50% { opacity: 1; transform: scale(1); }
  }
  .cds-hex {
    border: 1px solid #F0B429;
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    animation: cds-hex-pulse 3s ease-in-out infinite;
  }
  @keyframes cds-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .cds-fade-in { animation: cds-fade-in .6s ease-out both; }
  @keyframes cds-wipe {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }
  .cds-wipe { transform-origin: left; animation: cds-wipe .8s ease-out .3s both; }
  @keyframes cds-line-in {
    from { opacity: 0; transform: translateX(-6px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .cds-line-in { animation: cds-line-in .25s ease-out both; }
  @keyframes cds-particle-float {
    0% { opacity: 0; transform: translateY(0) scale(1); }
    20% { opacity: .6; }
    100% { opacity: 0; transform: translateY(-60px) scale(0); }
  }
  .cds-particle { animation: cds-particle-float 2.5s ease-out infinite; }
  .cds-emblem {
    transition: all .8s cubic-bezier(.16,1,.3,1);
    opacity: .7;
    filter: drop-shadow(0 0 12px rgba(240,180,41,.3));
  }
  .cds-emblem-reveal {
    opacity: 1;
    transform: scale(1.2);
    filter: drop-shadow(0 0 40px rgba(240,180,41,.6));
  }
  @keyframes cds-flash { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
  .cds-flash { animation: cds-flash .8s ease-out both; }
  .cds-scanlines {
    background: repeating-linear-gradient(
      0deg, transparent, transparent 2px,
      rgba(255,255,255,.015) 2px, rgba(255,255,255,.015) 4px
    );
  }
  @media (prefers-reduced-motion: reduce) {
    .cds-hex, .cds-particle, .cds-fade-in, .cds-wipe, .cds-line-in, .cds-flash { animation: none !important; }
    .cds-emblem, .cds-emblem-reveal { transition: none !important; }
  }
`;
