import { useEffect, useRef } from 'react';
import { reportApi } from '../api/reportApi';
import type { AuthState } from '../types/ConvoyReport';

// Continuously streams the CFO device's GPS pings (position, speed, heading) to
// the backend while a convoy session is active. This is what populates
// convoy_waypoints so the daily report's route track + route analytics render
// from the officer's real movement instead of falling back to the planned route.
//
// Pings are buffered and flushed in small batches (every ~20 s or 12 points) to
// keep the request rate low. A dropped fix or offline moment is fine — the next
// flush carries whatever accumulated, and the report tolerates a sparse track.

const FLUSH_EVERY_MS = 20_000;
const FLUSH_AT_COUNT = 12;
const MIN_MOVE_M = 25;      // skip near-duplicate points while parked
const MAX_BUFFER = 240;     // hard cap so an offline stretch can't grow unbounded

interface Ping { lat: number; lng: number; speed: number | null; heading: number | null; accuracy: number | null; recorded_at: string }

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function useConvoyTracking(auth: AuthState | null) {
  const bufRef = useRef<Ping[]>([]);
  const lastRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchRef = useRef<number | null>(null);

  const convoyId = auth?.convoy?.id;
  const token = auth?.token;

  useEffect(() => {
    if (!convoyId || !token || !navigator.geolocation) return;

    const flush = () => {
      const batch = bufRef.current;
      if (!batch.length) return;
      bufRef.current = [];
      // Fire-and-forget; on failure keep the points for the next flush so a
      // transient network blip doesn't lose the track.
      reportApi.postTrack(convoyId, batch, token).catch(() => {
        bufRef.current = [...batch, ...bufRef.current].slice(-MAX_BUFFER);
      });
    };

    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, speed, heading, accuracy } = pos.coords;
        // Drop jitter while stationary so the report isn't cluttered with a
        // cloud of near-identical points at every stop.
        if (lastRef.current && distM(lastRef.current, { lat, lng }) < MIN_MOVE_M) return;
        lastRef.current = { lat, lng };
        bufRef.current.push({
          lat, lng,
          speed: speed != null && !Number.isNaN(speed) ? speed : null,   // m/s — backend converts to km/h
          heading: heading != null && !Number.isNaN(heading) ? heading : null,
          accuracy: accuracy != null && !Number.isNaN(accuracy) ? accuracy : null,
          recorded_at: new Date(pos.timestamp || Date.now()).toISOString(),
        });
        if (bufRef.current.length >= FLUSH_AT_COUNT) flush();
        if (bufRef.current.length > MAX_BUFFER) bufRef.current = bufRef.current.slice(-MAX_BUFFER);
      },
      () => { /* GPS errors surfaced elsewhere (useGPSStamp); tracking degrades silently */ },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );

    const iv = setInterval(flush, FLUSH_EVERY_MS);
    // Flush whatever's buffered when the tab is backgrounded/closed.
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [convoyId, token]);
}
