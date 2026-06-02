import { useEffect, useRef } from 'react';
import { subscribe } from '../lib/centrifuge.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardAlert, ConvoyUpdate, IncidentUpdate, PanicEvent } from '../stores/dashboardStore.js';

interface PositionMsg {
  type: 'position';
  vehicle_id: string;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
}

interface AlertMsg { type: 'alert'; payload: DashboardAlert }
interface AlertAckMsg { type: 'alert_ack'; id: string }
interface ConvoyMsg { type: 'convoy'; payload: ConvoyUpdate }
interface IncidentMsg { type: 'incident'; payload: IncidentUpdate }
interface PanicMsg { type: 'panic'; payload: PanicEvent }

type DashboardMsg = PositionMsg | AlertMsg | AlertAckMsg | ConvoyMsg | IncidentMsg | PanicMsg;

// Per-vehicle throttle: max 1 position update per 500ms
const positionThrottle = new Map<string, number>();

export function useDashboardRealtime(orgId: string): void {
  const { updateVehiclePosition, prependAlert, removeAlert, updateConvoy, updateIncident, updatePanicState, prependFeedItem, appendTickerEvent } = useDashboardStore.getState();
  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  useEffect(() => {
    if (!orgId) return;

    const unsub = subscribe<DashboardMsg>(`dashboard#${orgId}`, (msg) => {
      switch (msg.type) {
        case 'position': {
          const now = Date.now();
          const last = positionThrottle.get(msg.vehicle_id) ?? 0;
          if (now - last < 500) break;
          positionThrottle.set(msg.vehicle_id, now);
          updateVehiclePosition({
            vehicle_id: msg.vehicle_id,
            lat: msg.lat,
            lng: msg.lng,
            heading: msg.heading,
            speed_kmh: msg.speed_kmh,
          });
          break;
        }
        case 'alert':
          prependAlert(msg.payload);
          appendTickerEvent({ id: msg.payload.id, severity: msg.payload.severity, message: msg.payload.title });
          prependFeedItem({ id: msg.payload.id, type: 'alert', message: msg.payload.title, severity: msg.payload.severity, timestamp: msg.payload.occurred_at });
          break;
        case 'alert_ack':
          removeAlert(msg.id);
          break;
        case 'convoy':
          updateConvoy(msg.payload);
          prependFeedItem({ id: msg.payload.id, type: 'convoy', message: `Convoy ${msg.payload.name}: ${msg.payload.status}`, timestamp: new Date().toISOString() });
          break;
        case 'incident':
          updateIncident(msg.payload);
          prependFeedItem({ id: msg.payload.id, type: 'incident', message: msg.payload.title, severity: 'high', timestamp: msg.payload.occurred_at });
          break;
        case 'panic':
          updatePanicState(msg.payload);
          if (msg.payload.status === 'active') {
            prependFeedItem({ id: msg.payload.id, type: 'panic', message: 'PANIC ALERT ACTIVATED', severity: 'critical', timestamp: msg.payload.triggered_at });
          }
          break;
      }
    });

    return unsub;
  }, [orgId, updateVehiclePosition, prependAlert, removeAlert, updateConvoy, updateIncident, updatePanicState, prependFeedItem, appendTickerEvent]);
}
