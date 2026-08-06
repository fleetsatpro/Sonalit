import { useEffect, useRef, useState } from 'react';

// Plays the generated live-action intro film. Four real shots cross-dissolved
// into each other — the dissolve overlaps two playing videos rather than fading
// through black, which is what stops it reading as a slideshow.
//
// Everything here degrades rather than blocks: if the footage isn't present
// (assets not generated yet), if the browser refuses autoplay, or if the user
// prefers reduced motion, we go straight to the dashboard. An intro must never
// be a wall between someone and their work — the previous one was 11.2s of
// unskippable SVG.

const SHOTS = [
  '/cds/intro-01-highway.mp4',
  '/cds/intro-02-yard.mp4',
  '/cds/intro-03-port.mp4',
  '/cds/intro-04-vessel.mp4',
];

const DISSOLVE_MS = 900;

export function CDSIntro({ onDone }: { onDone: () => void }) {
  const [shot, setShot] = useState(0);
  const [nextIn, setNextIn] = useState(false);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    // Belt and braces on top of onError: covers a src that neither errors nor
    // plays (autoplay refused, SPA fallback serving index.html for a missing
    // .mp4, stalled network). The dashboard is already mounted underneath, so
    // dismissing early costs nothing.
    const guard = setTimeout(() => { if (!videoA.current?.currentTime) finish(); }, 2500);
    return () => clearTimeout(guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the outgoing shot dissolving into the incoming one slightly before it
  // ends, so both are moving during the handover.
  const onTimeUpdate = (el: HTMLVideoElement | null) => {
    if (!el || !el.duration || nextIn) return;
    if (el.duration - el.currentTime <= DISSOLVE_MS / 1000) {
      if (shot >= SHOTS.length - 1) return;
      setNextIn(true);
      void videoB.current?.play().catch(() => {});
      setTimeout(() => { setShot(s => s + 1); setNextIn(false); }, DISSOLVE_MS);
    }
  };

  const current = SHOTS[shot];
  const upcoming = SHOTS[shot + 1];

  return (
    <div className="fixed inset-0 z-[999] bg-black overflow-hidden">
      <video
        key={`a-${shot}`}
        ref={videoA}
        src={current}
        autoPlay
        muted
        playsInline
        preload="auto"
        onTimeUpdate={() => onTimeUpdate(videoA.current)}
        onEnded={() => { if (shot >= SHOTS.length - 1) finish(); }}
        onError={finish}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: nextIn ? 0 : 1, transition: `opacity ${DISSOLVE_MS}ms ease-in-out` }}
      />
      {upcoming && (
        <video
          key={`b-${shot}`}
          ref={videoB}
          src={upcoming}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: nextIn ? 1 : 0, transition: `opacity ${DISSOLVE_MS}ms ease-in-out` }}
        />
      )}

      {/* Vignette + a slight lift off pure black so the footage sits in frame
          rather than floating on a void. */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.55) 100%)' }} />

      <button
        onClick={finish}
        className="absolute bottom-6 right-6 px-3.5 py-1.5 rounded-full text-[12px] font-medium text-white/70 hover:text-white bg-black/40 hover:bg-black/60 backdrop-blur border border-white/15 transition-colors cursor-pointer"
      >
        Skip
      </button>

      <div className="absolute bottom-7 left-1/2 -translate-x-1/2 flex gap-1.5">
        {SHOTS.map((_, i) => (
          <div key={i} className="rounded-full transition-all duration-500"
            style={{ width: i === shot ? 18 : 5, height: 3, background: i <= shot ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.22)' }} />
        ))}
      </div>
    </div>
  );
}
