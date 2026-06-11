import { useEffect, useRef } from 'react';
import { subscribe } from '../lib/centrifuge.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
// Per-vehicle throttle: max 1 position update per 500ms
const positionThrottle = new Map();
export function useDashboardRealtime(orgId) {
    const { updateVehiclePosition, prependAlert, updateConvoy, updateIncident, updatePanicState, prependFeedItem, appendTickerEvent, } = useDashboardStore.getState();
    const orgRef = useRef(orgId);
    orgRef.current = orgId;
    useEffect(() => {
        if (!orgId)
            return;
        // Backend publishes all realtime events to org#<id>
        const unsub = subscribe(`org#${orgId}`, (msg) => {
            switch (msg.type) {
                case 'location': {
                    const m = msg;
                    const now = Date.now();
                    const last = positionThrottle.get(m.vehicle_id) ?? 0;
                    if (now - last < 500)
                        break;
                    positionThrottle.set(m.vehicle_id, now);
                    updateVehiclePosition({
                        vehicle_id: m.vehicle_id,
                        lat: m.lat,
                        lng: m.lng,
                        heading: m.heading ?? 0,
                        speed_kmh: m.speed ?? 0,
                    });
                    break;
                }
                case 'panic': {
                    const m = msg;
                    const p = {
                        id: m.panic_id,
                        status: 'active',
                        ...(m.lat != null && { lat: m.lat }),
                        ...(m.lng != null && { lng: m.lng }),
                        triggered_at: m.triggered_at ?? m.created_at,
                    };
                    updatePanicState(p);
                    prependFeedItem({
                        id: p.id,
                        type: 'panic',
                        message: `PANIC / SOS — ${m.device_name ?? 'device'} (${m.mode ?? 'SOS'})`,
                        severity: 'critical',
                        timestamp: p.triggered_at,
                    });
                    break;
                }
                case 'alert.new': {
                    const m = msg;
                    const alert = {
                        id: m.alertId,
                        severity: m.severity ?? 'medium',
                        type: m.alertType,
                        title: m.geofenceName
                            ? `Geofence: ${m.geofenceName}`
                            : `${m.alertType.replace(/_/g, ' ')} alert`,
                        summary: m.message ?? '',
                        convoy_id: null,
                        occurred_at: new Date().toISOString(),
                        acknowledged: false,
                    };
                    prependAlert(alert);
                    appendTickerEvent({ id: alert.id, severity: alert.severity, message: alert.title });
                    prependFeedItem({
                        id: alert.id,
                        type: 'alert',
                        message: alert.title,
                        severity: alert.severity,
                        timestamp: alert.occurred_at,
                    });
                    break;
                }
                case 'convoy.update':
                case 'convoy.dispatched': {
                    const m = msg;
                    const convoy = {
                        id: m.convoyId,
                        name: m.name ?? '',
                        status: m.status ?? 'active',
                    };
                    updateConvoy(convoy);
                    prependFeedItem({
                        id: convoy.id,
                        type: 'convoy',
                        message: `Convoy ${convoy.name || convoy.id}: ${convoy.status}`,
                        timestamp: new Date().toISOString(),
                    });
                    break;
                }
                case 'incident': {
                    const m = msg;
                    if (m.payload) {
                        updateIncident(m.payload);
                        prependFeedItem({
                            id: m.payload.id,
                            type: 'incident',
                            message: m.payload.title,
                            severity: 'high',
                            timestamp: m.payload.occurred_at,
                        });
                    }
                    break;
                }
                default:
                    break;
            }
        });
        return unsub;
    }, [orgId, updateVehiclePosition, prependAlert, updateConvoy, updateIncident, updatePanicState, prependFeedItem, appendTickerEvent]);
}
