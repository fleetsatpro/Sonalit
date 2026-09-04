// AI audit log writer (spec §44).
//
// Every request through the AI plane produces exactly one row, whether it
// succeeded, was refused, or exhausted the fallback chain. Failures are
// audited too — "no eligible model" and "all models failed" are the rows
// an incident review needs most.
//
// Writes are best-effort and never propagate: an audit outage must not
// take down operational AI (Rule 3). It is logged at error level so the
// gap is visible rather than silent.

import { randomUUID } from 'node:crypto';

import { withOrgContext } from '../db.js';

import type { DataClassification, ModelCapability } from './types.js';

export type AuditOutcome =
  | 'success'
  | 'no_eligible_model'
  | 'all_models_failed'
  | 'rejected'
  | 'error';

export interface AuditRecord {
  org_id: string;
  user_id?: string | null;
  conversation_id?: string | null;
  request_id: string;
  capability: ModelCapability;
  classification: DataClassification;
  /** UUID of the model that served the request, if one did. */
  model_id?: string | null;
  model_version?: string | null;
  prompt_version?: string | null;
  routing_attempts?: unknown[];
  tools_invoked?: unknown[];
  retrieved_sources?: unknown[];
  input_tokens?: number | null;
  output_tokens?: number | null;
  latency_ms?: number | null;
  outcome: AuditOutcome;
  error?: string | null;
}

export function newRequestId(): string {
  return randomUUID();
}

export async function recordAudit(record: AuditRecord): Promise<void> {
  try {
    // Written under the tenant's RLS context, same as any other org-scoped
    // table — the audit log is not a privileged back door around §59.
    await withOrgContext(record.org_id, async (client) => {
      await client.query(
        `INSERT INTO ai_audit_log (
           org_id, user_id, conversation_id, request_id, capability, classification,
           model_id, model_version, prompt_version, routing_attempts, tools_invoked,
           retrieved_sources, input_tokens, output_tokens, latency_ms, outcome, error
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          record.org_id,
          record.user_id ?? null,
          record.conversation_id ?? null,
          record.request_id,
          record.capability,
          record.classification,
          record.model_id ?? null,
          record.model_version ?? null,
          record.prompt_version ?? null,
          JSON.stringify(record.routing_attempts ?? []),
          JSON.stringify(record.tools_invoked ?? []),
          JSON.stringify(record.retrieved_sources ?? []),
          record.input_tokens ?? null,
          record.output_tokens ?? null,
          record.latency_ms ?? null,
          record.outcome,
          // Truncated: provider errors can carry very long bodies.
          record.error ? record.error.slice(0, 2000) : null,
        ],
      );
    });
  } catch (err) {
    process.stderr.write(
      `AI audit write failed for request ${record.request_id}: ${String(err)}\n`,
    );
  }
}
