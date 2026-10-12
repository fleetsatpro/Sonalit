import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const copilot = readFileSync(new URL('./Copilot.tsx', import.meta.url), 'utf8');
const aiRoutes = readFileSync(new URL('../../../../backend/src/routes/ai.js', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../../../../backend/src/services/copilotActionPolicy.js', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../../../../backend/src/services/copilotActionLedger.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../../backend/migrations/20261012_001_copilot_action_control_plane.sql', import.meta.url), 'utf8');

describe('enterprise Copilot execution contract', () => {
  it('routes user turns through the server-owned tool and intent policy', () => {
    expect(copilot).toContain("api.post<DecisionResponse>('/ai/dispatch'");
    expect(copilot).toContain('request_id: crypto.randomUUID()');
    expect(copilot).not.toContain('const isAction =');
    expect(aiRoutes).toContain('classifyCopilotCommand(command)');
    expect(aiRoutes).toContain('authorizeCopilotTool({ toolName: block.name, command, user })');
    expect(aiRoutes).toContain('Copilot tool policy is incomplete');
    expect(policy).toContain('tool_policy_missing');
    expect(policy).toContain('tenant_identity_required');
  });

  it('stages high-risk actions and requires explicit operator confirmation', () => {
    expect(copilot).toContain("api.post<DecisionResponse>('/ai/dispatch/confirm'");
    expect(copilot).toContain('Confirm and execute');
    expect(copilot).toContain('Decline');
    expect(copilot).toContain("'/ai/dispatch/pending'");
    expect(aiRoutes).toContain("router.post('/dispatch/confirm'");
    expect(aiRoutes).toContain("status: 'pending_confirmation'");
    expect(aiRoutes).toContain('verifyActionConfirmation(confirmationToken)');
    expect(policy).toContain('requires_confirmation: true');
    expect(policy).toContain('timingSafeEqual');
  });

  it('persists idempotent action receipts and privacy-limited tenant-scoped tool traces', () => {
    expect(ledger).toContain('ON CONFLICT (org_id, request_id) DO NOTHING');
    expect(ledger).toContain('idempotency_conflict');
    expect(ledger).toContain('summarizeToolInput');
    expect(ledger).toContain('recordToolTrace');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('copilot_action_runs_org_request_unique');
    expect(migration).toContain('copilot_tool_traces_request_ordinal_unique');
  });

  it('keeps conversation history scoped to both tenant and requesting user', () => {
    expect(aiRoutes).toContain('WHERE org_id = $1 AND user_id = $2');
    expect(aiRoutes).toContain('request_id');
    expect(aiRoutes).toContain('IS NOT DISTINCT FROM EXCLUDED.user_id');
    expect(aiRoutes).toContain('AND user_id=$5');
    expect(copilot).toContain("'/ai/decision/history?limit=12'");
    expect(copilot).toContain('historyRef.current = rows.flatMap');
  });
});
