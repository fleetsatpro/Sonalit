// Event correlation (spec §30).
//
// The problem this solves: a corridor deviation, an unexpected stop, ETA
// degradation and communication silence arriving within a few minutes of
// each other are not four alerts. They are one situation, and paging an
// operator four times for it is how real signals get ignored.
//
// Two rules govern the design:
//
//  1. Correlation NEVER destroys evidence. Every contributing signal is
//     carried on the finding, unmodified, so an operator can see what it
//     was built from and disagree with the conclusion.
//  2. Correlation is DETERMINISTIC. Rules are data, findings are labels
//     from those rules, and the same signals always produce the same
//     result. The AI layer explains a finding; it never invents one, and
//     Watchtower keeps working with every model offline (§20, Rule 3).

import { randomUUID } from 'node:crypto';

import {
  maxSeverity,
  type Correlation,
  type Severity,
  type Signal,
  type SignalType,
} from './types.js';

/**
 * A correlation rule.
 *
 * `requires` are signal types that must ALL be present; `boosts` are types
 * that raise severity when also present but are not required. Splitting
 * them keeps rules readable and lets one rule fire early on its core
 * signals, then strengthen as corroboration arrives.
 */
export interface CorrelationRule {
  rule_id: string;
  finding: string;
  requires: SignalType[];
  boosts?: SignalType[];
  /** Signals must fall within this window of each other. */
  window_ms: number;
  base_severity: Severity;
}

/**
 * Default rules. Ordered by specificity: the first match wins, so a
 * narrower, more informative finding is preferred over a broad one.
 */
export const DEFAULT_RULES: CorrelationRule[] = [
  {
    // §64's worked example.
    rule_id: 'operational_disruption_v1',
    finding: 'POSSIBLE OPERATIONAL DISRUPTION',
    requires: ['corridor_deviation', 'unexpected_stop'],
    boosts: ['eta_degradation', 'comms_silence'],
    window_ms: 20 * 60_000,
    base_severity: 'warning',
  },
  {
    // Panic alongside any loss of contact is the highest-confidence
    // distress pattern the platform has, so it is never merely a warning.
    rule_id: 'distress_v1',
    finding: 'POSSIBLE DISTRESS — PANIC WITH LOSS OF CONTACT',
    requires: ['panic'],
    boosts: ['comms_silence', 'telemetry_gap', 'unexpected_stop'],
    window_ms: 15 * 60_000,
    base_severity: 'critical',
  },
  {
    rule_id: 'cargo_integrity_v1',
    finding: 'POSSIBLE CARGO INTERFERENCE',
    requires: ['seal_broken', 'unexpected_stop'],
    boosts: ['geofence_breach', 'corridor_deviation'],
    window_ms: 30 * 60_000,
    base_severity: 'critical',
  },
  {
    rule_id: 'convoy_integrity_v1',
    finding: 'CONVOY INTEGRITY DEGRADED',
    requires: ['convoy_separation'],
    boosts: ['comms_silence', 'eta_degradation', 'telemetry_gap'],
    window_ms: 25 * 60_000,
    base_severity: 'warning',
  },
  {
    rule_id: 'contact_lost_v1',
    finding: 'CONTACT DEGRADED',
    requires: ['comms_silence', 'telemetry_gap'],
    window_ms: 30 * 60_000,
    base_severity: 'warning',
  },
];

/** Correlation scope: a convoy when the signal has one, else the entity. */
function scopeKey(signal: Signal): string {
  return signal.convoy_id !== null
    ? `convoy:${signal.convoy_id}`
    : `${signal.entity_type}:${signal.entity_id}`;
}

function escalate(severity: Severity, steps: number): Severity {
  const order: Severity[] = ['info', 'warning', 'critical'];
  const index = Math.min(order.indexOf(severity) + steps, order.length - 1);
  return order[index] ?? severity;
}

export interface CorrelateOptions {
  rules?: CorrelationRule[];
  /** Treated as "now" for windowing. Injected so tests are deterministic. */
  now?: Date;
}

/**
 * Groups signals into findings.
 *
 * Signals that match no rule are deliberately NOT dropped — they are
 * returned in `uncorrelated` so the caller still raises them individually.
 * Correlation is a way to reduce noise, never a filter that can swallow a
 * signal nobody wrote a rule for yet.
 */
export function correlate(
  signals: Signal[],
  options: CorrelateOptions = {},
): { correlations: Correlation[]; uncorrelated: Signal[] } {
  const rules = options.rules ?? DEFAULT_RULES;
  const now = options.now ?? new Date();

  const byScope = new Map<string, Signal[]>();
  for (const signal of signals) {
    const key = scopeKey(signal);
    const bucket = byScope.get(key);
    if (bucket) bucket.push(signal);
    else byScope.set(key, [signal]);
  }

  const correlations: Correlation[] = [];
  const consumed = new Set<string>();

  for (const bucket of byScope.values()) {
    // Oldest first, so a window is anchored on the signal that started the
    // situation rather than the most recent one.
    const ordered = [...bucket].sort((a, b) => a.observed_at.getTime() - b.observed_at.getTime());

    for (const rule of rules) {
      for (const anchor of ordered) {
        if (consumed.has(anchor.signal_id)) continue;

        const windowStart = anchor.observed_at.getTime();
        const inWindow = ordered.filter(
          (s) =>
            !consumed.has(s.signal_id) &&
            s.observed_at.getTime() >= windowStart &&
            s.observed_at.getTime() - windowStart <= rule.window_ms,
        );

        const present = new Set(inWindow.map((s) => s.type));
        if (!rule.requires.every((t) => present.has(t))) continue;

        // Only signals the rule actually names become evidence. An
        // unrelated signal that merely fell inside the window would be
        // misleading on the finding and is left to correlate on its own.
        const relevant = new Set<SignalType>([...rule.requires, ...(rule.boosts ?? [])]);
        const members = inWindow.filter((s) => relevant.has(s.type));
        if (members.length === 0) continue;

        const boostsPresent = (rule.boosts ?? []).filter((t) => present.has(t)).length;
        const severity = maxSeverity([
          escalate(rule.base_severity, boostsPresent > 0 ? 1 : 0),
          ...members.map((m) => m.severity),
        ]);

        const times = members.map((m) => m.observed_at.getTime());
        correlations.push({
          correlation_id: randomUUID(),
          org_id: anchor.org_id,
          entity_type: anchor.entity_type,
          entity_id: anchor.entity_id,
          convoy_id: anchor.convoy_id,
          finding: rule.finding,
          severity,
          state: 'correlated',
          // Evidence, verbatim and complete (§30).
          signals: members,
          window_start: new Date(Math.min(...times)),
          window_end: new Date(Math.max(...times)),
          rule_id: rule.rule_id,
          created_at: now,
        });

        for (const member of members) consumed.add(member.signal_id);
      }
    }
  }

  return {
    correlations,
    uncorrelated: signals.filter((s) => !consumed.has(s.signal_id)),
  };
}
