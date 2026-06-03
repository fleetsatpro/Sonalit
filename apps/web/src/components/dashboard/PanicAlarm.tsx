import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore.js';

export default function PanicAlarm() {
  const panicState = useDashboardStore((s) => s.panicState);
  const isActive = panicState?.status === 'active';
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isActive) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }

    let running = true;
    let ctx: AudioContext | null = null;

    const start = async () => {
      ctx = new AudioContext();

      const pattern: [number, number][] = [
        [960, 380], [700, 380],
        [960, 380], [700, 380],
        [960, 380], [700, 800],
      ];

      let idx = 0;
      while (running) {
        const [freq, ms] = pattern[idx % pattern.length];
        idx++;
        if (!running || !ctx) break;

        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        await new Promise<void>((r) => setTimeout(r, ms));
        if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
        osc.stop(ctx.currentTime + 0.12);
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    };

    start().catch(() => {});

    stopRef.current = () => {
      running = false;
      ctx?.close().catch(() => {});
    };

    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      aria-hidden='true'
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
    >
      <style>{`
        @keyframes panic-edge {
          0%   { box-shadow: inset 0 0 0 3px #ff0000, inset 0 0 50px rgba(255,0,0,.25); }
          50%  { box-shadow: inset 0 0 0 7px #ff2200, inset 0 0 110px rgba(255,0,0,.55); }
          100% { box-shadow: inset 0 0 0 3px #ff0000, inset 0 0 50px rgba(255,0,0,.25); }
        }
        .panic-edge-overlay {
          position: absolute;
          inset: 0;
          animation: panic-edge .45s ease-in-out infinite;
        }
      `}</style>
      <div className='panic-edge-overlay' />
    </div>
  );
}
