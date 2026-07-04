import { useEffect, useRef } from 'react';
import { createGlobeEngine, type GlobeController } from './globe/engine';
import { useReducedMotion } from './useReducedMotion';

// Thin React shell around the canvas engine. Owns:
//   • the <canvas> ref
//   • the rAF loop lifecycle (start on mount, stop on unmount)
//   • debounced resize (150ms)
//   • visibility pause — battery-friendly on a login screen that may idle
export default function OperationsGlobe(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GlobeController | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = createGlobeEngine(canvas, { reducedMotion });
    engineRef.current = engine;
    engine.resize();
    engine.start();

    let rz: number | undefined;
    const onResize = (): void => {
      window.clearTimeout(rz);
      rz = window.setTimeout(() => engine.resize(), 150);
    };
    window.addEventListener('resize', onResize);

    const onVisibility = (): void => {
      if (document.hidden) engine.stop();
      else engine.start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(rz);
      engine.stop();
      engineRef.current = null;
    };
  }, [reducedMotion]);

  return (
    <div className="theater-map">
      <canvas ref={canvasRef} id="globe" aria-hidden="true" />
    </div>
  );
}
