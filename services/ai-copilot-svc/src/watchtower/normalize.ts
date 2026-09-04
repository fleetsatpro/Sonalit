// Event normalisation (spec §29, first stage).
//
// Watchtower consumes events that already exist on the platform's buses —
// NATS subjects from @sonalit/contracts, and alert rows written by the
// legacy backend — and flattens them into one Signal vocabulary. Doing this
// once, here, is what lets the correlation engine reason about situations
// instead of about each producer's payload shape.
//
// Two rules, both from Rule 1 (AI is not the system of record):
//
//  1. Nothing is invented. A field the producer did not send is null, never
//     a guess. An event that cannot be normalised is REJECTED, not
//     approximated — a fabricated entity id would correlate against the
//     wrong convoy and produce a confident, wrong finding.
//  2. Timestamps are preserved as sent. `observed_at` comes from the
//     producer; only `ingested_at` is Watchtower's own clock.

import { randomUUID } from 'node:crypto';

import { Signal, type Severity, type SignalType } from './types.js';

export interface RawEvent {
  /** NATS subject, or a synthetic source name for non-bus producers. */
  subject: string;
  payload: Record<string, unknown>;
  received_at?: Date;
}

export class UnnormalisableEventError extends Error {
  constructor(
    readonly subject: string,
    reason: string,
  ) {
    super(`Cannot normalise event on '${subject}': ${reason}`);
    this.name = 'UnnormalisableEventError';
  }
}

function str(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * Producer timestamps arrive as ISO strings or epoch milliseconds depending
 * on the bus. An unparseable or absent timestamp is null rather than
 * `new Date()` — silently substituting now would make a stale event look
 * current, which is exactly what §48 exists to prevent.
 */
function parseTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Alert types the legacy backend emits, mapped to the signal vocabulary. */
const ALERT_TYPE_MAP: Record<string, SignalType> = {
  route_deviation: 'corridor_deviation',
  corridor_deviation: 'corridor_deviation',
  geofence: 'geofence_breach',
  speed: 'speed_violation',
  communication: 'comms_silence',
  seal: 'seal_broken',
  idle: 'unexpected_stop',
  stop: 'unexpected_stop',
};

function normaliseSeverity(value: unknown): Severity {
  // The legacy backend uses low/medium/high/critical; contracts use
  // info/warning/critical. Both are accepted and folded to the latter.
  switch (value) {
    case 'critical':
      return 'critical';
    case 'high':
    case 'warning':
      return 'warning';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'info';
    default:
      return 'info';
  }
}

/**
 * Turns one bus event into a Signal.
 *
 * Throws `UnnormalisableEventError` rather than returning null so a caller
 * cannot accidentally treat a dropped event as "nothing happened". The
 * consumer logs and skips; the event is not silently lost.
 */
export function normalise(event: RawEvent): Signal {
  const { subject, payload } = event;
  const ingestedAt = event.received_at ?? new Date();

  const orgId = str(payload, 'org_id', 'orgId');
  if (!orgId) {
    // Without a tenant a signal cannot be scoped, stored under RLS, or
    // shown to anyone. It is never defaulted.
    throw new UnnormalisableEventError(subject, 'no org_id in payload');
  }

  let type: SignalType | null = null;
  if (subject.startsWith('events.panic')) {
    type = 'panic';
  } else if (subject.startsWith('events.geofence.breach')) {
    type = 'geofence_breach';
  } else if (subject.startsWith('events.alert')) {
    const alertType = str(payload, 'type');
    type = alertType !== null ? (ALERT_TYPE_MAP[alertType] ?? null) : null;
    if (type === null) {
      throw new UnnormalisableEventError(
        subject,
        `alert type '${alertType ?? 'missing'}' has no signal mapping`,
      );
    }
  } else {
    throw new UnnormalisableEventError(subject, 'no rule for this subject');
  }

  const observedAt =
    parseTime(payload['occurred_at']) ??
    parseTime(payload['observed_at']) ??
    parseTime(payload['created_at']) ??
    parseTime(payload['timestamp']);
  if (!observedAt) {
    throw new UnnormalisableEventError(subject, 'no parseable producer timestamp');
  }

  const vehicleId = str(payload, 'vehicle_id', 'vehicleId');
  const deviceId = str(payload, 'device_id', 'deviceId');
  const convoyId = str(payload, 'convoy_id', 'convoyId');

  // Prefer the most specific entity the producer named. A signal with no
  // subject at all cannot be correlated and is rejected.
  const entity =
    vehicleId !== null
      ? { entity_type: 'vehicle' as const, entity_id: vehicleId }
      : deviceId !== null
        ? { entity_type: 'device' as const, entity_id: deviceId }
        : convoyId !== null
          ? { entity_type: 'convoy' as const, entity_id: convoyId }
          : null;
  if (!entity) {
    throw new UnnormalisableEventError(subject, 'no vehicle, device or convoy id');
  }

  return Signal.parse({
    signal_id: randomUUID(),
    org_id: orgId,
    type,
    severity: normaliseSeverity(payload['severity']),
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    convoy_id: convoyId,
    observed_at: observedAt,
    ingested_at: ingestedAt,
    // Retained verbatim: the raw producer payload is the evidence a human
    // checks the finding against (§30).
    payload,
    source: subject,
  });
}

/**
 * Normalises a batch, separating failures rather than throwing.
 *
 * A malformed event from one producer must not stop Watchtower processing
 * everything else on the bus.
 */
export function normaliseBatch(events: RawEvent[]): {
  signals: Signal[];
  rejected: { subject: string; reason: string }[];
} {
  const signals: Signal[] = [];
  const rejected: { subject: string; reason: string }[] = [];

  for (const event of events) {
    try {
      signals.push(normalise(event));
    } catch (err) {
      rejected.push({
        subject: event.subject,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { signals, rejected };
}
