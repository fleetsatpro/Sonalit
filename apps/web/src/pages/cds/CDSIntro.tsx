import { useEffect, useState } from 'react';

const SCENES = [
  { id: 'highway', dur: 2800 },
  { id: 'yard',    dur: 2600 },
  { id: 'port',    dur: 2600 },
  { id: 'vessel',  dur: 3200 },
];
const TOTAL = SCENES.reduce((s, x) => s + x.dur, 0);

export function CDSIntro({ onDone }: { onDone: () => void }) {
  const [scene, setScene] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const advance = (idx: number) => {
      if (idx >= SCENES.length) { onDone(); return; }
      t = setTimeout(() => {
        setFading(true);
        setTimeout(() => { setFading(false); setScene(idx + 1); advance(idx + 1); }, 450);
      }, SCENES[idx]!.dur - 450);
    };
    advance(0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[999] overflow-hidden bg-[#02040a]" style={{ fontFamily: 'monospace' }}>
      <style>{`
        @keyframes truckleft { from { transform:translateX(110vw) } to { transform:translateX(-340px) } }
        @keyframes twinkle   { 0%,100%{opacity:.15} 50%{opacity:.9} }
        @keyframes cranearm  { 0%,100%{transform:rotate(-6deg)} 50%{transform:rotate(3deg)} }
        @keyframes wave1     { 0%{transform:translateX(0)}  100%{transform:translateX(-50%)} }
        @keyframes wave2     { 0%{transform:translateX(-50%)} 100%{transform:translateX(0)} }
        @keyframes glow      { 0%,100%{opacity:.7;text-shadow:0 0 20px #ff7a00,0 0 50px #ff7a00aa} 50%{opacity:1;text-shadow:0 0 36px #F0B429,0 0 90px #ff7a00} }
        @keyframes scan      { 0%{top:-4px;opacity:0} 8%{opacity:.6} 92%{opacity:.6} 100%{top:100%;opacity:0} }
        @keyframes fadeinup  { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shipfloat { 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-6px)} }
        @keyframes exhaust   { 0%{opacity:.7;transform:translateY(0) scale(1)} 100%{opacity:0;transform:translateY(-20px) scale(2.5)} }
        @keyframes hlight    { 0%,100%{opacity:.85} 50%{opacity:1} }
      `}</style>

      <div className="absolute inset-0" style={{ opacity: fading ? 0 : 1, transition: 'opacity .45s ease' }}>
        {scene === 0 && <SceneHighway />}
        {scene === 1 && <SceneYard />}
        {scene === 2 && <ScenePort />}
        {scene >= 3 && <SceneVessel onDone={onDone} />}
      </div>

      {/* Letterbox bars */}
      <div className="absolute top-0 left-0 right-0 h-[52px] bg-[#02040a] z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-[48px] bg-[#02040a] z-10" />

      {/* progress dots */}
      <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 flex gap-2 z-20">
        {SCENES.map((_, i) => (
          <div key={i} className="rounded-full transition-all duration-500"
            style={{ width: i === scene ? 20 : 6, height: 6, background: i <= scene ? '#F0B429' : 'rgba(255,255,255,.18)' }} />
        ))}
      </div>

      <button onClick={onDone}
        className="absolute top-[14px] right-4 px-3 py-1.5 rounded-lg text-[11px] font-mono text-white/40 hover:text-white/80 border border-white/10 hover:border-white/25 transition-colors bg-black/20 z-20"
        style={{ letterSpacing: '.1em' }}>
        SKIP
      </button>
      <div className="absolute bottom-[14px] right-4 text-[9px] font-mono text-white/15 z-20" style={{ letterSpacing: '.12em' }}>
        {((TOTAL / 1000) | 0)}s INTRO
      </div>
    </div>
  );
}

/* ── Shared: Stars ─────────────────────────────────────────── */
function Stars({ count = 70 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => ({
        x: (i * 41 + 7) % 100, y: (i * 67 + 13) % 75,
        s: i % 7 === 0 ? 1.8 : i % 3 === 0 ? 1.2 : 0.7,
        d: (i % 4) * 0.5,
      })).map((p, i) => (
        <div key={i} className="absolute rounded-full bg-white"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, opacity: .6,
            animation: `twinkle ${2.2 + p.d}s ease-in-out infinite`, animationDelay: `${p.d}s` }} />
      ))}
    </>
  );
}

/* ── Shared: Detailed Container Truck ──────────────────────── */
function ContainerTruck({ style }: { style?: React.CSSProperties }) {
  const spokes = [0, 51, 103, 154, 206, 257, 309];
  const wheels = [
    { cx: 28, sz: 11 }, { cx: 47, sz: 11 },
    { cx: 112, sz: 11 }, { cx: 131, sz: 11 },
    { cx: 178, sz: 12 }, { cx: 198, sz: 12 },
    { cx: 232, sz: 12 },
  ];
  return (
    <svg viewBox="0 0 258 78" width="258" height="78" style={style}>
      {/* ground shadow */}
      <ellipse cx="129" cy="77" rx="124" ry="4" fill="rgba(0,0,0,.5)" />

      {/* 40' container */}
      <rect x="4" y="10" width="154" height="42" rx="2" fill="#14253d" stroke="#1e3555" strokeWidth="1" />
      {/* container top cap */}
      <rect x="4" y="10" width="154" height="6" rx="2" fill="#1a3050" />
      {/* corrugation (vertical ridges) */}
      {[20, 36, 52, 68, 84, 100, 116, 132, 146].map(x => (
        <rect key={x} x={x} y="10" width="2.5" height="42" fill="#1c2f48" rx="0.5" />
      ))}
      {/* mid-rail */}
      <rect x="4" y="29" width="154" height="2" fill="#1a2f4a" />
      {/* right door end */}
      <rect x="150" y="13" width="7" height="36" rx="0.5" fill="#101e30" stroke="#1a2d45" strokeWidth="0.6" />
      <line x1="154" y1="13" x2="154" y2="49" stroke="#1a2d45" strokeWidth="0.5" />
      {/* E-LOCK OPS badge */}
      <rect x="38" y="21" width="80" height="18" rx="2" fill="#0a1828" opacity="0.75" />
      <text x="78" y="31" textAnchor="middle" fontFamily="monospace" fontSize="8" fontWeight="bold" fill="#F0B429" letterSpacing="1.2">E-LOCK OPS</text>
      <text x="78" y="37" textAnchor="middle" fontFamily="monospace" fontSize="5.5" fill="#33d6a8" letterSpacing="0.8" opacity="0.8">CONTAINER DELIVERY</text>

      {/* chassis frame */}
      <rect x="4" y="52" width="158" height="3.5" fill="#090f18" rx="0.5" />

      {/* fifth-wheel coupler */}
      <rect x="155" y="50" width="10" height="6" rx="1.5" fill="#1a2535" />

      {/* ── Cab ── */}
      {/* cab body */}
      <path d="M168 20 L168 55 L254 55 L254 36 L238 20 Z" fill="#121e2e" stroke="#1a2e44" strokeWidth="1" />
      {/* cab roof fairing */}
      <path d="M168 20 L238 20 L238 16 L174 16 Z" fill="#1a2a3e" stroke="#1e3248" strokeWidth="0.6" />
      {/* exhaust stacks */}
      <rect x="180" y="5" width="4.5" height="14" rx="2" fill="#090f18" />
      <rect x="187" y="6" width="4" height="13" rx="2" fill="#090f18" />
      <circle cx="182" cy="4.5" r="2.5" fill="rgba(200,200,200,.12)" style={{ animation: 'exhaust 1s ease-out infinite' }} />
      <circle cx="189" cy="5.5" r="2" fill="rgba(200,200,200,.1)" style={{ animation: 'exhaust 1.2s ease-out infinite .3s' }} />
      {/* windshield */}
      <path d="M238 21 L252 36 L252 52 L210 52 L210 21 Z" fill="#0c2238" stroke="#1a3a58" strokeWidth="0.7" />
      {/* windshield glare */}
      <path d="M240 22 L250 34 L242 22 Z" fill="rgba(255,255,255,.07)" />
      {/* A-pillar divider */}
      <line x1="210" y1="21" x2="210" y2="55" stroke="#1a2e44" strokeWidth="0.7" />
      {/* door window */}
      <rect x="172" y="23" width="35" height="18" rx="1.5" fill="#0c1e30" stroke="#1a3045" strokeWidth="0.5" />
      {/* door handle */}
      <rect x="172" y="40" width="7" height="2" rx="1" fill="#2a3e58" />
      {/* cab steps */}
      <rect x="249" y="46" width="6" height="2.5" rx="0.5" fill="#1a2535" />
      <rect x="249" y="49" width="6" height="2" rx="0.5" fill="#141e2e" />
      {/* side mirror */}
      <rect x="251" y="23" width="4.5" height="7" rx="0.8" fill="#0e1a28" stroke="#1a2535" strokeWidth="0.5" />
      <line x1="251" y1="30" x2="255.5" y2="25" stroke="#1a2535" strokeWidth="0.4" />
      {/* headlights */}
      <rect x="250" y="30" width="5" height="12" rx="2" fill="#F0B429" opacity="0.98" style={{ animation: 'hlight 2.5s ease-in-out infinite' }} />
      <rect x="251" y="31" width="2.5" height="5" fill="white" opacity="0.25" />
      {/* headlight beam glow */}
      <ellipse cx="254" cy="36" rx="18" ry="8" fill="#F0B429" opacity="0.12" style={{ transform: 'translateX(10px)' }} />
      {/* marker lights */}
      <circle cx="253" cy="27" r="2" fill="#ff5c5c" opacity="0.95" />
      <circle cx="253" cy="20" r="1.5" fill="#F0B429" opacity="0.8" />
      {/* grill */}
      <rect x="250" y="42" width="5" height="12" rx="0.5" fill="#060c14" />
      {[43, 45.5, 48, 50.5, 53].map(y => (
        <line key={y} x1="250.5" y1={y} x2="254.5" y2={y} stroke="#1a2535" strokeWidth="0.4" />
      ))}
      {/* front bumper */}
      <rect x="249" y="53" width="7" height="3.5" rx="0.8" fill="#0d1520" />
      <rect x="250" y="55" width="4" height="1" fill="#1a2535" opacity="0.5" />

      {/* ── Wheels ── */}
      {wheels.map(({ cx, sz }, i) => (
        <g key={i}>
          <circle cx={cx} cy={67} r={sz} fill="#050810" stroke="#182030" strokeWidth="1.5" />
          <circle cx={cx} cy={67} r={sz - 3.5} fill="#0c1420" />
          <circle cx={cx} cy={67} r={2} fill="#1e2e45" />
          {spokes.map(deg => (
            <line key={deg}
              x1={cx + 2 * Math.cos(deg * Math.PI / 180)} y1={67 + 2 * Math.sin(deg * Math.PI / 180)}
              x2={cx + (sz - 4.5) * Math.cos(deg * Math.PI / 180)} y2={67 + (sz - 4.5) * Math.sin(deg * Math.PI / 180)}
              stroke="#182030" strokeWidth="0.7" />
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ── Scene 1: Night Highway ────────────────────────────────── */
function SceneHighway() {
  return (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#020510 0%,#05091a 45%,#0a0f1e 75%,#12161e 100%)' }}>
      <Stars />
      {/* Moon */}
      <div className="absolute" style={{ top: '12%', right: '18%', width: 36, height: 36, borderRadius: '50%', background: '#e8d88a', boxShadow: '0 0 30px #e8d88a88, 0 0 80px #e8d88a33' }} />
      {/* Moon glow */}
      <div className="absolute" style={{ top: '7%', right: '13%', width: 110, height: 110, borderRadius: '50%', background: 'radial-gradient(ellipse,rgba(232,216,138,.07) 0%,transparent 70%)' }} />

      {/* Mountains (3 layers) */}
      <svg className="absolute bottom-0 left-0 w-full" style={{ bottom: '30%' }} viewBox="0 0 400 100" preserveAspectRatio="none">
        <polygon points="0,100 40,30 80,70 130,20 180,60 240,10 300,55 360,25 400,50 400,100" fill="#0a0f1c" />
      </svg>
      <svg className="absolute bottom-0 left-0 w-full" style={{ bottom: '30%' }} viewBox="0 0 400 80" preserveAspectRatio="none">
        <polygon points="0,80 50,40 100,60 160,15 220,50 280,20 340,45 400,30 400,80" fill="#0d1222" />
      </svg>
      <svg className="absolute bottom-0 left-0 w-full" style={{ bottom: '30%' }} viewBox="0 0 400 65" preserveAspectRatio="none">
        <polygon points="0,65 60,30 120,50 180,10 240,40 300,18 360,38 400,22 400,65" fill="#10162a" />
      </svg>

      {/* Road */}
      <div className="absolute left-0 right-0" style={{ bottom: 0, height: '30%', background: 'linear-gradient(180deg,#141820,#0c0e14)' }}>
        {/* shoulder lines */}
        <div className="absolute left-0 right-0" style={{ top: 0, height: 2, background: '#F0B42944' }} />
        {/* center dashes */}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="absolute" style={{ left: `${i * 18 + 2}%`, top: '38%', width: '10%', height: 4, borderRadius: 2, background: '#F0B42966' }} />
        ))}
        {/* road sheen */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg,transparent,rgba(240,180,41,.04),transparent)' }} />
      </div>

      {/* Truck — large, from right to left */}
      <div className="absolute" style={{ bottom: '28%', animation: 'truckleft 2.8s linear forwards' }}>
        {/* headlight cone on road */}
        <div className="absolute" style={{ right: -10, bottom: -4, width: 220, height: 28, background: 'linear-gradient(90deg,transparent,rgba(240,180,41,.15))', transform: 'skewX(-15deg)', borderRadius: 8 }} />
        <ContainerTruck />
      </div>

      {/* road ambient glow */}
      <div className="absolute left-0 right-0" style={{ bottom: '28%', height: 6, background: 'linear-gradient(90deg,transparent,rgba(240,180,41,.06),transparent)' }} />
    </div>
  );
}

/* ── Scene 2: Container Yard (dawn) ────────────────────────── */
function SceneYard() {
  const colors = ['#1e3a28', '#1e2a3a', '#2a1e1e', '#1e2a1e', '#2a2a1e', '#1e1e2a'];
  return (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#0a0818 0%,#1a0e28 30%,#281420 55%,#3a1e0e 75%,#201812 100%)' }}>
      {/* stars fading */}
      <Stars count={30} />
      {/* dawn glow */}
      <div className="absolute" style={{ bottom: '35%', left: '50%', transform: 'translateX(-50%)', width: '70%', height: 120, background: 'radial-gradient(ellipse,rgba(255,100,20,.18) 0%,transparent 70%)' }} />

      {/* Container stacks — left side */}
      <div className="absolute" style={{ left: '2%', bottom: '30%', display: 'flex', gap: 3, alignItems: 'flex-end' }}>
        {[4, 5, 3, 6, 4, 5, 3, 4].map((h, col) => (
          <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Array.from({ length: h }, (_, row) => (
              <div key={row} style={{ width: 28, height: 16, borderRadius: 1, background: colors[(col + row) % colors.length], border: '0.5px solid rgba(255,255,255,.06)' }}>
                <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: '1px 1px 0 0' }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Container stacks — right side */}
      <div className="absolute" style={{ right: '2%', bottom: '30%', display: 'flex', gap: 3, alignItems: 'flex-end' }}>
        {[5, 3, 6, 4, 5, 3, 4, 5].map((h, col) => (
          <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Array.from({ length: h }, (_, row) => (
              <div key={row} style={{ width: 28, height: 16, borderRadius: 1, background: colors[(col + row + 2) % colors.length], border: '0.5px solid rgba(255,255,255,.06)' }}>
                <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: '1px 1px 0 0' }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Ground */}
      <div className="absolute left-0 right-0" style={{ bottom: 0, height: '30%', background: '#0e1218' }}>
        <div className="absolute left-0 right-0" style={{ top: 0, height: 2, background: '#F0B42933' }} />
        {/* yard lane markings */}
        {[10, 40, 70].map(l => (
          <div key={l} className="absolute" style={{ left: `${l}%`, top: '30%', width: 2, height: '50%', background: '#F0B42922' }} />
        ))}
      </div>

      {/* Truck arriving from right */}
      <div className="absolute" style={{ bottom: '29%', animation: 'truckleft 2.6s linear forwards' }}>
        <ContainerTruck />
      </div>

      <div className="absolute left-0 right-0 text-center" style={{ bottom: '33%', fontSize: 9, letterSpacing: '.22em', color: '#F0B42988', fontFamily: 'monospace' }}>
        MOMBASA CONTAINER TERMINAL
      </div>
    </div>
  );
}

/* ── Scene 3: Port — Ship & Cranes ─────────────────────────── */
function ScenePort() {
  return (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#060810 0%,#0e1428 50%,#080c14 100%)' }}>
      {/* ambient port light */}
      <div className="absolute" style={{ top: '15%', left: '50%', transform: 'translateX(-50%)', width: '60%', height: 160, background: 'radial-gradient(ellipse,rgba(255,120,20,.09) 0%,transparent 70%)' }} />

      {/* Ship hull */}
      <div className="absolute left-0 right-0" style={{ bottom: 0, height: '45%', background: 'linear-gradient(180deg,#0e1a2a,#08101e)' }}>
        <div style={{ height: 6, background: '#F0B42922', borderTop: '1px solid #F0B42944' }} />
        {/* Portholes */}
        {[8, 20, 32, 44, 56, 68, 80, 92].map(l => (
          <div key={l} className="absolute" style={{ left: `${l}%`, top: 16, width: 8, height: 5, borderRadius: 3, background: '#1a3a55', border: '1px solid #1e4a6a' }} />
        ))}
        {/* Hull stripe */}
        <div className="absolute left-0 right-0" style={{ top: 24, height: 2, background: 'rgba(255,255,255,.06)' }} />
      </div>

      {/* Container stacks on ship */}
      <div className="absolute left-0 right-0 flex justify-center gap-1.5" style={{ bottom: '44%' }}>
        {['#1e3a28', '#1e2a3a', '#2a1e1e', '#1e2a1e', '#2a2a1e', '#1e3a28', '#2a1e2a', '#1e2a3a'].map((c, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[0, 1, 2, 3].map(row => (
              <div key={row} style={{ width: 34, height: 16, borderRadius: 1, background: c, border: '0.5px solid rgba(255,255,255,.06)' }}>
                <div style={{ height: 3, background: 'rgba(255,255,255,.07)', borderRadius: '1px 1px 0 0' }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Gantry cranes */}
      {[
        { left: '12%', delay: '0s' },
        { left: '45%', delay: '.4s' },
        { left: '75%', delay: '.8s' },
      ].map((c, i) => (
        <div key={i} className="absolute" style={{ left: c.left, bottom: '44%', transformOrigin: 'bottom center', animation: `cranearm 3s ease-in-out infinite ${c.delay}` }}>
          <svg viewBox="0 0 50 180" width="50" height="180">
            {/* Main mast */}
            <rect x="22" y="0" width="6" height="180" fill="#121e30" />
            {/* Crossbeam */}
            <rect x="0" y="10" width="50" height="5" fill="#162438" />
            {/* Trolley arm */}
            <rect x="4" y="15" width="3" height="60" fill="#0e1828" />
            {/* Spreader */}
            <rect x="0" y="72" width="16" height="3" fill="#162438" />
            {/* Cables */}
            <line x1="8" y1="15" x2="8" y2="72" stroke="#1a2840" strokeWidth="0.8" />
          </svg>
        </div>
      ))}

      {/* Port lights on crane tops */}
      {[14, 47, 77].map((l, i) => (
        <div key={i} className="absolute" style={{ left: `${l}%`, top: '8%', width: 6, height: 6, borderRadius: '50%', background: '#ff5c5c', boxShadow: '0 0 12px #ff5c5c', animation: `hlight ${1.5 + i * 0.3}s ease-in-out infinite` }} />
      ))}

      <div className="absolute left-0 right-0 text-center" style={{ top: '6%', fontSize: 9, letterSpacing: '.22em', color: 'rgba(255,180,30,.4)', fontFamily: 'monospace' }}>
        PORT OPERATIONS — LOADING IN PROGRESS
      </div>
    </div>
  );
}

/* ── Scene 4: Container Ship + Title ───────────────────────── */
function SceneVessel({ onDone }: { onDone: () => void }) {
  const [titleIn, setTitleIn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTitleIn(true), 700); return () => clearTimeout(t); }, []);
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);

  const containerColors = ['#1e3a28', '#1e2a3a', '#2a1e1e', '#1e2a1e', '#2a2a1e', '#1e3a28'];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(180deg,#04060e 0%,#08101e 40%,#0e1828 65%,#080e18 100%)' }}>
      {/* Horizon glow */}
      <div className="absolute" style={{ top: '48%', left: 0, right: 0, height: 80, background: 'radial-gradient(ellipse 80% 60% at 50% 50%,rgba(255,100,20,.15) 0%,transparent 70%)' }} />

      {/* Ocean waves */}
      <div className="absolute" style={{ bottom: '18%', left: 0, right: 0, height: 60, overflow: 'hidden' }}>
        <svg viewBox="0 0 800 60" style={{ width: '200%', height: '100%', animation: 'wave1 5s linear infinite' }}>
          <path d="M0,28 Q50,14 100,28 T200,28 T300,28 T400,28 T500,28 T600,28 T700,28 T800,28 V60 H0Z" fill="#0a1e35" />
          <path d="M0,34 Q50,20 100,34 T200,34 T300,34 T400,34 T500,34 T600,34 T700,34 T800,34 V60 H0Z" fill="#081828" opacity="0.8" />
        </svg>
      </div>
      <div className="absolute" style={{ bottom: '15%', left: 0, right: 0, height: 40, overflow: 'hidden' }}>
        <svg viewBox="0 0 800 40" style={{ width: '200%', height: '100%', animation: 'wave2 7s linear infinite' }}>
          <path d="M0,18 Q40,8 80,18 T160,18 T240,18 T320,18 T400,18 T480,18 T560,18 T640,18 T720,18 T800,18 V40 H0Z" fill="#060e1c" />
        </svg>
      </div>

      {/* Container ship — large, detailed */}
      <div className="absolute" style={{ bottom: '14%', left: '50%', transform: 'translateX(-50%)', animation: 'shipfloat 4s ease-in-out infinite' }}>
        <svg viewBox="0 0 340 100" width="340" height="100">
          {/* Hull */}
          <path d="M15 65 Q170 45 325 65 L315 80 Q170 95 25 80 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.8" />
          {/* waterline stripe */}
          <path d="M15 65 Q170 45 325 65" fill="none" stroke="#F0B42955" strokeWidth="1.5" />
          {/* portholes */}
          {[40, 80, 120, 160, 200, 240, 280].map(x => (
            <ellipse key={x} cx={x} cy={72} rx="5" ry="3.5" fill="#1a3a55" stroke="#1e4a6a" strokeWidth="0.5" />
          ))}

          {/* Bridge/superstructure (right side) */}
          <rect x="262" y="22" width="55" height="44" rx="2" fill="#0d1a28" stroke="#1a2a3e" strokeWidth="0.8" />
          <rect x="264" y="24" width="51" height="16" rx="1" fill="#0a1e2e" />
          {[265, 276, 287, 298, 309].map(x => (
            <rect key={x} x={x} y="25" width="9" height="12" rx="0.5" fill="#0e2840" stroke="#1a3a55" strokeWidth="0.4" />
          ))}
          {/* Antennas */}
          <line x1="282" y1="22" x2="282" y2="10" stroke="#1a2535" strokeWidth="1.5" />
          <line x1="305" y1="22" x2="305" y2="8" stroke="#1a2535" strokeWidth="1.2" />
          <circle cx="282" cy="9" r="2.5" fill="#ff5c5c" opacity="0.9" />
          {/* Radar */}
          <ellipse cx="305" cy="8" rx="6" ry="2" fill="#1a2535" stroke="#2a3548" strokeWidth="0.5" style={{ animation: 'cranearm 2s ease-in-out infinite' }} />

          {/* Container stacks (6 bays x 4 high) */}
          {[18, 60, 105, 150, 195, 240].map((bx, bi) => (
            <g key={bi}>
              {[0, 1, 2, 3].map(row => (
                <rect key={row} x={bx} y={22 + (3 - row) * 15} width={36} height={13} rx="1"
                  fill={containerColors[(bi + row) % containerColors.length]}
                  stroke="rgba(0,0,0,.2)" strokeWidth="0.5" />
              ))}
              {/* container edge highlights */}
              <rect x={bx} y={22} width={36} height={2} rx="0.5" fill="rgba(255,255,255,.06)" />
            </g>
          ))}
        </svg>
      </div>

      {/* Title */}
      {titleIn && (
        <div className="relative z-10 text-center" style={{ animation: 'fadeinup .8s ease forwards', marginBottom: '16%' }}>
          <div style={{ fontSize: 11, letterSpacing: '.38em', color: '#F0B429cc', fontFamily: 'monospace', marginBottom: 12, animation: 'glow 2.5s ease-in-out infinite' }}>
            E-LOCK OPS
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '.06em', color: 'white', textShadow: '0 0 50px rgba(255,122,0,.45)', lineHeight: 1.15, fontFamily: 'monospace' }}>
            CONTAINER<br />DELIVERY SYSTEM
          </div>
          <div style={{ marginTop: 14, fontSize: 9, letterSpacing: '.28em', color: 'rgba(255,255,255,.28)', fontFamily: 'monospace' }}>
            OPERATIONS COMMAND CENTER
          </div>
        </div>
      )}

      {/* Scan line */}
      <div className="absolute left-0 right-0" style={{ width: '100%', height: 3, background: 'linear-gradient(90deg,transparent,rgba(240,180,41,.3),transparent)', animation: 'scan 3s ease-in-out infinite' }} />
    </div>
  );
}
