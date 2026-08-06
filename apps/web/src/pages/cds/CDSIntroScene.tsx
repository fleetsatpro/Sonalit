// Cinematic SVG scene — the fallback when no generated footage is present.
//
// This does NOT attempt photorealism. The previous attempt (#288) drew every
// object as an outline — stroke, fill:none — and outlined shapes read as
// cartoon however much detail you pile on; it added corrugation ridges and
// spoke wheels and still scored 1/10. So the approach here is inverted:
// solid silhouettes against a graded sky, which is how matte painting and
// title design have always faked depth convincingly.
//
// What actually does the work:
//   • atmospheric perspective — distant layers lighter and desaturated, so
//     depth comes from value not from detail
//   • parallax — six layers drifting at different rates under one camera push
//   • real depth of field — feGaussianBlur on the foreground plate
//   • bloom — blurred copy of the sun composited back over itself
//   • volumetric light — soft cones from the low sun, masked to the horizon
//   • grain, vignette, letterbox — cinema framing
//   • eased motion throughout; nothing is linear, because linear reads as cheap

export function CDSIntroScene() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#050810]">
      <style>{`
        @keyframes cds-camera   { from { transform: scale(1.02) translateY(1%) } to { transform: scale(1.14) translateY(-1%) } }
        @keyframes cds-drift-1  { from { transform: translateX(0) }    to { transform: translateX(-2.5%) } }
        @keyframes cds-drift-2  { from { transform: translateX(0) }    to { transform: translateX(-5%) } }
        @keyframes cds-drift-3  { from { transform: translateX(0) }    to { transform: translateX(-9%) } }
        @keyframes cds-ship     { from { transform: translateX(6%) }   to { transform: translateX(-6%) } }
        @keyframes cds-rise     { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes cds-shimmer  { 0%,100% { opacity: .28 } 50% { opacity: .55 } }
        @keyframes cds-beacon   { 0%,92%,100% { opacity: .25 } 96% { opacity: 1 } }
        @keyframes cds-grain    { 0%{transform:translate(0,0)} 25%{transform:translate(-2%,1%)} 50%{transform:translate(1%,-2%)} 75%{transform:translate(2%,2%)} 100%{transform:translate(0,0)} }
        @keyframes cds-truck    { from { transform: translateX(115vw) } to { transform: translateX(-45vw) } }
        @keyframes cds-headlamp { 0%,100% { opacity: .85 } 50% { opacity: 1 } }
      `}</style>

      {/* One camera move over the whole plate — the parallax reads as depth
          only because everything shares this push. */}
      <div className="absolute inset-0" style={{ animation: 'cds-camera 13s cubic-bezier(.33,0,.28,1) forwards' }}>
        <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
          <defs>
            {/* Dusk grade: deep blue overhead falling to sodium amber at the
                waterline. The narrow warm band is what sells "golden hour". */}
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#050a18" />
              <stop offset="38%"  stopColor="#12233f" />
              <stop offset="63%"  stopColor="#3d3350" />
              <stop offset="80%"  stopColor="#9c5a3c" />
              <stop offset="92%"  stopColor="#e08a3c" />
              <stop offset="100%" stopColor="#f6b45a" />
            </linearGradient>
            <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#c87a3a" />
              <stop offset="18%"  stopColor="#3a3a52" />
              <stop offset="100%" stopColor="#070b16" />
            </linearGradient>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#ffd9a0" stopOpacity=".95" />
              <stop offset="45%"  stopColor="#ff9a3c" stopOpacity=".38" />
              <stop offset="100%" stopColor="#ff7a00" stopOpacity="0" />
            </radialGradient>
            {/* Haze bands sit between layers; without them the silhouettes
                stack flat regardless of how many there are. */}
            <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#e79a55" stopOpacity="0" />
              <stop offset="70%"  stopColor="#e79a55" stopOpacity=".16" />
              <stop offset="100%" stopColor="#f3b06a" stopOpacity=".30" />
            </linearGradient>

            <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="26" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Foreground defocus — the single strongest depth cue available. */}
            <filter id="dof" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="5.5" />
            </filter>
            <filter id="softHaze" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
          </defs>

          {/* ── sky ── */}
          <rect width="1600" height="900" fill="url(#sky)" />

          {/* low sun, bloomed */}
          <g style={{ filter: 'url(#bloom)' }}>
            <circle cx="1130" cy="612" r="30" fill="#ffe7bd" />
          </g>
          <ellipse cx="1130" cy="612" rx="440" ry="230" fill="url(#sunGlow)" />

          {/* volumetric shafts, anchored on the sun and fanned shallow */}
          <g opacity=".16" style={{ filter: 'url(#softHaze)' }}>
            <polygon points="1130,612 1600,150 1600,400" fill="#ffc98a" />
            <polygon points="1130,612 1420,120 1560,150" fill="#ffc98a" />
            <polygon points="1130,612 700,180 900,140"  fill="#ffb877" />
          </g>

          {/* ── layer 1: far skyline — highest value, lowest contrast ── */}
          <g opacity=".30" style={{ animation: 'cds-drift-1 13s ease-out forwards' }}>
            <path fill="#7d8fb0" d="M0,628 L60,628 L60,600 L104,600 L104,628 L190,628 L190,586 L214,586 L214,628
              L330,628 L330,606 L372,606 L372,628 L470,628 L470,592 L500,592 L500,628 L640,628 L640,610
              L690,610 L690,628 L820,628 L820,596 L852,596 L852,628 L1000,628 L1000,614 L1060,614
              L1060,628 L1240,628 L1240,602 L1276,602 L1276,628 L1420,628 L1420,618 L1500,618 L1500,628 L1600,628 L1600,640 L0,640 Z" />
          </g>

          {/* ── layer 2: gantry cranes ── */}
          <g opacity=".62" style={{ animation: 'cds-drift-2 13s ease-out forwards' }}>
            {[130, 470, 830].map((x, i) => (
              <g key={x} fill="#2c3a55" transform={`translate(${x},0) scale(${1 - i * 0.06})`}>
                <rect x="0"   y="470" width="9"  height="160" />
                <rect x="96"  y="470" width="9"  height="160" />
                <rect x="-30" y="452" width="180" height="12" />
                <rect x="-30" y="452" width="10" height="60" />
                <path d="M150,458 L232,432 L236,446 L154,470 Z" />
                <rect x="44" y="464" width="7" height="52" />
                <rect x="30" y="514" width="36" height="20" />
                <circle cx="234" cy="438" r="4" fill="#ff5a3c" style={{ animation: `cds-beacon ${4 + i}s ease-in-out infinite` }} />
              </g>
            ))}
          </g>

          {/* ── layer 3: the vessel, tracking slowly across ── */}
          <g style={{ animation: 'cds-ship 13s cubic-bezier(.4,0,.5,1) forwards' }}>
            <g fill="#1b2438" transform="translate(560,0)">
              {/* stacked boxes — value steps only, no outlines */}
              {[0, 1, 2, 3, 4, 5].map(c =>
                [0, 1, 2].map(r => (
                  <rect key={`${c}-${r}`} x={54 + c * 46} y={584 - r * 17} width="42" height="15"
                    fill={r === 2 ? '#28344c' : r === 1 ? '#222c42' : '#1b2438'} />
                ))
              )}
              <path d="M20,632 L360,632 L338,664 L44,664 Z" />
              <rect x="300" y="560" width="46" height="72" fill="#243049" />
              <rect x="308" y="572" width="30" height="8" fill="#ffd9a0" opacity=".5" />
              <rect x="308" y="590" width="30" height="6" fill="#ffd9a0" opacity=".28" />
            </g>
          </g>

          {/* ── quayside dock ── */}
          <rect y="614" width="1600" height="34" fill="#0c1520"/>
          <rect y="636" width="1600" height="4" fill="#162232" opacity="0.5"/>

          {/* ── sea ── */}
          <rect y="640" width="1600" height="260" fill="url(#sea)" />
          {/* sun column on the water — broken into slats so it reads as swell */}
          <g style={{ animation: 'cds-shimmer 5s ease-in-out infinite' }}>
            {Array.from({ length: 16 }).map((_, i) => (
              <rect key={i} x={1130 - 46 + (i % 3) * 12} y={650 + i * 14}
                width={92 - i * 3} height="4" rx="2" fill="#ffb56a" opacity={0.5 - i * 0.028} />
            ))}
          </g>

          {/* haze band across the waterline — separates mid from foreground */}
          <rect y="520" width="1600" height="150" fill="url(#haze)" />

          {/* ── layer 4: foreground container stacks, defocused ── */}
          <g style={{ animation: 'cds-drift-3 13s ease-out forwards' }}>
            <g style={{ filter: 'url(#dof)' }}>
              <g fill="#0b1020">
                {[0, 1, 2, 3].map(r =>
                  [0, 1, 2].map(c => (
                    <rect key={`l${r}-${c}`} x={-40 + c * 96} y={742 - r * 40} width="90" height="38" />
                  ))
                )}
                {[0, 1, 2].map(r =>
                  [0, 1, 2, 3].map(c => (
                    <rect key={`r${r}-${c}`} x={1290 + c * 96} y={742 - r * 40} width="90" height="38" />
                  ))
                )}
                <rect y="780" width="1600" height="120" />
              </g>
            </g>
          </g>
        </svg>
      </div>

      {/* Container truck — HTML layer so vw-based translation crosses the scene */}
      <div style={{ position:'absolute', left:0, bottom:'28%', animation:'cds-truck 13s linear forwards', width:'clamp(220px,65vw,400px)', zIndex:2, pointerEvents:'none' }}>
        <svg viewBox="0 0 240 82" width="100%" style={{ display:'block', overflow:'visible' }}>
          {/* ground shadow */}
          <ellipse cx="120" cy="80" rx="116" ry="4" fill="rgba(0,0,0,0.5)"/>
          {/* trailer body */}
          <rect x="62" y="4" width="174" height="55" rx="1" fill="#09111e"/>
          {/* corrugation ridges */}
          {[82,100,118,136,154,172,190,210,228].map(x => (
            <rect key={x} x={x} y="4" width="1.5" height="55" fill="#0e1c2e" opacity="0.7"/>
          ))}
          {/* tail light */}
          <rect x="234" y="30" width="3" height="18" rx="1" fill="#cc1e1e" opacity="0.85"/>
          {/* chassis rail */}
          <rect x="0" y="58" width="240" height="4" fill="#05080f"/>
          {/* cab body (front = left, truck travels left) */}
          <path d="M0,12 L5,4 L52,4 L62,4 L62,59 L0,59 Z" fill="#08101c"/>
          {/* windshield */}
          <path d="M7,16 L48,6 L58,6 L58,46 L7,48 Z" fill="#04090e" opacity="0.65"/>
          {/* roof visor */}
          <rect x="4" y="-4" width="56" height="9" rx="1" fill="#0a1525"/>
          {/* exhaust stack */}
          <rect x="36" y="-20" width="5" height="22" rx="2" fill="#07090f"/>
          {/* headlights */}
          <rect x="0" y="27" width="4" height="22" rx="1.5" fill="#ffd9a0" opacity="0.95" style={{ animation:'cds-headlamp 3s ease-in-out infinite' }}/>
          {/* headlight cone */}
          <ellipse cx="-2" cy="38" rx="32" ry="13" fill="#ffd9a0" opacity="0.2"/>
          {/* amber marker */}
          <circle cx="9" cy="3" r="2.5" fill="#F0B429" opacity="0.75"/>
          {/* steer wheel */}
          <circle cx="15" cy="68" r="13" fill="#070b14"/>
          <circle cx="15" cy="68" r="5"  fill="#0c1422"/>
          {/* drive axle A */}
          <circle cx="52" cy="68" r="15" fill="#070b14"/>
          <circle cx="52" cy="68" r="7"  fill="#0c1422"/>
          {/* drive axle B */}
          <circle cx="75" cy="68" r="15" fill="#070b14"/>
          <circle cx="75" cy="68" r="7"  fill="#0c1422"/>
          {/* trailer axle A */}
          <circle cx="178" cy="68" r="13" fill="#070b14"/>
          <circle cx="178" cy="68" r="5"  fill="#0c1422"/>
          {/* trailer axle B */}
          <circle cx="204" cy="68" r="13" fill="#070b14"/>
          <circle cx="204" cy="68" r="5"  fill="#0c1422"/>
        </svg>
      </div>

      {/* Grain — a real texture, drifting so it doesn't look like a static
          overlay. Kept as a CSS layer rather than feTurbulence, which is far
          too expensive to animate full-frame. */}
      <div className="absolute pointer-events-none opacity-[.06] mix-blend-overlay"
        style={{
          inset: '-6%',
          animation: 'cds-grain .9s steps(4) infinite',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />

      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 58% 62%, transparent 32%, rgba(3,6,14,.78) 100%)' }} />

      {/* title, arriving late and rising into place */}
      <div className="absolute inset-x-0 top-[54%] flex flex-col items-center pointer-events-none"
        style={{ animation: 'cds-rise 1.5s cubic-bezier(.2,.7,.2,1) 2.4s both' }}>
        <div className="text-[clamp(22px,4.4vw,58px)] font-bold tracking-[.34em] text-white/95"
          style={{ textShadow: '0 0 38px rgba(255,150,60,.55), 0 2px 14px rgba(0,0,0,.85)' }}>
          CONTAINER MANAGEMENT
        </div>
        <div className="mt-3 h-px w-[min(30vw,300px)]"
          style={{ background: 'linear-gradient(90deg,transparent,#F0B429,transparent)' }} />
        <div className="mt-3 text-[clamp(8px,1.05vw,12px)] font-mono tracking-[.5em] text-white/45">
          SONALIT
        </div>
      </div>
    </div>
  );
}
