// Sonalit Commander — types (spec §13-16).
//
// Commander is the operational reasoning interface: it plans, calls tools,
// and explains what it found. The types here exist to keep two guarantees
// structural rather than a matter of prompt wording.
//
//  1. EVIDENCE CLASSIFICATION IS DERIVED, NOT CLAIMED (§15, §47). Whether
//     something is observed, computed or predicted comes from the SOURCE of
//     the tool that produced it. A model cannot promote its own inference
//     to "observed" by saying so, because the label never passes through
//     the model at all.
//
//  2. EVERY RUN IS BOUNDED (§9). Tool calls, wall-clock time and turns all
//     have ceilings. An agent that cannot finish inside them says so —
//     it does not loop, and it does not answer anyway.

import { z } from 'zod';

import type { ToolSource } from '../tools/types.js';

/**
 * How a claim is known (spec §15). Ordered from strongest to weakest.
 *
 * The distinction is the point: an operator acting on "observed" is acting
 * on Sonalit's own records, while "inferred" is the model's reading of
 * them and may be wrong in ways the data is not.
 */
export const EvidenceKind = z.enum([
  'observed', // retrieved directly from Sonalit
  'computed', // deterministic calculation over authoritative state
  'predicted', // output of a predictive model
  'inferred', // the model's own reasoning over the above
  'recommended', // a proposed action
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/**
 * Maps a tool's declared source to an evidence kind.
 *
 * This is the whole mechanism behind guarantee (1): the mapping is applied
 * to tool RESULTS, in code, before the model ever sees them. Anything the
 * model adds on top is 'inferred' by definition, because it did not come
 * from a tool.
 */
export function evidenceKindForSource(source: ToolSource): EvidenceKind {
  switch (source) {
    case 'database':
      return 'observed';
    case 'computed':
      return 'computed';
    case 'predicted':
      return 'predicted';
    case 'external':
      // Third-party data is observed, but not by Sonalit — it is labelled
      // as observed while carrying its own provenance in the citation, so
      // an operator can weigh it differently from first-party records.
      return 'observed';
  }
}

/** A single piece of evidence backing an answer. */
export interface Evidence {
  kind: EvidenceKind;
  /** Which tool produced it, or 'model' for the assistant's own reasoning. */
  source: string;
  summary: string;
  /** Age of the underlying data, when the tool reported one (§48). */
  freshness_seconds: number | null;
  /** Present when the tool warned about completeness or staleness. */
  caveats: string[];
}

/**
 * What the user is looking at (spec §14).
 *
 * Supplied by the client and ALWAYS re-authorised server-side before use.
 * §14 is explicit that context must not leak hidden entities: an id the
 * caller cannot otherwise read must not become readable just because it
 * was named as "the current screen".
 */
export const CommanderContext = z.object({
  entity_type: z.enum(['vehicle', 'convoy', 'driver', 'container', 'booking']).optional(),
  entity_id: z.string().max(100).optional(),
  /** Free-text label of the current view, e.g. 'live map'. Never trusted as data. */
  view: z.string().max(100).optional(),
});
export type CommanderContext = z.infer<typeof CommanderContext>;

export const CommanderRequest = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
  context: CommanderContext.optional(),
});
export type CommanderRequest = z.infer<typeof CommanderRequest>;

/**
 * Why a run stopped. Distinguished so the caller can tell a complete
 * answer from a truncated one — §62 requires Commander to be able to say
 * it could not finish, rather than presenting a partial answer as whole.
 */
export const CompletionReason = z.enum([
  'answered',
  'tool_budget_exhausted',
  'time_budget_exhausted',
  'model_unavailable',
  'no_tools_permitted',
]);
export type CompletionReason = z.infer<typeof CompletionReason>;

export interface CommanderResponse {
  answer: string;
  /** Every tool result that informed the answer, classified by source. */
  evidence: Evidence[];
  tools_used: string[];
  completion_reason: CompletionReason;
  /**
   * Derived from evidence quality — never from the model (§47). A model may
   * describe its confidence in prose; it may not set this number.
   */
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  /** Oldest data underpinning the answer, in seconds (§48). */
  data_age_seconds: number | null;
  model_name: string;
  prompt_version: string;
  request_id: string;
  warnings: string[];
}

/** Execution ceilings (spec §9). */
export interface CommanderBudget {
  max_tool_calls: number;
  max_turns: number;
  max_wall_clock_ms: number;
}

export const DEFAULT_BUDGET: CommanderBudget = {
  max_tool_calls: 12,
  max_turns: 8,
  max_wall_clock_ms: 60_000,
};

/**
 * Confidence from evidence, not from the model (§47).
 *
 * The rules are deliberately blunt, because a defensible floor matters
 * more than a finely graded number: no evidence means we cannot answer;
 * evidence that is entirely inferred is weak however fluent it reads; and
 * stale or caveated evidence caps confidence regardless of volume.
 */
export function deriveConfidence(
  evidence: Evidence[],
  completion: CompletionReason,
): CommanderResponse['confidence'] {
  if (evidence.length === 0) return 'insufficient';
  if (completion !== 'answered') return 'low';

  const grounded = evidence.filter(
    (e) => e.kind === 'observed' || e.kind === 'computed' || e.kind === 'predicted',
  );
  if (grounded.length === 0) return 'insufficient';

  const hasCaveats = evidence.some((e) => e.caveats.length > 0);
  const STALE_SECONDS = 30 * 60;
  const isStale = grounded.some(
    (e) => e.freshness_seconds !== null && e.freshness_seconds > STALE_SECONDS,
  );

  if (hasCaveats || isStale) return 'medium';
  return grounded.length >= 2 ? 'high' : 'medium';
}
