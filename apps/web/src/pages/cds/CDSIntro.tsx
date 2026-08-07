```tsx
import { useEffect, useState } from "react";

const SHOT_DURATION = 5000;
const DISSOLVE_DURATION = 1000;

type Shot = "highway" | "yard" | "port" | "vessel";

const SHOTS: Shot[] = ["highway", "yard", "port", "vessel"];

interface CDSIntroProps {
  onDone?: () => void;
}

export default function CDSIntro({ onDone }: CDSIntroProps) {
  const [shot, setShot] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (shot < SHOTS.length - 1) {
        setVisible(false);

        setTimeout(() => {
          setShot((current) => current + 1);
          setVisible(true);
        }, DISSOLVE_DURATION);
      } else {
        onDone?.();
      }
    }, SHOT_DURATION);

    return () => clearTimeout(timer);
  }, [shot, onDone]);

  const currentShot = SHOTS[shot];

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-black">

      {/* =====================================================
          CINEMATIC SCENE
      ====================================================== */}

      <div
        className="absolute inset-0 transition-opacity ease-in-out"
        style={{
          opacity: visible ? 1 : 0,
          transitionDuration: `${DISSOLVE_DURATION}ms`,
        }}
      >
        {currentShot === "highway" && <HighwayScene />}
        {currentShot === "yard" && <IndustrialYardScene />}
        {currentShot === "port" && <PortScene />}
        {currentShot === "vessel" && <VesselScene />}
      </div>

      {/* =====================================================
          CINEMATIC GRADING
      ====================================================== */}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            linear-gradient(
              180deg,
              rgba(0,0,0,.48) 0%,
              transparent 30%,
              transparent 65%,
              rgba(0,0,0,.55) 100%
            )
          `,
        }}
      />

      {/* Vignette */}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.72) 100%)",
        }}
      />

      {/* Film grain */}

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          mixBlendMode: "screen",
        }}
      />

      {/* =====================================================
          CINEMA BARS
      ====================================================== */}

      <div className="pointer-events-none absolute left-0 right-0 top-0 h-[8vh] bg-black" />

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[8vh] bg-black" />

      {/* =====================================================
          CDS BRANDING
      ====================================================== */}

      <div className="absolute left-8 top-[10vh] z-20">

        <div className="text-[11px] font-semibold tracking-[0.45em] text-white/70">
          CDS
        </div>

        <div className="mt-2 h-px w-16 bg-white/30" />

        <div className="mt-3 text-[9px] uppercase tracking-[0.35em] text-white/40">
          Security • Logistics • Intelligence
        </div>

      </div>

      {/* =====================================================
          SHOT INDICATORS
      ====================================================== */}

      <div className="absolute bottom-9 left-1/2 z-30 flex -translate-x-1/2 gap-2">

        {SHOTS.map((_, index) => (
          <div
            key={index}
            className="h-[3px] rounded-full transition-all duration-700"
            style={{
              width: index === shot ? 28 : 6,
              background:
                index <= shot
                  ? "rgba(255,255,255,.9)"
                  : "rgba(255,255,255,.25)",
            }}
          />
        ))}

      </div>

      {/* =====================================================
          SKIP
      ====================================================== */}

      <button
        onClick={() => onDone?.()}
        className="
          absolute
          bottom-7
          right-7
          z-30
          rounded-full
          border
          border-white/20
          bg-black/40
          px-4
          py-2
          text-[11px]
          font-medium
          tracking-wider
          text-white/70
          backdrop-blur-md
          transition
          hover:border-white/40
          hover:bg-black/70
          hover:text-white
        "
      >
        SKIP
      </button>

    </div>
  );
}


/* ============================================================
   HIGHWAY
============================================================ */

function HighwayScene() {
  return (
    <SceneShell>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient id="highwaySky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#07131f" />
            <stop offset="55%" stopColor="#17354a" />
            <stop offset="100%" stopColor="#b46f42" />
          </linearGradient>

          <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#26333a" />
            <stop offset="100%" stopColor="#080d10" />
          </linearGradient>

          <radialGradient id="sun">
            <stop offset="0%" stopColor="#ffdca2" stopOpacity=".95" />
            <stop offset="100%" stopColor="#ff9d55" stopOpacity="0" />
          </radialGradient>

        </defs>

        {/* Sky */}

        <rect width="1920" height="1080" fill="url(#highwaySky)" />

        {/* Sunrise */}

        <circle
          cx="1460"
          cy="520"
          r="280"
          fill="url(#sun)"
        />

        {/* Distant mountains */}

        <path
          d="M0 620 L260 450 L430 600 L650 420 L850 600 L1100 430 L1320 610 L1550 460 L1780 600 L1920 500 L1920 760 L0 760Z"
          fill="#111e25"
        />

        {/* Road */}

        <path
          d="M0 1080 L620 680 L1320 680 L1920 1080Z"
          fill="url(#road)"
        />

        {/* Road shoulder */}

        <path
          d="M600 720 L0 1080"
          stroke="#d7c6a0"
          strokeWidth="9"
          opacity=".65"
        />

        <path
          d="M1320 720 L1920 1080"
          stroke="#d7c6a0"
          strokeWidth="9"
          opacity=".65"
        />

        {/* Lane markings */}

        <g
          stroke="#e8e1c9"
          strokeWidth="12"
          strokeLinecap="round"
          opacity=".8"
        >

          <path d="M870 790 L790 850" />

          <path d="M850 900 L690 1010" />

          <path d="M1050 790 L1130 850" />

          <path d="M1070 900 L1230 1010" />

        </g>

        {/* Truck convoy */}

        <g className="animate-truck">

          <Truck x={790} y={675} scale={1.1} />

          <Truck x={1030} y={715} scale={0.85} />

          <Truck x={1250} y={740} scale={0.7} />

        </g>

        {/* Atmospheric haze */}

        <rect
          width="1920"
          height="1080"
          fill="#f3c18a"
          opacity=".06"
        />

      </svg>

      <SceneTitle
        label="01 / MOVEMENT"
        title="GLOBAL ROAD NETWORK"
      />

    </SceneShell>
  );
}


/* ============================================================
   TRUCK
============================================================ */

function Truck({
  x,
  y,
  scale,
}: {
  x: number;
  y: number;
  scale: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>

      <rect
        x="0"
        y="0"
        width="180"
        height="70"
        rx="5"
        fill="#b7c1c6"
      />

      <rect
        x="180"
        y="12"
        width="55"
        height="58"
        rx="5"
        fill="#6e7c84"
      />

      <rect
        x="190"
        y="20"
        width="30"
        height="23"
        fill="#18272e"
      />

      <rect
        x="12"
        y="10"
        width="150"
        height="50"
        fill="#8d9ba1"
      />

      <circle cx="45" cy="76" r="18" fill="#111" />

      <circle cx="195" cy="76" r="18" fill="#111" />

      <circle cx="45" cy="76" r="7" fill="#69747a" />

      <circle cx="195" cy="76" r="7" fill="#69747a" />

    </g>
  );
}


/* ============================================================
   INDUSTRIAL YARD
============================================================ */

function IndustrialYardScene() {
  return (
    <SceneShell>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient id="yardSky" x1="0" y1="0" x2="0" y2="1">

            <stop offset="0%" stopColor="#07131b" />

            <stop offset="60%" stopColor="#274354" />

            <stop offset="100%" stopColor="#b4784d" />

          </linearGradient>

          <linearGradient id="warehouse" x1="0" y1="0" x2="1" y2="1">

            <stop offset="0%" stopColor="#45545c" />

            <stop offset="100%" stopColor="#11191e" />

          </linearGradient>

        </defs>

        <rect width="1920" height="1080" fill="url(#yardSky)" />

        {/* warehouse */}

        <path
          d="M0 420 L650 260 L1420 390 L1920 300 L1920 800 L0 800Z"
          fill="url(#warehouse)"
        />

        {/* warehouse panels */}

        <g
          stroke="#89969b"
          strokeWidth="3"
          opacity=".25"
        >

          {Array.from({ length: 12 }).map((_, i) => (
            <line
              key={i}
              x1={i * 180}
              y1="300"
              x2={i * 180}
              y2="800"
            />
          ))}

        </g>

        {/* security fence */}

        <g stroke="#b6c1c5" strokeWidth="4" opacity=".55">

          {Array.from({ length: 16 }).map((_, i) => (
            <line
              key={i}
              x1={i * 130}
              y1="600"
              x2={i * 130}
              y2="860"
            />
          ))}

          <line x1="0" y1="620" x2="1920" y2="620" />

          <line x1="0" y1="735" x2="1920" y2="735" />

        </g>

        {/* containers */}

        <Container x={260} y={610} color="#425c67" />

        <Container x={480} y={560} color="#65756e" />

        <Container x={710} y={640} color="#4e5965" />

        <Container x={1430} y={600} color="#556b70" />

        {/* CCTV */}

        <g transform="translate(1170 450)">

          <rect width="8" height="190" fill="#151d21" />

          <rect x="-22" y="25" width="55" height="30" rx="5" fill="#222c31" />

          <circle cx="33" cy="40" r="7" fill="#d8e5e8" />

        </g>

        {/* yard road */}

        <path
          d="M0 860 L1920 720 L1920 1080 L0 1080Z"
          fill="#0b1115"
        />

        <g stroke="#c5b995" strokeWidth="8" opacity=".6">

          <line x1="200" y1="950" x2="500" y2="920" />

          <line x1="750" y1="890" x2="1050" y2="860" />

          <line x1="1300" y1="820" x2="1600" y2="790" />

        </g>

      </svg>

      <SceneTitle
        label="02 / CONTROL"
        title="SECURED INDUSTRIAL OPERATIONS"
      />

    </SceneShell>
  );
}


/* ============================================================
   CONTAINER
============================================================ */

function Container({
  x,
  y,
  color,
}: {
  x: number;
  y: number;
  color: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>

      <rect
        width="250"
        height="110"
        fill={color}
        stroke="#9ba9ad"
        strokeWidth="3"
      />

      {Array.from({ length: 10 }).map((_, i) => (
        <line
          key={i}
          x1={25 * i}
          y1="0"
          x2={25 * i}
          y2="110"
          stroke="#d1d8d8"
          opacity=".16"
        />
      ))}

    </g>
  );
}


/* ============================================================
   PORT
============================================================ */

function PortScene() {
  return (
    <SceneShell>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient id="portSky" x1="0" y1="0" x2="0" y2="1">

            <stop offset="0%" stopColor="#06141f" />

            <stop offset="60%" stopColor="#285066" />

            <stop offset="100%" stopColor="#c48757" />

          </linearGradient>

          <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">

            <stop offset="0%" stopColor="#1b5267" />

            <stop offset="100%" stopColor="#07151d" />

          </linearGradient>

        </defs>

        <rect width="1920" height="1080" fill="url(#portSky)" />

        {/* sun */}

        <circle
          cx="1450"
          cy="330"
          r="250"
          fill="#e4a36b"
          opacity=".12"
        />

        {/* cranes */}

        <g
          stroke="#aab6ba"
          strokeWidth="12"
          fill="none"
          opacity=".8"
        >

          <path d="M300 720 L300 250 L760 250 L760 720" />

          <path d="M300 300 L760 300" />

          <path d="M760 300 L760 650" />

          <path d="M1050 720 L1050 210 L1530 210 L1530 720" />

          <path d="M1050 260 L1530 260" />

          <path d="M1530 260 L1530 650" />

        </g>

        {/* container stacks */}

        <g>

          {Array.from({ length: 7 }).map((_, row) =>

            Array.from({ length: 9 }).map((_, col) => (

              <rect
                key={`${row}-${col}`}
                x={80 + col * 125}
                y={600 - row * 48}
                width="112"
                height="42"
                fill={
                  row % 3 === 0
                    ? "#526b72"
                    : row % 3 === 1
                    ? "#7a6255"
                    : "#42545c"
                }
                stroke="#17272d"
                strokeWidth="2"
              />

            ))
          )}

        </g>

        {/* water */}

        <path
          d="M0 780 C400 750 700 800 1000 770 C1350 740 1600 790 1920 750 L1920 1080 L0 1080Z"
          fill="url(#water)"
        />

        {/* water reflections */}

        <g
          stroke="#7ba1aa"
          strokeWidth="4"
          opacity=".25"
        >

          {Array.from({ length: 18 }).map((_, i) => (
            <line
              key={i}
              x1={100 + i * 90}
              y1={830 + (i % 5) * 35}
              x2={400 + i * 90}
              y2={830 + (i % 5) * 35}
            />
          ))}

        </g>

      </svg>

      <SceneTitle
        label="03 / CONNECTIVITY"
        title="GLOBAL PORT OPERATIONS"
      />

    </SceneShell>
  );
}


/* ============================================================
   VESSEL
============================================================ */

function VesselScene() {
  return (
    <SceneShell>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient id="seaSky" x1="0" y1="0" x2="0" y2="1">

            <stop offset="0%" stopColor="#030c15" />

            <stop offset="55%" stopColor="#1b4256" />

            <stop offset="100%" stopColor="#9a674c" />

          </linearGradient>

          <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1">

            <stop offset="0%" stopColor="#194d63" />

            <stop offset="100%" stopColor="#030c12" />

          </linearGradient>

        </defs>

        <rect width="1920" height="1080" fill="url(#seaSky)" />

        {/* horizon */}

        <line
          x1="0"
          y1="610"
          x2="1920"
          y2="610"
          stroke="#d39b6b"
          opacity=".18"
          strokeWidth="3"
        />

        {/* ocean */}

        <path
          d="M0 610 Q450 570 900 620 T1920 600 L1920 1080 L0 1080Z"
          fill="url(#ocean)"
        />

        {/* distant port */}

        <g
          stroke="#8da0a4"
          strokeWidth="5"
          opacity=".35"
        >

          <line x1="100" y1="580" x2="100" y2="450" />

          <line x1="100" y1="450" x2="300" y2="450" />

          <line x1="300" y1="450" x2="300" y2="580" />

          <line x1="400" y1="580" x2="400" y2="430" />

          <line x1="400" y1="430" x2="650" y2="430" />

          <line x1="650" y1="430" x2="650" y2="580" />

        </g>

        {/* ship */}

        <g className="ship">

          {/* hull */}

          <path
            d="M520 690 L1570 690 L1460 830 L720 830 L600 780Z"
            fill="#16242b"
            stroke="#8c9ba0"
            strokeWidth="4"
          />

          {/* upper deck */}

          <rect
            x="690"
            y="610"
            width="720"
            height="80"
            fill="#384b54"
          />

          {/* bridge */}

          <rect
            x="1350"
            y="475"
            width="180"
            height="135"
            fill="#53656b"
          />

          <rect
            x="1390"
            y="430"
            width="100"
            height="50"
            fill="#65777c"
          />

          {/* containers */}

          {Array.from({ length: 6 }).map((_, row) =>

            Array.from({ length: 10 }).map((_, col) => (

              <rect
                key={`${row}-${col}`}
                x={720 + col * 70}
                y={530 - row * 32}
                width="64"
                height="27"
                fill={
                  row % 3 === 0
                    ? "#687a80"
                    : row % 3 === 1
                    ? "#785e51"
                    : "#455e67"
                }
                stroke="#17262c"
                strokeWidth="2"
              />

            ))
          )}

        </g>

        {/* wake */}

        <path
          d="M700 830 C500 870 300 900 50 940"
          fill="none"
          stroke="#b3d3d5"
          strokeWidth="18"
          opacity=".18"
        />

        <path
          d="M720 850 C500 920 300 970 100 1010"
          fill="none"
          stroke="#d7e4e3"
          strokeWidth="8"
          opacity=".15"
        />

        {/* ocean highlights */}

        <g
          stroke="#9cc4c9"
          strokeWidth="3"
          opacity=".2"
        >

          {Array.from({ length: 24 }).map((_, i) => (
            <line
              key={i}
              x1={i * 90}
              y1={900 + (i % 4) * 30}
              x2={i * 90 + 180}
              y2={900 + (i % 4) * 30}
            />
          ))}

        </g>

      </svg>

      <SceneTitle
        label="04 / GLOBAL REACH"
        title="SECURITY IN MOTION"
      />

    </SceneShell>
  );
}


/* ============================================================
   SCENE SHELL
============================================================ */

function SceneShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden">

      {/* Slow cinematic camera movement */}

      <div
        className="absolute inset-0"
        style={{
          animation: "cdsCamera 7s ease-out forwards",
        }}
      >
        {children}
      </div>

      {/* Atmospheric light */}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,180,110,.08), transparent 45%, rgba(60,130,160,.08))",
        }}
      />

    </div>
  );
}


/* ============================================================
   SCENE TITLE
============================================================ */

function SceneTitle({
  label,
  title,
}: {
  label: string;
  title: string;
}) {
  return (
    <div
      className="
        pointer-events-none
        absolute
        bottom-[15vh]
        left-8
        md:left-14
        text-white
      "
    >

      <div
        className="
          mb-3
          text-[10px]
          font-semibold
          tracking-[0.45em]
          text-white/50
        "
      >
        {label}
      </div>

      <div
        className="
          text-xl
          font-light
          tracking-[0.18em]
          text-white/90
          md:text-3xl
        "
      >
        {title}
      </div>

      <div className="mt-4 h-px w-20 bg-white/30" />

    </div>
  );
}


/* ============================================================
   GLOBAL ANIMATION
============================================================ */

const style = document.createElement("style");

style.innerHTML = `
@keyframes cdsCamera {

  0% {
    transform: scale(1.04) translate3d(0, 0, 0);
  }

  100% {
    transform: scale(1.13) translate3d(-1%, -1%, 0);
  }

}

@keyframes shipMove {

  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(-18px);
  }

}

@keyframes truckMove {

  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(30px);
  }

}

.ship {
  animation: shipMove 6s ease-in-out infinite alternate;
}

.animate-truck {
  animation: truckMove 5s ease-in-out infinite alternate;
}

* {
  box-sizing: border-box;
}

`;

if (typeof document !== "undefined") {
  document.head.appendChild(style);
}
```
