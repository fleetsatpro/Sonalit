import { useEffect, useState } from 'react';

const SCENES = [
  { id: 'highway', dur: 2200 },
  { id: 'forest', dur: 2200 },
  { id: 'port', dur: 2200 },
  { id: 'cranes', dur: 2200 },
  { id: 'vessel', dur: 3000 },
];

const TOTAL = SCENES.reduce((s, x) => s + x.dur, 0);

export function CDSIntro({ onDone }: { onDone: () => void }) {
  const [scene, setScene] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const advance = (idx: number) => {
      if (idx >= SCENES.length) { onDone(); return; }
      const dur = SCENES[idx]!.dur;
      t = setTimeout(() => {
        setFading(true);
        setTimeout(() => { setFading(false); setScene(idx + 1); advance(idx + 1); }, 400);
      }, dur - 400);
    };
    advance(0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = () => { onDone(); };

  return (
    <div className="fixed inset-0 z-[999] overflow-hidden bg-[#02040a]" style={{ fontFamily: 'monospace' }}>
      <style>{`
        @keyframes truckmove { from { transform: translateX(-120px); } to { transform: translateX(calc(100vw + 40px)); } }
        @keyframes twinkle { 0%,100% { opacity:.15; } 50% { opacity:.9; } }
        @keyframes cdscraneswing { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
        @keyframes waveflow { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes glowpulse { 0%,100% { opacity:.6; text-shadow: 0 0 18px #ff7a00,0 0 40px #ff7a00aa; } 50% { opacity:1; text-shadow: 0 0 30px #F0B429,0 0 80px #ff7a00; } }
        @keyframes cdsscan { 0% { transform: translateY(-10%); opacity:0; } 10% { opacity:.7; } 90% { opacity:.7; } 100% { transform: translateY(110%); opacity:0; } }
        @keyframes fadeinup { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
        @keyframes cdsflicker { 0%,100%{opacity:.9}40%{opacity:.5}50%{opacity:1}70%{opacity:.7} }
      `}</style>

      <div className="absolute inset-0" style={{ opacity: fading ? 0 : 1, transition: 'opacity .4s ease' }}>
        {scene === 0 && <SceneHighway />}
        {scene === 1 && <SceneForest />}
        {scene === 2 && <ScenePort />}
        {scene === 3 && <SceneCranes />}
        {scene >= 4 && <SceneVessel onDone={onDone} />}
      </div>

      {/* progress dots */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
        {SCENES.map((_, i) => (
          <div key={i} className="rounded-full transition-all duration-500"
            style={{ width: i === scene ? 20 : 6, height: 6, background: i <= scene ? '#F0B429' : 'rgba(255,255,255,.18)' }}
          />
        ))}
      </div>

      <button
        onClick={skip}
        className="absolute top-5 right-5 px-3 py-1.5 rounded-lg text-[11px] font-mono text-white/40 hover:text-white/80 border border-white/10 hover:border-white/25 transition-colors bg-black/30"
        style={{ letterSpacing: '.1em' }}
      >
        SKIP
      </button>
      <div className="absolute bottom-4 right-5 text-[9px] font-mono text-white/15" style={{ letterSpacing: '.12em' }}>
        {((TOTAL / 1000) | 0)}s INTRO
      </div>
    </div>
  );
}

function Stars() {
  const pts = Array.from({ length: 60 }, (_, i) => ({ x: (i * 37 + 11) % 100, y: (i * 53 + 7) % 60, d: (i % 3) * 0.4 + 0.3, s: i % 5 === 0 ? 2 : 1 }));
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 60" preserveAspectRatio="none">
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.s * 0.25} fill="white"
          style={{ animation: `twinkle ${2 + p.d}s ease-in-out infinite`, animationDelay: `${p.d}s` }} />
      ))}
    </svg>
  );
}

function Road({ horizon = 52 }: { horizon?: number }) {
  return (
    <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 200 50" preserveAspectRatio="none" style={{ height: `${100 - horizon}%` }}>
      <defs>
        <linearGradient id="rdg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1d24" />
          <stop offset="100%" stopColor="#111318" />
        </linearGradient>
      </defs>
      <polygon points="70,0 130,0 200,50 0,50" fill="url(#rdg)" />
      <polygon points="70,0 130,0 200,50 0,50" fill="none" stroke="#2a2d36" strokeWidth="0.5" />
      {[0, 10, 20, 30, 40].map(y => (
        <rect key={y} x="98" y={y} width="4" height="4" rx="0.5" fill="#F0B429" opacity="0.5" />
      ))}
    </svg>
  );
}

function Truck({ style }: { style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 80 28" width="80" height="28" style={style}>
      <rect x="0" y="8" width="55" height="18" rx="2" fill="#1e2330" stroke="#2e3548" strokeWidth="0.5" />
      <rect x="55" y="12" width="22" height="14" rx="2" fill="#141824" stroke="#2e3548" strokeWidth="0.5" />
      <rect x="57" y="14" width="14" height="7" rx="1" fill="#1a2540" opacity="0.8" />
      <rect x="73" y="18" width="5" height="3" fill="#F0B429" opacity="0.9" />
      <circle cx="14" cy="26" r="4" fill="#0c0e12" stroke="#3a3f50" strokeWidth="1.5" />
      <circle cx="14" cy="26" r="2" fill="#1e2330" />
      <circle cx="42" cy="26" r="4" fill="#0c0e12" stroke="#3a3f50" strokeWidth="1.5" />
      <circle cx="42" cy="26" r="2" fill="#1e2330" />
      <rect x="0" y="18" width="55" height="1.5" fill="#33d6a8" opacity="0.2" />
      <rect x="2" y="22" width="8" height="2" rx="0.5" fill="#F0B429" opacity="0.7" />
    </svg>
  );
}

function SceneHighway() {
  return (
    <div className="relative w-full h-full" style={{ background: 'linear-gradient(180deg, #050810 0%, #0a0c14 55%, #1a1d24 100%)' }}>
      <Stars />
      <div className="absolute left-0 right-0" style={{ top: '15%', fontSize: 11, letterSpacing: '.18em', color: 'rgba(255,180,30,.25)', textAlign: 'center', fontFamily: 'monospace' }}>EAST AFRICA TRANSPORT CORRIDOR</div>
      {[{ x: '8%', h: 90, c: '#0d1120' }, { x: '15%', h: 120, c: '#0f1325' }, { x: '80%', h: 85, c: '#0d1120' }, { x: '87%', h: 110, c: '#0f1325' }].map((m, i) => (
        <div key={i} className="absolute bottom-[48%]" style={{ left: m.x, width: 18, height: m.h, background: m.c, borderTop: '2px solid #1a1e2e' }} />
      ))}
      <Road horizon={52} />
      <div className="absolute" style={{ bottom: '32%', animation: `truckmove 2.2s linear forwards` }}>
        <Truck />
      </div>
      <div className="absolute bottom-[46%] left-0 right-0" style={{ height: 1, background: 'linear-gradient(90deg,transparent,#F0B42922,transparent)' }} />
    </div>
  );
}

function SceneForest() {
  const trees = Array.from({ length: 22 }, (_, i) => ({ x: (i * 9 + 2) % 100, h: 60 + (i * 13) % 50, c: i % 3 === 0 ? '#0a1a0e' : '#0d2010' }));
  return (
    <div className="relative w-full h-full" style={{ background: 'linear-gradient(180deg, #060d0a 0%, #0a140d 55%, #111810 100%)' }}>
      {trees.map((t, i) => (
        <div key={i} className="absolute bottom-[42%]" style={{ left: `${t.x}%`, width: 0, height: 0, borderLeft: `${t.h * 0.35}px solid transparent`, borderRight: `${t.h * 0.35}px solid transparent`, borderBottom: `${t.h}px solid ${t.c}` }} />
      ))}
      <Road horizon={42} />
      <div className="absolute" style={{ bottom: '22%', animation: 'truckmove 2.2s linear forwards' }}>
        <Truck />
      </div>
      <div className="absolute left-0 right-0" style={{ bottom: '41%', height: 2, background: 'linear-gradient(90deg,#0d2010,#1a3318,#0d2010)' }} />
    </div>
  );
}

function ScenePort() {
  return (
    <div className="relative w-full h-full" style={{ background: 'linear-gradient(180deg, #0d1020 0%, #1a1628 40%, #1e1a10 80%, #28220e 100%)' }}>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 40% at 50% 20%, rgba(255,140,0,.07) 0%, transparent 70%)' }} />
      {[{ x: '10%', h: '40%', w: 60 }, { x: '22%', h: '50%', w: 60 }, { x: '34%', h: '35%', w: 60 }, { x: '62%', h: '45%', w: 60 }, { x: '74%', h: '55%', w: 60 }, { x: '86%', h: '38%', w: 60 }].map((s, i) => (
        <div key={i} className="absolute bottom-[30%]" style={{ left: s.x, height: s.h, width: s.w, background: 'linear-gradient(180deg,#1a2030,#111520)', border: '1px solid #1e2435', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3, padding: 4 }}>
          {[0, 1, 2].map(j => <div key={j} style={{ height: 10, background: j % 2 === 0 ? '#1e3a28' : '#1e2a3a', borderRadius: 1 }} />)}
        </div>
      ))}
      <div className="absolute" style={{ bottom: '30%', left: 0, right: 0, height: 2, background: '#F0B42933' }} />
      <div className="absolute" style={{ bottom: '28%', left: 0, right: 0, height: 28, background: 'linear-gradient(180deg, #12141c, #0c0e14)' }} />
      <div className="absolute bottom-[28%] left-0 right-0 text-center" style={{ fontSize: 10, letterSpacing: '.2em', color: '#F0B429', fontFamily: 'monospace', animation: 'cdsflicker 2s ease-in-out' }}>▶ PORT ENTRANCE</div>
      <Road horizon={28} />
    </div>
  );
}

function SceneCranes() {
  return (
    <div className="relative w-full h-full" style={{ background: 'linear-gradient(180deg, #050810 0%, #080c18 60%, #0e1220 100%)' }}>
      {[{ x: '15%' }, { x: '42%' }, { x: '68%' }].map((c, i) => (
        <div key={i} className="absolute bottom-[35%]" style={{ left: c.x, animation: `cdscraneswing ${2.5 + i * 0.4}s ease-in-out infinite`, transformOrigin: 'bottom center' }}>
          <svg viewBox="0 0 40 120" width="40" height="120">
            <rect x="18" y="0" width="4" height="120" fill="#1a2030" />
            <rect x="0" y="8" width="40" height="4" fill="#1e2840" />
            <rect x="2" y="12" width="2" height="30" fill="#1a2030" opacity="0.8" />
            <rect x="15" y="12" width="1.5" height="60" fill="#2a3550" opacity="0.7" />
          </svg>
        </div>
      ))}
      <div className="absolute bottom-0 left-0 right-0" style={{ height: '35%', background: 'linear-gradient(180deg, #0a0e18, #060810)' }}>
        <svg className="w-full h-full" viewBox="0 0 200 80" preserveAspectRatio="none">
          <rect x="0" y="0" width="200" height="80" fill="#06080e" />
          {[0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4, 5, 6].map(c => (
            <rect key={`${r}-${c}`} x={c * 30 + 2} y={r * 14 + 4} width="26" height="10" rx="1"
              fill={r % 2 === c % 2 ? '#1e3a28' : '#1e2a3a'} stroke="#0a0e18" strokeWidth="0.5" />
          )))}
        </svg>
      </div>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 40% 30% at 50% 30%, rgba(255,120,0,.06) 0%, transparent 70%)' }} />
    </div>
  );
}

function SceneVessel({ onDone }: { onDone: () => void }) {
  const [titleIn, setTitleIn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTitleIn(true), 600); return () => clearTimeout(t); }, []);
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="relative w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(180deg, #060810 0%, #0c1020 45%, #0e1820 70%, #081018 100%)' }}>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 50% at 50% 60%, rgba(255,120,0,.12) 0%, transparent 65%)' }} />
      {/* ocean waves */}
      <div className="absolute" style={{ bottom: '22%', left: 0, right: 0, height: 40, overflow: 'hidden' }}>
        <svg viewBox="0 0 400 40" style={{ width: '200%', height: '100%', animation: 'waveflow 4s linear infinite' }}>
          <path d="M0,20 Q25,10 50,20 T100,20 T150,20 T200,20 T250,20 T300,20 T350,20 T400,20 V40 H0Z" fill="#0a1a28" opacity="0.9" />
          <path d="M0,25 Q25,15 50,25 T100,25 T150,25 T200,25 T250,25 T300,25 T350,25 T400,25 V40 H0Z" fill="#081420" />
        </svg>
      </div>
      {/* ship silhouette */}
      <div className="absolute" style={{ bottom: '20%', left: '50%', transform: 'translateX(-50%)' }}>
        <svg viewBox="0 0 260 90" width="260" height="90">
          <path d="M10,70 Q130,50 250,70 L240,80 Q130,90 20,80 Z" fill="#0e1828" stroke="#1a2840" strokeWidth="0.8" />
          <rect x="60" y="30" width="140" height="40" rx="2" fill="#111e30" stroke="#1a2840" strokeWidth="0.5" />
          <rect x="100" y="10" width="60" height="22" rx="2" fill="#0e1828" stroke="#1a2840" strokeWidth="0.5" />
          <rect x="118" y="2" width="8" height="10" fill="#1a2840" />
          <circle cx="122" cy="2" r="2" fill="#ff5c5c" opacity="0.9" />
          {[0, 1, 2, 3, 4].map(i => <rect key={i} x={70 + i * 26} y="35" width="20" height="14" rx="1" fill={i % 2 === 0 ? '#1e3a28' : '#1e2a3a'} />)}
        </svg>
      </div>
      {/* title reveal */}
      {titleIn && (
        <div className="relative z-10 text-center" style={{ animation: 'fadeinup .7s ease forwards', marginBottom: '8%' }}>
          <div style={{ fontSize: 11, letterSpacing: '.35em', color: '#F0B429aa', fontFamily: 'monospace', marginBottom: 10, animation: 'glowpulse 2s ease-in-out infinite' }}>
            E-LOCK OPS
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '.08em', color: 'white', textShadow: '0 0 40px rgba(255,122,0,.5)', lineHeight: 1.1, fontFamily: 'monospace' }}>
            CONTAINER<br />DELIVERY SYSTEM
          </div>
          <div style={{ marginTop: 12, fontSize: 9, letterSpacing: '.3em', color: 'rgba(255,255,255,.3)', fontFamily: 'monospace' }}>
            OPERATIONS COMMAND CENTER v2
          </div>
        </div>
      )}
      <div className="absolute" style={{ top: '18%', left: '50%', transform: 'translateX(-50%)', width: 2, height: '30%', background: 'linear-gradient(180deg,transparent,#F0B42944,transparent)', animation: 'cdsscan 3s ease-in-out infinite' }} />
    </div>
  );
}
