import { useState, useEffect, useCallback } from 'react';
import type { GPS } from '../types/ConvoyReport';

const STALE_MS = 30_000;

export function useGPSStamp() {
  const [gps, setGps] = useState<GPS | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLoading(false);
      },
      err => {
        setError(err.message);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: STALE_MS }
    );
  }, []);

  // Resolve a fix on demand: returns the current one if we already have it,
  // otherwise requests a fresh position and resolves when it arrives. Lets the
  // capture flow wait for GPS instead of discarding the photo (which forced the
  // officer to re-take — the "press upload twice" complaint).
  const ensure = useCallback((): Promise<GPS> => {
    if (gps) return Promise.resolve(gps);
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return; }
      setLoading(true);
      navigator.geolocation.getCurrentPosition(
        pos => {
          const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setGps(fix);
          setLoading(false);
          resolve(fix);
        },
        err => { setError(err.message); setLoading(false); reject(new Error(err.message)); },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: STALE_MS },
      );
    });
  }, [gps]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { gps, error, loading, refresh, ensure };
}
