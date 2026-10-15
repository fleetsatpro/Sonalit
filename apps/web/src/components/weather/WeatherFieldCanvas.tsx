import { useEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SpatialWorldEntity } from '../../lib/spatialClient.js';

type Props = {
  map: MapLibreMap | null;
  entities: SpatialWorldEntity[];
  active: boolean;
};
type Sample = { latitude: number; longitude: number; speed: number; direction: number };
type ProjectedSample = Sample & { x: number; y: number };
type Particle = { x: number; y: number; phase: number };
type Flow = { dx: number; dy: number; speed: number };

/**
 * Estimate local support from forecast-grid spacing. Flow remains transparent
 * outside the neighbours' local footprints instead of extrapolating sparse
 * samples across an entire viewport.
 */
export function calculateWindSupportRadiusPx(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const nearestDistances = points.map((point, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let otherIndex = 0; otherIndex < points.length; otherIndex += 1) {
      if (otherIndex === index) continue;
      nearest = Math.min(nearest, Math.hypot(points[otherIndex].x - point.x, points[otherIndex].y - point.y));
    }
    return nearest;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nearestDistances.length) return 0;
  const middle = Math.floor(nearestDistances.length / 2);
  const medianSpacing = nearestDistances.length % 2
    ? nearestDistances[middle]
    : (nearestDistances[middle - 1] + nearestDistances[middle]) / 2;
  return Math.min(100, Math.max(18, medianSpacing * 0.55));
}


function readNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

/**
 * Renders a restrained, source-derived wind-flow animation beneath the point
 * markers. Vectors are interpolated from provider forecast grid points; this is
 * not radar imagery, an observed wind field, or a hazard footprint.
 */
export default function WeatherFieldCanvas({ map, entities, active }: Props) {
  const samples = useMemo<Sample[]>(() => entities
    .filter(entity => entity.entityType === 'weather')
    .map(entity => ({
      latitude: Number(entity.latitude),
      longitude: Number(entity.longitude),
      speed: readNumber(entity.attributes?.windSpeedKmh) ?? -1,
      direction: readNumber(entity.attributes?.windDirectionDeg) ?? -1,
    }))
    .filter(sample =>
      Number.isFinite(sample.latitude) && sample.latitude >= -90 && sample.latitude <= 90
      && Number.isFinite(sample.longitude) && sample.longitude >= -180 && sample.longitude <= 180
      && sample.speed >= 0 && sample.direction >= 0 && sample.direction <= 360
    ), [entities]);
  const signature = samples.map(sample =>
    [sample.latitude, sample.longitude, sample.speed, sample.direction].join(',')
  ).join(';');
  const stateRef = useRef({ active, samples });
  stateRef.current = { active: active && samples.length > 0, samples };
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!map) return;
    const container = map.getCanvasContainer();
    const canvas = document.createElement('canvas');
    canvas.className = 'wx-field-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      canvas.remove();
      return;
    }

    let disposed = false;
    let moving = false;
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame: number | null = null;
    let timer: number | null = null;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let seed = 81031;
    let particles: Particle[] = [];
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const cancelSchedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      timer = null;
      frame = null;
    };
    const clear = () => context.clearRect(0, 0, width, height);
    const reseed = () => {
      seed = 81031;
      const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
      const threads = Number(navigator.hardwareConcurrency || 4);
      const lowPower = memory <= 4 || threads < 6;
      const divisor = lowPower ? 9000 : 6200;
      const count = Math.max(48, Math.min(lowPower ? 100 : 210, Math.round(width * height / divisor)));
      particles = Array.from({ length: count }, () => ({
        x: random() * width,
        y: random() * height,
        phase: random() * Math.PI * 2,
      }));
    };
    const projectedSamples = (): ProjectedSample[] => stateRef.current.samples.map(sample => {
      const point = map.project([sample.longitude, sample.latitude]);
      return { ...sample, x: point.x, y: point.y };
    }).filter(point =>
      Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x > -width && point.x < width * 2
      && point.y > -height && point.y < height * 2
    );
    const flowAt = (x: number, y: number, points: ProjectedSample[], supportRadiusPx: number): Flow | null => {
      const nearest: Array<{ point: ProjectedSample; d2: number }> = [];
      for (const point of points) {
        const dx = point.x - x;
        const dy = point.y - y;
        const d2 = dx * dx + dy * dy;
        let index = nearest.findIndex(item => d2 < item.d2);
        if (index < 0) index = nearest.length;
        nearest.splice(index, 0, { point, d2 });
        if (nearest.length > 4) nearest.pop();
      }
      if (!nearest.length || nearest[0].d2 > supportRadiusPx * supportRadiusPx) return null;
      let weightTotal = 0;
      let vectorX = 0;
      let vectorY = 0;
      for (const item of nearest) {
        const weight = 1 / (item.d2 + 900);
        const radians = ((item.point.direction + 180) % 360) * Math.PI / 180;
        vectorX += Math.sin(radians) * item.point.speed * weight;
        vectorY -= Math.cos(radians) * item.point.speed * weight;
        weightTotal += weight;
      }
      if (!weightTotal) return null;
      vectorX /= weightTotal;
      vectorY /= weightTotal;
      const speed = Math.hypot(vectorX, vectorY);
      if (!Number.isFinite(speed) || speed < 0.4) return null;
      return { dx: vectorX / speed, dy: vectorY / speed, speed };
    };
    const draw = (advance: boolean) => {
      clear();
      if (!stateRef.current.active || moving || document.visibilityState !== 'visible') return;
      const points = projectedSamples();
      const supportRadiusPx = calculateWindSupportRadiusPx(points);
      if (supportRadiusPx <= 0) return;
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.lineCap = 'round';
      for (const particle of particles) {
        const flow = flowAt(particle.x, particle.y, points, supportRadiusPx);
        if (!flow) continue;
        const speed = Math.min(120, flow.speed);
        const stride = 0.25 + speed * 0.019;
        const wobble = Math.sin(particle.phase + performance.now() * 0.00065) * (advance ? 0.045 : 0);
        const dx = flow.dx * stride + wobble;
        const dy = flow.dy * stride - wobble * 0.45;
        if (advance) {
          particle.x += dx;
          particle.y += dy;
          if (particle.x < -30 || particle.x > width + 30 || particle.y < -30 || particle.y > height + 30) {
            particle.x = random() * width;
            particle.y = random() * height;
          }
        }
        const tail = 5 + speed * 0.115;
        const alpha = (0.13 + Math.min(0.27, speed / 340)).toFixed(3);
        context.beginPath();
        context.moveTo(particle.x - flow.dx * tail, particle.y - flow.dy * tail);
        context.lineTo(particle.x, particle.y);
        context.lineWidth = 0.6 + Math.min(1.1, speed / 100);
        context.strokeStyle = speed >= 70
          ? 'rgba(255,179,126,' + alpha + ')'
          : speed >= 35
            ? 'rgba(126,223,215,' + alpha + ')'
            : 'rgba(100,197,231,' + alpha + ')';
        context.stroke();
      }
      context.restore();
    };
    const schedule = () => {
      if (disposed || reducedMotion || !stateRef.current.active || moving
        || document.visibilityState !== 'visible' || timer !== null || frame !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (disposed) return;
          draw(true);
          schedule();
        });
      }, 48);
    };
    const redraw = () => {
      if (disposed) return;
      if (!stateRef.current.active || moving || document.visibilityState !== 'visible') {
        cancelSchedule();
        clear();
        return;
      }
      draw(false);
      if (reducedMotion) cancelSchedule();
      else schedule();
    };
    redrawRef.current = redraw;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      reseed();
      redraw();
    };
    const onMoveStart = () => {
      moving = true;
      cancelSchedule();
      clear();
    };
    const onMoveEnd = () => {
      moving = false;
      reseed();
      redraw();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        cancelSchedule();
        clear();
      } else {
        redraw();
      }
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      redraw();
    };
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    map.on('resize', resize);
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    motionQuery.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    return () => {
      disposed = true;
      cancelSchedule();
      observer.disconnect();
      map.off('resize', resize);
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      motionQuery.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      if (redrawRef.current === redraw) redrawRef.current = () => {};
      canvas.remove();
    };
  }, [map]);

  useEffect(() => {
    redrawRef.current();
  }, [active, signature, map]);

  return null;
}
