import { useEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SpatialWorldEntity } from '../../lib/spatialClient.js';

type Props = { map: MapLibreMap | null; entities: SpatialWorldEntity[]; active: boolean };
type Sample = { latitude: number; longitude: number; speed: number; direction: number };
type ProjectedSample = Sample & { x: number; y: number };
type TrailParticle = { x: number; y: number; age: number; life: number; phase: number };
type Flow = { dx: number; dy: number; speed: number };

/** Median nearest-neighbour spacing bounds interpolation to the local source-grid footprint. */
export function calculateWindSupportRadiusPx(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const nearestDistances = points.map((point, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let otherIndex = 0; otherIndex < points.length; otherIndex += 1) {
      if (otherIndex !== index) nearest = Math.min(nearest, Math.hypot(points[otherIndex].x - point.x, points[otherIndex].y - point.y));
    }
    return nearest;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nearestDistances.length) return 0;
  const middle = Math.floor(nearestDistances.length / 2);
  const medianSpacing = nearestDistances.length % 2
    ? nearestDistances[middle]
    : (nearestDistances[middle - 1] + nearestDistances[middle]) / 2;
  return Math.min(176, Math.max(24, medianSpacing * 0.55));
}

function readNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Persistent 2D advection pass. Fading traces reveal local flow without neon
 * halos or CSS pulses. Interpolation remains bounded by observed model-grid
 * spacing and is never represented as radar or an observed hazard footprint.
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
    .filter(sample => Number.isFinite(sample.latitude) && sample.latitude >= -90 && sample.latitude <= 90
      && Number.isFinite(sample.longitude) && sample.longitude >= -180 && sample.longitude <= 180
      && sample.speed >= 0 && sample.direction >= 0 && sample.direction <= 360),
  [entities]);
  const signature = samples.map(sample => [sample.latitude, sample.longitude, sample.speed, sample.direction].join(',')).join(';');
  const stateRef = useRef({ active: active && samples.length > 1, samples, signature });
  stateRef.current = { active: active && samples.length > 1, samples, signature };
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!map) return;
    const container = map.getCanvasContainer();
    const canvas = document.createElement('canvas');
    canvas.className = 'wx-field-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) { canvas.remove(); return; }

    let disposed = false;
    let moving = false;
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame: number | null = null;
    let timer: number | null = null;
    let width = 1, height = 1, pixelRatio = 1, seed = 81031;
    let particles: TrailParticle[] = [];
    let seededSignature = '';
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const cancelSchedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      timer = null; frame = null;
    };
    const clear = () => context.clearRect(0, 0, width, height);
    const projectedSamples = (): ProjectedSample[] => stateRef.current.samples.map(sample => {
      const point = map.project([sample.longitude, sample.latitude]);
      return { ...sample, x: point.x, y: point.y };
    }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x > -width * 0.5 && point.x < width * 1.5
      && point.y > -height * 0.5 && point.y < height * 1.5);
    const flowAt = (x: number, y: number, points: ProjectedSample[], supportRadiusPx: number): Flow | null => {
      const nearest: Array<{ point: ProjectedSample; d2: number }> = [];
      for (const point of points) {
        const dx = point.x - x, dy = point.y - y, d2 = dx * dx + dy * dy;
        let index = nearest.findIndex(item => d2 < item.d2);
        if (index < 0) index = nearest.length;
        nearest.splice(index, 0, { point, d2 });
        if (nearest.length > 4) nearest.pop();
      }
      if (!nearest.length || nearest[0].d2 > supportRadiusPx * supportRadiusPx) return null;
      let total = 0, vx = 0, vy = 0;
      for (const entry of nearest) {
        const weight = 1 / (entry.d2 + 400);
        // Meteorological direction denotes where wind comes FROM.
        const radians = ((entry.point.direction + 180) % 360) * Math.PI / 180;
        vx += Math.sin(radians) * entry.point.speed * weight;
        vy -= Math.cos(radians) * entry.point.speed * weight;
        total += weight;
      }
      if (total <= 0) return null;
      vx /= total; vy /= total;
      const speed = Math.hypot(vx, vy);
      if (!Number.isFinite(speed) || speed < 0.4) return null;
      return { dx: vx / speed, dy: vy / speed, speed };
    };
    const makeParticle = (point: ProjectedSample, radius: number): TrailParticle => {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius * 0.92;
      return { x: point.x + Math.cos(angle) * distance, y: point.y + Math.sin(angle) * distance, age: Math.floor(random() * 80), life: 105 + Math.floor(random() * 125), phase: random() * Math.PI * 2 };
    };
    const reseed = (points: ProjectedSample[], supportRadiusPx: number) => {
      seed = 81031;
      const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
      const threads = Number(navigator.hardwareConcurrency || 4);
      const lowPower = memory <= 4 || threads < 6;
      const budget = Math.max(32, Math.min(lowPower ? 76 : 148, Math.round(width * height / (lowPower ? 16500 : 11500))));
      const perPoint = Math.max(1, Math.ceil(budget / Math.max(1, points.length)));
      particles = points.flatMap(point => Array.from({ length: perPoint }, () => makeParticle(point, supportRadiusPx))).slice(0, budget);
      seededSignature = stateRef.current.signature;
    };
    const colorFor = (speed: number) => speed >= 65
      ? 'rgba(255, 192, 133, 0.62)'
      : speed >= 32
        ? 'rgba(139, 229, 219, 0.52)'
        : 'rgba(119, 202, 239, 0.42)';
    const drawSegment = (x1: number, y1: number, x2: number, y2: number, speed: number) => {
      context.lineCap = 'round';
      context.strokeStyle = colorFor(speed);
      context.lineWidth = speed >= 65 ? 1.25 : speed >= 32 ? 0.95 : 0.72;
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
      context.strokeStyle = 'rgba(229, 251, 255, 0.20)';
      context.lineWidth = 0.38;
      context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
    };
    const draw = (advance: boolean) => {
      if (!stateRef.current.active || moving || document.visibilityState !== 'visible') { clear(); return; }
      const points = projectedSamples();
      const supportRadiusPx = calculateWindSupportRadiusPx(points);
      if (supportRadiusPx <= 0) { clear(); return; }
      if (seededSignature !== stateRef.current.signature || particles.length === 0) reseed(points, supportRadiusPx);
      if (advance) {
        // Remove only alpha from the overlay; the basemap beneath is untouched.
        context.save(); context.globalCompositeOperation = 'destination-out';
        context.fillStyle = 'rgba(0, 0, 0, 0.12)'; context.fillRect(0, 0, width, height); context.restore();
      } else clear();
      context.save(); context.globalCompositeOperation = 'source-over';
      for (const particle of particles) {
        const first = flowAt(particle.x, particle.y, points, supportRadiusPx);
        if (!first) { particle.age = particle.life; continue; }
        const stride = (0.28 + Math.min(1.85, first.speed * 0.022)) * (advance ? 1 : 5);
        const midFlow = flowAt(particle.x + first.dx * stride * 0.5, particle.y + first.dy * stride * 0.5, points, supportRadiusPx) ?? first;
        const nextX = particle.x + midFlow.dx * stride;
        const nextY = particle.y + midFlow.dy * stride;
        if (advance) {
          const x = particle.x, y = particle.y;
          particle.x = nextX; particle.y = nextY; particle.age += 1;
          if (particle.age >= particle.life || particle.x < -4 || particle.x > width + 4 || particle.y < -4 || particle.y > height + 4) { particle.age = particle.life; continue; }
          drawSegment(x, y, particle.x, particle.y, midFlow.speed);
        } else {
          drawSegment(particle.x - midFlow.dx * 5, particle.y - midFlow.dy * 5, particle.x + midFlow.dx * 5, particle.y + midFlow.dy * 5, midFlow.speed);
        }
      }
      context.restore();
      if (advance) {
        for (const particle of particles) {
          if (particle.age < particle.life) continue;
          const nearest = points.reduce((best, point) => Math.hypot(point.x - particle.x, point.y - particle.y) < Math.hypot(best.x - particle.x, best.y - particle.y) ? point : best, points[0]);
          Object.assign(particle, makeParticle(nearest, supportRadiusPx));
        }
      }
    };
    const schedule = () => {
      if (disposed || reducedMotion || !stateRef.current.active || moving || document.visibilityState !== 'visible' || timer !== null || frame !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        frame = window.requestAnimationFrame(() => { frame = null; if (disposed) return; draw(true); schedule(); });
      }, 36);
    };
    const redraw = () => {
      if (disposed) return;
      if (!stateRef.current.active || moving || document.visibilityState !== 'visible') { cancelSchedule(); clear(); return; }
      draw(false);
      if (reducedMotion) cancelSchedule(); else schedule();
    };
    redrawRef.current = redraw;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const points = projectedSamples(); reseed(points, calculateWindSupportRadiusPx(points)); clear(); redraw();
    };
    const onMoveStart = () => { moving = true; cancelSchedule(); clear(); };
    const onMoveEnd = () => { moving = false; const points = projectedSamples(); reseed(points, calculateWindSupportRadiusPx(points)); redraw(); };
    const onVisibility = () => { if (document.visibilityState !== 'visible') { cancelSchedule(); clear(); } else redraw(); };
    const onMotionChange = (event: MediaQueryListEvent) => { reducedMotion = event.matches; redraw(); };
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new ResizeObserver(resize);
    observer.observe(container); map.on('resize', resize); map.on('movestart', onMoveStart); map.on('moveend', onMoveEnd);
    motionQuery.addEventListener('change', onMotionChange); document.addEventListener('visibilitychange', onVisibility);
    resize();
    return () => {
      disposed = true; cancelSchedule(); observer.disconnect();
      map.off('resize', resize); map.off('movestart', onMoveStart); map.off('moveend', onMoveEnd);
      motionQuery.removeEventListener('change', onMotionChange); document.removeEventListener('visibilitychange', onVisibility);
      if (redrawRef.current === redraw) redrawRef.current = () => {};
      canvas.remove();
    };
  }, [map]);

  useEffect(() => { redrawRef.current(); }, [active, signature, map]);
  return null;
}
