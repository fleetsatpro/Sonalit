import React, { useEffect, useRef, useState } from "react";

const SHOTS = [
  "highway",
  "yard",
  "port",
  "vessel",
] as const;

const DISSOLVE_MS = 900;
const SHOT_MS = 5000;

type Shot = (typeof SHOTS)[number];

interface CDSIntroProps {
  onDone: () => void;
}

export function CDSIntro({ onDone }: CDSIntroProps) {
  const [shot, setShot] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const done = useRef(false);
  const timer = useRef<number | null>(null);

  const finish = () => {
    if (done.current) return;

    done.current = true;

    if (timer.current) {
      window.clearTimeout(timer.current);
    }

    onDone();
  };

  /*
   * Respect reduced-motion settings.
   */
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      finish();
    }
  }, []);

  /*
   * Advance through the four cinematic scenes.
   */
  useEffect(() => {
    if (done.current) return;

    timer.current = window.setTimeout(() => {
      if (shot >= SHOTS.length - 1) {
        finish();
        return;
      }

      setTransitioning(true);

      window.setTimeout(() => {
        setShot((current) => current + 1);
        setTransitioning(false);
      }, DISSOLVE_MS);
    }, SHOT_MS);

    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
    };
  }, [shot]);

  // shot starts at 0 and only advances while shot < SHOTS.length - 1, so the
  // index is always in bounds; noUncheckedIndexedAccess can't see that, and
  // the fallback is unreachable rather than a real default.
  const currentShot: Shot = SHOTS[shot] ?? SHOTS[0];

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-black">

      {/* =====================================================
          CURRENT CINEMATIC SCENE
      ====================================================== */}

      <div
        className="absolute inset-0 transition-opacity ease-in-out"
        style={{
          opacity: transitioning ? 0 : 1,
          transitionDuration: `${DISSOLVE_MS}ms`,
        }}
      >
        <CinematicScene shot={currentShot} />
      </div>

      {/* =====================================================
          COLOR GRADE
      ====================================================== */}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,.45) 0%, transparent 35%, transparent 65%, rgba(0,0,0,.6) 100%)",
        }}
      />

      {/* =====================================================
          CINEMATIC VIGNETTE
      ====================================================== */}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,.72) 100%)",
        }}
      />

      {/* =====================================================
          FILM GRAIN
      ====================================================== */}

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
          mixBlendMode: "screen",
        }}
      />

      {/* =====================================================
          CINEMATIC LETTERBOX
      ====================================================== */}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[7vh] bg-black" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[7vh] bg-black" />

      {/* =====================================================
          CDS IDENTIFIER
      ====================================================== */}

      <div className="absolute left-8 top-[10vh] z-30 md:left-12">

        <div className="text-[12px] font-semibold tracking-[0.55em] text-white/80">
          CDS
        </div>

        <div className="mt-2 h-px w-16 bg-white/40" />

        <div className="mt-3 text-[8px] uppercase tracking-[0.32em] text-white/50">
          Security • Logistics • Intelligence
        </div>

      </div>

      {/* =====================================================
          SCENE TITLE
      ====================================================== */}

      <div className="absolute bottom-[15vh] left-8 z-30 md:left-12">

        <div className="mb-3 text-[9px] font-semibold tracking-[0.45em] text-white/50">
          {String(shot + 1).padStart(2, "0")} / 04
        </div>

        <div className="text-xl font-light tracking-[0.15em] text-white/90 md:text-3xl">
          {getTitle(currentShot)}
        </div>

        <div className="mt-4 h-px w-20 bg-white/30" />

      </div>

      {/* =====================================================
          SHOT INDICATORS
      ====================================================== */}

      <div className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 gap-2">

        {SHOTS.map((_, index) => (
          <div
            key={index}
            className="h-[3px] rounded-full transition-all duration-700"
            style={{
              width: index === shot ? 26 : 6,
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
        type="button"
        onClick={finish}
        className="
          absolute
          bottom-7
          right-7
          z-40
          rounded-full
          border
          border-white/20
          bg-black/40
          px-4
          py-2
          text-[11px]
          font-medium
          tracking-[0.12em]
          text-white/70
          backdrop-blur-md
          transition-all
          duration-300
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
   SCENE SELECTOR
============================================================ */

function CinematicScene({ shot }: { shot: Shot }) {
  switch (shot) {
    case "highway":
      return <HighwayScene />;

    case "yard":
      return <YardScene />;

    case "port":
      return <PortScene />;

    case "vessel":
      return <VesselScene />;

    default:
      return null;
  }
}


/* ============================================================
   TITLES
============================================================ */

function getTitle(shot: Shot) {
  switch (shot) {
    case "highway":
      return "GLOBAL ROAD NETWORK";

    case "yard":
      return "SECURED INDUSTRIAL OPERATIONS";

    case "port":
      return "GLOBAL PORT OPERATIONS";

    case "vessel":
      return "SECURITY IN MOTION";
  }
}


/* ============================================================
   COMMON SCENE WRAPPER
============================================================ */

function Scene({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">

      <div
        className="absolute inset-0"
        style={{
          animation: "cdsCamera 6s ease-out forwards",
        }}
      >
        {children}
      </div>

    </div>
  );
}


/* ============================================================
   HIGHWAY
============================================================ */

function HighwayScene() {
  return (
    <Scene>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient
            id="highwaySky"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#06121c" />
            <stop offset="55%" stopColor="#183b50" />
            <stop offset="100%" stopColor="#b9764e" />
          </linearGradient>

          <linearGradient
            id="highwayRoad"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#35444a" />
            <stop offset="100%" stopColor="#080d10" />
          </linearGradient>

          <radialGradient id="sunGlow">

            <stop
              offset="0%"
              stopColor="#ffd99a"
              stopOpacity=".9"
            />

            <stop
              offset="100%"
              stopColor="#ff9d55"
              stopOpacity="0"
            />

          </radialGradient>

        </defs>

        {/* Sky */}

        <rect
          width="1920"
          height="1080"
          fill="url(#highwaySky)"
        />

        {/* Sunrise */}

        <circle
          cx="1480"
          cy="500"
          r="300"
          fill="url(#sunGlow)"
        />

        {/* Mountains */}

        <path
          d="
            M0 650
            L250 450
            L450 610
            L690 430
            L900 610
            L1120 420
            L1370 610
            L1590 460
            L1800 610
            L1920 500
            L1920 800
            L0 800
            Z
          "
          fill="#101c23"
        />

        {/* Road */}

        <path
          d="
            M0 1080
            L590 680
            L1330 680
            L1920 1080
            Z
          "
          fill="url(#highwayRoad)"
        />

        {/* Road lines */}

        <g
          stroke="#eee4c9"
          strokeWidth="11"
          strokeLinecap="round"
          opacity=".75"
        >

          <path d="M850 780 L770 840" />

          <path d="M820 890 L650 1010" />

          <path d="M1070 780 L1150 840" />

          <path d="M1100 890 L1270 1010" />

        </g>

        {/* Trucks */}

        <g className="truck-motion">

          <Truck
            x={760}
            y={665}
            scale={1.1}
          />

          <Truck
            x={1020}
            y={715}
            scale={0.85}
          />

          <Truck
            x={1250}
            y={745}
            scale={0.65}
          />

        </g>

      </svg>

    </Scene>
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
    <g
      transform={`translate(${x} ${y}) scale(${scale})`}
    >

      <rect
        width="185"
        height="72"
        rx="5"
        fill="#aebbc0"
      />

      <rect
        x="185"
        y="10"
        width="58"
        height="62"
        rx="5"
        fill="#64747c"
      />

      <rect
        x="198"
        y="20"
        width="31"
        height="23"
        fill="#17262d"
      />

      <rect
        x="12"
        y="10"
        width="155"
        height="50"
        fill="#87979d"
      />

      <circle
        cx="45"
        cy="76"
        r="19"
        fill="#080b0d"
      />

      <circle
        cx="205"
        cy="76"
        r="19"
        fill="#080b0d"
      />

      <circle
        cx="45"
        cy="76"
        r="7"
        fill="#667277"
      />

      <circle
        cx="205"
        cy="76"
        r="7"
        fill="#667277"
      />

    </g>
  );
}


/* ============================================================
   INDUSTRIAL YARD
============================================================ */

function YardScene() {
  return (
    <Scene>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient
            id="yardSky"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#07141d" />
            <stop offset="60%" stopColor="#2d4d5d" />
            <stop offset="100%" stopColor="#a76f4d" />
          </linearGradient>

        </defs>

        <rect
          width="1920"
          height="1080"
          fill="url(#yardSky)"
        />

        {/* Warehouse */}

        <path
          d="
            M0 450
            L600 280
            L1400 400
            L1920 300
            L1920 820
            L0 820
            Z
          "
          fill="#27343b"
        />

        {/* Warehouse panels */}

        <g
          stroke="#9ba7aa"
          strokeWidth="3"
          opacity=".2"
        >

          {Array.from({ length: 13 }).map(
            (_, i) => (
              <line
                key={i}
                x1={i * 160}
                y1="300"
                x2={i * 160}
                y2="820"
              />
            )
          )}

        </g>

        {/* Containers */}

        <Container
          x={220}
          y={610}
          color="#425d68"
        />

        <Container
          x={500}
          y={570}
          color="#68776f"
        />

        <Container
          x={790}
          y={625}
          color="#59666d"
        />

        <Container
          x={1430}
          y={590}
          color="#536b70"
        />

        {/* CCTV pole */}

        <g transform="translate(1160 430)">

          <rect
            width="8"
            height="220"
            fill="#111a1f"
          />

          <rect
            x="-22"
            y="20"
            width="55"
            height="32"
            rx="5"
            fill="#202b30"
          />

          <circle
            cx="34"
            cy="36"
            r="7"
            fill="#dce9ea"
          />

        </g>

        {/* Security fence */}

        <g
          stroke="#c2ced0"
          strokeWidth="3"
          opacity=".45"
        >

          {Array.from({ length: 17 }).map(
            (_, i) => (
              <line
                key={i}
                x1={i * 125}
                y1="640"
                x2={i * 125}
                y2="900"
              />
            )
          )}

          <line
            x1="0"
            y1="650"
            x2="1920"
            y2="650"
          />

          <line
            x1="0"
            y1="760"
            x2="1920"
            y2="760"
          />

        </g>

        {/* Yard road */}

        <path
          d="
            M0 880
            L1920 730
            L1920 1080
            L0 1080
            Z
          "
          fill="#080f13"
        />

      </svg>

    </Scene>
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
        stroke="#a8b5b8"
        strokeWidth="3"
      />

      {Array.from({ length: 10 }).map(
        (_, i) => (
          <line
            key={i}
            x1={i * 25}
            y1="0"
            x2={i * 25}
            y2="110"
            stroke="#d7dddd"
            opacity=".14"
          />
        )
      )}

    </g>
  );
}


/* ============================================================
   PORT
============================================================ */

function PortScene() {
  return (
    <Scene>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient
            id="portSky"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#06131e" />
            <stop offset="60%" stopColor="#2b5063" />
            <stop offset="100%" stopColor="#c07d51" />
          </linearGradient>

          <linearGradient
            id="portWater"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#205a70" />
            <stop offset="100%" stopColor="#06131a" />
          </linearGradient>

        </defs>

        <rect
          width="1920"
          height="1080"
          fill="url(#portSky)"
        />

        {/* Cranes */}

        <g
          stroke="#b5c1c3"
          strokeWidth="12"
          fill="none"
          opacity=".75"
        >

          <path d="M280 730 L280 260 L760 260 L760 730" />

          <path d="M280 310 L760 310" />

          <path d="M1050 730 L1050 220 L1530 220 L1530 730" />

          <path d="M1050 270 L1530 270" />

        </g>

        {/* Containers */}

        <g>

          {Array.from({ length: 7 }).map(
            (_, row) =>
              Array.from({ length: 12 }).map(
                (_, col) => (

                  <rect
                    key={`${row}-${col}`}
                    x={50 + col * 125}
                    y={650 - row * 48}
                    width="112"
                    height="42"
                    fill={
                      row % 3 === 0
                        ? "#526d75"
                        : row % 3 === 1
                        ? "#765d50"
                        : "#445b63"
                    }
                    stroke="#17262c"
                    strokeWidth="2"
                  />

                )
              )
          )}

        </g>

        {/* Water */}

        <path
          d="
            M0 790
            C400 750 700 800 1000 770
            C1350 740 1600 790 1920 750
            L1920 1080
            L0 1080
            Z
          "
          fill="url(#portWater)"
        />

        {/* Water reflection */}

        <g
          stroke="#94bdc5"
          strokeWidth="4"
          opacity=".22"
        >

          {Array.from({ length: 18 }).map(
            (_, i) => (

              <line
                key={i}
                x1={i * 110}
                y1={850 + (i % 5) * 32}
                x2={i * 110 + 260}
                y2={850 + (i % 5) * 32}
              />

            )
          )}

        </g>

      </svg>

    </Scene>
  );
}


/* ============================================================
   VESSEL
============================================================ */

function VesselScene() {
  return (
    <Scene>

      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >

        <defs>

          <linearGradient
            id="vesselSky"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#030b13" />
            <stop offset="55%" stopColor="#21495c" />
            <stop offset="100%" stopColor="#98654b" />
          </linearGradient>

          <linearGradient
            id="ocean"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#1a5369" />
            <stop offset="100%" stopColor="#030b11" />
          </linearGradient>

        </defs>

        <rect
          width="1920"
          height="1080"
          fill="url(#vesselSky)"
        />

        {/* Horizon */}

        <line
          x1="0"
          y1="610"
          x2="1920"
          y2="610"
          stroke="#e1a06e"
          strokeWidth="3"
          opacity=".18"
        />

        {/* Ocean */}

        <path
          d="
            M0 610
            Q450 570 900 620
            T1920 600
            L1920 1080
            L0 1080
            Z
          "
          fill="url(#ocean)"
        />

        {/* Ship */}

        <g className="ship-motion">

          {/* Hull */}

          <path
            d="
              M500 700
              L1570 700
              L1450 835
              L720 835
              L590 785
              Z
            "
            fill="#14242b"
            stroke="#89999e"
            strokeWidth="4"
          />

          {/* Deck */}

          <rect
            x="680"
            y="615"
            width="730"
            height="85"
            fill="#3b4f57"
          />

          {/* Bridge */}

          <rect
            x="1350"
            y="475"
            width="180"
            height="140"
            fill="#52666c"
          />

          <rect
            x="1385"
            y="425"
            width="110"
            height="55"
            fill="#66797e"
          />

          {/* Containers */}

          {Array.from({ length: 6 }).map(
            (_, row) =>
              Array.from({ length: 10 }).map(
                (_, col) => (

                  <rect
                    key={`${row}-${col}`}
                    x={715 + col * 70}
                    y={535 - row * 32}
                    width="64"
                    height="27"
                    fill={
                      row % 3 === 0
                        ? "#687c82"
                        : row % 3 === 1
                        ? "#785e51"
                        : "#455f68"
                    }
                    stroke="#17262c"
                    strokeWidth="2"
                  />

                )
              )
          )}

        </g>

        {/* Wake */}

        <path
          d="
            M700 830
            C500 880 280 930 40 960
          "
          fill="none"
          stroke="#c8e1e2"
          strokeWidth="20"
          opacity=".15"
        />

        <path
          d="
            M720 855
            C500 930 300 980 100 1020
          "
          fill="none"
          stroke="#d9e9e8"
          strokeWidth="8"
          opacity=".13"
        />

        {/* Ocean highlights */}

        <g
          stroke="#a2cbd0"
          strokeWidth="3"
          opacity=".18"
        >

          {Array.from({ length: 24 }).map(
            (_, i) => (

              <line
                key={i}
                x1={i * 90}
                y1={900 + (i % 4) * 30}
                x2={i * 90 + 180}
                y2={900 + (i % 4) * 30}
              />

            )
          )}

        </g>

      </svg>

    </Scene>
  );
}


/* ============================================================
   GLOBAL ANIMATION STYLES
============================================================ */

if (typeof document !== "undefined") {

  const STYLE_ID = "cds-intro-animation-styles";

  if (!document.getElementById(STYLE_ID)) {

    const style = document.createElement("style");

    style.id = STYLE_ID;

    style.innerHTML = `

      @keyframes cdsCamera {

        0% {
          transform:
            scale(1.04)
            translate3d(0, 0, 0);
        }

        100% {
          transform:
            scale(1.13)
            translate3d(-1%, -1%, 0);
        }

      }

      @keyframes cdsTruckMovement {

        0% {
          transform: translateX(0);
        }

        100% {
          transform: translateX(32px);
        }

      }

      @keyframes cdsShipMovement {

        0% {
          transform: translateX(0);
        }

        100% {
          transform: translateX(-22px);
        }

      }

      .truck-motion {

        animation:
          cdsTruckMovement
          5s
          ease-in-out
          infinite
          alternate;

      }

      .ship-motion {

        animation:
          cdsShipMovement
          6s
          ease-in-out
          infinite
          alternate;

      }

      @media (prefers-reduced-motion: reduce) {

        .truck-motion,
        .ship-motion {
          animation: none !important;
        }

      }

    `;

    document.head.appendChild(style);

  }

}
