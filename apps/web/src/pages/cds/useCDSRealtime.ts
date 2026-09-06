/**
 * Keeps Yard, Port and the control room looking at the same shipment.
 *
 * Before this, the three surfaces only learned about each other by polling —
 * 15s on the field queues, 20-30s on the dashboard, and never at all on
 * Trips, Containers, Locks, Bookings or Alerts. A clamp at the gate could sit
 * invisible on a controller's board indefinitely; a seal mismatch reached the
 * control room no faster than a routine delivery.
 *
 * The backend now publishes every CDS state change to `org#<orgId>`
 * (backend/src/routes/cds.js publishCds). This hook turns those into
 * react-query invalidations, so a screen refetches the instant something it
 * cares about actually changed and stays idle the rest of the time.
 *
 * Invalidation rather than patching the cache by hand is deliberate: the event
 * carries enough to know *that* something moved, and the server stays the one
 * authority on what the new state is. A cache patched from a payload is a
 * second, quietly diverging copy of the trip state machine.
 *
 * Realtime is an accelerator, never the source of truth — every query below
 * keeps its polling interval as a floor, so a dropped socket or an unconfigured
 * Centrifugo degrades to exactly the behaviour that existed before.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { subscribe } from '../../lib/centrifuge.js';

export interface CDSEvent {
  type: string;
  at?: string;
  actor?: string | null;
  actor_role?: string | null;
  booking_id?: string;
  booking_number?: string;
  booking_container_id?: string;
  container_number?: string | null;
  trip_id?: string | null;
  trip_number?: string;
  status?: string;
  from_status?: string;
  lock_serial?: string;
  seal_intact?: boolean | null;
  tamper?: boolean;
}

/** Events this hook understands. Anything else on the channel is ignored. */
const CDS_PREFIX = 'cds.';

export interface CDSRealtimeOptions {
  /** Called for each CDS event, after the invalidations. For live tickers and tamper alarms. */
  onEvent?: (event: CDSEvent) => void;
}

export function useCDSRealtime(orgId: string | undefined, opts: CDSRealtimeOptions = {}): void {
  const qc = useQueryClient();

  // Held in a ref, not a dependency: callers pass an inline object, so a
  // plain dependency would tear down and re-open the Centrifugo subscription
  // on every render — dropping events in the gap, which is the one thing this
  // hook exists to prevent.
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  useEffect(() => {
    if (!orgId) return;

    return subscribe<CDSEvent>(`org#${orgId}`, (msg) => {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith(CDS_PREFIX)) return;

      switch (msg.type) {
        case 'cds.container.clamped':
        case 'cds.container.unclamped': {
          // A clamp moves a container out of the yard queue and into the port
          // queue in one step, so both field surfaces are invalidated on both
          // events — the crew that did *not* perform the action is precisely
          // the one that needs telling.
          void qc.invalidateQueries({ queryKey: ['cds', 'field'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'locks'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'containers'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
          // The Manifest view is the control room's per-container board — the
          // exact screen that used to sit blank while the yard was clamping.
          void qc.invalidateQueries({ queryKey: ['cds', 'manifest'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'activity'] });
          // Both handlers write a cds_alerts row, and the unclamp path writes a
          // critical one when a seal fails verification.
          void qc.invalidateQueries({ queryKey: ['cds', 'alerts'] });
          if (msg.booking_id) {
            void qc.invalidateQueries({ queryKey: ['cds', 'booking-containers', msg.booking_id] });
          }
          break;
        }

        case 'cds.trip.updated': {
          void qc.invalidateQueries({ queryKey: ['cds', 'trips'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'field'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'activity'] });
          break;
        }

        case 'cds.booking.updated': {
          void qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'manifest'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'field'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'dashboard'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'activity'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'alerts'] });
          if (msg.booking_id) {
            void qc.invalidateQueries({ queryKey: ['cds', 'booking-containers', msg.booking_id] });
          }
          break;
        }

        case 'cds.container.updated': {
          void qc.invalidateQueries({ queryKey: ['cds', 'field'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'bookings'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'manifest'] });
          void qc.invalidateQueries({ queryKey: ['cds', 'containers'] });
          if (msg.booking_id) {
            void qc.invalidateQueries({ queryKey: ['cds', 'booking-containers', msg.booking_id] });
          }
          break;
        }

        default:
          break;
      }

      onEventRef.current?.(msg);
    });
  }, [orgId, qc]);
}
