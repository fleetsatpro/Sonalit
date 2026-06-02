import { useEffect, useRef } from 'react';
import { subscribe } from '../lib/centrifuge.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardAlert, ConvoyUpdate, PanicEvent } from '../stores/dashboardStore.js';

// Backend publishes ALL events to a single org channel: org#<orgId>
// Actual message types from the backend source:
//   gpsWorker:           type: 'location'      (not 'position')
//   alertWorker/ctrl:    type: 'alert.new'     (not 'alert')
//   convoyController:    type: 'convoy.update' (not 'convoy')
//   guardian routes:     type: 'panic'

interface LocationMsg {
  type: 'location';
  vehicle_id: string;
  device_id: string;
  lat: number;
  lng: number;
  speed: number;
  heading?: number;
}

interface AlertNewMsg {
  type: 'alert.new';
  alertId: string;
  vehicleId: string;
  alertType: string;
  severity: string;
  message: string;
}

interface ConvoyUpdateMsg {
  type: 'convoy.update';
  convoyId: string;
  status: string;
  updatedBy?: string;
}

interface PanicMsg {
  type: 'panic';
  id: string;
  status: 'active' | 'resolved';
  vehicle_id?: string;
  lat?: number;
  lng?: number;
  triggered_at: string;
}

interface AlertAckMsg { type: 'alert_ack'; id: string }

type OrgMsg = LocationMsg | AlertNewMsg | ConvoyUpdateMsg | PanicMsg | AlertAckMsg;

export function useDashboardRealtime(orgId: string): void {
  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  useEffect(() => {
    if (!orgId) return;

    const { prependAlert, removeAlert, updateConvoy, updatePanicState, prependFeedItem, appendTickerEvent } =
      useDashboardStore.getState();

    const unsub = subscribe<OrgMsg>(`org#${orgId}`, (msg) => {
      switch (msg.type) {
        case 'location':
          // Use module-level RAF queue — never setState per GPS fix
          queuePositionUpdate({
            vehicle_id: msg.vehicle_id,
            lat: msg.lat,
            lng: msg.lng,
            heading: msg.heading ?? 0,
            speed_kmh: msg.speed,
          });
          break;

        case 'alert.new': {
          const alert: DashboardAlert = {
            id: msg.alertId,
            severity: msg.severity as DashboardAlert['severity'],
            type: msg.alertType,
            title: msg.message,
            summary: '',
            convoy_id: null,
            occurred_at: new Date().toISOString(),
            acknowledged: false,
          };
          prependAlert(alert);
          appendTickerEvent({ id: alert.id, severity: alert.severity, message: alert.title });
          prependFeedItem({ id: alert.id, type: 'alert', message: alert.title, severity: alert.severity, timestamp: alert.occurred_at });
          break;
        }

        case 'alert_ack':
          removeAlert(msg.id);
          break;

        case 'convoy.update': {
          const convoy: ConvoyUpdate = { id: msg.convoyId, name: msg.convoyId, status: msg.status };
          updateConvoy(convoy);
          prependFeedItem({ id: convoy.id, type: 'convoy', message: `Convoy ${convoy.id}: ${convoy.status}`, timestamp: new Date().toISOString() });
          break;
        }

        case 'panic': {
          const panic: PanicEvent = {
            id: msg.id,
            status: msg.status,
            triggered_at: msg.triggered_at,
            ...(msg.vehicle_id !== undefined && { vehicle_id: msg.vehicle_id }),
            ...(msg.lat !== undefined && { lat: msg.lat }),
            ...(msg.lng !== undefined && { lng: msg.lng }),
          };
          updatePanicState(panic);
          if (msg.status === 'active') {
            prependFeedItem({ id: panic.id, type: 'panic', message: 'PANIC ALERT ACTIVATED', severity: 'critical', timestamp: panic.triggered_at });
            appendTickerEvent({ id: panic.id, severity: 'critical', message: 'PANIC ALERT ACTIVATED' });
          }
          break;
        }
      }
    });

    return unsub;
  }, [orgId]);
}

// ── RAF position queue ──────────────────────────────────────────────────────
// Batches GPS position updates and drains them at ~60fps via requestAnimationFrame.
// Without this: 9 vehicles × 1Hz = 9 React setState calls/sec.
// With this: all queued updates flushed in a single setState per frame.

type RawPos = { vehicle_id: string; lat: number; lng: number; heading: number; speed_kmh: number };
const _posQueue = new Map<string, RawPos>();
let _rafHandle: number | null = null;

function drainPositionQueue() {
  if (_posQueue.size === 0) { _rafHandle = null; return; }
  const updates = [..._posQueue.values()];
  _posQueue.clear();
  const { updateVehiclePosition } = useDashboardStore.getState();
  // Single store access for all batched updates
  updates.forEach((pos) => updateVehiclePosition(pos));
  _rafHandle = requestAnimationFrame(drainPositionQueue);
}

export function queuePositionUpdate(pos: RawPos): void {
  _posQueue.set(pos.vehicle_id, pos); // newest fix wins per vehicle
  if (!_rafHandle) _rafHandle = requestAnimationFrame(drainPositionQueue);
}
