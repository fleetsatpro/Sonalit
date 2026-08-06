import { useEffect, useRef, useState } from 'react';

// Plays the generated intro. Two sources, both real photography:
//
//   video  — Sora footage, four continuous shots
//   stills — photoreal frames, animated with a slow camera push
//
// It prefers video and falls back to stills automatically, because Sora access
// is tier-gated and the account may only have the image model. Deliberately NOT
// vector illustration: SVG is flat fills and strokes, so it cannot be
// photoreal no matter how much detail is piled on — two prior attempts proved
// that. Moving a camera over real pixels can be.
//
// Everything degrades rather than blocks. This overlays a dashboard that is
// already mounted, so a missing asset, refused autoplay or reduced-motion
// preference just reveals the app. The previous intro was 11.2s of unskippable
// SVG; an intro must never stand between someone and their work.

const SHOTS = ['intro-01-highway', 'intro-02-yard', 'intro-03-port', 'intro-04-vessel'];
const DISSOLVE_MS = 900;
const STILL_MS = 4200;

export function CDSIntro({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'video' | 'stills'>('video');
  const [shot, setShot] = useState(0);
  const [nextIn, setNextIn] = useState(false);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    // If the first video neither plays nor errors (SPA fallback serving HTML
    // for a missing .mp4, stalled network), try stills before giving up.
    const guard = setTimeout(() => {
      if (mode === 'video' && !videoA.current?.currentTime) setMode('stills');
    }, 2500);
    return () => clearTimeout(guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = () => {
    if (shot >= SHOTS.length - 1) { finish(); return; }
    setNextIn(true);
    if (mode === 'video') void videoB.current?.play().catch(() => {});
    setTimeout(() => { setShot(s => s + 1); setNextIn(false); }, DISSOLVE_MS);
  };

  // Begin the dissolve slightly before the outgoing shot ends so both are
  // moving during the handover — that overlap is what stops it reading as a
  // slideshow.
  const onTimeUpdate = () => {
    const el = videoA.current;
    if (!el || !el.duration || nextIn) return;
    if (el.duration - el.currentTime <= DISSOLVE_MS / 1000) advance();
  };

  useEffect(() => {
    if (mode !== 'stills' || nextIn) return;
    const t = setTimeout(advance, STILL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, shot, nextIn]);

  const src = (i: number, ext: string) => `/cds/${SHOTS[i]}.${ext}`;
  const hasNext = shot < SHOTS.length - 1;

  return (
    <div className="fixed inset-0 z-[999] bg-black overflow-hidden">
      <style>{`
        @keyframes cds-push { from { transform: scale(1.06) } to { transform: scale(1.16) } }
      `}</style>

      {mode === 'video' ? (
        <>
          <video
            key={`a-${shot}`} ref={videoA} src={src(shot, 'mp4')}
            autoPlay muted playsInline preload="auto"
            onTimeUpdate={onTimeUpdate}
            onEnded={() => { if (!hasNext) finish(); }}
            onError={() => setMode('stills')}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: nextIn ? 0 : 1, transition: `opacity ${DISSOLVE_MS}ms ease-in-out` }}
          />
          {hasNext && (
            <video
              key={`b-${shot}`} ref={videoB} src={src(shot + 1, 'mp4')}
              muted playsInline preload="auto"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: nextIn ? 1 : 0, transition: `opacity ${DISSOLVE_MS}ms ease-in-out` }}
            />
          )}
        </>
      ) : (
        <>
          <img
            key={`sa-${shot}`} src={src(shot, 'png')} alt=""
            onError={finish}
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              opacity: nextIn ? 0 : 1,
              transition: `opacity ${DISSOLVE_MS}ms ease-in-out`,
              animation: `cds-push ${(STILL_MS + DISSOLVE_MS) / 1000}s linear forwards`,
            }}
          />
          {hasNext && (
            <img
              key={`sb-${shot}`} src={src(shot + 1, 'png')} alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                opacity: nextIn ? 1 : 0,
                transition: `opacity ${DISSOLVE_MS}ms ease-in-out`,
                animation: `cds-push ${(STILL_MS + DISSOLVE_MS) / 1000}s linear forwards`,
              }}
            />
          )}
        </>
      )}

      {/* Vignette so the frame sits in the screen rather than floating on black. */}
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
