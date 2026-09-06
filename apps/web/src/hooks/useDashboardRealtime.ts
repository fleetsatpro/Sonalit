import { useEffect, useRef } from 'react';
import { subscribe } from '../lib/centrifuge.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import type { DashboardAlert, ConvoyUpdate, IncidentUpdate, PanicEvent, VoiceNoteAlert, CrewDispatch } from '../stores/dashboardStore.js';
import { playSiren, sirenForAlert } from '../lib/siren.js';
import { startTabTitleFlash, notifyIfHidden } from '../lib/tabAlert.js';

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

interface PanicCancelMsg {
  type: 'panic_cancel';
  device_id: string;
  cancelled: string[];
  cancelled_at: string;
}

interface PanicAckMsg {
  type: 'panic_ack';
  panic_id: string;
  device_id: string;
  acknowledged_at: string;
  acknowledged_by_name?: string | null;
}

interface PanicResolvedMsg {
  type: 'panic_resolved';
  panic_id: string;
  device_id: string;
  resolved_at: string;
}

interface PanicEscalatedMsg {
  type: 'panic_escalated';
  panic_id: string;
  device_id: string;
  device_name?: string;
  escalation_level: number;
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

// Published by POST /guardian/voice-message (guardian.js) the moment a
// field officer's clip lands — the reverse direction of dispatch's own
// voice messages, which use command:queued instead (see 'panic' above for
// the general shape of a device-originated event on this channel).
interface GuardianVoiceMessageMsg {
  type: 'guardian_voice_message';
  device_id: string;
  device_name?: string;
  voice_id: string;
  duration_ms: number | null;
  created_at: string;
  lat?: number | null;
  lng?: number | null;
}

// Published by POST /guardian/capture-photo the moment a covert still lands.
interface CrewDispatchedMsg {
  type: 'crew.dispatched';
  dispatch_id: string;
  team_id: string;
  team_name: string;
  team_callsign: string | null;
  priority: 'critical' | 'high' | 'medium';
  reason: string;
  target_lat: number;
  target_lng: number;
  target_label: string | null;
  dispatched_at: string;
}

interface CrewStatusUpdateMsg {
  type: 'crew.status_update';
  dispatch_id: string;
  team_id: string;
  team_name: string;
  team_callsign: string | null;
  status: string;
  target_lat: number;
  target_lng: number;
  updated_at: string;
}

interface GuardianCapturePhotoMsg {
  type: 'guardian_capture_photo';
  device_id: string;
  device_name?: string;
  capture_id: string;
  url: string;
  created_at: string;
}

// Catch-all for unhandled types
type OrgMsg =
  | LocationMsg
  | PanicMsg
  | PanicCancelMsg
  | PanicAckMsg
  | PanicResolvedMsg
  | PanicEscalatedMsg
  | AlertNewMsg
  | ConvoyUpdateMsg
  | IncidentMsg
  | GuardianVoiceMessageMsg
  | GuardianCapturePhotoMsg
  | CrewDispatchedMsg
  | CrewStatusUpdateMsg
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
    acknowledgePanicState,
    escalatePanicState,
    prependFeedItem,
    appendTickerEvent,
    setVoiceNoteAlert,
    upsertCrewDispatch,
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
            ...(m.device_name != null && { deviceName: m.device_name }),
            ...(m.mode != null && { mode: m.mode }),
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

        // Device-initiated cancel (POST /guardian/panic/cancel). Previously
        // unhandled here, so the alarm only cleared via the 15s REST poll in
        // PanicAlarm.tsx — up to 15s of a strobing/siren dashboard after the
        // operator had already resolved it from the device side.
        case 'panic_cancel': {
          const current = useDashboardStore.getState().panicState;
          if (current?.status === 'active') {
            updatePanicState({ id: current.id, status: 'resolved', triggered_at: current.triggered_at });
          }
          break;
        }

        // Admin-initiated resolve (PATCH /guardian/panic/:id/resolve) — previously
        // silent over realtime, so other dashboards only cleared via a 15-60s poll.
        case 'panic_resolved': {
          const m = msg as PanicResolvedMsg;
          const current = useDashboardStore.getState().panicState;
          if (current?.id === m.panic_id) {
            updatePanicState({ id: current.id, status: 'resolved', triggered_at: current.triggered_at });
          }
          prependFeedItem({
            id: `${m.panic_id}-resolved`,
            type: 'panic',
            message: 'Panic alert resolved',
            timestamp: m.resolved_at,
          });
          break;
        }

        case 'panic_ack': {
          const m = msg as PanicAckMsg;
          acknowledgePanicState(m.panic_id, m.acknowledged_at, m.acknowledged_by_name ?? null);
          prependFeedItem({
            id: `${m.panic_id}-ack`,
            type: 'panic',
            message: `Panic alert acknowledged${m.acknowledged_by_name ? ` by ${m.acknowledged_by_name}` : ''}`,
            timestamp: m.acknowledged_at,
          });
          break;
        }

        case 'panic_escalated': {
          const m = msg as PanicEscalatedMsg;
          escalatePanicState(m.panic_id, m.escalation_level);
          const escMsg = `PANIC ESCALATED (level ${m.escalation_level}) — ${m.device_name ?? 'device'} still unacknowledged`;
          prependFeedItem({
            id: `${m.panic_id}-esc-${m.escalation_level}`,
            type: 'panic',
            message: escMsg,
            severity: 'critical',
            timestamp: new Date().toISOString(),
          });
          appendTickerEvent({ id: `${m.panic_id}-esc-${m.escalation_level}`, severity: 'critical', message: escMsg });
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
          // A one-shot cue, distinct per alert type — but never cut off an
          // active panic wail (playSiren only runs one siren at a time, so
          // playing a cue here while panic is active would silently kill
          // the ongoing panic alarm and not restart it).
          if (useDashboardStore.getState().panicState?.status !== 'active') {
            const cue = sirenForAlert(alert.type, alert.severity);
            if (cue) playSiren(cue, { loop: false });
          }
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

        // Field officer sent a voice note up (reverse of the existing
        // dispatch->device flow). Previously this only ever showed up
        // passively in Live Fleet's device detail card — easy to miss
        // entirely unless that exact card happened to be open. This makes
        // it hard to miss regardless of what page/device is on screen:
        // a toast (VoiceNoteAlertToast, rendered by GlobalPanicAlarm
        // alongside the actual panic alarm), a one-shot chime, and — if the
        // tab isn't even in front of the operator — a flashing tab title
        // plus a native OS notification (only once permission's granted;
        // see VoiceNoteAlertToast's "Enable notifications" affordance).
        case 'guardian_voice_message': {
          const m = msg as GuardianVoiceMessageMsg;
          const alert: VoiceNoteAlert = {
            id: m.voice_id,
            deviceId: m.device_id,
            deviceName: m.device_name ?? 'Field officer',
            voiceId: m.voice_id,
            durationMs: m.duration_ms,
            createdAt: m.created_at,
            lat: m.lat ?? null,
            lng: m.lng ?? null,
          };
          setVoiceNoteAlert(alert);
          // Never cut off an active panic wail — same guard as alert.new above.
          if (useDashboardStore.getState().panicState?.status !== 'active') {
            playSiren('chirp', { loop: false });
          }
          startTabTitleFlash(`🎙️ Voice note from ${alert.deviceName}`);
          notifyIfHidden('New voice note', `${alert.deviceName} sent a voice note`);
          break;
        }

        // Covert photo landed — surface it in the live feed with a thumbnail.
        case 'guardian_capture_photo': {
          const m = msg as GuardianCapturePhotoMsg;
          prependFeedItem({
            id: m.capture_id,
            type: 'capture',
            message: `Photo captured — ${m.device_name ?? 'device'}`,
            severity: 'info',
            timestamp: m.created_at,
            imageUrl: m.url,
          });
          notifyIfHidden('Photo captured', `${m.device_name ?? 'A device'} sent a photo`);
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

        case 'crew.dispatched': {
          const m = msg as CrewDispatchedMsg;
          const d: CrewDispatch = {
            id: m.dispatch_id,
            team_id: m.team_id,
            team_name: m.team_name,
            team_callsign: m.team_callsign,
            priority: m.priority,
            status: 'dispatched',
            reason: m.reason,
            target_lat: m.target_lat,
            target_lng: m.target_lng,
            target_label: m.target_label,
            dispatched_at: m.dispatched_at,
          };
          upsertCrewDispatch(d);
          prependFeedItem({
            id: d.id,
            type: 'crew_dispatch',
            message: `CREW DISPATCHED — ${m.team_name}${m.team_callsign ? ` (${m.team_callsign})` : ''}: ${m.reason}`,
            severity: m.priority === 'critical' ? 'critical' : 'high',
            timestamp: m.dispatched_at,
          });
          appendTickerEvent({
            id: d.id,
            severity: m.priority === 'critical' ? 'critical' : 'high',
            message: `Response crew ${m.team_name} dispatched`,
          });
          if (useDashboardStore.getState().panicState?.status !== 'active') {
            playSiren('klaxon', { loop: false });
          }
          startTabTitleFlash(`🚨 Crew dispatched: ${m.team_name}`);
          notifyIfHidden('Crew Dispatched', `${m.team_name} dispatched: ${m.reason}`);
          break;
        }

        case 'crew.status_update': {
          const m = msg as CrewStatusUpdateMsg;
          upsertCrewDispatch({
            id: m.dispatch_id,
            team_id: m.team_id,
            team_name: m.team_name,
            team_callsign: m.team_callsign,
            priority: 'high',
            status: m.status as CrewDispatch['status'],
            reason: '',
            target_lat: m.target_lat,
            target_lng: m.target_lng,
            target_label: null,
            dispatched_at: m.updated_at,
          });
          const label = m.status === 'en_route' ? 'EN ROUTE'
            : m.status === 'on_scene' ? 'ON SCENE'
            : m.status === 'resolved' ? 'RESOLVED'
            : m.status.toUpperCase();
          prependFeedItem({
            id: `${m.dispatch_id}-${m.status}`,
            type: 'crew_dispatch',
            message: `Crew ${m.team_name}: ${label}`,
            timestamp: m.updated_at,
          });
          break;
        }

        default:
          break;
      }
    });

    return unsub;
  }, [orgId, updateVehiclePosition, prependAlert, updateConvoy, updateIncident, updatePanicState, acknowledgePanicState, escalatePanicState, prependFeedItem, appendTickerEvent, setVoiceNoteAlert, upsertCrewDispatch]);
}
