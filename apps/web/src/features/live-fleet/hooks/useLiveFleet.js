import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
import { subscribe } from '../../../lib/centrifuge.js';
import { useAuthStore } from '../../../stores/auth.js';
function deriveStatus(speedKmh, secsAgo) {
    if (secsAgo > 1800)
        return 'offline';
    if (speedKmh > 5)
        return 'move';
    if (secsAgo < 300)
        return 'idle';
    return 'stop';
}
export function useLiveFleet() {
    const orgId = useAuthStore(s => s.user?.org_id ?? '');
    // keyed by vehicle_id (or device_id as fallback)
    const [positions, setPositions] = useState(new Map());
    const posRef = useRef(positions);
    posRef.current = positions;
    const { data: dashVehicles } = useQuery({
        queryKey: ['live-fleet-vehicles'],
        queryFn: async () => {
            const r = await api.get('/dashboard/vehicles');
            return r.data.data ?? [];
        },
        enabled: !!orgId,
        refetchInterval: 30_000,
        staleTime: 15_000,
    });
    const { data: dashConvoys } = useQuery({
        queryKey: ['live-fleet-convoys'],
        queryFn: async () => {
            const r = await api.get('/dashboard/convoys');
            return r.data.data ?? [];
        },
        enabled: !!orgId,
        refetchInterval: 60_000,
        staleTime: 30_000,
    });
    // Initial GPS positions — always fetch; used as primary source when no vehicle records
    useQuery({
        queryKey: ['live-fleet-gps-init'],
        queryFn: async () => {
            const r = await api.get('/gps/track');
            const next = new Map();
            for (const p of r.data) {
                const key = p.vehicle_id ?? p.device_id;
                next.set(key, p);
            }
            setPositions(next);
            return r.data;
        },
        enabled: !!orgId,
        staleTime: 0,
    });
    // Real-time GPS updates via Centrifuge
    useEffect(() => {
        if (!orgId)
            return;
        return subscribe(`org#${orgId}`, ev => {
            if (!ev.device_id && !ev.vehicle_id)
                return;
            const key = ev.vehicle_id ?? ev.device_id;
            setPositions(prev => {
                const next = new Map(prev);
                next.set(key, ev);
                return next;
            });
        });
    }, [orgId]);
    const convoyMap = useMemo(() => {
        const m = new Map();
        for (const c of (dashConvoys ?? []))
            m.set(c.id, c);
        return m;
    }, [dashConvoys]);
    // Build a registration lookup from dashboard vehicles
    const vehicleRegMap = useMemo(() => {
        const m = new Map();
        for (const v of (dashVehicles ?? []))
            m.set(v.id, v);
        return m;
    }, [dashVehicles]);
    const { groups, counts } = useMemo(() => {
        const now = Date.now();
        const byConvoy = new Map();
        const standalone = [];
        const counts = { all: 0, move: 0, idle: 0, stop: 0, sos: 0, offline: 0 };
        // Seed: start from dashboard vehicles if available, otherwise from GPS positions
        const useDashboard = (dashVehicles?.length ?? 0) > 0;
        if (useDashboard) {
            for (const v of dashVehicles) {
                const pos = positions.get(v.id);
                const secsAgo = pos?.timestamp ? Math.floor((now - new Date(pos.timestamp).getTime()) / 1000) : 99999;
                const speedKmh = pos ? (pos.speed ?? 0) : v.speed_kmh;
                const status = deriveStatus(speedKmh, secsAgo);
                const lv = {
                    id: v.id,
                    registration: v.registration,
                    convoy_id: v.convoy_id,
                    convoy_name: v.convoy_id ? (convoyMap.get(v.convoy_id)?.name ?? null) : null,
                    status,
                    lat: pos?.lat ?? null,
                    lng: pos?.lng ?? null,
                    speed_kmh: speedKmh,
                    heading: pos?.heading ?? null,
                    last_ping_at: pos?.timestamp ?? v.last_ping_at,
                    secondsAgo: secsAgo,
                    panic_active: false,
                    location_desc: '',
                };
                counts.all++;
                counts[status]++;
                if (v.convoy_id) {
                    if (!byConvoy.has(v.convoy_id))
                        byConvoy.set(v.convoy_id, []);
                    byConvoy.get(v.convoy_id).push(lv);
                }
                else {
                    standalone.push(lv);
                }
            }
        }
        else {
            // Fallback: build from GPS positions directly (like old GPS.tsx)
            for (const [key, pos] of positions) {
                const secsAgo = pos.timestamp ? Math.floor((now - new Date(pos.timestamp).getTime()) / 1000) : 99999;
                const speedKmh = pos.speed ?? 0;
                const status = deriveStatus(speedKmh, secsAgo);
                const dashV = pos.vehicle_id ? vehicleRegMap.get(pos.vehicle_id) : undefined;
                const lv = {
                    id: key,
                    registration: pos.name || dashV?.registration || pos.vehicle_id?.slice(0, 8) || pos.device_id.slice(0, 8),
                    convoy_id: null,
                    convoy_name: null,
                    status,
                    lat: pos.lat,
                    lng: pos.lng,
                    speed_kmh: speedKmh,
                    heading: pos.heading,
                    last_ping_at: pos.timestamp,
                    secondsAgo: secsAgo,
                    panic_active: false,
                    location_desc: '',
                };
                counts.all++;
                counts[status]++;
                standalone.push(lv);
            }
        }
        const groups = [];
        for (const [cid, vehicles] of byConvoy) {
            const convoy = convoyMap.get(cid);
            groups.push({
                id: cid,
                name: convoy?.name ?? cid,
                origin: convoy?.origin ?? null,
                destination: convoy?.destination ?? null,
                vehicles,
            });
        }
        if (standalone.length) {
            groups.push({
                id: '__standalone',
                name: 'Vehicles',
                origin: null,
                destination: null,
                vehicles: standalone,
            });
        }
        return { groups, counts };
    }, [dashVehicles, positions, convoyMap, vehicleRegMap]);
    return { groups, counts };
}
