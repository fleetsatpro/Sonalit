// Tool Registry — type layer (spec §10, §11, §12, §42).
//
// Every operational capability the AI can reach is a typed tool declared
// here. The registry exists to make three properties structural rather
// than a matter of each tool author remembering them:
//
//   1. Arguments are validated against a Zod schema before the handler
//      runs (§11). A model can emit anything; a handler never sees it.
//   2. Execution is org-scoped (§59). A handler is HANDED a client that is
//      already inside a tenant's RLS context — it is not given the pool and
//      trusted to scope its own queries. This is the fix for the leak in
//      backend/src/routes/ai.js, where every tool used the global query()
//      and returned rows across all tenants.
//   3. Mutations are gated by action level (§42). Reads run; drafts and
//      executions require the caller to hold the matching authority.
//
// Handlers therefore CANNOT bypass tenant isolation: they have no route to
// an unscoped connection.

import { z } from 'zod';

import type { PoolClient } from 'pg';

/**
 * Governance level (spec §42). Declared per tool, enforced at execution.
 *
 * `read`     — no mutation. Always permitted to an authenticated caller.
 * `draft`    — prepares an action a human must approve before it takes effect.
 * `execute`  — mutates operational state directly. Allowlisted, low-risk
 *              operations only; anything high-impact must be a `draft`.
 */
export const ActionLevel = z.enum(['read', 'draft', 'execute']);
export type ActionLevel = z.infer<typeof ActionLevel>;

/** Matches ROLE_HIERARCHY in backend/src/middleware/auth.js. */
export const Role = z.enum(['admin', 'dispatcher', 'operator', 'analyst', 'cfo']);
export type Role = z.infer<typeof Role>;

const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  dispatcher: 3,
  operator: 2,
  analyst: 1,
  cfo: 1,
};

export function roleSatisfies(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Who is calling, and on whose behalf. Built from the request, never the model. */
export interface ToolContext {
  org_id: string;
  user_id: string;
  role: Role;
  /** Correlates every tool call in one AI request for the audit log (§44). */
  request_id: string;
}

/**
 * Where a tool's data came from. Surfaced to the model so it can label
 * evidence correctly (§15) rather than presenting everything as observed.
 */
export const ToolSource = z.enum([
  'database', // authoritative Sonalit state
  'computed', // deterministic calculation over authoritative state
  'external', // third-party API — may be stale or unavailable
  'predicted', // ML model output
]);
export type ToolSource = z.infer<typeof ToolSource>;

/**
 * The §12 output contract. Every tool returns this shape, success or not.
 *
 * `freshness_seconds` and `warnings` exist so the model can honour Rule 4
 * and §48: an empty result set is reported as "no matching records", never
 * as zero, and stale data is labelled as stale rather than presented as
 * current.
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data: T | null;
  source: ToolSource;
  /** When the tool ran. */
  timestamp: string;
  /**
   * Age of the underlying data in seconds, when the tool can determine it.
   * null means "not applicable or unknown" — NOT "fresh".
   */
  freshness_seconds: number | null;
  /**
   * Confidence in the result. Derived from retrieval/tool completeness —
   * never assigned by a language model (§47). A plain DB read is 1.
   */
  confidence: number;
  /** Whether the caller's role cleared this tool. */
  permitted: boolean;
  /** Caveats the model must carry into its answer. */
  warnings: string[];
  error?: string;
}

/**
 * A registered tool.
 *
 * `input_schema` is the single source of truth for arguments: it is both
 * validated against at execution time and converted to JSON Schema for the
 * model's tool definition, so the two can never drift apart.
 */
export interface ToolDefinition<TArgs = unknown, TData = unknown> {
  name: string;
  description: string;
  input_schema: z.ZodType<TArgs>;
  action_level: ActionLevel;
  /** Minimum role. Callers below it never reach the handler. */
  required_role: Role;
  source: ToolSource;
  /**
   * The handler. `client` is already inside the caller's org RLS context;
   * queries made through it cannot see another tenant's rows.
   */
  handler: (args: TArgs, ctx: ToolContext, client: PoolClient) => Promise<TData>;
}

/** Any tool, for storage in the heterogeneous registry map. */
export type AnyToolDefinition = ToolDefinition<never, unknown>;
