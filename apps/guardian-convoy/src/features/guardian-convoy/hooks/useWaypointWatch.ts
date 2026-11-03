import { useState, useEffect, useRef } from 'react';
import type { DayPlan, DayPlanWaypoint } from '../types/ConvoyReport';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export interface NearbyTarget {
  kind: 'waypoint' | 'night_park';
  waypoint?: DayPlanWaypoint;
  label: string;
  distance_m: number;
  lat: number;
  lng: number;
}

/**
 * Watches GPS continuously while a day plan is active. When the device enters
 * the radius of an unreached waypoint (or the night park, 500 m), surfaces it
 * as `nearby` so the UI can prompt the CFO to confirm.
 */
export function useWaypointWatch(plan: DayPlan | null, dismissedIds: string[]) {
  const [nearby, setNearby] = useState<NearbyTarget | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!plan || !navigator.geolocation) {
      setNearby(null);
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPosition({ lat, lng });

        // Closest unreached, undismissed waypoint inside its radius
        let best: NearbyTarget | null = null;
        for (const wp of plan.waypoints) {
          if (wp.reached_at || dismissedIds.includes(wp.id)) continue;
          const d = haversineMeters(lat, lng, Number(wp.lat), Number(wp.lng));
          if (d <= wp.radius_m && (!best || d < best.distance_m)) {
            best = { kind: 'waypoint', waypoint: wp, label: wp.label, distance_m: d, lat: Number(wp.lat), lng: Number(wp.lng) };
          }
        }
        if (!best && plan.night_park_lat != null && plan.night_park_lng != null
            && !dismissedIds.includes('night_park')) {
          const d = haversineMeters(lat, lng, Number(plan.night_park_lat), Number(plan.night_park_lng));
          if (d <= 500) {
            best = { kind: 'night_park', label: plan.night_park_label, distance_m: d,
                     lat: Number(plan.night_park_lat), lng: Number(plan.night_park_lng) };
          }
        }
        setNearby(best);
      },
      () => { /* GPS errors are surfaced by useGPSStamp elsewhere */ },
      { enableHighAccuracy: true, maximumAge: 15_000 }
    );

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [plan, dismissedIds]);

  return { nearby, position };
}
