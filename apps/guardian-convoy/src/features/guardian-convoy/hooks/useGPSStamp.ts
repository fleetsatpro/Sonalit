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

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { gps, error, loading, refresh };
}
