import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * CDS opening cinematic.
 *
 * Plays the produced brand film (apps/web/public/cds-intro.mp4) — the e-lock
 * crane lifting a container → highway convoy → tracked delivery pipeline → the
 * CDS end card. The film carries its own title, HUD and tagline, so this shell
 * adds nothing on top but a Skip control. Shown once per session (see
 * CDSDashboard).
 *
 * Smoothness: playback is gated on `canplaythrough` (the poster — the first
 * frame — holds meanwhile), so the film only starts once enough is buffered to
 * run to the end without stalling. That trades a brief hold on a still frame for
 * stutter-free motion, which matters far more on a platform intro. A fallback
 * timer starts it anyway if buffering is slow.
 *
 * Robustness: dismisses on natural end, on Skip, on load/playback error, and on
 * a safety timeout, so a slow or blocked video can never trap the user on a
 * still frame. Respects prefers-reduced-motion by skipping straight through.
 */

const VIDEO_SRC = '/cds-intro.mp4';
const POSTER_SRC = '/cds-intro-poster.jpg';
// Start playing once buffered; if buffering is slow, start anyway after this.
const BUFFER_WAIT_MS = 2_500;
// Absolute upper bound (buffer wait + ~6.6s runtime + margin), then dismiss.
const SAFETY_MS = 13_000;

interface CDSIntroProps { onDone: () => void }

export function CDSIntro({ onDone }: CDSIntroProps) {
  const [visible, setVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setVisible(false);
    // Let the fade-out play before unmounting the overlay.
    window.setTimeout(onDone, 260);
  }, [onDone]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return; }

    const v = videoRef.current;
    if (!v) return;

    let started = false;
    // Muted programmatic play() is allowed without a user gesture; if even that
    // is blocked, don't strand the user — skip straight in.
    const start = () => {
      if (started) return;
      started = true;
      void Promise.resolve(v.play()).catch(() => finish());
    };

    // Prefer starting only when the browser judges it can play to the end
    // without re-buffering; fall back to starting with whatever is buffered.
    v.addEventListener('canplaythrough', start, { once: true });
    const fallbackStart = window.setTimeout(start, BUFFER_WAIT_MS);
    const safety = window.setTimeout(finish, SAFETY_MS);

    return () => {
      v.removeEventListener('canplaythrough', start);
      window.clearTimeout(fallbackStart);
      window.clearTimeout(safety);
    };
  }, [finish, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <style>{styles}</style>

      <video
        ref={videoRef}
        className="cds-intro-video absolute inset-0 h-full w-full"
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
      />

      {/* Gentle bottom scrim so the Skip control stays legible over any frame */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }} />

      <button
        type="button"
        onClick={finish}
        className="absolute bottom-6 right-6 z-10 rounded-full border border-white/20 bg-black/40 px-5 py-2.5 text-[11px] font-medium tracking-[0.18em] text-white/70 backdrop-blur-md transition-all hover:border-white/50 hover:text-white cursor-pointer"
        style={{ fontFamily: 'var(--p-mono, ui-monospace, monospace)' }}
      >
        SKIP
      </button>
    </div>
  );
}

// Portrait film: fill the screen on portrait/mobile, letterbox on wide desktop
// so it is never blown up into a blurry crop.
const styles = `
  .cds-intro-video { object-fit: cover; object-position: center; }
  @media (min-aspect-ratio: 1/1) {
    .cds-intro-video { object-fit: contain; }
  }
`;
