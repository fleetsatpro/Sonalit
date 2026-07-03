import { useEffect, useRef } from 'react';
import { createGlobeEngine } from './globe/engine';
import { useReducedMotion } from './useReducedMotion';

// Thin React shell around the canvas engine. Owns:
//   • the <canvas> ref
//   • the rAF loop lifecycle (start on mount, stop on unmount)
//   • debounced resize (150ms)
//   • visibility pause — battery-friendly on a login screen that may idle
export default function OperationsGlobe() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = createGlobeEngine(canvas, { reducedMotion });
    engineRef.current = engine;
    engine.resize();
    engine.start();

    let rz;
    const onResize = () => {
      clearTimeout(rz);
      rz = setTimeout(() => engine.resize(), 150);
    };
    window.addEventListener('resize', onResize);

    const onVisibility = () => {
      if (document.hidden) engine.stop();
      else engine.start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(rz);
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
