export type SpatialCanvasContextAttributes = {
  antialias: boolean;
  powerPreference: 'high-performance' | 'low-power' | 'default';
  preserveDrawingBuffer: boolean;
  contextType: 'webgl2' | 'webgl';
};

/**
 * Presentation-quality pixel density shared by Sonalit's MapLibre surfaces.
 * Desktop can supersample up to 3× device pixels; compact/mobile surfaces
 * are bounded at 2× to avoid pathological GPU pressure.
 */
export function spatialPixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const compact = window.matchMedia?.('(max-width: 900px)').matches ?? false;
  const floor = compact ? 1 : 1.25;
  const ceiling = compact ? 2 : 3;
  return Math.min(ceiling, Math.max(floor, dpr));
}

export const spatialCanvasContextAttributes: SpatialCanvasContextAttributes = {
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
  contextType: 'webgl2',
};
