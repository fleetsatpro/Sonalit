/**
 * Original operations visuals for the public site.
 *
 * Inline SVG rather than photography, for four reasons that all bit the first
 * draft: stock URLs rot (the design's hero image already 404s), third-party
 * hosts are blocked by our CSP and would need it widened, photos of branded
 * vehicles imply customers we do not have, and bright stock imagery fights the
 * dark holoframe palette. Being inline they also cost no extra request and are
 * present in the prerendered HTML, so the page paints complete.
 *
 * Every visual is decorative: the surrounding figure carries the label, and
 * each <svg> is aria-hidden so a screen reader is not read a diagram.
 */

const CYAN = '#00dcff';
const VIOLET = '#9d6bff';
const GREEN = '#34d399';

/** Shared dotted map graticule. */
function Graticule({ id }: { id: string }): React.ReactElement {
  return (
    <>
      <defs>
        <pattern id={`${id}-grid`} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0v32" fill="none" stroke="rgba(0,220,255,0.07)" strokeWidth="1" />
        </pattern>
        <radialGradient id={`${id}-vignette`} cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="rgba(0,220,255,0.10)" />
          <stop offset="100%" stopColor="rgba(1,3,9,0)" />
        </radialGradient>
      </defs>
      <rect width="640" height="440" fill="#060d1c" />
      <rect width="640" height="440" fill={`url(#${id}-grid)`} />
      <rect width="640" height="440" fill={`url(#${id}-vignette)`} />
    </>
  );
}

/** Hero panel — a live corridor with vehicles, geofence and telemetry ticker. */
export function OpsMapVisual(): React.ReactElement {
  return (
    <svg viewBox="0 0 640 300" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="ops-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0v32" fill="none" stroke="rgba(0,220,255,0.07)" strokeWidth="1" />
        </pattern>
        <linearGradient id="ops-route" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.15" />
          <stop offset="55%" stopColor={CYAN} stopOpacity="1" />
          <stop offset="100%" stopColor={VIOLET} stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id="ops-glow" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgba(0,220,255,0.13)" />
          <stop offset="100%" stopColor="rgba(1,3,9,0)" />
        </radialGradient>
      </defs>

      <rect width="640" height="300" fill="#060d1c" />
      <rect width="640" height="300" fill="url(#ops-grid)" />
      <rect width="640" height="300" fill="url(#ops-glow)" />

      {/* Coastline / terrain hint */}
      <path
        d="M-10 232 C 90 214, 150 246, 232 226 S 372 178, 456 198 S 588 178, 660 156"
        fill="none" stroke="rgba(0,220,255,0.13)" strokeWidth="1.5"
      />
      <path
        d="M-10 268 C 110 252, 186 276, 268 258 S 402 214, 486 232 S 600 214, 660 196"
        fill="none" stroke="rgba(0,220,255,0.07)" strokeWidth="1.5"
      />

      {/* Planned corridor envelope */}
      <path
        d="M42 214 C 138 190, 196 118, 292 108 S 452 132, 528 74"
        fill="none" stroke="rgba(0,220,255,0.16)" strokeWidth="22" strokeLinecap="round"
      />
      {/* Actual route */}
      <path
        d="M42 214 C 138 190, 196 118, 292 108 S 452 132, 528 74"
        fill="none" stroke="url(#ops-route)" strokeWidth="2.5" strokeLinecap="round"
      />

      {/* Geofence */}
      <circle cx="292" cy="108" r="46" fill="rgba(157,107,255,0.06)" stroke="rgba(157,107,255,0.45)" strokeWidth="1" strokeDasharray="5 5" />

      {/* Origin + destination */}
      <circle cx="42" cy="214" r="4.5" fill={CYAN} />
      <circle cx="42" cy="214" r="10" fill="none" stroke={CYAN} strokeOpacity="0.35" strokeWidth="1" />
      <rect x="518" y="64" width="20" height="20" rx="4" fill="rgba(157,107,255,0.18)" stroke={VIOLET} strokeWidth="1.2" />

      {/* Tracked units along the corridor */}
      {[
        { x: 152, y: 168 },
        { x: 292, y: 108 },
        { x: 430, y: 122 },
      ].map((p) => (
        <g key={`${p.x}-${p.y}`}>
          <circle cx={p.x} cy={p.y} r="12" fill="rgba(0,220,255,0.10)" />
          <circle cx={p.x} cy={p.y} r="4" fill={CYAN} />
        </g>
      ))}

      {/* Telemetry strip */}
      <g opacity="0.85">
        <rect x="28" y="252" width="180" height="26" rx="6" fill="rgba(1,3,9,0.72)" stroke="rgba(0,220,255,0.16)" />
        <circle cx="44" cy="265" r="3.5" fill={GREEN} />
        <rect x="58" y="260" width="52" height="4" rx="2" fill="rgba(241,245,255,0.55)" />
        <rect x="58" y="268" width="96" height="3" rx="1.5" fill="rgba(154,168,192,0.4)" />
      </g>
      <g opacity="0.7">
        <rect x="220" y="252" width="150" height="26" rx="6" fill="rgba(1,3,9,0.72)" stroke="rgba(0,220,255,0.16)" />
        <circle cx="236" cy="265" r="3.5" fill={CYAN} />
        <rect x="250" y="260" width="44" height="4" rx="2" fill="rgba(241,245,255,0.45)" />
        <rect x="250" y="268" width="74" height="3" rx="1.5" fill="rgba(154,168,192,0.32)" />
      </g>
    </svg>
  );
}

/** Fleet — GPS trail with per-vehicle state and a utilisation ribbon. */
export function FleetVisual(): React.ReactElement {
  return (
    <svg viewBox="0 0 640 440" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <Graticule id="fleet" />

      {/* Journey trails */}
      <path d="M60 372 C 150 340, 178 258, 268 244 S 410 268, 500 196"
        fill="none" stroke="rgba(0,220,255,0.75)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M48 268 C 138 252, 200 300, 288 292 S 434 218, 556 232"
        fill="none" stroke="rgba(0,220,255,0.28)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" />
      <path d="M92 140 C 186 122, 246 172, 340 152 S 470 104, 568 118"
        fill="none" stroke="rgba(157,107,255,0.45)" strokeWidth="2" strokeLinecap="round" />

      {/* Vehicle markers */}
      {[
        { x: 268, y: 244, c: CYAN },
        { x: 500, y: 196, c: CYAN },
        { x: 288, y: 292, c: '#9aa8c0' },
        { x: 340, y: 152, c: VIOLET },
        { x: 92, y: 140, c: VIOLET },
      ].map((p) => (
        <g key={`${p.x}-${p.y}`}>
          <circle cx={p.x} cy={p.y} r="13" fill={p.c} fillOpacity="0.10" />
          <circle cx={p.x} cy={p.y} r="4.5" fill={p.c} />
        </g>
      ))}

      {/* Depot */}
      <rect x="48" y="356" width="24" height="24" rx="5" fill="rgba(0,220,255,0.14)" stroke={CYAN} strokeWidth="1.2" />

      {/* Utilisation ribbon */}
      <g transform="translate(40, 44)">
        <rect width="248" height="62" rx="10" fill="rgba(1,3,9,0.7)" stroke="rgba(0,220,255,0.16)" />
        {[18, 34, 26, 44, 30, 50, 38, 56, 42, 34, 48, 28].map((h, i) => (
          <rect
            key={h * 100 + i}
            x={16 + i * 18}
            y={48 - h}
            width="8"
            height={h}
            rx="2"
            fill={i % 4 === 3 ? VIOLET : CYAN}
            fillOpacity={i % 4 === 3 ? 0.75 : 0.55}
          />
        ))}
      </g>
    </svg>
  );
}

/** Convoy — escorted formation inside a monitored corridor. */
export function ConvoyVisual(): React.ReactElement {
  return (
    <svg viewBox="0 0 640 440" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <Graticule id="convoy" />

      {/* Corridor envelope */}
      <path d="M-20 330 C 120 316, 220 232, 356 216 S 560 168, 680 96"
        fill="none" stroke="rgba(0,220,255,0.13)" strokeWidth="46" strokeLinecap="round" />
      <path d="M-20 330 C 120 316, 220 232, 356 216 S 560 168, 680 96"
        fill="none" stroke="rgba(0,220,255,0.30)" strokeWidth="1.2" strokeDasharray="8 8" />

      {/* Centre line */}
      <path d="M-20 330 C 120 316, 220 232, 356 216 S 560 168, 680 96"
        fill="none" stroke={CYAN} strokeWidth="2" strokeOpacity="0.55" />

      {/* Convoy formation: escort, two trucks, escort */}
      {[
        { x: 128, y: 314, w: 22, escort: true },
        { x: 214, y: 282, w: 34, escort: false },
        { x: 302, y: 234, w: 34, escort: false },
        { x: 386, y: 212, w: 22, escort: true },
      ].map((v) => (
        <g key={v.x}>
          <rect
            x={v.x - v.w / 2} y={v.y - 9} width={v.w} height="18" rx="4"
            fill={v.escort ? 'rgba(157,107,255,0.22)' : 'rgba(0,220,255,0.22)'}
            stroke={v.escort ? VIOLET : CYAN} strokeWidth="1.3"
          />
        </g>
      ))}

      {/* Checkpoints */}
      {[
        { x: 96, y: 326 },
        { x: 356, y: 216 },
        { x: 556, y: 132 },
      ].map((c) => (
        <g key={c.x}>
          <circle cx={c.x} cy={c.y} r="16" fill="none" stroke="rgba(0,220,255,0.35)" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx={c.x} cy={c.y} r="3.5" fill={CYAN} />
        </g>
      ))}

      {/* Field report card */}
      <g transform="translate(392, 300)">
        <rect width="212" height="96" rx="10" fill="rgba(1,3,9,0.78)" stroke="rgba(0,220,255,0.18)" />
        <circle cx="22" cy="24" r="6" fill={GREEN} />
        <rect x="38" y="19" width="86" height="5" rx="2.5" fill="rgba(241,245,255,0.6)" />
        <rect x="38" y="30" width="140" height="4" rx="2" fill="rgba(154,168,192,0.35)" />
        <rect x="16" y="48" width="180" height="4" rx="2" fill="rgba(154,168,192,0.28)" />
        <rect x="16" y="60" width="150" height="4" rx="2" fill="rgba(154,168,192,0.22)" />
        <rect x="16" y="74" width="58" height="12" rx="4" fill="rgba(0,220,255,0.16)" stroke="rgba(0,220,255,0.35)" strokeWidth="0.8" />
        <rect x="82" y="74" width="58" height="12" rx="4" fill="rgba(157,107,255,0.16)" stroke="rgba(157,107,255,0.35)" strokeWidth="0.8" />
      </g>
    </svg>
  );
}

/** Container delivery — yard stacks, gantry and a custody chain. */
export function ContainerVisual(): React.ReactElement {
  const stacks = [0, 1, 2, 3, 4, 5, 6, 7];
  const heights = [3, 4, 2, 4, 3, 5, 3, 2];
  return (
    <svg viewBox="0 0 640 440" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <Graticule id="cds" />

      {/* Gantry rail */}
      <path d="M40 118 H600" stroke="rgba(0,220,255,0.28)" strokeWidth="2" />
      <g>
        <rect x="252" y="96" width="128" height="14" rx="3" fill="rgba(0,220,255,0.16)" stroke={CYAN} strokeWidth="1.2" />
        <path d="M268 110 V150 M364 110 V150" stroke={CYAN} strokeWidth="1.6" strokeOpacity="0.7" />
        <rect x="298" y="150" width="36" height="20" rx="3" fill="rgba(157,107,255,0.25)" stroke={VIOLET} strokeWidth="1.2" />
      </g>

      {/* Yard stacks */}
      {stacks.map((s) => {
        const x = 52 + s * 70;
        return (
          <g key={s}>
            {Array.from({ length: heights[s] ?? 3 }, (_, row) => {
              const y = 372 - row * 26;
              const accent = s === 4 && row === 0;
              return (
                <rect
                  key={y}
                  x={x} y={y} width="56" height="22" rx="3"
                  fill={accent ? 'rgba(0,220,255,0.24)' : 'rgba(0,220,255,0.09)'}
                  stroke={accent ? CYAN : 'rgba(0,220,255,0.26)'}
                  strokeWidth="1"
                />
              );
            })}
          </g>
        );
      })}

      {/* Ground line */}
      <path d="M32 396 H608" stroke="rgba(0,220,255,0.22)" strokeWidth="1.5" />

      {/* Custody chain */}
      <g transform="translate(48, 196)">
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${i * 132}, 0)`}>
            <circle cx="14" cy="14" r="13" fill="rgba(1,3,9,0.85)" stroke={i === 3 ? VIOLET : CYAN} strokeWidth="1.4" />
            <circle cx="14" cy="14" r="4" fill={i === 3 ? VIOLET : CYAN} />
            {i < 3 ? (
              <path d="M30 14 H118" stroke="rgba(0,220,255,0.35)" strokeWidth="1.2" strokeDasharray="5 5" />
            ) : null}
          </g>
        ))}
      </g>

      {/* E-lock chip */}
      <g transform="translate(432, 236)">
        <rect width="150" height="52" rx="10" fill="rgba(1,3,9,0.78)" stroke="rgba(0,220,255,0.2)" />
        <rect x="16" y="16" width="16" height="20" rx="3" fill="none" stroke={CYAN} strokeWidth="1.5" />
        <path d="M20 16 v-5 a4 4 0 0 1 8 0 v5" fill="none" stroke={CYAN} strokeWidth="1.5" />
        <rect x="44" y="19" width="70" height="5" rx="2.5" fill="rgba(241,245,255,0.55)" />
        <rect x="44" y="30" width="92" height="4" rx="2" fill="rgba(154,168,192,0.32)" />
      </g>
    </svg>
  );
}

/** Security operations — geofences, an escalating alert and the response queue. */
export function SecurityVisual(): React.ReactElement {
  return (
    <svg viewBox="0 0 640 440" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <Graticule id="sec" />

      {/* Geofence polygons */}
      <path d="M78 306 L182 262 L246 314 L196 384 L96 372 Z"
        fill="rgba(0,220,255,0.06)" stroke="rgba(0,220,255,0.4)" strokeWidth="1.2" strokeDasharray="6 5" />
      <path d="M330 118 L452 96 L508 168 L432 216 L342 190 Z"
        fill="rgba(157,107,255,0.06)" stroke="rgba(157,107,255,0.45)" strokeWidth="1.2" strokeDasharray="6 5" />

      {/* Alert epicentre */}
      <g>
        <circle cx="424" cy="158" r="58" fill="none" stroke="rgba(255,92,92,0.18)" strokeWidth="1.2" />
        <circle cx="424" cy="158" r="38" fill="none" stroke="rgba(255,92,92,0.32)" strokeWidth="1.2" />
        <circle cx="424" cy="158" r="20" fill="rgba(255,92,92,0.16)" stroke="#ff5c5c" strokeWidth="1.4" />
        <circle cx="424" cy="158" r="5" fill="#ff5c5c" />
      </g>

      {/* Units converging */}
      <path d="M196 330 C 268 300, 330 232, 404 176" fill="none" stroke="rgba(0,220,255,0.5)" strokeWidth="1.8" strokeDasharray="7 6" />
      <path d="M560 300 C 508 262, 470 214, 442 180" fill="none" stroke="rgba(0,220,255,0.5)" strokeWidth="1.8" strokeDasharray="7 6" />
      <circle cx="196" cy="330" r="4.5" fill={CYAN} />
      <circle cx="560" cy="300" r="4.5" fill={CYAN} />

      {/* Alert queue */}
      <g transform="translate(40, 44)">
        <rect width="228" height="120" rx="10" fill="rgba(1,3,9,0.78)" stroke="rgba(0,220,255,0.18)" />
        {[
          { y: 18, c: '#ff5c5c', w: 118 },
          { y: 50, c: '#fbbf24', w: 92 },
          { y: 82, c: GREEN, w: 136 },
        ].map((row) => (
          <g key={row.y}>
            <rect x="14" y={row.y} width="3" height="20" rx="1.5" fill={row.c} />
            <rect x="28" y={row.y + 3} width={row.w} height="5" rx="2.5" fill="rgba(241,245,255,0.55)" />
            <rect x="28" y={row.y + 13} width={row.w - 34} height="4" rx="2" fill="rgba(154,168,192,0.3)" />
          </g>
        ))}
      </g>
    </svg>
  );
}
