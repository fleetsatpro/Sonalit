import { useEffect, useRef } from 'react';
import { subscribe } from '../lib/centrifuge.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardAlert, ConvoyUpdate, IncidentUpdate, PanicEvent } from '../stores/dashboardStore.js';

// ── Message shapes from the backend (org#<id> channel) ─────────────────────

interface LocationMsg {
  type: 'location';
  vehicle_id: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
}

interface PanicMsg {
  type: 'panic';
  panic_id: string;
  device_id: string;
  device_name?: string;
  mode?: string;
  lat?: number | null;
  lng?: number | null;
  created_at: string;
  triggered_at?: string;
}

interface AlertNewMsg {
  type: 'alert.new';
  alertId: string;
  vehicleId?: string;
  alertType: string;
  severity: string;
  message: string;
  geofenceName?: string;
}

interface ConvoyUpdateMsg {
  type: 'convoy.update' | 'convoy.dispatched';
  convoyId: string;
  status?: string;
  name?: string;
}

interface IncidentMsg {
  type: 'incident';
  payload: IncidentUpdate;
}

// Catch-all for unhandled types
type OrgMsg =
  | LocationMsg
  | PanicMsg
  | AlertNewMsg
  | ConvoyUpdateMsg
  | IncidentMsg
  | { type: string; [key: string]: unknown };

// Per-vehicle throttle: max 1 position update per 500ms
const positionThrottle = new Map<string, number>();

export function useDashboardRealtime(orgId: string): void {
  const {
    updateVehiclePosition,
    prependAlert,
    updateConvoy,
    updateIncident,
    updatePanicState,
    prependFeedItem,
    appendTickerEvent,
  } = useDashboardStore.getState();
  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  useEffect(() => {
    if (!orgId) return;

    // Backend publishes all realtime events to org#<id>
    const unsub = subscribe<OrgMsg>(`org#${orgId}`, (msg) => {
      switch (msg.type) {
        case 'location': {
          const m = msg as LocationMsg;
          const now = Date.now();
          const last = positionThrottle.get(m.vehicle_id) ?? 0;
          if (now - last < 500) break;
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
          const m = msg as PanicMsg;
          const p: PanicEvent = {
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
          const m = msg as AlertNewMsg;
          const alert: DashboardAlert = {
            id: m.alertId,
            severity: (m.severity as DashboardAlert['severity']) ?? 'medium',
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
          const m = msg as ConvoyUpdateMsg;
          const convoy: ConvoyUpdate = {
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
          const m = msg as IncidentMsg;
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
