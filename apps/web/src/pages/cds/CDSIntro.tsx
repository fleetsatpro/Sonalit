import { useEffect, useRef, useState, useCallback } from 'react';

import type { CSSProperties } from 'react';

/**
 * CDS opening cinematic.
 *
 * Plays the produced brand film (apps/web/public/cds-intro.mp4) — the e-lock
 * crane lifting a container → highway convoy → tracked delivery pipeline — and
 * then hands over to the end card, which is rendered here in the DOM rather
 * than baked into the footage. The film is cut at the point where it dissolves
 * to the card ground colour (CARD_BG), so the handover is invisible: the last
 * video frame and the card behind it are the same flat colour. Rendering the
 * card in the DOM keeps the wordmark and the "by Sonalit®" line crisp at any
 * device pixel ratio, and lets the brand line animate.
 *
 * Smoothness: playback is gated on `canplaythrough` (the poster — the first
 * frame — holds meanwhile), so the film only starts once enough is buffered to
 * run to the end without stalling. That trades a brief hold on a still frame for
 * stutter-free motion, which matters far more on a platform intro. A fallback
 * timer starts it anyway if buffering is slow.
 *
 * Robustness: every failure path lands on the end card rather than a stall — a
 * load/playback error, a blocked autoplay, or a film that never reaches its end
 * all hand over early, and the card then dismisses itself on a timer. Skip
 * dismisses from either phase. Respects prefers-reduced-motion by skipping
 * straight through.
 */

const VIDEO_SRC = '/cds-intro.mp4';
const POSTER_SRC = '/cds-intro-poster.jpg';
// The flat colour the film fades to on its last frame — the card sits on the
// same value so the film-to-card handover has no visible seam.
const CARD_BG = '#191b22';
// Start playing once buffered; if buffering is slow, start anyway after this.
const BUFFER_WAIT_MS = 2_500;
// Hand over to the card if the film has not ended by then (buffer wait + ~4.6s
// runtime + margin), so a stalled video can never hold the screen.
const FILM_SAFETY_MS = 9_000;
// End card runtime: the last glint lands at ~3.3s, then a beat before dismissal.
const CARD_MS = 3_900;

const BRAND_TEXT = 'by Sonalit';
// The brand line assembles one glyph at a time, then a highlight travels across
// it at a slower stagger, so the reveal and the glint read as two separate
// gestures rather than one blurred event.
const CHAR_STAGGER_MS = 45;
const BRAND_BASE_DELAY_MS = 900;
const GLINT_STAGGER_MS = 70;
const GLINT_LEAD_MS = 320;

// Both animations on a glyph are declared in CSS in a fixed order (reveal, then
// glint); this supplies their two delays for glyph `index`.
function charTiming(index: number): CSSProperties {
  const reveal = BRAND_BASE_DELAY_MS + index * CHAR_STAGGER_MS;
  const glint =
    BRAND_BASE_DELAY_MS + BRAND_TEXT.length * CHAR_STAGGER_MS + GLINT_LEAD_MS + index * GLINT_STAGGER_MS;
  return { animationDelay: `${reveal}ms, ${glint}ms` };
}

interface CDSIntroProps { onDone: () => void }

export function CDSIntro({ onDone }: CDSIntroProps) {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<'film' | 'card'>('film');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const doneRef = useRef(false);
  const phaseRef = useRef<'film' | 'card'>('film');

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setVisible(false);
    // Let the fade-out play before unmounting the overlay.
    window.setTimeout(onDone, 260);
  }, [onDone]);

  // Film → card. Idempotent: the natural end, an error and the safety timeout
  // all race to call this, and only the first one counts.
  const showCard = useCallback(() => {
    if (doneRef.current || phaseRef.current === 'card') return;
    phaseRef.current = 'card';
    setPhase('card');
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return; }

    const v = videoRef.current;
    if (!v) return;

    let started = false;
    // Muted programmatic play() is allowed without a user gesture; if even that
    // is blocked, go straight to the end card rather than stranding the user.
    const start = () => {
      if (started) return;
      started = true;
      void Promise.resolve(v.play()).catch(() => showCard());
    };

    // Prefer starting only when the browser judges it can play to the end
    // without re-buffering; fall back to starting with whatever is buffered.
    v.addEventListener('canplaythrough', start, { once: true });
    const fallbackStart = window.setTimeout(start, BUFFER_WAIT_MS);
    const safety = window.setTimeout(showCard, FILM_SAFETY_MS);

    return () => {
      v.removeEventListener('canplaythrough', start);
      window.clearTimeout(fallbackStart);
      window.clearTimeout(safety);
    };
  }, [showCard, onDone]);

  // The card owns the tail of the intro: it plays its animation, holds a beat,
  // then dismisses.
  useEffect(() => {
    if (phase !== 'card') return;
    const t = window.setTimeout(finish, CARD_MS);
    return () => window.clearTimeout(t);
  }, [phase, finish]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: CARD_BG, WebkitTapHighlightColor: 'transparent' }}
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
        onEnded={showCard}
        onError={showCard}
      />

      {phase === 'film' && (
        /* Gentle bottom scrim so the Skip control stays legible over any frame */
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }} />
      )}

      {phase === 'card' && <EndCard />}

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

/**
 * The end card. Wordmark settles out of a blur, the descriptor rises under it,
 * a hairline draws out from the centre, and the brand line assembles letter by
 * letter before a single highlight sweeps across it.
 */
function EndCard() {
  return (
    <div className="cds-card absolute inset-0 z-[5] flex flex-col items-center justify-center px-8"
      style={{ background: CARD_BG }}>

      <div className="cds-wordmark">CDS</div>

      <div className="cds-descriptor">Container Delivery System</div>

      <div className="cds-rule" />

      <div className="cds-brand">
        <span className="sr-only">{BRAND_TEXT}®</span>
        <span aria-hidden="true">
          {BRAND_TEXT.split('').map((ch, i) => (
            <span key={i} className="cds-char" style={charTiming(i)}>
              {ch === ' ' ? '\u00a0' : ch}
            </span>
          ))}
          <span className="cds-reg" style={charTiming(BRAND_TEXT.length)}>®</span>
        </span>
      </div>

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

  /* ── End card ────────────────────────────────────────────────────────── */

  .cds-card {
    font-family: var(--p-sans, system-ui, sans-serif);
    /* A barely-there vignette, so the card has depth rather than reading as
       flat #191b22 fill. */
    background-image: radial-gradient(ellipse at 50% 42%, rgba(255,255,255,0.045), transparent 62%);
    animation: cdsCardIn 420ms ease-out both;
  }

  .cds-wordmark {
    font-size: clamp(64px, 17vw, 132px);
    font-weight: 700;
    line-height: 0.92;
    letter-spacing: -0.02em;
    color: #f4f6fa;
    animation: cdsWordmarkIn 1000ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .cds-descriptor {
    margin-top: 0.55rem;
    font-size: clamp(13px, 3.6vw, 19px);
    font-weight: 400;
    letter-spacing: 0.01em;
    color: rgba(244, 246, 250, 0.82);
    animation: cdsRiseIn 900ms cubic-bezier(0.16, 1, 0.3, 1) 320ms both;
  }

  .cds-rule {
    margin-top: 1.5rem;
    height: 1px;
    width: 84px;
    background: linear-gradient(to right, transparent, rgba(255,255,255,0.45), transparent);
    transform-origin: center;
    animation: cdsRuleIn 900ms cubic-bezier(0.16, 1, 0.3, 1) 640ms both;
  }

  .cds-brand {
    margin-top: 1.4rem;
    font-size: clamp(12px, 3.2vw, 16px);
    font-weight: 500;
    letter-spacing: 0.18em;
  }

  /* The line assembles letter by letter, then a single highlight travels
     across it — each glyph brightens to white in turn, which reads as light
     raking over an engraved mark. Doing it per glyph rather than with a
     background-clip:text gradient keeps the text painted at all times, so
     nothing can be invisible while it waits for its cue. */
  .cds-char,
  .cds-reg {
    display: inline-block;
    white-space: pre;
    color: #c3cad8;
    animation:
      cdsCharIn 720ms cubic-bezier(0.16, 1, 0.3, 1) both,
      cdsGlint 900ms cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  .cds-reg {
    /* Pulls the mark back in against the trailing letter-space of the line, so
       it sits on the "t" rather than floating a full space away. */
    margin-left: -0.14em;
    font-size: 0.62em;
    /* Superscript, settling from its own baseline so it reads as the mark being
       stamped on rather than dropped in. */
    vertical-align: 0.55em;
    transform-origin: 50% 80%;
    animation:
      cdsRegIn 760ms cubic-bezier(0.16, 1, 0.3, 1) both,
      cdsGlint 900ms cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  @keyframes cdsCardIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  @keyframes cdsWordmarkIn {
    from { opacity: 0; transform: scale(1.055); filter: blur(11px); }
    to   { opacity: 1; transform: scale(1);     filter: blur(0); }
  }

  @keyframes cdsRiseIn {
    from { opacity: 0; transform: translateY(9px); filter: blur(5px); }
    to   { opacity: 1; transform: none;            filter: blur(0); }
  }

  @keyframes cdsRuleIn {
    from { opacity: 0; transform: scaleX(0.1); }
    to   { opacity: 1; transform: scaleX(1); }
  }

  @keyframes cdsCharIn {
    from { opacity: 0; transform: translateY(7px); filter: blur(6px); }
    to   { opacity: 1; transform: none;            filter: blur(0); }
  }

  @keyframes cdsRegIn {
    0%   { opacity: 0; transform: scale(1.7); }
    62%  { opacity: 1; transform: scale(0.95); }
    100% { opacity: 1; transform: scale(1); }
  }

  @keyframes cdsGlint {
    0%   { color: #c3cad8; text-shadow: none; }
    45%  { color: #ffffff; text-shadow: 0 0 14px rgba(214, 226, 255, 0.55); }
    100% { color: #dbe2ee; text-shadow: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .cds-card, .cds-wordmark, .cds-descriptor, .cds-rule,
    .cds-char, .cds-reg {
      animation: none;
      color: #dbe2ee;
    }
  }
`;
